"""codex-gate: per-head Codex review evidence as a commit status (issue #46).

Fail-closed. A PR head gets `codex-gate` = success only when ALL of these hold for the
current full head SHA (read twice; it must not change while judging):
  1. The latest summary comment by the Codex bot carries `codex-review-state:v1` with
     code_review.commit_sha == head, status == completed, has_unresolved_findings == false.
     A security_review, when present, is completed, recorded for the same head, with no
     unresolved finding.
  2. Receipt for the head: either a `codex-review-receipt:v1` review by the bot on the head whose
     inline comments are all in resolved threads, or (clean review, no receipt) the summary says
     there were no findings at all and the bot reacted +1 on the PR at/after the latest completion
     time shown in that summary (observed bot contract, 2026-11-10).
  3. No unresolved review thread on the PR.
  4. For each required check, test (macos-latest) and test (windows-latest), the most recent run
     on the head (highest id) is completed with conclusion success.
  5. PR is open, based on main, and not BEHIND / DIRTY / UNKNOWN.
  6. Every connection and the check-run list were read completely (no unread page).
Running, missing, stale, malformed, partial or contradictory data is never a pass, and an error
while judging ends with a non-success status on the head.

The decision logic (`evaluate`, `status_for`, `run_one`) is unit tested in ci/test_codex_gate.py.
`main` reads GitHub with the workflow token and writes one commit status per PR head.
It never checks out or runs pull-request code and never prints secrets.
"""
import json
import os
import re
import sys
import time
import urllib.request

BOT = 'chatgpt-codex-connector'             # GraphQL login of the bot's comments and reviews
BOT_REACTION_LOGINS = (BOT, BOT + '[bot]')  # GraphQL reaction user login carries the [bot] suffix
REQUIRED_CHECKS = ('test (macos-latest)', 'test (windows-latest)')
CONTEXT = 'codex-gate'
# Failure codes that only mean "evidence for this head is not there yet".
WAITING_PREFIXES = ('summary_missing_or_malformed', 'summary_stale_head', 'summary_status_',
                    'security_status_', 'security_stale_head', 'clean_receipt_thumbs_up_missing',
                    'clean_receipt_no_completion_time', 'check_not_success:', 'merge_state_behind',
                    'merge_state_unknown', 'head_changed_during_check', 'evidence_changed_during_check')
# (connection name, pageInfo flag that means "more nodes were not read").
# `last:N` connections leave older nodes unread (hasPreviousPage); `first:N` leave newer ones (hasNextPage).
TOP_CONNECTIONS = (('comments', 'hasPreviousPage'), ('reviews', 'hasPreviousPage'),
                   ('reactions', 'hasPreviousPage'), ('reviewThreads', 'hasNextPage'))


def _more_pages(connection, flag):
    """True unless pageInfo is present and says there is no unread page (missing = unknown = more)."""
    info = (connection or {}).get('pageInfo')
    return not isinstance(info, dict) or info.get(flag) is not False


def _pagination(pr, checks):
    fail = []
    for name, flag in TOP_CONNECTIONS:
        if _more_pages(pr.get(name), flag):
            fail.append('pagination_incomplete:' + name)
    if any(_more_pages(t.get('comments'), 'hasNextPage') for t in pr['reviewThreads']['nodes']):
        fail.append('pagination_incomplete:thread_comments')
    if any(_more_pages(r.get('comments'), 'hasNextPage') for r in pr['reviews']['nodes']):
        fail.append('pagination_incomplete:review_comments')
    runs = checks.get('check_runs') or []
    if checks.get('total_count') != len(runs):
        fail.append('pagination_incomplete:check_runs')
    return fail


def _checks(checks, head):
    """Judge only the most recent run per required name; an older success never masks a newer run."""
    fail = []
    for name in REQUIRED_CHECKS:
        runs = [r for r in checks.get('check_runs') or [] if r.get('name') == name and r.get('head_sha') == head]
        if not runs:
            fail.append('check_not_success:' + name)
            continue
        latest = max(runs, key=lambda r: r.get('id') or 0)
        if latest.get('status') != 'completed' or latest.get('conclusion') is None:
            fail.append('check_not_success:' + name)
        elif latest.get('conclusion') != 'success':
            fail.append('check_failed:' + name)
    return fail


def evaluate(pr, checks, head, head_again, bot=BOT):
    """Return (receipt_kind, fail_codes) for a GraphQL pullRequest dict and a REST check-runs page."""
    fail = []
    if head != head_again:
        fail.append('head_changed_during_check')
    if pr.get('state') != 'OPEN':
        fail.append('not_open')
    if pr.get('baseRefName') != 'main':
        fail.append('base_not_main')
    merge_state = pr.get('mergeStateStatus')
    if merge_state in ('BEHIND', 'DIRTY', 'UNKNOWN'):
        fail.append('merge_state_' + merge_state.lower())
    fail += _pagination(pr, checks)

    summaries = [c for c in pr['comments']['nodes']
                 if (c.get('author') or {}).get('login') == bot
                 and 'codex-pull-request-review-summary' in (c.get('body') or '')]
    state = None
    if summaries:
        match = re.search(r'codex-review-state:v1 (\{.*?\}\}) -->', summaries[-1]['body'])
        if match:
            try:
                state = json.loads(match.group(1))
            except ValueError:
                state = None
    if not isinstance(state, dict):
        state = None
        fail.append('summary_missing_or_malformed')
    code = (state or {}).get('code_review') or {}
    security = (state or {}).get('security_review') or {}
    if state is not None:
        if code.get('commit_sha') != head:
            fail.append('summary_stale_head')
        if code.get('status') != 'completed':
            fail.append('summary_status_' + str(code.get('status')))
        if code.get('has_unresolved_findings') is not False:
            fail.append('summary_unresolved_findings_' + str(code.get('has_unresolved_findings')))
        if security:
            if security.get('status') != 'completed':
                fail.append('security_status_' + str(security.get('status')))
            if security.get('has_unresolved_findings') is True:
                fail.append('security_unresolved_findings')
            if security.get('commit_sha') != head:
                fail.append('security_stale_head')

    threads = pr['reviewThreads']['nodes']
    resolved_ids = {c['id'] for t in threads if t.get('isResolved') for c in t['comments']['nodes']}
    unresolved = sum(1 for t in threads if not t.get('isResolved'))
    if unresolved:
        fail.append('unresolved_threads_%d' % unresolved)

    receipts = [r for r in pr['reviews']['nodes']
                if (r.get('author') or {}).get('login') == bot
                and 'codex-review-receipt:v1' in (r.get('body') or '')
                and (r.get('commit') or {}).get('oid') == head]
    receipt_kind = None
    if receipts:
        open_ids = [c['id'] for r in receipts for c in r['comments']['nodes'] if c['id'] not in resolved_ids]
        if open_ids:
            fail.append('receipt_has_open_findings_%d' % len(open_ids))
        else:
            receipt_kind = 'review_all_resolved'
    else:
        times = re.findall(r'datetime="([0-9T:.\-]+)Z?"', summaries[-1]['body']) if summaries else []
        latest = max(times)[:19] if times else None
        ups = [x['createdAt'][:19] for x in pr['reactions']['nodes']
               if (x.get('user') or {}).get('login') in BOT_REACTION_LOGINS]
        if code.get('has_any_findings') is not False:
            fail.append('clean_receipt_requires_no_findings')
        elif security and security.get('status') != 'completed':
            fail.append('clean_receipt_security_not_completed')
        elif not latest:
            fail.append('clean_receipt_no_completion_time')
        elif not any(up >= latest for up in ups):
            fail.append('clean_receipt_thumbs_up_missing_after_completion')
        else:
            receipt_kind = 'thumbs_up_after_completion'

    fail += _checks(checks, head)
    return receipt_kind, fail


def status_for(fail):
    """Map failure codes to a commit status (state, description <= 140 chars)."""
    if not fail:
        return 'success', 'Codex review evidence complete for this head'
    waiting = all(code.startswith(WAITING_PREFIXES) for code in fail)
    description = ','.join(fail)
    if len(description) > 140:
        description = description[:137] + '...'
    return ('pending' if waiting else 'failure'), description


class HeadMoved(Exception):
    """The PR head changed between reads; the judged head must not receive success."""


def _evidence(pr):
    """Everything the decision reads from a PR snapshot, except the lazily computed merge state."""
    return json.dumps({k: v for k, v in pr.items() if k != 'mergeStateStatus'}, sort_keys=True)


def _publish(client, head, state, description):
    """Write the status only when it differs from the current one (GitHub keeps at most 1000
    statuses per SHA and context). If the current status cannot be read, write anyway."""
    try:
        current = client.current_status(head)
    except Exception:  # noqa: BLE001 - unknown current status means write
        current = None
    if current == (state, description):
        return False
    client.post_status(head, state, description)
    return True


def run_one(client, number, thumbs_retries=0, sleep=time.sleep):
    """Judge one PR and publish its status. Any error after the head is known ends with `failure`.

    The decision uses the LAST full PR read; if the evidence changed between the first and the
    last read, the result is held (pending, evidence_changed_during_check). The status is written
    once per change, never twice for the same result.

    Limit: the head comes from a minimal REST lookup. If that lookup (or the status write) fails,
    no status can be written, so an earlier success on that head cannot be cleared here; the
    exception propagates and the next event or scheduled run judges again.
    """
    head = client.head_sha(number)
    kind = None
    try:
        first = client.pull_request(number)
        if first['headRefOid'] != head:
            raise HeadMoved()
        for attempt in range(thumbs_retries + 1):
            if first.get('mergeStateStatus') == 'UNKNOWN':
                # GitHub computes the merge state lazily; the first read is often UNKNOWN. Re-read once.
                sleep(5)
                first = client.pull_request(number)
            chk = client.checks(head)
            last = client.pull_request(number)
            kind, fail = evaluate(last, chk, head, last['headRefOid'])
            if _evidence(first) != _evidence(last) and 'evidence_changed_during_check' not in fail:
                kind = None
                fail.append('evidence_changed_during_check')
            # The bot reacts +1 shortly after editing its summary; wait briefly for that one signal only.
            if fail != ['clean_receipt_thumbs_up_missing_after_completion'] or attempt == thumbs_retries:
                break
            sleep(30)
            first = client.pull_request(number)
        state, description = status_for(fail)
        # Re-read the head right before writing so a success never lands on a head we did not judge.
        if state == 'success' and client.head_sha(number) != head:
            raise HeadMoved()
    except HeadMoved:
        kind, fail = None, ['head_changed_during_check']
        state, description = 'pending', 'head_changed_during_check'
    except Exception as error:  # noqa: BLE001 - any error must end in a non-success status
        kind, fail = None, ['gate_error:' + type(error).__name__]
        state, description = 'failure', 'gate_error:' + type(error).__name__
    written = _publish(client, head, state, description)
    return {'pr': number, 'head': head, 'receipt': kind, 'state': state, 'fail': fail, 'written': written}


QUERY = '''query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){
 state baseRefName headRefOid mergeStateStatus
 comments(last:100){pageInfo{hasPreviousPage hasNextPage} nodes{author{login} body}}
 reviews(last:100){pageInfo{hasPreviousPage hasNextPage} nodes{author{login} body commit{oid}
  comments(first:100){pageInfo{hasPreviousPage hasNextPage} nodes{id}}}}
 reviewThreads(first:100){pageInfo{hasPreviousPage hasNextPage} nodes{isResolved
  comments(first:100){pageInfo{hasPreviousPage hasNextPage} nodes{id}}}}
 reactions(content:THUMBS_UP,last:100){pageInfo{hasPreviousPage hasNextPage} nodes{user{login} createdAt}}
}}}'''


class GitHubClient:
    """Thin GitHub REST/GraphQL client using the workflow token (standard library only)."""
    def __init__(self, api, repo, token, target_url):
        self.api, self.repo, self.token, self.target_url = api, repo, token, target_url

    def _call(self, method, url, payload=None):
        data = None if payload is None else json.dumps(payload).encode('utf-8')
        request = urllib.request.Request(url, data=data, method=method, headers={
            'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'codex-gate'})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode('utf-8') or 'null')

    def head_sha(self, number):
        """Minimal REST read of the PR head, used to mark the head pending before judging."""
        return self._call('GET', '%s/repos/%s/pulls/%d' % (self.api, self.repo, number))['head']['sha']

    def pull_request(self, number):
        owner, name = self.repo.split('/', 1)
        body = self._call('POST', self.api + '/graphql',
                          {'query': QUERY, 'variables': {'o': owner, 'n': name, 'p': number}})
        if body.get('errors'):
            raise RuntimeError('graphql_errors')
        return body['data']['repository']['pullRequest']

    def checks(self, head):
        runs = self._call('GET', '%s/repos/%s/commits/%s/check-runs?per_page=100&filter=all' % (self.api, self.repo, head))
        return {'total_count': runs.get('total_count'),
                'check_runs': [{'id': r.get('id'), 'name': r.get('name'), 'status': r.get('status'),
                                'conclusion': r.get('conclusion'), 'head_sha': r.get('head_sha')}
                               for r in runs.get('check_runs') or []]}

    def post_status(self, head, state, description):
        self._call('POST', '%s/repos/%s/statuses/%s' % (self.api, self.repo, head),
                   {'state': state, 'context': CONTEXT, 'description': description, 'target_url': self.target_url})

    def current_status(self, head):
        """Latest `codex-gate` status on the head as (state, description), or None."""
        statuses = self._call('GET', '%s/repos/%s/commits/%s/statuses?per_page=100' % (self.api, self.repo, head))
        for status in statuses or []:  # newest first
            if status.get('context') == CONTEXT:
                return status.get('state'), status.get('description')
        return None

    def open_pull_requests(self):
        """Every open PR to main, all pages."""
        numbers, page = [], 1
        while True:
            batch = self._call('GET', '%s/repos/%s/pulls?state=open&base=main&per_page=100&page=%d' % (self.api, self.repo, page))
            numbers += [p['number'] for p in batch or []]
            if len(batch or []) < 100:
                return numbers
            page += 1


def main(argv):
    repo = os.environ['GITHUB_REPOSITORY']
    target = '%s/%s/actions/runs/%s' % (os.environ.get('GITHUB_SERVER_URL', 'https://github.com'), repo,
                                        os.environ.get('GITHUB_RUN_ID', ''))
    client = GitHubClient(os.environ.get('GITHUB_API_URL', 'https://api.github.com'), repo,
                          os.environ['GITHUB_TOKEN'], target)
    if argv[1:2] == ['--list-targets']:
        # Targets for the per-PR matrix: the event's PR numbers, or every open PR to main.
        numbers = [int(x) for x in argv[2:] if x.strip()] or client.open_pull_requests()
        print(json.dumps(sorted(set(numbers))))
        return 0
    numbers = [int(x) for x in argv[1:] if x.strip()] or client.open_pull_requests()
    retries = int(os.environ.get('CODEX_GATE_THUMBS_RETRIES', '0'))
    for number in numbers:
        print(json.dumps(run_one(client, number, retries)))
    # A non-success status is the gate's result, not a job error; the job fails only on exceptions.
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))

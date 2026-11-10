"""codex-gate: per-head Codex review evidence as a commit status (issue #46).

Fail-closed. A PR head gets `codex-gate` = success only when ALL of these hold for the
current full head SHA (read twice; it must not change while judging):
  1. The latest summary comment by the Codex bot carries `codex-review-state:v1` with
     code_review.commit_sha == head, status == completed, has_unresolved_findings == false.
     A security_review, when present, is completed, for the same head, with no unresolved finding.
  2. Receipt for the head: either a `codex-review-receipt:v1` review by the bot on the head whose
     inline comments are all in resolved threads, or (clean review, no receipt) the summary says
     there were no findings at all and the bot reacted +1 on the PR at/after the latest completion
     time shown in that summary (observed bot contract, 2026-11-10).
  3. No unresolved review thread on the PR.
  4. Both required checks, test (macos-latest) and test (windows-latest), concluded success on head.
  5. PR is open, based on main, and not BEHIND / DIRTY / UNKNOWN.
Running, missing, stale, malformed or contradictory data is never a pass.

The decision logic (`evaluate`, `status_for`) is pure and unit tested in ci/test_codex_gate.py.
`main` reads GitHub with the workflow token and writes one commit status per PR head.
It never checks out or runs pull-request code and never prints secrets.
"""
import json
import os
import re
import sys
import time
import urllib.request

BOT = 'chatgpt-codex-connector'          # GraphQL login of the bot's comments and reviews
BOT_REACTION_LOGINS = (BOT, BOT + '[bot]')  # GraphQL reaction user login carries the [bot] suffix
REQUIRED_CHECKS = ('test (macos-latest)', 'test (windows-latest)')
CONTEXT = 'codex-gate'
# Failure codes that only mean "evidence for this head is not there yet".
WAITING_PREFIXES = ('summary_missing_or_malformed', 'summary_stale_head', 'summary_status_',
                    'security_status_', 'security_stale_head', 'clean_receipt_thumbs_up_missing',
                    'clean_receipt_no_completion_time', 'check_not_success:', 'merge_state_behind',
                    'merge_state_unknown', 'head_changed_during_check')


def evaluate(pr, checks, head, head_again, bot=BOT):
    """Return (receipt_kind, fail_codes) for a GraphQL pullRequest dict and check-run list."""
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
        if security.get('status') not in (None, 'completed'):
            fail.append('security_status_' + str(security.get('status')))
        if security.get('has_unresolved_findings') is True:
            fail.append('security_unresolved_findings')
        if security.get('commit_sha') not in (None, head):
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

    passed = {c.get('name') for c in checks if c.get('conclusion') == 'success' and c.get('head_sha') == head}
    for name in REQUIRED_CHECKS:
        if name not in passed:
            fail.append('check_not_success:' + name)
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


QUERY = '''query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){
 state baseRefName headRefOid mergeStateStatus
 comments(last:100){nodes{author{login} body}}
 reviews(last:100){nodes{author{login} body commit{oid} comments(first:100){nodes{id}}}}
 reviewThreads(first:100){nodes{isResolved comments(first:100){nodes{id}}}}
 reactions(content:THUMBS_UP,last:50){nodes{user{login} createdAt}}
}}}'''


def _api(method, url, token, payload=None):
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    request = urllib.request.Request(url, data=data, method=method, headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'codex-gate'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode('utf-8') or 'null')


def _pull_request(api, repo, number, token):
    owner, name = repo.split('/', 1)
    body = _api('POST', api + '/graphql', token, {'query': QUERY, 'variables': {'o': owner, 'n': name, 'p': number}})
    if body.get('errors'):
        raise RuntimeError('graphql_errors')
    return body['data']['repository']['pullRequest']


def _checks(api, repo, head, token):
    runs = _api('GET', '%s/repos/%s/commits/%s/check-runs?per_page=100' % (api, repo, head), token)
    return [{'name': r['name'], 'conclusion': r['conclusion'], 'head_sha': r['head_sha']}
            for r in runs.get('check_runs', []) if r.get('name') in REQUIRED_CHECKS]


def judge(api, repo, number, token):
    pr = _pull_request(api, repo, number, token)
    if pr.get('mergeStateStatus') == 'UNKNOWN':
        # GitHub computes the merge state lazily; the first read is often UNKNOWN. Re-read once.
        time.sleep(5)
        pr = _pull_request(api, repo, number, token)
    head = pr['headRefOid']
    checks = _checks(api, repo, head, token)
    head_again = _pull_request(api, repo, number, token)['headRefOid']
    kind, fail = evaluate(pr, checks, head, head_again)
    return head, kind, fail


def post_status(api, repo, head, token, state, description, target_url):
    _api('POST', '%s/repos/%s/statuses/%s' % (api, repo, head), token,
         {'state': state, 'context': CONTEXT, 'description': description, 'target_url': target_url})


def main(argv):
    token = os.environ['GITHUB_TOKEN']
    repo = os.environ['GITHUB_REPOSITORY']
    api = os.environ.get('GITHUB_API_URL', 'https://api.github.com')
    target = '%s/%s/actions/runs/%s' % (os.environ.get('GITHUB_SERVER_URL', 'https://github.com'), repo,
                                        os.environ.get('GITHUB_RUN_ID', ''))
    numbers = [int(x) for x in argv[1:] if x.strip()]
    if not numbers:
        open_prs = _api('GET', '%s/repos/%s/pulls?state=open&base=main&per_page=100' % (api, repo), token)
        numbers = [p['number'] for p in open_prs]
    # The bot reacts +1 shortly after editing its summary; wait briefly for that one signal only.
    attempts = int(os.environ.get('CODEX_GATE_THUMBS_RETRIES', '0'))
    for number in numbers:
        for attempt in range(attempts + 1):
            head, kind, fail = judge(api, repo, number, token)
            if fail != ['clean_receipt_thumbs_up_missing_after_completion'] or attempt == attempts:
                break
            time.sleep(30)
        state, description = status_for(fail)
        # Re-read the head right before writing so a status never lands on a head we did not judge.
        if _pull_request(api, repo, number, token)['headRefOid'] != head:
            state, description = 'pending', 'head_changed_during_check'
        post_status(api, repo, head, token, state, description, target)
        print(json.dumps({'pr': number, 'head': head, 'receipt': kind, 'state': state, 'fail': fail}))
    # A non-success status is the gate's result, not a job error; the job fails only on exceptions.
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))

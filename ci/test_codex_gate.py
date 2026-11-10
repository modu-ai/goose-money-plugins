"""Unit tests for ci/codex_gate.py (issue #46). Synthetic data only; no network.

The fixtures copy the shape of a real clean Codex review observed on PR #39 (2026-11-10):
the summary comment carries `codex-review-state:v1`, a clean review leaves no receipt review,
and the bot reacts with +1 on the PR once both reviews complete. GraphQL names the comment
author `chatgpt-codex-connector` but the reaction user `chatgpt-codex-connector[bot]`.
Run: python ci/test_codex_gate.py
"""
import copy
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import codex_gate as gate  # noqa: E402

HEAD = 'a' * 40
OLD = 'b' * 40
BOT = 'chatgpt-codex-connector'


def summary_body(head=HEAD, code_status='completed', any_findings=False, unresolved=False,
                 sec_status='completed', sec_unresolved=None, sec_head=None,
                 code_time='2026-11-10T01:33:54.626496Z', sec_time='2026-11-10T01:35:44.337986Z'):
    state = {'code_review': {'commit_sha': head, 'has_any_findings': any_findings,
                             'has_unresolved_findings': unresolved, 'status': code_status},
             'security_review': {'commit_sha': sec_head or head, 'has_any_findings': None,
                                 'has_unresolved_findings': sec_unresolved, 'status': sec_status}}
    return ('<!-- codex-pull-request-review-summary -->\n'
            '<!-- codex-review-state:v1 ' + json.dumps(state, separators=(',', ':')) + ' -->\n'
            '| Code Review | Completed <relative-time datetime="' + code_time + '">x</relative-time> |\n'
            '| Security Review | Completed <relative-time datetime="' + sec_time + '">x</relative-time> |\n')


def conn(nodes, prev=False, nxt=False):
    """A GraphQL connection with complete pagination by default."""
    return {'pageInfo': {'hasPreviousPage': prev, 'hasNextPage': nxt}, 'nodes': nodes}


def clean_pr():
    """A PR whose current head has a clean Codex review (no findings, bot +1 after completion)."""
    return {
        'state': 'OPEN', 'baseRefName': 'main', 'headRefOid': HEAD, 'mergeStateStatus': 'BLOCKED',
        'comments': conn([{'author': {'login': BOT}, 'body': summary_body()}]),
        'reviews': conn([]),
        'reviewThreads': conn([]),
        'reactions': conn([{'user': {'login': BOT + '[bot]'}, 'createdAt': '2026-11-10T01:35:48Z'}]),
    }


def thread(ids, resolved):
    return {'isResolved': resolved, 'comments': conn([{'id': i} for i in ids])}


def check_run(run_id, name, conclusion='success', status='completed', head=HEAD):
    return {'id': run_id, 'name': name, 'status': status, 'conclusion': conclusion, 'head_sha': head}


def checks(head=HEAD, mac='success', win='success', extra=()):
    runs = [check_run(10, 'test (macos-latest)', mac, 'completed' if mac else 'in_progress', head),
            check_run(11, 'test (windows-latest)', win, 'completed' if win else 'in_progress', head)]
    runs += list(extra)
    return {'total_count': len(runs), 'check_runs': runs}


def run(pr, chk=None, head_again=HEAD):
    return gate.evaluate(pr, checks() if chk is None else chk, HEAD, head_again)


class CleanReview(unittest.TestCase):
    def test_clean_review_with_bot_thumbs_up_passes(self):
        kind, fail = run(clean_pr())
        self.assertEqual(fail, [])
        self.assertEqual(kind, 'thumbs_up_after_completion')

    def test_reaction_login_with_bot_suffix_and_comment_login_without_it(self):
        # Observed GraphQL forms: comment author has no [bot] suffix, reaction user has it.
        pr = clean_pr()
        self.assertEqual(pr['comments']['nodes'][0]['author']['login'], BOT)
        self.assertEqual(pr['reactions']['nodes'][0]['user']['login'], BOT + '[bot]')
        self.assertEqual(run(pr)[1], [])
        pr['reactions']['nodes'][0]['user']['login'] = BOT  # the bare form is also the bot
        self.assertEqual(run(pr)[1], [])

    def test_thumbs_up_from_someone_else_does_not_count(self):
        pr = clean_pr()
        pr['reactions']['nodes'][0]['user']['login'] = 'GoosLab'
        self.assertIn('clean_receipt_thumbs_up_missing_after_completion', run(pr)[1])

    def test_thumbs_up_older_than_latest_completion_does_not_count(self):
        pr = clean_pr()
        pr['reactions']['nodes'][0]['createdAt'] = '2026-11-10T01:35:40Z'  # before security completion 01:35:44
        self.assertIn('clean_receipt_thumbs_up_missing_after_completion', run(pr)[1])

    def test_clean_path_requires_no_findings_at_all(self):
        pr = clean_pr()
        pr['comments']['nodes'][0]['body'] = summary_body(any_findings=True)
        self.assertIn('clean_receipt_requires_no_findings', run(pr)[1])

    def test_summary_without_completion_time_fails(self):
        pr = clean_pr()
        pr['comments']['nodes'][0]['body'] = summary_body().split('| Code Review')[0]
        self.assertIn('clean_receipt_no_completion_time', run(pr)[1])


class Summary(unittest.TestCase):
    def test_missing_summary(self):
        pr = clean_pr()
        pr['comments'] = conn([])
        self.assertIn('summary_missing_or_malformed', run(pr)[1])

    def test_malformed_state_json(self):
        pr = clean_pr()
        pr['comments']['nodes'][0]['body'] = '<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 {"code_review":{nope}} -->'
        self.assertIn('summary_missing_or_malformed', run(pr)[1])

    def test_summary_by_a_human_is_ignored(self):
        pr = clean_pr()
        pr['comments']['nodes'][0]['author']['login'] = 'GoosLab'
        self.assertIn('summary_missing_or_malformed', run(pr)[1])

    def test_summary_by_a_lookalike_login_is_ignored(self):
        pr = clean_pr()
        pr['comments']['nodes'][0]['author']['login'] = BOT + '-fake'
        self.assertIn('summary_missing_or_malformed', run(pr)[1])

    def test_latest_summary_wins(self):
        pr = clean_pr()
        pr['comments']['nodes'].append({'author': {'login': BOT}, 'body': summary_body(code_status='running')})
        self.assertIn('summary_status_running', run(pr)[1])

    def test_stale_head(self):
        pr = clean_pr()
        pr['comments']['nodes'][0]['body'] = summary_body(head=OLD)
        self.assertIn('summary_stale_head', run(pr)[1])

    def test_running_and_failed_status(self):
        for status in ('running', 'failed'):
            pr = clean_pr()
            pr['comments']['nodes'][0]['body'] = summary_body(code_status=status)
            self.assertIn('summary_status_' + status, run(pr)[1])

    def test_unresolved_findings_true_or_null(self):
        for value in (True, None):
            pr = clean_pr()
            pr['comments']['nodes'][0]['body'] = summary_body(unresolved=value)
            self.assertIn('summary_unresolved_findings_' + str(value), run(pr)[1])

    def test_security_review_not_completed_or_unresolved_or_stale(self):
        pr = clean_pr()
        pr['comments']['nodes'][0]['body'] = summary_body(sec_status='running')
        self.assertIn('security_status_running', run(pr)[1])
        pr = clean_pr()
        pr['comments']['nodes'][0]['body'] = summary_body(sec_unresolved=True)
        self.assertIn('security_unresolved_findings', run(pr)[1])
        pr = clean_pr()
        pr['comments']['nodes'][0]['body'] = summary_body(sec_head=OLD)
        self.assertIn('security_stale_head', run(pr)[1])


class Receipt(unittest.TestCase):
    def pr_with_receipt(self, oid=HEAD, comment_ids=('c1',), resolved=True):
        pr = clean_pr()
        pr['comments']['nodes'][0]['body'] = summary_body(any_findings=True, unresolved=False)
        pr['reactions'] = conn([])
        pr['reviews'] = conn([{'author': {'login': BOT}, 'body': 'x <!-- codex-review-receipt:v1 --> y',
                               'commit': {'oid': oid}, 'comments': conn([{'id': i} for i in comment_ids])}])
        pr['reviewThreads'] = conn([thread([i], resolved) for i in comment_ids])
        return pr

    def test_receipt_with_all_findings_resolved_passes(self):
        kind, fail = run(self.pr_with_receipt())
        self.assertEqual(fail, [])
        self.assertEqual(kind, 'review_all_resolved')

    def test_receipt_with_open_finding_fails(self):
        fail = run(self.pr_with_receipt(resolved=False))[1]
        self.assertIn('receipt_has_open_findings_1', fail)
        self.assertIn('unresolved_threads_1', fail)

    def test_receipt_for_another_head_does_not_count(self):
        fail = run(self.pr_with_receipt(oid=OLD))[1]
        self.assertIn('clean_receipt_requires_no_findings', fail)

    def test_receipt_by_a_human_does_not_count(self):
        pr = self.pr_with_receipt()
        pr['reviews']['nodes'][0]['author']['login'] = 'GoosLab'
        self.assertIn('clean_receipt_requires_no_findings', run(pr)[1])


class PullRequestState(unittest.TestCase):
    def test_unresolved_thread_fails(self):
        pr = clean_pr()
        pr['reviewThreads'] = conn([thread(['h1'], False)])
        self.assertIn('unresolved_threads_1', run(pr)[1])

    def test_not_open_and_wrong_base(self):
        pr = clean_pr()
        pr['state'] = 'MERGED'
        pr['baseRefName'] = 'develop'
        fail = run(pr)[1]
        self.assertIn('not_open', fail)
        self.assertIn('base_not_main', fail)

    def test_behind_dirty_unknown(self):
        for state in ('BEHIND', 'DIRTY', 'UNKNOWN'):
            pr = clean_pr()
            pr['mergeStateStatus'] = state
            self.assertIn('merge_state_' + state.lower(), run(pr)[1])

    def test_head_changed_during_check(self):
        self.assertIn('head_changed_during_check', run(clean_pr(), head_again=OLD)[1])


class RequiredChecks(unittest.TestCase):
    def test_failed_pending_or_other_head(self):
        # A finished failure is a definite failure (check_failed); not-yet-finished stays check_not_success.
        self.assertIn('check_failed:test (windows-latest)', run(clean_pr(), checks(win='failure'))[1])
        self.assertIn('check_not_success:test (macos-latest)', run(clean_pr(), checks(mac=None))[1])
        self.assertIn('check_not_success:test (macos-latest)', run(clean_pr(), checks(head=OLD))[1])
        self.assertIn('check_not_success:test (macos-latest)', run(clean_pr(), {'total_count': 0, 'check_runs': []})[1])


class StatusMapping(unittest.TestCase):
    def test_pass_is_success(self):
        self.assertEqual(gate.status_for([])[0], 'success')

    def test_waiting_only_is_pending(self):
        self.assertEqual(gate.status_for(['summary_status_running', 'check_not_success:test (macos-latest)'])[0], 'pending')

    def test_any_definite_problem_is_failure(self):
        self.assertEqual(gate.status_for(['summary_status_running', 'unresolved_threads_1'])[0], 'failure')

    def test_description_fits_status_api_limit(self):
        state, description = gate.status_for(['check_not_success:test (windows-latest)'] * 20)
        self.assertLessEqual(len(description), 140)


class Integrity(unittest.TestCase):
    def test_evaluate_does_not_mutate_input(self):
        pr = clean_pr()
        before = copy.deepcopy(pr)
        run(pr)
        self.assertEqual(pr, before)


class DefaultBranchOnly(unittest.TestCase):
    """Item 1: every trigger runs the default-branch workflow and judging code only."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.github', 'workflows', 'codex-gate.yml')

    def text(self):
        with open(self.path, encoding='utf-8') as handle:
            return handle.read()

    def triggers(self):
        lines = self.text().split('\n')
        start = lines.index('on:') + 1
        names = []
        for line in lines[start:]:
            if line and not line.startswith(' '):
                break
            if line.startswith('  ') and not line.startswith('   ') and line.strip().endswith(':'):
                names.append(line.strip()[:-1])
        return names

    def test_triggers_are_default_branch_events_without_manual_dispatch(self):
        self.assertEqual(sorted(self.triggers()), ['issue_comment', 'pull_request_target', 'schedule', 'workflow_run'])

    def test_job_runs_only_on_the_default_branch_ref(self):
        self.assertIn("github.ref == 'refs/heads/main'", self.text())

    def test_checkout_pins_main_and_never_the_pr_head(self):
        text = self.text()
        checkouts = text.count('uses: actions/checkout@')
        self.assertGreater(checkouts, 0)
        self.assertEqual(text.count('ref: main'), checkouts)
        for forbidden in ('github.event.pull_request.head', 'github.head_ref', 'refs/pull/'):
            self.assertNotIn(forbidden, text)


class Pagination(unittest.TestCase):
    """Item 2: an unread page is never a pass."""
    def test_hundred_resolved_threads_with_a_next_page_fail(self):
        pr = clean_pr()
        pr['reviewThreads'] = conn([thread(['t%d' % i], True) for i in range(100)], nxt=True)
        self.assertIn('pagination_incomplete:reviewThreads', run(pr)[1])

    def test_every_connection_is_checked(self):
        cases = [('comments', 'prev'), ('reviews', 'prev'), ('reactions', 'prev'), ('reviewThreads', 'nxt')]
        for name, side in cases:
            pr = clean_pr()
            pr[name] = conn(pr[name]['nodes'], **{side: True})
            self.assertIn('pagination_incomplete:' + name, run(pr)[1], name)

    def test_nested_thread_and_review_comments_are_checked(self):
        pr = clean_pr()
        nested = thread(['x'], True)
        nested['comments']['pageInfo']['hasNextPage'] = True
        pr['reviewThreads'] = conn([nested])
        self.assertIn('pagination_incomplete:thread_comments', run(pr)[1])
        pr = clean_pr()
        pr['reviews'] = conn([{'author': {'login': 'GoosLab'}, 'body': '', 'commit': {'oid': HEAD},
                               'comments': conn([{'id': 'r'}], nxt=True)}])
        self.assertIn('pagination_incomplete:review_comments', run(pr)[1])

    def test_missing_page_info_fails_closed(self):
        pr = clean_pr()
        del pr['reviewThreads']['pageInfo']
        self.assertIn('pagination_incomplete:reviewThreads', run(pr)[1])

    def test_check_runs_beyond_the_first_page_fail(self):
        chk = checks()
        chk['total_count'] = 101
        self.assertIn('pagination_incomplete:check_runs', run(clean_pr(), chk)[1])


class LatestCheckRunOnly(unittest.TestCase):
    """Item 3: only the most recent run per required name counts."""
    def test_older_success_and_newer_failure_fail(self):
        chk = checks(extra=[check_run(20, 'test (windows-latest)', 'failure')])
        self.assertIn('check_failed:test (windows-latest)', run(clean_pr(), chk)[1])

    def test_older_success_and_newer_running_fail(self):
        chk = checks(extra=[check_run(20, 'test (windows-latest)', None, 'in_progress')])
        self.assertIn('check_not_success:test (windows-latest)', run(clean_pr(), chk)[1])

    def test_older_failure_and_newer_success_pass(self):
        chk = checks(win='success')
        chk['check_runs'].append(check_run(5, 'test (windows-latest)', 'failure'))
        chk['total_count'] += 1
        self.assertEqual(run(clean_pr(), chk)[1], [])

    def test_latest_failure_is_a_definite_failure_status(self):
        self.assertEqual(gate.status_for(['check_failed:test (windows-latest)'])[0], 'failure')


class FakeClient:
    """Synthetic GitHub client. `reads` is an optional list of PR snapshots returned in order by
    pull_request (the last one repeats); `on_checks` runs inside checks() to model evidence that
    changes while the gate is judging. post_status enforces GitHub's 1000 statuses per SHA+context."""
    STATUS_LIMIT = 1000

    def __init__(self, pr=None, chk=None, error_on=None, rest_head=HEAD, posted=None, reads=None, on_checks=None):
        self.pr, self.chk, self.error_on, self.rest_head = pr, chk, error_on, rest_head
        self.posted = [] if posted is None else posted
        self.reads = list(reads or [])
        self.on_checks = on_checks
        self.graphql_reads = 0

    def head_sha(self, number):
        if self.error_on == 'head':
            raise OSError('synthetic REST head lookup error')
        return self.rest_head

    def pull_request(self, number):
        if self.error_on == 'pull_request':
            raise OSError('synthetic api timeout')
        self.graphql_reads += 1
        if self.reads:
            return copy.deepcopy(self.reads.pop(0) if len(self.reads) > 1 else self.reads[0])
        return copy.deepcopy(self.pr)

    def checks(self, head):
        if self.error_on == 'checks':
            raise OSError('synthetic api error')
        if self.on_checks:
            self.on_checks(self)
        return copy.deepcopy(self.chk)

    def current_status(self, head):
        if self.error_on == 'current_status':
            raise OSError('synthetic status read error')
        mine = [p for p in self.posted if p[0] == head]
        return (mine[-1][1], mine[-1][2]) if mine else None

    def post_status(self, head, state, description):
        if sum(1 for p in self.posted if p[0] == head) >= self.STATUS_LIMIT:
            raise OSError('synthetic 422: status limit reached for this SHA and context')
        self.posted.append((head, state, description))


class ErrorsNeverLeaveSuccess(unittest.TestCase):
    """Item 4: an API error or exception ends with a non-success status on the judged head."""
    def test_pass_posts_a_single_success(self):
        client = FakeClient(clean_pr(), checks())
        gate.run_one(client, 46)
        self.assertEqual([p[1] for p in client.posted], ['success'])

    def test_check_api_error_overwrites_success_with_failure(self):
        client = FakeClient(clean_pr(), checks(), error_on='checks', posted=[(HEAD, 'success', 'old')])
        gate.run_one(client, 46)
        self.assertEqual(client.posted[-1][:2], (HEAD, 'failure'))
        self.assertIn('gate_error', client.posted[-1][2])

    def test_last_status_is_never_success_after_an_error(self):
        client = FakeClient(clean_pr(), checks(), error_on='checks')
        gate.run_one(client, 46)
        self.assertNotEqual(client.posted[-1][1], 'success')


class InitialReadErrors(unittest.TestCase):
    """Leader repro (2026-11-10): a first GraphQL read error must not leave an earlier success."""
    def test_first_graphql_read_error_overwrites_an_existing_success(self):
        client = FakeClient(clean_pr(), checks(), error_on='pull_request',
                            posted=[(HEAD, 'success', 'existing success')])
        gate.run_one(client, 46)
        self.assertEqual(client.posted[-1][:2], (HEAD, 'failure'))
        self.assertIn('gate_error', client.posted[-1][2])

    def test_graphql_head_differs_from_rest_head_is_not_success(self):
        client = FakeClient(clean_pr(), checks(), rest_head=OLD)
        gate.run_one(client, 46)
        self.assertEqual({p[0] for p in client.posted}, {OLD})
        self.assertNotEqual(client.posted[-1][1], 'success')

    def test_head_lookup_error_writes_nothing_and_raises(self):
        # Limit: without the head SHA no status can be written, so an older success cannot be cleared.
        client = FakeClient(clean_pr(), checks(), error_on='head')
        with self.assertRaises(OSError):
            gate.run_one(client, 46)
        self.assertEqual(client.posted, [])


class EvidenceRace(unittest.TestCase):
    """Codex P1 (PR #54, ci/codex_gate.py:203) and leader repro: evidence read last must decide."""
    def running_pr(self):
        pr = clean_pr()
        pr['comments']['nodes'][0]['body'] = summary_body(code_status='running')
        return pr

    def test_second_read_with_running_review_is_not_success(self):
        client = FakeClient(chk=checks(), reads=[clean_pr(), self.running_pr()])
        result = gate.run_one(client, 54)
        self.assertNotEqual(result['state'], 'success')
        self.assertNotEqual(client.posted[-1][1], 'success')

    def test_leader_repro_newer_failure_is_not_overwritten_by_success(self):
        def flip(client):
            client.pr['comments']['nodes'][0]['body'] = summary_body(code_status='running')
            client.posted.append((HEAD, 'failure', 'newer evaluation sees running review'))
        client = FakeClient(clean_pr(), checks(), on_checks=flip)
        gate.run_one(client, 54)
        self.assertNotEqual(client.posted[-1][1], 'success')

    def test_evidence_changed_between_reads_is_reported(self):
        client = FakeClient(chk=checks(), reads=[clean_pr(), self.running_pr()])
        result = gate.run_one(client, 54)
        self.assertTrue(any(code in result['fail'] for code in ('evidence_changed_during_check', 'summary_status_running')))


class NoRedundantStatusWrites(unittest.TestCase):
    """Codex P1 (PR #54, ci/codex_gate.py:190): GitHub keeps at most 1000 statuses per SHA+context."""
    def test_unchanged_result_is_not_written_again(self):
        client = FakeClient(clean_pr(), checks())
        for _ in range(5):
            gate.run_one(client, 46)
        self.assertEqual(len(client.posted), 1)

    def test_many_unchanged_judgements_then_a_change_is_still_written(self):
        client = FakeClient(clean_pr(), checks())
        for _ in range(600):
            gate.run_one(client, 46)
        client.pr['comments']['nodes'][0]['body'] = summary_body(code_status='running')
        gate.run_one(client, 46)
        self.assertEqual(client.posted[-1][1], 'pending')
        self.assertLessEqual(len(client.posted), 2)

    def test_unknown_current_status_still_writes(self):
        client = FakeClient(clean_pr(), checks(), error_on='current_status')
        gate.run_one(client, 46)
        self.assertEqual([p[1] for p in client.posted], ['success'])


class OpenPullRequestPages(unittest.TestCase):
    """Codex P2 (PR #54, ci/codex_gate.py:271): scheduled runs must see every open PR."""
    def test_all_pages_are_read(self):
        pages = {1: [{'number': n} for n in range(1, 101)], 2: [{'number': 101}], 3: []}
        seen = []

        class Paged(gate.GitHubClient):
            def _call(self, method, url, payload=None):
                page = int(url.rsplit('page=', 1)[1])
                seen.append(page)
                return pages[page]

        client = Paged('https://api.invalid', 'o/r', 'synthetic-not-a-token', 'https://x.invalid')
        self.assertEqual(client.open_pull_requests(), list(range(1, 102)))
        self.assertEqual(seen[:2], [1, 2])


class OnePrOneQueue(unittest.TestCase):
    """Judgements of the same PR from different triggers never run at the same time."""
    path = DefaultBranchOnly.path

    def text(self):
        with open(self.path, encoding='utf-8') as handle:
            return handle.read()

    def test_no_workflow_level_group_keyed_by_event_name(self):
        self.assertNotIn('github.event_name }}', self.text().split('jobs:')[0])

    def test_judging_job_is_grouped_per_pr_number_for_every_trigger(self):
        jobs = self.text().split('jobs:', 1)[1]
        self.assertIn('group: codex-gate-pr-${{ matrix.pr }}', jobs)
        self.assertIn('fromJSON(needs.targets.outputs.prs)', jobs)
        self.assertIn('cancel-in-progress: false', jobs)


class SecurityReviewCurrentHead(unittest.TestCase):
    """Item 5: a present security review must be for the current head (PR #33 observation)."""
    def test_security_review_for_previous_head_fails(self):
        pr = clean_pr()
        pr['comments']['nodes'][0]['body'] = summary_body(sec_head=OLD)
        self.assertIn('security_stale_head', run(pr)[1])

    def test_security_review_without_commit_sha_fails(self):
        pr = clean_pr()
        body = summary_body().replace('"security_review":{"commit_sha":"' + HEAD + '",', '"security_review":{')
        pr['comments']['nodes'][0]['body'] = body
        self.assertIn('security_stale_head', run(pr)[1])


class ObservedLoginForms(unittest.TestCase):
    """Item 6: GraphQL login forms observed on PR #39."""
    def test_comment_author_must_be_the_bare_bot_login(self):
        pr = clean_pr()
        pr['comments']['nodes'][0]['author']['login'] = BOT + '[bot]'
        self.assertIn('summary_missing_or_malformed', run(pr)[1])

    def test_reaction_user_carries_the_bot_suffix(self):
        self.assertEqual(run(clean_pr())[1], [])

if __name__ == '__main__':
    unittest.main(verbosity=1)

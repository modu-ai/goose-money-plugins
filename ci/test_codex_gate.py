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


def clean_pr():
    """A PR whose current head has a clean Codex review (no findings, bot +1 after completion)."""
    return {
        'state': 'OPEN', 'baseRefName': 'main', 'headRefOid': HEAD, 'mergeStateStatus': 'BLOCKED',
        'comments': {'nodes': [{'author': {'login': BOT}, 'body': summary_body()}]},
        'reviews': {'nodes': []},
        'reviewThreads': {'nodes': []},
        'reactions': {'nodes': [{'user': {'login': BOT + '[bot]'}, 'createdAt': '2026-11-10T01:35:48Z'}]},
    }


def checks(head=HEAD, mac='success', win='success'):
    return [{'name': 'test (macos-latest)', 'conclusion': mac, 'head_sha': head},
            {'name': 'test (windows-latest)', 'conclusion': win, 'head_sha': head}]


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
        pr['comments']['nodes'] = []
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
        pr['reactions']['nodes'] = []
        pr['reviews']['nodes'] = [{'author': {'login': BOT}, 'body': 'x <!-- codex-review-receipt:v1 --> y',
                                   'commit': {'oid': oid}, 'comments': {'nodes': [{'id': i} for i in comment_ids]}}]
        pr['reviewThreads']['nodes'] = [{'isResolved': resolved, 'comments': {'nodes': [{'id': i}]}} for i in comment_ids]
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
        pr['reviewThreads']['nodes'] = [{'isResolved': False, 'comments': {'nodes': [{'id': 'h1'}]}}]
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
        self.assertIn('check_not_success:test (windows-latest)', run(clean_pr(), checks(win='failure'))[1])
        self.assertIn('check_not_success:test (macos-latest)', run(clean_pr(), checks(mac=None))[1])
        self.assertIn('check_not_success:test (macos-latest)', run(clean_pr(), checks(head=OLD))[1])
        self.assertIn('check_not_success:test (macos-latest)', run(clean_pr(), [])[1])


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


if __name__ == '__main__':
    unittest.main(verbosity=1)

import test from 'node:test'; import assert from 'node:assert/strict';
import { createRunnerState, step, type RunnerConfig, type RunnerState } from '../src/durable-job-runner.js';
import type { BudgetSpent } from '../src/durable-job.js';
// Runner-loop judgment (Refs #106, design docs/design/durable-job-and-stock-link.md §2.2·§4·§5·§6, Refs #29).
// Pure decision logic: no sleeps, no timers, no AbortSignal wiring, no network/file/DB/process access —
// waits, worker aborts, write-effect queries and resumption are commands handed back to the caller.
// Retry counts and waits (J-01) and budget values (J-02) are injected configuration, never invented;
// the piece-1 state machine (apply/checkBudget) and piece-2 classification (classifyRetry) hold those
// contracts and this loop only composes them.
const P: RunnerConfig = { retry_policy: { transient: { max_retries: 2, backoff_base_ms: 100 } } };
const plan = (...ids: string[]) => ids.map((id) => ({ id }));
const run = (s: RunnerState, ob: unknown, spent?: BudgetSpent) => step(s, P, ob, spent);

const started = (...ids: string[]) =>
  step(createRunnerState(plan(...ids)), P, { kind: 'start', permission_recheck: 'passed' }).state;
const startedWf = () =>
  step(createRunnerState([{ id: 'publish', has_write_effect: true }]), P, { kind: 'start', permission_recheck: 'passed' }).state;
const nodeOf = (s: RunnerState, id: string) => {
  const n = s.nodes.find((x) => x.id === id);
  assert.ok(n, `node ${id} missing`);
  return n;
};

test('start folds the piece-1 start event and schedules the first pending node', () => {
  const r = step(createRunnerState(plan('a', 'b')), P, { kind: 'start', permission_recheck: 'passed' });
  assert.equal(r.state.job.state, 'running');
  assert.deepEqual(r.commands, [{ cmd: 'start_node', node: 'a' }]);
  assert.equal(r.state.in_flight, 'a');
  assert.equal(nodeOf(r.state, 'a').status, 'in_flight');
  assert.equal(nodeOf(r.state, 'b').status, 'pending');
});

test('a failed permission recheck blocks the job before any node starts (§2.2 row 2)', () => {
  const r = step(createRunnerState(plan('a')), P, { kind: 'start', permission_recheck: 'failed' });
  assert.equal(r.state.job.state, 'blocked');
  assert.equal(r.state.job.blocked_reason, 'permission_revoked');
  assert.deepEqual(r.commands, []);
  assert.equal(r.state.in_flight, undefined);
});

test('node success advances to the next node; the last success schedules nothing — review decides completion', () => {
  let s = started('a', 'b');
  let r = run(s, { kind: 'node_succeeded', node: 'a', result_hash: 'h1' });
  assert.deepEqual(r.commands, [{ cmd: 'start_node', node: 'b' }]);
  assert.deepEqual(r.state.job.node_result_hashes, ['h1']);
  r = run(r.state, { kind: 'node_succeeded', node: 'b', result_hash: 'h2' });
  assert.deepEqual(r.commands, []);
  assert.equal(r.state.job.state, 'running');
  r = run(r.state, { kind: 'review_passed' });
  assert.equal(r.state.job.state, 'completed');
});

test('review_passed before every node succeeded is refused (§2.2 "모든 노드 완료 + 검수 통과")', () => {
  const s = run(started('a', 'b'), { kind: 'node_succeeded', node: 'a', result_hash: 'h1' }).state;
  assert.throws(() => run(s, { kind: 'review_passed' }), /error_code=invalid_observation/);
});

test('T6 (loop level): 401/403 blocks the job with the verdict reason — zero retry commands', () => {
  for (const status of [401, 403] as const) {
    const r = run(started('a', 'b'), { kind: 'node_failed', node: 'a', error: { kind: 'auth_permission', status } });
    assert.equal(r.state.job.state, 'blocked');
    assert.equal(r.state.job.blocked_reason, 'provider_auth_or_permission');
    assert.deepEqual(r.commands, []);
    assert.equal(nodeOf(r.state, 'a').status, 'pending');
    assert.equal(r.state.in_flight, undefined);
  }
});

test('schema mismatch fails the job with the classification failure code', () => {
  const r = run(started('a'), { kind: 'node_failed', node: 'a', error: { kind: 'schema_mismatch' } });
  assert.equal(r.state.job.state, 'failed');
  assert.equal(r.state.job.failure_code, 'schema_mismatch');
  assert.equal(nodeOf(r.state, 'a').status, 'failed');
});

test('T5 (loop level): transient failures retry with injected exponential waits, then stop at the limit — no infinite loop', () => {
  let s = started('a');
  let r = run(s, { kind: 'node_failed', node: 'a', error: { kind: 'timeout' } });
  assert.deepEqual(r.commands, [{ cmd: 'retry_node_after', node: 'a', wait_ms: 100 }]);
  r = run(r.state, { kind: 'node_failed', node: 'a', error: { kind: 'timeout' } });
  assert.deepEqual(r.commands, [{ cmd: 'retry_node_after', node: 'a', wait_ms: 200 }]);
  r = run(r.state, { kind: 'node_failed', node: 'a', error: { kind: 'timeout' } });
  assert.deepEqual(r.commands, []);
  assert.equal(r.state.job.state, 'failed');
  assert.equal(r.state.job.failure_code, 'transient_retry_limit_reached');
  // A fourth failure cannot produce another retry: the job is terminal and the fold refuses it.
  assert.throws(() => run(r.state, { kind: 'node_failed', node: 'a', error: { kind: 'timeout' } }), /error_code=/);
});

test('an unset policy means zero retries — the observed error stands at loop level too (J-01)', () => {
  const r = step(started('a'), { retry_policy: {} }, { kind: 'node_failed', node: 'a', error: { kind: 'network_transient' } });
  assert.equal(r.state.job.state, 'failed');
  assert.equal(r.state.job.failure_code, 'network_transient');
  assert.deepEqual(r.commands, []);
});

test('429 retries exactly once after the provider-given wait, then fails (§5 design-fixed)', () => {
  let s = started('a');
  let r = run(s, { kind: 'node_failed', node: 'a', error: { kind: 'rate_limited', retry_after_ms: 30_000 } });
  assert.deepEqual(r.commands, [{ cmd: 'retry_node_after', node: 'a', wait_ms: 30_000 }]);
  r = run(r.state, { kind: 'node_failed', node: 'a', error: { kind: 'rate_limited', retry_after_ms: 30_000 } });
  assert.equal(r.state.job.state, 'failed');
  assert.equal(r.state.job.failure_code, 'rate_limited');
});

test('a write-effect step queries its effect before any re-send (§5 last row)', () => {
  const r = run(startedWf(), { kind: 'node_failed', node: 'publish', error: { kind: 'network_transient' } });
  assert.equal(r.state.job.state, 'running');
  assert.deepEqual(r.commands, [{ cmd: 'query_write_effect', node: 'publish' }]);
});

test('a present effect resolves the node from the queried hash — the step is never re-sent', () => {
  let s = startedWf();
  s = run(s, { kind: 'node_failed', node: 'publish', error: { kind: 'timeout' } }).state;
  const r = run(s, { kind: 'effect_observed', node: 'publish', check: { checked: true, effect_present: true }, result_hash: 'hfx' });
  assert.equal(nodeOf(r.state, 'publish').status, 'succeeded');
  assert.deepEqual(r.state.job.node_result_hashes, ['hfx']);
  assert.deepEqual(r.commands, []);
  assert.equal(r.state.in_flight, undefined);
});

test('an absent effect lets the injected-policy retry through after the query', () => {
  let s = startedWf();
  s = run(s, { kind: 'node_failed', node: 'publish', error: { kind: 'timeout' } }).state;
  const r = run(s, { kind: 'effect_observed', node: 'publish', check: { checked: true, effect_present: false } });
  assert.deepEqual(r.commands, [{ cmd: 'retry_node_after', node: 'publish', wait_ms: 100 }]);
  assert.equal(r.state.job.state, 'running');
});

test('an undeterminable effect (query failed) never re-sends blind — the standing error fails the node', () => {
  let s = startedWf();
  s = run(s, { kind: 'node_failed', node: 'publish', error: { kind: 'timeout' } }).state;
  const r = run(s, { kind: 'effect_observed', node: 'publish', check: { checked: false } });
  assert.equal(r.state.job.state, 'failed');
  assert.equal(r.state.job.failure_code, 'timeout');
  assert.deepEqual(r.commands, []);
});

test('out of retries, a write-effect step still resolves a present effect instead of failing (§5 last row)', () => {
  const p1: RunnerConfig = { retry_policy: { transient: { max_retries: 1, backoff_base_ms: 100 } } };
  let s = step(createRunnerState([{ id: 'publish', has_write_effect: true }]), p1, { kind: 'start', permission_recheck: 'passed' }).state;
  s = step(s, p1, { kind: 'node_failed', node: 'publish', error: { kind: 'timeout' } }).state;                     // → query
  s = step(s, p1, { kind: 'effect_observed', node: 'publish', check: { checked: true, effect_present: false } }).state; // → retry 1
  s = step(s, p1, { kind: 'node_failed', node: 'publish', error: { kind: 'timeout' } }).state;                     // out of budget → query again
  const r = step(s, p1, { kind: 'effect_observed', node: 'publish', check: { checked: true, effect_present: true }, result_hash: 'h2' });
  assert.equal(nodeOf(r.state, 'publish').status, 'succeeded');
  assert.equal(r.state.job.state, 'running'); // awaiting review — not failed
});

test('T3 (loop level): cancel commands an abort of the in-flight worker and starts no new node', () => {
  const r = run(started('a', 'b'), { kind: 'cancel_requested' });
  assert.equal(r.state.job.state, 'cancelling');
  assert.deepEqual(r.commands, [{ cmd: 'abort_worker', node: 'a' }]);
  const done = run(r.state, { kind: 'worker_end_observed' });
  assert.equal(done.state.job.state, 'cancelled');
  assert.deepEqual(done.commands, []);
});

test('T3b (loop level): a cancel timeout keeps cancelling with cancel_unconfirmed — only the observed worker end cancels', () => {
  let s = started('a');
  s = run(s, { kind: 'cancel_requested' }).state;
  const t = run(s, { kind: 'cancel_timeout_reached' });
  assert.equal(t.state.job.state, 'cancelling');
  assert.equal(t.state.job.cancel_unconfirmed, true);
  assert.notEqual(t.state.job.state, 'cancelled');
  const done = run(t.state, { kind: 'worker_end_observed' });
  assert.equal(done.state.job.state, 'cancelled');
});

test('T4 (loop level): late results after a cancel are discarded record-only — nothing restarts', () => {
  let s = started('a', 'b');
  s = run(s, { kind: 'cancel_requested' }).state;
  let r = run(s, { kind: 'node_succeeded', node: 'a', result_hash: 'late' });
  assert.equal(r.state.job.state, 'cancelling');
  assert.equal(r.state.job.discarded_late_results, 1);
  assert.deepEqual(r.state.job.node_result_hashes, []);
  assert.deepEqual(r.commands, []);
  r = run(r.state, { kind: 'node_succeeded', node: 'a', result_hash: 'late2' });
  assert.equal(r.state.job.discarded_late_results, 2);
});

test('a late node error during a cancel folds nothing and retries nothing — the cancel flow owns the outcome', () => {
  let s = started('a');
  s = run(s, { kind: 'cancel_requested' }).state;
  const r = run(s, { kind: 'node_failed', node: 'a', error: { kind: 'timeout' } });
  assert.equal(r.state.job.state, 'cancelling');
  assert.deepEqual(r.commands, []);
});

test('T9 (loop level): budget exhaustion before the next start lands partial when a node finished', () => {
  const cfg: RunnerConfig = { retry_policy: P.retry_policy, budget: { max_provider_calls: 1 } };
  const s = step(createRunnerState(plan('a', 'b')), cfg, { kind: 'start', permission_recheck: 'passed' }, { elapsed_ms: 0, provider_calls: 0 }).state;
  const r = step(s, cfg, { kind: 'node_succeeded', node: 'a', result_hash: 'h1' }, { elapsed_ms: 10, provider_calls: 1 });
  assert.equal(r.state.job.state, 'partial');
  assert.equal(r.state.job.budget_exhausted, true);
  assert.equal(r.state.job.budget_outcome, 'partial');
  assert.deepEqual(r.commands, []); // b is never started
});

test('T9 (loop level): budget exhaustion with zero finished nodes fails', () => {
  const cfg: RunnerConfig = { retry_policy: P.retry_policy, budget: { max_elapsed_ms: 100 } };
  const r = step(createRunnerState(plan('a')), cfg, { kind: 'start', permission_recheck: 'passed' }, { elapsed_ms: 100, provider_calls: 0 });
  assert.equal(r.state.job.state, 'failed');
  assert.equal(r.state.job.budget_exhausted, true);
  assert.equal(r.state.job.budget_outcome, 'failed');
});

test('a retry is a provider call too — the budget gate stops it the same way (T9)', () => {
  const cfg: RunnerConfig = { retry_policy: { transient: { max_retries: 2, backoff_base_ms: 100 } }, budget: { max_provider_calls: 1 } };
  const s = step(createRunnerState(plan('a')), cfg, { kind: 'start', permission_recheck: 'passed' }, { elapsed_ms: 0, provider_calls: 0 }).state;
  const r = step(s, cfg, { kind: 'node_failed', node: 'a', error: { kind: 'timeout' } }, { elapsed_ms: 5, provider_calls: 1 });
  assert.equal(r.state.job.state, 'failed');
  assert.equal(r.state.job.budget_outcome, 'failed');
  assert.deepEqual(r.commands, []);
});

test('a configured budget without spent counters cannot be verified — invalid_input, never a guess', () => {
  const cfg: RunnerConfig = { retry_policy: P.retry_policy, budget: { max_provider_calls: 5 } };
  assert.throws(() => step(createRunnerState(plan('a')), cfg, { kind: 'start', permission_recheck: 'passed' }), /error_code=invalid_input/);
});

test('an unexhausted budget lets the start through; with no budget configured spent is not required', () => {
  const cfg: RunnerConfig = { retry_policy: P.retry_policy, budget: { max_provider_calls: 5 } };
  const r = step(createRunnerState(plan('a')), cfg, { kind: 'start', permission_recheck: 'passed' }, { elapsed_ms: 0, provider_calls: 2 });
  assert.deepEqual(r.commands, [{ cmd: 'start_node', node: 'a' }]);
  const bare = step(createRunnerState(plan('a')), P, { kind: 'start', permission_recheck: 'passed' });
  assert.deepEqual(bare.commands, [{ cmd: 'start_node', node: 'a' }]);
});

test('node outcomes for a node that is not in flight, or unknown, are refused', () => {
  const s = started('a', 'b');
  assert.throws(() => run(s, { kind: 'node_succeeded', node: 'b', result_hash: 'h' }), /error_code=invalid_observation/);
  assert.throws(() => run(s, { kind: 'node_failed', node: 'nope', error: { kind: 'timeout' } }), /error_code=invalid_observation/);
  const idle = run(s, { kind: 'node_succeeded', node: 'a', result_hash: 'h1' }).state; // b scheduled, a resolved
  assert.throws(() => run(idle, { kind: 'node_succeeded', node: 'a', result_hash: 'h' }), /error_code=invalid_observation/);
});

test('a failure observed with the effect already present still resolves through the effect hash — no re-send', () => {
  const r = run(startedWf(), { kind: 'node_failed', node: 'publish', error: { kind: 'timeout' }, effect_check: { checked: true, effect_present: true } });
  assert.deepEqual(r.commands, [{ cmd: 'query_write_effect', node: 'publish' }]); // hash fetch (a read), never a re-send
  const done = run(r.state, { kind: 'effect_observed', node: 'publish', check: { checked: true, effect_present: true }, result_hash: 'hq' });
  assert.equal(nodeOf(done.state, 'publish').status, 'succeeded');
  assert.deepEqual(done.state.job.node_result_hashes, ['hq']);
});

test('cancel during a pending effect query folds to cancelling and re-sends nothing', () => {
  let s = startedWf();
  s = run(s, { kind: 'node_failed', node: 'publish', error: { kind: 'timeout' } }).state;
  const r = run(s, { kind: 'cancel_requested' });
  assert.equal(r.state.job.state, 'cancelling');
  assert.deepEqual(r.commands, [{ cmd: 'abort_worker', node: 'publish' }]);
  const done = run(r.state, { kind: 'effect_observed', node: 'publish', check: { checked: true, effect_present: false } });
  assert.equal(done.state.job.state, 'cancelling'); // the answer is moot; the cancel flow owns it
  assert.deepEqual(done.commands, []);
});

test('an effect observation without a pending effect query is refused', () => {
  assert.throws(() => run(startedWf(), { kind: 'effect_observed', node: 'publish', check: { checked: true, effect_present: false } }), /error_code=invalid_observation/);
});

test('a present effect without a result hash cannot resolve the node — no invented hash', () => {
  let s = startedWf();
  s = run(s, { kind: 'node_failed', node: 'publish', error: { kind: 'timeout' } }).state;
  assert.throws(() => run(s, { kind: 'effect_observed', node: 'publish', check: { checked: true, effect_present: true } }), /error_code=invalid_observation/);
});

test('while an effect query is pending, another node failure is refused — answer the query first', () => {
  let s = startedWf();
  s = run(s, { kind: 'node_failed', node: 'publish', error: { kind: 'timeout' } }).state;
  assert.throws(() => run(s, { kind: 'node_failed', node: 'publish', error: { kind: 'timeout' } }), /error_code=invalid_observation/);
});

test('a late success while an effect query pends resolves the node and clears the query — the next node is not blocked (codex P2)', () => {
  let s = createRunnerState([{ id: 'publish', has_write_effect: true }, { id: 'after' }]);
  s = step(s, P, { kind: 'start', permission_recheck: 'passed' }).state;
  s = step(s, P, { kind: 'node_failed', node: 'publish', error: { kind: 'timeout' } }).state; // query pends
  const r = step(s, P, { kind: 'node_succeeded', node: 'publish', result_hash: 'hlate' });
  assert.equal(nodeOf(r.state, 'publish').status, 'succeeded');
  assert.deepEqual(r.commands, [{ cmd: 'start_node', node: 'after' }]);
  // The stale query answer is a protocol break, not a fold.
  assert.throws(() => step(r.state, P, { kind: 'effect_observed', node: 'publish', check: { checked: true, effect_present: false } }), /error_code=invalid_observation/);
  // And the next node's failure applies its own retry policy instead of effect_query_pending.
  const f = step(r.state, P, { kind: 'node_failed', node: 'after', error: { kind: 'timeout' } });
  assert.deepEqual(f.commands, [{ cmd: 'retry_node_after', node: 'after', wait_ms: 100 }]);
});

test('a prescribed retry whose wait lands past the elapsed budget is gated now — no out-of-budget authorization (codex P2)', () => {
  const cfg: RunnerConfig = { retry_policy: { transient: { max_retries: 2, backoff_base_ms: 1000 } }, budget: { max_elapsed_ms: 1000 } };
  let s = createRunnerState(plan('a'));
  s = step(s, cfg, { kind: 'start', permission_recheck: 'passed' }, { elapsed_ms: 0, provider_calls: 0 }).state;
  const r = step(s, cfg, { kind: 'node_failed', node: 'a', error: { kind: 'timeout' } }, { elapsed_ms: 900, provider_calls: 1 });
  assert.equal(r.state.job.state, 'failed'); // earliest dispatch 900+1000=1900 ≥ 1000 — gated before the wait
  assert.equal(r.state.job.budget_exhausted, true);
  assert.deepEqual(r.commands, []);
});

test('a retry whose wait still lands inside the elapsed budget is authorized (codex P2 boundary)', () => {
  const cfg: RunnerConfig = { retry_policy: { transient: { max_retries: 2, backoff_base_ms: 1000 } }, budget: { max_elapsed_ms: 2000 } };
  let s = createRunnerState(plan('a'));
  s = step(s, cfg, { kind: 'start', permission_recheck: 'passed' }, { elapsed_ms: 0, provider_calls: 0 }).state;
  const r = step(s, cfg, { kind: 'node_failed', node: 'a', error: { kind: 'timeout' } }, { elapsed_ms: 900, provider_calls: 1 });
  assert.deepEqual(r.commands, [{ cmd: 'retry_node_after', node: 'a', wait_ms: 1000 }]); // 1900 < 2000
  assert.equal(r.state.job.state, 'running');
});

test('plans and observations are validated: duplicate ids, empty plans, junk kinds are invalid_input', () => {
  assert.throws(() => createRunnerState(plan('a', 'a')), /error_code=invalid_input/);
  assert.throws(() => createRunnerState([]), /error_code=invalid_input/);
  assert.throws(() => run(createRunnerState(plan('a')), { kind: 'nope' }), /error_code=invalid_input/);
  assert.throws(() => run(createRunnerState(plan('a')), { kind: 'node_succeeded', node: 'a', result_hash: '' }), /error_code=invalid_input/);
});

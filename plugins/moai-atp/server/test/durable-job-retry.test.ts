import test from 'node:test'; import assert from 'node:assert/strict';
import { classifyRetry } from '../src/durable-job-retry.js';
import { apply, createDurableJob, type JobRecord } from '../src/durable-job.js';
// Retry classification (Refs #106, design docs/design/durable-job-and-stock-link.md §5, Refs #29).
// Pure decision logic only: no executor loop, no sleeps, no network/file/DB/process access. Retry
// counts and backoff (J-01) are injected configuration — an unset policy means zero transient
// retries, never an invented count. The 429 single-retry-after-provider-wait rule is design-fixed,
// not configurable. Error kinds and write-effect check results are caller observations passed as
// arguments (same pattern as the piece-1 permission recheck).
const T = { transient: { max_retries: 3, backoff_base_ms: 100 } };
const zero = { transient: 0, rate_limited: 0 };
const running = (): JobRecord => apply(createDurableJob(), { event: 'start', permission_recheck: 'passed' });

test('T6: 401/403 never retries — the node lands blocked (§5 "재시도 안 함 → blocked")', () => {
  for (const status of [401, 403] as const) {
    assert.deepEqual(classifyRetry({ error: { kind: 'auth_permission', status }, policy: T, counters: zero }),
      { action: 'blocked', reason: 'provider_auth_or_permission' });
  }
});

test('T6 composes with the piece-1 state machine: running → blocked carrying the verdict reason', () => {
  const v = classifyRetry({ error: { kind: 'auth_permission', status: 401 }, policy: T, counters: zero });
  assert.ok(v.action === 'blocked');
  const b = apply(running(), { event: 'blocked', reason: v.reason });
  assert.equal(b.state, 'blocked');
  assert.equal(b.blocked_reason, 'provider_auth_or_permission');
});

test('schema mismatch never retries — the node lands failed (§5 "재시도 안 함 → failed")', () => {
  const v = classifyRetry({ error: { kind: 'schema_mismatch' }, policy: T, counters: zero });
  assert.deepEqual(v, { action: 'failed', failure_code: 'schema_mismatch' });
  assert.ok(v.action === 'failed');
  const f = apply(running(), { event: 'fail', failure_code: v.failure_code });
  assert.equal(f.state, 'failed');
  assert.equal(f.failure_code, 'schema_mismatch');
});

test('transient errors and timeouts retry with exponential waits under the injected policy (§5, J-01 injected)', () => {
  assert.deepEqual(classifyRetry({ error: { kind: 'network_transient' }, policy: T, counters: { transient: 0, rate_limited: 0 } }),
    { action: 'retry', class: 'transient', wait_ms: 100, attempt: 1 });
  assert.deepEqual(classifyRetry({ error: { kind: 'network_transient' }, policy: T, counters: { transient: 1, rate_limited: 0 } }),
    { action: 'retry', class: 'transient', wait_ms: 200, attempt: 2 });
  assert.deepEqual(classifyRetry({ error: { kind: 'timeout' }, policy: T, counters: { transient: 2, rate_limited: 0 } }),
    { action: 'retry', class: 'transient', wait_ms: 400, attempt: 3 });
});

test('T5 (decision level): reaching the injected limit stops retries — no verdict proposes a retry past max_retries', () => {
  const p = { transient: { max_retries: 2, backoff_base_ms: 100 } };
  const v = classifyRetry({ error: { kind: 'network_transient' }, policy: p, counters: { transient: 2, rate_limited: 0 } });
  assert.deepEqual(v, { action: 'failed', failure_code: 'transient_retry_limit_reached' });
  // An explicit zero policy is also a limit: zero retries, never a negative or invented one.
  assert.deepEqual(classifyRetry({ error: { kind: 'timeout' }, policy: { transient: { max_retries: 0, backoff_base_ms: 1 } }, counters: zero }),
    { action: 'failed', failure_code: 'transient_retry_limit_reached' });
});

test('an unset policy means zero transient retries — the observed error stands, nothing invented (J-01)', () => {
  assert.deepEqual(classifyRetry({ error: { kind: 'network_transient' }, policy: {}, counters: zero }),
    { action: 'failed', failure_code: 'network_transient' });
  assert.deepEqual(classifyRetry({ error: { kind: 'timeout' }, policy: {}, counters: zero }),
    { action: 'failed', failure_code: 'timeout' });
});

test('429 retries exactly once, after the provider-given wait — the design-fixed rule, no injection (§5)', () => {
  assert.deepEqual(classifyRetry({ error: { kind: 'rate_limited', retry_after_ms: 30_000 }, policy: {}, counters: zero }),
    { action: 'retry', class: 'rate_limited', wait_ms: 30_000, attempt: 1 });
  assert.deepEqual(classifyRetry({ error: { kind: 'rate_limited', retry_after_ms: 30_000 }, policy: {}, counters: { transient: 0, rate_limited: 1 } }),
    { action: 'failed', failure_code: 'rate_limited' });
});

test('429 without a provider-given wait cannot construct the design retry — no wait is invented', () => {
  assert.deepEqual(classifyRetry({ error: { kind: 'rate_limited' }, policy: {}, counters: zero }),
    { action: 'failed', failure_code: 'rate_limited' });
});

test('a write-effect step has its effect checked before any retry, whatever the error class (§5 last row)', () => {
  assert.deepEqual(classifyRetry({ error: { kind: 'network_transient' }, policy: T, counters: zero, has_write_effect: true, effect_check: { checked: false } }),
    { action: 'check_effect_first' });
  assert.deepEqual(classifyRetry({ error: { kind: 'network_transient' }, policy: T, counters: zero, has_write_effect: true }),
    { action: 'check_effect_first' });
  assert.deepEqual(classifyRetry({ error: { kind: 'rate_limited', retry_after_ms: 1_000 }, policy: {}, counters: zero, has_write_effect: true, effect_check: { checked: false } }),
    { action: 'check_effect_first' });
});

test('a landed write effect is never re-sent — the result resolves from the effect, not a retry', () => {
  assert.deepEqual(classifyRetry({ error: { kind: 'network_transient' }, policy: T, counters: zero, has_write_effect: true, effect_check: { checked: true, effect_present: true } }),
    { action: 'no_retry_effect_present' });
});

test('a checked-absent write effect lets the retry verdict through unchanged', () => {
  assert.deepEqual(classifyRetry({ error: { kind: 'network_transient' }, policy: T, counters: zero, has_write_effect: true, effect_check: { checked: true, effect_present: false } }),
    { action: 'retry', class: 'transient', wait_ms: 100, attempt: 1 });
});

test('non-retry verdicts pass the write-effect gate untouched — 401/schema re-send nothing anyway', () => {
  assert.deepEqual(classifyRetry({ error: { kind: 'auth_permission', status: 403 }, policy: T, counters: zero, has_write_effect: true, effect_check: { checked: false } }),
    { action: 'blocked', reason: 'provider_auth_or_permission' });
  assert.deepEqual(classifyRetry({ error: { kind: 'schema_mismatch' }, policy: T, counters: zero, has_write_effect: true, effect_check: { checked: false } }),
    { action: 'failed', failure_code: 'schema_mismatch' });
});

test('inputs are validated; junk kinds, negative counters and overflow policies are invalid_input', () => {
  assert.throws(() => classifyRetry({ error: { kind: 'nope' } as never, policy: T, counters: zero }), /error_code=invalid_input/);
  assert.throws(() => classifyRetry({ error: { kind: 'network_transient' }, policy: T, counters: { transient: -1, rate_limited: 0 } }), /error_code=invalid_input/);
  assert.throws(() => classifyRetry({ error: { kind: 'network_transient' }, policy: { transient: { max_retries: -1, backoff_base_ms: 100 } }, counters: zero }), /error_code=invalid_input/);
  assert.throws(() => classifyRetry({ error: { kind: 'network_transient' }, policy: { transient: { max_retries: 3, backoff_base_ms: 0 } }, counters: zero }), /error_code=invalid_input/);
  assert.throws(() => classifyRetry({ error: { kind: 'rate_limited', retry_after_ms: 0 }, policy: {}, counters: zero }), /error_code=invalid_input/);
  // 1000 * 2^80 overflows MAX_SAFE_INTEGER: the last wait must stay a representable integer.
  assert.throws(() => classifyRetry({ error: { kind: 'network_transient' }, policy: { transient: { max_retries: 80, backoff_base_ms: 1000 } }, counters: zero }), /error_code=invalid_input/);
  assert.throws(() => classifyRetry({ error: { kind: 'network_transient' }, policy: T, counters: zero, has_write_effect: true, effect_check: { checked: true } as never }), /error_code=invalid_input/);
});

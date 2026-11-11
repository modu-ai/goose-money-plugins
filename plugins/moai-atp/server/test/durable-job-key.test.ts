import test from 'node:test'; import assert from 'node:assert/strict';
import { computeJobKey } from '../src/durable-job-key.js';
import { canonicalJson, sha256Hex } from '../src/durable-job-repro.js';
// Job key (Refs #106, design docs/design/durable-job-and-stock-link.md §3) — pure computation of
// the deterministic key from the six materials, reusing the repro package's canonicalJson/sha256Hex.
// No exclusive creation, no persistence, no network/file/DB/process access: T1/T2 acceptance,
// J-03/J-04 retention and reuse, and the runner loop (PR #137 scope) all stay out of this module.

const base = () => ({
  principal: 'opaque-user-u123',
  request: { analysis: 'daily-brief', symbols: ['005930', '000660'], cutoff_at: '2026-11-11T00:00:00Z', options: { lang: 'ko', depth: 2 } },
  target_id: 'portfolio-77',
  cutoff_at: '2026-11-11T00:00:00Z',
  input_snapshot: { rows: [{ symbol: '005930', close: 71200 }], fetched_at: '2026-11-10T23:50:00Z' },
  code_version: 'build-9d96b93',
});

test('§3: the same six materials yield the same key on every call — a 64-hex sha256, no hidden state', () => {
  const first = computeJobKey(base());
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(computeJobKey(base()), first);
});

test('§3: key insertion order of the request object — top level, nested, and in the snapshot — never reaches the key', () => {
  const a = computeJobKey(base());
  const reorderedRequest = {
    ...base(),
    request: { options: { depth: 2, lang: 'ko' }, cutoff_at: '2026-11-11T00:00:00Z', symbols: ['005930', '000660'], analysis: 'daily-brief' },
  };
  assert.equal(computeJobKey(reorderedRequest), a);
  const reorderedSnapshot = {
    ...base(),
    input_snapshot: { fetched_at: '2026-11-10T23:50:00Z', rows: [{ close: 71200, symbol: '005930' }] },
  };
  assert.equal(computeJobKey(reorderedSnapshot), a);
});

test('array order is significant: the same symbols in a different order are a different request', () => {
  const a = computeJobKey(base());
  const swapped = { ...base(), request: { ...base().request, symbols: ['000660', '005930'] } };
  assert.notEqual(computeJobKey(swapped), a);
});

test('§3: changing any one of the six materials changes the key', () => {
  const a = computeJobKey(base());
  const variants: ReturnType<typeof base>[] = [
    { ...base(), principal: 'opaque-user-u999' },
    { ...base(), request: { ...base().request, analysis: 'deep-dive' } },
    { ...base(), target_id: 'portfolio-88' },
    { ...base(), cutoff_at: '2026-11-11T00:00:01Z' },
    { ...base(), input_snapshot: { rows: [{ symbol: '005930', close: 71500 }], fetched_at: '2026-11-10T23:50:00Z' } },
    { ...base(), code_version: 'build-abcdef0' },
  ];
  for (const v of variants) assert.notEqual(computeJobKey(v), a, JSON.stringify(v));
});

test('named material slots: the same two strings swapped between slots never collide', () => {
  const a = computeJobKey({ ...base(), principal: 'X', target_id: 'Y' });
  const swapped = computeJobKey({ ...base(), principal: 'Y', target_id: 'X' });
  assert.notEqual(a, swapped);
});

test('deterministic formula: the key is sha256 of the canonical six-field envelope — no time, no randomness, no call order', () => {
  const b = base();
  const material = {
    principal: b.principal,
    request_canonical: canonicalJson(b.request),
    target_id: b.target_id,
    cutoff_at: b.cutoff_at,
    input_data_snapshot_hash: sha256Hex(canonicalJson(b.input_snapshot)),
    code_version: b.code_version,
  };
  assert.equal(computeJobKey(b), sha256Hex(canonicalJson(material)));
});

test('materials are validated: missing, empty, wrong-typed and unknown fields are invalid_input', () => {
  assert.throws(() => computeJobKey({ ...base(), principal: '' }), /error_code=invalid_input/);
  assert.throws(() => computeJobKey({ ...base(), target_id: 7 } as never), /error_code=invalid_input/);
  assert.throws(() => computeJobKey({ ...base(), cutoff_at: undefined } as never), /error_code=invalid_input/);
  assert.throws(() => computeJobKey({ ...base(), code_version: '' }), /error_code=invalid_input/);
  assert.throws(() => computeJobKey({ ...base(), extra: true } as never), /error_code=invalid_input/);
});

test('non-JSON materials (Date, bigint, sparse arrays) are refused, never silently hashed', () => {
  assert.throws(() => computeJobKey({ ...base(), request: { ...base().request, at: new Date(0) } }), /error_code=invalid_input/);
  assert.throws(() => computeJobKey({ ...base(), input_snapshot: { prices: [1, , 3] } }), /error_code=invalid_input/);
});

test('an oversized canonical request is refused under the same bound as the repro package', () => {
  assert.throws(() => computeJobKey({ ...base(), request: { ...base().request, text: 'a'.repeat(65536) } }), /error_code=invalid_input/);
});

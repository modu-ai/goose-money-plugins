import test from 'node:test'; import assert from 'node:assert/strict';
import { buildReproPackage, canonicalJson, verifyReproPackage } from '../src/durable-job-repro.js';
// Reproduction package (Refs #106, design docs/design/durable-job-and-stock-link.md §7, Refs #29).
// Pure assembly/hashing logic only: no persistence, no network/file/DB/process access. The job key
// is an injected optional field (piece 1, §3, not built yet — never invented here); code version,
// receipt ids and receipt times are caller observations passed as arguments, the same pattern as
// the permission recheck of piece 1. Raw snapshots/results/reports enter as hashes only (정의서
// 395행: 비밀·계좌 원문은 넣지 않음) — the structural exclusion is what these tests pin down.

const request = { analysis: 'daily-brief', symbols: ['005930', '000660'], cutoff_at: '2026-11-11T00:00:00Z' };
const snapshot = { rows: [{ symbol: '005930', close: 71200 }], fetched_at: '2026-11-10T23:50:00Z' };
const nodeResults = [
  { node_id: 'fetch', result: { ok: true, count: 1 } },
  { node_id: 'analyze', result: { verdict: 'hold', score: 0.61 } },
];
const receipts = [
  { node_id: 'analyze', receipt_id: 'resp-9f2a', received_at: '2026-11-11T09:00:01Z' },
  { node_id: 'fetch', receipt_id: 'resp-1c88', received_at: '2026-11-11T08:59:58Z' },
];
const build = () => buildReproPackage({
  request, code_version: 'build-9d96b93', input_snapshot: snapshot,
  provider_receipts: receipts, node_results: nodeResults, final_report: { summary: 'hold' },
});

test('T10: re-running the same inputs reproduces every node result hash — verify ok', () => {
  const pkg = build();
  const v = verifyReproPackage(pkg, { input_snapshot: snapshot, node_results: nodeResults, final_report: { summary: 'hold' } });
  assert.deepEqual(v, { ok: true });
});

test('T10: one differing recomputed node is reported as that node hash mismatching', () => {
  const pkg = build();
  const recomputed = [
    { node_id: 'fetch', result: { ok: true, count: 1 } },
    { node_id: 'analyze', result: { verdict: 'buy', score: 0.61 } },
  ];
  const v = verifyReproPackage(pkg, { input_snapshot: snapshot, node_results: recomputed });
  assert.ok(!v.ok);
  assert.deepEqual(v.mismatches.filter((m) => m.startsWith('node_result_hashes:')), ['node_result_hashes:analyze']);
});

test('a different input snapshot mismatches on input_data_snapshot_hash', () => {
  const pkg = build();
  const v = verifyReproPackage(pkg, {
    input_snapshot: { rows: [{ symbol: '005930', close: 71500 }], fetched_at: '2026-11-10T23:50:00Z' },
    node_results: nodeResults,
  });
  assert.ok(!v.ok);
  assert.ok(v.mismatches.includes('input_data_snapshot_hash'));
});

test('one-sided node ids are named: missing (in package, not reproduced) and extra (reproduced, not in package)', () => {
  const pkg = build();
  const v = verifyReproPackage(pkg, { input_snapshot: snapshot, node_results: nodeResults.slice(0, 1) });
  assert.ok(!v.ok);
  assert.ok(v.mismatches.includes('node_result_missing:analyze'));
  const extra = verifyReproPackage(pkg, {
    input_snapshot: snapshot,
    node_results: [...nodeResults, { node_id: 'format', result: { md: '# x' } }],
  });
  assert.ok(!extra.ok);
  assert.ok(extra.mismatches.includes('node_result_extra:format'));
});

test('final report: hash mismatch, absent when expected, and present when unexpected are all mismatches', () => {
  const pkg = build();
  const wrong = verifyReproPackage(pkg, { input_snapshot: snapshot, node_results: nodeResults, final_report: { summary: 'sell' } });
  assert.ok(!wrong.ok && wrong.mismatches.includes('final_report_hash'));
  const absent = verifyReproPackage(pkg, { input_snapshot: snapshot, node_results: nodeResults });
  assert.ok(!absent.ok && absent.mismatches.includes('final_report_not_reproduced'));
  const noReport = buildReproPackage({ request, code_version: 'b1', input_snapshot: snapshot, provider_receipts: receipts, node_results: nodeResults });
  const unexpected = verifyReproPackage(noReport, { input_snapshot: snapshot, node_results: nodeResults, final_report: { summary: 'hold' } });
  assert.ok(!unexpected.ok && unexpected.mismatches.includes('final_report_extra'));
});

test('package_hash covers every recorded field — tampering any of them is detected', () => {
  const pkg = build();
  const tampered = [
    { ...pkg, code_version: 'build-deadbe' },
    { ...pkg, request_canonical: canonicalJson({ other: true }) },
    { ...pkg, job_key: 'injected-key' },
    { ...pkg, input_data_snapshot_hash: pkg.input_data_snapshot_hash.replace(/^./, 'f') },
    { ...pkg, provider_receipts: [{ ...receipts[0], receipt_id: 'resp-zzzz' }, receipts[1]] },
    { ...pkg, node_result_hashes: pkg.node_result_hashes.map((n) => (n.node_id === 'analyze' ? { ...n, result_hash: 'a'.repeat(64) } : n)) },
    { ...pkg, final_report_hash: 'b'.repeat(64) },
  ];
  for (const t of tampered) {
    const v = verifyReproPackage(t, { input_snapshot: snapshot, node_results: nodeResults, final_report: { summary: 'hold' } });
    assert.ok(!v.ok, `tamper not detected: ${JSON.stringify(t)}`);
    assert.ok(v.mismatches.includes('package_hash'), `package_hash not in ${JSON.stringify(v.mismatches)}`);
  }
});

test('deterministic build: key insertion order and list order of the caller do not change the package', () => {
  const a = buildReproPackage({
    request: { cutoff_at: '2026-11-11T00:00:00Z', symbols: ['005930', '000660'], analysis: 'daily-brief' },
    code_version: 'build-9d96b93',
    input_snapshot: { fetched_at: '2026-11-10T23:50:00Z', rows: [{ close: 71200, symbol: '005930' }] },
    provider_receipts: [...receipts].reverse(),
    node_results: [...nodeResults].reverse(),
    final_report: { summary: 'hold' },
  });
  assert.deepEqual(a, build());
});

test('the canonical request form is stored sorted and stable (§3 key material reuse)', () => {
  const pkg = build();
  assert.equal(pkg.request_canonical, canonicalJson(request));
  assert.ok(pkg.request_canonical.startsWith('{"analysis"'));
});

test('canonicalJson: object key order is irrelevant, array order is significant, nesting is handled', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  assert.notEqual(canonicalJson(['a', 'b', 'c']), canonicalJson(['c', 'b', 'a']));
  assert.equal(canonicalJson(null), 'null');
  assert.throws(() => canonicalJson(undefined), /error_code=invalid_input/);
  assert.throws(() => canonicalJson({ x: 1n }), /error_code=invalid_input/);
});

test('structural secret exclusion (정의서 395행): snapshot, node results and report appear as hashes only', () => {
  const secret = 'ACCOUNT-RAW-9f31';
  const pkg = buildReproPackage({
    request, code_version: 'b1',
    input_snapshot: { marker: secret },
    provider_receipts: receipts,
    node_results: [{ node_id: 'n1', result: { note: secret } }],
    final_report: { detail: secret },
  });
  const serialized = JSON.stringify(pkg);
  assert.ok(!serialized.includes(secret));
  assert.ok(serialized.includes('"input_data_snapshot_hash"'));
});

test('job_key stays optional and is carried verbatim when the caller injects one (piece 1 pending)', () => {
  const bare = buildReproPackage({ request, code_version: 'b1', input_snapshot: snapshot, provider_receipts: [], node_results: [] });
  assert.equal(bare.job_key, undefined);
  const keyed = buildReproPackage({ request, code_version: 'b1', input_snapshot: snapshot, provider_receipts: [], node_results: [], job_key: 'key-abc' });
  assert.equal(keyed.job_key, 'key-abc');
});

test('a malformed package is a verdict, not a crash; malformed observations are invalid_input', () => {
  const v = verifyReproPackage({ nonsense: true }, { input_snapshot: snapshot, node_results: nodeResults });
  assert.ok(!v.ok && v.mismatches.includes('invalid_package'));
  assert.throws(() => verifyReproPackage(build(), { input_snapshot: snapshot, node_results: [{ node_id: '' , result: 1 }] }), /error_code=invalid_input/);
});

test('builder inputs are validated: duplicate node ids and missing observations are invalid_input', () => {
  assert.throws(() => buildReproPackage({
    request, code_version: 'b1', input_snapshot: snapshot, provider_receipts: receipts,
    node_results: [
      { node_id: 'n', result: 1 },
      { node_id: 'n', result: 2 },
    ],
  }), /error_code=invalid_input/);
  assert.throws(() => buildReproPackage({ request, input_snapshot: snapshot, provider_receipts: [], node_results: [] } as never), /error_code=invalid_input/);
  assert.throws(() => buildReproPackage({
    request, code_version: 'b1', input_snapshot: snapshot,
    provider_receipts: [{ node_id: 'n', receipt_id: '', received_at: 'x' }], node_results: [],
  }), /error_code=invalid_input/);
});

test('codex P2: non-plain objects (Date etc.) are rejected, never silently hashed as {} (hash faithfulness)', () => {
  assert.throws(() => canonicalJson({ price_at: new Date('2026-11-10T00:00:00Z') }), /error_code=invalid_input/);
  assert.throws(() => buildReproPackage({
    request, code_version: 'b1', input_snapshot: { at: new Date(0) }, provider_receipts: [], node_results: [],
  }), /error_code=invalid_input/);
});

test('codex P2: an oversized canonical request is rejected at build time — what builds stays verifiable', () => {
  assert.throws(() => buildReproPackage({
    request: { text: 'a'.repeat(65536) }, code_version: 'b1', input_snapshot: {}, provider_receipts: [], node_results: [],
  }), /error_code=invalid_input/);
});

test('codex P2: receipts sharing node_id and receipt_id order by received_at — caller order cannot change the package', () => {
  const build = (first: string, second: string) => buildReproPackage({
    request, code_version: 'b1', input_snapshot: snapshot,
    provider_receipts: [
      { node_id: 'n', receipt_id: 'r1', received_at: first },
      { node_id: 'n', receipt_id: 'r1', received_at: second },
    ],
    node_results: [],
  });
  const a = build('2026-11-11T09:00:01Z', '2026-11-11T09:00:02Z');
  const b = build('2026-11-11T09:00:02Z', '2026-11-11T09:00:01Z');
  assert.equal(a.package_hash, b.package_hash);
  assert.deepEqual(a.provider_receipts, b.provider_receipts);
});

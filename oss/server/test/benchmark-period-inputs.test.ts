import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  BENCHMARK_PERIOD_ERROR_CODES, BENCHMARK_PERIOD_LIMITS, BenchmarkPeriodError, BENCHMARK_PERIOD_SOURCE,
  KIS072_PERIOD_FIELD_LENGTHS, KIS264_PERIOD_FIELD_LENGTHS, KIS264_PERIOD_HEADER_LENGTHS,
  normalizeKis072Period, normalizeKis264Period, verifyBenchmarkPeriodEvidence,
  normalizeBenchmarkPeriodFromText, verifyBenchmarkPeriodEvidenceFromText,
  requestKis072Period, requestKis264Period, createBenchmarkPeriodAdapter,
  Kis072PeriodResultSchema, Kis264PeriodResultSchema,
  type BenchmarkPeriodTransport, type BenchmarkPeriodWireRequest,
} from '../src/benchmark-period-inputs.js';
const received = '2026-10-21T00:00:00.123456789012345678Z';
const cutoff = '2026-10-21T00:00:00.123456789012345679Z';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
function body(op: '072' | '264' = '264') { return op === '072' ? { rt_cd: '0', output1: { unreviewed_header: 'DO NOT PROMOTE' }, output2: [
  { stck_bsop_date: '20261020', bstp_nmix_prpr: '-000123.4500', bstp_nmix_oprc: '+0.00', bstp_nmix_hgpr: '', acml_vol: '000', mod_yn: 'N' },
  { stck_bsop_date: '20261019', bstp_nmix_prpr: '9'.repeat(112) },
  { stck_bsop_date: '20261020', bstp_nmix_prpr: '-0' },
] } : { rt_cd: '0', output1: { ovrs_nmix_prdy_clpr: '+00012.3400', prdy_ctrt: '-0.20', hts_kor_isnm: '합성 지수' }, output2: [
  { stck_bsop_date: '20261020', ovrs_nmix_prpr: '-000123.4500', ovrs_nmix_oprc: '+0.00', ovrs_nmix_hgpr: '', acml_vol: '000', mod_yn: 'N' },
  { stck_bsop_date: '20261019', ovrs_nmix_prpr: '9'.repeat(16) },
  { stck_bsop_date: '20261020', ovrs_nmix_prpr: '-0' },
] }; }
const query = (op = '264') => ({ market_code: op === '072' ? 'U' : 'N', instrument_code: op === '072' ? '0001' : 'SYNTH', start_date: '2026-10-01', end_date: '2026-10-20', period_code: 'W' });
const input = (text: string, op = '264') => ({ request: query(op), capture: { origin: 'synthetic', received_at: received, expected_body_sha256: sha(text), http_status: 200, tr_cont: 'M' as string | null }, cutoff });
const run = (v: unknown, op: '072' | '264' = '264', change?: (q: ReturnType<typeof input>) => void) => {
  const text = typeof v === 'string' ? v : JSON.stringify(v), q = input(text, op); change?.(q);
  return (op === '072' ? normalizeKis072Period : normalizeKis264Period)(q, text);
};
function error(fn: () => unknown, code: string) { assert.throws(fn, (e: unknown) => e instanceof BenchmarkPeriodError && e.code === code && e.message === code); }
async function reject(fn: () => Promise<unknown>, code: string) { await assert.rejects(fn, (e: unknown) => e instanceof BenchmarkPeriodError && e.code === code && e.message === code); }
for (const op of ['072', '264'] as const) {
  test(`${op}: raw signed/leading-zero lexemes, blanks and missing fields are exact`, () => {
    const r = run(body(op), op), name = op === '072' ? 'bstp_nmix' : 'ovrs_nmix';
    assert.equal(r.rows[0]!.raw_fields[`${name}_prpr`]!.value, '-000123.4500');
    assert.deepEqual(r.rows[0]!.raw_fields[`${name}_hgpr`], { state: 'blank', value: '' });
    assert.deepEqual(r.rows[0]!.raw_fields[`${name}_lwpr`], { state: 'missing', value: null });
    assert.equal(r.rows[0]!.raw_fields[`${name}_oprc`]!.value, '+0.00');
    assert.equal(r.rows[0]!.raw_fields.acml_vol!.value, '000');
    assert.equal(r.rows[2]!.raw_fields[`${name}_prpr`]!.value, '-0');
    assert.equal(r.rows[1]!.raw_fields[`${name}_prpr`]!.value!.length, op === '072' ? 112 : 16);
  });
  test(`${op}: preserves reverse order and duplicate dates without inventing identity`, () => {
    const r = run(body(op), op); assert.deepEqual(r.rows.map(x => x.source_row_index), [0, 1, 2]);
    assert.deepEqual(r.rows.map(x => x.provider_business_date_label), ['2026-10-20', '2026-10-19', '2026-10-20']);
    assert.equal(r.request.instrument_code, op === '072' ? '0001' : 'SYNTH');
    assert.ok(r.rows.every(x => Object.values(x.canonical).every(v => v === null)));
    assert.equal(r.identity_status, 'request_context_only_not_response_verified');
    assert.equal(r.capture.source_authentication, 'not_established'); assert.equal(r.source_as_of, null);
    assert.equal(r.publication_at, null); assert.equal(r.rights_status, 'pending');
  });
  test(`${op}: frozen result and result schema`, () => {
    const r = run(body(op), op); assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.rows[0]!.raw_fields));
    assert.ok((op === '072' ? Kis072PeriodResultSchema : Kis264PeriodResultSchema).safeParse(r).success);
    assert.throws(() => { (r as any).capture.origin = 'actual'; });
  });
  test(`${op}: first-page continuation never implies completeness`, () => {
    for (const v of [null, '', 'M', 'F', 'N', 'D', 'E', 'OTHER']) {
      const r = run(body(op), op, q => { q.capture.tr_cont = v; }); assert.equal(r.capture.tr_cont, v);
      assert.equal(r.continuation_action, 'none'); assert.equal(r.response_range_completeness, 'unknown_continuation_conflict');
    }
  });
  test(`${op}: empty capture differs from missing response`, () => {
    const r = run({ rt_cd: '0', output1: {}, output2: [] }, op); assert.equal(r.output2_state, 'empty'); assert.equal(r.row_count, 0);
    if (op === '072') error(() => run({ rt_cd: '0' }, op), 'schema_drift');
    else { const r = run({ rt_cd: '0' }, op); assert.equal(r.output1_state, 'missing'); assert.equal(r.output2_state, 'missing'); }
  });
  test(`${op}: documented/raw length boundaries`, () => {
    const lengths = op === '072' ? KIS072_PERIOD_FIELD_LENGTHS : KIS264_PERIOD_FIELD_LENGTHS;
    for (const [key, n] of Object.entries(lengths)) if (key !== 'stck_bsop_date') {
      const b = { rt_cd: '0', output1: {}, output2: [{ stck_bsop_date: '20261020', [key]: '1'.repeat(n) }] };
      assert.equal(run(b, op).rows[0]!.raw_fields[key]!.value!.length, n);
      b.output2[0]![key] += '1'; error(() => run(b, op), 'schema_drift');
    }
  });
  test(`${op}: unknown row fields and wrong raw types reject`, () => {
    for (const v of [0, null, true, {}, [], 123.45]) error(() => run({ rt_cd: '0', output1: {}, output2: [{ stck_bsop_date: '20261020', acml_vol: v }] }, op), 'schema_drift');
    error(() => run({ rt_cd: '0', output1: {}, output2: [{ stck_bsop_date: '20261020', unknown: '1' }] }, op), 'schema_drift');
  });
  test(`${op}: row limit has correct evidence basis`, () => {
    const n = op === '072' ? 50 : 500, b = { rt_cd: '0', output1: {}, output2: Array.from({ length: n }, () => ({ stck_bsop_date: '20261020' })) };
    const r = run(b, op); assert.equal(r.row_limit, n); assert.equal(r.row_limit_basis, op === '072' ? 'documented_max_rows_per_request' : 'local_safety_budget_not_provider_cap');
    b.output2.push({ stck_bsop_date: '20261020' }); error(() => run(b, op), 'row_limit_exceeded');
  });
}
test('264: header values remain separate and never fill row close', () => {
  const r = run({ rt_cd: '0', output1: { ovrs_nmix_prdy_clpr: '12.3400', prdy_ctrt: '-0.2', hts_kor_isnm: '합성' }, output2: [{ stck_bsop_date: '20261020' }] });
  assert.equal(r.header_raw_fields.ovrs_nmix_prdy_clpr!.value, '12.3400'); assert.equal(r.rows[0]!.raw_fields.ovrs_nmix_prpr!.state, 'missing');
  assert.equal(r.rows[0]!.canonical.close, null);
});
test('072: unreviewed header and envelope metadata never projected', () => {
  const r = run({ ...body('072'), msg1: 'RAW MESSAGE', unreviewed_extra: 'RAW EXTRA' }, '072');
  assert.deepEqual(r.header_raw_fields, {}); assert.ok(!JSON.stringify(r).includes('RAW MESSAGE')); assert.ok(!JSON.stringify(r).includes('RAW EXTRA'));
});
test('264: bounded uninterpreted provider strings are not promoted to decimals', () => {
  for (const v of ['NaN', '1e2', ' 1 ', '1,200', '0.000001']) {
    const r = run({ rt_cd: '0', output2: [{ stck_bsop_date: '20261020', ovrs_nmix_prpr: v }] });
    assert.equal(r.rows[0]!.raw_fields.ovrs_nmix_prpr!.value, v); assert.equal(r.rows[0]!.canonical.close, null);
  }
});
test('264: all header limits and exact missing/blank states', () => {
  for (const [key, n] of Object.entries(KIS264_PERIOD_HEADER_LENGTHS)) {
    const b = { rt_cd: '0', output1: { [key]: '1'.repeat(n) } }; assert.equal(run(b).header_raw_fields[key]!.value!.length, n);
    b.output1[key] += '1'; error(() => run(b), 'schema_drift');
  }
  assert.deepEqual(run({ rt_cd: '0', output1: { prdy_ctrt: '' } }).header_raw_fields.prdy_ctrt, { state: 'blank', value: '' });
  assert.deepEqual(run({ rt_cd: '0' }).header_raw_fields.prdy_ctrt, { state: 'missing', value: null });
});
for (const value of ['20260230', '20260229', '00001020', '20261320', '20261000', '2026102', '20261020\n']) {
  test(`invalid provider date ${JSON.stringify(value)} fails`, () => {
    const expected = value.length > 8 || value.includes('\n') ? 'schema_drift' : 'invalid_provider_date';
    error(() => run({ rt_cd: '0', output2: [{ stck_bsop_date: value }] }), expected);
  });
}
test('valid leap dates and pre-100 year dates remain date labels', () => {
  for (const [day, raw] of [['2024-02-29', '20240229'], ['0099-01-01', '00990101']]) {
    const text = JSON.stringify({ rt_cd: '0', output2: [{ stck_bsop_date: raw }] }), q = input(text);
    q.request.start_date = day!; q.request.end_date = day!; assert.equal(normalizeKis264Period(q, text).rows[0]!.provider_business_date_label, day);
  }
});
test('date outside requested range is not silently filtered or moved', () => {
  const r = run({ rt_cd: '0', output2: [{ stck_bsop_date: '20261021' }] });
  assert.equal(r.rows[0]!.provider_business_date_label, '2026-10-21'); assert.equal(r.rows[0]!.label_relation_to_request, 'outside_requested_range');
});
for (const date of ['2026-02-30T00:00:00Z', '2026-10-21T24:00:00Z', '2026-10-21T00:00:60Z', '2026-10-21T00:00:00-00:00',
  '2026-10-21T00:00:00Z\n', '2026-10-21T00:00:00+24:00', '2026-10-21T00:00:00+00:60', '2026-10-21', 'x'.repeat(81)]) {
  test(`invalid instant ${JSON.stringify(date)} rejected`, () => error(() => run(body(), '264', q => { q.capture.received_at = date; }), 'invalid_input'));
}
test('exact arbitrary fractional gate rejects rounded-equal future receipt', () => {
  error(() => run(body(), '264', q => { q.capture.received_at = '2026-10-21T00:00:00.123456789012345680Z'; }), 'future_receipt');
});
test('exact offsets and equivalent trailing-zero fractions accepted', () => {
  const r = run(body(), '264', q => { q.capture.received_at = '2026-10-21T09:00:00.1234567890123456790+09:00'; });
  assert.equal(r.capture.received_at, '2026-10-21T09:00:00.1234567890123456790+09:00');
});
for (const period of ['D', 'w', 'm', 'y', '1d', '', 'W\n']) test(`period ${JSON.stringify(period)} is an explicit gap`, () => error(() => run(body(), '264', q => { q.request.period_code = period; }), 'invalid_input'));
test('strict request/capture metadata forbids unsupported additions and numeric coercion', () => {
  for (const mutate of [ (q: any) => { q.capture.http_status = '200'; }, (q: any) => { q.capture.http_status = 200.1; },
    (q: any) => { q.capture.http_status = -0; }, (q: any) => { q.capture.http_status = Infinity; },
    (q: any) => { q.capture.extra = true; }, (q: any) => { q.extra = 1; }, (q: any) => { q.request.continuation = 'N'; },
    (q: any) => { q.capture.origin = 'verified'; }, (q: any) => { q.request.end_date = '2026-09-30'; },
    (q: any) => { q.request.instrument_code = 'x'.repeat(13); }, (q: any) => { q.request.market_code = 'FX'; },
    (q: any) => { q.capture.tr_cont = 'x'.repeat(9); }, (q: any) => { q.request.instrument_code = ''; },
  ]) { const text = JSON.stringify(body()), q = input(text); mutate(q); assert.throws(() => normalizeKis264Period(q, text), BenchmarkPeriodError); }
});
for (const key of ['__proto__', 'constructor', 'prototype', 'toJSON']) {
  test(`protected JSON key ${key} rejected at every depth`, () => {
    for (const text of [`{"rt_cd":"0","${key}":{}}`, `{"rt_cd":"0","output1":{"${key}":0}}`, `{"rt_cd":"0","unused":[{"${key}":0}]} `]) error(() => run(text), 'protected_key');
  });
}
for (const text of ['{"rt_cd":"0","rt_cd":"1"}', '{"rt_cd":"0","output2":[{"stck_bsop_date":"20261020","stck_bsop_date":"20261019"}]}', '{"rt_cd":"0","output1":{"x":1,"\\u0078":2}}']) {
  test(`duplicate decoded JSON keys rejected: ${text}`, () => error(() => run(text), 'duplicate_json_key'));
}
for (const text of ['', '{', '{"rt_cd":"0",}', '{"rt_cd":"0"} garbage', '{"rt_cd":01}', '{"rt_cd":1.}', '{"rt_cd":"\\x00"}', '[true,]']) {
  test(`invalid JSON rejected: ${JSON.stringify(text)}`, () => error(() => run(text), 'invalid_json'));
}
test('numeric status tokens never round to valid string status', () => {
  for (const n of ['0', '0.000000000000000000000000001', '1e-99999', '-0', '9'.repeat(100)]) error(() => run(`{"rt_cd":${n}}`), 'schema_drift');
  error(() => run('{"rt_cd":' + '9'.repeat(129) + '}'), 'body_complexity_limit');
});
test('provider rejected status yields finite error, never echoes sensitive messages', () => {
  error(() => run({ rt_cd: '1', msg1: 'secret token NEVER ECHO' }), 'upstream_rejected');
});
test('body prebound prevents UTF8 encoding before oversized code-unit rejection', () => {
  const text = 'x'.repeat(BENCHMARK_PERIOD_LIMITS.body_bytes + 1), q = input('{}');
  const old = Buffer.byteLength; (Buffer as any).byteLength = (s: string, ...a: unknown[]) => { if (s === text) throw new Error('encoded_oversize'); return (old as any)(s, ...a); };
  try { error(() => normalizeKis264Period(q, text), 'body_too_large'); } finally { Buffer.byteLength = old; }
});
test('UTF8 actual body bytes and malformed Unicode are bounded', () => {
  error(() => run('{"rt_cd":"0","extra":"' + '한'.repeat(90_000) + '"}'), 'body_too_large');
  const text = '{"rt_cd":"0","extra":"\ud800"}'; error(() => normalizeKis264Period(input(text), text), 'invalid_body_text');
  error(() => run('{"rt_cd":"0","extra":"\\ud800"}'), 'invalid_json');
});
test('complexity bounds for nesting, strings, keys and arrays', () => {
  error(() => run('['.repeat(14) + '0' + ']'.repeat(14)), 'body_complexity_limit');
  error(() => run('{"rt_cd":"0","x":"' + 'a'.repeat(16_385) + '"}'), 'body_complexity_limit');
  error(() => run('{"' + 'x'.repeat(129) + '":0}'), 'body_complexity_limit');
  error(() => run('[' + Array(1025).fill('0').join(',') + ']'), 'body_complexity_limit');
});
test('unsafe input rejects proxies including revoked proxies without executing traps', () => {
  let traps = 0; const text = JSON.stringify(body()), q = input(text), p = new Proxy(q, { get: () => { traps++; throw Error(); }, ownKeys: () => { traps++; throw Error(); }, getPrototypeOf: () => { traps++; throw Error(); } });
  error(() => normalizeKis264Period(p, text), 'unsafe_object'); assert.equal(traps, 0);
  const rev = Proxy.revocable({}, {}); rev.revoke(); error(() => normalizeKis264Period(rev.proxy, text), 'unsafe_object');
});
test('unsafe objects reject accessors, cycles, functions, hidden and symbol keys', () => {
  let accessed = 0; const text = JSON.stringify(body());
  const bads: unknown[] = [new Date(), new String('x'), () => null, { get request() { accessed++; return query(); } }, Object.create({ inherited: true })];
  const cycle: any = {}; cycle.self = cycle; bads.push(cycle);
  const symbol = input(text) as any; symbol[Symbol()] = 1; bads.push(symbol);
  const hidden = input(text); Object.defineProperty(hidden, 'hidden', { value: 1 }); bads.push(hidden);
  const sparse: any = input(text); sparse.extra = new Array(10); bads.push(sparse);
  for (const bad of bads) error(() => normalizeKis264Period(bad, text), 'unsafe_object'); assert.equal(accessed, 0);
});
test('input oversized string and key bounds precede byte encoding', () => {
  const q: any = input('{}'); q.extra = 'x'.repeat(40_000); error(() => normalizeKis264Period(q, '{}'), 'input_too_large');
  const p: any = input('{}'); p['x'.repeat(129)] = 1; error(() => normalizeKis264Period(p, '{}'), 'input_too_large');
});
test('hash binds whitespace/lexemes, not a reconstructed object', () => {
  const text = JSON.stringify(body()), q = input(text); error(() => normalizeKis264Period(q, text + ' '), 'capture_hash_mismatch');
  const r = normalizeKis264Period(q, text); assert.equal(r.capture.body_sha256, sha(text)); assert.equal(r.capture.body_byte_length, Buffer.byteLength(text));
});
test('independent evidence verification rejects changed raw/order/capture/canonical', () => {
  const text = JSON.stringify(body()), q = input(text), r = normalizeKis264Period(q, text);
  assert.deepEqual(verifyBenchmarkPeriodEvidence('KIS-264', r, q, text), r);
  for (const mutate of [(v: any) => { v.rows[0].raw_fields.ovrs_nmix_prpr.value = '1'; }, (v: any) => { v.capture.origin = 'actual'; },
    (v: any) => { v.rows[0].canonical.currency = 'USD'; }, (v: any) => { v.rows.reverse(); }, (v: any) => { v.row_count = 0; }]) {
    const p = structuredClone(r); mutate(p); assert.throws(() => verifyBenchmarkPeriodEvidence('KIS-264', p, q, text), BenchmarkPeriodError);
  }
});
test('invalid result dates fail schema without throwing unbounded exceptions', () => {
  const p: any = structuredClone(run(body())); p.capture.received_at = 'invalid'; assert.equal(Kis264PeriodResultSchema.safeParse(p).success, false);
});
for (const n of [100, 301, 500, 599, 401, 403, 429, 408]) {
  test(`HTTP ${n} maps finite error`, () => error(() => run(body(), '264', q => { q.capture.http_status = n; }), n === 401 || n === 403 ? 'auth_expired' : n === 429 ? 'rate_limited' : n === 408 ? 'upstream_timeout' : 'upstream_unavailable'));
}
test('072 transport blocked for both String(2) and example 0001 before any hook access', async () => {
  let access = 0; const t = new Proxy({}, { get: () => { access++; throw Error(); }, ownKeys: () => { access++; throw Error(); } }) as BenchmarkPeriodTransport;
  for (const code of ['01', '0001']) { const q = { request: { ...query('072'), instrument_code: code }, cutoff };
    await reject(() => requestKis072Period(q, t, () => { access++; return received; }), 'request_contract_conflict'); }
  assert.equal(access, 0);
});
test('264 injected one call exact immutable GET identity and W query', async () => {
  const requests: BenchmarkPeriodWireRequest[] = [], text = JSON.stringify(body());
  const adapter = createBenchmarkPeriodAdapter({ origin: 'synthetic', send: async r => {
    requests.push(r); assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.query));
    return { http_status: 200, tr_cont: 'M', body_text: text };
  } }, () => received);
  const r = await adapter.requestKis264({ request: query(), cutoff }); assert.equal(requests.length, 1); assert.equal(r.capture.origin, 'synthetic');
  assert.deepEqual(requests[0], { operation_ref: 'KIS-264', method: 'GET', path: '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice', tr_id: 'FHKST03030100',
    query: { FID_COND_MRKT_DIV_CODE: 'N', FID_INPUT_ISCD: 'SYNTH', FID_INPUT_DATE_1: '20261001', FID_INPUT_DATE_2: '20261020', FID_PERIOD_DIV_CODE: 'W' } });
});
for (const code of ['N', 'X', 'I', 'S']) test(`264 request code ${code} never becomes verified asset class`, async () => {
  let calls = 0; const r = await requestKis264Period({ request: { ...query(), market_code: code }, cutoff }, { origin: 'synthetic', send: async req => {
    calls++; assert.equal(req.query.FID_COND_MRKT_DIV_CODE, code); return { http_status: 200, tr_cont: 'F', body_text: JSON.stringify(body()) };
  } }, () => received); assert.equal(calls, 1); assert.equal(r.rows[0]!.canonical.asset_class, null);
});
test('264 malformed input and transport hooks fail before sending', async () => {
  let calls = 0; const valid: BenchmarkPeriodTransport = { origin: 'synthetic', send: async () => { calls++; return null; } };
  await reject(() => requestKis264Period({ request: { ...query(), period_code: 'D' }, cutoff }, valid), 'invalid_input');
  await reject(() => requestKis264Period({ request: query(), cutoff }), 'transport_not_configured');
  const getter: any = { origin: 'synthetic', get send() { calls++; return async () => null; } };
  await reject(() => requestKis264Period({ request: query(), cutoff }, getter), 'invalid_input');
  await reject(() => requestKis264Period({ request: query(), cutoff }, new Proxy(valid, { get: () => { calls++; throw Error(); } })), 'invalid_input');
  await reject(() => requestKis264Period({ request: query(), cutoff }, { ...valid, extra: 1 } as any), 'invalid_input'); assert.equal(calls, 0);
});
test('264 response proxy rejected without traps; thrown sensitive transport text never echoed', async () => {
  let traps = 0;
  await reject(() => requestKis264Period({ request: query(), cutoff }, { origin: 'synthetic', send: async () => new Proxy({}, { ownKeys: () => { traps++; throw Error(); } }) }, () => received), 'unsafe_object'); assert.equal(traps, 0);
  let calls = 0; await reject(() => requestKis264Period({ request: query(), cutoff }, { origin: 'synthetic', send: async () => { calls++; throw Error('secret auth token'); } }, () => received), 'upstream_unavailable'); assert.equal(calls, 1);
});
test('264 result replay never defaults to authenticated actual origin', async () => {
  await reject(() => requestKis264Period({ request: query(), cutoff }, { origin: 'synthetic', send: async () => ({ http_status: '200', tr_cont: null, body_text: JSON.stringify(body()) }) }, () => received), 'invalid_input');
  await reject(() => requestKis264Period({ request: query(), cutoff }, { origin: 'synthetic', send: async () => ({ http_status: 200, tr_cont: null, body_text: JSON.stringify(body()), extra: true }) }, () => received), 'invalid_input');
});
test('deterministic on-disk fixtures reproduce all six native interval cases', () => {
  for (const op of ['072', '264'] as const) for (const period of ['W', 'M', 'Y']) {
    const f = JSON.parse(readFileSync(new URL(`../../fixtures/benchmark-period/kis${op}-${period}-synthetic.json`, import.meta.url), 'utf8'));
    assert.equal(f.synthetic_only, true); assert.deepEqual((op === '072' ? normalizeKis072Period : normalizeKis264Period)(f.input, f.original_body_text), f.expected);
  }
});

for (const op of ['072', '264'] as const) for (const period of ['W', 'M', 'Y'] as const) {
 test(`${op} ${period}: requested interval separate from actual coverage and every canonical value`, () => {
  const r = run({ rt_cd: '0', output1: {}, output2: [{ stck_bsop_date: '' }, {}, { stck_bsop_date: '20260901' }, { stck_bsop_date: '20261020' }, { stck_bsop_date: '20261020' }] }, op, q => { q.request.period_code = period; });
  assert.equal(r.request.period_code, period); assert.equal(r.requested_interval, ({W:'weekly',M:'monthly',Y:'yearly'})[period]);
  assert.equal(r.actual_interval_status, 'not_verified'); assert.equal(r.actual_period_coverage, 'unknown');
  assert.equal(r.period_boundary_status, 'unknown'); assert.equal(r.period_completeness, 'unknown'); assert.equal(r.return_basis, 'unknown_not_total_return_evidence');
  assert.equal(r.metric_ready, false); assert.ok(r.rows.every(x => Object.values(x.canonical).every(v => v === null)));
  assert.deepEqual(r.rows.map(x => x.provider_business_date_label), [null,null,'2026-09-01','2026-10-20','2026-10-20']);
  assert.deepEqual(r.rows.map(x => x.label_relation_to_request), ['unavailable','unavailable','outside_requested_range','within_requested_range','within_requested_range']);
  assert.deepEqual(r.rows[0]!.raw_fields.stck_bsop_date, { state: 'blank', value: '' });
  assert.deepEqual(r.rows[1]!.raw_fields.stck_bsop_date, { state: 'missing', value: null });
 });
 test(`${op} ${period}: strict text APIs reconstruct independently, reject foreign operation`, () => {
  const text = JSON.stringify(body(op)), q = input(text,op); q.request.period_code=period;
  const operation = `KIS-${op}` as 'KIS-072'|'KIS-264';
  const r = normalizeBenchmarkPeriodFromText(operation,JSON.stringify(q),text);
  assert.deepEqual(verifyBenchmarkPeriodEvidenceFromText(operation,JSON.stringify(r),JSON.stringify(q),text),r);
  error(() => verifyBenchmarkPeriodEvidenceFromText(op==='072'?'KIS-264':'KIS-072',JSON.stringify(r),JSON.stringify(q),text),'invalid_input');
 });
}
for (const period of ['W','M','Y'] as const) for (const origin of ['synthetic','actual'] as const) {
 test(`264 ${period} ${origin}-labelled injection is one-shot, post-response receipt, never authentication`, async () => {
  const order:string[]=[]; let wire:BenchmarkPeriodWireRequest|undefined;
  const q = {request:{...query(),period_code:period},cutoff};
  const text=JSON.stringify(body()); const r=await requestKis264Period(q,{origin,send:async request=>{
   order.push('send');wire=request; await Promise.resolve();order.push('received');return{http_status:200,tr_cont:'M',body_text:text};
  }},()=>{order.push('clock');return received;});
  assert.deepEqual(order,['send','received','clock']);assert.equal(wire!.query.FID_PERIOD_DIV_CODE,period);
  assert.equal(r.capture.origin,origin);assert.equal(r.capture.source_authentication,'not_established');assert.equal(r.metric_ready,false);
  assert.equal(r.page_origin_status,'not_independently_established');assert.equal(r.continuation_action,'none');
 });
}
test('072 native dispatch conflict holds for every interval before even revoked dependencies or clock access',async()=>{
 for(const period of ['W','M','Y'])for(const code of ['01','0001']){
  const p=Proxy.revocable({},{});p.revoke();let called=0;
  await reject(()=>requestKis072Period({request:{...query('072'),period_code:period,instrument_code:code},cutoff},p.proxy as BenchmarkPeriodTransport,()=>{called++;throw Error();}),'request_contract_conflict');assert.equal(called,0);
 }
});
test('clock exceptions including exported errors are sanitized without inspecting their values',async()=>{
 const unknown=new BenchmarkPeriodError('SECRET-CLOCK' as any),modified=new BenchmarkPeriodError('schema_drift');modified.message='SECRET-MESSAGE';
 const getter=new BenchmarkPeriodError('invalid_input');let accessed=0;Object.defineProperty(getter,'code',{get(){accessed++;throw Error('SECRET-GETTER');}});
 const proxy=new Proxy({}, {get(){accessed++;throw Error('SECRET-PROXY');}});
 for(const thrown of [unknown,modified,getter,proxy,'SECRET-STRING',null])await reject(()=>requestKis264Period({request:query(),cutoff},{origin:'synthetic',send:async()=>({http_status:200,tr_cont:null,body_text:JSON.stringify(body())})},()=>{throw thrown;}),'invalid_input');
 assert.equal(accessed,0);
});
test('transport exceptions including exported errors never forge source failure codes',async()=>{
 for(const code of BENCHMARK_PERIOD_ERROR_CODES)await reject(()=>requestKis264Period({request:query(),cutoff},{origin:'actual',send:async()=>{throw new BenchmarkPeriodError(code);}},()=>received),'upstream_unavailable');
});
test('metadata JSON exact safe integer profile rejects decimals, exponents, rounding and negative zero before coercion',()=>{
 const text=JSON.stringify(body()),q=JSON.stringify(input(text));
 for(const token of ['200.0','200.000000000000000001','2e2','200e0','-0','-1','9007199254740993','99999999999999999999999999999999999999999999999999']){
  error(()=>normalizeBenchmarkPeriodFromText('KIS-264',q.replace('"http_status":200',`"http_status":${token}`),text),'invalid_metadata_number');
 }
 for(const token of ['"200"','null','true'])error(()=>normalizeBenchmarkPeriodFromText('KIS-264',q.replace('"http_status":200',`"http_status":${token}`),text),'invalid_input');
});
test('metadata escaped duplicate keys and protected keys rejected at every depth',()=>{
 const text=JSON.stringify(body()),q=JSON.stringify(input(text));
 error(()=>normalizeBenchmarkPeriodFromText('KIS-264',q.replace('"http_status":200','"http_status":200,"http_\\u0073tatus":200'),text),'duplicate_json_key');
 error(()=>normalizeBenchmarkPeriodFromText('KIS-264',q.replace('"request":{','"request":{"constructor":0,'),text),'protected_key');
 const r=run(body());const persisted=JSON.stringify(r).replace('"metric_ready":false','"metric_ready":false,"metric_ready":false');
 error(()=>verifyBenchmarkPeriodEvidenceFromText('KIS-264',persisted,q,text),'duplicate_json_key');
});
test('metadata text pre-budget occurs before encoding and hashing',()=>{
 const huge='x'.repeat(BENCHMARK_PERIOD_LIMITS.input_bytes+1),old=Buffer.byteLength;
 (Buffer as any).byteLength=(s:string,...a:unknown[])=>{if(s===huge)throw Error('should_not_encode');return(old as any)(s,...a);};
 try{error(()=>normalizeBenchmarkPeriodFromText('KIS-264',huge,'{}'),'input_too_large');}finally{Buffer.byteLength=old;}
});
test('full maximum-size result reconstructs from objects and exact metadata JSON for both operations',()=>{
 for(const op of ['072','264']as const)for(const fill of ['1','한']){
  const lengths=op==='072'?KIS072_PERIOD_FIELD_LENGTHS:KIS264_PERIOD_FIELD_LENGTHS,n=op==='072'?50:500;
  const row=Object.fromEntries(Object.entries(lengths).map(([key,len])=>[key,key==='stck_bsop_date'?'20261020':fill.repeat(len)]));
  const text=JSON.stringify({rt_cd:'0',output1:{},output2:Array.from({length:n},()=>({...row}))}),q=input(text,op);
  const operation=`KIS-${op}`as 'KIS-072'|'KIS-264',r=(op==='072'?normalizeKis072Period:normalizeKis264Period)(q,text);
  assert.deepEqual(verifyBenchmarkPeriodEvidence(operation,r,q,text),r);
  assert.deepEqual(verifyBenchmarkPeriodEvidenceFromText(operation,JSON.stringify(r),JSON.stringify(q),text),r);
 }
});
test('every scalar persisted result leaf is bound to independent reconstruction',()=>{
 const text=JSON.stringify(body()),q=input(text),r=normalizeKis264Period(q,text);
 const paths:(string|number)[][]=[];
 function leaves(v:any,path:(string|number)[]){if(v===null||typeof v!=='object'){paths.push(path);return;}for(const key of Object.keys(v))leaves(v[key],[...path,key]);}
 leaves(r,[]);assert.ok(paths.length>120);
 for(const path of paths){const changed:any=structuredClone(r);let cursor=changed;for(const key of path.slice(0,-1))cursor=cursor[key];const key=path.at(-1)!;const old=cursor[key];
  cursor[key]=old===null?'TAMPER':typeof old==='boolean'?!old:typeof old==='number'?old+1:old==='synthetic'?'actual':old+'X';
  assert.throws(()=>verifyBenchmarkPeriodEvidence('KIS-264',changed,q,text),BenchmarkPeriodError,path.join('.'));
 }
});
test('schema-valid coordinated request interval and labels cannot replace independent inputs',()=>{
 const text=JSON.stringify(body()),q=input(text),r=normalizeKis264Period(q,text);
 const p:any=structuredClone(r);p.request.period_code='M';p.requested_interval='monthly';assert.equal(Kis264PeriodResultSchema.safeParse(p).success,true);
 error(()=>verifyBenchmarkPeriodEvidence('KIS-264',p,q,text),'evidence_mismatch');
 p.request.period_code='W';p.requested_interval='weekly';p.rows[0].provider_business_date_label='2026-10-19';p.rows[0].raw_fields.stck_bsop_date.value='20261019';assert.equal(Kis264PeriodResultSchema.safeParse(p).success,true);
 error(()=>verifyBenchmarkPeriodEvidence('KIS-264',p,q,text),'evidence_mismatch');
});
test('request, clock and response mutations cannot alter captured snapshots after dispatch',async()=>{
 const q={request:query(),cutoff},t:BenchmarkPeriodTransport={origin:'synthetic',send:async()=>{q.request.period_code='Y';q.request.instrument_code='CHANGED';(t as any).origin='actual';return{http_status:200,tr_cont:null,body_text:JSON.stringify(body())};}};
 const r=await requestKis264Period(q,t,()=>received);assert.equal(r.request.period_code,'W');assert.equal(r.request.instrument_code,'SYNTH');assert.equal(r.capture.origin,'synthetic');
});
test('local snapshot evidence hashes and documented W/M/Y remain pinned, not live assertions',()=>{
 const schema=readFileSync(new URL('../../contracts/r01-kis-official-response-schemas-v1.json',import.meta.url),'utf8');
 const review=readFileSync(new URL('../../fixtures/source-contracts/r01-kis-official-field-review.md',import.meta.url),'utf8');
 assert.equal(sha(schema),'92ebd33bf4b4a0d07bc67b4c2da66ef5e5258d8674c2f64a3f77f9ffa4404803');
 assert.equal(sha(review),'98c5e90a65c0716e18e283860a2368aa6bc582e95fff1f65e1281bc1a6acfe03');
 assert.equal(BENCHMARK_PERIOD_SOURCE.pinned_sample_commit,'2077773a69a428daf63e148182511f068cc45de3');
 assert.equal(new Set(BENCHMARK_PERIOD_ERROR_CODES).size,BENCHMARK_PERIOD_ERROR_CODES.length);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import * as f from '../src/historical-stock-bars.js';
import * as fx from './historical-stock-bars-fixtures.js';
const clock = () => fx.receipt;
const isCode = (code: f.KrHistoricalIntradayErrorCode) => (e: unknown) => e instanceof f.KrHistoricalIntradayError && e.code === code && e.message === code;
const read = f.requestKrHistoricalIntraday;

test('historical route preserves original lexemes and all epistemic gates', async () => {
  const out = await read(fx.input, fx.transport(), clock);
  assert.deepEqual(out.raw, fx.body); assert.equal(out.origin, 'synthetic'); assert.equal(out.received_at, fx.receipt); assert.equal(out.available_at, fx.receipt);
  assert.ok(Object.values(out.canonical).every(v => v === null));
  assert.equal(out.source_as_of, null); assert.equal(out.event_time, null); assert.equal(out.published_at, null); assert.equal(out.source_timezone, null);
  assert.equal(out.source_commit, f.KR_HISTORICAL_INTRADAY_SOURCE_COMMIT);
  for (const key of ['session', 'delay_state', 'finality', 'freshness', 'completeness'] as const) assert.equal(out[key], 'unknown');
  assert.equal(out.rights_status, 'pending'); assert.equal(out.bars_returned, 2); assert.equal(out.identity_status, 'no_returned_instrument_code');
  assert.ok(f.KrHistoricalIntradayResultSchema.safeParse(out).success);
});
test('fixed endpoint, method, transaction and original parameter names match pinned official first page', async () => {
  let calls = 0;
  await read(fx.input, { origin: 'synthetic', async send(request) {
    calls++; assert.deepEqual(request, {
      operation: 'kis.kr_historical_intraday', method: 'GET', path: '/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice',
      tr_id: 'FHKST03010230', tr_cont: '', query: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '005930',
        FID_INPUT_DATE_1: '20261020', FID_INPUT_HOUR_1: '130000', FID_PW_DATA_INCU_YN: 'N', FID_FAKE_TICK_INCU_YN: '' },
    }); return fx.response();
  } }, clock); assert.equal(calls, 1);
});
test('all documented boards and explicit include-past flags survive unchanged', async () => {
  for (const board of ['J', 'NX', 'UN'] as const) for (const include_past_data of ['Y', 'N'] as const) {
    const input = { ...fx.input, board, include_past_data };
    const out = await read(input, { origin: 'synthetic', async send(r) {
      assert.equal(r.query.FID_COND_MRKT_DIV_CODE, board); assert.equal(r.query.FID_PW_DATA_INCU_YN, include_past_data); return fx.response();
    } }, clock); assert.deepEqual(out.requested, input);
  }
});
test('request/input snapshots are frozen and receipt is taken exactly once after await', async () => {
  const input = structuredClone(fx.input); let ready = false, clockCalls = 0, sends = 0;
  const transport: f.KrHistoricalIntradayTransport = { origin: 'synthetic', async send(request) {
    sends++; assert.ok(Object.isFrozen(request)); assert.ok(Object.isFrozen(request.query));
    assert.throws(() => { (request.query as Record<string, string>).MALICIOUS = 'order'; }, TypeError);
    input.symbol = '111111'; (transport as { origin: string }).origin = 'actual';
    await Promise.resolve(); ready = true; return fx.response();
  } };
  const out = await read(input, transport, () => { assert.ok(ready); clockCalls++; return fx.receipt; });
  assert.equal(clockCalls, 1); assert.equal(sends, 1); assert.equal(out.requested.symbol, fx.input.symbol); assert.equal(out.origin, 'synthetic');
});
test('result is isolated from later original response mutation', async () => {
  const response = fx.response(); const out = await read(fx.input, { origin: 'synthetic', async send() { return response; } }, clock);
  (response.body as typeof fx.body).output2[0]!.stck_prpr = '999'; assert.equal(out.raw.output2[0]!.stck_prpr, '00070100.00');
});
test('missing transport has no implicit live fallback', async () => { await assert.rejects(read(fx.input), isCode('transport_not_configured')); });
test('empty page never proves absence or retention', async () => {
  const out = await read(fx.input, fx.transport({ ...fx.body, output2: [] }), clock);
  assert.equal(out.bars_returned, 0); assert.equal(out.coverage_status, 'empty_page_not_proof_of_absence'); assert.equal(out.completeness, 'unknown');
});
test('duplicate and mixed-date rows survive provider order without reanchoring', async () => {
  const row = { ...fx.body.output2[0]!, stck_bsop_date: '20261019' };
  const body = { ...fx.body, output2: [row, fx.body.output2[1], row] };
  const out = await read(fx.input, fx.transport(body), clock);
  assert.deepEqual(out.raw, body); assert.equal(out.bars_returned, 3); assert.equal(out.duplicate_label_status, 'duplicate_labels_retained');
  assert.equal(out.anchor_context_status, 'request_anchor_not_verified_against_source_labels');
});
test('blank date/time labels remain empty strings and are not claimed duplicate instants', async () => {
  const row = { ...fx.body.output2[1]!, stck_bsop_date: '', stck_cntg_hour: '' };
  const body = { ...fx.body, output2: [row, row, { ...row, stck_bsop_date: '20261020' }] };
  const out = await read(fx.input, fx.transport(body), clock);
  assert.deepEqual(out.raw, body); assert.equal(out.blank_label_status, 'blank_labels_retained'); assert.equal(out.duplicate_label_status, 'none_observed');
});
test('optional absence differs from blank and zero without coercion', async () => {
  const absent = { ...fx.body.output2[0]! }; delete (absent as { acml_tr_pbmn?: string }).acml_tr_pbmn;
  const body = { ...fx.body, output1: { stck_prpr: '' }, output2: [absent, { ...absent, cntg_vol: '0', acml_tr_pbmn: '' }] };
  const out = await read(fx.input, fx.transport(body), clock); assert.deepEqual(out.raw, body);
  assert.equal('acml_tr_pbmn' in out.raw.output2[0]!, false); assert.equal(out.raw.output2[1]!.cntg_vol, '0');
});
test('single page only for M/F and unknown completeness for every terminal code', async () => {
  for (const tr_cont of ['M', 'F', '', 'D', 'E', null]) {
    let calls = 0; const out = await read(fx.input, { origin: 'synthetic', async send() { calls++; return fx.response(fx.body, tr_cont); } }, clock);
    assert.equal(calls, 1); assert.equal(out.pagination.tr_cont, tr_cont); assert.equal(out.pagination.automatic_continuation, false);
    assert.equal(out.pagination.status, tr_cont === 'M' || tr_cont === 'F' ? 'more_signaled_not_fetched' : 'not_signaled_completeness_unknown');
  }
});
test('120-row boundary accepts exactly 120 and rejects 121 instead of truncating', async () => {
  const page = (n: number) => ({ ...fx.body, output2: Array.from({ length: n }, () => fx.body.output2[0]) });
  assert.equal((await read(fx.input, fx.transport(page(120)), clock)).bars_returned, 120);
  await assert.rejects(read(fx.input, fx.transport(page(121)), clock), isCode('schema_drift'));
});
test('input rejects URL, account, order, headers, continuation and undocumented options before transport', async () => {
  for (const extra of [{ url: 'https://example.invalid' }, { headers: {} }, { CANO: '123456' }, { method: 'POST' }, { cursor: 'x' },
    { interval: '5m' }, { adjustment_code: '1' }, { include_fake_ticks: 'N' }, { expected_currency: 'KRW' }, { unknown: 1 }]) {
    let calls = 0; await assert.rejects(read({ ...fx.input, ...extra }, { origin: 'synthetic', async send() { calls++; return fx.response(); } }, clock), isCode('invalid_input')); assert.equal(calls, 0);
  }
});
test('malformed or missing anchors, boards, symbols and flags are never defaulted', async () => {
  const missing = { ...fx.input } as Partial<typeof fx.input>; delete missing.board;
  const missingFlag = { ...fx.input } as Partial<typeof fx.input>; delete missingFlag.include_past_data;
  for (const input of [missing, missingFlag, { ...fx.input, symbol: 'Q500001' }, { ...fx.input, symbol: '005930.KS' }, { ...fx.input, board: 'KRX' },
    { ...fx.input, anchor_date: '20260229' }, { ...fx.input, anchor_date: '20261000' }, { ...fx.input, anchor_date: '2026-10-20' },
    { ...fx.input, anchor_time: '240000' }, { ...fx.input, anchor_time: '126000' }, { ...fx.input, include_past_data: '' }, { ...fx.input, include_past_data: true }]) {
    await assert.rejects(read(input), isCode('invalid_input'));
  }
});
test('valid leap-day is a date label, not an inferred instant or retention guarantee', async () => {
  const out = await read({ ...fx.input, anchor_date: '20240229' }, fx.transport(), clock);
  assert.equal(out.requested.anchor_date, '20240229'); assert.equal(out.source_as_of, null);
});
test('unknown or malformed raw fields fail rather than stripping or coercing', async () => {
  for (const extra of [{ unknown: 'new' }, { stck_prpr: 1.25 }, { stck_prpr: 'NaN' }, { stck_prpr: '1e2' }, { stck_prpr: '+1' },
    { stck_prpr: ' 1 ' }, { stck_prpr: null }, { cntg_vol: '1.5' }, { stck_bsop_date: '20260230' }, { stck_cntg_hour: '250000' }]) {
    await assert.rejects(read(fx.input, fx.transport({ ...fx.body, output2: [{ ...fx.body.output2[0], ...extra }] }), clock), isCode('schema_drift'));
  }
});
test('unsupported header/envelope shapes fail closed', async () => {
  for (const body of [{ ...fx.body, unrelated: 'x' }, { ...fx.body, output1: [fx.body.output1] }, { ...fx.body, output2: fx.body.output2[0] },
    { ...fx.body, output1: { ...fx.body.output1, stck_shrn_iscd: '005930' } }, { ...fx.body, output2: [{ stck_bsop_date: '20261020' }] },
    { ...fx.body, rt_cd: 0 }, { output1: fx.body.output1, output2: [] }]) await assert.rejects(read(fx.input, fx.transport(body), clock), isCode('schema_drift'));
});
test('HTTP and upstream errors are classified and redacted without retries', async () => {
  for (const [status, code] of [[429, 'rate_limited'], [401, 'auth_expired'], [403, 'auth_expired'], [503, 'upstream_unavailable'], [302, 'upstream_unavailable']] as const) {
    let calls = 0; await assert.rejects(read(fx.input, { origin: 'synthetic', async send() { calls++; return { status, tr_cont: '', body: { rt_cd: '1', msg1: 'SENSITIVE-DO-NOT-ECHO' } }; } }, clock), isCode(code)); assert.equal(calls, 1);
  }
  await assert.rejects(read(fx.input, fx.transport({ rt_cd: '1', msg1: 'SENSITIVE-DO-NOT-ECHO' }), clock), isCode('upstream_rejected'));
  await assert.rejects(read(fx.input, { origin: 'synthetic', async send() { throw new Error('SENSITIVE-DO-NOT-ECHO'); } }, clock), isCode('upstream_unavailable'));
});
test('unknown continuation, envelope metadata and malformed statuses are rejected', async () => {
  for (const response of [{ ...fx.response(), tr_cont: 'N' }, { ...fx.response(), tr_cont: 'M ' }, { ...fx.response(), headers: {} }, { ...fx.response(), status: '200' }, { ...fx.response(), status: 999 }]) {
    await assert.rejects(read(fx.input, { origin: 'synthetic', async send() { return response as f.KrHistoricalIntradayResponse; } }, clock), isCode('schema_drift'));
  }
});
test('untrusted input getters, proxies, hidden keys, prototypes and toJSON never execute', async () => {
  let hits = 0;
  const getter = Object.defineProperty({}, 'symbol', { enumerable: true, get() { hits++; return '005930'; } });
  const proxy = new Proxy(fx.input, { ownKeys() { hits++; throw new Error('trap'); }, get() { hits++; throw new Error('trap'); } });
  const json = { ...fx.input, toJSON() { hits++; return fx.input; } };
  const hidden = Object.defineProperty({ ...fx.input }, 'hidden', { value: 1 });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const input of [getter, proxy, json, hidden, cycle, new Date(), { ...fx.input, [Symbol('hidden')]: 1 }, { ...fx.input, symbol: 'x'.repeat(2001) }, new Array(2 ** 32 - 1)]) await assert.rejects(read(input), isCode('invalid_input'));
  assert.equal(hits, 0);
});
test('hostile raw bodies fail bounded without invoking accessors/proxies/toJSON', async () => {
  let hits = 0;
  const accessor = Object.defineProperty({}, 'output1', { enumerable: true, get() { hits++; return {}; } });
  const proxy = new Proxy(fx.body, { ownKeys() { hits++; throw new Error('trap'); }, get() { hits++; throw new Error('trap'); } });
  const withJSON = { ...fx.body, toJSON() { hits++; return fx.body; } };
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const extraArray = [1]; Object.assign(extraArray, { hidden: 'extra' });
  const hidden = Object.defineProperty({ ...fx.body }, 'hidden', { value: 'bad' });
  const sparse = new Array(100);
  for (const body of [accessor, proxy, withJSON, cycle, sparse, extraArray, hidden, new Date(), { bad: NaN }, { bad: Infinity }, { bad: 1n }, { bad: Symbol('bad') }, { bad: undefined }, { bad: () => 1 }]) {
    await assert.rejects(read(fx.input, { origin: 'synthetic', async send() { return { status: 200, tr_cont: '', body }; } }, clock), isCode('schema_drift'));
  }
  assert.equal(hits, 0);
});
test('envelope property accessors are rejected before evaluation', async () => {
  let hits = 0; const response = Object.defineProperty({ tr_cont: '', body: fx.body }, 'status', { enumerable: true, get() { hits++; return 200; } });
  await assert.rejects(read(fx.input, { origin: 'synthetic', async send() { return response as f.KrHistoricalIntradayResponse; } }, clock), isCode('schema_drift')); assert.equal(hits, 0);
});
test('UTF-8, escaping, depth, node, array length and collection byte budgets precede provider parsing', async () => {
  let deep: unknown = {}; for (let i = 0; i < 10; i++) deep = { inner: deep };
  const nodes = Array.from({ length: 30 }, () => Array.from({ length: 400 }, () => ''));
  const keys = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [String(i), '']));
  for (const body of [new Array(2 ** 32 - 1), { huge: '한'.repeat(100001) }, { huge: '"'.repeat(200000) }, deep, nodes, keys]) {
    await assert.rejects(read(fx.input, { origin: 'synthetic', async send() { return { status: 200, tr_cont: '', body }; } }, clock), isCode('response_too_large'));
  }
});
test('null-prototype records accepted as inert JSON data without collapsing raw lexemes', async () => {
  const body = Object.assign(Object.create(null), fx.body) as unknown;
  const out = await read(fx.input, { origin: 'synthetic', async send() { return { status: 200, tr_cont: '', body }; } }, clock); assert.deepEqual(out.raw, fx.body);
});
test('invalid or throwing clocks fail safely without guessing now or rounding fractions', async () => {
  for (const value of ['2026-02-30T03:00:00Z', '2026-10-22', 'invalid', '2026-10-22T03:00:00', 'x'.repeat(81)]) await assert.rejects(read(fx.input, fx.transport(), () => value), isCode('invalid_input'));
  await assert.rejects(read(fx.input, fx.transport(), () => { throw new Error('SENSITIVE'); }), isCode('invalid_input'));
});
test('equivalent exact instants accepted and sub-nanosecond receipt drift rejected', async () => {
  const out = await read(fx.input, fx.transport(), clock);
  assert.ok(f.KrHistoricalIntradayResultSchema.safeParse({ ...out, available_at: '2026-10-22T12:00:00.123456789123+09:00' }).success);
  assert.equal(f.KrHistoricalIntradayResultSchema.safeParse({ ...out, available_at: '2026-10-22T03:00:00.123456789124Z' }).success, false);
  assert.equal(f.KrHistoricalIntradayResultSchema.safeParse({ ...out, available_at: '2026-10-22T03:00:00.123Z' }).success, false);
});
test('cross-field result refinements reject metadata tampering', async () => {
  const out = await read(fx.input, fx.transport(), clock);
  for (const changed of [{ ...out, bars_returned: 0 }, { ...out, source_as_of: fx.receipt }, { ...out, canonical: { ...out.canonical, currency: 'KRW' } },
    { ...out, completeness: 'complete' }, { ...out, duplicate_label_status: 'duplicate_labels_retained' }, { ...out, blank_label_status: 'blank_labels_retained' },
    { ...out, coverage_status: 'empty_page_not_proof_of_absence' }, { ...out, pagination: { ...out.pagination, status: 'more_signaled_not_fetched' } },
    { ...out, identity_status: 'verified' }, { ...out, source_commit: 'main' }]) assert.equal(f.KrHistoricalIntradayResultSchema.safeParse(changed).success, false);
  assert.doesNotThrow(() => f.KrHistoricalIntradayResultSchema.safeParse({ ...out, received_at: 'nonsense' }));
  assert.equal(f.KrHistoricalIntradayResultSchema.safeParse({ ...out, received_at: 'nonsense' }).success, false);
});
test('fixed request cannot be relabeled as POST/order/other endpoint or inject headers', async () => {
  let request: f.KrHistoricalIntradayRequest | undefined;
  await read(fx.input, { origin: 'synthetic', async send(r) { request = r; return fx.response(); } }, clock);
  for (const extra of [{ method: 'POST' }, { path: '/uapi/domestic-stock/v1/trading/order' }, { tr_id: 'MUTATED' }, { headers: {} }, { operation: 'kis.orders' }]) assert.equal(f.KrHistoricalIntradayRequestSchema.safeParse({ ...request, ...extra }).success, false);
  assert.equal(f.KrHistoricalIntradayRequestSchema.safeParse({ ...request, query: { ...request!.query, FID_FAKE_TICK_INCU_YN: 'N' } }).success, false);
});
test('all JSON schemas export; runtime refinements remain authoritative', () => {
  for (const schema of [f.KrHistoricalIntradayInputSchema, f.KrHistoricalIntradayRequestSchema, f.KrHistoricalIntradayRawSchema, f.KrHistoricalIntradayResultSchema]) assert.equal(z.toJSONSchema(schema).type, 'object');
});
test('adapter source has no network, accounts, secrets, order operation or MCP registration', () => {
  const source = readFileSync(new URL('../../src/historical-stock-bars.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|\bhttps?\.request\s*\(|process\.env|registerTool\s*\(|\/trading\/|\bCANO\b|appkey|appsecret|authorization/i);
});
test('generated JSON schemas match the runtime shape projections exactly', () => {
  for (const [kind, schema] of [['input', f.KrHistoricalIntradayInputSchema], ['request', f.KrHistoricalIntradayRequestSchema], ['raw', f.KrHistoricalIntradayRawSchema], ['result', f.KrHistoricalIntradayResultSchema]] as const) {
    const json = JSON.parse(readFileSync(new URL(`../../contracts/kr-historical-intraday-${kind}-v1.schema.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
    assert.ok(typeof json.$comment === 'string' && json.$comment.includes('Runtime Zod'));
    delete json.$id; delete json.$comment; assert.deepEqual(json, z.toJSONSchema(schema));
  }
});
test('all generated synthetic fixtures validate and replay without changing raw evidence', async () => {
  for (const name of ['sample', 'empty', 'mixed-duplicates-blanks']) {
    const fixture = JSON.parse(readFileSync(new URL(`../../fixtures/kr-historical-intraday-${name}-response-synthetic.json`, import.meta.url), 'utf8')) as { fixture_kind: string; not_market_observations: boolean; request_input: unknown; response: f.KrHistoricalIntradayResponse };
    const expected = JSON.parse(readFileSync(new URL(`../../fixtures/kr-historical-intraday-${name}-result-synthetic.json`, import.meta.url), 'utf8')) as f.KrHistoricalIntradayResult;
    assert.equal(fixture.fixture_kind, 'synthetic_only'); assert.equal(fixture.not_market_observations, true);
    assert.ok(f.KrHistoricalIntradayResultSchema.safeParse(expected).success);
    const out = await read(fixture.request_input, { origin: 'synthetic', async send() { return fixture.response; } }, () => expected.received_at);
    assert.deepEqual(out, expected); assert.deepEqual(out.raw, fixture.response.body);
  }
});
test('inherited toJSON hooks are rejected and never called', async () => {
  let hits = 0;
  const old = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
  try {
    Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value() { hits++; return {}; } });
    await assert.rejects(read(fx.input), isCode('invalid_input'));
  } finally {
    if (old) Object.defineProperty(Object.prototype, 'toJSON', old); else Reflect.deleteProperty(Object.prototype, 'toJSON');
  }
  assert.equal(hits, 0);
});
test('revoked input and nested body proxies fail without exposure', async () => {
  const input = Proxy.revocable(fx.input, {}); input.revoke();
  await assert.rejects(read(input.proxy), isCode('invalid_input'));
  const nested = Proxy.revocable(fx.body.output1, {}); nested.revoke();
  await assert.rejects(read(fx.input, { origin: 'synthetic', async send() { return { status: 200, tr_cont: '', body: { ...fx.body, output1: nested.proxy } }; } }, clock), isCode('schema_drift'));
});

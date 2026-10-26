import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  HISTORY_BREADTH_MAX_RESPONSE_BYTES, HistoryBreadthError, HistoryBreadthRequestSchema,
  KrIntradayHistoryInputSchema, KrIntradayHistoryResultSchema, UsDailyHistoryInputSchema, UsDailyHistoryResultSchema,
  requestKrIntradayHistory, requestUsDailyHistory,
  type HistoryBreadthRequest, type HistoryBreadthResponse, type HistoryBreadthTransport,
} from '../src/history-breadth.js';

const NOW = '2026-10-22T02:00:00.123456789Z';
const usInput = { symbol: 'AAPL', exchange: 'NAS', basis_date: '20261021', adjustment_code: '1' };
const krInput = { symbol: '005930', board: 'J', anchor_time: '113000', include_past_data: 'Y' };
const usRow = (date = '20261021') => ({ xymd: date, open: '00120.120000000000000001', high: '130.000', low: '119.0', clos: '125.00001', tvol: '123456789012345678901234567890', tamt: '12345678901234567890.1234567890123456789', sign: '2', diff: '-0.00001', rate: '-0.01', pbid: '', vbid: '', pask: '125.01', vask: '10' });
const krRow = (time = '103000', date = '20261022') => ({ stck_bsop_date: date, stck_cntg_hour: time, stck_prpr: '0098000', stck_oprc: '98000', stck_hgpr: '98500', stck_lwpr: '97900', cntg_vol: '123456789012345678901234567890', acml_tr_pbmn: '987654321098765432109876543210' });
const usBody = () => ({ rt_cd: '0', msg_cd: 'MCA00000', msg1: 'SYNTHETIC ONLY', output1: { rsym: 'DNASAAPL', zdiv: '6', nrec: '125.75' }, output2: [usRow(), usRow('20261020')] });
const krBody = () => ({ rt_cd: '0', msg_cd: 'MCA00000', msg1: 'SYNTHETIC ONLY', output1: { stck_prpr: '98000', hts_kor_isnm: 'SYNTHETIC', prdy_vrss: '-500', prdy_vrss_sign: '5', prdy_ctrt: '-0.51', stck_prdy_clpr: '98500', acml_vol: '999999999999999999999999999999', acml_tr_pbmn: '999999999999999999999999999999' }, output2: [krRow(), krRow('102900')] });
function fake(body: unknown, overrides: Partial<HistoryBreadthResponse> = {}, origin: 'actual' | 'synthetic' = 'synthetic') {
  const requests: HistoryBreadthRequest[] = [];
  const transport: HistoryBreadthTransport = { origin, async send(request) { requests.push(request); return { status: 200, tr_cont: '', body, ...overrides }; } };
  return { requests, transport };
}
async function errorCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof HistoryBreadthError && error.code === code && error.message === code);
}
const cases = [
  { name: 'US', input: usInput, body: usBody, run: requestUsDailyHistory },
  { name: 'KR', input: krInput, body: krBody, run: requestKrIntradayHistory },
] as const;

test('US emits a single fixed daily read with explicit basis and adjustment flag', async () => {
  const f = fake(usBody());
  const r = await requestUsDailyHistory(usInput, f.transport, () => NOW);
  assert.deepEqual(f.requests, [{ operation: 'kis.us_daily_history', method: 'GET', path: '/uapi/overseas-price/v1/quotations/dailyprice', tr_id: 'HHDFS76240000', tr_cont: '', query: { AUTH: '', EXCD: 'NAS', SYMB: 'AAPL', GUBN: '0', BYMD: '20261021', MODP: '1' } }]);
  assert.deepEqual(r.raw, { output1: usBody().output1, output2: usBody().output2 });
  assert.deepEqual(r.requested, usInput);
  assert.equal(r.interval, '1d');
  assert.equal(r.raw.output2 instanceof Array && r.raw.output2[0]!.open, '00120.120000000000000001');
  assert.equal(r.bars_returned, 2);
  assert.equal(r.canonical.bars, null);
});
test('KR emits only the current-day endpoint, preserving all caller flags', async () => {
  const f = fake(krBody());
  const r = await requestKrIntradayHistory({ ...krInput, board: 'NX', include_past_data: 'N', expected_business_date: '20261022' }, f.transport, () => NOW);
  assert.deepEqual(f.requests, [{ operation: 'kis.kr_intraday_history', method: 'GET', path: '/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice', tr_id: 'FHKST03010200', tr_cont: '', query: { FID_COND_MRKT_DIV_CODE: 'NX', FID_INPUT_ISCD: '005930', FID_INPUT_HOUR_1: '113000', FID_PW_DATA_INCU_YN: 'N', FID_ETC_CLS_CODE: '' } }]);
  assert.equal(r.requested.expected_business_date, '20261022');
  assert.equal(r.scope, 'current_day_endpoint_not_historical_intraday');
  assert.equal(r.raw.output2[0]!.cntg_vol, '123456789012345678901234567890');
  assert.equal(r.first_row_volume_status, 'may_belong_to_previous_bar_until_first_trade');
  assert.equal(r.raw.output2[0]!.acml_tr_pbmn, '987654321098765432109876543210');
});
test('US stock/ETF exchange expectations stay caller inputs, and both adjustment flags stay raw', async () => {
  for (const exchange of ['NAS', 'NYS', 'AMS']) for (const adjustment_code of ['0', '1']) {
    const body = usBody(); body.output1.rsym = `D${exchange}BRK.B`;
    const r = await requestUsDailyHistory({ ...usInput, symbol: 'BRK.B', exchange, adjustment_code, asset_class: 'etf' }, fake(body).transport, () => NOW);
    assert.equal(r.requested.asset_class, 'etf'); assert.equal(r.requested.adjustment_code, adjustment_code);
    assert.equal(r.canonical.asset_class, null); assert.equal(r.canonical.adjusted, null);
    assert.equal(r.identity_status, 'conservative_rsym_guard_matched_not_master_verified');
  }
});
test('US raw shape variations accepted by the official helper are retained, not flattened', async () => {
  const body = usBody();
  for (const output1 of [body.output1, [body.output1]]) for (const output2 of [body.output2, body.output2[0]]) {
    const r = await requestUsDailyHistory(usInput, fake({ ...body, output1, output2 }).transport, () => NOW);
    assert.deepEqual(r.raw, { output1, output2 });
    assert.equal(r.bars_returned, Array.isArray(output2) ? 2 : 1);
  }
});
test('US nrec is not interpreted as count, and zdiv never rescales raw decimals', async () => {
  const r = await requestUsDailyHistory(usInput, fake(usBody()).transport, () => NOW);
  assert.ok(!Array.isArray(r.raw.output1));
  if (!Array.isArray(r.raw.output1)) assert.equal(r.raw.output1.nrec, '125.75');
  assert.equal(r.bars_returned, 2); assert.ok(Object.values(r.canonical).every(v => v === null));
});
test('KR board defaults to J, while invalid board and classification fields are rejected', async () => {
  const { board: _board, ...q } = krInput;
  const f = fake(krBody()); const r = await requestKrIntradayHistory(q, f.transport, () => NOW);
  assert.equal(r.requested.board, 'J');
  assert.equal(KrIntradayHistoryInputSchema.safeParse({ ...q, board: 'KOSPI' }).success, false);
  assert.equal(KrIntradayHistoryInputSchema.safeParse({ ...q, adjustment_code: '1' }).success, false);
});
test('KR provider labels may differ from the host UTC date without fabricated timezone attribution', async () => {
  const r = await requestKrIntradayHistory(krInput, fake(krBody()).transport, () => '2026-10-21T20:00:00Z');
  assert.equal(r.raw.output2[0]!.stck_bsop_date, '20261022');
  assert.equal(r.source_timezone, null); assert.equal(r.event_time, null); assert.equal(r.source_as_of, null);
});
test('future KR anchor times do not imply completed bars or volume repair', async () => {
  const body = krBody(); body.output2[0]!.cntg_vol = '00015';
  const r = await requestKrIntradayHistory({ ...krInput, anchor_time: '235959' }, fake(body).transport, () => NOW);
  assert.equal(r.raw.output2[0]!.cntg_vol, '00015'); assert.equal(r.finality, 'unknown');
  assert.ok(r.unimplemented_derivations.includes('five_minute_aggregation'));
  assert.ok(r.unimplemented_derivations.includes('hourly_aggregation'));
});
for (const c of cases) {
  test(`${c.name}: receipt clock runs exactly once after the awaited response`, async () => {
    const events: string[] = [];
    const t: HistoryBreadthTransport = { origin: 'synthetic', async send() { events.push('send'); await Promise.resolve(); events.push('body'); return { status: 200, tr_cont: '', body: c.body() }; } };
    const r = await c.run(c.input, t, () => { events.push('clock'); return NOW; });
    assert.deepEqual(events, ['send', 'body', 'clock']);
    assert.equal(r.received_at, NOW); assert.equal(r.available_at, NOW);
  });
  test(`${c.name}: all continuation variants preserve unknown completeness without extra calls`, async () => {
    for (const tr_cont of [null, '', 'D', 'E', 'M', 'F']) {
      const f = fake(c.body(), { tr_cont }); const r = await c.run(c.input, f.transport, () => NOW);
      assert.equal(f.requests.length, 1); assert.equal(r.pagination.tr_cont, tr_cont);
      assert.equal(r.pagination.status, tr_cont === 'M' || tr_cont === 'F' ? 'more_signaled_not_fetched' : 'not_signaled_completeness_unknown');
      assert.equal(r.pagination.automatic_continuation, false); assert.equal(r.completeness, 'unknown');
    }
  });
  test(`${c.name}: raw empty page is not proof of no history`, async () => {
    const r = await c.run(c.input, fake({ ...c.body(), output2: [] }).transport, () => NOW);
    assert.equal(r.bars_returned, 0); assert.equal(r.coverage_status, 'empty_page_not_proof_of_absence');
    assert.equal(r.completeness, 'unknown');
  });
  test(`${c.name}: provenance gates remain closed for both injected origins`, async () => {
    for (const origin of ['actual', 'synthetic'] as const) {
      const r = await c.run(c.input, fake(c.body(), {}, origin).transport, () => NOW);
      assert.equal(r.origin, origin); assert.equal(r.rights_status, 'pending'); assert.equal(r.canonical_projection_status, 'blocked');
      assert.equal(r.validation_status, 'provider_shape_checked_not_live_reconciled');
      assert.ok(Object.values(r.canonical).every(v => v === null));
      assert.equal(r.session, 'unknown'); assert.equal(r.freshness, 'unknown'); assert.equal(r.delay_state, 'unknown');
    }
  });
  test(`${c.name}: no transport cannot trigger network or access credentials`, async () => {
    const fetch = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('must not run'); };
    try { await errorCode(c.run(c.input), 'transport_not_configured'); assert.equal(calls, 0); }
    finally { globalThis.fetch = fetch; }
  });
  test(`${c.name}: transport exception details are sanitized and clock is not sampled`, async () => {
    let clocks = 0;
    await errorCode(c.run(c.input, { origin: 'synthetic', async send() { throw new Error('secret should not leak'); } }, () => { clocks++; return NOW; }), 'upstream_unavailable');
    assert.equal(clocks, 0);
  });
  test(`${c.name}: HTTP errors are stable and do not leak provider text`, async () => {
    for (const [status, code] of [[429, 'rate_limited'], [401, 'auth_expired'], [403, 'auth_expired'], [500, 'upstream_unavailable'], [302, 'upstream_unavailable']] as const) {
      await errorCode(c.run(c.input, fake({ error: 'sensitive error text' }, { status }).transport, () => NOW), code);
    }
    await errorCode(c.run(c.input, fake({ ...c.body(), rt_cd: '1', msg1: 'secret upstream details' }).transport, () => NOW), 'upstream_rejected');
  });
  test(`${c.name}: invalid transport, clock, continuation, envelope and status fail closed`, async () => {
    await errorCode(c.run(c.input, { ...fake(c.body()).transport, origin: 'live' } as unknown as HistoryBreadthTransport), 'invalid_input');
    await errorCode(c.run(c.input, fake(c.body()).transport, () => '2026-02-30T00:00:00Z'), 'invalid_input');
    await errorCode(c.run(c.input, fake(c.body()).transport, () => { throw new Error('clock'); }), 'invalid_input');
    await errorCode(c.run(c.input, fake(c.body(), { tr_cont: 'N' }).transport, () => NOW), 'schema_drift');
    await errorCode(c.run(c.input, fake(c.body(), { status: 200.5 }).transport, () => NOW), 'schema_drift');
    await errorCode(c.run(c.input, fake({ ...c.body(), rt_cd: 0 }).transport, () => NOW), 'schema_drift');
    await errorCode(c.run(c.input, fake({ ...c.body(), unknown_extension: 'review required' }).transport, () => NOW), 'schema_drift');
  });
  test(`${c.name}: request and query are immutable to the injected transport`, async () => {
    const transport: HistoryBreadthTransport = { origin: 'synthetic', async send(request) {
      assert.equal(Object.isFrozen(request), true); assert.equal(Object.isFrozen(request.query), true);
      assert.throws(() => { (request.query as Record<string, string>).MALICIOUS = 'injected'; });
      return { status: 200, tr_cont: '', body: c.body() };
    } };
    await c.run(c.input, transport, () => NOW);
  });
  test(`${c.name}: response accessors, cycles, exotic values and excess depth are rejected without execution`, async () => {
    let getterCalls = 0;
    const hostile = { ...c.body(), get token() { getterCalls++; return 'secret'; } };
    await errorCode(c.run(c.input, fake(hostile).transport, () => NOW), 'schema_drift'); assert.equal(getterCalls, 0);
    const cyc: Record<string, unknown> = {}; cyc.self = cyc;
    for (const body of [cyc, new Date(), { x: BigInt(1) }, { x: NaN }, { x: () => 1 }, { [Symbol('x')]: 1 }]) await errorCode(c.run(c.input, fake(body).transport, () => NOW), 'schema_drift');
    let deep: unknown = 1; for (let i = 0; i < 12; i++) deep = { next: deep };
    await errorCode(c.run(c.input, fake(deep).transport, () => NOW), 'response_too_large');
  });
  test(`${c.name}: response size bound and unknown raw fields never get silently trimmed`, async () => {
    await errorCode(c.run(c.input, fake({ ...c.body(), msg1: 'x'.repeat(HISTORY_BREADTH_MAX_RESPONSE_BYTES + 1) }).transport, () => NOW), 'response_too_large');
    await errorCode(c.run(c.input, fake({ ...c.body(), output1: { ...c.body().output1, secret_or_new_field: 'unexpected' } }).transport, () => NOW), 'schema_drift');
  });
  test(`${c.name}: malicious caller objects cannot execute getters or add provider parameters`, async () => {
    let getters = 0; const f = fake(c.body());
    const caller = { ...c.input, get auth() { getters++; return 'secret'; } };
    await errorCode(c.run(caller, f.transport, () => NOW), 'invalid_input');
    await errorCode(c.run({ ...c.input, account: 'unrequested' }, f.transport, () => NOW), 'invalid_input');
    assert.equal(getters, 0); assert.equal(f.requests.length, 0);
  });
  test(`${c.name}: results are detached snapshots, not mutable provider body aliases`, async () => {
    const body = c.body(); const r = await c.run(c.input, fake(body).transport, () => NOW);
    const before = JSON.stringify(r.raw); body.output2.length = 0;
    assert.equal(JSON.stringify(r.raw), before);
  });
}
test('date and time inputs reject invalid calendar dates and unsupported intervals before sending', async () => {
  for (const basis_date of ['', '20260229', '20260431', '20261301', '18991231', '2026-10-22']) {
    const f = fake(usBody()); await errorCode(requestUsDailyHistory({ ...usInput, basis_date }, f.transport), 'invalid_input'); assert.equal(f.requests.length, 0);
  }
  for (const anchor_time of ['', '240000', '236000', '235960', '09:00:00', '90000']) {
    const f = fake(krBody()); await errorCode(requestKrIntradayHistory({ ...krInput, anchor_time }, f.transport), 'invalid_input'); assert.equal(f.requests.length, 0);
  }
  assert.equal(UsDailyHistoryInputSchema.safeParse({ ...usInput, basis_date: '20240229' }).success, true);
  assert.equal(UsDailyHistoryInputSchema.safeParse({ ...usInput, interval: '1h' }).success, false);
  assert.equal(KrIntradayHistoryInputSchema.safeParse({ ...krInput, interval: '5m' }).success, false);
});
test('US requested identity and basis-date guards reject unrelated or future rows', async () => {
  const body = usBody(); body.output1.rsym = 'DNASMSFT';
  await errorCode(requestUsDailyHistory(usInput, fake(body).transport, () => NOW), 'instrument_mismatch');
  await errorCode(requestUsDailyHistory(usInput, fake({ ...usBody(), output2: [usRow('20261022')] }).transport, () => NOW), 'bar_context_mismatch');
});
test('KR expected date is an optional guard; mixed-day payloads never pass a same-day contract', async () => {
  await errorCode(requestKrIntradayHistory({ ...krInput, expected_business_date: '20261021' }, fake(krBody()).transport, () => NOW), 'bar_context_mismatch');
  await errorCode(requestKrIntradayHistory(krInput, fake({ ...krBody(), output2: [krRow(), krRow('102900', '20261021')] }).transport, () => NOW), 'bar_context_mismatch');
});
test('duplicate bars reject without hidden deduplication; input order is otherwise preserved', async () => {
  await errorCode(requestUsDailyHistory(usInput, fake({ ...usBody(), output2: [usRow(), usRow()] }).transport, () => NOW), 'duplicate_bar');
  await errorCode(requestKrIntradayHistory(krInput, fake({ ...krBody(), output2: [krRow(), krRow()] }).transport, () => NOW), 'duplicate_bar');
  const output2 = [usRow('20261020'), usRow('20261018'), usRow('20261021')];
  const r = await requestUsDailyHistory(usInput, fake({ ...usBody(), output2 }).transport, () => NOW);
  assert.deepEqual(r.raw.output2, output2);
});
test('row bounds are enforced without silent truncation at 100 US and 30 KR', async () => {
  const usRows = Array.from({ length: 100 }, (_, i) => usRow(new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10).replaceAll('-', '')));
  const krRows = Array.from({ length: 30 }, (_, i) => krRow(`10${String(i).padStart(2, '0')}00`));
  assert.equal((await requestUsDailyHistory(usInput, fake({ ...usBody(), output2: usRows }).transport, () => NOW)).bars_returned, 100);
  assert.equal((await requestKrIntradayHistory(krInput, fake({ ...krBody(), output2: krRows }).transport, () => NOW)).bars_returned, 30);
  await errorCode(requestUsDailyHistory(usInput, fake({ ...usBody(), output2: [...usRows, usRow()] }).transport, () => NOW), 'schema_drift');
  await errorCode(requestKrIntradayHistory(krInput, fake({ ...krBody(), output2: [...krRows, krRow('103100')] }).transport, () => NOW), 'schema_drift');
});
test('blank numeric fields remain blank, but numbers, exponent notation and signed volume reject', async () => {
  const blankUs = { ...usRow(), open: '', high: '', low: '', clos: '', tvol: '', tamt: '' };
  const blankKr = { ...krRow(), stck_prpr: '', stck_oprc: '', stck_hgpr: '', stck_lwpr: '', cntg_vol: '' };
  assert.deepEqual((await requestUsDailyHistory(usInput, fake({ ...usBody(), output2: [blankUs] }).transport, () => NOW)).raw.output2, [blankUs]);
  assert.deepEqual((await requestKrIntradayHistory(krInput, fake({ ...krBody(), output2: [blankKr] }).transport, () => NOW)).raw.output2, [blankKr]);
  for (const tvol of [123, '1e3', '-1', '1.5', '9'.repeat(31)]) await errorCode(requestUsDailyHistory(usInput, fake({ ...usBody(), output2: [{ ...usRow(), tvol }] }).transport, () => NOW), 'schema_drift');
  for (const stck_prpr of [123, 'NaN', 'Infinity', '1e2', '-1', '1'.repeat(41)]) await errorCode(requestKrIntradayHistory(krInput, fake({ ...krBody(), output2: [{ ...krRow(), stck_prpr }] }).transport, () => NOW), 'schema_drift');
});
test('invalid response calendar dates, times and missing raw values fail closed', async () => {
  await errorCode(requestUsDailyHistory(usInput, fake({ ...usBody(), output2: [usRow('20260229')] }).transport, () => NOW), 'schema_drift');
  await errorCode(requestKrIntradayHistory(krInput, fake({ ...krBody(), output2: [krRow('246060')] }).transport, () => NOW), 'schema_drift');
  const { clos: _clos, ...row } = usRow();
  await errorCode(requestUsDailyHistory(usInput, fake({ ...usBody(), output2: [row] }).transport, () => NOW), 'schema_drift');
});
test('exact result schemas reject provenance, pagination, identity and canonical tampering', async () => {
  const us = await requestUsDailyHistory(usInput, fake(usBody()).transport, () => NOW);
  const kr = await requestKrIntradayHistory(krInput, fake(krBody()).transport, () => NOW);
  for (const [schema, result] of [[UsDailyHistoryResultSchema, us], [KrIntradayHistoryResultSchema, kr]] as const) {
    for (const change of [
      { received_at: 'not-an-instant' }, { available_at: '2026-10-22T02:00:00.123456788Z' },
      { bars_returned: 0 }, { coverage_status: 'empty_page_not_proof_of_absence' }, { rights_status: 'approved' },
      { source_timezone: 'Asia/Seoul' }, { canonical: { ...result.canonical, bars: [] } },
      { pagination: { ...result.pagination, status: 'more_signaled_not_fetched' } },
    ]) assert.equal(schema.safeParse({ ...result, ...change }).success, false);
    // Equivalent offset representation is still the same exact instant.
    assert.equal(schema.safeParse({ ...result, available_at: '2026-10-22T11:00:00.123456789+09:00' }).success, true);
  }
  assert.equal(UsDailyHistoryResultSchema.safeParse({ ...us, requested: { ...us.requested, symbol: 'MSFT' } }).success, false);
  assert.equal(KrIntradayHistoryResultSchema.safeParse({ ...kr, requested: { ...kr.requested, expected_business_date: '20261021' } }).success, false);
});
test('request schemas expose only bounded read paths and result schemas export JSON Schema', () => {
  assert.equal(HistoryBreadthRequestSchema.safeParse({ operation: 'order', method: 'POST', path: '/trading/order' }).success, false);
  for (const schema of [UsDailyHistoryInputSchema, KrIntradayHistoryInputSchema, UsDailyHistoryResultSchema, KrIntradayHistoryResultSchema]) {
    const json = z.toJSONSchema(schema); assert.equal(json.type, 'object'); assert.equal(json.additionalProperties, false);
    assert.ok(JSON.stringify(json).length > 100);
  }
});


test('US reported rate preserves explicit plus sign but rejects malformed numeric forms',async()=>{
 const body=usBody();body.output2[0]!.rate='+0.25';
 const r=await requestUsDailyHistory(usInput,fake(body).transport,()=>NOW);
 assert.ok(Array.isArray(r.raw.output2));assert.equal(r.raw.output2[0]!.rate,'+0.25');assert.equal(r.canonical.bars,null);
 body.output2[0]!.rate='+1e3';await errorCode(requestUsDailyHistory(usInput,fake(body).transport,()=>NOW),'schema_drift');
});

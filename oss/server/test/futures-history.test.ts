import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import * as f from '../src/futures-history.js';
import * as fx from './futures-history-fixtures.js';
const clock = () => fx.receipt;
const isCode = (code: f.FuturesHistoryErrorCode) => (e: unknown) => e instanceof f.FuturesHistoryError && e.code === code && e.message === code;
const readers = [
  { name: 'domestic daily', read: f.requestKrFuturesDailyHistory, input: fx.dailyInput, body: fx.dailyBody, operation: 'kis.kr_futures_daily_history', schema: f.KrFuturesDailyHistoryResultSchema, rows: 100 },
  { name: 'domestic minute', read: f.requestKrFuturesMinuteHistory, input: fx.minuteInput, body: fx.minuteBody, operation: 'kis.kr_futures_minute_history', schema: f.KrFuturesMinuteHistoryResultSchema, rows: 102 },
  { name: 'overseas daily', read: f.requestOverseasFuturesDailyHistory, input: fx.overseasDailyInput, body: fx.overseasDailyBody, operation: 'kis.overseas_futures_daily_history', schema: f.OverseasFuturesDailyHistoryResultSchema, rows: 40 },
  { name: 'overseas minute', read: f.requestOverseasFuturesMinuteHistory, input: fx.overseasMinuteInput, body: fx.overseasMinuteBody, operation: 'kis.overseas_futures_minute_history', schema: f.OverseasFuturesMinuteHistoryResultSchema, rows: 120 },
];
for (const r of readers) {
  test(`${r.name}: raw lexical identity and all epistemic gates`, async () => {
    const out = await r.read(r.input, fx.transport(r.body), clock);
    assert.deepEqual(out.raw, r.body); assert.equal(out.origin, 'synthetic'); assert.equal(out.received_at, fx.receipt); assert.equal(out.available_at, fx.receipt);
    assert.ok(Object.values(out.canonical).every(v => v === null));
    assert.equal(out.source_as_of, null); assert.equal(out.source_timezone, null); assert.equal(out.source_commit, f.FUTURES_HISTORY_SOURCE_COMMIT);
    for (const key of ['session', 'delay_state', 'finality', 'freshness', 'completeness'] as const) assert.equal(out[key], 'unknown');
    assert.equal(out.rights_status, 'pending'); assert.equal(out.bars_returned, 2); assert.equal(out.row_order_status, 'provider_order_preserved_no_sort_dedup_or_resample');
    assert.ok(r.schema.safeParse(out).success);
  });
  test(`${r.name}: freezes fixed request and isolates caller/transport mutations before await`, async () => {
    const input = structuredClone(r.input); let ready = false, clockCalls = 0, sends = 0;
    const t: f.FuturesHistoryTransport = { origin: 'synthetic', async send(req) {
      sends++; assert.ok(Object.isFrozen(req)); assert.ok(Object.isFrozen(req.query));
      assert.equal(req.operation, r.operation); assert.equal(req.method, 'GET'); assert.equal(req.tr_cont, '');
      assert.ok(f.FuturesHistoryRequestSchema.safeParse(req).success);
      assert.throws(() => { (req.query as Record<string, string>).MALICIOUS = 'order'; }, TypeError);
      (input as { symbol: string }).symbol = 'MUTATED';
      (t as { origin: string }).origin = 'actual';
      await Promise.resolve(); ready = true; return fx.response(r.body);
    } };
    const out = await r.read(input, t, () => { assert.ok(ready); clockCalls++; return fx.receipt; });
    assert.equal(clockCalls, 1); assert.equal(sends, 1); assert.equal(out.requested.symbol, r.input.symbol); assert.equal(out.origin, 'synthetic');
  });
  test(`${r.name}: no implicit live fallback`, async () => { await assert.rejects(r.read(r.input), isCode('transport_not_configured')); });
  test(`${r.name}: input rejects URL/header/order/account/continuation/extra keys before transport`, async () => {
    for (const extra of [{ url: 'https://example.invalid' }, { headers: { authorization: 'not-a-secret' } }, { CANO: '123456' }, { method: 'POST' }, { index_key: 'x' }, { QRY_TP: 'P' }, { unknown: 1 }]) {
      let calls = 0; await assert.rejects(r.read({ ...r.input, ...extra }, { origin: 'synthetic', async send() { calls++; return fx.response(r.body); } }, clock), isCode('invalid_input')); assert.equal(calls, 0);
    }
  });
  test(`${r.name}: empty page is never evidence of absence`, async () => {
    const out = await r.read(r.input, fx.transport({ ...r.body, output2: [] }), clock);
    assert.equal(out.bars_returned, 0); assert.equal(out.coverage_status, 'empty_page_not_proof_of_absence'); assert.equal(out.completeness, 'unknown');
  });
  test(`${r.name}: duplicate rows survive in provider order`, async () => {
    const body = { ...r.body, output2: [r.body.output2[1], r.body.output2[0], r.body.output2[1]] };
    const out = await r.read(r.input, fx.transport(body), clock);
    assert.deepEqual(out.raw, body); assert.equal(out.duplicate_label_status, 'duplicate_labels_retained'); assert.equal(out.bars_returned, 3);
  });
  test(`${r.name}: one page only for M/F and unknown completeness for every terminal code`, async () => {
    for (const tr_cont of ['M', 'F', '', 'D', 'E', null]) {
      let calls = 0;
      const out = await r.read(r.input, { origin: 'synthetic', async send() { calls++; return fx.response(r.body, tr_cont); } }, clock);
      assert.equal(calls, 1); assert.equal(out.pagination.tr_cont, tr_cont); assert.equal(out.pagination.automatic_continuation, false); assert.equal(out.pagination.completeness, 'unknown');
      if (tr_cont === 'M' || tr_cont === 'F') assert.equal(out.pagination.status, 'more_signaled_not_fetched');
    }
  });
  test(`${r.name}: row cap rejects oversized page`, async () => {
    await assert.rejects(r.read(r.input, fx.transport({ ...r.body, output2: Array.from({ length: r.rows + 1 }, () => r.body.output2[0]) }), clock), isCode('schema_drift'));
  });
  test(`${r.name}: rejects unknown/number/invalid-date raw fields, never silently strips/coerces`, async () => {
    const field = r.name.startsWith('domestic') ? 'futs_prpr' : 'last_price';
    const date = r.name.startsWith('domestic') ? 'stck_bsop_date' : 'data_date';
    for (const extra of [{ unknown: 'new' }, { [field]: 1.25 }, { [field]: 'NaN' }, { [field]: '1e2' }, { [date]: '20260230' }]) {
      const body = { ...r.body, output2: [{ ...r.body.output2[0], ...extra }] };
      await assert.rejects(r.read(r.input, fx.transport(body), clock), isCode('schema_drift'));
    }
  });
  test(`${r.name}: HTTP failures and provider rejection stay redacted`, async () => {
    for (const [status, code] of [[429, 'rate_limited'], [401, 'auth_expired'], [403, 'auth_expired'], [503, 'upstream_unavailable']] as const) {
      await assert.rejects(r.read(r.input, { origin: 'synthetic', async send() { return { status, tr_cont: '', body: { rt_cd: '1', msg1: 'SENSITIVE-DO-NOT-ECHO' } }; } }, clock), isCode(code));
    }
    await assert.rejects(r.read(r.input, fx.transport({ rt_cd: '1', msg1: 'SENSITIVE-DO-NOT-ECHO' }), clock), isCode('upstream_rejected'));
    await assert.rejects(r.read(r.input, { origin: 'synthetic', async send() { throw new Error('SENSITIVE-DO-NOT-ECHO'); } }, clock), isCode('upstream_unavailable'));
  });
  test(`${r.name}: exact result invariants reject tampering`, async () => {
    const out = await r.read(r.input, fx.transport(r.body), clock);
    for (const changed of [
      { ...out, bars_returned: 0 }, { ...out, available_at: '2026-10-22T03:00:00.123456789124Z' },
      { ...out, source_as_of: fx.receipt }, { ...out, canonical: { ...out.canonical, currency: 'USD' } },
      { ...out, completeness: 'complete' }, { ...out, duplicate_label_status: 'duplicate_labels_retained' },
      { ...out, pagination: { ...out.pagination, provider_cursor: 'MUTATED' } },
    ]) assert.equal(r.schema.safeParse(changed).success, false);
    assert.doesNotThrow(() => r.schema.safeParse({ ...out, received_at: 'nonsense' }));
    assert.equal(r.schema.safeParse({ ...out, received_at: 'nonsense' }).success, false);
  });
}

test('fixed endpoint/query codes exactly match the pinned official first-page contracts', async () => {
  const seen: f.FuturesHistoryRequest[] = [];
  for (const r of readers) await r.read(r.input, { origin: 'synthetic', async send(req) { seen.push(req); return fx.response(r.body); } }, clock);
  assert.deepEqual(seen.map(r => [r.path, r.tr_id]), [
    ['/uapi/domestic-futureoption/v1/quotations/inquire-daily-fuopchartprice', 'FHKIF03020100'],
    ['/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice', 'FHKIF03020200'],
    ['/uapi/overseas-futureoption/v1/quotations/daily-ccnl', 'HHDFC55020100'],
    ['/uapi/overseas-futureoption/v1/quotations/inquire-time-futurechartprice', 'HHDFC55020400'],
  ]);
  assert.deepEqual(seen[0]!.query, { FID_COND_MRKT_DIV_CODE: 'F', FID_INPUT_ISCD: '101W09', FID_INPUT_DATE_1: '20250301', FID_INPUT_DATE_2: '20250331', FID_PERIOD_DIV_CODE: 'D' });
  assert.deepEqual(seen[1]!.query, { FID_COND_MRKT_DIV_CODE: 'F', FID_INPUT_ISCD: '101T12', FID_HOUR_CLS_CODE: '60', FID_PW_DATA_INCU_YN: 'Y', FID_FAKE_TICK_INCU_YN: 'N', FID_INPUT_DATE_1: '20230901', FID_INPUT_HOUR_1: '100000' });
  assert.deepEqual(seen[2]!.query, { SRS_CD: 'CLM26', EXCH_CD: 'NYMEX', START_DATE_TIME: '', CLOSE_DATE_TIME: '20261021', QRY_TP: 'Q', QRY_CNT: '30', QRY_GAP: '', INDEX_KEY: '' });
  assert.deepEqual(seen[3]!.query, { SRS_CD: 'BONU25', EXCH_CD: 'EUREX', START_DATE_TIME: '', CLOSE_DATE_TIME: '20250702', QRY_TP: 'Q', QRY_CNT: '120', QRY_GAP: '5', INDEX_KEY: '' });
});
test('unresolved overseas-minute continuation conflicts fail before touching actual or synthetic transport', async () => {
  for (const origin of ['actual', 'synthetic'] as const) {
    let calls = 0;
    const t: f.FuturesHistoryTransport = { origin, async send() { calls++; return fx.response(fx.overseasMinuteBody); } };
    await assert.rejects(f.requestOverseasFuturesMinuteContinuation({ symbol: 'BONU25', exchange: 'EUREX', provider_cursor: 'SYNTHETIC' }, t), isCode('source_contract_conflict')); assert.equal(calls, 0);
  }
});
test('overseas minute first-page is supported for non-US exchange without claiming a listing', async () => {
  const out = await f.requestOverseasFuturesMinuteHistory(fx.overseasMinuteInput, fx.transport(fx.overseasMinuteBody), clock);
  assert.equal(out.requested.exchange, 'EUREX'); assert.equal(out.geographical_scope_status, 'overseas_contract_us_listing_not_verified');
  assert.equal(out.canonical.country, null); assert.equal(out.canonical.exchange, null); assert.equal(out.continuation_contract_status, 'blocked_official_index_key_location_conflict');
});
test('overseas raw object/array forms retained, header count strings remain uninterpreted', async () => {
  for (const r of readers.slice(2)) {
    const body = { ...r.body, output1: [{ ...r.body.output1, last_n_cnt: '009999' }], output2: r.body.output2[0] };
    const out = await r.read(r.input, fx.transport(body), clock); assert.deepEqual(out.raw, body); assert.equal(out.bars_returned, 1);
  }
});
test('daily tret_cnt is not silently aliased to minute ret_cnt or vice versa', async () => {
  await assert.rejects(f.requestOverseasFuturesDailyHistory(fx.overseasDailyInput, fx.transport({ ...fx.overseasDailyBody, output1: { ret_cnt: '2', index_key: '' } }), clock), isCode('schema_drift'));
  await assert.rejects(f.requestOverseasFuturesMinuteHistory(fx.overseasMinuteInput, fx.transport({ ...fx.overseasMinuteBody, output1: { tret_cnt: '2', index_key: '' } }), clock), isCode('schema_drift'));
});
test('strict daily/minute inputs reject unsupported periods, second bars, dates, counts and options', async () => {
  const cases: [typeof f.requestKrFuturesDailyHistory | typeof f.requestKrFuturesMinuteHistory | typeof f.requestOverseasFuturesDailyHistory | typeof f.requestOverseasFuturesMinuteHistory, unknown][] = [
    [f.requestKrFuturesDailyHistory, { ...fx.dailyInput, period: 'M' }], [f.requestKrFuturesDailyHistory, { ...fx.dailyInput, start_date: '20250401' }],
    [f.requestKrFuturesDailyHistory, { ...fx.dailyInput, end_date: '20250229' }], [f.requestKrFuturesDailyHistory, { ...fx.dailyInput, symbol: '201W09' }],
    [f.requestKrFuturesMinuteHistory, { ...fx.minuteInput, interval_seconds: '30' }], [f.requestKrFuturesMinuteHistory, { ...fx.minuteInput, anchor_time: '240000' }],
    [f.requestOverseasFuturesDailyHistory, { ...fx.overseasDailyInput, count: '41' }], [f.requestOverseasFuturesDailyHistory, { ...fx.overseasDailyInput, count: '00' }],
    [f.requestOverseasFuturesDailyHistory, { ...fx.overseasDailyInput, period: '1m' }], [f.requestOverseasFuturesDailyHistory, { ...fx.overseasDailyInput, symbol: 'CL=F' }],
    [f.requestOverseasFuturesMinuteHistory, { ...fx.overseasMinuteInput, count: '119' }], [f.requestOverseasFuturesMinuteHistory, { ...fx.overseasMinuteInput, interval_minutes: '7' }],
    [f.requestOverseasFuturesMinuteHistory, { ...fx.overseasMinuteInput, start_date: '20250101' }],
  ];
  for (const [reader, input] of cases) await assert.rejects(reader(input), isCode('invalid_input'));
});
test('daily dates and domestic returned short code have local mismatch guards', async () => {
  await assert.rejects(f.requestKrFuturesDailyHistory(fx.dailyInput, fx.transport({ ...fx.dailyBody, output1: { futs_shrn_iscd: '101W12' } }), clock), isCode('instrument_mismatch'));
  await assert.rejects(f.requestKrFuturesMinuteHistory(fx.minuteInput, fx.transport({ ...fx.minuteBody, output1: { futs_shrn_iscd: '101W12' } }), clock), isCode('instrument_mismatch'));
  await assert.rejects(f.requestKrFuturesDailyHistory(fx.dailyInput, fx.transport({ ...fx.dailyBody, output2: [{ ...fx.dailyBody.output2[0], stck_bsop_date: '20250401' }] }), clock), isCode('bar_context_mismatch'));
  await assert.rejects(f.requestOverseasFuturesDailyHistory({ ...fx.overseasDailyInput, count: '1' }, fx.transport(fx.overseasDailyBody), clock), isCode('bar_context_mismatch'));
});
test('minute date/time labels are not sorted, timezoned or compared as market instants', async () => {
  const out = await f.requestKrFuturesMinuteHistory(fx.minuteInput, fx.transport(fx.minuteBody), clock);
  assert.equal(out.raw.output2[1]!.stck_bsop_date, '20230831'); assert.equal(out.raw.output2[1]!.stck_cntg_hour, '235900'); assert.equal(out.event_time, null);
});
for (const badClock of [() => '', () => '2026-10-22', () => '2026-02-30T00:00:00Z', () => { throw new Error('not echoed'); }]) {
  test('invalid/throwing post-await receipt clock fails without substituting provider time', async () => {
    await assert.rejects(f.requestKrFuturesDailyHistory(fx.dailyInput, fx.transport(fx.dailyBody), badClock), isCode('invalid_input'));
  });
}
test('hostile inputs never evaluate accessors, proxy traps, toJSON, or prototype payloads', async () => {
  let hits = 0;
  const getter = Object.defineProperty({}, 'symbol', { enumerable: true, get() { hits++; return '101W09'; } });
  const proxy = new Proxy(fx.dailyInput, { ownKeys() { hits++; throw new Error('trap'); } });
  const json = { ...fx.dailyInput, toJSON() { hits++; return fx.dailyInput; } };
  const hidden = Object.defineProperty({ ...fx.dailyInput }, 'hidden', { value: 1 });
  for (const input of [getter, proxy, json, hidden, new Date(), { ...fx.dailyInput, [Symbol('hidden')]: 1 }]) await assert.rejects(f.requestKrFuturesDailyHistory(input), isCode('invalid_input'));
  assert.equal(hits, 0);
});
test('hostile response bodies fail bounded and never execute getters/proxy traps/toJSON', async () => {
  let hits = 0;
  const accessor = Object.defineProperty({}, 'output1', { enumerable: true, get() { hits++; return {}; } });
  const proxy = new Proxy(fx.dailyBody, { ownKeys() { hits++; throw new Error('trap'); } });
  const withJSON = { ...fx.dailyBody, toJSON() { hits++; return fx.dailyBody; } };
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const sparse = new Array(100);
  const enormous = new Array(2 ** 32 - 1);
  const extraArray = [1]; Object.assign(extraArray, { hidden: 'extra' });
  const hidden = Object.defineProperty({ ...fx.dailyBody }, 'hidden', { value: 'bad' });
  for (const body of [accessor, proxy, withJSON, cycle, sparse, extraArray, hidden, new Date(), { bad: NaN }, { bad: 1n }, { bad: Symbol('bad') }]) {
    await assert.rejects(f.requestKrFuturesDailyHistory(fx.dailyInput, { origin: 'synthetic', async send() { return fx.response(body); } }, clock), isCode('schema_drift'));
  }
  for (const body of [enormous, { huge: '한'.repeat(100001) }, { huge: '"'.repeat(200000) }]) {
    await assert.rejects(f.requestKrFuturesDailyHistory(fx.dailyInput, { origin: 'synthetic', async send() { return fx.response(body); } }, clock), isCode('response_too_large'));
  }
  assert.equal(hits, 0);
});
test('response envelope accessors rejected before status/body getters execute', async () => {
  let hits = 0;
  const response = Object.defineProperty({ tr_cont: '', body: fx.dailyBody }, 'status', { enumerable: true, get() { hits++; return 200; } });
  await assert.rejects(f.requestKrFuturesDailyHistory(fx.dailyInput, { origin: 'synthetic', async send() { return response as f.FuturesHistoryResponse; } }, clock), isCode('schema_drift')); assert.equal(hits, 0);
});
test('unknown continuation, invalid envelope and unsupported shapes fail closed', async () => {
  for (const t of [fx.transport(fx.dailyBody, 'N'), fx.transport({ ...fx.dailyBody, unrelated: 'x' }), fx.transport({ ...fx.dailyBody, output1: [fx.dailyBody.output1] }), fx.transport({ ...fx.dailyBody, output2: fx.dailyBody.output2[0] })]) {
    await assert.rejects(f.requestKrFuturesDailyHistory(fx.dailyInput, t, clock), isCode('schema_drift'));
  }
});
test('request schema cannot be relabeled as POST/order/other endpoint nor add headers', async () => {
  let req: unknown;
  await f.requestKrFuturesDailyHistory(fx.dailyInput, { origin: 'synthetic', async send(r) { req = r; return fx.response(fx.dailyBody); } }, clock);
  for (const extra of [{ method: 'POST' }, { path: '/uapi/domestic-futureoption/v1/trading/order' }, { tr_id: 'MUTATED' }, { headers: {} }, { operation: 'kis.orders' }]) {
    assert.equal(f.FuturesHistoryRequestSchema.safeParse({ ...req as object, ...extra }).success, false);
  }
});
test('all JSON schemas can be exported; runtime remains authoritative for semantic refinements', () => {
  for (const r of readers) assert.equal(z.toJSONSchema(r.schema).type, 'object');
});

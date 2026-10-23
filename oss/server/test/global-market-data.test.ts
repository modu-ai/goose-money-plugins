import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  DomesticEtfQuoteInputSchema, DomesticEtfQuoteResultSchema, requestDomesticEtfQuote,
  FuturesQuoteInputSchema, FuturesQuoteResultSchema, GlobalMarketRequestSchema, GlobalMarketError,
  boundedBody, UsQuoteInputSchema, UsQuoteResultSchema, requestFuturesQuote, requestUsQuote,
  type GlobalMarketRequest, type GlobalMarketTransport, type GlobalMarketResponse,
} from '../src/global-market-data.js';

const NOW = '2026-10-22T02:00:00.000Z';
const usInput = { symbol: 'AAPL', exchange: 'NAS' };
const futuresInput = { symbol: '101W09' };
const usBody = () => ({ rt_cd: '0', msg_cd: 'MCA00000', msg1: 'synthetic', output: {
  rsym: 'DNASAAPL', zdiv: '4', base: '245.0000', pvol: '123456789012345678901', last: '246.1234',
  sign: '2', diff: '1.1234', rate: '0.46', tvol: '123456789012345678902', tamt: '123456789012345678901.1234', ordy: 'Y',
} });
const futuresBody = () => ({ rt_cd: '0', output1: {
  hts_kor_isnm: 'SYNTHETIC INDEX FUTURE', futs_prpr: '350.25', futs_prdy_vrss: '-0.50', futs_prdy_ctrt: '-0.14',
  prdy_vrss_sign: '5', acml_vol: '999999999999999999', acml_tr_pbmn: '88888888888888888888',
  hts_otst_stpl_qty: '123456', otst_stpl_qty_icdc: '-5', futs_last_tr_date: '20260910', basis: '-0.25',
}, output2: {}, output3: { bstp_cls_code: '2001', hts_kor_isnm: 'SYNTHETIC UNDERLYING', bstp_nmix_prpr: '350.50' } });
function fake(body: unknown, overrides: Partial<GlobalMarketResponse> = {}, origin: 'actual' | 'synthetic' = 'synthetic') {
  const requests: GlobalMarketRequest[] = [];
  const transport: GlobalMarketTransport = { origin, async send(request) { requests.push(request); return { status: 200, tr_cont: '', body, ...overrides }; } };
  return { transport, requests };
}
async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof GlobalMarketError && error.code === code && error.message === code);
}

test('US stock snapshot emits the exact fixed read-only request and lossless raw values', async () => {
  const fixture = fake(usBody());
  const result = await requestUsQuote(usInput, fixture.transport, () => NOW);
  assert.deepEqual(fixture.requests, [{ operation: 'kis.us_quote', method: 'GET', path: '/uapi/overseas-price/v1/quotations/price', tr_id: 'HHDFS00000300', query: { AUTH: '', EXCD: 'NAS', SYMB: 'AAPL' } }]);
  assert.equal(result.raw.last, '246.1234');
  assert.equal(result.raw.tvol, '123456789012345678902');
  assert.equal(result.raw.tamt, '123456789012345678901.1234');
  assert.equal(result.origin, 'synthetic');
  assert.equal(result.rights_status, 'pending');
  assert.equal(result.source_as_of, null);
  assert.equal(result.asset_class_from_request, null);
  assert.ok(Object.values(result.canonical).every(value => value === null));
  assert.ok(result.mapping_blockers.includes('currency_not_returned_by_quote'));
});

test('ETF and NYSE/AMEX requests remain caller classifications, never inferred USD or units', async () => {
  for (const [exchange, symbol] of [['AMS', 'SPY'], ['NYS', 'BRK.B'], ['NAS', 'QQQ']] as const) {
    const body = usBody(); body.output.rsym = `D${exchange}${symbol}`;
    const fixture = fake(body);
    const result = await requestUsQuote({ symbol, exchange, asset_class: 'etf' }, fixture.transport, () => NOW);
    assert.equal(result.asset_class_from_request, 'etf');
    assert.equal(result.canonical.asset_class, null);
    assert.equal(result.canonical.currency, null);
    assert.equal(result.canonical.price_unit, null);
    assert.equal(result.identity_status, 'conservative_rsym_guard_matched_not_master_verified');
  }
});

test('futures output retains the three provider objects and never infers multiplier or expiry', async () => {
  const fixture = fake(futuresBody());
  const result = await requestFuturesQuote(futuresInput, fixture.transport, () => NOW);
  assert.deepEqual(fixture.requests, [{ operation: 'kis.futures_quote', method: 'GET', path: '/uapi/domestic-futureoption/v1/quotations/inquire-price', tr_id: 'FHMIF10000000', query: { FID_COND_MRKT_DIV_CODE: 'F', FID_INPUT_ISCD: '101W09' } }]);
  assert.equal(result.raw.output1.futs_prpr, '350.25');
  assert.equal(result.raw.output1.futs_last_tr_date, '20260910');
  assert.equal(result.raw.output1.otst_stpl_qty_icdc, '-5');
  assert.equal(result.raw.output3.bstp_nmix_prpr, '350.50');
  assert.equal(result.identity_status, 'no_returned_contract_code');
  assert.ok(Object.values(result.canonical).every(value => value === null));
  assert.ok(result.mapping_blockers.includes('returned_contract_code_missing'));
});

test('received_at is sampled exactly once after response resolution for both operations', async () => {
  for (const kind of ['us', 'future'] as const) {
    const events: string[] = [];
    const transport: GlobalMarketTransport = { origin: 'synthetic', async send() { events.push('send'); await Promise.resolve(); events.push('response'); return { status: 200, tr_cont: '', body: kind === 'us' ? usBody() : futuresBody() }; } };
    const clock = () => { events.push('clock'); return NOW; };
    const result = kind === 'us' ? await requestUsQuote(usInput, transport, clock) : await requestFuturesQuote(futuresInput, transport, clock);
    assert.deepEqual(events, ['send', 'response', 'clock']);
    assert.equal(result.received_at, NOW);
  }
});

test('transport origin is copied without claiming live reconciliation', async () => {
  for (const origin of ['actual', 'synthetic'] as const) {
    const result = await requestUsQuote(usInput, fake(usBody(), {}, origin).transport, () => NOW);
    assert.equal(result.origin, origin);
    assert.equal(result.validation_status, 'provider_shape_checked_not_live_reconciled');
    assert.equal(result.rights_status, 'pending');
  }
});

test('no transport means no network or implicit credential access', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not execute'); };
  try {
    await expectCode(requestUsQuote(usInput), 'transport_not_configured');
    await expectCode(requestFuturesQuote(futuresInput), 'transport_not_configured');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('strict US inputs reject unsupported exchanges, URLs, unknown overrides and malformed symbols before send', async () => {
  const fixture = fake(usBody());
  for (const input of [null, {}, { symbol: 'aapl', exchange: 'NAS' }, { symbol: '../AAPL', exchange: 'NAS' },
    { symbol: 'AAPL', exchange: 'HKS' }, { ...usInput, exchange: 'BAQ' }, { ...usInput, asset_class: 'option' },
    { ...usInput, url: 'https://example.invalid' }, { ...usInput, AUTH: 'secret' }, { ...usInput, continuation: 'N' },
    { ...usInput, symbol: 'AAPL ' }, { ...usInput, symbol: 'A'.repeat(17) }, { ...usInput, symbol: 'A..B' }]) {
    await expectCode(requestUsQuote(input, fixture.transport, () => NOW), 'invalid_input');
  }
  assert.equal(fixture.requests.length, 0);
});

test('strict futures inputs reject options, malformed months and query overrides before send', async () => {
  const fixture = fake(futuresBody());
  for (const input of [{ symbol: '201W09' }, { symbol: '101W00' }, { symbol: '101W13' }, { symbol: '101w09' },
    { ...futuresInput, market: 'O' }, { ...futuresInput, account: 'secret' }, { ...futuresInput, expected_name: '' },
    { ...futuresInput, tr_id: 'order' }, { ...futuresInput, symbol: '101W09\n' }]) {
    await expectCode(requestFuturesQuote(input, fixture.transport, () => NOW), 'invalid_input');
  }
  assert.equal(fixture.requests.length, 0);
});

test('US rsym ticker, exchange, prefix, and suffix mismatches fail closed', async () => {
  for (const rsym of ['DNASMSFT', 'DNYSAAPL', 'RNASAAPL', 'DNASAAPLL', 'AAPL']) {
    const body = usBody(); body.output.rsym = rsym;
    await expectCode(requestUsQuote(usInput, fake(body).transport, () => NOW), 'instrument_mismatch');
  }
});

test('futures caller name guard rejects mismatch but matching does not verify identity', async () => {
  await expectCode(requestFuturesQuote({ ...futuresInput, expected_name: 'OTHER FUTURE' }, fake(futuresBody()).transport, () => NOW), 'instrument_mismatch');
  const result = await requestFuturesQuote({ ...futuresInput, expected_name: 'SYNTHETIC INDEX FUTURE' }, fake(futuresBody()).transport, () => NOW);
  assert.equal(result.identity_status, 'caller_name_expectation_matched_not_verified');
  assert.equal(result.canonical.instrument_id, null);
  assert.ok(result.mapping_blockers.includes('returned_contract_code_missing'));
});

test('malformed decimal and integer syntax is rejected instead of coerced or rounded', async () => {
  for (const value of ['NaN', 'Infinity', '1e3', '+1.2', '1,234.5', '1.2x', ' 1.2', '1.2 ', '.5', '1.', '']) {
    const body = usBody(); body.output.last = value;
    await expectCode(requestUsQuote(usInput, fake(body).transport, () => NOW), 'schema_drift');
    const future = futuresBody(); future.output1.futs_prpr = value;
    await expectCode(requestFuturesQuote(futuresInput, fake(future).transport, () => NOW), 'schema_drift');
  }
  for (const value of ['-1', '1.5', '1e4', '+2']) {
    const body = usBody(); body.output.tvol = value;
    await expectCode(requestUsQuote(usInput, fake(body).transport, () => NOW), 'schema_drift');
  }
  const numeric = usBody() as unknown as { rt_cd: string; output: Record<string, unknown> };
  numeric.output.last = 246.1234;
  await expectCode(requestUsQuote(usInput, fake(numeric).transport, () => NOW), 'schema_drift');
});

test('raw zero and optional blank are preserved without manufacturing canonical values', async () => {
  const body = usBody(); body.output.last = '0'; body.output.diff = ''; body.output.tvol = '0';
  const result = await requestUsQuote(usInput, fake(body).transport, () => NOW);
  assert.equal(result.raw.last, '0'); assert.equal(result.raw.diff, ''); assert.equal(result.raw.tvol, '0');
  assert.equal(result.canonical.last_price, null);
});

test('calendar dates reject rollovers, invalid leap days and non-date labels', async () => {
  for (const value of ['20260229', '20260431', '20261301', '20260001', '20260100', '2026-10-22', '00000101', '20260910T120000']) {
    const body = futuresBody(); body.output1.futs_last_tr_date = value;
    await expectCode(requestFuturesQuote(futuresInput, fake(body).transport, () => NOW), 'schema_drift');
  }
  for (const value of ['20240229', '20261022', '']) {
    const body = futuresBody(); body.output1.futs_last_tr_date = value;
    const result = await requestFuturesQuote(futuresInput, fake(body).transport, () => NOW);
    assert.equal(result.raw.output1.futs_last_tr_date, value);
    assert.equal(result.canonical.expiry_date, null);
  }
});

test('response shapes and undocumented identity fields fail closed', async () => {
  const valid = usBody();
  for (const output of [null, {}, [], [valid.output], { ...valid.output, currency: 'USD' }, { ...valid.output, symb: 'MSFT' }]) {
    await expectCode(requestUsQuote(usInput, fake({ rt_cd: '0', output }).transport, () => NOW), 'schema_drift');
  }
  const goodFuture = futuresBody();
  for (const body of [ { ...goodFuture, output2: [] }, { ...goodFuture, output3: null },
    { ...goodFuture, output1: { ...goodFuture.output1, futs_shrn_iscd: '101W12' } },
    { rt_cd: '0', output1: goodFuture.output1 }, { ...goodFuture, output1: { futs_prpr: '350.25' } } ]) {
    await expectCode(requestFuturesQuote(futuresInput, fake(body).transport, () => NOW), 'schema_drift');
  }
});

test('continuation is never followed implicitly', async () => {
  for (const marker of ['M', 'F']) {
    const fixture = fake(usBody(), { tr_cont: marker });
    await expectCode(requestUsQuote(usInput, fixture.transport, () => NOW), 'pagination_not_supported');
    assert.equal(fixture.requests.length, 1);
  }
  for (const marker of ['N', 'unknown']) {
    await expectCode(requestFuturesQuote(futuresInput, fake(futuresBody(), { tr_cont: marker }).transport, () => NOW), 'schema_drift');
  }
  for (const marker of [null, '', 'D', 'E']) {
    assert.ok(await requestUsQuote(usInput, fake(usBody(), { tr_cont: marker }).transport, () => NOW));
  }
});

test('HTTP and provider rejection produce bounded sanitized errors with no retries', async () => {
  for (const [status, code] of [[429, 'rate_limited'], [401, 'auth_expired'], [403, 'auth_expired'], [500, 'upstream_unavailable']] as const) {
    const fixture = fake({ secret: 'never emit' }, { status });
    await expectCode(requestUsQuote(usInput, fixture.transport, () => NOW), code);
    assert.equal(fixture.requests.length, 1);
  }
  await expectCode(requestUsQuote(usInput, fake({ rt_cd: '1', msg1: 'secret upstream message' }).transport, () => NOW), 'upstream_rejected');
  await expectCode(requestUsQuote(usInput, fake({ rt_cd: 0, output: usBody().output }).transport, () => NOW), 'schema_drift');
  await expectCode(requestUsQuote(usInput, { origin: 'synthetic', async send() { throw new Error('private transport details'); } }, () => NOW), 'upstream_unavailable');
});

test('body limits cover oversized strings, many fields, deeply nested input and cycles', async () => {
  for (const body of [ { rt_cd: '0', output: usBody().output, excess: 'x'.repeat(300_001) },
    { rt_cd: '0', output: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [String(i), 'x'])) },
    { rt_cd: '0', nested: { a: { b: { c: { d: { e: { f: { g: { h: { i: 'x' } } } } } } } } } } ]) {
    await expectCode(requestUsQuote(usInput, fake(body).transport, () => NOW), 'response_too_large');
  }
  const cycle: Record<string, unknown> = { rt_cd: '0' }; cycle.self = cycle;
  await expectCode(requestUsQuote(usInput, fake(cycle).transport, () => NOW), 'schema_drift');
  const getter = { rt_cd: '0', get output() { throw new Error('must not execute'); } };
  await expectCode(requestUsQuote(usInput, fake(getter).transport, () => NOW), 'schema_drift');
  await expectCode(requestUsQuote(usInput, fake({ rt_cd: '0', output: usBody().output, value: Infinity }).transport, () => NOW), 'schema_drift');
});

test('invalid origin and clock cannot be promoted to result provenance', async () => {
  const invalid = fake(usBody());
  await expectCode(requestUsQuote(usInput, { ...invalid.transport, origin: 'live' } as unknown as GlobalMarketTransport, () => NOW), 'invalid_input');
  assert.equal(invalid.requests.length, 0);
  for (const timestamp of ['2026-02-30T00:00:00Z', '2026-10-22', 'not-a-date', '2026-10-22T02:00:00']) {
    await expectCode(requestUsQuote(usInput, fake(usBody()).transport, () => timestamp), 'invalid_input');
  }
});

test('runtime contracts export JSON schemas and enforce null-only canonical fields', async () => {
  for (const schema of [UsQuoteInputSchema, FuturesQuoteInputSchema, DomesticEtfQuoteInputSchema, UsQuoteResultSchema, FuturesQuoteResultSchema, DomesticEtfQuoteResultSchema, GlobalMarketRequestSchema]) {
    const json = z.toJSONSchema(schema);
    assert.ok(json.$schema);
  }
  const us = await requestUsQuote(usInput, fake(usBody()).transport, () => NOW);
  assert.equal(UsQuoteResultSchema.safeParse({ ...us, canonical: { ...us.canonical, currency: 'USD' } }).success, false);
  const future = await requestFuturesQuote(futuresInput, fake(futuresBody()).transport, () => NOW);
  assert.equal(FuturesQuoteResultSchema.safeParse({ ...future, canonical: { ...future.canonical, contract_multiplier: 250000 } }).success, false);
  assert.equal(GlobalMarketRequestSchema.safeParse({ operation: 'kis.us_quote', method: 'POST', path: '/oauth2/tokenP', tr_id: 'HHDFS00000300', query: { AUTH: '', EXCD: 'NAS', SYMB: 'AAPL' } }).success, false);
});


const etfBody = () => ({ rt_cd: '0', output: {
  stck_prpr: '35000', nav: '35012.7500', prdy_last_nav: '34999.1234', nav_prdy_vrss: '13.6266', nav_prdy_ctrt: '0.04',
  trc_errt: '-0.01', dprt: '-0.04', crcd: 'USD', etf_ntas_ttam: '123456789012345678901',
  etf_cnfg_issu_cnt: '200', etf_div_name: 'SYNTHETIC CLASSIFICATION', stck_lstn_date: '20240229',
} });

test('dedicated domestic ETF/ETN quote routes to NAV endpoint without reusing equity quotes', async () => {
  const fixture = fake(etfBody());
  const result = await requestDomesticEtfQuote({ symbol: '069500' }, fixture.transport, () => NOW);
  assert.deepEqual(fixture.requests, [{ operation: 'kis.domestic_etf_quote', method: 'GET', path: '/uapi/etfetn/v1/quotations/inquire-price', tr_id: 'FHPST02400000', query: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '069500' } }]);
  assert.equal(result.raw.nav, '35012.7500');
  assert.equal(result.raw.etf_ntas_ttam, '123456789012345678901');
  assert.equal(result.raw.etf_cnfg_issu_cnt, '200');
  assert.equal(result.raw.crcd, 'USD');
  assert.equal(result.canonical.currency, null);
  assert.equal(result.canonical.asset_class, null);
  assert.ok(Object.values(result.canonical).every(value => value === null));
  assert.equal(result.coverage, 'dedicated_etf_etn_price_nav_not_holdings');
  assert.equal(result.identity_status, 'no_returned_instrument_code');
  assert.equal(result.rights_status, 'pending');
});

test('domestic ETF board is explicit and unverified while unknown inputs are rejected before send', async () => {
  for (const board of ['J', 'NX', 'UN'] as const) {
    const fixture = fake(etfBody());
    const result = await requestDomesticEtfQuote({ symbol: '069500', board }, fixture.transport, () => NOW);
    assert.equal(result.board_from_request, board);
    const request = fixture.requests[0];
    assert.equal(request?.operation, 'kis.domestic_etf_quote');
  }
  const fixture = fake(etfBody());
  for (const input of [{ symbol: 'Q123456' }, { symbol: '069500', board: 'F' }, { symbol: '069500', asset_class: 'etf' },
    { symbol: '069500', path: '/uapi/domestic-stock/v1/quotations/inquire-price' }, { symbol: '../500' }]) {
    await expectCode(requestDomesticEtfQuote(input, fixture.transport, () => NOW), 'invalid_input');
  }
  assert.equal(fixture.requests.length, 0);
  await expectCode(requestDomesticEtfQuote({ symbol: '069500' }), 'transport_not_configured');
});

test('domestic ETF NAV decimals, dates and unexpected identity claims fail closed', async () => {
  for (const nav of ['1e3', '1,000', 'NaN', ' 123.45', '-123.45']) {
    const body = etfBody(); body.output.nav = nav;
    await expectCode(requestDomesticEtfQuote({ symbol: '069500' }, fake(body).transport, () => NOW), 'schema_drift');
  }
  for (const value of ['20250229', '20260431', '00000000']) {
    const body = etfBody(); body.output.stck_lstn_date = value;
    await expectCode(requestDomesticEtfQuote({ symbol: '069500' }, fake(body).transport, () => NOW), 'schema_drift');
  }
  await expectCode(requestDomesticEtfQuote({ symbol: '069500' }, fake({ rt_cd: '0', output: { ...etfBody().output, stck_shrn_iscd: '005930' } }).transport, () => NOW), 'schema_drift');
  const missingNav = { rt_cd: '0', output: { stck_prpr: '35000' } };
  await expectCode(requestDomesticEtfQuote({ symbol: '069500' }, fake(missingNav).transport, () => NOW), 'schema_drift');
  const blank = etfBody(); blank.output.nav = '';
  const result = await requestDomesticEtfQuote({ symbol: '069500' }, fake(blank).transport, () => NOW);
  assert.equal(result.raw.nav, ''); assert.equal(result.canonical.nav, null);
});

test('domestic ETF shares bounded transport guards and post-response timestamp behavior', async () => {
  const events: string[] = [];
  const transport: GlobalMarketTransport = { origin: 'synthetic', async send() { events.push('send'); await Promise.resolve(); events.push('response'); return { status: 200, tr_cont: '', body: etfBody() }; } };
  const result = await requestDomesticEtfQuote({ symbol: '069500' }, transport, () => { events.push('clock'); return NOW; });
  assert.deepEqual(events, ['send', 'response', 'clock']);
  assert.equal(result.received_at, NOW);
  const fixture = fake(etfBody(), { tr_cont: 'M' });
  await expectCode(requestDomesticEtfQuote({ symbol: '069500' }, fixture.transport, () => NOW), 'pagination_not_supported');
  assert.equal(fixture.requests.length, 1);
  await expectCode(requestDomesticEtfQuote({ symbol: '069500' }, fake({ rt_cd: '0', output: etfBody().output, excess: 'x'.repeat(300001) }).transport, () => NOW), 'response_too_large');
  assert.equal(DomesticEtfQuoteResultSchema.safeParse({ ...result, canonical: { ...result.canonical, nav: '35012.75' } }).success, false);
});
test('hidden serialization hooks are rejected without executing provider code',async()=>{let touched=false;const body=usBody();Object.defineProperty(body,'toJSON',{value:()=>{touched=true;return usBody();}});await expectCode(requestUsQuote(usInput,fake(body).transport,()=>NOW),'schema_drift');assert.equal(touched,false);});
test('boundedBody rejects huge sparse arrays before serialization and rejects hidden/lossy properties',()=>{
 const huge:unknown[]=[];huge.length=2**32-1;const stringify=JSON.stringify;let called=false;
 try{JSON.stringify=(()=>{called=true;throw new Error('serialization_must_not_run');}) as typeof JSON.stringify;assert.throws(()=>boundedBody(huge),(e:any)=>e.code==='response_too_large');assert.equal(called,false);}finally{JSON.stringify=stringify;}
 const sparse:unknown[]=[];sparse[2]='x';const extra:any[]=[];(extra as any).metadata='lost';const hidden={};Object.defineProperty(hidden,'lost',{value:'secret-shaped fixture',enumerable:false});
 for(const value of [sparse,extra,hidden])assert.throws(()=>boundedBody(value),(e:any)=>e.code==='schema_drift');
});
test('boundedBody rejects custom array prototypes and inherited serialization hooks',()=>{let touched=false;const array:any[]=[];Object.setPrototypeOf(array,{toJSON(){touched=true;return [];}});assert.throws(()=>boundedBody(array),(e:any)=>e.code==='schema_drift');assert.equal(touched,false);});

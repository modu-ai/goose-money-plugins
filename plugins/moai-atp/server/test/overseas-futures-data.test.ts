import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  OverseasFuturesError, OverseasFuturesQuoteInputSchema, OverseasFuturesQuoteRawSchema,
  OverseasFuturesQuoteResultSchema, OverseasFuturesRequestSchema, requestOverseasFuturesQuote,
  type OverseasFuturesRequest, type OverseasFuturesTransport, type OverseasFuturesResponse,
} from '../src/overseas-futures-data.js';

const NOW = '2026-10-22T02:00:00.000Z';
const input = { symbol: 'ESZ26' };
const body = () => ({ rt_cd: '0', msg_cd: 'MCA00000', msg1: 'synthetic only', output1: {
  proc_date: '20261021', proc_time: '171530', last_price: '6000.2500', high_price: '6005.5000', low_price: '5988.0000',
  open_price: '5999.7500', prev_price: '5990.0000', prev_diff_flag: '2', prev_diff_price: '10.2500', prev_diff_rate: '0.17',
  vol: '123456789012345678901', bid_qntt: '20', bid_price: '6000.0000', ask_qntt: '15', ask_price: '6000.2500',
  exch_cd: 'CME', crc_cd: 'USD', trd_fr_date: '20240102', expr_date: '20261218', trd_to_date: '20261218', remn_cnt: '58',
  last_qntt: '1', tot_ask_qntt: '200', tot_bid_qntt: '180', tick_size: '0.25', open_date: '20261021',
  open_time: '180000', close_date: '20261022', close_time: '170000', sbsnsdate: '20261022', sttl_price: '5990.0000', trst_mgn: '12345.00',
} });
function fake(value: unknown, overrides: Partial<OverseasFuturesResponse> = {}, origin: 'actual' | 'synthetic' = 'synthetic') {
  const requests: OverseasFuturesRequest[] = [];
  const transport: OverseasFuturesTransport = { origin, async send(request) { requests.push(request); return { status: 200, tr_cont: '', body: value, ...overrides }; } };
  return { transport, requests };
}
async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof OverseasFuturesError && error.code === code && error.message === code);
}

test('RC4 quote uses only exact official overseas-futures request', async () => {
  const fixture = fake(body());
  const result = await requestOverseasFuturesQuote(input, fixture.transport, () => NOW);
  assert.deepEqual(fixture.requests, [{ operation: 'kis.overseas_futures_quote', method: 'GET',
    path: '/uapi/overseas-futureoption/v1/quotations/inquire-price', tr_id: 'HHDFC55010000', query: { SRS_CD: 'ESZ26' } }]);
  assert.ok(Object.isFrozen(fixture.requests[0]));
  assert.ok(Object.isFrozen(fixture.requests[0]?.query));
  assert.equal(result.raw.last_price, '6000.2500');
  assert.equal(result.raw.vol, '123456789012345678901');
  assert.equal(result.raw.crc_cd, 'USD');
  assert.equal(result.raw.tick_size, '0.25');
  assert.equal(result.identity_status, 'no_returned_contract_code');
  assert.equal(result.geographical_scope_status, 'overseas_contract_us_listing_not_verified');
  assert.ok(Object.values(result.canonical).every(value => value === null));
  assert.equal(result.rights_status, 'pending');
});

test('receipt clock follows response and raw processing time never becomes a source instant', async () => {
  const events: string[] = [];
  const transport: OverseasFuturesTransport = { origin: 'synthetic', async send() { events.push('send'); await Promise.resolve(); events.push('response'); return { status: 200, tr_cont: '', body: body() }; } };
  const result = await requestOverseasFuturesQuote(input, transport, () => { events.push('clock'); return NOW; });
  assert.deepEqual(events, ['send', 'response', 'clock']);
  assert.equal(result.received_at, NOW);
  assert.equal(result.source_as_of, null);
  assert.deepEqual(result.processing_time, { provider_date: '20261021', provider_time: '171530', timezone: null,
    semantic: 'provider_final_processing_not_verified_trade_time', status: 'date_time_present_timezone_unverified' });
  assert.equal(result.raw.sbsnsdate, '20261022');
  assert.equal(result.raw.expr_date, '20261218');
  assert.equal(result.canonical.expiry_date, null);
});

test('missing or blank processing timestamp components remain explicit, not synthesized', async () => {
  for (const raw of [{ last_price: '0' }, { last_price: '1', proc_date: '20261022' },
    { last_price: '1', proc_time: '121314' }, { last_price: '1', proc_date: '', proc_time: '' }]) {
    const result = await requestOverseasFuturesQuote(input, fake({ rt_cd: '0', output1: raw }).transport, () => NOW);
    assert.equal(result.processing_time.status, 'date_or_time_missing');
    assert.equal(result.source_as_of, null);
    assert.equal(result.processing_time.provider_date, raw.proc_date || null);
    assert.equal(result.processing_time.provider_time, raw.proc_time || null);
  }
});

test('exact one-object or singleton-array response is supported but multiple rows never collapse', async () => {
  const singleton = await requestOverseasFuturesQuote(input, fake({ rt_cd: '0', output1: [body().output1] }).transport, () => NOW);
  assert.equal(singleton.provider_output_shape, 'singleton_array');
  const object = await requestOverseasFuturesQuote(input, fake(body()).transport, () => NOW);
  assert.equal(object.provider_output_shape, 'object');
  for (const output1 of [[], [body().output1, body().output1], null, '6000', {}]) {
    await expectCode(requestOverseasFuturesQuote(input, fake({ rt_cd: '0', output1 }).transport, () => NOW), 'schema_drift');
  }
});

test('metadata mismatch guards reject wrong exchange/currency without verifying the requested contract', async () => {
  const result = await requestOverseasFuturesQuote({ ...input, expected_exchange: 'CME', expected_currency: 'USD' }, fake(body()).transport, () => NOW);
  assert.equal(result.expectation_status, 'caller_metadata_expectations_matched_not_verified');
  assert.equal(result.identity_status, 'no_returned_contract_code');
  assert.equal(result.canonical.currency, null);
  assert.equal(result.canonical.exchange, null);
  for (const q of [{ ...input, expected_exchange: 'OTHER' }, { ...input, expected_currency: 'EUR' }]) {
    await expectCode(requestOverseasFuturesQuote(q, fake(body()).transport, () => NOW), 'instrument_mismatch');
  }
  await expectCode(requestOverseasFuturesQuote({ ...input, expected_exchange: 'CME' }, fake({ rt_cd: '0', output1: { last_price: '1' } }).transport, () => NOW), 'identity_evidence_missing');
  await expectCode(requestOverseasFuturesQuote({ ...input, expected_currency: 'USD' }, fake({ rt_cd: '0', output1: { last_price: '1', crc_cd: '' } }).transport, () => NOW), 'identity_evidence_missing');
});

test('no transport cannot access the network or silently initialize credentials', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('not allowed'); };
  try { await expectCode(requestOverseasFuturesQuote(input), 'transport_not_configured'); assert.equal(calls, 0); }
  finally { globalThis.fetch = original; }
});

test('unknown inputs and non-outright series are rejected before transport', async () => {
  const fixture = fake(body());
  for (const q of [{}, null, { symbol: 'esz26' }, { symbol: '../ESZ26' }, { symbol: 'ESZ26 C6000' }, { symbol: 'ESZ2026' },
    { symbol: 'ESY26' }, { symbol: 'ESZ26 ' }, { ...input, account: 'secret' }, { ...input, url: 'https://example.invalid' },
    { ...input, tr_id: 'ORDER' }, { ...input, continuation: 'N' }, { ...input, expected_currency: 'usd' },
    { ...input, expected_exchange: 'CME/CBT' }, { symbol: 'A'.repeat(30) + 'Z26' }]) {
    await expectCode(requestOverseasFuturesQuote(q, fixture.transport, () => NOW), 'invalid_input');
  }
  assert.equal(fixture.requests.length, 0);
  for (const symbol of ['ESZ26', 'NQZ26', '6EZ26', 'CNHU24', 'BONU25']) assert.equal(OverseasFuturesQuoteInputSchema.safeParse({ symbol }).success, true);
});

test('negative futures prices are preserved exactly, not rejected as invalid equities', async () => {
  const result = await requestOverseasFuturesQuote({ symbol: 'CLK20' }, fake({ rt_cd: '0', output1: {
    last_price: '-37.6300', open_price: '-1.25', low_price: '-40.3200', high_price: '17.85', bid_price: '-37.65',
    ask_price: '-37.60', prev_price: '18.27', prev_diff_price: '-55.90', sttl_price: '-37.63', vol: '0',
  } }).transport, () => NOW);
  assert.equal(result.raw.last_price, '-37.6300');
  assert.equal(result.raw.sttl_price, '-37.63');
  assert.equal(result.canonical.last_price, null);
});

test('malformed decimals and quantities reject without coercion', async () => {
  for (const value of ['NaN', 'Infinity', '1e3', '1,000', '+1.2', ' 1.2', '1.2 ', '.5', '1.', '']) {
    const invalid = body(); invalid.output1.last_price = value;
    await expectCode(requestOverseasFuturesQuote(input, fake(invalid).transport, () => NOW), 'schema_drift');
  }
  for (const value of ['-1', '1.2', '1e3']) {
    const invalid = body(); invalid.output1.vol = value;
    await expectCode(requestOverseasFuturesQuote(input, fake(invalid).transport, () => NOW), 'schema_drift');
  }
  await expectCode(requestOverseasFuturesQuote(input, fake({ rt_cd: '0', output1: { last_price: 1234 } }).transport, () => NOW), 'schema_drift');
});

test('calendar and clock gates reject invalid dates and impossible times in every documented field', async () => {
  for (const field of ['proc_date', 'trd_fr_date', 'expr_date', 'trd_to_date', 'open_date', 'close_date', 'sbsnsdate']) {
    for (const value of ['20260229', '20260431', '20261301', '00000000', '2026-10-22']) {
      const invalid = { ...body(), output1: { ...body().output1, [field]: value } };
      await expectCode(requestOverseasFuturesQuote(input, fake(invalid).transport, () => NOW), 'schema_drift');
    }
  }
  for (const field of ['proc_time', 'open_time', 'close_time']) {
    for (const value of ['240000', '126000', '125960', '12:00:00', '12345', '1234567']) {
      await expectCode(requestOverseasFuturesQuote(input, fake({ ...body(), output1: { ...body().output1, [field]: value } }).transport, () => NOW), 'schema_drift');
    }
  }
  const valid = await requestOverseasFuturesQuote(input, fake({ rt_cd: '0', output1: { last_price: '1', proc_date: '20240229', proc_time: '000000' } }).transport, () => NOW);
  assert.equal(valid.processing_time.provider_time, '000000');
});

test('unknown returned identity/units and response extensions fail closed', async () => {
  for (const output1 of [{ ...body().output1, srs_cd: 'NQZ26' }, { ...body().output1, multiplier: '50' }, { ...body().output1, timezone: 'America/Chicago' }]) {
    await expectCode(requestOverseasFuturesQuote(input, fake({ rt_cd: '0', output1 }).transport, () => NOW), 'schema_drift');
  }
  await expectCode(requestOverseasFuturesQuote(input, fake({ ...body(), output2: [] }).transport, () => NOW), 'schema_drift');
});

test('no pagination or retries on any continuation signal', async () => {
  for (const tr_cont of ['M', 'F']) {
    const fixture = fake(body(), { tr_cont });
    await expectCode(requestOverseasFuturesQuote(input, fixture.transport, () => NOW), 'pagination_not_supported');
    assert.equal(fixture.requests.length, 1);
  }
  for (const tr_cont of ['N', 'x']) await expectCode(requestOverseasFuturesQuote(input, fake(body(), { tr_cont }).transport, () => NOW), 'schema_drift');
  for (const tr_cont of [null, '', 'D', 'E']) assert.ok(await requestOverseasFuturesQuote(input, fake(body(), { tr_cont }).transport, () => NOW));
});

test('HTTP, provider and transport errors are bounded and sanitized', async () => {
  for (const [status, code] of [[401, 'auth_expired'], [403, 'auth_expired'], [429, 'rate_limited'], [500, 'upstream_unavailable']] as const) {
    const fixture = fake({ secret: 'not copied' }, { status });
    await expectCode(requestOverseasFuturesQuote(input, fixture.transport, () => NOW), code);
    assert.equal(fixture.requests.length, 1);
  }
  await expectCode(requestOverseasFuturesQuote(input, fake({ rt_cd: '1', msg1: 'private diagnostic' }).transport, () => NOW), 'upstream_rejected');
  await expectCode(requestOverseasFuturesQuote(input, fake({ ...body(), rt_cd: 0 }).transport, () => NOW), 'schema_drift');
  await expectCode(requestOverseasFuturesQuote(input, { origin: 'synthetic', async send() { throw new Error('private transport detail'); } }, () => NOW), 'upstream_unavailable');
});

test('body size, depth, cycles and accessors are bounded before normalization', async () => {
  for (const value of [{ rt_cd: '0', msg1: 'x'.repeat(300001) },
    { rt_cd: '0', output1: Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [String(index), '1'])) },
    { rt_cd: '0', nested: { a: { b: { c: { d: { e: { f: { g: { h: { i: 'x' } } } } } } } } } }]) {
    await expectCode(requestOverseasFuturesQuote(input, fake(value).transport, () => NOW), 'response_too_large');
  }
  const cycle: Record<string, unknown> = { rt_cd: '0' }; cycle.self = cycle;
  await expectCode(requestOverseasFuturesQuote(input, fake(cycle).transport, () => NOW), 'schema_drift');
  let invocations = 0;
  const hidden = body(); Object.defineProperty(hidden, 'toJSON', { value() { invocations++; return body(); }, enumerable: false });
  await expectCode(requestOverseasFuturesQuote(input, fake(hidden).transport, () => NOW), 'schema_drift');
  const getter = body(); Object.defineProperty(getter, 'secret', { get() { invocations++; return 'secret'; }, enumerable: false });
  await expectCode(requestOverseasFuturesQuote(input, fake(getter).transport, () => NOW), 'schema_drift');
  assert.equal(invocations, 0);
});

test('provenance origin and receipt timestamp cannot be silently invented', async () => {
  for (const origin of ['actual', 'synthetic'] as const) {
    const result = await requestOverseasFuturesQuote(input, fake(body(), {}, origin).transport, () => NOW);
    assert.equal(result.origin, origin); assert.equal(result.validation_status, 'provider_shape_checked_not_live_reconciled');
  }
  const fixture = fake(body());
  await expectCode(requestOverseasFuturesQuote(input, { ...fixture.transport, origin: 'live' } as unknown as OverseasFuturesTransport, () => NOW), 'invalid_input');
  assert.equal(fixture.requests.length, 0);
  for (const timestamp of ['2026-02-30T00:00:00Z', '2026-10-22', '2026-10-22T02:00:00', 'not-a-date']) {
    await expectCode(requestOverseasFuturesQuote(input, fake(body()).transport, () => timestamp), 'invalid_input');
  }
});

test('runtime JSON schemas enforce null canonical and raw processing metadata consistency', async () => {
  for (const schema of [OverseasFuturesQuoteInputSchema, OverseasFuturesQuoteRawSchema, OverseasFuturesQuoteResultSchema, OverseasFuturesRequestSchema]) assert.ok(z.toJSONSchema(schema).$schema);
  const result = await requestOverseasFuturesQuote(input, fake(body()).transport, () => NOW);
  for (const field of ['currency', 'contract_multiplier', 'expiry_date', 'last_price', 'tick_size']) {
    assert.equal(OverseasFuturesQuoteResultSchema.safeParse({ ...result, canonical: { ...result.canonical, [field]: 'invented' } }).success, false);
  }
  assert.equal(OverseasFuturesQuoteResultSchema.safeParse({ ...result, processing_time: { ...result.processing_time, provider_date: '20261022' } }).success, false);
  assert.equal(OverseasFuturesQuoteResultSchema.safeParse({ ...result, expected_exchange_from_request: 'OTHER' }).success, false);
  assert.equal(OverseasFuturesRequestSchema.safeParse({ operation: 'kis.overseas_futures_quote', method: 'POST', path: '/oauth2/tokenP', tr_id: 'HHDFC55010000', query: { SRS_CD: 'ESZ26' } }).success, false);
});

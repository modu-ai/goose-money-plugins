import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { createStockMcpServer } from './synthetic-member-access.js';
import * as f from '../src/market-orderbook.js';
import * as fx from './market-reference-fixtures.js';
const read = f.requestMarketOrderbook;
const clock = () => fx.RECEIPT;
const code = (expected: string) => (e: unknown) => e instanceof f.MarketOrderbookError && e.code === expected && e.message === expected;

test('book fixed route, explicit board and symbol, frozen request, one post-response exact receipt', async () => {
  for (const board of ['J', 'NX', 'UN'] as const) {
    const events: string[] = []; let calls = 0;
    const dto = await read({ ...fx.bookInput, board }, { origin: 'synthetic', async send(request) {
      calls++; events.push('response'); assert.ok(Object.isFrozen(request)); assert.ok(Object.isFrozen(request.query));
      assert.deepEqual(request, { operation: 'kis.market_orderbook', method: 'GET', path: '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn', tr_id: 'FHKST01010200', tr_cont: '', query: { FID_COND_MRKT_DIV_CODE: board, FID_INPUT_ISCD: '005930' } }); return fx.response();
    } }, () => { events.push('receipt'); return fx.RECEIPT; });
    assert.equal(calls, 1); assert.deepEqual(events, ['response', 'receipt']); assert.equal(dto.received_at, fx.RECEIPT); assert.equal(dto.requested.board, board);
  }
});
test('book raw lexemes and output2 shape/order retained, all canonical and timing claims blocked', async () => {
  const dto = await fx.book(); assert.deepEqual(dto.raw, { output1: fx.bookBody.output1, output2: fx.bookBody.output2 });
  assert.equal(dto.raw.output1.aspr_acpt_hour, 'raw clock: 03:00?'); assert.equal(dto.raw.output1.bidp_rsqn_icdc1, '-7');
  assert.equal(dto.raw.output1.askp_rsqn_icdc1, '+3');
  for (const value of Object.values(dto.canonical)) assert.equal(value, null);
  for (const field of ['source_at', 'published_at', 'available_at', 'source_timezone', 'session', 'canonical_observation'] as const) assert.equal(dto[field], null);
  assert.equal(dto.metric_ready, false); assert.equal(dto.simultaneous_quotes_verified, false); assert.equal(dto.source_authenticated, false);
  assert.equal(dto.quote_firmness, 'unverified'); assert.equal(dto.rights_status, 'pending');
  assert.ok(Object.isFrozen(dto.raw.output2)); assert.ok(Object.isFrozen(dto.raw.output1));
});
for (const [name, output2] of [['object', { antc_cnpr: '17', nested: [{ note: 'raw' }, ''] }], ['empty array', []], ['empty object', {}], ['array order', ['z', 'a', null, 7, false]]] as const)
  test(`book output2 ${name} preserved without flattening or interpretation`, async () => { const dto = await fx.book({ ...fx.bookBody, output2 }); assert.deepEqual(dto.raw.output2, output2); });
for (const value of [null, '', 3, true]) test(`book rejects unsupported top-level output2 ${JSON.stringify(value)}`, async () => { await assert.rejects(fx.book({ ...fx.bookBody, output2: value }), code('schema_drift')); });
test('book accepts missing/blank/malformed numeric strings as raw text, not zero or validated numbers', async () => {
  const raw = { output1: { askp1: '', bidp1: 'not a decimal', aspr_acpt_hour: '' }, output2: {} };
  const dto = await fx.book({ rt_cd: '0', ...raw }); assert.deepEqual(dto.raw, raw); assert.equal(dto.identity_status, 'no_nonblank_symbol_echo');
  assert.equal((await fx.book({ rt_cd: '0', output1: {}, output2: [] })).raw.output1.bidp1, undefined);
});
test('book accepts crossed and zero raw prices without economic correction', async () => {
  for (const [bidp1, askp1] of [['102', '100'], ['0', '0']]) { const dto = await fx.book({ rt_cd: '0', output1: { bidp1, askp1 }, output2: {} }); assert.equal(dto.raw.output1.bidp1, bidp1); assert.equal(dto.canonical.spread, null); }
});
for (const where of ['output1', 'output2', 'array', 'nested']) test(`book rejects symbol mismatch in ${where}`, async () => {
  const body: any = structuredClone(fx.bookBody);
  if (where === 'output1') body.output1.stck_shrn_iscd = '000660';
  if (where === 'output2') body.output2 = { stck_shrn_iscd: '000660' };
  if (where === 'array') body.output2[1].stck_shrn_iscd = '000660';
  if (where === 'nested') body.output2 = { x: { stck_shrn_iscd: '000660' } };
  await assert.rejects(fx.book(body), code('instrument_mismatch'));
});
for (const echo of ['', '   ', undefined]) test(`book absent/blank echo ${String(echo)} is not verification`, async () => {
  const output1 = echo === undefined ? {} : { stck_shrn_iscd: echo };
  const dto = await fx.book({ rt_cd: '0', output1, output2: [] }); assert.equal(dto.identity_status, 'no_nonblank_symbol_echo');
});
for (const echo of [5930, null, false, [], {}]) test(`book nontext echo ${JSON.stringify(echo)} fails closed`, async () => { await assert.rejects(fx.book({ rt_cd: '0', output1: {}, output2: { stck_shrn_iscd: echo } }), code('schema_drift')); });
test('book matching echo is not identity proof and padded nonblank echo rejected', async () => {
  assert.equal((await fx.book()).identity_status, 'conservative_symbol_echo_matched_not_master_verified');
  await assert.rejects(fx.book({ rt_cd: '0', output1: {}, output2: { stck_shrn_iscd: ' 005930 ' } }), code('instrument_mismatch'));
});
for (const input of [{ symbol: '005930' }, { symbol: '5930', board: 'J' }, { symbol: '005930', board: 'KRX' }, { ...fx.bookInput, url: 'https://example.invalid' }, { ...fx.bookInput, account: 'synthetic' }, { ...fx.bookInput, retries: 1 }])
  test(`book invalid input ${JSON.stringify(input)} fails before transport`, async () => { let calls = 0; await assert.rejects(read(input, { origin: 'synthetic', async send() { calls++; return fx.response(); } }), code('invalid_input')); assert.equal(calls, 0); });
for (const [status, expected] of [[429, 'rate_limited'], [401, 'auth_expired'], [403, 'auth_expired'], [500, 'upstream_unavailable']] as const)
  test(`book HTTP ${status} safely classified without retries`, async () => { let calls = 0; await assert.rejects(read(fx.bookInput, { origin: 'synthetic', async send() { calls++; return { status, tr_cont: '', body: { msg1: 'SYNTHETIC_DIAGNOSTIC' } }; } }, clock), code(expected)); assert.equal(calls, 1); });
for (const tr_cont of ['M', 'F']) test(`book continuation ${tr_cont} rejected without follow-up`, async () => { let calls = 0; await assert.rejects(read(fx.bookInput, { origin: 'synthetic', async send() { calls++; return fx.response(fx.bookBody, tr_cont); } }, clock), code('pagination_not_supported')); assert.equal(calls, 1); });
test('book known terminal continuation values retained and unknown values rejected', async () => {
  for (const tr_cont of [null, '', 'D', 'E']) assert.equal((await read(fx.bookInput, { origin: 'synthetic', async send() { return fx.response(fx.bookBody, tr_cont); } }, clock)).pagination.tr_cont, tr_cont);
  await assert.rejects(read(fx.bookInput, { origin: 'synthetic', async send() { return fx.response(fx.bookBody, 'NEXT'); } }, clock), code('schema_drift'));
});
test('book missing transport, upstream failures and provider errors remain finite', async () => {
  await assert.rejects(read(fx.bookInput), code('transport_not_configured'));
  await assert.rejects(read(fx.bookInput, { origin: 'synthetic', async send() { throw new Error('SENSITIVE_SYNTHETIC_DIAGNOSTIC'); } }), code('upstream_unavailable'));
  await assert.rejects(fx.book({ rt_cd: '1', msg1: 'SENSITIVE_SYNTHETIC_DIAGNOSTIC' }), code('upstream_rejected'));
});
for (const [name, change] of [['unknown field', (b: any) => b.output1.undocumented = '7'], ['number', (b: any) => b.output1.bidp1 = 7], ['null', (b: any) => b.output1.bidp1 = null], ['object', (b: any) => b.output1.bidp1 = {}], ['overlong string', (b: any) => b.output1.bidp1 = '1'.repeat(201)], ['missing output1', (b: any) => delete b.output1], ['missing output2', (b: any) => delete b.output2]] as const)
  test(`book ${name} fails closed rather than stripped`, async () => { const b = structuredClone(fx.bookBody); change(b); await assert.rejects(fx.book(b), code('schema_drift')); });
test('book snapshot owns immutable copies; later mutation cannot rewrite returned evidence', async () => {
  const body = structuredClone(fx.bookBody); const dto = await fx.book(body); body.output1.bidp1 = '999'; body.output2.reverse();
  assert.equal(dto.raw.output1.bidp1, fx.bookBody.output1.bidp1); assert.throws(() => { (dto as any).raw.output1.bidp1 = '3'; }, TypeError);
});
test('book exact receipt clock rejects impossible/unknown-offset/timezone-less/throwing values', async () => {
  for (const value of ['2026-02-30T03:00:00Z', '2026-10-22T03:00:00-00:00', '2026-10-22T03:00:00', 'garbage']) await assert.rejects(read(fx.bookInput, fx.bookTransport(), () => value), code('invalid_input'));
  await assert.rejects(read(fx.bookInput, fx.bookTransport(), () => { throw new Error('PRIVATE_SYNTHETIC'); }), code('invalid_input'));
});
test('book traps, getters and serialization hooks never execute', async () => {
  let hits = 0; const getter = Object.defineProperty({}, 'output1', { enumerable: true, get() { hits++; return {}; } });
  const proxy = new Proxy({}, { ownKeys() { hits++; return []; }, getPrototypeOf() { hits++; return Object.prototype; } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const hook = { toJSON() { hits++; return {}; } };
  for (const body of [getter, proxy, revoked.proxy, hook, { ...fx.bookBody, output2: { nested: proxy } }]) await assert.rejects(fx.book(body), code('schema_drift'));
  await assert.rejects(read(new Proxy(fx.bookInput, { get() { hits++; return ''; } })), code('invalid_input'));
  assert.equal(hits, 0);
});
test('book non-plain, cycles, undefined, nonfinite, symbol keys and sparse arrays fail safely', async () => {
  const cyclic: any = {}; cyclic.self = cyclic;
  const hidden = Object.defineProperty({}, 'hidden', { value: 'x' });
  for (const body of [new Date(), new Map(), cyclic, { ...fx.bookBody, output2: { x: undefined } }, { ...fx.bookBody, output2: [NaN] }, { [Symbol('x')]: 1 }, hidden, [,,]]) await assert.rejects(fx.book(body), code('schema_drift'));
});
test('book serialized bytes, multibyte text, depth, nodes and collection limits precede parsing', async () => {
  let deep: any = {}; for (let i = 0; i < 10; i++) deep = { x: deep };
  for (const body of [new Array(2 ** 32 - 1), { x: '한'.repeat(100000) }, { x: '"'.repeat(150000) }, deep, Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [i, ''])), Array.from({ length: 30 }, () => Array(400).fill(''))]) await assert.rejects(fx.book(body), code('response_too_large'));
});
for (const privateField of ['authorization', 'appkey', 'appsecret', 'api-key', 'access_token', 'CANO', 'ACNT_PRDT_CD', 'account_number', 'password', 'refresh_token'])
  test(`book conservative private field marker ${privateField} rejected without content echo`, async () => { await assert.rejects(fx.book({ ...fx.bookBody, output2: { [privateField]: 'SYNTHETIC_NOT_A_SECRET' } }), code('schema_drift')); });
for (const text of ['Bearer SYNTHETIC_NOT_A_TOKEN', 'https://example.invalid/?access_token=SYNTHETIC_ONLY', 'https://fake:fake@example.invalid/', 'appsecret=SYNTHETIC_ONLY', 'https://example.invalid/?api%5Fkey%3DSYNTHETIC_ONLY'])
  test(`book conservative private text marker ${text.slice(0, 20)} rejected`, async () => { await assert.rejects(fx.book({ ...fx.bookBody, output2: { note: text } }), code('schema_drift')); });
test('book null-prototype JSON accepted; inherited hooks rejected without calls', async () => {
  assert.equal((await fx.book(Object.assign(Object.create(null), fx.bookBody))).origin, 'synthetic');
  let hits = 0; Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value() { hits++; return {}; } });
  try { await assert.rejects(read(fx.bookInput), code('invalid_input')); } finally { Reflect.deleteProperty(Object.prototype, 'toJSON'); }
  assert.equal(hits, 0);
});
test('book result schema cross-field guards reject mismatches without throwing on invalid format', async () => {
  const r = await fx.book();
  for (const patch of [{ source_at: fx.RECEIPT }, { canonical: { ...r.canonical, currency: 'KRW' } }, { identity_status: 'no_nonblank_symbol_echo' }, { requested: { ...r.requested, board: 'J' } }, { metric_ready: true }, { simultaneous_quotes_verified: true }, { source_authenticated: true }]) assert.equal(f.MarketOrderbookResultSchema.safeParse({ ...r, ...patch }).success, false);
  assert.doesNotThrow(() => f.MarketOrderbookResultSchema.safeParse({ ...r, requested: { ...r.requested, symbol: 'bad' } }));
});
test('book server denies default before injected transport and exposes read-only finite tool', async () => {
  let calls = 0;
  const server = createStockMcpServer({ marketOrderbookTransport: { origin: 'synthetic', async send() { calls++; return fx.response(); } } });
  const tool = (server as any)._registeredTools.get_market_orderbook;
  assert.ok(tool); assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.destructiveHint, false);
  await assert.rejects(tool.handler(fx.bookInput), /error_code=rights_pending/); assert.equal(calls, 0);
  const enabled = createStockMcpServer({ rightsEnabled: true, marketOrderbookTransport: { origin: 'synthetic', async send() { calls++; return fx.response(); } }, clock });
  const output = await (enabled as any)._registeredTools.get_market_orderbook.handler(fx.bookInput);
  assert.equal(output.structuredContent.origin, 'synthetic'); assert.equal(calls, 1);
  assert.equal(output.structuredContent.metric_ready, false);

});
test('book adapter source excludes transport fallbacks and quote smoke is outside dependency closure', () => {
  const source = readFileSync(new URL('../../src/market-orderbook.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|process\.env|https?\.request|\/trading\/|quote-smoke|kis-http/);
  for (const schema of [f.MarketOrderbookInputSchema, f.MarketOrderbookRequestSchema, f.MarketOrderbookRawSchema, f.MarketOrderbookResultSchema]) assert.equal(z.toJSONSchema(schema).type, 'object');
});
for (const key of ['__proto__', 'constructor', 'prototype']) test(`book unsafe prototype key ${key} rejected rather than silently dropped`, async () => {
  const output2 = Object.fromEntries([[key, { note: 'synthetic-only' }]]);
  await assert.rejects(fx.book({ ...fx.bookBody, output2 }), code('schema_drift'));
});
for (const output2 of [JSON.parse('{"nested":{"__proto__":{"stck_shrn_iscd":"000660"}}}'), JSON.parse('[{"__proto__":"raw"}]')]) test('book nested/array prototype keys fail closed rather than lose echo evidence', async () => {
  await assert.rejects(fx.book({ ...fx.bookBody, output2 }), code('schema_drift'));
});
test('book negative-zero JS number is outside the stable-JSON subset, not silently normalized', async () => {
  await assert.rejects(fx.book({ ...fx.bookBody, output2: { raw_number: -0 } }), code('schema_drift'));
});

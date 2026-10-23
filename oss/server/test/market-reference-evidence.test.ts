import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import * as f from '../src/market-reference-evidence.js';
import { marketDigest } from '../src/market-reference-snapshot.js';
import * as fx from './market-reference-fixtures.js';
const select = f.selectMarketReferenceEvidence, replay = f.validateMarketReferenceEvidenceCandidate;
const code = (expected: string) => (e: unknown) => e instanceof f.MarketReferenceEvidenceError && e.code === expected && e.message === expected;
for (const policy of f.MARKET_REFERENCE_POLICIES) test(`finite ${policy} selects exact original lexeme and fixed path only`, async () => {
  const input = await fx.selectionInput(policy); const r = select(input);
  assert.equal(r.policy, policy); assert.equal(r.requested_role, input.requested_role); assert.equal(r.origin, 'synthetic');
  assert.equal(r.selected.raw_state, 'decimal_text_candidate');
  assert.equal(r.selected.raw_lexeme, policy === 'kr_orderbook_best_bid' ? fx.bookBody.output1.bidp1 : policy === 'kr_orderbook_best_ask' ? '101' : policy === 'us_quote_previous_close' ? '00099.0000000000000001' : '99');
  assert.deepEqual(r.snapshot.value, input.source_dto); assert.equal(r.snapshot.sha256, marketDigest(input.source_dto));
  assert.equal(r.snapshot.original_http_body_hash, null); assert.equal(r.source_authenticated, false); assert.equal(r.canonical_observation, null); assert.equal(r.metric_ready, false);
  assert.equal(r.selected.dto_selector, policy === 'us_quote_previous_close' ? '$.raw.base' : policy === 'kr_intraday_previous_close' ? '$.raw.output1.stck_prdy_clpr' : policy === 'kr_orderbook_best_bid' ? '$.raw.output1.bidp1' : '$.raw.output1.askp1');
  assert.deepEqual(replay(JSON.parse(JSON.stringify(r))), r);
});
test('selector does not manufacture previous session/source time, currency, scaling or canonical bid/ask', async () => {
  for (const policy of f.MARKET_REFERENCE_POLICIES) {
    const r = select(await fx.selectionInput(policy));
    for (const field of ['source_at', 'published_at', 'available_at', 'session', 'previous_session_id', 'previous_session_close_at', 'currency', 'price_unit', 'split_basis'] as const) assert.equal(r[field], null);
    assert.equal(r.received_at, fx.RECEIPT); assert.equal(r.identity_verified, false); assert.equal(r.semantic_binding_verified, false); assert.equal(r.simultaneous_quotes_verified, false);
  }
});
test('existing US/whole KR DTO request reconstruction remains explicitly unauthenticated', async () => {
  const us = select(await fx.selectionInput('us_quote_previous_close')); const kr = select(await fx.selectionInput('kr_intraday_previous_close'));
  assert.equal(us.source_request.path, '/uapi/overseas-price/v1/quotations/price'); assert.equal(us.source_request.tr_id, 'HHDFS00000300');
  assert.equal(us.request_evidence_status, 'reconstructed_from_existing_dto_not_original_http_receipt');
  assert.deepEqual(kr.source_request.query, { FID_COND_MRKT_DIV_CODE: 'NX', FID_INPUT_ISCD: '005930', FID_INPUT_HOUR_1: '150000', FID_PW_DATA_INCU_YN: 'N', FID_ETC_CLS_CODE: '' });
  assert.equal(kr.snapshot.value.contract, 'moai.stock.kr-intraday-history.v1');
  assert.equal(kr.source_at, null); assert.equal(kr.previous_session_close_at, null);
});
for (const [value, state] of [[undefined, 'missing'], ['', 'blank'], ['0', 'decimal_text_candidate'], ['000.00', 'decimal_text_candidate'], ['1e3', 'unsupported_raw_text'], ['+1', 'unsupported_raw_text'], ['-1', 'unsupported_raw_text'], [' 1 ', 'unsupported_raw_text'], [' ', 'unsupported_raw_text'], ['1,000', 'unsupported_raw_text'], ['１２', 'unsupported_raw_text'], ['1'.repeat(41), 'unsupported_raw_text']] as const)
  test(`raw lexical state ${String(value)} is explicit without conversion`, async () => {
    const body: any = structuredClone(fx.bookBody); if (value === undefined) delete body.output1.bidp1; else body.output1.bidp1 = value;
    const q = { ...await fx.selectionInput(), source_dto: await fx.book(body) }; const r = select(q);
    assert.equal(r.selected.raw_state, state); assert.equal(r.selected.raw_lexeme, value ?? null); assert.equal(r.canonical_observation, null); assert.deepEqual(replay(r), r);
  });
for (const policy of ['us_quote_previous_close', 'kr_intraday_previous_close'] as const) test(`${policy} absent and blank are never back-solved from last/change`, async () => {
  for (const absent of [true, false]) {
    const dto: any = policy === 'us_quote_previous_close' ? await fx.us() : await fx.kr();
    const raw = policy === 'us_quote_previous_close' ? dto.raw : dto.raw.output1; const key = policy === 'us_quote_previous_close' ? 'base' : 'stck_prdy_clpr';
    if (absent) delete raw[key]; else raw[key] = '';
    const r = select({ policy, cutoff: fx.CUTOFF, requested_role: 'market.previous_close', source_dto: dto });
    assert.equal(r.selected.raw_state, absent ? 'missing' : 'blank'); assert.equal(r.selected.raw_lexeme, absent ? null : '');
  }
});
for (const [label, edit] of [['arbitrary dto path', (q: any) => q.dto_selector = '$.raw.stck_sdpr'], ['provider path', (q: any) => q.provider_selector = '$.output2.antc_cnpr'], ['last-minus-change policy', (q: any) => q.policy = 'last_minus_change'], ['wrong requested role', (q: any) => q.requested_role = 'market.previous_close'], ['new metric role', (q: any) => q.requested_role = 'liquidity.spread'], ['scalar injection', (q: any) => q.value = '1'], ['alternate source dto', (q: any) => q.source_dto = {}]] as const)
  test(`selector rejects ${label}`, async () => { const q: any = await fx.selectionInput(); edit(q); assert.throws(() => select(q), code('invalid_input')); });
test('selector US rsym guard is rechecked, not trusted from DTO identity flag', async () => {
  const q: any = await fx.selectionInput('us_quote_previous_close'); q.source_dto.raw.rsym = 'DNASOTHER'; assert.throws(() => select(q), code('instrument_mismatch'));
});
test('selector book DTO reconstructed rather than trusting mutable metadata', async () => {
  const q: any = structuredClone(await fx.selectionInput()); q.source_dto.warnings = ['invented']; assert.throws(() => select(q), code('source_normalization_conflict'));
});
test('selector KR cross-field row counts/continuation and schema coercion cannot masquerade as original DTO', async () => {
  const q: any = await fx.selectionInput('kr_intraday_previous_close'); q.source_dto.bars_returned = 0; assert.throws(() => select(q), code('invalid_input'));
  const r: any = await fx.selectionInput('kr_intraday_previous_close'); delete r.source_dto.requested.board; assert.throws(() => select(r), code('source_normalization_conflict'));
});
test('exact cutoff rejects a subnanosecond future receipt and accepts offset equivalence', async () => {
  const q = await fx.selectionInput(); q.cutoff = '2026-10-22T03:00:00.123456789122999999Z'; assert.throws(() => select(q), code('future_receipt'));
  q.cutoff = '2026-10-22T12:00:00.123456789123+09:00'; assert.equal(select(q).received_at, fx.RECEIPT);
});
test('source origin actual is preserved without promotion to source authentication', async () => {
  const q: any = await fx.selectionInput('us_quote_previous_close'); q.source_dto.origin = 'actual'; const r = select(q); assert.equal(r.origin, 'actual'); assert.equal(r.source_authenticated, false); assert.equal(r.snapshot.source_authentication, false);
});
test('exact receipt profile rejects old DTO unknown offsets and invalid instants', async () => {
  for (const receipt of ['2026-10-22T03:00:00-00:00', '2026-02-30T03:00:00Z']) { const q: any = await fx.selectionInput('us_quote_previous_close'); q.source_dto.received_at = receipt; assert.throws(() => select(q), code('invalid_input')); }
});
test('whole snapshot and candidate integrity are stable across object key order, not array order', async () => {
  const q: any = await fx.selectionInput(); const a = select(q);
  const reverse = (v: any): any => Array.isArray(v) ? v.map(reverse) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, v]) => [k, reverse(v)])) : v;
  assert.equal(select(reverse(q)).integrity.sha256, a.integrity.sha256);
  const r = await fx.book({ ...fx.bookBody, output2: [...fx.bookBody.output2].reverse() });
  assert.notEqual(select({ ...q, source_dto: r }).snapshot.sha256, a.snapshot.sha256);
});
test('returned evidence owns a deep immutable snapshot', async () => {
  const q: any = await fx.selectionInput('us_quote_previous_close'); const r = select(q); q.source_dto.raw.base = '7';
  assert.equal((r.snapshot.value as any).raw.base, '00099.0000000000000001'); assert.ok(Object.isFrozen(r.snapshot.value.raw));
  assert.throws(() => { (r as any).selected.raw_lexeme = '7'; }, TypeError);
});
for (const [name, edit] of [['raw lexeme', (r: any) => r.selected.raw_lexeme = '999'], ['raw state', (r: any) => r.selected.raw_state = 'missing'], ['dto selector', (r: any) => r.selected.dto_selector = '$.raw.output1.askp1'], ['provider selector', (r: any) => r.selected.provider_selector = '$.output1.askp1'], ['request route', (r: any) => r.source_request.query.FID_COND_MRKT_DIV_CODE = 'J'], ['origin', (r: any) => r.origin = 'actual'], ['snapshot digest', (r: any) => r.snapshot.sha256 = '0'.repeat(64)], ['receipt', (r: any) => r.received_at = '2026-10-22T02:00:00Z'], ['warnings', (r: any) => r.warnings = ['omitted blockers']], ['snapshot raw', (r: any) => r.snapshot.value.raw.output1.bidp1 = '200'], ['mapping blockers', (r: any) => r.mapping_blockers = ['made up']], ['unknown field', (r: any) => r.extra = 'x']] as const)
  test(`persisted replay rejects ${name} tampering even after outer integrity rehash`, async () => {
    const r: any = JSON.parse(JSON.stringify(select(await fx.selectionInput()))); edit(r); const { integrity: _, ...body } = r; r.integrity.sha256 = marketDigest(body);
    assert.throws(() => replay(r), code('candidate_mismatch'));
  });
for (const [name, edit] of [['metric readiness', (r: any) => r.metric_ready = true], ['source authentication', (r: any) => r.source_authenticated = true], ['canonical promotion', (r: any) => r.canonical_observation = { value: '100' }], ['firmness', (r: any) => r.quote_firmness = 'firm'], ['simultaneous', (r: any) => r.simultaneous_quotes_verified = true], ['currency', (r: any) => r.currency = 'KRW']] as const)
  test(`persisted replay forbids ${name}`, async () => { const r: any = JSON.parse(JSON.stringify(select(await fx.selectionInput()))); edit(r); assert.throws(() => replay(r), code('candidate_mismatch')); });
test('persisted replay and selection reject proxy/accessor/cycle hooks before execution', async () => {
  let hits = 0; const q: any = await fx.selectionInput(); const proxy = new Proxy(q, { get() { hits++; throw new Error('never'); }, ownKeys() { hits++; return []; } });
  assert.throws(() => select(proxy), code('invalid_source_snapshot')); assert.throws(() => replay(proxy), code('invalid_source_snapshot'));
  const getter: any = { ...q }; Object.defineProperty(getter, 'source_dto', { enumerable: true, get() { hits++; return q.source_dto; } });
  assert.throws(() => select(getter), code('invalid_source_snapshot')); assert.equal(hits, 0);
  const cycle: any = {}; cycle.self = cycle; assert.throws(() => select(cycle), code('invalid_source_snapshot'));
});
test('selection and replay reject conservative synthetic private markers without exposing values', async () => {
  const q: any = await fx.selectionInput('us_quote_previous_close'); q.source_dto.warnings.push('Bearer SYNTHETIC_ONLY'); assert.throws(() => select(q), code('invalid_source_snapshot'));
  const r: any = JSON.parse(JSON.stringify(select(await fx.selectionInput()))); r.snapshot.value.raw.output2 = { appsecret: 'SYNTHETIC_ONLY' }; assert.throws(() => replay(r), code('invalid_source_snapshot'));
});
test('oversized or deeply nested snapshots fail before schema parsing', () => {
  assert.throws(() => select({ x: '한'.repeat(200000) }), code('snapshot_too_large'));
  assert.throws(() => replay(new Array(2 ** 32 - 1)), code('snapshot_too_large'));
});
test('selector imports only provider DTOs/utilities, no formulas, report engine, network or arbitrary path evaluator', () => {
  const text = readFileSync(new URL('../../src/market-reference-evidence.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /\bfetch\s*\(|https?\.request|process\.env|quote-smoke|kis-http|financial-fact-bridge|market_metrics|jsonpath|parseFloat|parseInt|Number\(/);
  for (const schema of [f.MarketReferenceEvidenceInputSchema, f.MarketReferenceEvidenceCandidateSchema]) assert.ok(z.toJSONSchema(schema));
});
test('oversized escaped strings and keys reject before credential decoding work', () => {
  const original = globalThis.decodeURIComponent; let calls = 0;
  globalThis.decodeURIComponent = (text: string) => { calls++; return original(text); };
  try {
    assert.throws(() => select({ text: '%20'.repeat(200001) }), code('snapshot_too_large'));
    assert.throws(() => select({ ['%20'.repeat(200001)]: 'x' }), code('snapshot_too_large'));
  } finally { globalThis.decodeURIComponent = original; }
  assert.equal(calls, 0);
});
test('finite exported policy registry is runtime immutable', () => {
  assert.ok(Object.isFrozen(f.MARKET_REFERENCE_POLICIES));
  assert.throws(() => { (f.MARKET_REFERENCE_POLICIES as any).push('arbitrary_path'); }, TypeError);
});

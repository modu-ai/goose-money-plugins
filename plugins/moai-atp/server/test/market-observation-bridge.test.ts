import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import * as b from '../src/market-observation-bridge.js';
import { marketDigest, marketCanonicalJson } from '../src/market-reference-snapshot.js';
import { reconstructMarketOrderbookResult } from '../src/market-orderbook.js';
import * as f from './market-observation-fixtures.js';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REF = ROOT + 'contracts/report-market-observation-reference/';
// Optional explicit authority comparison. Extracted packages default to the pinned closure.
const AUTHORITY = process.env.MOAI_MARKET_REPORT_AUTHORITY_DIR;
const REPORT_REFERENCE = AUTHORITY ? resolve(AUTHORITY) + sep : REF;
const pin = JSON.parse(readFileSync(REF + 'pin.json', 'utf8'));
const clone = f.clone;
function report(input: unknown, reference = REPORT_REFERENCE) {
  for (const name of ['market_metrics.py', 'financial_core.py']) assert.equal(createHash('sha256').update(readFileSync(reference + name)).digest('hex'), pin.files[name]);
  const p = spawnSync('python3', ['-X', 'utf8', '-B', '-c', 'import json,sys;from market_metrics import calculate;print(json.dumps(calculate(json.load(sys.stdin)),sort_keys=True))'], { cwd: reference, input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr); return JSON.parse(p.stdout);
}
const assemble = (x: f.SyntheticMarketFixture, verifier = f.syntheticMarketVerifier(x), clock = () => f.VERIFIED) => b.assembleMarketObservationReportInput(x.candidate, x.binding, verifier, clock);
async function relink(x: f.SyntheticMarketFixture) {
  x.candidate = clone(await b.selectMarketObservationEvidence({ policy: x.candidate.policy, cutoff: x.candidate.cutoff, include_provider_percent: x.candidate.include_provider_percent, source_dto: x.candidate.source_dto }));
  x.binding.candidate_sha256 = x.candidate.integrity_sha256;
  const s = x.candidate.source_dto;
  x.originalBytes = JSON.stringify(s.contract === 'moai.stock.us-quote.v1' ? { rt_cd: '0', output: s.raw } : { rt_cd: '0', ...s.raw }, null, 2) + '\n';
  x.binding.artifacts[0]!.sha256 = f.hashBytes(x.originalBytes); x.binding.artifacts[0]!.snapshot!.source_dto_sha256 = x.candidate.source_dto_sha256;
}
for (const policy of b.MARKET_OBSERVATION_POLICIES) test(`${policy}: source-to-report input executes the unchanged pinned scalar runtime and optional authority comparison`, async () => {
  const x = await f.marketObservationFixture(policy), h = await assemble(x), r = report(h.report_input), portable = report(h.report_input, REF);
  assert.deepEqual(r, portable); assert.equal(r.status, 'evaluated'); assert.equal(r.results[0].status, 'conditional_supplied_metric');
  assert.equal(r.results[0].canonical_metric.value.decimal, policy === 'us_equity_change' ? '1.25' : '20');
  assert.equal(r.results[0].accepted_chart_bindings, 0); assert.equal(r.source_authenticated, false); assert.equal(r.actual_bindings, 0);
  assert.equal(h.source_authenticated, false); assert.equal(h.actual_provider_calls, 0); assert.equal(h.inputs.candidate.metric_ready, false);
  assert.equal(h.inputs.candidate.canonical_observation, null); assert.equal(h.inputs.candidate.source_dto.canonical_projection_status, 'blocked');
  assert.equal(h.lineage.original_body_sha256, f.hashBytes(x.originalBytes));
  assert.equal(h.lineage.source_dto_sha256, marketDigest(x.candidate.source_dto));
  assert.notEqual(h.lineage.original_body_sha256, h.lineage.source_dto_sha256);
  const role = policy === 'us_equity_change' ? 'market.last' : 'market.best_bid';
  assert.equal(h.report_input.entries[0]!.observations[role]!.value, policy === 'us_equity_change' ? '101.2500' : '99.9000');
  assert.equal(h.lineage.selections[0]!.raw_lexeme, policy === 'us_equity_change' ? '000101.2500' : '00099.9000');
});
test('optional absent provider percent is arithmetic-only, not a claimed accepted change metric', async () => {
  const x = await f.marketObservationFixture('us_equity_change', false), h = await assemble(x), r = report(h.report_input).results[0];
  assert.equal(r.status, 'arithmetic_only'); assert.equal(r.arithmetic.value.decimal, '1.25'); assert.equal(r.canonical_metric.value, null);
  assert.equal(r.provider_crosscheck.status, 'unverified'); assert.equal(r.provider_crosscheck.reason.code, 'missing_provider_percent');
});
test('independently supplied percent mismatch stays separate from exact arithmetic', async () => {
  const x = await f.marketObservationFixture(); (x.candidate.source_dto.raw as any).rate = '1.24'; await relink(x);
  const r = report((await assemble(x)).report_input).results[0]; assert.equal(r.arithmetic.value.decimal, '1.25'); assert.equal(r.provider_crosscheck.status, 'mismatch'); assert.equal(r.canonical_metric.value, null);
});
test('explicit verified scale is retained, not inferred from zdiv or baked into raw values', async () => {
  const x = await f.marketObservationFixture(); for (const o of x.binding.observations) if (o.unit === 'money_per_share') o.scale = '0.01';
  const h = await assemble(x); assert.equal(h.report_input.entries[0]!.observations['market.last']!.value, '101.2500'); assert.equal(h.report_input.entries[0]!.observations['market.last']!.scale, '0.01'); assert.equal(report(h.report_input).results[0].canonical_metric.value.decimal, '1.25');
});
for (const policy of b.MARKET_OBSERVATION_POLICIES) test(`${policy}: default-deny, serialized approval and actual labels cannot promote`, async () => {
  const x = await f.marketObservationFixture(policy);
  await assert.rejects(b.assembleMarketObservationReportInput(x.candidate, x.binding), { code: 'verification_not_configured' });
  await assert.rejects(b.assembleMarketObservationReportInput(x.candidate, { ...x.binding, verified: true }, f.syntheticMarketVerifier(x)), { code: 'invalid_binding' });
  const actual: any = clone(x); actual.candidate.source_dto.origin = 'actual'; await relink(actual);
  for (const [i, a] of actual.binding.artifacts.entries()) { a.data_kind = 'actual'; a.digest_kind = i ? 'review_record' : 'original_bytes'; a.locator = 'https://example.invalid/evidence/' + a.id; }
  await assert.rejects(assemble(actual, f.syntheticMarketVerifier(x)), { code: 'actual_verifier_required' });
  await assert.rejects(f.syntheticMarketVerifier(x).verify({ contract: 'moai.market.observation-verification-request.v1', input_sha256: marketDigest({ candidate: actual.candidate, binding: actual.binding }), candidate: actual.candidate, binding: actual.binding }));
});
for (const [label, change, code] of [
  ['requested identity', (x: any) => x.binding.identity.provider_symbol = 'OTHER', 'identity_mismatch'],
  ['report symbol', (x: any) => x.binding.instrument.symbol = 'OTHER', 'identity_mismatch'],
  ['provider market', (x: any) => x.binding.identity.provider_market = 'NYS', 'identity_mismatch'],
  ['unit', (x: any) => x.binding.observations[0].unit = 'percent', 'unit_currency_mismatch'],
  ['currency mismatch', (x: any) => x.binding.observations[0].currency = 'KRW', 'unit_currency_mismatch'],
  ['nondecimal scale', (x: any) => x.binding.observations[0].scale = '1e3', 'invalid_binding'],
  ['scale newline', (x: any) => x.binding.observations[0].scale = '1\n', 'invalid_binding'],
  ['missing scale', (x: any) => delete x.binding.observations[0].scale, 'invalid_binding'],
  ['wrong source session', (x: any) => x.binding.observations[1].observation_session_id = x.binding.context.session_id, 'reference_session_mismatch'],
  ['same prior session', (x: any) => x.binding.context.previous_session_id = x.binding.context.session_id, 'reference_session_mismatch'],
  ['prior close instant', (x: any) => x.binding.context.previous_close_at = '2026-10-21T20:00:00.000000000001Z', 'reference_session_mismatch'],
  ['source after publication', (x: any) => x.binding.observations[0].source_at = '2026-10-22T14:30:00.123456789125Z', 'invalid_chronology'],
  ['publication after receipt', (x: any) => x.binding.observations[0].published_at = '2026-10-22T14:30:01.123456789124Z', 'invalid_chronology'],
  ['availability before receipt', (x: any) => x.binding.observations[0].available_at = '2026-10-22T14:30:01.123456789122Z', 'invalid_chronology'],
  ['availability after cutoff', (x: any) => x.binding.observations[0].available_at = '2026-10-22T14:30:01.123456789125Z', 'invalid_chronology'],
  ['provider percent different instant', (x: any) => x.binding.observations[2].source_at = '2026-10-22T14:30:00.123456789122Z', 'percent_context_mismatch'],
  ['missing percent independence', (x: any) => delete x.binding.context.independent_percent_assertion, 'percent_context_mismatch'],
  ['missing percent rounding', (x: any) => delete x.binding.context.provider_rounding_policy, 'percent_context_mismatch'],
  ['unknown context', (x: any) => x.binding.context.auto_date = true, 'invalid_binding'],
  ['unknown instrument metadata', (x: any) => x.binding.instrument.verified = true, 'invalid_binding'],
  ['unknown unit metadata', (x: any) => x.binding.observations[0].zdiv_scale = '1', 'invalid_binding'],
  ['unknown artifact metadata', (x: any) => x.binding.artifacts[0].authenticated = true, 'invalid_binding'],
  ['candidate hash', (x: any) => x.binding.candidate_sha256 = '0'.repeat(64), 'binding_candidate_mismatch'],
  ['DTO linkage', (x: any) => x.binding.artifacts[0].snapshot.source_dto_sha256 = '0'.repeat(64), 'evidence_mismatch'],
  ['receipt linkage', (x: any) => x.binding.artifacts[0].snapshot.received_at = '2026-10-22T14:30:01.123456789122Z', 'evidence_mismatch'],
  ['unused evidence', (x: any) => x.binding.artifacts.push({ ...x.binding.artifacts[1], id: 'unused' }), 'evidence_mismatch'],
  ['duplicate artifact', (x: any) => x.binding.artifacts.push(x.binding.artifacts[1]), 'evidence_mismatch'],
  ['missing evidence axis', (x: any) => delete x.binding.evidence.rights, 'invalid_binding'],
  ['invented evidence id', (x: any) => x.binding.evidence.rights = ['invented'], 'evidence_mismatch'],
  ['invalid revision', (x: any) => x.binding.observations[0].revision.status = 'revised', 'invalid_revision'],
  ['noncurrent finality', (x: any) => x.binding.observations[0].revision.finality = 'preliminary', 'invalid_binding'],
  ['rights expired at cutoff', (x: any) => x.binding.rights.valid_until = '2026-10-22T14:30:01.123456789123Z', 'rights_outside_window'],
  ['portable export', (x: any) => x.binding.rights.purpose = 'portable_export', 'invalid_binding'],
  ['role substitution', (x: any) => x.binding.observations[0].role = 'market.best_bid', 'role_mapping_mismatch'],
  ['missing freshness', (x: any) => delete x.binding.context.freshness_policy.max_age_seconds['market.last'], 'freshness_policy_mismatch'],
  ['year zero', (x: any) => x.binding.rights.valid_from = '0000-01-01T00:00:00Z', 'invalid_binding'],
  ['UTC year overflow', (x: any) => x.binding.rights.valid_until = '9999-12-31T23:59:59-01:00', 'invalid_binding'],
  ['unknown offset', (x: any) => x.binding.observations[0].source_at = '2026-10-22T14:30:00-00:00', 'invalid_binding'],
] as const) test(`reject ${label}`, async () => { const x = await f.marketObservationFixture(), verifier = f.syntheticMarketVerifier(x); change(x); await assert.rejects(assemble(x, verifier), { code }); });
for (const [label, change] of [
  ['issuer', (x: any) => x.binding.identity.issuer_id = 'different-issuer'],
  ['listing', (x: any) => x.binding.identity.listing_id = 'different-listing'],
  ['security', (x: any) => x.binding.instrument.security_id = 'different-security'],
  ['share class', (x: any) => x.binding.instrument.share_class = 'preferred'],
  ['venue', (x: any) => x.binding.instrument.venue = 'OTHER'],
  ['split basis', (x: any) => x.binding.instrument.split_basis = 'OTHER'],
  ['price scale', (x: any) => x.binding.observations[0].scale = '100'],
  ['same but wrong currency', (x: any) => x.binding.observations.forEach((o: any) => o.currency = 'EUR')],
  ['original bytes hash', (x: any) => x.binding.artifacts[0].sha256 = '0'.repeat(64)],
  ['revision identity', (x: any) => x.binding.observations[0].revision.revision_id = 'other-revision'],
  ['rights extension', (x: any) => x.binding.rights.valid_until = '2099-01-01T00:00:00Z'],
  ['alternate session context', (x: any) => { x.binding.context.session_id = 'OTHER'; x.binding.observations[0].observation_session_id = 'OTHER'; x.binding.observations[2].observation_session_id = 'OTHER'; }],
] as const) test(`separately trusted verification rejects plausible but unverified ${label}`, async () => { const x = await f.marketObservationFixture(), verifier = f.syntheticMarketVerifier(x); change(x); await assert.rejects(assemble(x, verifier), { code: 'verification_failed' }); });
for (const raw of ['', ' ', '1e3', '+1', '1,000', '-1', 'NaN', 'Infinity', '１２', '1\n']) test(`raw book ${JSON.stringify(raw)} stays candidate-only and cannot be promoted`, async () => {
  const x = await f.marketObservationFixture('kr_equity_spread'); const s: any = x.candidate.source_dto; s.raw.output1.bidp1 = raw;
  x.candidate.source_dto = clone(reconstructMarketOrderbookResult(s.requested, s.raw, { origin: 'synthetic', received_at: s.received_at, tr_cont: '' })); await relink(x);
  assert.equal(x.candidate.metric_ready, false); await assert.rejects(assemble(x), { code: 'invalid_raw_value' });
});
for (const raw of [undefined, '', '0']) test(`previous close ${String(raw)} is not inferred from last or delta`, async () => {
  const x = await f.marketObservationFixture(); if (raw === undefined) delete (x.candidate.source_dto.raw as any).base; else (x.candidate.source_dto.raw as any).base = raw; await relink(x);
  await assert.rejects(assemble(x), { code: raw === '0' ? 'invalid_price' : 'invalid_raw_value' });
});
test('same-response pair needs independently bound exact simultaneous source times', async () => {
  const x = await f.marketObservationFixture('kr_equity_spread'); x.binding.observations[1]!.source_at = '2026-10-22T14:30:00.123456789122Z';
  await assert.rejects(assemble(x), { code: 'quote_pair_mismatch' });
});
test('crossed and all-zero quotes are not accepted', async () => {
  for (const [bid, ask] of [['101', '100'], ['0', '0']]) { const x = await f.marketObservationFixture('kr_equity_spread'); const s: any = x.candidate.source_dto; s.raw.output1.bidp1 = bid; s.raw.output1.askp1 = ask; x.candidate.source_dto = clone(reconstructMarketOrderbookResult(s.requested, s.raw, { origin: 'synthetic', received_at: s.received_at, tr_cont: '' })); await relink(x); await assert.rejects(assemble(x), { code: 'invalid_price' }); }
});
test('freshness fractions are evaluated exactly by authoritative runtime, not a JS approximation', async () => {
  const x = await f.marketObservationFixture(); x.binding.context.freshness_policy.max_age_seconds['market.last'] = '1';
  const r = report((await assemble(x)).report_input).results[0]; assert.equal(r.status, 'arithmetic_only'); assert.ok(r.interpretation.reasons.some((x: any) => x.code === 'stale_observation')); assert.equal(r.canonical_metric.value, null);
});
test('offset-equivalent evidence instants do not lose fractional ordering', async () => {
  const x = await f.marketObservationFixture(); x.binding.artifacts[0]!.snapshot!.received_at = '2026-10-22T23:30:01.123456789123+09:00';
  const h = await assemble(x); assert.equal(report(h.report_input).results[0].status, 'conditional_supplied_metric'); assert.equal(h.lineage.receipt, f.RECEIVED);
});
for (const [label, mutate] of [
  ['book UN', (x: any) => { const s = x.candidate.source_dto; s.requested.board = 'UN'; s.source_request.query.FID_COND_MRKT_DIV_CODE = 'UN'; }],
  ['US ETF', (x: any) => x.candidate.source_dto.asset_class_from_request = 'etf'],
  ['US unknown class', (x: any) => x.candidate.source_dto.asset_class_from_request = null],
] as const) test(`reject unsupported ${label}`, async () => {
  const x = await f.marketObservationFixture(label.startsWith('book') ? 'kr_equity_spread' : 'us_equity_change'); mutate(x);
  await assert.rejects(b.selectMarketObservationEvidence({ policy: x.candidate.policy, cutoff: f.CUTOFF, include_provider_percent: x.candidate.include_provider_percent, source_dto: x.candidate.source_dto }), { code: 'unsupported_source_scope' });
});
test('raw DTO normalization metadata is reconstructed, not trusted', async () => {
  for (const policy of b.MARKET_OBSERVATION_POLICIES) { const x: any = await f.marketObservationFixture(policy); x.candidate.source_dto.warnings = ['invented']; await assert.rejects(b.selectMarketObservationEvidence({ policy, cutoff: f.CUTOFF, include_provider_percent: x.candidate.include_provider_percent, source_dto: x.candidate.source_dto }), { code: 'source_reconstruction_mismatch' }); }
});
test('exact candidate cutoff rejects a future receipt below nanosecond precision', async () => {
  const x = await f.marketObservationFixture(); await assert.rejects(b.selectMarketObservationEvidence({ policy: x.candidate.policy, cutoff: '2026-10-22T14:30:01.12345678912299999Z', include_provider_percent: true, source_dto: x.candidate.source_dto }), { code: 'invalid_chronology' });
});
for (const [label, mutate] of [
  ['raw lexeme', (x: any) => x.selections[0].raw_lexeme = '999'], ['selector', (x: any) => x.selections[0].dto_selector = '$.raw.base'],
  ['nested reference', (x: any) => x.reference_candidates[0].selected.raw_lexeme = '999'], ['source digest', (x: any) => x.source_dto_sha256 = '0'.repeat(64)],
  ['raw DTO bytes', (x: any) => x.source_dto.raw.last = '999'], ['selection warnings', (x: any) => x.warnings = ['changed']],
] as const) test(`candidate ${label} tampering fails even after envelope rehash`, async () => {
  const x = await f.marketObservationFixture(); mutate(x.candidate); const { integrity_sha256, ...body } = x.candidate; x.candidate.integrity_sha256 = marketDigest(body);
  await assert.rejects(b.validateMarketObservationCandidate(x.candidate), { code: 'candidate_mismatch' });
});
for (const [label, mutate] of [
  ['computed value', (h: any) => h.report_input.entries[0].observations['market.last'].value = '999'],
  ['raw lineage', (h: any) => h.lineage.selections[0].raw_lexeme = '999'], ['DTO linkage', (h: any) => h.lineage.source_dto_sha256 = '0'.repeat(64)],
  ['original hash', (h: any) => h.lineage.original_body_sha256 = '0'.repeat(64)], ['runtime pin', (h: any) => h.report_runtime.files['market_metrics.py'] = '0'.repeat(64)],
  ['warnings', (h: any) => h.warnings = []], ['rights', (h: any) => h.rights.valid_until = '2099-01-01T00:00:00Z'],
  ['receipt hash', (h: any) => h.verification.input_sha256 = '0'.repeat(64)], ['confirmed axis', (h: any) => h.verification.confirmed.rights = ['original-body']],
  ['future verification', (h: any) => h.verification.verified_at = '2026-10-22T14:30:02.000000000003Z'],
] as const) test(`persisted ${label} tampering fails full reconstruction`, async () => {
  const x = await f.marketObservationFixture(), v = f.syntheticMarketVerifier(x), h = clone(await assemble(x, v)); mutate(h);
  await assert.rejects(b.reverifyMarketObservationHandoff(h, v, () => f.REVERIFIED), { code: 'handoff_mismatch' });
});
test('persisted success requires fresh independently bound verification and current rights', async () => {
  const x = await f.marketObservationFixture(), v = f.syntheticMarketVerifier(x), h = await assemble(x, v);
  await assert.rejects(b.reverifyMarketObservationHandoff(clone(h)), { code: 'verification_not_configured' });
  const fresh = await b.reverifyMarketObservationHandoff(clone(h), v, () => f.REVERIFIED); assert.deepEqual(fresh.report_input, h.report_input); assert.notEqual(fresh.verification.verified_at, h.verification.verified_at);
  await b.reverifyMarketObservationHandoff(h, v, () => x.binding.rights.valid_until);
  await assert.rejects(b.reverifyMarketObservationHandoff(h, v, () => '2026-10-23T00:00:00.000000000001Z'), { code: 'rights_outside_window' });
});
test('altered raw source bytes plus internally consistent DTO rehash do not fool separately held truth', async () => {
  const x = await f.marketObservationFixture(), v = f.syntheticMarketVerifier(x); (x.candidate.source_dto.raw as any).last = '999'; await relink(x);
  await assert.rejects(assemble(x, v), { code: 'verification_failed' });
});
test('test-only original-byte verifier actually rejects byte/DTO mismatch', async () => {
  const x = await f.marketObservationFixture(); x.originalBytes = x.originalBytes.replace('000101.2500', '000999.0000'); x.binding.artifacts[0]!.sha256 = f.hashBytes(x.originalBytes);
  await assert.rejects(assemble(x), { code: 'verification_failed' });
});
test('inputs and required axes are deeply immutable across an async verification boundary', async () => {
  const x = await f.marketObservationFixture(), v = f.syntheticMarketVerifier(x); let frozen = false;
  const pending = assemble(x, { ...v, async verify(c) { frozen = Object.isFrozen(c.binding.evidence.rights) && Object.isFrozen(c.candidate.source_dto.raw); assert.throws(() => { (c.binding as any).instrument.symbol = 'OTHER'; }, TypeError); return v.verify(c); } });
  (x.binding as any).instrument.symbol = 'MUTATED'; (x.candidate.source_dto.raw as any).last = '999';
  const h = await pending; assert.ok(frozen); assert.equal(h.report_input.entries[0]!.observations['market.last']!.value, '101.2500');
  assert.ok(Object.isFrozen(b.MARKET_OBSERVATION_AXES)); assert.ok(Object.isFrozen(b.MARKET_OBSERVATION_POLICIES)); assert.ok(Object.isFrozen(h.report_input.entries[0]!.observations));
});
for (const kind of ['getter', 'proxy', 'toJSON', 'date', 'sparse', 'nonfinite', 'unicode', 'oversize']) test(`inert JSON boundary rejects ${kind} without evaluating attacker code`, async () => {
  const x: any = await f.marketObservationFixture(); let called = false;
  if (kind === 'getter') Object.defineProperty(x.binding, 'evil', { enumerable: true, get() { called = true; return 1; } });
  if (kind === 'proxy') x.binding = new Proxy(x.binding, { ownKeys() { called = true; return []; } });
  if (kind === 'toJSON') x.binding.toJSON = () => { called = true; return {}; };
  if (kind === 'date') x.binding.evil = new Date();
  if (kind === 'sparse') x.binding.observations = Array(3);
  if (kind === 'nonfinite') x.binding.evil = Infinity;
  if (kind === 'unicode') x.binding.evil = '\ud800';
  if (kind === 'oversize') x.binding.evil = 'x'.repeat(2_000_001);
  await assert.rejects(assemble(x, f.syntheticMarketVerifier(await f.marketObservationFixture()))); assert.equal(called, false);
});
for (const locator of ['https://example.invalid/doc?token=none', 'https://example.invalid/doc#fragment', 'https://user:pass@example.invalid/doc']) test(`reject unsafe evidence locator ${locator}`, async () => {
  const x = await f.marketObservationFixture(); x.binding.artifacts[0]!.locator = locator; await assert.rejects(assemble(x), { code: 'invalid_binding' });
});
test('finite API is offline-only, routes/version/skills untouched and runtime pins match authority', () => {
  for (const [name, sha] of Object.entries(pin.files)) assert.equal(createHash('sha256').update(readFileSync(REF + name)).digest('hex'), sha);
  const text = readFileSync(ROOT + 'src/market-observation-bridge.ts', 'utf8'); assert.doesNotMatch(text, /\bfetch\s*\(|registerTool\s*\(/);
  assert.doesNotMatch(readFileSync(ROOT + 'src/main.ts', 'utf8'), /market-observation-bridge/);
  assert.equal(pin.files['market_metrics.py'], '5b7ee095e5fb0f678a8d33e7c6fdee9638997be59997a7d277ecd1532f0f05a8');
});
test('post-await clock, not pre-verification time, controls current rights expiry', async () => {
  const x = await f.marketObservationFixture(), v = f.syntheticMarketVerifier(x); let completed = false;
  await assert.rejects(assemble(x, { ...v, async verify(ctx) { const r = await v.verify(ctx); completed = true; return r; } }, () => {
    assert.equal(completed, true); return '2026-10-23T00:00:00.000000000001Z';
  }), { code: 'rights_outside_window' });
});
test('single-venue NX requires explicit matching identity and retains original book field candidates', async () => {
  const x = await f.marketObservationFixture('kr_equity_spread'), s: any = x.candidate.source_dto;
  x.candidate.source_dto = clone(reconstructMarketOrderbookResult({ ...s.requested, board: 'NX' }, s.raw, { origin: 'synthetic', received_at: s.received_at, tr_cont: '' })); await relink(x);
  x.binding.identity.provider_market = 'NX'; x.binding.instrument.venue = 'SYNTHETIC:NXT';
  const h = await assemble(x); assert.equal(h.inputs.candidate.reference_candidates.length, 2); assert.equal(report(h.report_input).results[0].canonical_metric.value.decimal, '20');
});
for (const [label, mutate] of [
  ['missing bytes reconstruction', (r: any) => delete r.original_bytes_independently_reconstructed],
  ['false bytes reconstruction', (r: any) => r.original_bytes_independently_reconstructed = false],
  ['wrong input digest', (r: any) => r.input_sha256 = '0'.repeat(64)],
  ['wrong origin', (r: any) => r.data_kind = 'actual'],
  ['missing axis', (r: any) => delete r.confirmed.identity],
  ['wrong axis refs', (r: any) => r.confirmed.rights = ['original-body']],
  ['unknown decision field', (r: any) => r.approved = true],
] as const) test(`trusted decision rejects ${label}`, async () => {
  const x = await f.marketObservationFixture(), v = f.syntheticMarketVerifier(x);
  await assert.rejects(assemble(x, { ...v, async verify(ctx) { const r: any = await v.verify(ctx); mutate(r); return r; } }), { code: 'verification_mismatch' });
});
test('fresh report results and portable schema fixtures reproduce exact shipped evidence', async () => {
  const dir = ROOT + 'fixtures/market-observation-bridge/', manifest = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
  for (const [name, digest] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(readFileSync(dir + name)).digest('hex'), digest);
  for (const name of manifest.cases) {
    const folder = dir + name + '/', candidate = JSON.parse(readFileSync(folder + 'SYNTHETIC-candidate.json', 'utf8')), binding = JSON.parse(readFileSync(folder + 'SYNTHETIC-binding.json', 'utf8'));
    const x = { candidate, binding, originalBytes: readFileSync(folder + 'SYNTHETIC-original-body.json', 'utf8'), reviewBytes: readFileSync(folder + 'SYNTHETIC-review-record.txt', 'utf8') };
    const old = JSON.parse(readFileSync(folder + 'SYNTHETIC-handoff.json', 'utf8'));
    await assert.rejects(b.reverifyMarketObservationHandoff(old), { code: 'verification_not_configured' });
    const h = await b.reverifyMarketObservationHandoff(old, f.syntheticMarketVerifier(x), () => manifest.reverified_at);
    assert.equal(marketCanonicalJson(h), marketCanonicalJson(JSON.parse(readFileSync(folder + 'SYNTHETIC-reverified-handoff.json', 'utf8'))));
    assert.deepEqual(report(h.report_input), JSON.parse(readFileSync(folder + 'SYNTHETIC-report-result.json', 'utf8')));
  }
});
test('exported JSON Schemas are explicitly structural and validate portable synthetic examples', () => {
  const p = spawnSync('python3', ['-X', 'utf8', '-B', '-c', `import json\nfrom pathlib import Path\nfrom jsonschema import Draft202012Validator\nr=Path('contracts/report-market-observation-reference'); d=Path('fixtures/market-observation-bridge')\nfor case in json.loads((d/'manifest.json').read_text())['cases']:\n for name,fixture in [('candidate','SYNTHETIC-candidate.json'),('binding','SYNTHETIC-binding.json'),('handoff-envelope','SYNTHETIC-handoff.json')]:\n  schema=json.loads((r/(name+'.schema.json')).read_text()); assert 'STRUCTURAL PROFILE ONLY' in schema['description']; Draft202012Validator.check_schema(schema); Draft202012Validator(schema).validate(json.loads((d/case/fixture).read_text()))\n Draft202012Validator(json.loads((r/'input.schema.json').read_text())).validate(json.loads((d/case/'SYNTHETIC-report-input.json').read_text()))`], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
});
test('shipped negative fixtures are deterministically rejected under independent positive truth', async () => {
  const dir = ROOT + 'fixtures/market-observation-bridge/', negatives = JSON.parse(readFileSync(dir + 'SYNTHETIC-negative-cases.json', 'utf8'));
  const truth = await f.marketObservationFixture(), v = f.syntheticMarketVerifier(truth);
  for (const n of negatives.cases) await assert.rejects(b.assembleMarketObservationReportInput(n.candidate, n.binding, v, () => f.VERIFIED), { code: n.expected_error });
});
for (const value of ['604800', '604800.00000000000000000', '604800.00000000000000001']) test(`freshness exact bound ${value} agrees with Python decimal validation`, async () => {
  const x = await f.marketObservationFixture(); x.binding.context.freshness_policy.max_age_seconds['market.last'] = value;
  if (value.endsWith('00001')) await assert.rejects(assemble(x), { code: 'invalid_binding' });
  else assert.equal(report((await assemble(x)).report_input).results[0].status, 'conditional_supplied_metric');
});
test('oversized hostile JSON keys fail byte lower-bound checks before encoding', async () => {
  const x: any = await f.marketObservationFixture(); x.binding['x'.repeat(2_000_001)] = 'value';
  await assert.rejects(assemble(x, f.syntheticMarketVerifier(await f.marketObservationFixture())), { code: 'input_too_large' });
});
test('negative provider percent preserves signed original lexeme and uses exact Python cross-check', async () => {
  const x = await f.marketObservationFixture(); (x.candidate.source_dto.raw as any).last = '00098.7500'; (x.candidate.source_dto.raw as any).rate = '-001.25'; await relink(x);
  const h = await assemble(x), r = report(h.report_input).results[0]; assert.equal(h.lineage.selections[2]!.raw_lexeme, '-001.25'); assert.equal(h.report_input.entries[0]!.observations['market.provider_change_pct']!.value, '-1.25'); assert.equal(r.canonical_metric.value.decimal, '-1.25'); assert.equal(r.provider_crosscheck.status, 'matched_supplied_assertion');
});
for (const key of ['adapter_id', 'mode']) test(`persisted verifier ${key} cannot masquerade as the current adapter`, async () => {
  const x = await f.marketObservationFixture(), v = f.syntheticMarketVerifier(x), h: any = clone(await assemble(x, v));
  h.verification[key] = key === 'adapter_id' ? 'invented-adapter' : 'external_trusted_verification';
  await assert.rejects(b.reverifyMarketObservationHandoff(h, v, () => f.REVERIFIED), { code: 'handoff_mismatch' });
});
for (const [label, value] of [['blank', ''], ['nonnumeric', 'notdecimal'], ['missing integer', '.1'], ['negative', '-1'], ['31 digits', '9'.repeat(31)], ['oversized fraction', '0.' + '0'.repeat(100_000) + '1']] as const) test(`freshness conversion rejects ${label} before unbounded exact arithmetic`, async () => {
  const x = await f.marketObservationFixture(); x.binding.context.freshness_policy.max_age_seconds['market.last'] = value;
  await assert.rejects(assemble(x), { code: 'invalid_binding' });
});

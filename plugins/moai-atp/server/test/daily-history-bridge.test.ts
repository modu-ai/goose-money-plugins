import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assembleUsDailyCanonicalHistory as assemble, reverifyDailyHistoryHandoff as reverify, DAILY_HISTORY_BRIDGE_AXES, type TrustedDailyHistoryVerifier } from '../src/daily-history-bridge.js';
import { dailyHistoryFixture, syntheticHistoryVerifier as verifier, CUTOFF, RECEIVED, VERIFIED, fixtureDigest, relinkSource } from './daily-history-bridge-fixtures.js';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const clone = <T>(x: T): T => structuredClone(x);
const run = (s: unknown, b: unknown, v: TrustedDailyHistoryVerifier | undefined = verifier, clock: () => string = () => VERIFIED) => assemble(s, b, v, clock);
function report(h: any, options: any = { sma_windows: [1, 2], volume_direction: { rule: 'neutral', evidence_ref: 'synthetic:neutral', disclosure: 'Synthetic neutral quantities only.' }, aggregation_windows: [] }) {
  const payload = { contract: 'canonical-history/1.0', cutoff: h.cutoff, request: h.request, histories: { subject: h.history }, options };
  const code = `import json,sys\nfrom jsonschema import Draft202012Validator\nsys.path.insert(0,'contracts/report-history-reference')\nfrom history_semantics import calculate_report\nfrom numeric_core import digest\nx=json.load(sys.stdin)\nDraft202012Validator(json.load(open('contracts/report-history-reference/canonical-history.schema.json'))).validate(x)\nfor p in x['histories']['subject']['points']: assert p['context_sha256']==digest(x['histories']['subject']['context'])\nr=calculate_report(x)\nassert r['actual_source_authenticated'] is False and r['verified_live_provider_bindings']==0 and r['actual_provider_calls']==0\nprint(json.dumps(r))`;
  const r = spawnSync('python3', ['-B', '-c', code], { cwd: ROOT, input: JSON.stringify(payload), encoding: 'utf8', maxBuffer: 3000000 });
  assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
}
test('pin: exact authoritative schema, runtime and numeric core bytes unchanged', () => {
  const p = JSON.parse(readFileSync(ROOT + 'contracts/report-history-reference/pin.json', 'utf8'));
  for (const [name, sha] of Object.entries(p.files)) assert.equal(createHash('sha256').update(readFileSync(ROOT + 'contracts/report-history-reference/' + name)).digest('hex'), sha);
  assert.equal(p.files['canonical-history.schema.json'], 'ac755724fc93442a50f38f3da4ff1749cafdb84221cc6b36efa448b562f55b4f');
  assert.equal(p.files['history_semantics.py'], '55b7c1a0ab05b643d27bb27e072f00846b92d7f8bf749c479dcfedc8479318de');
  assert.equal(p.files['numeric_core.py'], '02e3c646714eec8dca3ceffc9c9b9746f6d0670634a31b81fdb937f9f3656f37');
});
test('synthetic named OHLCV handoff passes pinned schema and Python runtime with exact numeric lineage', async () => {
  const { source, binding, synthetic_body_bytes } = await dailyHistoryFixture(), h = await run(source, binding), r = report(h);
  assert.equal(h.actual_source_authenticated, false); assert.equal(h.status, 'synthetic_history_ready');
  assert.equal(h.history.points[1]!.values.open.value, '100.000000000000000001');
  assert.equal(h.history.points[1]!.values.volume.value, '9007199254740993000');
  assert.equal(h.history.points[1]!.provenance.locator, 'output2[0]:20261021');
  assert.notEqual(h.history.points[0]!.provenance.source_sha256, h.lineage.source_dto_sha256);
  assert.equal(h.history.points[0]!.provenance.source_sha256, h.lineage.source_artifact_sha256);
  assert.equal(h.lineage.source_artifact_sha256, createHash('sha256').update(synthetic_body_bytes).digest('hex'));
  assert.equal(r.results.price_relative.records[1].y_value, '101');
  assert.equal(r.results.ohlcv.records[1].ohlc.open.value, '100.000000000000000001');
  assert.equal(r.results.volume.records[1].y_value, '9007199254740993000');
  assert.equal(source.canonical.bars, null); assert.equal(source.completeness, 'unknown'); assert.equal(source.pagination.status, 'more_signaled_not_fetched');
  assert.equal(h.history.points[0]!.observed_at, null); assert.ok(Object.isFrozen(h.history.context.session.expected_sessions));
});
test('default deny despite complete synthetic asserted evidence', async () => {
  const { source, binding } = await dailyHistoryFixture(); await assert.rejects(assemble(source, binding), { code: 'verification_not_configured' });
});
test('exact sub-nanosecond cutoff equality passes Python; a future point is blocked before verifier', async () => {
  const { source, binding } = await dailyHistoryFixture();
  binding.cutoff = '2026-10-22T00:00:00.12345678900000000000001Z';
  for (const p of binding.points) p.available_at = binding.cutoff;
  report(await run(source, binding));
  binding.points[0]!.available_at = '2026-10-22T00:00:00.12345678900000000000002Z';
  await assert.rejects(run(source, binding), { code: 'invalid_chronology' });
});
test('blank independent OHLC component remains unavailable while verified close and volume compute', async () => {
  const { source, binding } = await dailyHistoryFixture(); (source.raw.output2 as any[])[0].open = ''; relinkSource(source, binding);
  const h = await run(source, binding), r = report(h);
  assert.deepEqual(h.history.points[1]!.values.open, { state: 'unavailable', value: null, missing_reason: 'provider_blank' });
  assert.equal(r.results.ohlcv.records[1].ohlc, null); assert.equal(r.results.ohlcv.records[1].close_only.value, '101');
  assert.equal(r.results.price_relative.status, 'computed'); assert.equal(r.results.volume.status, 'computed');
});
test('invalid OHLC relation does not silently repair candles or erase independent close', async () => {
  const { source, binding } = await dailyHistoryFixture(); (source.raw.output2 as any[])[0].high = '90'; relinkSource(source, binding);
  const r = report(await run(source, binding)); assert.equal(r.results.ohlcv.records[1].ohlc, null); assert.equal(r.results.ohlcv.records[1].close_only.value, '101');
});
test('separate explicit scales and currency are not inferred from zdiv, exchange or provider name', async () => {
  const { source, binding } = await dailyHistoryFixture(); binding.context.units.price_scale = '0.01'; binding.context.units.volume_scale = '0.001'; binding.context.units.currency = 'EUR';
  const h = await run(source, binding), r = report(h);
  assert.equal(h.history.points[0]!.values.close.value, '100'); assert.equal(r.results.ohlcv.records[0].close_only.value, '1');
  assert.equal(r.results.volume.records[0].y_value, '1'); assert.equal(r.results.volume.records[1].y_value, '9007199254740993');
  assert.equal(r.results.ohlcv.currency, 'EUR');
  (source.raw.output2 as any[])[0].tvol = '1001'; relinkSource(source, binding); await assert.rejects(run(source, binding), { code: 'invalid_volume' });
});
test('complete supplied calendar retains missing raw session as gap, never inferred from weekdays', async () => {
  const { source, binding } = await dailyHistoryFixture(); binding.request.start_date = '2026-10-19'; binding.context.session.coverage_start = '2026-10-19'; binding.context.session.expected_sessions.unshift('2026-10-19');
  const r = report(await run(source, binding)); assert.equal(r.results.ohlcv.records[0].close_only, null); assert.equal(r.results.ohlcv.records[0].close_only_missing_reason, 'absent_expected_session');
  assert.equal(r.results.sma.records.find((x: any) => x.x_value === '2026-10-20' && x.series_id === 'sma_2').y_value, null);
});
test('object-shaped output2 preserves exact raw locator without invented index', async () => {
  const { source, binding } = await dailyHistoryFixture(); source.raw.output2 = (source.raw.output2 as any[])[0]; source.bars_returned = 1; binding.points = [binding.points[0]!]; relinkSource(source, binding);
  const h = await run(source, binding); assert.equal(h.history.points[0]!.provenance.locator, 'output2:20261021'); report(h);
});
test('source receipt is immutable across awaited verification; verifier cannot mutate nested inputs', async () => {
  const { source, binding } = await dailyHistoryFixture(); let release!: () => void; const wait = new Promise<void>(r => release = r);
  const v: TrustedDailyHistoryVerifier = { ...verifier, async verify(c) { assert.ok(Object.isFrozen(c.source.raw.output2)); assert.throws(() => { c.binding.context.units.currency = 'KRW'; }); await wait; return verifier.verify(c); } };
  const pending = run(source, binding, v); source.received_at = '2026-10-22T12:00:00Z'; binding.context.units.currency = 'KRW'; release();
  const h = await pending; assert.equal(h.history.points[0]!.received_at, RECEIVED); assert.equal(h.history.context.units.currency, 'USD');
});
test('clock runs after verifier response and exact rights expiration is enforced', async () => {
  const { source, binding } = await dailyHistoryFixture(); binding.rights.valid_until = VERIFIED; let now = VERIFIED; const order: string[] = [];
  const v: TrustedDailyHistoryVerifier = { ...verifier, async verify(c) { order.push('verify'); const d = await verifier.verify(c); now = '2026-10-22T01:00:00.000000002Z'; order.push('response'); return d; } };
  await assert.rejects(run(source, binding, v, () => { order.push('clock'); return now; }), { code: 'rights_outside_window' }); assert.deepEqual(order, ['verify', 'response', 'clock']);
});
for (const axis of DAILY_HISTORY_BRIDGE_AXES) test(`independent ${axis} verifier confirmation must match exact artifact set`, async () => {
  const { source, binding } = await dailyHistoryFixture();
  const v: TrustedDailyHistoryVerifier = { ...verifier, async verify(c) { const d: any = clone(await verifier.verify(c)); d.confirmed[axis] = ['unbound']; return d; } };
  await assert.rejects(run(source, binding, v), { code: 'verification_mismatch' });
});
for (const [label, mutate, code] of [
  ['symbol mismatch', (b: any) => b.provider_identity.symbol = 'OTHER', 'identity_mismatch'],
  ['exchange mismatch', (b: any) => b.provider_identity.exchange = 'NYS', 'identity_mismatch'],
  ['future source availability', (b: any) => b.points[0].available_at = '2026-10-22T00:00:00.123456791Z', 'invalid_chronology'],
  ['availability before receipt', (b: any) => b.points[0].available_at = '2026-10-22T00:00:00.123456788Z', 'invalid_chronology'],
  ['publication after receipt', (b: any) => b.points[0].published_at = CUTOFF, 'invalid_chronology'],
  ['publication before close', (b: any) => b.points[0].published_at = '2026-10-21T19:00:00Z', 'invalid_chronology'],
  ['close date mismatch', (b: any) => b.points[0].session_close_at = '2026-10-20T20:00:00Z', 'invalid_chronology'],
  ['future adjustment vintage', (b: any) => b.context.basis.adjustment_asof = '2026-10-22T00:00:00.123456791Z', 'invalid_chronology'],
  ['row index duplicate', (b: any) => b.points[1].row_index = 0, 'point_mapping_mismatch'],
  ['reordered row proofs', (b: any) => b.points.reverse(), 'point_mapping_mismatch'],
  ['row date mismatch', (b: any) => b.points[0].trade_date = '2026-10-20', 'point_mapping_mismatch'],
  ['missing row proof', (b: any) => b.points.pop(), 'point_mapping_mismatch'],
  ['calendar duplicate', (b: any) => b.context.session.expected_sessions.push('2026-10-21'), 'calendar_mismatch'],
  ['calendar unordered', (b: any) => b.context.session.expected_sessions.reverse(), 'calendar_mismatch'],
  ['calendar missing raw day', (b: any) => b.context.session.expected_sessions.pop(), 'point_mapping_mismatch'],
  ['request beyond coverage', (b: any) => b.request.end_date = '2026-10-22', 'calendar_mismatch'],
  ['reversed request', (b: any) => b.request.start_date = '2026-10-22', 'calendar_mismatch'],
  ['fixed offset timezone', (b: any) => b.context.session.timezone = '-04:00', 'invalid_chronology'],
  ['lowercase timezone alias', (b: any) => b.context.session.timezone = 'utc', 'invalid_chronology'],
  ['case mismatch timezone', (b: any) => b.context.session.timezone = 'america/New_York', 'invalid_chronology'],
  ['host timezone identifier', (b: any) => b.context.session.timezone = 'localtime', 'invalid_chronology'],
  ['rights expired at cutoff', (b: any) => b.rights.valid_until = RECEIVED, 'rights_outside_window'],
  ['rights not started at cutoff', (b: any) => b.rights.valid_from = VERIFIED, 'rights_outside_window'],
  ['missing source link', (b: any) => b.artifacts[0].snapshot = null, 'source_evidence_mismatch'],
  ['wrong DTO digest', (b: any) => b.artifacts[0].snapshot.dto_sha256 = '0'.repeat(64), 'source_evidence_mismatch'],
  ['wrong DTO receipt', (b: any) => b.artifacts[0].snapshot.received_at = CUTOFF, 'source_evidence_mismatch'],
  ['wrong source kind', (b: any) => b.artifacts[0].data_kind = 'actual', 'source_evidence_mismatch'],
  ['review as source', (b: any) => b.source_artifact_id = 'review', 'source_evidence_mismatch'],
  ['duplicate artifact id', (b: any) => b.artifacts.push(b.artifacts[0]), 'source_evidence_mismatch'],
  ['unreferenced artifact', (b: any) => b.artifacts.push({ ...b.artifacts[1], id: 'unused' }), 'source_evidence_mismatch'],
  ['dangling evidence', (b: any) => b.evidence.identity = ['absent'], 'source_evidence_mismatch'],
  ['calendar evidence wrong axis', (b: any) => b.context.session.calendar_evidence_ref = 'source-page', 'source_evidence_mismatch'],
  ['revision evidence wrong axis', (b: any) => b.points[0].revision.evidence_ref = 'source-page', 'source_evidence_mismatch'],
  ['revised without prior id', (b: any) => b.points[0].revision.status = 'revised', 'invalid_revision'],
  ['original carries prior id', (b: any) => b.points[0].revision.supersedes_revision_id = 'old', 'invalid_revision'],
  ['wrong close selector', (b: any) => b.selector.close = 'tamt', 'invalid_binding'],
  ['adjusted basis', (b: any) => b.context.basis.adjustment = 'split_adjusted', 'invalid_binding'],
  ['ETF context', (b: any) => b.context.identity.asset_class = 'etf', 'invalid_binding'],
  ['continuous context', (b: any) => b.context.basis.roll_policy = 'continuous', 'invalid_binding'],
  ['invented observation field', (b: any) => b.points[0].observed_at = RECEIVED, 'invalid_binding'],
  ['missing axis', (b: any) => delete b.evidence.currency, 'invalid_binding'],
  ['asserted authorization flag', (b: any) => b.verified = true, 'invalid_binding'],
  ['unbounded sessions', (b: any) => b.context.session.expected_sessions = Array(101).fill('2026-10-20'), 'invalid_binding'],
] as const) test(`reject ${label}`, async () => {
  const { source, binding } = await dailyHistoryFixture(); mutate(binding); await assert.rejects(run(source, binding), { code });
});
test('raw source flags cannot masquerade as unadjusted or equity proof', async () => {
  for (const flag of ['adjustment', 'asset'] as const) { const { source, binding } = await dailyHistoryFixture(); if (flag === 'adjustment') source.requested.adjustment_code = '1'; else source.requested.asset_class = 'etf'; relinkSource(source, binding); await assert.rejects(run(source, binding), { code: 'unsupported_source_scope' }); }
});
test('wrong source contract, duplicate raw dates and future raw dates are rejected', async () => {
  for (const mutation of [(s: any) => s.contract = 'moai.stock.kr-intraday-history.v1', (s: any) => s.raw.output2[1].xymd = s.raw.output2[0].xymd, (s: any) => s.raw.output2[0].xymd = '20261022']) {
    const { source, binding } = await dailyHistoryFixture(); mutation(source); relinkSource(source, binding); await assert.rejects(run(source, binding), { code: 'invalid_source' });
  }
});
test('actual-labelled DTO cannot use synthetic verifier even with actual-form source artifacts', async () => {
  const { source, binding } = await dailyHistoryFixture(); source.origin = 'actual'; for (const a of binding.artifacts) { a.data_kind = 'actual'; a.digest_kind = a.snapshot ? 'original_bytes' : 'review_record'; a.locator = 'https://example.invalid/offline-test/' + a.id; } relinkSource(source, binding);
  await assert.rejects(run(source, binding), { code: 'actual_verifier_required' });
  await assert.rejects(verifier.verify({ contract: 'moai.us-daily.history-verification-request.v1', input_sha256: fixtureDigest({ source, binding }), source, binding }), /synthetic-only/);
});
test('decision replay, wrong adapter and wrong data kind are rejected', async () => {
  for (const bad of [{ input_sha256: '0'.repeat(64) }, { adapter_id: 'other' }, { data_kind: 'actual' }]) {
    const { source, binding } = await dailyHistoryFixture(); const v: TrustedDailyHistoryVerifier = { ...verifier, async verify(c) { return { ...await verifier.verify(c) as object, ...bad }; } };
    await assert.rejects(run(source, binding, v), { code: 'verification_mismatch' });
  }
});
test('verifier failure and invalid clock are sanitized', async () => {
  const { source, binding } = await dailyHistoryFixture(); await assert.rejects(run(source, binding, { ...verifier, async verify() { throw new Error('private credential detail not echoed'); } }), { code: 'verification_failed', message: 'verification_failed' });
  for (const clock of [() => 'nonsense', () => { throw new Error('private'); }, () => RECEIVED]) await assert.rejects(run(source, binding, verifier, clock), { code: 'invalid_chronology' });
});
for (const where of ['source', 'binding'] as const) for (const hostile of ['getter', 'proxy', 'cycle', 'toJSON', 'sparse', 'symbol', 'nonfinite', 'surrogate', 'bidi', 'large'] as const) test(`reject hostile ${where}/${hostile} without hooks`, async () => {
  const f: any = await dailyHistoryFixture(); let target = f[where], calls = 0;
  if (hostile === 'getter') Object.defineProperty(target, 'trap', { enumerable: true, get() { calls++; return true; } });
  if (hostile === 'proxy') f[where] = new Proxy(target, { ownKeys() { calls++; return []; } });
  if (hostile === 'cycle') target.cycle = target;
  if (hostile === 'toJSON') target.toJSON = () => { calls++; return {}; };
  if (hostile === 'sparse') target.extra = new Array(2);
  if (hostile === 'symbol') target[Symbol('secret')] = 'bad';
  if (hostile === 'nonfinite') target.extra = Infinity;
  if (hostile === 'surrogate') target.extra = '\ud800';
  if (hostile === 'bidi') target.extra = '\u202e';
  if (hostile === 'large') target.extra = 'x'.repeat(100001);
  await assert.rejects(run(f.source, f.binding), (e: any) => ['invalid_plain_json', 'input_too_large'].includes(e.code)); assert.equal(calls, 0);
});
test('serialized success does not authorize replay; reconstruction requires fresh verifier', async () => {
  const { source, binding } = await dailyHistoryFixture(), h = clone(await run(source, binding));
  await assert.rejects(reverify(h), { code: 'verification_not_configured' });
  const next = await reverify(h, verifier, () => '2026-10-22T01:00:00.000000002Z'); assert.deepEqual(next.history, h.history); assert.notEqual(next.verification.verified_at, h.verification.verified_at);
  report(next);
});
for (const [label, mutate] of [
  ['numeric cell', (h: any) => h.history.points[0].values.close.value = '999'],
  ['context scale', (h: any) => h.history.context.units.price_scale = '1000'],
  ['source locator', (h: any) => h.history.points[0].provenance.locator = 'output2[0]:fake'],
  ['source bytes digest', (h: any) => h.lineage.source_artifact_sha256 = '0'.repeat(64)],
  ['DTO digest', (h: any) => h.lineage.source_dto_sha256 = '0'.repeat(64)],
  ['raw lexeme', (h: any) => h.lineage.raw_rows[0].clos = '999'],
  ['runtime pin', (h: any) => h.report_runtime.files['history_semantics.py'] = '0'.repeat(64)],
  ['receipt digest', (h: any) => h.verification.input_sha256 = '0'.repeat(64)],
  ['receipt confirmation', (h: any) => h.verification.confirmed.rights = ['source-page']],
  ['future verification', (h: any) => h.verification.verified_at = '2026-10-22T01:00:00.000000002Z'],
  ['rights window', (h: any) => h.rights.valid_until = '2099-01-01T00:00:00Z'],
  ['warnings', (h: any) => h.warnings = []],
] as const) test(`persisted ${label} tampering rejected by deterministic reconstruction`, async () => {
  const { source, binding } = await dailyHistoryFixture(); const h: any = JSON.parse(JSON.stringify(await run(source, binding))); mutate(h); await assert.rejects(reverify(h, verifier, () => VERIFIED), { code: 'handoff_mismatch' });
});
test('fresh verification cannot bypass expired rights; equality remains inclusive', async () => {
  const { source, binding } = await dailyHistoryFixture(); const h = await run(source, binding);
  await reverify(h, verifier, () => binding.rights.valid_until);
  await assert.rejects(reverify(h, verifier, () => '2026-10-23T00:00:00.000000001Z'), { code: 'rights_outside_window' });
});
test('timezone inventory names work in pinned Python and Node runtime', () => {
  const r = spawnSync('python3', ['-B', '-c', `import json,zoneinfo\nfor name in json.load(open('contracts/report-history-reference/compatible-timezones.json'))['timezones']: zoneinfo.ZoneInfo(name)`], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
});
test('inventory immutable; no module import adds a provider registration or network fallback', () => {
  assert.ok(Object.isFrozen(DAILY_HISTORY_BRIDGE_AXES)); assert.equal(DAILY_HISTORY_BRIDGE_AXES.length, 12);
  const text = readFileSync(ROOT + 'src/daily-history-bridge.ts', 'utf8'); assert.doesNotMatch(text, /\bfetch\s*\(|registerTool\s*\(/);
  assert.doesNotMatch(readFileSync(ROOT + 'src/main.ts', 'utf8'), /daily-history-bridge/);
});
for (const locator of ['https://example.invalid/doc?token=not-a-secret', 'https://example.invalid/doc#fragment', 'https://name:password@example.invalid/doc', 'synthetic://invented/doc?tracking=1']) test(`reject unsafe evidence locator ${locator}`, async () => {
  const { source, binding } = await dailyHistoryFixture(); binding.artifacts[0]!.locator = locator; await assert.rejects(run(source, binding), { code: 'invalid_binding' });
});
for (const key of ['\ud800', '\u202e', 'field\ncontrol']) test(`reject malformed JSON key ${JSON.stringify(key)}`, async () => {
  const { source, binding } = await dailyHistoryFixture(); (binding as any)[key] = 'test'; await assert.rejects(run(source, binding), { code: 'invalid_plain_json' });
});
for (const [label, mutate] of [
  ['digest newline', (b: any) => b.artifacts[0].sha256 += '\n'],
  ['identifier newline', (b: any) => b.source_artifact_id += '\n'],
  ['scale newline', (b: any) => b.context.units.price_scale = '1\n'],
  ['currency newline', (b: any) => b.context.units.currency = 'USD\n'],
  ['year zero', (b: any) => b.context.basis.adjustment_asof = '0000-01-01T00:00:00Z'],
  ['UTC year overflow', (b: any) => b.rights.valid_until = '9999-12-31T23:59:59-01:00'],
] as const) test(`reject report-incompatible ${label}`, async () => {
  const { source, binding } = await dailyHistoryFixture(); mutate(binding); await assert.rejects(run(source, binding), { code: 'invalid_binding' });
});
test('raw numeric newline cannot leak into canonical decimal string', async () => {
  const { source, binding } = await dailyHistoryFixture(); (source.raw.output2 as any[])[0].clos = '101\n'; relinkSource(source, binding); await assert.rejects(run(source, binding), { code: 'invalid_source' });
});
test('offset-equivalent receipts and cutoff remain exact; source metadata not overwritten', async () => {
  const { source, binding } = await dailyHistoryFixture(); binding.artifacts[0]!.snapshot!.received_at = '2026-10-22T09:00:00.123456789+09:00';
  binding.cutoff = '2026-10-22T09:00:00.123456790+09:00';
  const h = await run(source, binding); report(h); assert.equal(h.history.points[0]!.received_at, RECEIVED); assert.equal(h.cutoff, binding.cutoff);
});
test('zero volume stays available while a blank volume stays unavailable', async () => {
  const { source, binding } = await dailyHistoryFixture(); (source.raw.output2 as any[])[0].tvol = '000'; (source.raw.output2 as any[])[1].tvol = ''; relinkSource(source, binding);
  const h = await run(source, binding), r = report(h); assert.equal(r.results.volume.records[0].y_value, null); assert.equal(r.results.volume.records[1].y_value, '0');
});
for (const target of ['cutoff', 'rights', 'publication', 'session_close', 'adjustment', 'snapshot']) test(`known-local-offset project profile excludes -00:00 for ${target}`, async () => {
  const { source, binding } = await dailyHistoryFixture();
  if (target === 'cutoff') binding.cutoff = binding.cutoff.replace('Z', '-00:00');
  if (target === 'rights') binding.rights.valid_until = binding.rights.valid_until.replace('Z', '-00:00');
  if (target === 'publication') binding.points[0]!.published_at = binding.points[0]!.published_at.replace('Z', '-00:00');
  if (target === 'session_close') binding.points[0]!.session_close_at = '2026-10-21T20:00:00-00:00';
  if (target === 'adjustment') binding.context.basis.adjustment_asof = binding.context.basis.adjustment_asof.replace('Z', '-00:00');
  if (target === 'snapshot') binding.artifacts[0]!.snapshot!.received_at = RECEIVED.replace('Z', '-00:00');
  await assert.rejects(run(source, binding), { code: 'invalid_binding' });
});
test('known-local-offset project profile excludes -00:00 for source receipt and fresh clock', async () => {
  const { source, binding } = await dailyHistoryFixture(); await assert.rejects(run(source, binding, verifier, () => VERIFIED.replace('Z', '-00:00')), { code: 'invalid_chronology' });
  // The RC10 shared source schema now rejects this profile before the bridge chronology layer.
  source.received_at = source.available_at = RECEIVED.replace('Z', '-00:00'); relinkSource(source, binding); await assert.rejects(run(source, binding), { code: 'invalid_source' });
});
test('known +00:00 offset remains supported across cutoff, rights, source receipt and fresh clock', async () => {
  const { source, binding } = await dailyHistoryFixture(); source.received_at = source.available_at = RECEIVED.replace('Z', '+00:00'); relinkSource(source, binding);
  binding.cutoff = binding.cutoff.replace('Z', '+00:00'); binding.rights.valid_until = binding.rights.valid_until.replace('Z', '+00:00');
  report(await run(source, binding, verifier, () => VERIFIED.replace('Z', '+00:00')));
});
test('shipped synthetic artifact hashes, raw-byte/DTO linkage and fresh persisted reconstruction are reproducible', async () => {
  const dir = ROOT + 'fixtures/history-bridge/', manifest = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
  for (const [name, hash] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(readFileSync(dir + name)).digest('hex'), hash);
  const source = JSON.parse(readFileSync(dir + 'SYNTHETIC-source.json', 'utf8')), binding = JSON.parse(readFileSync(dir + 'SYNTHETIC-binding.json', 'utf8'));
  assert.equal(binding.artifacts[0].sha256, manifest.files['SYNTHETIC-source-body.json']); assert.equal(binding.artifacts[0].snapshot.dto_sha256, fixtureDigest(source));
  const persisted = JSON.parse(readFileSync(dir + 'SYNTHETIC-handoff.json', 'utf8'));
  await assert.rejects(reverify(persisted), { code: 'verification_not_configured' });
  const fresh = await reverify(persisted, verifier, () => manifest.reverified_at);
  assert.deepEqual(JSON.parse(JSON.stringify(fresh)), JSON.parse(readFileSync(dir + 'SYNTHETIC-reverified-handoff.json', 'utf8')));
  const input = JSON.parse(readFileSync(dir + 'SYNTHETIC-report-input.json', 'utf8'));
  assert.deepEqual(input.histories.subject, JSON.parse(JSON.stringify(fresh.history)));
  assert.deepEqual(report(fresh, input.options), JSON.parse(readFileSync(dir + 'SYNTHETIC-report-result.json', 'utf8')));
});
test('exported schema artifacts validate only structure and explicitly disclaim verification authority', () => {
  const r = spawnSync('python3', ['-B', '-c', `import json\nfrom jsonschema import Draft202012Validator\nfor name,fixture in [('binding','SYNTHETIC-binding.json'),('handoff-envelope','SYNTHETIC-handoff.json')]:\n s=json.load(open('contracts/report-history-reference/'+name+'.schema.json'));assert 'STRUCTURAL PROFILE ONLY' in s['description'];Draft202012Validator(s).validate(json.load(open('fixtures/history-bridge/'+fixture)))`], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
});

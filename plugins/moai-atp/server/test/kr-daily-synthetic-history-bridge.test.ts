import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assembleSyntheticKrDailyHistory as assemble, reverifySyntheticKrDailyHistoryHandoff as reverify, KR_SYNTHETIC_HISTORY_AXES, KR_SYNTHETIC_HISTORY_ERRORS, KR_SYNTHETIC_REPORT_PIN, type KrSyntheticHistoryInput, type SyntheticKrHistoryVerifier } from '../src/kr-daily-synthetic-history-bridge.js';
import { fixture, fixtureVerifier, clone, VERIFIED, RECEIVED, CUTOFF, AVAILABLE, rebody, relink, reportInput, hashText } from './kr-daily-synthetic-history-fixture.js';
const SERVER_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPORT_ROOT = process.env.KR_SYNTHETIC_REPORT_ROOT ?? SERVER_ROOT + 'contracts/report-history-reference';
const SOURCE_ROOT = process.env.KR_SYNTHETIC_SOURCE_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
const BASELINE_ROOT = process.env.KR_SYNTHETIC_BASELINE ?? SERVER_ROOT;
const run = (f = fixture(), v = fixtureVerifier(f), clock = () => VERIFIED) => assemble(f, v, clock);
function report(h: Awaited<ReturnType<typeof run>>) {
  const root = REPORT_ROOT;
  const code = `import sys,json,hashlib\nsys.path.insert(0,sys.argv[1])\nfrom history_semantics import calculate_report\nfrom jsonschema import Draft202012Validator\np=json.load(sys.stdin)\nschema=json.load(open(sys.argv[1]+'/canonical-history.schema.json'))\nDraft202012Validator(schema).validate(p)\nprint(json.dumps(calculate_report(p),ensure_ascii=False))`;
  const r = spawnSync('python3', ['-X', 'utf8', '-B', '-c', code, root], { input: JSON.stringify(reportInput(h)), encoding: 'utf8', maxBuffer: 8_000_000 }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
}
test('synthetic fixture computes pinned report only; exact decimals, raw blockers, gaps and source-row mapping survive', async () => {
  const f = fixture(), h = await run(f), r = report(h);
  assert.equal(h.status, 'synthetic_fixture_demonstration_ready'); assert.equal(h.canonical_actual_bindings, 0); assert.equal(h.actual_origin_supported, false); assert.equal(r.actual_input_rows, 0);
  assert.equal(r.results.ohlcv.status, 'computed'); assert.equal(r.results.sma.status, 'computed'); assert.equal(r.results.volume.status, 'computed');
  assert.equal(h.history.points[0]!.provenance.locator, 'output2[2]:2026-10-16'); assert.equal(h.history.points[1]!.provenance.locator, 'output2[1]:2026-10-19');
  assert.equal(h.history.points[1]!.values.close.value, '101.125'); assert.equal(h.history.points[2]!.values.volume.value, '9007199254740993');
  assert.equal(h.history.points[1]!.observed_at, null); assert.deepEqual(h.lineage.raw_blockers, f.raw_evidence.blockers); assert.equal(h.inputs.raw_evidence.canonical_projection_status, 'blocked');
  assert.equal(h.lineage.raw_adjustment_code_interpretation, 'blocked_portal_sample_conflict'); assert.equal(h.inputs.original_body_text, f.original_body_text);
  assert.equal(r.results.ohlcv.records[1].close_only, null); assert.equal(r.results.ohlcv.records[1].close_only_missing_reason, 'absent_expected_session');
  assert.equal(r.results.sma.records.find((x: any) => x.x_value === '2026-10-19' && x.series_id === 'sma_2').y_value, '100.625');
  assert.equal(r.results.sma.records.find((x: any) => x.x_value === '2026-10-21' && x.series_id === 'sma_2').y_value, null);
  assert.equal(r.results.volume.records[2].y_value, '9007199254740993'); assert.ok(Object.isFrozen(h.inputs.raw_evidence.rows)); assert.ok(Object.isFrozen(h.history.context));
});
test('both request adjustment codes remain opaque, neither unlocks actual origin', async () => {
  for (const code of ['0', '1'] as const) { const f = fixture(); f.raw_input.request.adjustment_code = code; relink(f); const h = await run(f); assert.equal(h.inputs.raw_evidence.adjustment_code_interpretation, 'blocked_portal_sample_conflict'); report(h); }
});
test('actual input fails before any verifier property, callback or clock, regardless of promises or flags', async () => {
  for (const location of ['raw_input', 'raw_evidence', 'both']) {
    const f: any = fixture(); if (location !== 'raw_evidence') f.raw_input.capture.origin = 'actual'; if (location !== 'raw_input') f.raw_evidence.capture.origin = 'actual'; f.binding.resolve_known_conflict = true;
    let calls = 0; const v: any = {}; Object.defineProperty(v, 'adapter_id', { get() { calls++; throw new Error('secret'); } }); Object.defineProperty(v, 'verify', { get() { calls++; return async () => ({}); } });
    await assert.rejects(assemble(f, v, () => { calls++; return VERIFIED; }), { code: 'actual_origin_unsupported' }); assert.equal(calls, 0);
  }
});
test('real-origin reconstruction remains unsupported even with all synthetic evidence relabeled and an external verifier', async () => {
  const f: any = fixture(); f.raw_input.capture.origin = 'actual'; relink(f); for (const a of f.binding.artifacts) a.data_kind = 'actual'; let count = 0;
  await assert.rejects(assemble(f, { adapter_id: 'external', mode: 'external_trusted_verification', async verify() { count++; return {}; } } as any, () => { count++; return VERIFIED; }), { code: 'actual_origin_unsupported' }); assert.equal(count, 0);
});
test('original text must reconstruct raw DTO; body hash is not source authentication', async () => {
  const f = fixture(); f.original_body_text += ' '; await assert.rejects(run(f), { code: 'invalid_source' });
  const g = fixture(); g.raw_evidence.rows[0]!.raw_fields.stck_clpr.value = '999'; await assert.rejects(run(g), { code: 'invalid_source' });
  const x = fixture(); x.original_body_text = x.original_body_text.replace('"rt_cd": "0"', '"rt_cd": "0", "rt_cd": "0"'); x.raw_input.capture.expected_body_sha256 = hashText(x.original_body_text); await assert.rejects(run(x), { code: 'invalid_source' });
});
test('blank and missing cells stay distinct unavailable; zero remains available', async () => {
  const f = fixture(); rebody(f, b => { delete b.output2[0].stck_oprc; b.output2[0].acml_vol = '000'; b.output2[1].acml_vol = ''; }); const h = await run(f); const r = report(h);
  assert.deepEqual(h.history.points[2]!.values.open, { state: 'unavailable', value: null, missing_reason: 'provider_missing' }); assert.deepEqual(h.history.points[1]!.values.open, { state: 'unavailable', value: null, missing_reason: 'provider_blank' }); assert.equal(h.history.points[2]!.values.volume.value, '0'); assert.equal(r.results.volume.records[2].y_value, '0');
});
test('explicit independent scales preserve exact quantity, not binary64 rounding', async () => {
  const f = fixture(); rebody(f, b => { b.output2[0].acml_vol = '900719925474099300'; }); f.binding.context.units.volume_scale = '0.01'; f.binding.context.units.price_scale = '0.01'; const h = await run(f); const r = report(h);
  assert.equal(r.results.volume.records[2].y_value, '9007199254740993'); assert.equal(r.results.ohlcv.records[2].close_only.value, '1.03125');
  rebody(f, b => b.output2[0].acml_vol = '900719925474099301'); await assert.rejects(run(f), { code: 'invalid_volume' });
});
const badBindings: [string, (b: any) => void, string][] = [
  ['missing units', b => delete b.context.units, 'invalid_binding'], ['missing currency', b => delete b.context.units.currency, 'invalid_binding'], ['missing scale', b => delete b.context.units.volume_scale, 'invalid_binding'], ['missing venue', b => delete b.context.identity.venue, 'invalid_binding'], ['missing share class', b => delete b.context.identity.share_class, 'invalid_binding'],
  ['ETF', b => b.context.identity.asset_class = 'etf', 'invalid_binding'], ['index', b => b.context.identity.asset_class = 'index', 'invalid_binding'], ['futures', b => b.context.identity.asset_class = 'futures', 'invalid_binding'], ['intraday', b => b.context.session.interval = 'minute', 'invalid_binding'], ['split adjustment', b => b.context.basis.adjustment = 'split_adjusted', 'invalid_binding'], ['volume adjustment', b => b.context.basis.volume_adjustment = 'split_adjusted', 'invalid_binding'], ['adjusted return', b => b.context.basis.return_policy = 'total_return', 'invalid_binding'], ['partial bar', b => b.points[0].finality = 'partial', 'invalid_binding'], ['observation inference', b => b.points[0].observed_at = RECEIVED, 'invalid_binding'], ['board NX', b => b.provider_identity.board = 'NX', 'invalid_binding'],
  ['symbol mismatch', b => b.provider_identity.symbol = '111111', 'identity_mismatch'], ['missing source digest', b => delete b.source_link.raw_dto_sha256, 'invalid_binding'], ['wrong source DTO', b => b.source_link.raw_dto_sha256 = '0'.repeat(64), 'source_link_mismatch'], ['wrong body digest', b => b.source_link.original_body_sha256 = '0'.repeat(64), 'source_link_mismatch'], ['wrong input digest', b => b.source_link.raw_input_sha256 = '0'.repeat(64), 'source_link_mismatch'],
  ['warm-up calendar omitted', b => b.context.session.expected_sessions.shift(), 'calendar_mismatch'], ['calendar duplicate', b => b.context.session.expected_sessions.push('2026-10-21'), 'calendar_mismatch'], ['unordered calendar', b => b.context.session.expected_sessions.reverse(), 'calendar_mismatch'], ['requested range outside calendar', b => b.request.start_date = '2026-10-15', 'calendar_mismatch'], ['reversed requested range', b => b.request.end_date = '2026-10-18', 'calendar_mismatch'], ['calendar beyond capture query', b => b.context.session.coverage_end = '2026-10-23', 'calendar_mismatch'], ['incomplete calendar', b => b.context.session.coverage_complete = false, 'invalid_binding'],
  ['swapped row mapping', b => b.points.reverse(), 'row_mapping_mismatch'], ['duplicate row index', b => b.points[1].source_row_index = 0, 'row_mapping_mismatch'], ['mismatched date', b => b.points[0].trade_date = '2026-10-20', 'row_mapping_mismatch'], ['missing row mapping', b => b.points.pop(), 'row_mapping_mismatch'],
  ['availability before receipt by 1e-21', b => b.points[0].available_at = '2026-10-21T08:00:00.123456789012345678900Z', 'invalid_chronology'], ['publication after receipt by 1e-21', b => b.points[0].published_at = AVAILABLE, 'invalid_chronology'], ['publication before close', b => b.points[0].published_at = '2026-10-21T15:29:59+09:00', 'invalid_chronology'], ['close local date mismatch', b => b.points[0].session_close_at = '2026-10-20T15:30:00+09:00', 'invalid_chronology'], ['availability after cutoff by 1e-21', b => b.points[0].available_at = '2026-10-22T00:00:00.123456789012345678904Z', 'invalid_chronology'], ['adjustment after cutoff', b => b.context.basis.adjustment_asof = VERIFIED, 'invalid_chronology'], ['unknown timezone', b => b.context.session.timezone = 'UTC', 'invalid_binding'], ['unknown offset', b => b.points[0].published_at = '2026-10-21T06:31:00-00:00', 'invalid_binding'],
  ['actions merely requested dates', b => b.no_actions.coverage_start = '2026-10-19', 'actions_policy_mismatch'], ['actions stop before capture', b => b.no_actions.coverage_end = '2026-10-20', 'actions_policy_mismatch'], ['actions effective start excludes warm-up', b => b.no_actions.effective_from = '2026-10-19T00:00:00+09:00', 'actions_policy_mismatch'], ['actions stop before vintage', b => b.no_actions.effective_through = RECEIVED, 'actions_policy_mismatch'], ['stale action knowledge', b => b.no_actions.knowledge_asof = RECEIVED, 'actions_policy_mismatch'], ['unknown action coverage', b => b.no_actions.coverage_complete = false, 'invalid_binding'], ['event present', b => b.no_actions.events.push({ type: 'split', ratio: '2' }), 'invalid_binding'], ['price basis change', b => b.no_actions.price_basis_changes = true, 'invalid_binding'], ['share basis change', b => b.no_actions.share_basis_changes = true, 'invalid_binding'], ['quantity unit change', b => b.no_actions.quantity_unit_changes = true, 'invalid_binding'], ['no independent absence policy', b => delete b.no_actions, 'invalid_binding'], ['asserted action coverage alone', b => { delete b.no_actions; b.context.basis.actions_coverage_verified = true; }, 'invalid_binding'],
  ['reused axis', b => b.evidence.units = b.evidence.currency, 'evidence_mismatch'], ['wrong artifact hash', b => b.artifacts[0].sha256 = '0'.repeat(64), 'evidence_mismatch'], ['wrong artifact axis', b => b.artifacts[0].axis = 'rights', 'evidence_mismatch'], ['missing rights axis', b => delete b.evidence.rights, 'invalid_binding'], ['wrong calendar evidence', b => b.context.session.calendar_evidence_ref = b.evidence.units, 'evidence_mismatch'], ['wrong action evidence', b => b.no_actions.evidence_ref = b.evidence.units, 'evidence_mismatch'], ['wrong revision evidence', b => b.points[0].revision.evidence_ref = b.evidence.units, 'evidence_mismatch'], ['expired rights', b => b.rights.valid_until = RECEIVED, 'rights_outside_window'], ['future rights', b => b.rights.valid_from = VERIFIED, 'rights_outside_window'], ['unsafe artifact URL', b => b.artifacts[0].locator = 'https://example.com/?token=private', 'invalid_binding'], ['caller bypass flag', b => b.adjustment_conflict_resolved = true, 'invalid_binding'], ['currency newline', b => b.context.units.currency = 'KRW\n', 'invalid_binding'], ['scale newline', b => b.context.units.price_scale = '1\n', 'invalid_binding'], ['year zero', b => b.context.basis.adjustment_asof = '0000-01-01T00:00:00Z', 'invalid_binding'], ['UTC overflow', b => b.rights.valid_until = '9999-12-31T23:59:59-01:00', 'invalid_binding'],
];
for (const [name, mutate, code] of badBindings) test('reject ' + name + ' before verifier/clock', async () => {
  const f = fixture(); mutate(f.binding); let calls = 0; const v: SyntheticKrHistoryVerifier = { adapter_id: 'never', mode: 'synthetic_fixture_only', async verify() { calls++; return {}; } };
  await assert.rejects(assemble(f, v, () => { calls++; return VERIFIED; }), { code }); assert.equal(calls, 0);
});
for (const [field, value, code] of [['stck_clpr', '-1', 'invalid_numeric'], ['acml_vol', '-1', 'invalid_numeric'], ['acml_vol', '1.5', 'invalid_volume'], ['stck_hgpr', '100', 'invalid_ohlc_range'], ['stck_lwpr', '104', 'invalid_ohlc_range']] as const) test(`reject exact numeric ${field}=${value}`, async () => { const f = fixture(); rebody(f, b => b.output2[0][field] = value); await assert.rejects(run(f), { code }); });
for (const hostile of ['getter', 'proxy', 'revoked_proxy', 'cycle', 'toJSON', 'sparse', 'symbol', 'nonfinite', 'negative_zero', 'surrogate', 'bidi', 'huge', 'class', 'hidden', 'array_extra', 'deep']) test('hostile plain JSON ' + hostile + ' has no hooks', async () => {
  let f: any = fixture(), calls = 0; const b = f.binding;
  if (hostile === 'getter') Object.defineProperty(b, 'trap', { enumerable: true, get() { calls++; return 1; } });
  if (hostile === 'proxy') f = new Proxy(f, { ownKeys() { calls++; return []; } });
  if (hostile === 'revoked_proxy') { const p = Proxy.revocable(f, {}); p.revoke(); f = p.proxy; }
  if (hostile === 'cycle') b.extra = b;
  if (hostile === 'toJSON') b.toJSON = () => { calls++; return {}; };
  if (hostile === 'sparse') b.extra = new Array(2);
  if (hostile === 'symbol') b[Symbol('secret')] = true;
  if (hostile === 'nonfinite') b.extra = NaN;
  if (hostile === 'negative_zero') b.extra = -0;
  if (hostile === 'surrogate') b.extra = '\ud800';
  if (hostile === 'bidi') b.extra = '\u202e';
  if (hostile === 'huge') b.extra = 'x'.repeat(524289);
  if (hostile === 'class') b.extra = new Date();
  if (hostile === 'hidden') Object.defineProperty(b, 'secret', { value: true });
  if (hostile === 'array_extra') b.points.extra = true;
  if (hostile === 'deep') { b.extra = {}; let t = b.extra; for (let i = 0; i < 26; i++) t = t.next = {}; }
  await assert.rejects(assemble(f), (e: any) => ['invalid_plain_json', 'input_too_large'].includes(e.code)); assert.equal(calls, 0);
});
test('absence start uses actual supplied timezone civil midnight, never a hardcoded +09 offset', async () => {
  const f = fixture(); f.binding.no_actions.coverage_start = '1987-07-13'; f.binding.no_actions.effective_from = '1987-07-13T00:00:00+09:00';
  await assert.rejects(run(f), { code: 'actions_policy_mismatch' });
  f.binding.no_actions.effective_from = '1987-07-13T00:00:00+10:00';
  const artifact = f.binding.artifacts.find(a => a.axis === 'no_actions')!; artifact.content = 'Fictional complete absence of adjustment-relevant actions and price/share/quantity-unit changes from 1987-07-13 Asia/Seoul local midnight through exact cutoff; all supplied warm-up/calendar dates and capture/adjustment vintage are covered.'; artifact.sha256 = hashText(artifact.content);
  report(await run(f));
  f.binding.no_actions.effective_from = '1987-07-13T00:00:00.000000000000000000001+10:00'; await assert.rejects(run(f), { code: 'actions_policy_mismatch' });
});
test('absence evidence contains adjustment vintage on both sides, with exact start equality', async () => {
  const f = fixture(); f.binding.context.basis.adjustment_asof = f.binding.no_actions.effective_from; report(await run(f));
  f.binding.context.basis.adjustment_asof = '2026-10-15T14:59:59.999999999999999999999Z'; await assert.rejects(run(f), { code: 'actions_policy_mismatch' });
  f.binding.context.basis.adjustment_asof = '2020-01-01T00:00:00Z'; await assert.rejects(run(f), { code: 'actions_policy_mismatch' });
});
test('valid three-digit Intl year is padded back to the declared four-digit date profile', async () => {
  const f = fixture(); f.binding.no_actions.coverage_start = '0100-01-02'; f.binding.no_actions.effective_from = '0100-01-01T00:00:00Z';
  const artifact = f.binding.artifacts.find(a => a.axis === 'no_actions')!; artifact.content = 'Fictional complete absence of adjustment-relevant actions and price/share/quantity-unit changes from 0100-01-01T00:00:00Z through exact cutoff, covering the declared 0100-01-02 start and all supplied dates. Synthetic boundary test only.'; artifact.sha256 = hashText(artifact.content);
  report(await run(f));
});
test('verifier is mandatory, cannot be production, cannot be a getter/proxy, and clock is injected', async () => {
  const f = fixture(); await assert.rejects(assemble(f), { code: 'verifier_required' }); await assert.rejects(assemble(f, fixtureVerifier(f)), { code: 'invalid_chronology' });
  let calls = 0; for (const v of [{ adapter_id: 'external', mode: 'external_trusted_verification', verify: async () => ({}) }, Object.defineProperty({}, 'adapter_id', { get() { calls++; return 'secret'; } }), new Proxy({}, { get() { calls++; return 'secret'; } })]) await assert.rejects(assemble(f, v as any), { code: 'verifier_required' }); assert.equal(calls, 0);
});
test('fixture verifier uses independently pinned input digest, not caller success booleans', async () => { const f = fixture(), v = fixtureVerifier(f); f.binding.history_id = 'different'; await assert.rejects(assemble(f, v, () => VERIFIED), { code: 'verification_failed' }); });
for (const axis of KR_SYNTHETIC_HISTORY_AXES) test('fresh verifier exact confirmation ' + axis, async () => { const f = fixture(), v = fixtureVerifier(f); await assert.rejects(run(f, { ...v, async verify(c) { const d: any = await v.verify(c); d.confirmed[axis] = 'other'; return d; } }), { code: 'verification_mismatch' }); });
test('decision tampering, replay and secret errors are finite/sanitized', async () => {
  for (const bad of [{ adapter_id: 'other' }, { input_sha256: '0'.repeat(64) }, { data_kind: 'actual' }, { extra: 'private' }]) { const f = fixture(), v = fixtureVerifier(f); await assert.rejects(run(f, { ...v, async verify(c) { return { ...(await v.verify(c) as object), ...bad }; } }), { code: 'verification_mismatch' }); }
  const f = fixture(), v = fixtureVerifier(f); await assert.rejects(run(f, { ...v, async verify() { throw new Error('private token'); } }), { code: 'verification_failed', message: 'verification_failed' });
  await assert.rejects(run(f, v, () => { throw new Error('private clock'); }), { code: 'invalid_chronology', message: 'invalid_chronology' });
});
test('verifier cannot mutate snapshotted evidence and caller mutation during await cannot alter output', async () => {
  const f = fixture(), v = fixtureVerifier(f); let unblock!: () => void; const waiting = new Promise<void>(r => unblock = r);
  const pending = run(f, { ...v, async verify(c) { assert.ok(Object.isFrozen(c.input.binding.evidence)); assert.throws(() => { c.input.binding.evidence.units = 'changed'; }); await waiting; return v.verify(c); } });
  f.raw_input.capture.received_at = CUTOFF; f.binding.context.units.price_scale = '1000'; unblock(); const h = await pending; assert.equal(h.history.points[0]!.received_at, RECEIVED); assert.equal(h.history.context.units.price_scale, '1');
});
test('clock is read after verifier and current rights are checked exactly', async () => {
  const f = fixture(), v = fixtureVerifier(f), order: string[] = []; f.binding.rights.valid_until = VERIFIED; const allowed = fixtureVerifier(f);
  const wrapping = { ...allowed, async verify(c: any) { order.push('verify'); const d = await allowed.verify(c); order.push('returned'); return d; } };
  await assert.rejects(run(f, wrapping, () => { order.push('clock'); return '2026-10-22T01:00:00.123456789012345678905Z'; }), { code: 'rights_outside_window' }); assert.deepEqual(order, ['verify', 'returned', 'clock']);
  await run(f, allowed, () => VERIFIED);
});
test('exact equivalent offsets and fractional cutoff equality survive unchanged Python report', async () => {
  const f = fixture(); f.binding.points[0]!.available_at = CUTOFF; f.binding.points[1]!.available_at = '2026-10-21T17:00:00.123456789012345678901+09:00'; const h = await run(f); report(h); assert.equal(h.history.points[1]!.available_at, f.binding.points[1]!.available_at);
});
test('persisted handoff needs complete reconstruction plus fresh fixture verifier/current rights', async () => {
  const f = fixture(), h = clone(await run(f)); await assert.rejects(reverify(h), { code: 'verifier_required' });
  const fresh = await reverify(h, fixtureVerifier(f), () => '2026-10-22T02:00:00Z'); assert.deepEqual(fresh.history, h.history); report(fresh);
  await assert.rejects(reverify(h, fixtureVerifier(f), () => '2026-10-23T00:00:00.000000000000000000001Z'), { code: 'rights_outside_window' });
});
for (const [label, mutate] of [
  ['cell', (h: any) => h.history.points[0].values.close.value = '999'], ['context', (h: any) => h.history.context.units.price_scale = '1000'], ['locator', (h: any) => h.history.points[0].provenance.locator = 'fake'], ['lineage', (h: any) => h.lineage.raw_dto_sha256 = '0'.repeat(64)], ['blockers', (h: any) => h.lineage.raw_blockers = []], ['runtime', (h: any) => h.report_runtime.files['history_semantics.py'] = '0'.repeat(64)], ['warnings', (h: any) => h.warnings = []], ['adapter receipt', (h: any) => h.verification.adapter_id = 'other'], ['verification hash', (h: any) => h.verification.input_sha256 = '0'.repeat(64)], ['confirmation', (h: any) => h.verification.confirmed.rights = 'other'], ['future verification', (h: any) => h.verification.verified_at = '2026-10-22T03:00:00Z'], ['original body', (h: any) => h.inputs.original_body_text += ' '], ['serialized bypass flag', (h: any) => h.inputs.binding.conflict_resolved = true],
] as const) test('reject persisted tamper ' + label, async () => { const f = fixture(), h: any = clone(await run(f)); mutate(h); await assert.rejects(reverify(h, fixtureVerifier(f), () => VERIFIED), (e: any) => ['handoff_mismatch', 'invalid_source', 'invalid_handoff'].includes(e.code)); });
test('actual persisted handoff rejects before verifier and clock', async () => { const h: any = clone(await run()); h.history.data_kind = 'actual'; let calls = 0; await assert.rejects(reverify(h, { adapter_id: 'x', mode: 'synthetic_fixture_only', async verify() { calls++; return {}; } }, () => { calls++; return VERIFIED; }), { code: 'actual_origin_unsupported' }); assert.equal(calls, 0); });
test('frozen dependencies and scope pins match; no network or MCP route is introduced', () => {
  const root = REPORT_ROOT, source = SOURCE_ROOT, baseline = BASELINE_ROOT;
  for (const [name, hash] of Object.entries(KR_SYNTHETIC_REPORT_PIN.files)) assert.equal(hashText(readFileSync(root + '/' + name, 'utf8')), hash);
  assert.equal(hashText(readFileSync(baseline + '/src/kr-daily-raw-evidence.ts', 'utf8')), '430a928545290d6f8f171d649546d09c474a60c1d71c6f95f5809b71b4def065');
  assert.doesNotMatch(readFileSync(source + '/server/src/kr-daily-synthetic-history-bridge.ts', 'utf8'), /\bfetch\s*\(|registerTool\s*\(/);
  assert.doesNotMatch(readFileSync(baseline + '/src/main.ts', 'utf8'), /kr-daily-synthetic-history-bridge/); assert.ok(Object.isFrozen(KR_SYNTHETIC_HISTORY_ERRORS)); assert.ok(Object.isFrozen(KR_SYNTHETIC_HISTORY_AXES));
});

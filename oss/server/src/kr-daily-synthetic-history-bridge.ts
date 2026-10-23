import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { z } from 'zod';
import { ExactInstantSchema, compareInstants } from './exact-instant.js';
import { KrDailyEvidenceInputSchema, KrDailyEvidenceResultSchema, verifyKrDailyRawEvidence } from './kr-daily-raw-evidence.js';

/** SYNTHETIC FIXTURE DEMONSTRATION ONLY. No actual-origin path, network, MCP route or production verifier. */
export const KR_SYNTHETIC_HISTORY_AXES = Object.freeze(['fixture_lineage', 'identity', 'field_semantics', 'units', 'currency', 'scales', 'session_calendar', 'unadjusted_basis', 'no_actions', 'finality_revision', 'publication_availability', 'rights'] as const);
export const KR_SYNTHETIC_HISTORY_LIMITS = Object.freeze({ bytes: 4_000_000, nodes: 100_000, depth: 24, entries: 1024, string: 524_288, rows: 100 });
export const KR_SYNTHETIC_HISTORY_ERRORS = Object.freeze(['invalid_plain_json', 'input_too_large', 'invalid_source', 'invalid_binding', 'actual_origin_unsupported', 'unsupported_scope', 'source_link_mismatch', 'identity_mismatch', 'calendar_mismatch', 'row_mapping_mismatch', 'invalid_chronology', 'invalid_numeric', 'invalid_volume', 'invalid_ohlc_range', 'actions_policy_mismatch', 'evidence_mismatch', 'verifier_required', 'verification_failed', 'verification_mismatch', 'rights_outside_window', 'invalid_handoff', 'handoff_mismatch', 'invalid_input'] as const);
export type KrSyntheticHistoryErrorCode = typeof KR_SYNTHETIC_HISTORY_ERRORS[number];
export class KrSyntheticHistoryError extends Error { constructor(readonly code: KrSyntheticHistoryErrorCode) { super(code); this.name = 'KrSyntheticHistoryError'; } }
function fail(code: KrSyntheticHistoryErrorCode): never { throw new KrSyntheticHistoryError(code); }
function must(value: unknown, code: KrSyntheticHistoryErrorCode): asserts value { if (!value) fail(code); }
const Id = z.string().min(1).max(120).regex(/^[A-Za-z0-9_.:-]+(?![\s\S])/);
const Text = z.string().min(1).max(512).refine(s => s.trim() === s && !/[\x00-\x1f\x7f-\x9f]/.test(s));
const Sha = z.string().length(64).regex(/^[a-f0-9]{64}(?![\s\S])/);
const Day = z.string().length(10).regex(/^\d{4}-\d{2}-\d{2}(?![\s\S])/).refine(s => { const d = new Date(s + 'T00:00:00Z'); return Number(s.slice(0, 4)) >= 100 && Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === s; });
const Instant = ExactInstantSchema.refine(s => { const d = new Date(s.replace(/\.\d+(Z|[+-]\d{2}:\d{2})$/, '$1')); return Number(s.slice(0, 4)) >= 100 && d.getUTCFullYear() >= 100 && d.getUTCFullYear() <= 9999; });
const Scale = z.string().max(14).regex(/^(?:10{0,12}|0\.0{0,11}1)(?![\s\S])/);
const Evidence = z.object({ fixture_lineage: Id, identity: Id, field_semantics: Id, units: Id, currency: Id, scales: Id, session_calendar: Id, unadjusted_basis: Id, no_actions: Id, finality_revision: Id, publication_availability: Id, rights: Id }).strict();
const Context = z.object({
  identity: z.object({ instrument_id: Text, issuer_id: Text, venue: Text, asset_class: z.literal('equity'), share_class: Text, contract_id: z.literal('not_applicable') }).strict(),
  units: z.object({ price_unit: z.literal('money_per_share'), currency: z.literal('KRW'), price_scale: Scale, volume_unit: z.literal('shares'), volume_scale: Scale }).strict(),
  session: z.object({ calendar_id: Text, timezone: z.literal('Asia/Seoul'), session_id: Text, interval: z.literal('daily'), date_basis: z.literal('trade_date'), calendar_verified: z.literal(true), calendar_evidence_ref: Id, coverage_start: Day, coverage_end: Day, coverage_complete: z.literal(true), expected_sessions: z.array(Day).min(1).max(100) }).strict(),
  basis: z.object({ price_kind: z.literal('price_level'), return_policy: z.literal('price_return'), adjustment: z.literal('unadjusted'), adjustment_id: Text, adjustment_asof: Instant, actions_coverage_verified: z.literal(true), actions_evidence_ref: Id, volume_adjustment: z.literal('unadjusted'), revision_policy: z.literal('final_current_at_cutoff'), price_definition: z.literal('official_close'), allow_negative_prices: z.literal(false), roll_policy: z.literal('not_applicable') }).strict(),
}).strict();
const Artifact = z.object({ id: Id, axis: z.enum(KR_SYNTHETIC_HISTORY_AXES), data_kind: z.literal('synthetic'), digest_kind: z.literal('synthetic_fixture_definition_utf8'), content: Text, sha256: Sha, locator: z.string().max(160).regex(/^synthetic:\/\/kr-history-fixture\/[A-Za-z0-9_.-]+(?![\s\S])/) }).strict();
export const KrSyntheticHistoryBindingSchema = z.object({
  contract: z.literal('moai.kr-daily.synthetic-only-history-binding.v1'), scope: z.literal('synthetic_fixture_demonstration_only'), history_id: Text, document_id: Text,
  cutoff: Instant, request: z.object({ start_date: Day, end_date: Day }).strict(),
  provider_identity: z.object({ symbol: z.string().length(6).regex(/^\d{6}(?![\s\S])/), board: z.literal('J') }).strict(),
  source_link: z.object({ original_body_sha256: Sha, raw_dto_sha256: Sha, raw_input_sha256: Sha }).strict(),
  selector: z.object({ id: z.literal('kis.kr-daily.synthetic.named-ohlcv/1'), date: z.literal('stck_bsop_date'), open: z.literal('stck_oprc'), high: z.literal('stck_hgpr'), low: z.literal('stck_lwpr'), close: z.literal('stck_clpr'), volume: z.literal('acml_vol') }).strict(),
  adjustment_code_policy: z.literal('opaque_uninterpreted_portal_sample_conflict_remains'),
  context: Context,
  no_actions: z.object({ policy: z.literal('no_adjustment_relevant_actions'), coverage_complete: z.literal(true), coverage_start: Day, coverage_end: Day, effective_from: Instant, effective_through: Instant, knowledge_asof: Instant, events: z.array(z.never()).max(0), price_basis_changes: z.literal(false), share_basis_changes: z.literal(false), quantity_unit_changes: z.literal(false), evidence_ref: Id }).strict(),
  rights: z.object({ use: z.literal('local_report'), scope: z.literal('synthetic_fixture_only'), evidence_ref: Id, valid_from: Instant, valid_until: Instant }).strict(),
  evidence: Evidence, artifacts: z.array(Artifact).length(KR_SYNTHETIC_HISTORY_AXES.length),
  points: z.array(z.object({ source_row_index: z.number().int().min(0).max(99), trade_date: Day, session_close_at: Instant, published_at: Instant, available_at: Instant, finality: z.literal('final'), revision: z.object({ status: z.literal('original'), revision_id: Text, evidence_ref: Id }).strict() }).strict()).min(1).max(100),
}).strict();
export type KrSyntheticHistoryBinding = z.infer<typeof KrSyntheticHistoryBindingSchema>;
export const KrSyntheticHistoryInputSchema = z.object({ raw_input: KrDailyEvidenceInputSchema, raw_evidence: KrDailyEvidenceResultSchema, original_body_text: z.string().min(1).max(262144), binding: KrSyntheticHistoryBindingSchema }).strict();
export type KrSyntheticHistoryInput = z.infer<typeof KrSyntheticHistoryInputSchema>;
export interface KrSyntheticVerificationContext { readonly contract: 'moai.kr-daily.synthetic-only-verification-request.v1'; readonly input_sha256: string; readonly input: KrSyntheticHistoryInput; }
/** This injected callback only checks invented fixtures. It CANNOT unlock actual origin or resolve actual adjustment semantics. */
export interface SyntheticKrHistoryVerifier { readonly adapter_id: string; readonly mode: 'synthetic_fixture_only'; verify(context: Readonly<KrSyntheticVerificationContext>): Promise<unknown>; }
const Decision = z.object({ contract: z.literal('moai.kr-daily.synthetic-only-verifier-decision.v1'), adapter_id: Id, input_sha256: Sha, data_kind: z.literal('synthetic'), confirmed: Evidence }).strict();
export const KR_SYNTHETIC_REPORT_PIN = Object.freeze({ contract: 'canonical-history/1.0', runtime_version: 'canonical-history-semantics/rc5.1', files: Object.freeze({ 'canonical-history.schema.json': 'ac755724fc93442a50f38f3da4ff1749cafdb84221cc6b36efa448b562f55b4f', 'history_semantics.py': '55b7c1a0ab05b643d27bb27e072f00846b92d7f8bf749c479dcfedc8479318de', 'numeric_core.py': '02e3c646714eec8dca3ceffc9c9b9746f6d0670634a31b81fdb937f9f3656f37' }) });
function freeze<T>(v: T): T { if (v && typeof v === 'object') { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } return v; }
function stable(v: any): string { if (v === null || typeof v !== 'object') return JSON.stringify(v); return Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'; }
const shaText = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const digest = (v: unknown) => shaText(stable(v));
/** Snapshot ONLY own data descriptors; never invoke proxy, getter, toJSON or class hooks. */
function snapshot(value: unknown): unknown {
  const lim = KR_SYNTHETIC_HISTORY_LIMITS; let nodes = 0, bytes = 0; const seen = new Set<object>();
  function add(n: number) { bytes += n; must(bytes <= lim.bytes, 'input_too_large'); }
  function str(s: string, key = false) { must(s.length <= (key ? 128 : lim.string), 'input_too_large'); must(Buffer.from(s, 'utf8').toString('utf8') === s && !/[\u202a-\u202e\u2066-\u2069]/.test(s) && (!key || !/[\x00-\x1f\x7f]/.test(s)), 'invalid_plain_json'); add(Buffer.byteLength(JSON.stringify(s))); }
  function copy(v: unknown, depth: number): unknown {
    must(++nodes <= lim.nodes && depth <= lim.depth, 'input_too_large'); add(8);
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') { str(v); return v; }
    if (typeof v === 'number') { must(Number.isFinite(v) && !Object.is(v, -0), 'invalid_plain_json'); return v; }
    must(typeof v === 'object' && !types.isProxy(v) && !seen.has(v), 'invalid_plain_json');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v); must(array ? proto === Array.prototype || proto === null : proto === Object.prototype || proto === null, 'invalid_plain_json');
    const len = array ? Object.getOwnPropertyDescriptor(v, 'length')?.value : 0;
    must(!array || Number.isSafeInteger(len) && len >= 0 && len <= lim.entries, 'input_too_large');
    const keys = Reflect.ownKeys(v); must(keys.length <= lim.entries + 1, 'input_too_large'); must(!array || keys.length === len + 1, 'invalid_plain_json');
    const out: any = array ? [] : Object.create(null); seen.add(v);
    for (const key of keys) { must(typeof key === 'string', 'invalid_plain_json'); if (array && key === 'length') continue; str(key, true); const d = Object.getOwnPropertyDescriptor(v, key); must(d && 'value' in d && d.enumerable, 'invalid_plain_json'); must(!array || /^(0|[1-9]\d*)$/.test(key) && Number(key) < len, 'invalid_plain_json'); Object.defineProperty(out, key, { value: copy(d.value, depth + 1), enumerable: true, writable: true, configurable: true }); }
    seen.delete(v); return out;
  }
  return copy(value, 0);
}
function localDay(s: string): string {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?(Z|[+-]\d\d:\d\d)$/.exec(s); must(m, 'invalid_chronology');
  // Fractions never enter Date. Only local civil-date conversion uses Intl; all ordering uses exact comparator.
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(m[1]! + m[2]!));
  const get = (k: string) => p.find(x => x.type === k)?.value; const day = `${get('year')?.padStart(4, '0')}-${get('month')}-${get('day')}`; must(Day.safeParse(day).success, 'invalid_chronology'); return day;
}
function notAfterLocalDayStart(instant: string, day: string): boolean {
  const local = localDay(instant); if (local < day) return true; if (local > day) return false;
  const whole = instant.replace(/\.\d+(Z|[+-]\d{2}:\d{2})$/, '$1');
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(whole));
  return ['hour', 'minute', 'second'].every(k => parts.find(p => p.type === k)?.value === '00') && compareInstants(instant, whole) === 0;
}
function fraction(s: string): [bigint, bigint] { must(/^\d+(?:\.\d+)?(?![\s\S])/.test(s) && s.length <= 256, 'invalid_numeric'); const [whole, frac = ''] = s.split('.'); return [BigInt(whole! + frac), 10n ** BigInt(frac.length)]; }
function cmp(a: [bigint, bigint], b: [bigint, bigint]) { const d = a[0] * b[1] - b[0] * a[1]; return d < 0n ? -1 : d > 0n ? 1 : 0; }
function numericChecks(source: KrSyntheticHistoryInput['raw_evidence'], b: KrSyntheticHistoryBinding) {
  for (const row of source.rows) {
    const f = row.raw_fields; const values = new Map<string, [bigint, bigint]>();
    for (const [name, key] of [['open', 'stck_oprc'], ['high', 'stck_hgpr'], ['low', 'stck_lwpr'], ['close', 'stck_clpr'], ['volume', 'acml_vol']] as const) {
      const v = f[key]; if (v.state !== 'present') continue; const n = fraction(v.value!); values.set(name, n);
      if (name === 'volume') { const scale = fraction(b.context.units.volume_scale); must((n[0] * scale[0]) % (n[1] * scale[1]) === 0n, 'invalid_volume'); }
    }
    const low = values.get('low'), high = values.get('high'); if (low && high) must(cmp(low, high) <= 0, 'invalid_ohlc_range');
    for (const k of ['open', 'close']) { const v = values.get(k); if (v && low) must(cmp(low, v) <= 0, 'invalid_ohlc_range'); if (v && high) must(cmp(v, high) <= 0, 'invalid_ohlc_range'); }
  }
}
function checks(input: KrSyntheticHistoryInput) {
  const { raw_input: q, raw_evidence: r, binding: b } = input;
  must(q.capture.origin === 'synthetic' && r.capture.origin === 'synthetic', 'actual_origin_unsupported');
  must(q.request.board === 'J' && r.request.board === 'J' && r.row_count > 0, 'unsupported_scope');
  must(q.request.symbol === b.provider_identity.symbol && q.request.board === b.provider_identity.board, 'identity_mismatch');
  must(b.source_link.original_body_sha256 === r.capture.body_sha256 && b.source_link.raw_dto_sha256 === digest(r) && b.source_link.raw_input_sha256 === digest(q), 'source_link_mismatch');
  must(compareInstants(q.cutoff, b.cutoff) === 0, 'invalid_chronology');
  const s = b.context.session, a = b.no_actions;
  must(s.coverage_start <= b.request.start_date && b.request.start_date <= b.request.end_date && b.request.end_date <= s.coverage_end && q.request.start_date <= s.coverage_start && s.coverage_end <= q.request.end_date, 'calendar_mismatch');
  must(s.expected_sessions.every((d, i) => (!i || s.expected_sessions[i - 1]! < d) && s.coverage_start <= d && d <= s.coverage_end), 'calendar_mismatch');
  must(b.points.length === r.rows.length && b.points.every((p, i) => p.source_row_index === i && r.rows[i]!.source_row_index === i && p.trade_date === r.rows[i]!.provider_business_date), 'row_mapping_mismatch');
  must(compareInstants(b.context.basis.adjustment_asof, b.cutoff) <= 0, 'invalid_chronology');
  for (const p of b.points) {
    must(s.expected_sessions.includes(p.trade_date), 'calendar_mismatch');
    must(localDay(p.session_close_at) === p.trade_date, 'invalid_chronology');
    must(compareInstants(p.session_close_at, p.published_at) <= 0 && compareInstants(p.published_at, r.capture.received_at) <= 0 && compareInstants(r.capture.received_at, p.available_at) <= 0 && compareInstants(p.available_at, b.cutoff) <= 0, 'invalid_chronology');
  }
  // The pinned report cannot compute split boundaries. Require separate absence evidence over the entire warm-up/calendar and through cutoff (therefore capture and adjustment vintage).
  must(a.coverage_start <= s.coverage_start && a.coverage_start <= localDay(b.context.basis.adjustment_asof) && a.coverage_start <= localDay(r.capture.received_at) && compareInstants(a.effective_from, b.context.basis.adjustment_asof) <= 0 && compareInstants(a.effective_from, r.capture.received_at) <= 0 && a.coverage_end >= s.coverage_end && a.coverage_end >= localDay(r.capture.received_at) && a.coverage_end >= localDay(b.context.basis.adjustment_asof) && a.coverage_end <= localDay(b.cutoff) && notAfterLocalDayStart(a.effective_from, a.coverage_start) && compareInstants(a.effective_through, b.cutoff) === 0 && compareInstants(a.knowledge_asof, b.cutoff) === 0, 'actions_policy_mismatch');
  const artifacts = new Map(b.artifacts.map(x => [x.id, x])); must(artifacts.size === KR_SYNTHETIC_HISTORY_AXES.length && new Set(Object.values(b.evidence)).size === KR_SYNTHETIC_HISTORY_AXES.length, 'evidence_mismatch');
  for (const axis of KR_SYNTHETIC_HISTORY_AXES) { const artifact = artifacts.get(b.evidence[axis]); must(artifact && artifact.axis === axis && artifact.sha256 === shaText(artifact.content), 'evidence_mismatch'); }
  must(s.calendar_evidence_ref === b.evidence.session_calendar && b.context.basis.actions_evidence_ref === b.evidence.no_actions && a.evidence_ref === b.evidence.no_actions && b.rights.evidence_ref === b.evidence.rights && b.points.every(p => p.revision.evidence_ref === b.evidence.finality_revision), 'evidence_mismatch');
  must(compareInstants(b.rights.valid_from, b.cutoff) <= 0 && compareInstants(b.cutoff, b.rights.valid_until) <= 0, 'rights_outside_window'); numericChecks(r, b);
}
function cell(f: { state: string; value: string | null }) { return f.state !== 'present' ? { state: 'unavailable' as const, value: null, missing_reason: f.state === 'blank' ? 'provider_blank' : 'provider_missing' } : { state: 'available' as const, value: f.value!.replace(/^0+(?=\d)/, ''), missing_reason: null }; }
async function assemble(value: unknown, verifier?: SyntheticKrHistoryVerifier, clock?: () => string) {
  const snap: any = snapshot(value);
  // No verifier property or clock is accessed for actual-origin candidates, even malformed ones.
  if (snap?.raw_input?.capture?.origin === 'actual' || snap?.raw_evidence?.capture?.origin === 'actual') fail('actual_origin_unsupported');
  const parsed = KrSyntheticHistoryInputSchema.safeParse(snap); must(parsed.success, 'invalid_binding');
  const input = freeze(parsed.data);
  try { verifyKrDailyRawEvidence(input.raw_evidence, input.raw_input, input.original_body_text); } catch { fail('invalid_source'); }
  checks(input);
  must(verifier && !types.isProxy(verifier), 'verifier_required');
  const adapter = Object.getOwnPropertyDescriptor(verifier, 'adapter_id'), mode = Object.getOwnPropertyDescriptor(verifier, 'mode'), method = Object.getOwnPropertyDescriptor(verifier, 'verify');
  must(adapter && 'value' in adapter && Id.safeParse(adapter.value).success && mode && 'value' in mode && mode.value === 'synthetic_fixture_only' && method && 'value' in method && typeof method.value === 'function', 'verifier_required');
  const adapter_id: string = adapter.value, input_sha256 = digest(input), context = freeze({ contract: 'moai.kr-daily.synthetic-only-verification-request.v1' as const, input_sha256, input });
  let answer: unknown; try { answer = await method.value.call(verifier, context); } catch { fail('verification_failed'); }
  const d = Decision.safeParse(snapshot(answer)); must(d.success && d.data.adapter_id === adapter_id && d.data.input_sha256 === input_sha256 && stable(d.data.confirmed) === stable(input.binding.evidence), 'verification_mismatch');
  must(typeof clock === 'function', 'invalid_chronology'); let now: unknown; try { now = clock(); } catch { fail('invalid_chronology'); }
  const t = Instant.safeParse(now); must(t.success, 'invalid_chronology'); const verified_at = t.data, b = input.binding, r = input.raw_evidence;
  must(compareInstants(b.cutoff, verified_at) <= 0, 'invalid_chronology'); must(compareInstants(b.rights.valid_from, verified_at) <= 0 && compareInstants(verified_at, b.rights.valid_until) <= 0, 'rights_outside_window');
  const history = { contract: 'canonical-history/1.0' as const, history_id: b.history_id, data_kind: 'synthetic' as const, context: b.context,
    points: b.points.map(p => { const row = r.rows[p.source_row_index]!, f = row.raw_fields; return {
      fact_id: 'moai:kr-synthetic:' + digest({ input_sha256, source_row_index: p.source_row_index }), trade_date: p.trade_date, context_sha256: digest(b.context), point_kind: 'date' as const, observed_at: null,
      session_close_at: p.session_close_at, published_at: p.published_at, received_at: r.capture.received_at, available_at: p.available_at, finality: 'final' as const,
      revision: { ...p.revision, current_at_cutoff_verified: true },
      provenance: { source_id: 'KIS-SYNTHETIC-FIXTURE', document_id: b.document_id, locator: `output2[${p.source_row_index}]:${row.provider_business_date}`, revision_id: p.revision.revision_id, source_sha256: r.capture.body_sha256, selector_id: b.selector.id, data_kind: 'synthetic', semantic_binding_verified: true, semantic_evidence_ref: b.evidence.field_semantics, identity_verified: true, identity_evidence_ref: b.evidence.identity, unit_verified: true, unit_evidence_ref: b.evidence.units, currency_verified: true, currency_evidence_ref: b.evidence.currency, scale_verified: true, scale_evidence_ref: b.evidence.scales, time_verified: true, time_evidence_ref: b.evidence.publication_availability },
      rights: { state: 'allowed', use: 'local_report', evidence_ref: b.rights.evidence_ref, expires_at: b.rights.valid_until }, values: { open: cell(f.stck_oprc), high: cell(f.stck_hgpr), low: cell(f.stck_lwpr), close: cell(f.stck_clpr), volume: cell(f.acml_vol) },
    }; }).sort((a, b) => a.trade_date < b.trade_date ? -1 : a.trade_date > b.trade_date ? 1 : 0) };
  return freeze({ contract: 'moai.kr-daily.synthetic-only-history-handoff.v1' as const, status: 'synthetic_fixture_demonstration_ready' as const, actual_origin_supported: false as const, actual_source_authenticated: false as const, verified_live_provider_bindings: 0 as const, canonical_actual_bindings: 0 as const, actual_provider_calls: 0 as const,
    cutoff: b.cutoff, request: b.request, history,
    verification: { input_sha256, adapter_id, mode: 'synthetic_fixture_only' as const, verified_at, assurance: 'invented_fixture_checks_not_source_authentication' as const, confirmed: d.data.confirmed },
    lineage: { ...b.source_link, selector: b.selector, source_row_indices: b.points.map(p => p.source_row_index), raw_blockers: r.blockers, raw_projection_status: r.canonical_projection_status, raw_adjustment_code_interpretation: r.adjustment_code_interpretation }, inputs: input, report_runtime: KR_SYNTHETIC_REPORT_PIN,
    warnings: ['SYNTHETIC FIXTURE DEMONSTRATION ONLY. Actual-origin promotion is unsupported and fails before verifier or clock.', 'Neither adjustment code 0 nor 1 is interpreted. The original portal/sample conflict and every raw blocker remain unresolved.', 'Fixture assertions and hashes do not authenticate real prices, identity, units, currency, calendar, adjustment, publication or rights.', 'The pinned report does not implement split-event boundaries. Separate no-adjustment-relevant-actions evidence must cover all supplied calendar and warm-up dates through cutoff, including capture and adjustment vintage.', 'No production verifier, network call, MCP route, source completeness inference, filled/resampled values or benchmark is supplied.'] });
}
/** All unexpected errors are finite sanitized codes; required fresh verifier/clock have no defaults. */
export async function assembleSyntheticKrDailyHistory(value: unknown, verifier?: SyntheticKrHistoryVerifier, clock?: () => string) { try { return await assemble(value, verifier, clock); } catch (e) { if (e instanceof KrSyntheticHistoryError) throw e; fail('invalid_input'); } }
const Receipt = z.object({ input_sha256: Sha, adapter_id: Id, mode: z.literal('synthetic_fixture_only'), verified_at: Instant, assurance: z.literal('invented_fixture_checks_not_source_authentication'), confirmed: Evidence }).strict();
export const KrSyntheticHistoryHandoffEnvelopeSchema = z.object({ contract: z.literal('moai.kr-daily.synthetic-only-history-handoff.v1'), status: z.literal('synthetic_fixture_demonstration_ready'), actual_origin_supported: z.literal(false), actual_source_authenticated: z.literal(false), verified_live_provider_bindings: z.literal(0), canonical_actual_bindings: z.literal(0), actual_provider_calls: z.literal(0), cutoff: Instant, request: z.unknown(), history: z.unknown(), verification: Receipt, lineage: z.unknown(), inputs: KrSyntheticHistoryInputSchema, report_runtime: z.unknown(), warnings: z.unknown() }).strict();
/** Replay receipt is not trust. Compare every deterministic field after complete raw reconstruction and fresh fixture verification/current rights. */
export async function reverifySyntheticKrDailyHistoryHandoff(value: unknown, verifier?: SyntheticKrHistoryVerifier, clock?: () => string) {
  try {
    const snap: any = snapshot(value); if (snap?.inputs?.raw_input?.capture?.origin === 'actual' || snap?.inputs?.raw_evidence?.capture?.origin === 'actual' || snap?.history?.data_kind === 'actual') fail('actual_origin_unsupported');
    const p = KrSyntheticHistoryHandoffEnvelopeSchema.safeParse(snap); must(p.success, 'invalid_handoff'); const old = p.data;
    const fresh = await assembleSyntheticKrDailyHistory(old.inputs, verifier, clock);
    for (const key of Object.keys(fresh).filter(k => k !== 'verification')) must(stable((old as any)[key]) === stable((fresh as any)[key]), 'handoff_mismatch');
    must(old.verification.adapter_id === fresh.verification.adapter_id && old.verification.input_sha256 === fresh.verification.input_sha256 && stable(old.verification.confirmed) === stable(fresh.verification.confirmed), 'handoff_mismatch');
    must(compareInstants(old.cutoff, old.verification.verified_at) <= 0 && compareInstants(old.verification.verified_at, fresh.verification.verified_at) <= 0 && compareInstants(old.inputs.binding.rights.valid_from, old.verification.verified_at) <= 0 && compareInstants(old.verification.verified_at, old.inputs.binding.rights.valid_until) <= 0, 'handoff_mismatch');
    return fresh;
  } catch (e) { if (e instanceof KrSyntheticHistoryError) throw e; fail('invalid_input'); }
}

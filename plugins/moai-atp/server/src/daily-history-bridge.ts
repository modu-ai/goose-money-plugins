import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { z } from 'zod';
import timezoneInventory from '../contracts/report-history-reference/compatible-timezones.json' with { type: 'json' };
import runtimePin from '../contracts/report-history-reference/pin.json' with { type: 'json' };
import { UsDailyHistoryResultSchema, type UsDailyHistoryResult } from './history-breadth.js';
import { ExactInstantSchema, compareInstants } from './exact-instant.js';

/** Offline conditional assembly only. No production verifier, provider call, or MCP registration. */
export const DAILY_HISTORY_BRIDGE_AXES = Object.freeze([
  'source_authenticity', 'identity', 'field_semantics', 'units', 'currency', 'scales',
  'session_calendar', 'adjustment_actions', 'finality_revision', 'publication_availability', 'coverage', 'rights',
] as const);
const Text = z.string().min(1).max(512).refine(s => s.trim() === s && !/[\u0000-\u001f\u007f]/.test(s));
const Id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/).refine(s => s.trim() === s);
const SHA = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const Day = z.string().length(10).regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(s + 'T00:00:00Z');
  return Number(s.slice(0, 4)) >= 1 && Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === s;
});
const Scale = z.string().max(26).regex(/^(?:10{0,12}|0\.0{0,11}1)$/).refine(s => s.trim() === s);
const Instant = ExactInstantSchema.refine(s => {
  // Whole-second representation bounds only; fractional ordering always uses compareInstants.
  // Known-local-offset project profile: exclude -00:00 although RFC 3339 section 4.3
  // says UTC is known and only the local offset is unknown. This is not an old ordering defect.
  // https://www.rfc-editor.org/rfc/rfc3339#section-4.3
  try { const year = new Date(s.replace(/\.\d+(Z|[+-]\d{2}:\d{2})$/, '$1')).getUTCFullYear(); return !s.endsWith('-00:00') && Number(s.slice(0, 4)) >= 1 && year >= 1 && year <= 9999; }
  catch { return false; }
});
const Refs = z.array(Id).min(1).max(16).refine(xs => new Set(xs).size === xs.length);
const Evidence = z.object({
  source_authenticity: Refs, identity: Refs, field_semantics: Refs, units: Refs, currency: Refs, scales: Refs,
  session_calendar: Refs, adjustment_actions: Refs, finality_revision: Refs, publication_availability: Refs, coverage: Refs, rights: Refs,
}).strict();
const Locator = z.string().min(1).max(512).refine(s => {
  try { const u = new URL(s); return ['https:', 'synthetic:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash && !/[\u0000-\u0020\u007f]/.test(s); }
  catch { return false; }
});
const Artifact = z.object({
  id: Id, data_kind: z.enum(['synthetic', 'actual']), digest_kind: z.enum(['original_bytes', 'review_record', 'synthetic_fixture']),
  sha256: SHA, locator: Locator,
  snapshot: z.object({ dto_sha256: SHA, received_at: Instant }).strict().nullable(),
}).strict();
const Request = z.object({ start_date: Day, end_date: Day }).strict();
const Context = z.object({
  identity: z.object({ instrument_id: Text, issuer_id: Text, venue: Text, asset_class: z.literal('equity'), share_class: Text, contract_id: z.literal('not_applicable') }).strict(),
  units: z.object({ price_unit: z.literal('money_per_share'), currency: z.string().length(3).regex(/^[A-Z]{3}$/), price_scale: Scale, volume_unit: z.literal('shares'), volume_scale: Scale }).strict(),
  session: z.object({
    calendar_id: Text, timezone: Text, session_id: Text, interval: z.literal('daily'), date_basis: z.literal('trade_date'),
    calendar_verified: z.literal(true), calendar_evidence_ref: Id, coverage_start: Day, coverage_end: Day,
    coverage_complete: z.literal(true), expected_sessions: z.array(Day).min(1).max(100),
  }).strict(),
  basis: z.object({
    price_kind: z.literal('price_level'), return_policy: z.literal('price_return'), adjustment: z.literal('unadjusted'),
    adjustment_id: Text, adjustment_asof: Instant, actions_coverage_verified: z.literal(true), actions_evidence_ref: Id,
    volume_adjustment: z.literal('unadjusted'), revision_policy: z.literal('final_current_at_cutoff'),
    price_definition: z.literal('official_close'), allow_negative_prices: z.literal(false), roll_policy: z.literal('not_applicable'),
  }).strict(),
}).strict();
const Revision = z.object({
  status: z.enum(['original', 'unchanged', 'revised']), revision_id: Text, evidence_ref: Id,
  supersedes_revision_id: Text.optional(),
}).strict();
const PointBinding = z.object({
  row_index: z.number().int().min(0).max(99), trade_date: Day,
  session_close_at: Instant, published_at: Instant, available_at: Instant,
  finality: z.literal('final'), revision: Revision,
}).strict();
export const DailyHistoryBindingSchema = z.object({
  contract: z.literal('moai.us-daily.history-binding.v1'), history_id: Text, cutoff: Instant, request: Request,
  provider_identity: z.object({ symbol: Text, exchange: z.enum(['NAS', 'NYS', 'AMS']) }).strict(),
  context: Context, document_id: Text, source_artifact_id: Id,
  selector: z.object({ id: z.literal('kis.us-daily.named-ohlcv/1'), date: z.literal('xymd'), open: z.literal('open'), high: z.literal('high'), low: z.literal('low'), close: z.literal('clos'), volume: z.literal('tvol') }).strict(),
  publication_basis: z.literal('explicit_publication_evidence_not_receipt_or_date_substitution'),
  coverage: z.literal('selected_single_page_not_complete_provider_collection'),
  rights: z.object({ use: z.literal('local_report'), evidence_ref: Id, valid_from: Instant, valid_until: Instant }).strict(),
  evidence: Evidence, artifacts: z.array(Artifact).min(2).max(100), points: z.array(PointBinding).min(1).max(100),
}).strict();
export type DailyHistoryBinding = z.infer<typeof DailyHistoryBindingSchema>;
export interface DailyHistoryVerificationContext {
  readonly contract: 'moai.us-daily.history-verification-request.v1';
  readonly input_sha256: string;
  readonly source: UsDailyHistoryResult;
  readonly binding: DailyHistoryBinding;
}
/** Only separately trusted host code may supply this dependency. Metadata cannot establish host trust. */
export interface TrustedDailyHistoryVerifier {
  readonly adapter_id: string;
  readonly mode: 'synthetic_test_only' | 'external_trusted_verification';
  verify(context: Readonly<DailyHistoryVerificationContext>): Promise<unknown>;
}
const Decision = z.object({ contract: z.literal('moai.us-daily.history-verifier-decision.v1'), input_sha256: SHA, adapter_id: Id, data_kind: z.enum(['synthetic', 'actual']), confirmed: Evidence }).strict();
export type DailyHistoryBridgeErrorCode = 'invalid_source' | 'invalid_binding' | 'input_too_large' | 'invalid_plain_json' |
  'unsupported_source_scope' | 'identity_mismatch' | 'calendar_mismatch' | 'point_mapping_mismatch' | 'invalid_chronology' |
  'source_evidence_mismatch' | 'invalid_revision' | 'invalid_volume' | 'verification_not_configured' | 'actual_verifier_required' |
  'verification_failed' | 'verification_mismatch' | 'rights_outside_window' | 'invalid_handoff' | 'handoff_mismatch';
export class DailyHistoryBridgeError extends Error {
  constructor(readonly code: DailyHistoryBridgeErrorCode) { super(code); this.name = 'DailyHistoryBridgeError'; }
}
function fail(code: DailyHistoryBridgeErrorCode): never { throw new DailyHistoryBridgeError(code); }
function must(value: unknown, code: DailyHistoryBridgeErrorCode): asserts value { if (!value) fail(code); }

/** Descriptor-only JSON boundary: no getters, proxies, custom instances, sparse arrays, or toJSON. */
function snapshot(value: unknown, limits = { nodes: 60000, depth: 14, bytes: 1000000, array: 1000 }): unknown {
  let nodes = 0, bytes = 0; const seen = new Set<object>();
  function walk(v: unknown, depth: number): unknown {
    if (++nodes > limits.nodes || depth > limits.depth || (bytes += 16) > limits.bytes) fail('input_too_large');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') { must(Number.isFinite(v), 'invalid_plain_json'); return v; }
    if (typeof v === 'string') {
      if (v.length > Math.min(limits.bytes, 100000)) fail('input_too_large');
      must(Buffer.from(v, 'utf8').toString('utf8') === v && !/[\u202a-\u202e\u2066-\u2069]/.test(v), 'invalid_plain_json');
      bytes += Buffer.byteLength(JSON.stringify(v)); if (bytes > limits.bytes) fail('input_too_large'); return v;
    }
    must(typeof v === 'object' && !types.isProxy(v) && !seen.has(v), 'invalid_plain_json');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    must(array ? proto === Array.prototype || proto === null : proto === Object.prototype || proto === null, 'invalid_plain_json');
    const len = array ? Object.getOwnPropertyDescriptor(v, 'length')?.value : 0;
    must(!array || Number.isSafeInteger(len) && len >= 0, 'invalid_plain_json');
    if (array && len > limits.array) fail('input_too_large');
    const keys = Reflect.ownKeys(v);
    if (keys.length > Math.max(1001, limits.array + 1)) fail('input_too_large');
    must(!array || keys.length === len + 1, 'invalid_plain_json');
    const out: any = array ? [] : Object.create(null); seen.add(v);
    for (const key of keys) {
      must(typeof key === 'string', 'invalid_plain_json');
      if (key.length > 100000) fail('input_too_large');
      must(Buffer.from(key, 'utf8').toString('utf8') === key && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(key), 'invalid_plain_json');
      const descriptor = Object.getOwnPropertyDescriptor(v, key); must(descriptor && 'value' in descriptor, 'invalid_plain_json');
      if (array && key === 'length') continue;
      must(descriptor.enumerable && (!array || /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < len), 'invalid_plain_json');
      bytes += Buffer.byteLength(JSON.stringify(key));
      if (bytes > limits.bytes) fail('input_too_large');
      Object.defineProperty(out, key, { value: walk(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    seen.delete(v); return out;
  }
  return walk(value, 0);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const x of Object.values(value)) freeze(x); Object.freeze(value); } return value;
}
function stable(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  return Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
}
function digest(value: unknown): string { return createHash('sha256').update(stable(value)).digest('hex'); }
freeze(runtimePin); freeze(timezoneInventory);
const TIMEZONES = new Set(timezoneInventory.timezones);
function localDay(instant: string, zone: string): string {
  try {
    must(TIMEZONES.has(zone), 'invalid_chronology');
    const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?(Z|[+-]\d\d:\d\d)$/.exec(instant); must(m, 'invalid_chronology');
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(m[1]! + m[2]!));
    const field = (name: string) => parts.find(p => p.type === name)?.value;
    const day = `${field('year')}-${field('month')}-${field('day')}`; must(Day.safeParse(day).success, 'invalid_chronology'); return day;
  } catch { fail('invalid_chronology'); }
}
const toDay = (raw: string) => raw.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
const cell = (value: string) => value === ''
  ? { state: 'unavailable' as const, value: null, missing_reason: 'provider_blank' }
  : { state: 'available' as const, value: value.replace(/^0+(?=\d)/, ''), missing_reason: null };
function checks(source: UsDailyHistoryResult, b: DailyHistoryBinding) {
  // MODP 0 is a local scope restriction, NEVER evidence of returned adjustment semantics.
  must(source.requested.adjustment_code === '0' && source.requested.asset_class !== 'etf', 'unsupported_source_scope');
  must(Instant.safeParse(source.received_at).success && Instant.safeParse(source.available_at).success, 'invalid_chronology');
  must(source.requested.symbol === b.provider_identity.symbol && source.requested.exchange === b.provider_identity.exchange, 'identity_mismatch');
  const rows = Array.isArray(source.raw.output2) ? source.raw.output2 : [source.raw.output2];
  must(rows.length > 0 && rows.length === b.points.length, 'point_mapping_mismatch');
  const s = b.context.session, expected = s.expected_sessions;
  must(TIMEZONES.has(s.timezone), 'invalid_chronology');
  must(expected.every((d, i) => (!i || expected[i - 1]! < d) && s.coverage_start <= d && d <= s.coverage_end), 'calendar_mismatch');
  must(s.coverage_start <= b.request.start_date && b.request.start_date <= b.request.end_date && b.request.end_date <= s.coverage_end, 'calendar_mismatch');
  must(compareInstants(source.received_at, b.cutoff) <= 0 && compareInstants(b.context.basis.adjustment_asof, b.cutoff) <= 0, 'invalid_chronology');
  must(b.points.every((p, index) => p.row_index === index), 'point_mapping_mismatch');
  for (const p of b.points) {
    const row = rows[p.row_index]; must(row && p.trade_date === toDay(row.xymd) && expected.includes(p.trade_date), 'point_mapping_mismatch');
    must(row.xymd.length === 8 && [row.open, row.high, row.low, row.clos, row.tvol].every(value => value === '' || value.trim() === value), 'invalid_source');
    must(localDay(p.session_close_at, s.timezone) === p.trade_date, 'invalid_chronology');
    must(compareInstants(p.session_close_at, p.published_at) <= 0 && compareInstants(p.published_at, source.received_at) <= 0 &&
      compareInstants(source.available_at, p.available_at) <= 0 && compareInstants(p.available_at, b.cutoff) <= 0, 'invalid_chronology');
    const r = p.revision;
    must(r.status === 'revised' ? r.supersedes_revision_id && r.supersedes_revision_id !== r.revision_id : r.supersedes_revision_id === undefined, 'invalid_revision');
    if (row.tvol !== '' && b.context.units.volume_scale.startsWith('0.')) {
      const places = b.context.units.volume_scale.length - 2;
      must(BigInt(row.tvol) % (10n ** BigInt(places)) === 0n, 'invalid_volume');
    }
  }
  const artifacts = new Map(b.artifacts.map(a => [a.id, a])); must(artifacts.size === b.artifacts.length, 'source_evidence_mismatch');
  const used = new Set<string>();
  for (const axis of DAILY_HISTORY_BRIDGE_AXES) for (const id of b.evidence[axis]) { must(artifacts.has(id), 'source_evidence_mismatch'); used.add(id); }
  must(used.size === artifacts.size && b.evidence.session_calendar.includes(s.calendar_evidence_ref) &&
    b.evidence.adjustment_actions.includes(b.context.basis.actions_evidence_ref) && b.evidence.rights.includes(b.rights.evidence_ref) &&
    b.points.every(p => b.evidence.finality_revision.includes(p.revision.evidence_ref)), 'source_evidence_mismatch');
  const dto_sha256 = digest(source);
  for (const a of b.artifacts) {
    must(a.data_kind === source.origin, 'source_evidence_mismatch');
    if (source.origin === 'actual') must(a.digest_kind !== 'synthetic_fixture' && a.locator.startsWith('https://'), 'source_evidence_mismatch');
    if (a.snapshot) must(a.snapshot.dto_sha256 === dto_sha256 && compareInstants(a.snapshot.received_at, source.received_at) === 0, 'source_evidence_mismatch');
  }
  const artifact = artifacts.get(b.source_artifact_id);
  must(artifact && artifact.snapshot && b.evidence.source_authenticity.includes(artifact.id) &&
    artifact.digest_kind === (source.origin === 'actual' ? 'original_bytes' : 'synthetic_fixture'), 'source_evidence_mismatch');
  must(compareInstants(b.rights.valid_from, b.cutoff) <= 0 && compareInstants(b.cutoff, b.rights.valid_until) <= 0, 'rights_outside_window');
  return { rows, artifact, dto_sha256 };
}

/** Result remains conditional: report runtime validates assertions, not source authenticity. */
export async function assembleUsDailyCanonicalHistory(sourceValue: unknown, bindingValue: unknown, verifier?: TrustedDailyHistoryVerifier, clock: () => string = () => new Date().toISOString()) {
  const ps = UsDailyHistoryResultSchema.safeParse(snapshot(sourceValue)); must(ps.success, 'invalid_source'); const source = freeze(ps.data);
  const pb = DailyHistoryBindingSchema.safeParse(snapshot(bindingValue)); must(pb.success, 'invalid_binding'); const binding = freeze(pb.data);
  const { rows, artifact, dto_sha256 } = checks(source, binding);
  must(verifier, 'verification_not_configured');
  const adapter_id = verifier.adapter_id, mode = verifier.mode, verify = verifier.verify;
  must(Id.safeParse(adapter_id).success && typeof verify === 'function' && ['synthetic_test_only', 'external_trusted_verification'].includes(mode), 'verification_not_configured');
  if (source.origin === 'actual') must(mode === 'external_trusted_verification', 'actual_verifier_required');
  const input_sha256 = digest({ source, binding });
  const context = freeze({ contract: 'moai.us-daily.history-verification-request.v1' as const, input_sha256, source, binding });
  let response: unknown; try { response = await verify.call(verifier, context); } catch { fail('verification_failed'); }
  const parsed = Decision.safeParse(snapshot(response)); must(parsed.success, 'verification_mismatch'); const decision = parsed.data;
  must(decision.adapter_id === adapter_id && decision.input_sha256 === input_sha256 && decision.data_kind === source.origin, 'verification_mismatch');
  for (const axis of DAILY_HISTORY_BRIDGE_AXES) must(stable([...decision.confirmed[axis]].sort()) === stable([...binding.evidence[axis]].sort()), 'verification_mismatch');
  let now: unknown; try { now = clock(); } catch { fail('invalid_chronology'); }
  const pt = Instant.safeParse(now); must(pt.success, 'invalid_chronology'); const verified_at = pt.data;
  must(compareInstants(binding.cutoff, verified_at) <= 0, 'invalid_chronology');
  must(compareInstants(binding.rights.valid_from, verified_at) <= 0 && compareInstants(verified_at, binding.rights.valid_until) <= 0, 'rights_outside_window');
  const history = {
    contract: 'canonical-history/1.0' as const, history_id: binding.history_id, data_kind: source.origin, context: binding.context,
    points: binding.points.map(p => {
      const row = rows[p.row_index]!;
      return {
        fact_id: 'moai:us-daily:' + digest({ input_sha256, row_index: p.row_index }), trade_date: p.trade_date, context_sha256: digest(binding.context),
        point_kind: 'date' as const, observed_at: null, session_close_at: p.session_close_at, published_at: p.published_at,
        received_at: source.received_at, available_at: p.available_at, finality: p.finality,
        revision: { ...p.revision, current_at_cutoff_verified: true },
        provenance: {
          source_id: 'KIS', document_id: binding.document_id, locator: `output2${Array.isArray(source.raw.output2) ? '[' + p.row_index + ']' : ''}:${row.xymd}`,
          revision_id: p.revision.revision_id, source_sha256: artifact.sha256, selector_id: binding.selector.id, data_kind: source.origin,
          semantic_binding_verified: true, semantic_evidence_ref: binding.evidence.field_semantics[0]!,
          identity_verified: true, identity_evidence_ref: binding.evidence.identity[0]!, unit_verified: true, unit_evidence_ref: binding.evidence.units[0]!,
          currency_verified: true, currency_evidence_ref: binding.evidence.currency[0]!, scale_verified: true, scale_evidence_ref: binding.evidence.scales[0]!,
          time_verified: true, time_evidence_ref: binding.evidence.publication_availability[0]!,
        },
        rights: { state: 'allowed' as const, use: 'local_report' as const, evidence_ref: binding.rights.evidence_ref, expires_at: binding.rights.valid_until },
        values: { open: cell(row.open), high: cell(row.high), low: cell(row.low), close: cell(row.clos), volume: cell(row.tvol) },
      };
    }).sort((a, b) => a.trade_date.localeCompare(b.trade_date)),
  };
  return freeze({
    contract: 'moai.us-daily.canonical-history-handoff.v1' as const,
    status: source.origin === 'synthetic' ? 'synthetic_history_ready' as const : 'history_ready_under_external_trusted_verifier' as const,
    actual_source_authenticated: false as const, verified_live_provider_bindings: 0 as const, actual_provider_calls: 0 as const,
    cutoff: binding.cutoff, request: binding.request, history,
    verification: { input_sha256, adapter_id, mode, verified_at, assurance: 'trusted_adapter_attestation_not_independent_host_authentication' as const, confirmed: decision.confirmed },
    lineage: { source_dto_sha256: dto_sha256, source_artifact_sha256: artifact.sha256, artifacts: binding.artifacts, selector: binding.selector, raw_rows: rows },
    rights: binding.rights, inputs: { source, binding }, report_runtime: runtimePin,
    warnings: [
      'No production verifier is supplied or configured; host trust must be established separately.',
      'Original-source artifact hashes and DTO snapshot hashes serve different purposes; neither alone authenticates sources.',
      'Verified flags are conditional assertions, not source authentication. The pinned report runtime must still validate the history.',
      'No inferred units, scales, currency, issuer, session, calendar, adjustment, publication, finality, rights or source-page completeness.',
      'Only finite US daily equity MODP 0 input is supported. The request flag does not prove unadjusted output. No intraday, ETF, KR, futures, adjusted or continuous history.',
    ],
  });
}
const Receipt = z.object({ input_sha256: SHA, adapter_id: Id, mode: z.enum(['synthetic_test_only', 'external_trusted_verification']), verified_at: Instant, assurance: z.literal('trusted_adapter_attestation_not_independent_host_authentication'), confirmed: Evidence }).strict();
export const DailyHistoryHandoffEnvelopeSchema = z.object({
  contract: z.literal('moai.us-daily.canonical-history-handoff.v1'), status: z.enum(['synthetic_history_ready', 'history_ready_under_external_trusted_verifier']),
  actual_source_authenticated: z.literal(false), verified_live_provider_bindings: z.literal(0), actual_provider_calls: z.literal(0),
  cutoff: Instant, request: z.unknown(), history: z.unknown(), verification: Receipt, lineage: z.unknown(), rights: z.unknown(),
  inputs: z.object({ source: z.unknown(), binding: z.unknown() }).strict(), report_runtime: z.unknown(), warnings: z.unknown(),
}).strict();
/** Serialized success never authorizes use. Rebuild and compare, with a fresh trusted verifier and clock. */
export async function reverifyDailyHistoryHandoff(value: unknown, verifier?: TrustedDailyHistoryVerifier, clock: () => string = () => new Date().toISOString()) {
  const parsed = DailyHistoryHandoffEnvelopeSchema.safeParse(snapshot(value, { nodes: 300000, depth: 24, bytes: 4000000, array: 1000 })); must(parsed.success, 'invalid_handoff'); const old = parsed.data;
  const fresh = await assembleUsDailyCanonicalHistory(old.inputs.source, old.inputs.binding, verifier, clock);
  for (const key of ['contract', 'status', 'actual_source_authenticated', 'verified_live_provider_bindings', 'actual_provider_calls', 'cutoff', 'request', 'history', 'lineage', 'rights', 'inputs', 'report_runtime', 'warnings'] as const) must(stable(old[key]) === stable(fresh[key]), 'handoff_mismatch');
  must(old.verification.input_sha256 === fresh.verification.input_sha256, 'handoff_mismatch');
  if (fresh.history.data_kind === 'actual') must(old.verification.mode === 'external_trusted_verification', 'handoff_mismatch');
  for (const axis of DAILY_HISTORY_BRIDGE_AXES) must(stable([...old.verification.confirmed[axis]].sort()) === stable([...fresh.verification.confirmed[axis]].sort()), 'handoff_mismatch');
  must(compareInstants(fresh.cutoff, old.verification.verified_at) <= 0 && compareInstants(old.verification.verified_at, fresh.verification.verified_at) <= 0 &&
    compareInstants(fresh.rights.valid_from, old.verification.verified_at) <= 0 && compareInstants(old.verification.verified_at, fresh.rights.valid_until) <= 0, 'handoff_mismatch');
  return fresh;
}

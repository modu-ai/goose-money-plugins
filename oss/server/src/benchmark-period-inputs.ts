import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { z } from 'zod';

/** Additive, unregistered raw evidence. No fetch, credentials, filesystem or canonical promotion. */
export const BENCHMARK_PERIOD_LIMITS = Object.freeze({ body_bytes: 262_144, input_bytes: 32_768,
  persisted_bytes: 786_432, persisted_nodes: 30_000, depth: 12, nodes: 12_000, container_entries: 1_024,
  string_code_units: 16_384, key_code_units: 128, number_code_units: 128,
  kis072_documented_rows: 50, kis264_local_safety_rows: 500 });
export const BENCHMARK_PERIOD_ERROR_CODES = Object.freeze(['invalid_input', 'unsafe_object', 'input_too_large',
  'invalid_body_text', 'body_too_large', 'body_complexity_limit', 'invalid_json', 'duplicate_json_key',
  'protected_key', 'capture_hash_mismatch', 'future_receipt', 'schema_drift', 'upstream_rejected',
  'invalid_provider_date', 'invalid_metadata_number', 'row_limit_exceeded', 'evidence_mismatch',
  'request_contract_conflict', 'transport_not_configured', 'upstream_unavailable', 'rate_limited',
  'auth_expired', 'upstream_timeout'] as const);
export type BenchmarkPeriodErrorCode = typeof BENCHMARK_PERIOD_ERROR_CODES[number];
export class BenchmarkPeriodError extends Error {
  constructor(readonly code: BenchmarkPeriodErrorCode) { super(code); this.name = 'BenchmarkPeriodError'; }
}
function fail(code: BenchmarkPeriodErrorCode): never { throw new BenchmarkPeriodError(code); }
function need(ok: unknown, code: BenchmarkPeriodErrorCode): asserts ok { if (!ok) fail(code); }
function safe<T>(run: () => T): T { try { return run(); } catch (e) {
  if (types.isNativeError(e) && e instanceof BenchmarkPeriodError) {
    const descriptor = Object.getOwnPropertyDescriptor(e, 'code');
    if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string' &&
      (BENCHMARK_PERIOD_ERROR_CODES as readonly string[]).includes(descriptor.value))
      throw new BenchmarkPeriodError(descriptor.value as BenchmarkPeriodErrorCode);
  }
  fail('invalid_input');
} }
const Protected = new Set(['__proto__', 'prototype', 'constructor', 'toJSON']);
function wellFormed(s: string): boolean { for (let i = 0; i < s.length; i++) {
  const c = s.charCodeAt(i); if (c >= 0xD800 && c <= 0xDBFF) {
    const n = s.charCodeAt(++i); if (!(n >= 0xDC00 && n <= 0xDFFF)) return false;
  } else if (c >= 0xDC00 && c <= 0xDFFF) return false;
} return true; }
function textOk(s: string): boolean { return wellFormed(s) && !/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(s); }
function boundedText(max: number, min = 0) { return z.string().min(min).max(max).pipe(z.string().refine(textOk)); }
function validDay(s: string): boolean {
  if (s.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(s) || s.slice(0, 4) === '0000') return false;
  const d = new Date(s + 'T00:00:00Z'); return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === s;
}
const Day = z.string().length(10).pipe(z.string().refine(validDay));
function instantParts(s: string): { second: bigint; fraction: string } | null {
  if (s.length > 80) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})(?![\s\S])/.exec(s);
  if (!m || !validDay(m[1]!) || m[6] === '-00:00' || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4]) > 59) return null;
  if (m[6] !== 'Z' && (Number(m[6]!.slice(1, 3)) > 23 || Number(m[6]!.slice(4)) > 59)) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[6]}`);
  return Number.isFinite(ms) ? { second: BigInt(ms / 1000), fraction: m[5] ?? '' } : null;
}
const Instant = z.string().max(80).pipe(z.string().refine(s => instantParts(s) !== null));
function compareInstant(a: string, b: string): number {
  const x = instantParts(a), y = instantParts(b); if (!x || !y) return NaN;
  if (x.second !== y.second) return x.second < y.second ? -1 : 1;
  const n = Math.max(x.fraction.length, y.fraction.length), p = x.fraction.padEnd(n, '0'), q = y.fraction.padEnd(n, '0');
  return p < q ? -1 : p > q ? 1 : 0;
}
const Sha = z.string().length(64).pipe(z.string().regex(/^[a-f0-9]{64}$/));
const RequestBase = { instrument_code: boundedText(12, 1), start_date: Day, end_date: Day, period_code: z.enum(['W', 'M', 'Y']) };
export const Kis072PeriodRequestSchema = z.object({ ...RequestBase, market_code: z.literal('U') }).strict()
  .refine(v => v.start_date <= v.end_date, 'date_range_reversed');
export const Kis264PeriodRequestSchema = z.object({ ...RequestBase, market_code: z.enum(['N', 'X', 'I', 'S']) }).strict()
  .refine(v => v.start_date <= v.end_date, 'date_range_reversed');
export type Kis072PeriodRequest = z.infer<typeof Kis072PeriodRequestSchema>;
export type Kis264PeriodRequest = z.infer<typeof Kis264PeriodRequestSchema>;
export type BenchmarkPeriodRequest = Kis072PeriodRequest | Kis264PeriodRequest;
const Capture = z.object({ origin: z.enum(['actual', 'synthetic']), received_at: Instant, expected_body_sha256: Sha,
  http_status: z.number().int().min(100).max(599), tr_cont: boundedText(8).nullable() }).strict();
export const Kis072PeriodInputSchema = z.object({ request: Kis072PeriodRequestSchema, capture: Capture, cutoff: Instant }).strict();
export const Kis264PeriodInputSchema = z.object({ request: Kis264PeriodRequestSchema, capture: Capture, cutoff: Instant }).strict();

import { KIS072_HISTORY_FIELD_LENGTHS as KIS072_PERIOD_FIELD_LENGTHS,
  KIS264_HISTORY_FIELD_LENGTHS as KIS264_PERIOD_FIELD_LENGTHS,
  KIS264_HISTORY_HEADER_LENGTHS as KIS264_PERIOD_HEADER_LENGTHS,
  BENCHMARK_HISTORY_SOURCE as BENCHMARK_PERIOD_SOURCE } from './benchmark-history-inputs.js';
export { KIS072_PERIOD_FIELD_LENGTHS, KIS264_PERIOD_FIELD_LENGTHS, KIS264_PERIOD_HEADER_LENGTHS, BENCHMARK_PERIOD_SOURCE };
const Endpoints = Object.freeze({ 'KIS-072': Object.freeze({ path: '/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice', tr_id: 'FHKUP03500100' }),
  'KIS-264': Object.freeze({ path: '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice', tr_id: 'FHKST03030100' }) });
export type BenchmarkPeriodOperation = keyof typeof Endpoints;
const Interval = { W: 'weekly', M: 'monthly', Y: 'yearly' } as const;
const FieldState = (limit: number) => z.discriminatedUnion('state', [
  z.object({ state: z.literal('present'), value: boundedText(limit, 1) }).strict(),
  z.object({ state: z.literal('blank'), value: z.literal('') }).strict(),
  z.object({ state: z.literal('missing'), value: z.null() }).strict(),
]);
function fieldsSchema(lengths: Readonly<Record<string, number>>) { return z.object(Object.fromEntries(Object.entries(lengths).map(([k, n]) => [k, FieldState(n)]))).strict(); }
const Canonical = z.object({ instrument_id: z.null(), asset_class: z.null(), date: z.null(), open: z.null(), high: z.null(),
  low: z.null(), close: z.null(), volume: z.null(), turnover: z.null(), currency: z.null(), value_unit: z.null(),
  volume_unit: z.null(), turnover_unit: z.null(), session: z.null(), timezone: z.null(), adjusted: z.null(),
  source_as_of: z.null(), publication_at: z.null(), period_start: z.null(), period_end: z.null(), total_return: z.null() }).strict();
const Blockers = ['canonical_identity_units_currency_session_unverified', 'date_only_no_provider_publication_instant',
  'continuation_portal_sample_conflict', 'rights_and_source_authentication_not_established', 'actual_period_coverage_alignment_finality_and_return_basis_unverified'] as const;
const Warnings = [
  'Raw field presence and SHA-256 do not establish source authenticity, rights, canonical semantics or completeness.',
  'Request codes are caller context only, not verified asset classes or response identity.',
  'Receipt and cutoff are caller supplied; receipt ordering does not establish provider publication or as-of time.',
  'Snapshot header values are separate from historical rows and never fill missing row fields.',
  'Native W/M/Y response rows are preserved in source order without resampling or daily-bar reconstruction. The request profile permits initial-page input only; supplied page origin and execution are not attested.',
  'Raw bounded provider strings are preserved without numerical conversion; numeric formatting does not establish units.',
  'Requested W/M/Y is caller context, not verified actual interval, period boundaries, completeness, finality, calendar or total-return evidence.',
] as const;
function resultSchema(op: BenchmarkPeriodOperation) {
  const domestic = op === 'KIS-072', lengths = domestic ? KIS072_PERIOD_FIELD_LENGTHS : KIS264_PERIOD_FIELD_LENGTHS;
  const limit = domestic ? 50 : 500;
  return z.object({ contract: z.literal('moai.kis.benchmark-period-raw-evidence.v1'), provider: z.literal('KIS'), operation_id: z.literal(op),
    endpoint: z.literal(Endpoints[op].path), tr_id: z.literal(Endpoints[op].tr_id),
    request: domestic ? Kis072PeriodRequestSchema : Kis264PeriodRequestSchema,
    requested_interval: z.enum(['weekly', 'monthly', 'yearly']), actual_interval_status: z.literal('not_verified'),
    actual_period_coverage: z.literal('unknown'), period_boundary_status: z.literal('unknown'), period_completeness: z.literal('unknown'),
    return_basis: z.literal('unknown_not_total_return_evidence'), metric_ready: z.literal(false),
    capture: z.object({ origin: z.enum(['actual', 'synthetic']), received_at: Instant, body_sha256: Sha,
      body_byte_length: z.number().int().min(1).max(BENCHMARK_PERIOD_LIMITS.body_bytes), http_status: z.number().int().min(200).max(299),
      tr_cont: boundedText(8).nullable(), hash_scope: z.literal('original_decoded_response_text_utf8'),
      provenance_status: z.literal('caller_supplied_capture_metadata'), source_authentication: z.literal('not_established') }).strict(),
    cutoff: Instant, receipt_cutoff_status: z.literal('receipt_not_after_cutoff_no_publication_inference'), provider_success_status: z.literal('0'),
    source_as_of: z.null(), publication_at: z.null(), identity_status: z.literal('request_context_only_not_response_verified'),
    source_time_status: z.literal('date_only_no_time_or_timezone'), rights_status: z.literal('pending'), canonical_projection_status: z.literal('blocked'),
    output1_state: z.enum(['missing', 'present']),
    header_raw_fields: domestic ? z.object({}).strict() : fieldsSchema(KIS264_PERIOD_HEADER_LENGTHS),
    output2_state: z.enum(['missing', 'empty', 'rows_present']), row_count: z.number().int().min(0).max(limit),
    row_order: z.literal('captured_output2_array_order'), row_index_basis: z.literal('zero_based_output2_index'),
    rows: z.array(z.object({ source_row_index: z.number().int().min(0).max(limit - 1), provider_business_date_label: Day.nullable(), label_relation_to_request: z.enum(['within_requested_range', 'outside_requested_range', 'unavailable']),
      raw_fields: fieldsSchema(lengths), canonical: Canonical }).strict()).max(limit),
    row_limit: z.literal(limit), row_limit_basis: z.literal(domestic ? 'documented_max_rows_per_request' : 'local_safety_budget_not_provider_cap'),
    request_profile_status: z.literal(domestic ? 'blocked_code_length_contract_conflict' : 'initial_page_only_execution_not_attested'),
    page_origin_status: z.literal('not_independently_established'), response_range_completeness: z.literal('unknown_continuation_conflict'), continuation_action: z.literal('none'),
    source_review: z.literal('provided_2026_10_21_snapshot_not_new_live_verification'),
    blockers: z.tuple(Blockers.map(s => z.literal(s)) as [z.ZodLiteral<typeof Blockers[0]>, z.ZodLiteral<typeof Blockers[1]>, z.ZodLiteral<typeof Blockers[2]>, z.ZodLiteral<typeof Blockers[3]>, z.ZodLiteral<typeof Blockers[4]>]),
    warnings: z.tuple(Warnings.map(s => z.literal(s)) as [z.ZodLiteral<typeof Warnings[0]>, z.ZodLiteral<typeof Warnings[1]>, z.ZodLiteral<typeof Warnings[2]>, z.ZodLiteral<typeof Warnings[3]>, z.ZodLiteral<typeof Warnings[4]>, z.ZodLiteral<typeof Warnings[5]>, z.ZodLiteral<typeof Warnings[6]>]),
  }).strict().superRefine((v, ctx) => {
    if (v.requested_interval !== Interval[v.request.period_code] || v.row_count !== v.rows.length || v.rows.some((row, i) => row.source_row_index !== i) ||
      (v.output2_state === 'rows_present') !== (v.row_count > 0) || (domestic && (v.output1_state === 'missing' || v.output2_state === 'missing')) ||
      (domestic ? v.request.market_code !== 'U' : v.request.market_code === 'U') || compareInstant(v.capture.received_at, v.cutoff) > 0)
      ctx.addIssue({ code: 'custom', message: 'evidence_invariant_violation' });
    for (const row of v.rows) {
      const date = row.raw_fields.stck_bsop_date;
      const label = date?.state === 'present' ? `${date.value.slice(0, 4)}-${date.value.slice(4, 6)}-${date.value.slice(6)}` : null;
      const relation = label === null ? 'unavailable' : label >= v.request.start_date && label <= v.request.end_date ? 'within_requested_range' : 'outside_requested_range';
      if (label !== row.provider_business_date_label || row.label_relation_to_request !== relation)
        ctx.addIssue({ code: 'custom', message: 'row_label_invariant_violation' });
    }
  });
}
export const Kis072PeriodResultSchema = resultSchema('KIS-072');
export const Kis264PeriodResultSchema = resultSchema('KIS-264');
export type BenchmarkPeriodRawFieldState = { state: 'present'; value: string } | { state: 'blank'; value: '' } | { state: 'missing'; value: null };
export type BenchmarkPeriodResult = Omit<z.infer<typeof Kis072PeriodResultSchema>, 'header_raw_fields'> & { header_raw_fields: Record<string, BenchmarkPeriodRawFieldState> };
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
function freeze<T>(v: T): DeepReadonly<T> { if (v && typeof v === 'object') { for (const c of Object.values(v)) freeze(c); Object.freeze(v); } return v as DeepReadonly<T>; }

/** Safe owned snapshot. No getter, toJSON, proxy trap, custom prototype or sparse array execution. */
function snapshot(value: unknown, maxBytes: number, maxNodes: number): unknown {
  let bytes = 0, nodes = 0; const seen = new Set<object>();
  function add(n: number) { bytes += n; need(bytes <= maxBytes, 'input_too_large'); }
  function string(s: string) { need(s.length <= maxBytes - bytes, 'input_too_large'); need(wellFormed(s), 'unsafe_object'); add(Buffer.byteLength(s, 'utf8') + 2); return s; }
  function copy(v: unknown, depth: number): unknown {
    need(++nodes <= maxNodes && depth <= BENCHMARK_PERIOD_LIMITS.depth, 'input_too_large');
    if (v === null || typeof v === 'boolean') { add(5); return v; }
    if (typeof v === 'string') return string(v);
    if (typeof v === 'number') { need(Number.isSafeInteger(v) && !Object.is(v, -0), 'unsafe_object'); add(24); return v; }
    need(typeof v === 'object' && !types.isProxy(v) && !seen.has(v), 'unsafe_object');
    const a = Array.isArray(v), p = Object.getPrototypeOf(v); need(a ? p === Array.prototype || p === null : p === Object.prototype || p === null, 'unsafe_object');
    const length = a ? Object.getOwnPropertyDescriptor(v, 'length')?.value : null;
    if (a) need(Number.isSafeInteger(length) && length >= 0 && length <= BENCHMARK_PERIOD_LIMITS.container_entries, 'input_too_large');
    const keys = Reflect.ownKeys(v); need(keys.length <= BENCHMARK_PERIOD_LIMITS.container_entries + 1, 'input_too_large');
    need(!a || keys.length === length + 1, 'unsafe_object'); const out = a ? [] : Object.create(null); seen.add(v); add(2);
    for (const key of keys) {
      need(typeof key === 'string', 'unsafe_object'); if (a && key === 'length') continue;
      need(key.length <= BENCHMARK_PERIOD_LIMITS.key_code_units, 'input_too_large'); need(!Protected.has(key), 'protected_key');
      const d = Object.getOwnPropertyDescriptor(v, key); need(d && 'value' in d && d.enumerable, 'unsafe_object');
      need(!a || /^(0|[1-9]\d*)$/.test(key) && Number(key) < length, 'unsafe_object'); string(key); add(2);
      Object.defineProperty(out, key, { value: copy(d.value, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    seen.delete(v); return out;
  }
  return copy(value, 0);
}
function parsed<T>(schema: z.ZodType<T>, v: unknown, bytes: number = BENCHMARK_PERIOD_LIMITS.input_bytes, nodes: number = BENCHMARK_PERIOD_LIMITS.nodes): T {
  const r = schema.safeParse(snapshot(v, bytes, nodes)); need(r.success, 'invalid_input'); return r.data;
}
const RawNumber = Symbol('raw_number_not_converted');
/** Original JSON parser retains numeric tokens unconverted; only provider strings enter projections. */
function parseOriginal(text: string, metadata = false, maxNodes: number = BENCHMARK_PERIOD_LIMITS.nodes): unknown {
  let pos = 0, nodes = 0; const len = text.length;
  const white = (c: string | undefined) => c === ' ' || c === '\t' || c === '\r' || c === '\n';
  function ws() { while (pos < len && white(text[pos])) pos++; }
  function string(key = false): string {
    const start = pos; need(text[pos++] === '"', 'invalid_json'); let closed = false;
    const limit = key ? BENCHMARK_PERIOD_LIMITS.key_code_units : BENCHMARK_PERIOD_LIMITS.string_code_units;
    while (pos < len) { need(pos - start <= limit * 6 + 2, 'body_complexity_limit'); const c = text[pos++]!;
      if (c === '"') { closed = true; break; } if (c === '\\') pos++; else if (c.charCodeAt(0) < 32) fail('invalid_json'); }
    need(closed, 'invalid_json'); let s: unknown; try { s = JSON.parse(text.slice(start, pos)); } catch { fail('invalid_json'); }
    need(typeof s === 'string' && s.length <= limit, 'body_complexity_limit'); need(wellFormed(s), 'invalid_json'); return s;
  }
  function value(depth: number): unknown {
    need(++nodes <= maxNodes && depth <= BENCHMARK_PERIOD_LIMITS.depth, 'body_complexity_limit'); ws(); const c = text[pos];
    if (c === '"') return string();
    if (c === '{' || c === '[') {
      const a = c === '[', out = a ? [] : Object.create(null), keys = new Set<string>(); pos++; ws();
      if (text[pos] === (a ? ']' : '}')) { pos++; return out; } let n = 0;
      while (pos < len) { need(++n <= BENCHMARK_PERIOD_LIMITS.container_entries, 'body_complexity_limit'); ws();
        if (a) (out as unknown[]).push(value(depth + 1)); else {
          const key = string(true); need(!Protected.has(key), 'protected_key'); need(!keys.has(key), 'duplicate_json_key'); keys.add(key);
          ws(); need(text[pos++] === ':', 'invalid_json'); Object.defineProperty(out, key, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        }
        ws(); const next = text[pos++]; if (next === (a ? ']' : '}')) return out; need(next === ',', 'invalid_json');
      } fail('invalid_json');
    }
    for (const [word, v] of [['true', true], ['false', false], ['null', null]] as const) if (text.startsWith(word, pos)) { pos += word.length; return v; }
    const start = pos; while (pos < len && !white(text[pos]) && ![',', ']', '}'].includes(text[pos]!)) { need(pos - start < BENCHMARK_PERIOD_LIMITS.number_code_units, 'body_complexity_limit'); pos++; }
    const lexeme = text.slice(start, pos); need(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(lexeme), 'invalid_json');
    if (!metadata) return { [RawNumber]: lexeme };
    need(/^(?:0|[1-9]\d*)(?![\s\S])/.test(lexeme) && lexeme.length <= 16, 'invalid_metadata_number');
    const n = Number(lexeme); need(Number.isSafeInteger(n), 'invalid_metadata_number'); return n;
  }
  const v = value(0); ws(); need(pos === len, 'invalid_json'); return v;
}
function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) && !Object.hasOwn(v, RawNumber); }
function original(text: unknown): { text: string; bytes: number; hash: string; body: unknown } {
  need(typeof text === 'string', 'invalid_body_text'); need(text.length <= BENCHMARK_PERIOD_LIMITS.body_bytes, 'body_too_large');
  need(wellFormed(text), 'invalid_body_text'); const bytes = Buffer.byteLength(text, 'utf8'); need(bytes <= BENCHMARK_PERIOD_LIMITS.body_bytes, 'body_too_large');
  return { text, bytes, hash: createHash('sha256').update(text, 'utf8').digest('hex'), body: parseOriginal(text) };
}
function fields(raw: Record<string, unknown>, lengths: Readonly<Record<string, number>>, strict: boolean) {
  if (strict) for (const key of Object.keys(raw)) need(Object.hasOwn(lengths, key), 'schema_drift');
  return Object.fromEntries(Object.entries(lengths).map(([key, limit]) => {
    if (!Object.hasOwn(raw, key)) return [key, { state: 'missing', value: null }];
    const v = raw[key]; need(typeof v === 'string' && v.length <= limit && textOk(v), 'schema_drift');
    return [key, { state: v === '' ? 'blank' : 'present', value: v }];
  }));
}
function status(code: number): void {
  if (code === 401 || code === 403) fail('auth_expired'); if (code === 429) fail('rate_limited');
  if (code === 408) fail('upstream_timeout'); need(code >= 200 && code < 300, 'upstream_unavailable');
}
function canonicalNulls() { return { instrument_id: null, asset_class: null, date: null, open: null, high: null, low: null,
  close: null, volume: null, turnover: null, currency: null, value_unit: null, volume_unit: null, turnover_unit: null,
  session: null, timezone: null, adjusted: null, source_as_of: null, publication_at: null, period_start: null, period_end: null, total_return: null }; }
function normalize(op: BenchmarkPeriodOperation, input: unknown, bodyText: unknown): DeepReadonly<BenchmarkPeriodResult> {
  const domestic = op === 'KIS-072', q = domestic ? parsed(Kis072PeriodInputSchema, input) : parsed(Kis264PeriodInputSchema, input);
  need(compareInstant(q.capture.received_at, q.cutoff) <= 0, 'future_receipt'); status(q.capture.http_status);
  const captured = original(bodyText); need(captured.hash === q.capture.expected_body_sha256, 'capture_hash_mismatch');
  const raw = captured.body; need(record(raw), 'schema_drift'); need(typeof raw.rt_cd === 'string', 'schema_drift'); need(raw.rt_cd === '0', 'upstream_rejected');
  const hasHeader = Object.hasOwn(raw, 'output1'), hasRows = Object.hasOwn(raw, 'output2');
  need(!domestic || (hasHeader && hasRows), 'schema_drift'); need(!hasHeader || record(raw.output1), 'schema_drift');
  need(!hasRows || Array.isArray(raw.output2), 'schema_drift');
  const rowArray = hasRows ? raw.output2 as unknown[] : [], limit = domestic ? 50 : 500;
  need(rowArray.length <= limit, 'row_limit_exceeded'); const lengths = domestic ? KIS072_PERIOD_FIELD_LENGTHS : KIS264_PERIOD_FIELD_LENGTHS;
  const rows = rowArray.map((row, index) => {
    need(record(row), 'schema_drift'); const f = fields(row, lengths, true), d = f.stck_bsop_date;
    let day: string | null = null;
    if (d?.state === 'present') {
      need(typeof d.value === 'string' && d.value.length === 8 && /^\d{8}(?![\s\S])/.test(d.value), 'invalid_provider_date');
      day = `${d.value.slice(0, 4)}-${d.value.slice(4, 6)}-${d.value.slice(6)}`; need(validDay(day), 'invalid_provider_date');
    }
    // A date label is not a period boundary. Do not discard outside-range labels or infer coverage.
    const relation = day === null ? 'unavailable' : day >= q.request.start_date && day <= q.request.end_date ? 'within_requested_range' : 'outside_requested_range';
    return { source_row_index: index, provider_business_date_label: day, label_relation_to_request: relation, raw_fields: f, canonical: canonicalNulls() };
  });
  const result = (domestic ? Kis072PeriodResultSchema : Kis264PeriodResultSchema).safeParse({
    contract: 'moai.kis.benchmark-period-raw-evidence.v1', provider: 'KIS', operation_id: op, endpoint: Endpoints[op].path, tr_id: Endpoints[op].tr_id,
    requested_interval: Interval[q.request.period_code], actual_interval_status: 'not_verified', actual_period_coverage: 'unknown',
    period_boundary_status: 'unknown', period_completeness: 'unknown', return_basis: 'unknown_not_total_return_evidence', metric_ready: false,
    request: q.request, capture: { origin: q.capture.origin, received_at: q.capture.received_at, body_sha256: captured.hash, body_byte_length: captured.bytes,
      http_status: q.capture.http_status, tr_cont: q.capture.tr_cont, hash_scope: 'original_decoded_response_text_utf8',
      provenance_status: 'caller_supplied_capture_metadata', source_authentication: 'not_established' }, cutoff: q.cutoff,
    receipt_cutoff_status: 'receipt_not_after_cutoff_no_publication_inference', provider_success_status: '0', source_as_of: null, publication_at: null,
    identity_status: 'request_context_only_not_response_verified', source_time_status: 'date_only_no_time_or_timezone', rights_status: 'pending', canonical_projection_status: 'blocked',
    output1_state: hasHeader ? 'present' : 'missing', header_raw_fields: domestic ? {} : fields(hasHeader ? raw.output1 as Record<string, unknown> : {}, KIS264_PERIOD_HEADER_LENGTHS, false),
    output2_state: !hasRows ? 'missing' : rows.length ? 'rows_present' : 'empty', row_count: rows.length,
    row_order: 'captured_output2_array_order', row_index_basis: 'zero_based_output2_index', rows,
    row_limit: limit, row_limit_basis: domestic ? 'documented_max_rows_per_request' : 'local_safety_budget_not_provider_cap',
    request_profile_status: domestic ? 'blocked_code_length_contract_conflict' : 'initial_page_only_execution_not_attested',
    page_origin_status: 'not_independently_established', response_range_completeness: 'unknown_continuation_conflict', continuation_action: 'none', source_review: 'provided_2026_10_21_snapshot_not_new_live_verification',
    blockers: [...Blockers], warnings: [...Warnings],
  }); need(result.success, 'schema_drift'); return freeze(result.data);
}
export function normalizeKis072Period(input: unknown, originalBodyText: unknown): DeepReadonly<BenchmarkPeriodResult> { return safe(() => normalize('KIS-072', input, originalBodyText)); }
export function normalizeKis264Period(input: unknown, originalBodyText: unknown): DeepReadonly<BenchmarkPeriodResult> { return safe(() => normalize('KIS-264', input, originalBodyText)); }
function canonical(v: unknown): string { if (v === null || typeof v !== 'object') return JSON.stringify(v); if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`; }
/** Rebuild against independent input and original body. Schema validation alone is not evidence verification. */
export function verifyBenchmarkPeriodEvidence(op: BenchmarkPeriodOperation, persisted: unknown, input: unknown, bodyText: unknown): DeepReadonly<BenchmarkPeriodResult> {
  return safe(() => { need(op === 'KIS-072' || op === 'KIS-264', 'invalid_input');
    const given = parsed(op === 'KIS-072' ? Kis072PeriodResultSchema : Kis264PeriodResultSchema, persisted, BENCHMARK_PERIOD_LIMITS.persisted_bytes, BENCHMARK_PERIOD_LIMITS.persisted_nodes);
    const rebuilt = normalize(op, input, bodyText); need(canonical(given) === canonical(rebuilt), 'evidence_mismatch'); return rebuilt;
  });
}

export interface BenchmarkPeriodWireRequest {
  readonly operation_ref: 'KIS-264'; readonly method: 'GET';
  readonly path: '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice'; readonly tr_id: 'FHKST03030100';
  readonly query: { readonly FID_COND_MRKT_DIV_CODE: 'N' | 'X' | 'I' | 'S'; readonly FID_INPUT_ISCD: string;
    readonly FID_INPUT_DATE_1: string; readonly FID_INPUT_DATE_2: string; readonly FID_PERIOD_DIV_CODE: 'W' | 'M' | 'Y' };
}
export interface BenchmarkPeriodTransport {
  readonly origin: 'actual' | 'synthetic';
  /** Receive bounded original decoded JSON text; no parsed/re-serialized replacement. Adapter sends once only. */
  readonly send: (request: BenchmarkPeriodWireRequest) => Promise<unknown>;
}
export type BenchmarkPeriodClock = () => string;
const Response = z.object({ http_status: z.number().int().min(100).max(599), tr_cont: boundedText(8).nullable(),
  body_text: z.string().max(BENCHMARK_PERIOD_LIMITS.body_bytes) }).strict();
const Adapter072Input = z.object({ request: Kis072PeriodRequestSchema, cutoff: Instant }).strict();
const Adapter264Input = z.object({ request: Kis264PeriodRequestSchema, cutoff: Instant }).strict();
/** All 072 requests fail before inspecting transport/clock, including two-character and example four-character codes. */
export async function requestKis072Period(input: unknown, _transport?: BenchmarkPeriodTransport, _clock?: BenchmarkPeriodClock): Promise<never> {
  return safe(() => { parsed(Adapter072Input, input); return fail('request_contract_conflict'); });
}
export async function requestKis264Period(input: unknown, transport?: BenchmarkPeriodTransport,
  clock: BenchmarkPeriodClock = () => new Date().toISOString()): Promise<DeepReadonly<BenchmarkPeriodResult>> {
  const q = safe(() => parsed(Adapter264Input, input));
  const hook = safe(() => {
    need(transport !== undefined, 'transport_not_configured'); need(transport !== null && typeof transport === 'object' && !types.isProxy(transport), 'invalid_input');
    const proto = Object.getPrototypeOf(transport); need(proto === Object.prototype || proto === null, 'invalid_input');
    const keys = Reflect.ownKeys(transport); need(keys.length === 2 && keys.includes('origin') && keys.includes('send'), 'invalid_input');
    const o = Object.getOwnPropertyDescriptor(transport, 'origin'), s = Object.getOwnPropertyDescriptor(transport, 'send');
    need(o && 'value' in o && o.enumerable && s && 'value' in s && s.enumerable && typeof s.value === 'function' && !types.isProxy(s.value), 'invalid_input');
    need((o.value === 'actual' || o.value === 'synthetic') && typeof clock === 'function' && !types.isProxy(clock), 'invalid_input');
    return { origin: o.value as 'actual' | 'synthetic', send: s.value as BenchmarkPeriodTransport['send'] };
  });
  const request: BenchmarkPeriodWireRequest = { operation_ref: 'KIS-264', method: 'GET', path: Endpoints['KIS-264'].path, tr_id: Endpoints['KIS-264'].tr_id,
    query: { FID_COND_MRKT_DIV_CODE: q.request.market_code, FID_INPUT_ISCD: q.request.instrument_code,
      FID_INPUT_DATE_1: q.request.start_date.replaceAll('-', ''), FID_INPUT_DATE_2: q.request.end_date.replaceAll('-', ''), FID_PERIOD_DIV_CODE: q.request.period_code } };
  freeze(request); let response: unknown;
  try { response = await Reflect.apply(hook.send, transport, [request]); } catch { fail('upstream_unavailable'); }
  return safe(() => {
    // Snapshot is byte bounded before schema parsing; this is a local decoded response budget, not provider row count evidence.
    const r = parsed(Response, response, BENCHMARK_PERIOD_LIMITS.body_bytes + 2048);
    status(r.http_status); let clockValue: unknown;
    try { clockValue = clock(); } catch { fail('invalid_input'); }
    const received = parsed(Instant, clockValue, 1024); need(compareInstant(received, q.cutoff) <= 0, 'future_receipt');
    const body = original(r.body_text);
    return normalize('KIS-264', { request: q.request, cutoff: q.cutoff, capture: { origin: hook.origin, received_at: received,
      expected_body_sha256: body.hash, http_status: r.http_status, tr_cont: r.tr_cont } }, r.body_text);
  });
}
export function createBenchmarkPeriodAdapter(transport?: BenchmarkPeriodTransport, clock?: BenchmarkPeriodClock) {
  return Object.freeze({ requestKis072: (input: unknown) => requestKis072Period(input, transport, clock),
    requestKis264: (input: unknown) => requestKis264Period(input, transport, clock) });
}

/** Strict metadata JSON decode. No Number rounding, duplicate keys, protected keys or implicit coercion. */
function metadataText(text: unknown, limit: number, nodes: number): unknown {
  need(typeof text === 'string', 'invalid_body_text'); need(text.length <= limit, 'input_too_large');
  need(wellFormed(text), 'invalid_body_text'); need(Buffer.byteLength(text, 'utf8') <= limit, 'input_too_large');
  return parseOriginal(text, true, nodes);
}
export function normalizeBenchmarkPeriodFromText(op: BenchmarkPeriodOperation, inputText: unknown, originalBodyText: unknown): DeepReadonly<BenchmarkPeriodResult> {
  return safe(() => { need(op === 'KIS-072' || op === 'KIS-264', 'invalid_input');
    return normalize(op, metadataText(inputText, BENCHMARK_PERIOD_LIMITS.input_bytes, BENCHMARK_PERIOD_LIMITS.nodes), originalBodyText); });
}
export function verifyBenchmarkPeriodEvidenceFromText(op: BenchmarkPeriodOperation, persistedText: unknown, independentInputText: unknown, originalBodyText: unknown): DeepReadonly<BenchmarkPeriodResult> {
  return safe(() => verifyBenchmarkPeriodEvidence(op,
    metadataText(persistedText, BENCHMARK_PERIOD_LIMITS.persisted_bytes, BENCHMARK_PERIOD_LIMITS.persisted_nodes),
    metadataText(independentInputText, BENCHMARK_PERIOD_LIMITS.input_bytes, BENCHMARK_PERIOD_LIMITS.nodes), originalBodyText));
}

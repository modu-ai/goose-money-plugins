import { z } from 'zod';
import { types } from 'node:util';
import { ExactInstantSchema, compareInstants } from './exact-instant.js';
import { boundedBody, GlobalMarketError } from './global-market-data.js';

/** RC7 candidate: exactly one injected, read-only provider page; never a network fallback. */
export const KR_HISTORICAL_INTRADAY_MAX_RESPONSE_BYTES = 300_000;
export const KR_HISTORICAL_INTRADAY_MAX_ROWS = 120;
export const KR_HISTORICAL_INTRADAY_SOURCE_COMMIT = '2077773a69a428daf63e148182511f068cc45de3';
const Origin = z.enum(['actual', 'synthetic']);
// Conservative six-digit request subset; not a master-verified stock/ETF identity.
const SymbolCode = z.string().regex(/^\d{6}$/);
const Board = z.enum(['J', 'NX', 'UN']);
const Decimal = z.string().max(40).regex(/^-?\d+(?:\.\d+)?$/);
const Integer = z.string().max(30).regex(/^\d+$/);
const BlankDecimal = z.union([Decimal, z.literal('')]);
const BlankInteger = z.union([Integer, z.literal('')]);
const DateLabel = z.string().regex(/^\d{8}$/).refine(value => {
  const y = Number(value.slice(0, 4)), m = Number(value.slice(4, 6)), d = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}, 'invalid_calendar_date');
const TimeLabel = z.string().regex(/^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/);
const Continuation = z.enum(['', 'D', 'E', 'M', 'F']).nullable();

export const KrHistoricalIntradayInputSchema = z.object({
  symbol: SymbolCode, board: Board, anchor_date: DateLabel, anchor_time: TimeLabel,
  // The official helper defaults to N but the official backtester sends Y. No implicit choice.
  include_past_data: z.enum(['Y', 'N']),
}).strict();
export const KrHistoricalIntradayRequestSchema = z.object({
  operation: z.literal('kis.kr_historical_intraday'), method: z.literal('GET'),
  path: z.literal('/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice'),
  tr_id: z.literal('FHKST03010230'), tr_cont: z.literal(''),
  query: z.object({
    FID_COND_MRKT_DIV_CODE: Board, FID_INPUT_ISCD: SymbolCode,
    FID_INPUT_DATE_1: DateLabel, FID_INPUT_HOUR_1: TimeLabel,
    FID_PW_DATA_INCU_YN: z.enum(['Y', 'N']), FID_FAKE_TICK_INCU_YN: z.literal(''),
  }).strict(),
}).strict();
export type KrHistoricalIntradayInput = z.infer<typeof KrHistoricalIntradayInputSchema>;
export type KrHistoricalIntradayRequest = z.infer<typeof KrHistoricalIntradayRequestSchema>;
export interface KrHistoricalIntradayResponse { status: number; tr_cont: string | null; body: unknown }
export interface KrHistoricalIntradayTransport {
  readonly origin: 'actual' | 'synthetic';
  /** Future network implementations must bound bytes during receipt, before JSON decoding. */
  send(request: KrHistoricalIntradayRequest): Promise<KrHistoricalIntradayResponse>;
}
export type KrHistoricalIntradayClock = () => string;
export type KrHistoricalIntradayErrorCode = 'invalid_input' | 'transport_not_configured' | 'upstream_unavailable' |
  'rate_limited' | 'auth_expired' | 'upstream_rejected' | 'schema_drift' | 'response_too_large';
export class KrHistoricalIntradayError extends Error {
  constructor(readonly code: KrHistoricalIntradayErrorCode) { super(code); this.name = 'KrHistoricalIntradayError'; }
}

/** Field names from the pinned official check script; original decimal strings remain untouched. */
export const KrHistoricalIntradayHeaderRawSchema = z.object({
  prdy_vrss: BlankDecimal.optional(), prdy_vrss_sign: z.string().max(8).optional(),
  prdy_ctrt: BlankDecimal.optional(), stck_prdy_clpr: BlankDecimal.optional(),
  acml_vol: BlankInteger.optional(), acml_tr_pbmn: BlankDecimal.optional(),
  hts_kor_isnm: z.string().max(200).optional(), stck_prpr: BlankDecimal,
}).strict();
export const KrHistoricalIntradayBarRawSchema = z.object({
  stck_bsop_date: z.union([DateLabel, z.literal('')]),
  stck_cntg_hour: z.union([TimeLabel, z.literal('')]),
  stck_prpr: BlankDecimal, stck_oprc: BlankDecimal, stck_hgpr: BlankDecimal, stck_lwpr: BlankDecimal,
  cntg_vol: BlankInteger, acml_tr_pbmn: BlankDecimal.optional(),
}).strict();
export const KrHistoricalIntradayRawSchema = z.object({
  rt_cd: z.literal('0'), msg_cd: z.string().max(40).optional(), msg1: z.string().max(2000).optional(),
  output1: KrHistoricalIntradayHeaderRawSchema,
  output2: z.array(KrHistoricalIntradayBarRawSchema).max(KR_HISTORICAL_INTRADAY_MAX_ROWS),
}).strict();
const Canonical = z.object({
  instrument_id: z.null(), asset_class: z.null(), exchange: z.null(), currency: z.null(),
  adjusted: z.null(), timezone: z.null(), finality: z.null(),
  price_unit: z.null(), volume_unit: z.null(), turnover_unit: z.null(), bars: z.null(),
}).strict();
const Pagination = z.object({
  pages_fetched: z.literal(1), tr_cont: Continuation,
  status: z.enum(['more_signaled_not_fetched', 'not_signaled_completeness_unknown']),
  automatic_continuation: z.literal(false), completeness: z.literal('unknown'),
}).strict();
type RawBar = z.infer<typeof KrHistoricalIntradayBarRawSchema>;
function observedLabels(rows: RawBar[]) {
  // Missing labels are retained, not invented, and are not evidence of duplicate instants.
  return rows.filter(row => row.stck_bsop_date !== '' && row.stck_cntg_hour !== '')
    .map(row => row.stck_bsop_date + row.stck_cntg_hour);
}
function moreSignaled(value: z.infer<typeof Continuation>) { return value === 'M' || value === 'F'; }
export const KrHistoricalIntradayResultSchema = z.object({
  contract: z.literal('moai.stock.kr-historical-intraday.v1'),
  provider: z.literal('kis'), origin: Origin,
  source_commit: z.literal(KR_HISTORICAL_INTRADAY_SOURCE_COMMIT),
  requested: KrHistoricalIntradayInputSchema, interval: z.literal('provider_minute_bars'),
  scope: z.literal('historical_date_endpoint_single_page'),
  identity_status: z.literal('no_returned_instrument_code'),
  received_at: ExactInstantSchema, available_at: ExactInstantSchema,
  source_as_of: z.null(), event_time: z.null(), published_at: z.null(), source_timezone: z.null(),
  source_time_status: z.literal('provider_bar_labels_not_verified_instants'),
  anchor_context_status: z.literal('request_anchor_not_verified_against_source_labels'),
  fake_tick_status: z.literal('blank_request_flag_semantics_not_verified'),
  adjustment_status: z.literal('not_specified_by_reviewed_intraday_contract'),
  rights_status: z.literal('pending'), session: z.literal('unknown'), delay_state: z.literal('unknown'),
  finality: z.literal('unknown'), freshness: z.literal('unknown'), completeness: z.literal('unknown'),
  validation_status: z.literal('provider_shape_checked_not_live_reconciled'),
  pagination: Pagination, bars_returned: z.number().int().min(0).max(KR_HISTORICAL_INTRADAY_MAX_ROWS),
  coverage_status: z.enum(['empty_page_not_proof_of_absence', 'single_page_not_complete_history']),
  row_order_status: z.literal('provider_order_preserved_no_sort_dedup_or_resample'),
  duplicate_label_status: z.enum(['duplicate_labels_retained', 'none_observed']),
  blank_label_status: z.enum(['blank_labels_retained', 'all_labels_present']),
  canonical_projection_status: z.literal('blocked'), canonical: Canonical,
  mapping_blockers: z.array(z.string().min(1).max(200)).min(1).max(20),
  unimplemented_derivations: z.array(z.string().min(1).max(100)).min(1).max(20),
  warnings: z.array(z.string().min(1).max(500)).min(1).max(20),
  raw: KrHistoricalIntradayRawSchema,
}).strict().superRefine((result, ctx) => {
  if (ExactInstantSchema.safeParse(result.received_at).success && ExactInstantSchema.safeParse(result.available_at).success &&
      compareInstants(result.received_at, result.available_at) !== 0) ctx.addIssue({ code: 'custom', message: 'availability_receipt_mismatch' });
  const rows = result.raw.output2, labels = observedLabels(rows);
  if (result.pagination.status !== (moreSignaled(result.pagination.tr_cont) ? 'more_signaled_not_fetched' : 'not_signaled_completeness_unknown')) ctx.addIssue({ code: 'custom', message: 'pagination_provenance_mismatch' });
  if (result.bars_returned !== rows.length || result.coverage_status !== (rows.length ? 'single_page_not_complete_history' : 'empty_page_not_proof_of_absence')) ctx.addIssue({ code: 'custom', message: 'bar_count_or_coverage_mismatch' });
  if (result.duplicate_label_status !== (new Set(labels).size !== labels.length ? 'duplicate_labels_retained' : 'none_observed')) ctx.addIssue({ code: 'custom', message: 'duplicate_status_mismatch' });
  if (result.blank_label_status !== (labels.length !== rows.length ? 'blank_labels_retained' : 'all_labels_present')) ctx.addIssue({ code: 'custom', message: 'blank_label_status_mismatch' });
  // Do not silently clip mixed dates, constrain anchor inclusivity, or manufacture a timezone.
});
export type KrHistoricalIntradayResult = z.infer<typeof KrHistoricalIntradayResultSchema>;

/** Descriptor-only copy rejects proxies before traps and accessors before evaluation.
 * Existing boundedBody then enforces serialized-byte, depth, node and collection limits on the inert copy.
 */
function snapshotBoundary(value: unknown, maxBytes: number, maxNodes: number, maxKeys: number): unknown {
  let nodes = 0, bytes = 0;
  const seen = new Set<object>();
  function copy(v: unknown, depth: number): unknown {
    if (++nodes > maxNodes || depth > 8) throw new GlobalMarketError('response_too_large');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') { bytes += Buffer.byteLength(v, 'utf8'); if (bytes > maxBytes) throw new GlobalMarketError('response_too_large'); return v; }
    if (typeof v !== 'object' || types.isProxy(v) || seen.has(v)) throw new GlobalMarketError('schema_drift');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype && proto !== null : proto !== Object.prototype && proto !== null) throw new GlobalMarketError('schema_drift');
    const length: unknown = array ? Object.getOwnPropertyDescriptor(v, 'length')?.value : null;
    if (array && (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0)) throw new GlobalMarketError('schema_drift');
    if (array && (length as number) > maxKeys) throw new GlobalMarketError('response_too_large');
    const keys = Reflect.ownKeys(v);
    if (keys.length > maxKeys) throw new GlobalMarketError('response_too_large');
    if (array && keys.length !== (length as number) + 1) throw new GlobalMarketError('schema_drift');
    const out: Record<string, unknown> | unknown[] = array ? [] : Object.create(null) as Record<string, unknown>;
    seen.add(v);
    for (const key of keys) {
      if (typeof key !== 'string') throw new GlobalMarketError('schema_drift');
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !('value' in d)) throw new GlobalMarketError('schema_drift');
      if (array && key === 'length') continue;
      if (!d.enumerable || (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= (length as number)))) throw new GlobalMarketError('schema_drift');
      bytes += Buffer.byteLength(key, 'utf8'); if (bytes > maxBytes) throw new GlobalMarketError('response_too_large');
      Object.defineProperty(out, key, { value: copy(d.value, depth + 1), writable: true, configurable: true, enumerable: true });
    }
    seen.delete(v); return out;
  }
  return boundedBody(copy(value, 0), { maxBytes, maxNodes, maxKeys });
}
function parseInput(value: unknown): KrHistoricalIntradayInput {
  try {
    const parsed = KrHistoricalIntradayInputSchema.safeParse(snapshotBoundary(value, 2000, 30, 20));
    if (parsed.success) return parsed.data;
  } catch { /* Untrusted input errors are intentionally redacted. */ }
  throw new KrHistoricalIntradayError('invalid_input');
}
const Response = z.object({ status: z.number().int().min(100).max(599), tr_cont: Continuation, body: z.unknown() }).strict();
const Envelope = z.object({ rt_cd: z.string().max(10), msg_cd: z.string().max(40).optional(), msg1: z.string().max(2000).optional(), output1: z.unknown().optional(), output2: z.unknown().optional() }).strict();
function result<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new KrHistoricalIntradayError('schema_drift');
}
async function readPage(request: KrHistoricalIntradayRequest, transport: KrHistoricalIntradayTransport | undefined, clock: KrHistoricalIntradayClock) {
  if (!transport) throw new KrHistoricalIntradayError('transport_not_configured');
  const origin = Origin.safeParse(transport.origin);
  if (!origin.success || typeof transport.send !== 'function' || typeof clock !== 'function') throw new KrHistoricalIntradayError('invalid_input');
  const safe = KrHistoricalIntradayRequestSchema.parse(request);
  Object.freeze(safe.query); Object.freeze(safe);
  let response: unknown;
  try { response = await transport.send(safe); } catch { throw new KrHistoricalIntradayError('upstream_unavailable'); }
  let receipt: unknown;
  try { receipt = clock(); } catch { throw new KrHistoricalIntradayError('invalid_input'); }
  const received = ExactInstantSchema.safeParse(receipt);
  if (!received.success) throw new KrHistoricalIntradayError('invalid_input');
  let snapshot: unknown;
  try { snapshot = snapshotBoundary(response, KR_HISTORICAL_INTRADAY_MAX_RESPONSE_BYTES, 10000, 1000); }
  catch (e) { throw new KrHistoricalIntradayError(e instanceof GlobalMarketError && e.code === 'response_too_large' ? 'response_too_large' : 'schema_drift'); }
  const r = result(Response, snapshot);
  if (r.status === 429) throw new KrHistoricalIntradayError('rate_limited');
  if (r.status === 401 || r.status === 403) throw new KrHistoricalIntradayError('auth_expired');
  if (r.status < 200 || r.status >= 300) throw new KrHistoricalIntradayError('upstream_unavailable');
  const envelope = result(Envelope, r.body);
  if (envelope.rt_cd !== '0') throw new KrHistoricalIntradayError('upstream_rejected');
  return { body: envelope, origin: origin.data, received_at: received.data, tr_cont: r.tr_cont };
}
const defaultClock: KrHistoricalIntradayClock = () => new Date().toISOString();
export async function requestKrHistoricalIntraday(value: unknown, transport?: KrHistoricalIntradayTransport, clock: KrHistoricalIntradayClock = defaultClock): Promise<KrHistoricalIntradayResult> {
  const q = parseInput(value);
  const page = await readPage({ operation: 'kis.kr_historical_intraday', method: 'GET', path: '/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice', tr_id: 'FHKST03010230', tr_cont: '',
    query: { FID_COND_MRKT_DIV_CODE: q.board, FID_INPUT_ISCD: q.symbol, FID_INPUT_DATE_1: q.anchor_date,
      FID_INPUT_HOUR_1: q.anchor_time, FID_PW_DATA_INCU_YN: q.include_past_data, FID_FAKE_TICK_INCU_YN: '' } }, transport, clock);
  const raw = result(KrHistoricalIntradayRawSchema, page.body), labels = observedLabels(raw.output2);
  return result(KrHistoricalIntradayResultSchema, {
    contract: 'moai.stock.kr-historical-intraday.v1', provider: 'kis', origin: page.origin,
    source_commit: KR_HISTORICAL_INTRADAY_SOURCE_COMMIT, requested: q, interval: 'provider_minute_bars',
    scope: 'historical_date_endpoint_single_page', identity_status: 'no_returned_instrument_code',
    received_at: page.received_at, available_at: page.received_at,
    source_as_of: null, event_time: null, published_at: null, source_timezone: null,
    source_time_status: 'provider_bar_labels_not_verified_instants',
    anchor_context_status: 'request_anchor_not_verified_against_source_labels',
    fake_tick_status: 'blank_request_flag_semantics_not_verified',
    adjustment_status: 'not_specified_by_reviewed_intraday_contract',
    rights_status: 'pending', session: 'unknown', delay_state: 'unknown', finality: 'unknown', freshness: 'unknown', completeness: 'unknown',
    validation_status: 'provider_shape_checked_not_live_reconciled',
    pagination: { pages_fetched: 1, tr_cont: page.tr_cont, status: moreSignaled(page.tr_cont) ? 'more_signaled_not_fetched' : 'not_signaled_completeness_unknown', automatic_continuation: false, completeness: 'unknown' },
    bars_returned: raw.output2.length,
    coverage_status: raw.output2.length ? 'single_page_not_complete_history' : 'empty_page_not_proof_of_absence',
    row_order_status: 'provider_order_preserved_no_sort_dedup_or_resample',
    duplicate_label_status: new Set(labels).size !== labels.length ? 'duplicate_labels_retained' : 'none_observed',
    blank_label_status: labels.length !== raw.output2.length ? 'blank_labels_retained' : 'all_labels_present',
    canonical_projection_status: 'blocked',
    canonical: { instrument_id: null, asset_class: null, exchange: null, currency: null, adjusted: null, timezone: null, finality: null,
      price_unit: null, volume_unit: null, turnover_unit: null, bars: null },
    mapping_blockers: ['authoritative_instrument_and_board_binding_missing', 'currency_and_price_quantity_units_not_reconciled',
      'timezone_bar_alignment_finality_and_anchor_semantics_not_reconciled', 'adjustment_and_fake_tick_semantics_not_verified', 'market_data_rights_pending'],
    unimplemented_derivations: ['automatic_pagination', 'canonical_ohlcv', 'corporate_action_adjustment', 'resampling', 'source_timestamp_attribution'],
    warnings: ['Exactly one provider page is preserved in original order, including duplicates and blanks; it is not a complete session or history.',
      'The official source describes up to 120 rows and up to one year of stored minute data. Actual retention and coverage were not tested; empty data does not prove absence.',
      'Request anchor and provider business-date/time labels are not verified instants. Receipt time is sampled only after transport completion.',
      'The official helper defaults include-past to N; its backtester supplies Y. The caller must choose explicitly. Blank fake-tick flag is preserved, not interpreted as exclusion.',
      'No returned instrument code proves identity. Name, request board and request symbol are not a master binding; all canonical OHLCV, units, currency, adjustment and finality remain null.',
      'Mixed-date labels and blank labels remain raw. No row filtering, sorting, deduplication, reanchoring, UTC conversion, turnover differencing or bar-close inference occurs.'],
    raw,
  });
}

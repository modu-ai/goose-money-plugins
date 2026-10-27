import { z } from 'zod';
import { types } from 'node:util';
import { ExactInstantSchema, compareInstants } from './exact-instant.js';
import { boundedBody, GlobalMarketError } from './global-market-data.js';
import { sanitizedKisError } from './kis-sanitized-error.js';

/** RC6 additive, read-only research readers. No network, credentials, accounts or orders. */
export const FUTURES_HISTORY_MAX_RESPONSE_BYTES = 300_000;
export const KR_FUTURES_DAILY_MAX_ROWS = 100;
export const KR_FUTURES_MINUTE_MAX_ROWS = 102;
export const OVERSEAS_FUTURES_DAILY_MAX_ROWS = 40;
export const OVERSEAS_FUTURES_MINUTE_MAX_ROWS = 120; // Fixed reviewed example/local cap, not a verified provider maximum.
export const FUTURES_HISTORY_SOURCE_COMMIT = '2077773a69a428daf63e148182511f068cc45de3';
const Origin = z.enum(['actual', 'synthetic']);
// Local conservative outright-series policy, not proof of a master/listing identity.
const KrSymbol = z.string().regex(/^(?:1[0-9A-Z]{3}|A0[0-9A-Z]{2})(?:0[1-9]|1[0-2])$/);
const OverseasSymbol = z.string().max(13).regex(/^[A-Z0-9]{1,10}[FGHJKMNQUVXZ]\d{2}$/);
const Exchange = z.string().min(1).max(8).regex(/^[A-Z0-9]+$/);
const Decimal = z.string().max(40).regex(/^-?\d+(?:\.\d+)?$/);
const Integer = z.string().max(30).regex(/^\d+$/);
const SignedInteger = z.string().max(30).regex(/^-?\d+$/);
const BlankDecimal = z.union([Decimal, z.literal('')]);
const BlankInteger = z.union([Integer, z.literal('')]);
const Text = z.string().max(200);
const DateLabel = z.string().regex(/^\d{8}$/).refine(value => {
  const y = Number(value.slice(0, 4)), m = Number(value.slice(4, 6)), d = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}, 'invalid_calendar_date');
const TimeLabel = z.string().regex(/^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/);
const Continuation = z.enum(['', 'D', 'E', 'M', 'F']).nullable();
const Count40 = z.string().regex(/^(?:[1-9]|[1-3][0-9]|40)$/);

export const KrFuturesDailyHistoryInputSchema = z.object({
  symbol: KrSymbol, start_date: DateLabel, end_date: DateLabel,
  period: z.literal('D'),
}).strict().refine(q => q.start_date <= q.end_date, 'reversed_date_range');
export const KrFuturesMinuteHistoryInputSchema = z.object({
  symbol: KrSymbol, anchor_date: DateLabel, anchor_time: TimeLabel,
  interval_seconds: z.literal('60'), include_past_data: z.enum(['Y', 'N']),
}).strict();
export const OverseasFuturesDailyHistoryInputSchema = z.object({
  symbol: OverseasSymbol, exchange: Exchange, end_date: DateLabel,
  count: Count40, period: z.literal('D'),
}).strict();
/** First page only: documented blank start date, explicit end date, fixed reviewed example count. */
export const OverseasFuturesMinuteHistoryInputSchema = z.object({
  symbol: OverseasSymbol, exchange: Exchange, end_date: DateLabel,
  count: z.literal('120'), interval_minutes: z.enum(['1', '5', '10', '15', '30', '60']),
}).strict();
export type KrFuturesDailyHistoryInput = z.infer<typeof KrFuturesDailyHistoryInputSchema>;
export type KrFuturesMinuteHistoryInput = z.infer<typeof KrFuturesMinuteHistoryInputSchema>;
export type OverseasFuturesDailyHistoryInput = z.infer<typeof OverseasFuturesDailyHistoryInputSchema>;

export const KrFuturesDailyHistoryRequestSchema = z.object({
  operation: z.literal('kis.kr_futures_daily_history'), method: z.literal('GET'),
  path: z.literal('/uapi/domestic-futureoption/v1/quotations/inquire-daily-fuopchartprice'),
  tr_id: z.literal('FHKIF03020100'), tr_cont: z.literal(''),
  query: z.object({ FID_COND_MRKT_DIV_CODE: z.literal('F'), FID_INPUT_ISCD: KrSymbol,
    FID_INPUT_DATE_1: DateLabel, FID_INPUT_DATE_2: DateLabel, FID_PERIOD_DIV_CODE: z.literal('D') }).strict(),
}).strict();
export const KrFuturesMinuteHistoryRequestSchema = z.object({
  operation: z.literal('kis.kr_futures_minute_history'), method: z.literal('GET'),
  path: z.literal('/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice'),
  tr_id: z.literal('FHKIF03020200'), tr_cont: z.literal(''),
  query: z.object({ FID_COND_MRKT_DIV_CODE: z.literal('F'), FID_INPUT_ISCD: KrSymbol,
    FID_HOUR_CLS_CODE: z.literal('60'), FID_PW_DATA_INCU_YN: z.enum(['Y', 'N']),
    FID_FAKE_TICK_INCU_YN: z.literal('N'), FID_INPUT_DATE_1: DateLabel, FID_INPUT_HOUR_1: TimeLabel }).strict(),
}).strict();
export const OverseasFuturesDailyHistoryRequestSchema = z.object({
  operation: z.literal('kis.overseas_futures_daily_history'), method: z.literal('GET'),
  path: z.literal('/uapi/overseas-futureoption/v1/quotations/daily-ccnl'),
  tr_id: z.literal('HHDFC55020100'), tr_cont: z.literal(''),
  query: z.object({ SRS_CD: OverseasSymbol, EXCH_CD: Exchange, START_DATE_TIME: z.literal(''),
    CLOSE_DATE_TIME: DateLabel, QRY_TP: z.literal('Q'), QRY_CNT: Count40,
    QRY_GAP: z.literal(''), INDEX_KEY: z.literal('') }).strict(),
}).strict();
export const OverseasFuturesMinuteHistoryRequestSchema = z.object({
  operation: z.literal('kis.overseas_futures_minute_history'), method: z.literal('GET'),
  path: z.literal('/uapi/overseas-futureoption/v1/quotations/inquire-time-futurechartprice'),
  tr_id: z.literal('HHDFC55020400'), tr_cont: z.literal(''),
  query: z.object({ SRS_CD: OverseasSymbol, EXCH_CD: Exchange, START_DATE_TIME: z.literal(''),
    CLOSE_DATE_TIME: DateLabel, QRY_TP: z.literal('Q'), QRY_CNT: z.literal('120'),
    QRY_GAP: z.enum(['1', '5', '10', '15', '30', '60']), INDEX_KEY: z.literal('') }).strict(),
}).strict();
export const FuturesHistoryRequestSchema = z.discriminatedUnion('operation', [
  KrFuturesDailyHistoryRequestSchema, KrFuturesMinuteHistoryRequestSchema, OverseasFuturesDailyHistoryRequestSchema, OverseasFuturesMinuteHistoryRequestSchema,
]);
export type FuturesHistoryRequest = z.infer<typeof FuturesHistoryRequestSchema>;
export interface FuturesHistoryResponse { status: number; tr_cont: string | null; body: unknown }
export interface FuturesHistoryTransport {
  readonly origin: 'actual' | 'synthetic';
  /** A future network implementation must bound bytes DURING receipt, not only after decoding. */
  send(request: FuturesHistoryRequest): Promise<FuturesHistoryResponse>;
}
export type FuturesHistoryClock = () => string;
export type FuturesHistoryErrorCode = 'invalid_input' | 'transport_not_configured' | 'upstream_unavailable' |
  'rate_limited' | 'auth_expired' | 'upstream_rejected' | 'schema_drift' | 'response_too_large' |
  'instrument_mismatch' | 'bar_context_mismatch' | 'source_contract_conflict';
export class FuturesHistoryError extends Error {
  constructor(readonly code: FuturesHistoryErrorCode) { super(code); this.name = 'FuturesHistoryError'; }
}

/** Field names from the pinned official check scripts; every accepted lexeme survives unchanged. */
export const KrFuturesHistoryHeaderRawSchema = z.object({
  futs_shrn_iscd: KrSymbol, hts_kor_isnm: Text.optional(),
  futs_prdy_vrss: BlankDecimal.optional(), prdy_vrss_sign: z.string().max(8).optional(),
  futs_prdy_ctrt: BlankDecimal.optional(), futs_prdy_clpr: BlankDecimal.optional(),
  acml_vol: BlankInteger.optional(), acml_tr_pbmn: BlankDecimal.optional(),
  futs_prpr: BlankDecimal.optional(), prdy_vol: BlankInteger.optional(),
  futs_mxpr: BlankDecimal.optional(), futs_llam: BlankDecimal.optional(),
  futs_oprc: BlankDecimal.optional(), futs_hgpr: BlankDecimal.optional(), futs_lwpr: BlankDecimal.optional(),
  futs_prdy_oprc: BlankDecimal.optional(), futs_prdy_hgpr: BlankDecimal.optional(), futs_prdy_lwpr: BlankDecimal.optional(),
  futs_askp: BlankDecimal.optional(), futs_bidp: BlankDecimal.optional(), basis: BlankDecimal.optional(),
  kospi200_nmix: BlankDecimal.optional(), kospi200_prdy_vrss: BlankDecimal.optional(),
  kospi200_prdy_ctrt: BlankDecimal.optional(), kospi200_prdy_vrss_sign: z.string().max(8).optional(),
  hts_otst_stpl_qty: BlankInteger.optional(), otst_stpl_qty_icdc: z.union([SignedInteger, z.literal('')]).optional(),
  tday_rltv: BlankDecimal.optional(), hts_thpr: BlankDecimal.optional(), dprt: BlankDecimal.optional(),
}).strict();
const BarPrices = { futs_prpr: BlankDecimal, futs_oprc: BlankDecimal, futs_hgpr: BlankDecimal, futs_lwpr: BlankDecimal };
export const KrFuturesDailyHistoryBarRawSchema = z.object({
  stck_bsop_date: DateLabel, ...BarPrices, acml_vol: BlankInteger,
  acml_tr_pbmn: BlankDecimal.optional(), mod_yn: z.string().max(8).optional(),
}).strict();
export const KrFuturesMinuteHistoryBarRawSchema = z.object({
  stck_bsop_date: DateLabel, stck_cntg_hour: TimeLabel, ...BarPrices,
  cntg_vol: BlankInteger, acml_tr_pbmn: BlankDecimal.optional(),
}).strict();
const RawEnvelope = { rt_cd: z.literal('0'), msg_cd: z.string().max(40).optional(), msg1: z.string().max(2000).optional() };
export const KrFuturesDailyHistoryRawSchema = z.object({ ...RawEnvelope,
  output1: KrFuturesHistoryHeaderRawSchema,
  output2: z.array(KrFuturesDailyHistoryBarRawSchema).max(KR_FUTURES_DAILY_MAX_ROWS),
}).strict();
export const KrFuturesMinuteHistoryRawSchema = z.object({ ...RawEnvelope,
  output1: KrFuturesHistoryHeaderRawSchema.extend({ prdy_nmix: BlankDecimal.optional() }),
  output2: z.array(KrFuturesMinuteHistoryBarRawSchema).max(KR_FUTURES_MINUTE_MAX_ROWS),
}).strict();
export const OverseasFuturesDailyHistoryHeaderRawSchema = z.object({
  // Official daily check script spells this tret_cnt; never silently alias ret_cnt.
  tret_cnt: BlankInteger.optional(), last_n_cnt: BlankInteger.optional(), index_key: z.string().max(200),
}).strict();
export const OverseasFuturesDailyHistoryBarRawSchema = z.object({
  data_date: DateLabel, data_time: z.union([TimeLabel, z.literal('')]),
  open_price: BlankDecimal, high_price: BlankDecimal, low_price: BlankDecimal, last_price: BlankDecimal,
  last_qntt: BlankInteger.optional(), vol: BlankInteger,
  prev_diff_flag: z.string().max(8).optional(), prev_diff_price: BlankDecimal.optional(), prev_diff_rate: BlankDecimal.optional(),
}).strict();
export const OverseasFuturesDailyHistoryRawSchema = z.object({ ...RawEnvelope,
  output1: z.union([OverseasFuturesDailyHistoryHeaderRawSchema, z.tuple([OverseasFuturesDailyHistoryHeaderRawSchema])]),
  output2: z.union([z.array(OverseasFuturesDailyHistoryBarRawSchema).max(OVERSEAS_FUTURES_DAILY_MAX_ROWS), OverseasFuturesDailyHistoryBarRawSchema]),
}).strict();

export const OverseasFuturesMinuteHistoryHeaderRawSchema = z.object({
  // The minute check script uses ret_cnt, distinct from daily tret_cnt.
  ret_cnt: BlankInteger.optional(), last_n_cnt: BlankInteger.optional(), index_key: z.string().max(200),
}).strict();
export const OverseasFuturesMinuteHistoryRawSchema = z.object({ ...RawEnvelope,
  output1: z.union([OverseasFuturesMinuteHistoryHeaderRawSchema, z.tuple([OverseasFuturesMinuteHistoryHeaderRawSchema])]),
  output2: z.union([z.array(OverseasFuturesDailyHistoryBarRawSchema).max(OVERSEAS_FUTURES_MINUTE_MAX_ROWS), OverseasFuturesDailyHistoryBarRawSchema]),
}).strict();
type OverseasRaw = z.infer<typeof OverseasFuturesDailyHistoryRawSchema> | z.infer<typeof OverseasFuturesMinuteHistoryRawSchema>;
const overseasHeader = (raw: OverseasRaw) => Array.isArray(raw.output1) ? raw.output1[0] : raw.output1;
const overseasRows = (raw: OverseasRaw) => Array.isArray(raw.output2) ? raw.output2 : [raw.output2];
const Pagination = z.object({
  pages_fetched: z.literal(1), tr_cont: Continuation,
  provider_cursor: z.string().max(200).nullable(),
  status: z.enum(['more_signaled_not_fetched', 'not_signaled_completeness_unknown']),
  automatic_continuation: z.literal(false), completeness: z.literal('unknown'),
}).strict();
const Canonical = z.object({
  instrument_id: z.null(), underlying_id: z.null(), exchange: z.null(), country: z.null(), currency: z.null(),
  adjusted: z.null(), contract_multiplier: z.null(), expiry_date: z.null(), last_trading_date: z.null(),
  tick_size: z.null(), tick_value: z.null(), price_unit: z.null(), volume_unit: z.null(), turnover_unit: z.null(), bars: z.null(),
}).strict();
const CommonResult = {
  provider: z.literal('kis'), origin: Origin, source_commit: z.literal(FUTURES_HISTORY_SOURCE_COMMIT),
  received_at: ExactInstantSchema, available_at: ExactInstantSchema,
  source_as_of: z.null(), event_time: z.null(), published_at: z.null(), source_timezone: z.null(),
  source_time_status: z.literal('provider_bar_labels_not_verified_instants'),
  rights_status: z.literal('pending'), session: z.literal('unknown'), delay_state: z.literal('unknown'),
  finality: z.literal('unknown'), freshness: z.literal('unknown'), completeness: z.literal('unknown'),
  validation_status: z.literal('provider_shape_checked_not_live_reconciled'),
  adjustment_status: z.literal('not_verified_no_roll_or_adjustment_inferred'),
  pagination: Pagination, bars_returned: z.number().int().min(0).max(OVERSEAS_FUTURES_MINUTE_MAX_ROWS),
  coverage_status: z.enum(['empty_page_not_proof_of_absence', 'single_page_not_complete_history']),
  row_order_status: z.literal('provider_order_preserved_no_sort_dedup_or_resample'),
  duplicate_label_status: z.enum(['duplicate_labels_retained', 'none_observed']),
  canonical_projection_status: z.literal('blocked'), canonical: Canonical,
  mapping_blockers: z.array(z.string().min(1).max(200)).min(1).max(20),
  unimplemented_derivations: z.array(z.string().min(1).max(100)).min(1).max(20),
  warnings: z.array(z.string().min(1).max(500)).min(1).max(20),
};
type Metadata = { received_at: string; available_at: string; bars_returned: number; coverage_status: string;
  duplicate_label_status: string; pagination: z.infer<typeof Pagination> };
function checkMetadata(result: Metadata, labels: string[], cursor: string | null, ctx: z.RefinementCtx) {
  if (ExactInstantSchema.safeParse(result.received_at).success && ExactInstantSchema.safeParse(result.available_at).success &&
      compareInstants(result.received_at, result.available_at) !== 0) ctx.addIssue({ code: 'custom', message: 'availability_receipt_mismatch' });
  const more = result.pagination.tr_cont === 'M' || result.pagination.tr_cont === 'F' || (cursor !== null && cursor !== '');
  if (result.pagination.provider_cursor !== cursor || result.pagination.status !== (more ? 'more_signaled_not_fetched' : 'not_signaled_completeness_unknown')) ctx.addIssue({ code: 'custom', message: 'pagination_provenance_mismatch' });
  if (result.bars_returned !== labels.length || result.coverage_status !== (labels.length ? 'single_page_not_complete_history' : 'empty_page_not_proof_of_absence')) ctx.addIssue({ code: 'custom', message: 'bar_count_or_coverage_mismatch' });
  if (result.duplicate_label_status !== (new Set(labels).size !== labels.length ? 'duplicate_labels_retained' : 'none_observed')) ctx.addIssue({ code: 'custom', message: 'duplicate_status_mismatch' });
}
export const KrFuturesDailyHistoryResultSchema = z.object({
  contract: z.literal('moai.stock.kr-futures-daily-history.v1'), ...CommonResult,
  requested: KrFuturesDailyHistoryInputSchema, interval: z.literal('1d'),
  identity_status: z.literal('returned_short_code_matched_not_master_verified'),
  geographical_scope_status: z.literal('domestic_index_futures_request_not_master_verified'),
  raw: KrFuturesDailyHistoryRawSchema,
}).strict().superRefine((r, ctx) => {
  checkMetadata(r, r.raw.output2.map(row => row.stck_bsop_date), null, ctx);
  if (r.raw.output1.futs_shrn_iscd !== r.requested.symbol) ctx.addIssue({ code: 'custom', message: 'instrument_mismatch' });
  if (r.raw.output2.some(row => row.stck_bsop_date < r.requested.start_date || row.stck_bsop_date > r.requested.end_date)) ctx.addIssue({ code: 'custom', message: 'bar_context_mismatch' });
});
export const KrFuturesMinuteHistoryResultSchema = z.object({
  contract: z.literal('moai.stock.kr-futures-minute-history.v1'), ...CommonResult,
  requested: KrFuturesMinuteHistoryInputSchema, interval: z.literal('1m'),
  identity_status: z.literal('returned_short_code_matched_not_master_verified'),
  geographical_scope_status: z.literal('domestic_index_futures_request_not_master_verified'),
  raw: KrFuturesMinuteHistoryRawSchema,
}).strict().superRefine((r, ctx) => {
  checkMetadata(r, r.raw.output2.map(row => row.stck_bsop_date + row.stck_cntg_hour), null, ctx);
  if (r.raw.output1.futs_shrn_iscd !== r.requested.symbol) ctx.addIssue({ code: 'custom', message: 'instrument_mismatch' });
  // Night-session business dates and wall dates are not reconciled. Do not compare combined labels to the anchor.
});
export const OverseasFuturesDailyHistoryResultSchema = z.object({
  contract: z.literal('moai.stock.overseas-futures-daily-history.v1'), ...CommonResult,
  requested: OverseasFuturesDailyHistoryInputSchema, interval: z.literal('1d'),
  identity_status: z.literal('no_returned_contract_or_exchange_code'),
  geographical_scope_status: z.literal('overseas_contract_us_listing_not_verified'),
  raw: OverseasFuturesDailyHistoryRawSchema,
}).strict().superRefine((r, ctx) => {
  const rows = overseasRows(r.raw);
  checkMetadata(r, rows.map(row => row.data_date + row.data_time), overseasHeader(r.raw).index_key, ctx);
  if (rows.length > Number(r.requested.count)) ctx.addIssue({ code: 'custom', message: 'bar_context_mismatch' });
  if (rows.some(row => row.data_date > r.requested.end_date)) ctx.addIssue({ code: 'custom', message: 'bar_context_mismatch' });
});
export const OverseasFuturesMinuteHistoryResultSchema = z.object({
  contract: z.literal('moai.stock.overseas-futures-minute-history.v1'), ...CommonResult,
  requested: OverseasFuturesMinuteHistoryInputSchema, interval: z.literal('provider_minute_bars'),
  identity_status: z.literal('no_returned_contract_or_exchange_code'),
  geographical_scope_status: z.literal('overseas_contract_us_listing_not_verified'),
  continuation_contract_status: z.literal('blocked_official_index_key_location_conflict'),
  raw: OverseasFuturesMinuteHistoryRawSchema,
}).strict().superRefine((r, ctx) => {
  checkMetadata(r, overseasRows(r.raw).map(row => row.data_date + row.data_time), overseasHeader(r.raw).index_key, ctx);
  // Date/time zone and session label semantics are not established: do not compare to the date-only anchor.
});
export type OverseasFuturesMinuteHistoryResult = z.infer<typeof OverseasFuturesMinuteHistoryResultSchema>;
export type OverseasFuturesMinuteHistoryInput = z.infer<typeof OverseasFuturesMinuteHistoryInputSchema>;
export type KrFuturesDailyHistoryResult = z.infer<typeof KrFuturesDailyHistoryResultSchema>;
export type KrFuturesMinuteHistoryResult = z.infer<typeof KrFuturesMinuteHistoryResultSchema>;
export type OverseasFuturesDailyHistoryResult = z.infer<typeof OverseasFuturesDailyHistoryResultSchema>;

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
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    const parsed = schema.safeParse(snapshotBoundary(value, 2000, 30, 20));
    if (parsed.success) return parsed.data;
  } catch { /* Untrusted input errors are intentionally redacted. */ }
  throw new FuturesHistoryError('invalid_input');
}
const Response = z.object({ status: z.number().int().min(100).max(599), tr_cont: Continuation, body: z.unknown() }).strict();
const Envelope = z.object({ rt_cd: z.string().max(10), msg_cd: z.string().max(40).optional(), msg1: z.string().max(2000).optional(), output1: z.unknown().optional(), output2: z.unknown().optional() }).strict();
async function readPage(request: FuturesHistoryRequest, transport: FuturesHistoryTransport | undefined, clock: FuturesHistoryClock) {
  if (!transport) throw new FuturesHistoryError('transport_not_configured');
  const origin = Origin.safeParse(transport.origin);
  if (!origin.success || typeof transport.send !== 'function' || typeof clock !== 'function') throw new FuturesHistoryError('invalid_input');
  const safe = FuturesHistoryRequestSchema.parse(request);
  Object.freeze(safe.query); Object.freeze(safe);
  let response: unknown;
  try { response = await transport.send(safe); } catch (e) { throw sanitizedKisError(e) ?? new FuturesHistoryError('upstream_unavailable'); }
  let receipt: unknown;
  try { receipt = clock(); } catch { throw new FuturesHistoryError('invalid_input'); }
  const received = ExactInstantSchema.safeParse(receipt);
  if (!received.success) throw new FuturesHistoryError('invalid_input');
  let snapshot: unknown;
  try { snapshot = snapshotBoundary(response, FUTURES_HISTORY_MAX_RESPONSE_BYTES, 10000, 1000); }
  catch (e) { throw new FuturesHistoryError(e instanceof GlobalMarketError && e.code === 'response_too_large' ? 'response_too_large' : 'schema_drift'); }
  const parsed = Response.safeParse(snapshot);
  if (!parsed.success) throw new FuturesHistoryError('schema_drift');
  const r = parsed.data;
  if (r.status === 429) throw new FuturesHistoryError('rate_limited');
  if (r.status === 401 || r.status === 403) throw new FuturesHistoryError('auth_expired');
  if (r.status < 200 || r.status >= 300) throw new FuturesHistoryError('upstream_unavailable');
  const envelope = Envelope.safeParse(r.body);
  if (!envelope.success) throw new FuturesHistoryError('schema_drift');
  if (envelope.data.rt_cd !== '0') throw new FuturesHistoryError('upstream_rejected');
  return { body: envelope.data, origin: origin.data, received_at: received.data, tr_cont: r.tr_cont };
}
function metadata(page: Awaited<ReturnType<typeof readPage>>, labels: string[], cursor: string | null) {
  const more = page.tr_cont === 'M' || page.tr_cont === 'F' || (cursor !== null && cursor !== '');
  return { provider: 'kis', origin: page.origin, source_commit: FUTURES_HISTORY_SOURCE_COMMIT,
    received_at: page.received_at, available_at: page.received_at,
    source_as_of: null, event_time: null, published_at: null, source_timezone: null,
    source_time_status: 'provider_bar_labels_not_verified_instants', rights_status: 'pending', session: 'unknown',
    delay_state: 'unknown', finality: 'unknown', freshness: 'unknown', completeness: 'unknown',
    validation_status: 'provider_shape_checked_not_live_reconciled', adjustment_status: 'not_verified_no_roll_or_adjustment_inferred',
    pagination: { pages_fetched: 1, tr_cont: page.tr_cont, provider_cursor: cursor,
      status: more ? 'more_signaled_not_fetched' : 'not_signaled_completeness_unknown', automatic_continuation: false, completeness: 'unknown' },
    bars_returned: labels.length, coverage_status: labels.length ? 'single_page_not_complete_history' : 'empty_page_not_proof_of_absence',
    row_order_status: 'provider_order_preserved_no_sort_dedup_or_resample',
    duplicate_label_status: new Set(labels).size !== labels.length ? 'duplicate_labels_retained' : 'none_observed',
    canonical_projection_status: 'blocked',
    canonical: { instrument_id: null, underlying_id: null, exchange: null, country: null, currency: null, adjusted: null,
      contract_multiplier: null, expiry_date: null, last_trading_date: null, tick_size: null, tick_value: null,
      price_unit: null, volume_unit: null, turnover_unit: null, bars: null },
    mapping_blockers: ['authoritative_contract_exchange_and_underlying_binding_missing', 'currency_multiplier_and_price_quantity_units_not_reconciled',
      'timezone_business_date_and_bar_finality_not_reconciled', 'expiry_roll_adjustment_and_continuous_series_basis_not_verified', 'market_data_rights_pending'],
    unimplemented_derivations: ['automatic_pagination', 'canonical_ohlcv', 'continuous_futures_rolls', 'back_adjustment', 'resampling', 'source_timestamp_attribution'],
    warnings: ['Exactly one bounded provider page is preserved in its original row order, including duplicate labels. It is not complete history.',
      'Signed price strings, leading zeros, decimal precision, blanks and date/time labels are preserved. No rounding, scaling or negative-price rejection occurs.',
      'Provider date/time labels are not verified event or publication instants. Receipt time is sampled after transport completes, never attributed to market events.',
      'Contract identity, listing, timezone, multiplier, currency, units, adjustment, finality and market-data rights remain unverified.'],
  };
}
function result<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const code = parsed.error.issues.find(issue => ['instrument_mismatch', 'bar_context_mismatch'].includes(issue.message))?.message;
  throw new FuturesHistoryError((code as FuturesHistoryErrorCode | undefined) ?? 'schema_drift');
}
const defaultClock: FuturesHistoryClock = () => new Date().toISOString();
export async function requestKrFuturesDailyHistory(value: unknown, transport?: FuturesHistoryTransport, clock: FuturesHistoryClock = defaultClock): Promise<KrFuturesDailyHistoryResult> {
  const q = input(KrFuturesDailyHistoryInputSchema, value);
  const page = await readPage({ operation: 'kis.kr_futures_daily_history', method: 'GET', path: '/uapi/domestic-futureoption/v1/quotations/inquire-daily-fuopchartprice', tr_id: 'FHKIF03020100', tr_cont: '',
    query: { FID_COND_MRKT_DIV_CODE: 'F', FID_INPUT_ISCD: q.symbol, FID_INPUT_DATE_1: q.start_date, FID_INPUT_DATE_2: q.end_date, FID_PERIOD_DIV_CODE: 'D' } }, transport, clock);
  const raw = result(KrFuturesDailyHistoryRawSchema, page.body);
  return result(KrFuturesDailyHistoryResultSchema, { contract: 'moai.stock.kr-futures-daily-history.v1', ...metadata(page, raw.output2.map(row => row.stck_bsop_date), null),
    requested: q, interval: '1d', identity_status: 'returned_short_code_matched_not_master_verified', geographical_scope_status: 'domestic_index_futures_request_not_master_verified', raw });
}
export async function requestKrFuturesMinuteHistory(value: unknown, transport?: FuturesHistoryTransport, clock: FuturesHistoryClock = defaultClock): Promise<KrFuturesMinuteHistoryResult> {
  const q = input(KrFuturesMinuteHistoryInputSchema, value);
  const page = await readPage({ operation: 'kis.kr_futures_minute_history', method: 'GET', path: '/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice', tr_id: 'FHKIF03020200', tr_cont: '',
    query: { FID_COND_MRKT_DIV_CODE: 'F', FID_INPUT_ISCD: q.symbol, FID_HOUR_CLS_CODE: '60', FID_PW_DATA_INCU_YN: q.include_past_data,
      FID_FAKE_TICK_INCU_YN: 'N', FID_INPUT_DATE_1: q.anchor_date, FID_INPUT_HOUR_1: q.anchor_time } }, transport, clock);
  const raw = result(KrFuturesMinuteHistoryRawSchema, page.body);
  const common = metadata(page, raw.output2.map(row => row.stck_bsop_date + row.stck_cntg_hour), null);
  return result(KrFuturesMinuteHistoryResultSchema, { contract: 'moai.stock.kr-futures-minute-history.v1', ...common,
    requested: q, interval: '1m', identity_status: 'returned_short_code_matched_not_master_verified', geographical_scope_status: 'domestic_index_futures_request_not_master_verified', raw,
    warnings: [...common.warnings, 'The request uses the documented 60-second code and excludes fake ticks. No night-session business/wall-date mapping, anchor inclusivity, per-bar turnover or bar-close alignment is inferred.'] });
}
export async function requestOverseasFuturesDailyHistory(value: unknown, transport?: FuturesHistoryTransport, clock: FuturesHistoryClock = defaultClock): Promise<OverseasFuturesDailyHistoryResult> {
  const q = input(OverseasFuturesDailyHistoryInputSchema, value);
  const page = await readPage({ operation: 'kis.overseas_futures_daily_history', method: 'GET', path: '/uapi/overseas-futureoption/v1/quotations/daily-ccnl', tr_id: 'HHDFC55020100', tr_cont: '',
    query: { SRS_CD: q.symbol, EXCH_CD: q.exchange, START_DATE_TIME: '', CLOSE_DATE_TIME: q.end_date, QRY_TP: 'Q', QRY_CNT: q.count, QRY_GAP: '', INDEX_KEY: '' } }, transport, clock);
  const raw = result(OverseasFuturesDailyHistoryRawSchema, page.body);
  const common = metadata(page, overseasRows(raw).map(row => row.data_date + row.data_time), overseasHeader(raw).index_key);
  return result(OverseasFuturesDailyHistoryResultSchema, { contract: 'moai.stock.overseas-futures-daily-history.v1', ...common,
    requested: q, interval: '1d', identity_status: 'no_returned_contract_or_exchange_code', geographical_scope_status: 'overseas_contract_us_listing_not_verified', raw,
    warnings: [...common.warnings, 'Overseas does not mean US-listed. Request exchange/series values are caller inputs, not returned identity evidence.',
      'The official daily field tret_cnt and last_n_cnt stay uninterpreted; neither establishes row count or completeness. vol is not relabeled as per-bar volume. Continuation cursor is retained, never followed.'] });
}
export async function requestOverseasFuturesMinuteHistory(value: unknown, transport?: FuturesHistoryTransport, clock: FuturesHistoryClock = defaultClock): Promise<OverseasFuturesMinuteHistoryResult> {
  const q = input(OverseasFuturesMinuteHistoryInputSchema, value);
  const page = await readPage({ operation: 'kis.overseas_futures_minute_history', method: 'GET', path: '/uapi/overseas-futureoption/v1/quotations/inquire-time-futurechartprice', tr_id: 'HHDFC55020400', tr_cont: '',
    query: { SRS_CD: q.symbol, EXCH_CD: q.exchange, START_DATE_TIME: '', CLOSE_DATE_TIME: q.end_date, QRY_TP: 'Q', QRY_CNT: '120', QRY_GAP: q.interval_minutes, INDEX_KEY: '' } }, transport, clock);
  const raw = result(OverseasFuturesMinuteHistoryRawSchema, page.body);
  const common = metadata(page, overseasRows(raw).map(row => row.data_date + row.data_time), overseasHeader(raw).index_key);
  return result(OverseasFuturesMinuteHistoryResultSchema, { contract: 'moai.stock.overseas-futures-minute-history.v1', ...common,
    requested: q, interval: 'provider_minute_bars', identity_status: 'no_returned_contract_or_exchange_code', geographical_scope_status: 'overseas_contract_us_listing_not_verified',
    continuation_contract_status: 'blocked_official_index_key_location_conflict', raw,
    warnings: [...common.warnings, 'Overseas does not mean US-listed. Request series, exchange and minute gap are not returned instrument or interval evidence.',
      'Only the documented blank-start first page is dispatched. The official helper documents output1.index_key but its recursive implementation reads output2.index_key; continuation is blocked before transport.',
      '120 rows is the reviewed example and local cap, not a verified provider maximum. ret_cnt and last_n_cnt are uninterpreted, and vol is not relabeled per-bar volume.'],
  });
}
/** Explicit fail-closed gate for the conflicting overseas-minute continuation contract. Not a transport operation. */
export const OverseasFuturesMinuteContinuationInputSchema = z.object({
  symbol: OverseasSymbol, exchange: Exchange, provider_cursor: z.string().min(1).max(200),
}).strict();
export async function requestOverseasFuturesMinuteContinuation(value: unknown, _transport?: FuturesHistoryTransport): Promise<never> {
  input(OverseasFuturesMinuteContinuationInputSchema, value);
  throw new FuturesHistoryError('source_contract_conflict');
}

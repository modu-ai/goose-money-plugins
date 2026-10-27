import { z } from 'zod';
import { QuoteSnapshotSchema } from './domain.js';
import { ExactInstantSchema, compareInstants } from './exact-instant.js';
import { boundedBody, GlobalMarketError } from './global-market-data.js';
import { sanitizedKisError } from './kis-sanitized-error.js';

/** RC5 proposal: credential-free, bounded, single-page history readers. No fetch fallback. */
export const HISTORY_BREADTH_MAX_RESPONSE_BYTES = 300_000;
export const US_DAILY_HISTORY_MAX_ROWS = 100; // Local safety policy, not a provider completeness claim.
export const KR_INTRADAY_HISTORY_MAX_ROWS = 30; // Reviewed official current-day endpoint limit.
const Provenance = QuoteSnapshotSchema.shape.provenance.shape;
const SymbolSchema = z.string().max(16).regex(/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/);
const ExchangeSchema = z.enum(['NAS', 'NYS', 'AMS']);
const BoardSchema = z.enum(['J', 'NX', 'UN']);
const KrSymbolSchema = z.string().regex(/^\d{6}$/);
const DecimalSchema = z.string().max(40).regex(/^-?\d+(?:\.\d+)?$/);
const UnsignedSchema = z.string().max(40).regex(/^\d+(?:\.\d+)?$/);
const IntegerSchema = z.string().max(30).regex(/^\d+$/);
const BlankDecimal = z.union([DecimalSchema, z.literal('')]);
const BlankUnsigned = z.union([UnsignedSchema, z.literal('')]);
const BlankInteger = z.union([IntegerSchema, z.literal('')]);
const DateSchema = z.string().regex(/^\d{8}$/).refine(value => {
  const year = Number(value.slice(0, 4)), month = Number(value.slice(4, 6)), day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, 'invalid_calendar_date');
const TimeSchema = z.string().regex(/^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/);
const ContinuationSchema = z.enum(['', 'D', 'E', 'M', 'F']).nullable();

export const UsDailyHistoryInputSchema = z.object({
  symbol: SymbolSchema,
  exchange: ExchangeSchema,
  basis_date: DateSchema, // Explicit date only; no implicit host/market "today".
  adjustment_code: z.enum(['0', '1']),
  asset_class: z.enum(['stock', 'etf']).optional(),
}).strict();
export const KrIntradayHistoryInputSchema = z.object({
  symbol: KrSymbolSchema,
  board: BoardSchema.default('J'),
  anchor_time: TimeSchema,
  include_past_data: z.enum(['Y', 'N']),
  // Local mismatch guard, never sent to this current-day-only endpoint.
  expected_business_date: DateSchema.optional(),
}).strict();

export const UsDailyHistoryRequestSchema = z.object({
  operation: z.literal('kis.us_daily_history'), method: z.literal('GET'),
  path: z.literal('/uapi/overseas-price/v1/quotations/dailyprice'),
  tr_id: z.literal('HHDFS76240000'), tr_cont: z.literal(''),
  query: z.object({ AUTH: z.literal(''), EXCD: ExchangeSchema, SYMB: SymbolSchema,
    GUBN: z.literal('0'), BYMD: DateSchema, MODP: z.enum(['0', '1']) }).strict(),
}).strict();
export const KrIntradayHistoryRequestSchema = z.object({
  operation: z.literal('kis.kr_intraday_history'), method: z.literal('GET'),
  path: z.literal('/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice'),
  tr_id: z.literal('FHKST03010200'), tr_cont: z.literal(''),
  query: z.object({ FID_COND_MRKT_DIV_CODE: BoardSchema, FID_INPUT_ISCD: KrSymbolSchema,
    FID_INPUT_HOUR_1: TimeSchema, FID_PW_DATA_INCU_YN: z.enum(['Y', 'N']), FID_ETC_CLS_CODE: z.literal('') }).strict(),
}).strict();
export const HistoryBreadthRequestSchema = z.discriminatedUnion('operation', [UsDailyHistoryRequestSchema, KrIntradayHistoryRequestSchema]);
export type HistoryBreadthRequest = z.infer<typeof HistoryBreadthRequestSchema>;
export interface HistoryBreadthResponse { status: number; tr_cont: string | null; body: unknown }
export interface HistoryBreadthTransport {
  readonly origin: 'actual' | 'synthetic';
  /** Any future network transport must also bound response bytes while receiving. */
  send(request: HistoryBreadthRequest): Promise<HistoryBreadthResponse>;
}
export type HistoryBreadthClock = () => string;
export type HistoryBreadthErrorCode = 'invalid_input' | 'transport_not_configured' | 'upstream_unavailable' |
  'rate_limited' | 'auth_expired' | 'upstream_rejected' | 'schema_drift' | 'response_too_large' |
  'instrument_mismatch' | 'bar_context_mismatch' | 'duplicate_bar';
export class HistoryBreadthError extends Error {
  constructor(readonly code: HistoryBreadthErrorCode) { super(code); this.name = 'HistoryBreadthError'; }
}

/** Strict supported field partition. Unknown additions are rejected, never silently stripped. */
export const UsDailyHistoryHeaderRawSchema = z.object({
  rsym: z.string().min(1).max(24).regex(/^[A-Z0-9.-]+$/),
  zdiv: z.union([z.string().regex(/^\d{1,2}$/), z.literal('')]).optional(),
  // The official check script's label is ambiguous; do not interpret as count or previous close.
  nrec: BlankUnsigned.optional(),
}).strict();
export const UsDailyHistoryBarRawSchema = z.object({
  xymd: DateSchema, clos: BlankUnsigned, open: BlankUnsigned, high: BlankUnsigned, low: BlankUnsigned,
  tvol: BlankInteger, tamt: BlankUnsigned.optional(), sign: z.string().max(4).optional(),
  diff: BlankDecimal.optional(),
  // Official raw US response includes an explicit plus sign; retain its lexeme, no canonical promotion.
  rate: z.union([z.string().max(40).regex(/^[+-]?\d+(?:\.\d+)?$/),z.literal('')]).optional(),
  pbid: BlankUnsigned.optional(), vbid: BlankInteger.optional(),
  pask: BlankUnsigned.optional(), vask: BlankInteger.optional(),
}).strict();
export const UsDailyHistoryRawSchema = z.object({
  // The official helper handles object/array forms; retain the original form.
  output1: z.union([UsDailyHistoryHeaderRawSchema, z.tuple([UsDailyHistoryHeaderRawSchema])]),
  output2: z.union([z.array(UsDailyHistoryBarRawSchema).max(US_DAILY_HISTORY_MAX_ROWS), UsDailyHistoryBarRawSchema]),
}).strict();
export const KrIntradayHistoryHeaderRawSchema = z.object({
  stck_prpr: BlankUnsigned,
  prdy_vrss: BlankDecimal.optional(), prdy_vrss_sign: z.string().max(4).optional(),
  prdy_ctrt: BlankDecimal.optional(), stck_prdy_clpr: BlankUnsigned.optional(),
  acml_vol: BlankInteger.optional(), acml_tr_pbmn: BlankUnsigned.optional(),
  hts_kor_isnm: z.string().max(200).optional(),
}).strict();
export const KrIntradayHistoryBarRawSchema = z.object({
  stck_bsop_date: DateSchema, stck_cntg_hour: TimeSchema,
  stck_prpr: BlankUnsigned, stck_oprc: BlankUnsigned, stck_hgpr: BlankUnsigned, stck_lwpr: BlankUnsigned,
  cntg_vol: BlankInteger, acml_tr_pbmn: BlankUnsigned.optional(),
}).strict();
export const KrIntradayHistoryRawSchema = z.object({
  output1: KrIntradayHistoryHeaderRawSchema,
  output2: z.array(KrIntradayHistoryBarRawSchema).max(KR_INTRADAY_HISTORY_MAX_ROWS),
}).strict();

const PaginationSchema = z.object({
  pages_fetched: z.literal(1), tr_cont: ContinuationSchema,
  status: z.enum(['more_signaled_not_fetched', 'not_signaled_completeness_unknown']),
  automatic_continuation: z.literal(false), completeness: z.literal('unknown'),
}).strict();
const CanonicalSchema = z.object({
  instrument_id: z.null(), asset_class: z.null(), currency: z.null(), adjusted: z.null(),
  price_unit: z.null(), volume_unit: z.null(), turnover_unit: z.null(), bars: z.null(),
}).strict();
const CommonResult = {
  provider: z.literal('kis'), origin: Provenance.origin,
  received_at: ExactInstantSchema, available_at: ExactInstantSchema,
  source_as_of: z.null(), event_time: z.null(), published_at: z.null(), source_timezone: z.null(),
  source_time_status: z.literal('provider_bar_labels_not_verified_instants'),
  rights_status: Provenance.rights_status.extract(['pending']),
  session: Provenance.session.extract(['unknown']), delay_state: Provenance.delay_state.extract(['unknown']),
  finality: Provenance.finality.extract(['unknown']), freshness: Provenance.freshness.extract(['unknown']),
  validation_status: z.literal('provider_shape_checked_not_live_reconciled'),
  completeness: z.literal('unknown'), pagination: PaginationSchema,
  bars_returned: z.number().int().min(0).max(US_DAILY_HISTORY_MAX_ROWS),
  coverage_status: z.enum(['empty_page_not_proof_of_absence', 'single_page_not_complete_history']),
  canonical_projection_status: z.literal('blocked'), canonical: CanonicalSchema,
  mapping_blockers: z.array(z.string().min(1).max(200)).min(1).max(20),
  unimplemented_derivations: z.array(z.string().min(1).max(100)).min(1).max(20),
  warnings: z.array(z.string().max(500)).min(1).max(20),
};
type UsRaw = z.infer<typeof UsDailyHistoryRawSchema>;
const usHeader = (raw: UsRaw) => Array.isArray(raw.output1) ? raw.output1[0] : raw.output1;
const usRows = (raw: UsRaw) => Array.isArray(raw.output2) ? raw.output2 : [raw.output2];
type MetadataCheck = {
  received_at: string; available_at: string; bars_returned: number; coverage_status: string;
  pagination: z.infer<typeof PaginationSchema>;
};
function checkMetadata(result: MetadataCheck, count: number, context: z.RefinementCtx) {
  // Zod refinements can still run after a string-format issue: never throw from safeParse.
  if (ExactInstantSchema.safeParse(result.received_at).success && ExactInstantSchema.safeParse(result.available_at).success &&
      compareInstants(result.received_at, result.available_at) !== 0) context.addIssue({ code: 'custom', message: 'availability_receipt_mismatch' });
  const pagination = result.pagination.tr_cont === 'M' || result.pagination.tr_cont === 'F' ? 'more_signaled_not_fetched' : 'not_signaled_completeness_unknown';
  if (result.pagination.status !== pagination) context.addIssue({ code: 'custom', message: 'continuation_status_mismatch' });
  if (result.bars_returned !== count || result.coverage_status !== (count === 0 ? 'empty_page_not_proof_of_absence' : 'single_page_not_complete_history')) {
    context.addIssue({ code: 'custom', message: 'bar_count_or_coverage_mismatch' });
  }
}
function distinct(values: string[]) { return new Set(values).size === values.length; }
export const UsDailyHistoryResultSchema = z.object({
  contract: z.literal('moai.stock.us-daily-history.v1'), ...CommonResult,
  requested: UsDailyHistoryInputSchema, interval: z.literal('1d'),
  identity_status: z.literal('conservative_rsym_guard_matched_not_master_verified'),
  adjustment_status: z.literal('request_flag_preserved_returned_basis_unverified'),
  raw: UsDailyHistoryRawSchema,
}).strict().superRefine((result, context) => {
  const rows = usRows(result.raw);
  checkMetadata(result, rows.length, context);
  if (usHeader(result.raw).rsym !== `D${result.requested.exchange}${result.requested.symbol}`) context.addIssue({ code: 'custom', message: 'instrument_mismatch' });
  if (rows.some(row => row.xymd > result.requested.basis_date)) context.addIssue({ code: 'custom', message: 'bar_context_mismatch' });
  if (!distinct(rows.map(row => row.xymd))) context.addIssue({ code: 'custom', message: 'duplicate_bar' });
});
export const KrIntradayHistoryResultSchema = z.object({
  contract: z.literal('moai.stock.kr-intraday-history.v1'), ...CommonResult,
  requested: KrIntradayHistoryInputSchema,
  interval: z.literal('provider_minute_bars'),
  scope: z.literal('current_day_endpoint_not_historical_intraday'),
  identity_status: z.literal('no_returned_instrument_code'),
  adjustment_status: z.literal('not_specified_by_reviewed_intraday_contract'),
  first_row_volume_status: z.literal('may_belong_to_previous_bar_until_first_trade'),
  raw: KrIntradayHistoryRawSchema,
}).strict().superRefine((result, context) => {
  const rows = result.raw.output2;
  checkMetadata(result, rows.length, context);
  if (result.requested.expected_business_date !== undefined && rows.some(row => row.stck_bsop_date !== result.requested.expected_business_date)) context.addIssue({ code: 'custom', message: 'bar_context_mismatch' });
  if (new Set(rows.map(row => row.stck_bsop_date)).size > 1) context.addIssue({ code: 'custom', message: 'bar_context_mismatch' });
  if (!distinct(rows.map(row => `${row.stck_bsop_date}${row.stck_cntg_hour}`))) context.addIssue({ code: 'custom', message: 'duplicate_bar' });
});
export type UsDailyHistoryResult = z.infer<typeof UsDailyHistoryResultSchema>;
export type KrIntradayHistoryResult = z.infer<typeof KrIntradayHistoryResultSchema>;
export type UsDailyHistoryInput = z.infer<typeof UsDailyHistoryInputSchema>;
export type KrIntradayHistoryInput = z.infer<typeof KrIntradayHistoryInputSchema>;

const ResponseSchema = z.object({ status: z.number().int().min(100).max(599), tr_cont: ContinuationSchema, body: z.unknown() }).strict();
const EnvelopeSchema = z.object({
  rt_cd: z.string().max(10), msg_cd: z.string().max(40).optional(), msg1: z.string().max(2000).optional(),
  output1: z.unknown().optional(), output2: z.unknown().optional(),
}).strict();
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  let snapshot: unknown;
  try { snapshot = boundedBody(value, { maxBytes: 2000, maxNodes: 30, maxKeys: 20 }); } catch { throw new HistoryBreadthError('invalid_input'); }
  const parsed = schema.safeParse(snapshot);
  if (!parsed.success) throw new HistoryBreadthError('invalid_input');
  return parsed.data;
}
async function readPage(request: HistoryBreadthRequest, transport: HistoryBreadthTransport | undefined, clock: HistoryBreadthClock) {
  if (!transport) throw new HistoryBreadthError('transport_not_configured');
  const origin = Provenance.origin.safeParse(transport.origin);
  if (!origin.success || typeof transport.send !== 'function' || typeof clock !== 'function') throw new HistoryBreadthError('invalid_input');
  const safeRequest = HistoryBreadthRequestSchema.parse(request);
  Object.freeze(safeRequest.query); Object.freeze(safeRequest);
  let response: unknown;
  try { response = await transport.send(safeRequest); } catch (e) { throw sanitizedKisError(e) ?? new HistoryBreadthError('upstream_unavailable'); }
  // The receipt is sampled once, strictly AFTER the awaited body has arrived.
  let receipt: unknown;
  try { receipt = clock(); } catch { throw new HistoryBreadthError('invalid_input'); }
  const time = ExactInstantSchema.safeParse(receipt);
  if (!time.success) throw new HistoryBreadthError('invalid_input');
  let snapshot: unknown;
  try { snapshot = boundedBody(response, { maxBytes: HISTORY_BREADTH_MAX_RESPONSE_BYTES }); }
  catch (error) { throw new HistoryBreadthError(error instanceof GlobalMarketError && error.code === 'response_too_large' ? 'response_too_large' : 'schema_drift'); }
  const parsed = ResponseSchema.safeParse(snapshot);
  if (!parsed.success) throw new HistoryBreadthError('schema_drift');
  const r = parsed.data;
  if (r.status === 429) throw new HistoryBreadthError('rate_limited');
  if (r.status === 401 || r.status === 403) throw new HistoryBreadthError('auth_expired');
  if (r.status < 200 || r.status >= 300) throw new HistoryBreadthError('upstream_unavailable');
  const envelope = EnvelopeSchema.safeParse(r.body);
  if (!envelope.success) throw new HistoryBreadthError('schema_drift');
  if (envelope.data.rt_cd !== '0') throw new HistoryBreadthError('upstream_rejected');
  return { envelope: envelope.data, origin: origin.data, received_at: time.data, tr_cont: r.tr_cont };
}
function metadata(page: Awaited<ReturnType<typeof readPage>>, count: number) {
  return {
    provider: 'kis', origin: page.origin, received_at: page.received_at, available_at: page.received_at,
    source_as_of: null, event_time: null, published_at: null, source_timezone: null,
    source_time_status: 'provider_bar_labels_not_verified_instants',
    rights_status: 'pending', session: 'unknown', delay_state: 'unknown', finality: 'unknown', freshness: 'unknown',
    validation_status: 'provider_shape_checked_not_live_reconciled', completeness: 'unknown',
    pagination: { pages_fetched: 1, tr_cont: page.tr_cont,
      status: page.tr_cont === 'M' || page.tr_cont === 'F' ? 'more_signaled_not_fetched' : 'not_signaled_completeness_unknown',
      automatic_continuation: false, completeness: 'unknown' },
    bars_returned: count, coverage_status: count === 0 ? 'empty_page_not_proof_of_absence' : 'single_page_not_complete_history',
    canonical_projection_status: 'blocked',
    canonical: { instrument_id: null, asset_class: null, currency: null, adjusted: null, price_unit: null, volume_unit: null, turnover_unit: null, bars: null },
  } as const;
}
function parsedResult<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const code = parsed.error.issues.find(issue => ['instrument_mismatch', 'bar_context_mismatch', 'duplicate_bar'].includes(issue.message))?.message;
  throw new HistoryBreadthError((code as HistoryBreadthErrorCode | undefined) ?? 'schema_drift');
}
const defaultClock: HistoryBreadthClock = () => new Date().toISOString();
export async function requestUsDailyHistory(value: unknown, transport?: HistoryBreadthTransport, clock: HistoryBreadthClock = defaultClock): Promise<UsDailyHistoryResult> {
  const q = input(UsDailyHistoryInputSchema, value);
  const page = await readPage({ operation: 'kis.us_daily_history', method: 'GET', path: '/uapi/overseas-price/v1/quotations/dailyprice', tr_id: 'HHDFS76240000', tr_cont: '',
    query: { AUTH: '', EXCD: q.exchange, SYMB: q.symbol, GUBN: '0', BYMD: q.basis_date, MODP: q.adjustment_code } }, transport, clock);
  const raw = parsedResult(UsDailyHistoryRawSchema, { output1: page.envelope.output1, output2: page.envelope.output2 });
  return parsedResult(UsDailyHistoryResultSchema, {
    contract: 'moai.stock.us-daily-history.v1', ...metadata(page, usRows(raw).length), requested: q, interval: '1d', raw,
    identity_status: 'conservative_rsym_guard_matched_not_master_verified', adjustment_status: 'request_flag_preserved_returned_basis_unverified',
    mapping_blockers: ['authoritative_instrument_binding_missing', 'currency_price_volume_turnover_units_not_reconciled', 'returned_adjustment_and_corporate_action_basis_not_verified', 'market_data_rights_pending'],
    unimplemented_derivations: ['automatic_pagination', 'full_range_history', 'canonical_ohlcv', 'weekly_monthly_resampling', 'source_timestamp_attribution'],
    warnings: ['Exactly one bounded page is retained in provider order; continuation signals never establish complete history.',
      'MODP 0/1 is retained as the requested adjustment flag, not proof of returned corporate-action methodology.',
      'nrec and zdiv remain uninterpreted provider strings. No count, previous-close, scaling or currency inference is made.',
      'The rsym guard is not authoritative instrument, asset-class or exchange-master reconciliation. Business dates are not publication instants.'],
  });
}
export async function requestKrIntradayHistory(value: unknown, transport?: HistoryBreadthTransport, clock: HistoryBreadthClock = defaultClock): Promise<KrIntradayHistoryResult> {
  const q = input(KrIntradayHistoryInputSchema, value);
  const page = await readPage({ operation: 'kis.kr_intraday_history', method: 'GET', path: '/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice', tr_id: 'FHKST03010200', tr_cont: '',
    query: { FID_COND_MRKT_DIV_CODE: q.board, FID_INPUT_ISCD: q.symbol, FID_INPUT_HOUR_1: q.anchor_time, FID_PW_DATA_INCU_YN: q.include_past_data, FID_ETC_CLS_CODE: '' } }, transport, clock);
  const raw = parsedResult(KrIntradayHistoryRawSchema, { output1: page.envelope.output1, output2: page.envelope.output2 });
  return parsedResult(KrIntradayHistoryResultSchema, {
    contract: 'moai.stock.kr-intraday-history.v1', ...metadata(page, raw.output2.length), requested: q, raw,
    interval: 'provider_minute_bars', scope: 'current_day_endpoint_not_historical_intraday', identity_status: 'no_returned_instrument_code',
    adjustment_status: 'not_specified_by_reviewed_intraday_contract', first_row_volume_status: 'may_belong_to_previous_bar_until_first_trade',
    mapping_blockers: ['returned_instrument_code_missing', 'currency_price_volume_turnover_units_not_reconciled', 'intraday_adjustment_and_bar_finality_unverified', 'market_data_rights_pending'],
    unimplemented_derivations: ['historical_intraday', 'automatic_pagination', 'canonical_ohlcv', 'five_minute_aggregation', 'hourly_aggregation', 'source_timestamp_attribution'],
    warnings: ['This current-day endpoint returns at most 30 rows per request, not complete historical intraday coverage.',
      'The first output2 row may retain the previous bar volume until its first trade. No volume repair, deduplication or finality is inferred.',
      'A future requested time can be populated with the current price; provider date/time labels are not verified trade or publication instants.',
      'include_past_data does not authorize or imply previous-day coverage. The optional expected business date is a local guard, not a transmitted date filter.',
      'acml_tr_pbmn is retained unchanged and is not relabeled as per-bar turnover. No timezone, exchange session or bar alignment is inferred.'],
  });
}

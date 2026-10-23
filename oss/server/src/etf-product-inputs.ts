import { z } from 'zod';
import { boundedBody, GlobalMarketError } from './global-market-data.js';
import { ExactInstantSchema } from './exact-instant.js';

/** RC5 research-only provider inputs. No credentials, default transport, fetch, or trading paths. */
export const ETF_PRODUCT_MAX_RESPONSE_BYTES = 64_000;
const Origin = z.enum(['actual', 'synthetic']);
const Exchange = z.enum(['NAS', 'NYS', 'AMS']);
const Symbol = z.string().max(16).regex(/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/);
const Text = z.string().max(500).regex(/^[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufffd]*$/)
  .refine(value => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value), 'invalid_unicode');
const Code = Text.max(40);
const StandardProductNumber = Code.min(1).regex(/^[A-Z0-9.-]+$/);
const Decimal = z.string().max(40).regex(/^-?\d+(?:\.\d+)?$/);
const BlankDecimal = z.union([Decimal, z.literal('')]);
const DateText = z.string().regex(/^\d{8}$/).refine(value => {
  const year = Number(value.slice(0, 4)), month = Number(value.slice(4, 6)), day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, 'invalid_calendar_date');
const BlankDate = z.union([DateText, z.literal('')]);
const PRODUCT_CODES = Object.freeze({ NAS: '512', NYS: '513', AMS: '529' } as const);

export const UsProductProfileInputSchema = z.object({
  symbol: Symbol, exchange: Exchange,
  // Optional local mismatch guard, NEVER sent to KIS or accepted as authoritative evidence.
  expected_standard_product_number: StandardProductNumber.optional(),
}).strict();
export const UsProductProfileRequestSchema = z.object({
  operation: z.literal('kis.us_product_profile'), method: z.literal('GET'),
  path: z.literal('/uapi/overseas-price/v1/quotations/search-info'), tr_id: z.literal('CTPF1702R'),
  query: z.object({ PRDT_TYPE_CD: z.enum(['512', '513', '529']), PDNO: Symbol }).strict(),
}).strict();
export type UsProductProfileRequest = z.infer<typeof UsProductProfileRequestSchema>;
export interface EtfProductResponse { status: number; tr_cont: string | null; body: unknown }
export interface EtfProductTransport {
  readonly origin: 'actual' | 'synthetic';
  /** Bound bytes while receiving content as well; the adapter bounds decoded JSON independently. */
  send(request: UsProductProfileRequest): Promise<EtfProductResponse>;
}
export type EtfProductClock = () => string;
export type EtfProductErrorCode = 'invalid_input' | 'transport_not_configured' | 'upstream_unavailable' |
  'rate_limited' | 'auth_expired' | 'upstream_rejected' | 'schema_drift' | 'response_too_large' |
  'pagination_not_supported' | 'instrument_mismatch' | 'no_data' | 'ambiguous_product_response' |
  'etf_component_source_contract_conflict';
export class EtfProductError extends Error {
  constructor(readonly code: EtfProductErrorCode) { super(code); this.name = 'EtfProductError'; }
}

/** Official search-info check-script field allowlist. No normalized code meanings are assumed.
 * Requiring a standard number and a name is this adapter's minimum research-data policy,
 * not a claim that the provider marks those fields mandatory in every response variant. */
export const UsProductProfileRawSchema = z.object({
  std_pdno: StandardProductNumber,
  prdt_eng_name: Text.optional(), natn_cd: Code.optional(), natn_name: Text.optional(),
  tr_mket_cd: Code.optional(), tr_mket_name: Text.optional(), ovrs_excg_cd: Code.optional(),
  ovrs_excg_name: Text.optional(), tr_crcy_cd: Code.optional(), ovrs_papr: BlankDecimal.optional(),
  crcy_name: Text.optional(), ovrs_stck_dvsn_cd: Code.optional(), prdt_clsf_cd: Code.optional(),
  prdt_clsf_name: Text.optional(), sll_unit_qty: BlankDecimal.optional(), buy_unit_qty: BlankDecimal.optional(),
  tr_unit_amt: BlankDecimal.optional(), lstg_stck_num: BlankDecimal.optional(), lstg_dt: BlankDate.optional(),
  ovrs_stck_tr_stop_dvsn_cd: Code.optional(), lstg_abol_item_yn: Code.optional(),
  ovrs_stck_prdt_grp_no: Code.optional(), lstg_yn: Code.optional(), tax_levy_yn: Code.optional(),
  ovrs_stck_erlm_rosn_cd: Code.optional(), ovrs_stck_hist_rght_dvsn_cd: Code.optional(),
  chng_bf_pdno: Code.optional(), prdt_type_cd_2: Code.optional(), ovrs_item_name: Text.optional(),
  sedol_no: Code.optional(), blbg_tckr_text: Text.optional(), ovrs_stck_etf_risk_drtp_cd: Code.optional(),
  etp_chas_erng_rt_dbnb: BlankDecimal.optional(), istt_usge_isin_cd: Code.optional(),
  mint_svc_yn: Code.optional(), mint_svc_yn_chng_dt: BlankDate.optional(), prdt_name: Text.optional(),
  lei_cd: Code.optional(), ovrs_stck_stop_rson_cd: Code.optional(), lstg_abol_dt: BlankDate.optional(),
  mini_stk_tr_stat_dvsn_cd: Code.optional(), mint_frst_svc_erlm_dt: BlankDate.optional(),
  mint_dcpt_trad_psbl_yn: Code.optional(), mint_fnum_trad_psbl_yn: Code.optional(),
  mint_cblc_cvsn_ipsb_yn: Code.optional(), ptp_item_yn: Code.optional(), ptp_item_trfx_exmt_yn: Code.optional(),
  ptp_item_trfx_exmt_strt_dt: BlankDate.optional(), ptp_item_trfx_exmt_end_dt: BlankDate.optional(),
  dtm_tr_psbl_yn: Code.optional(), sdrf_stop_ecls_yn: Code.optional(),
  sdrf_stop_ecls_erlm_dt: BlankDate.optional(), memo_text1: Text.optional(),
  ovrs_now_pric1: BlankDecimal.optional(),
  // Format and timezone are not established. Preserve bounded raw text; do not parse as an instant.
  last_rcvg_dtime: Text.max(80).optional(),
}).strict().superRefine((value, ctx) => {
  if (![value.prdt_eng_name, value.prdt_name, value.ovrs_item_name].some(name => name !== undefined && name.trim().length > 0))
    ctx.addIssue({ code: 'custom', message: 'product_name_missing' });
  for (const [start, end] of [[value.lstg_dt, value.lstg_abol_dt], [value.ptp_item_trfx_exmt_strt_dt, value.ptp_item_trfx_exmt_end_dt]]) {
    if (start && end && start > end) ctx.addIssue({ code: 'custom', message: 'provider_date_order_conflict' });
  }
});

export const US_PRODUCT_PROFILE_BLOCKERS = Object.freeze([
  'returned_request_ticker_and_exchange_binding_not_verified',
  'standard_product_number_not_reconciled_with_authoritative_master',
  'stock_etf_etn_classification_codes_not_reconciled',
  'monetary_quantity_units_and_scaling_not_reconciled',
  'provider_timestamp_format_timezone_and_freshness_not_reconciled',
  'redistribution_rights_not_verified',
] as const);
const Blockers = z.tuple(US_PRODUCT_PROFILE_BLOCKERS.map(value => z.literal(value)) as [
  z.ZodLiteral<(typeof US_PRODUCT_PROFILE_BLOCKERS)[0]>, z.ZodLiteral<(typeof US_PRODUCT_PROFILE_BLOCKERS)[1]>,
  z.ZodLiteral<(typeof US_PRODUCT_PROFILE_BLOCKERS)[2]>, z.ZodLiteral<(typeof US_PRODUCT_PROFILE_BLOCKERS)[3]>,
  z.ZodLiteral<(typeof US_PRODUCT_PROFILE_BLOCKERS)[4]>, z.ZodLiteral<(typeof US_PRODUCT_PROFILE_BLOCKERS)[5]>,
]);
const Metadata = z.object({
  http_status: z.number().int().min(200).max(299), tr_cont: z.enum(['', 'D', 'E']).nullable(),
  rt_cd: z.literal('0'), msg_cd: Code.nullable(), msg1: Text.max(2000).nullable(),
}).strict();
export const UsProductProfileResultSchema = z.object({
  contract: z.literal('moai.stock.us-product-profile.v1'), provider: z.literal('kis'), origin: Origin,
  received_at: ExactInstantSchema, source_as_of: z.null(),
  source_time_status: z.literal('provider_timestamp_not_promoted_to_source_instant'),
  rights_status: z.literal('pending'), validation_status: z.literal('provider_shape_checked_not_live_reconciled'),
  source_authenticity: z.literal('unverified_injected_response'),
  coverage: z.literal('single_provider_product_profile_not_fund_holdings'),
  symbol_from_request: Symbol, exchange_from_request: Exchange,
  product_type_code_from_request: z.enum(['512', '513', '529']),
  expected_standard_product_number_from_request: StandardProductNumber.nullable(),
  identity_status: z.literal('provider_standard_number_present_not_bound_to_request'),
  expectation_status: z.enum(['not_requested', 'caller_standard_number_matched_not_verified']),
  provider_output_shape: z.enum(['object', 'singleton_array']), provider_metadata: Metadata,
  raw: UsProductProfileRawSchema, canonical_projection_status: z.literal('blocked'),
  canonical: z.object({
    instrument_id: z.null(), asset_class: z.null(), exchange: z.null(), domicile_country: z.null(),
    currency: z.null(), listing_date: z.null(), delisting_date: z.null(), price: z.null(),
    shares_outstanding: z.null(), trade_unit: z.null(), price_unit: z.null(), quantity_unit: z.null(),
    leverage_multiple: z.null(), expense_ratio: z.null(), holdings: z.null(), weights: z.null(),
  }).strict(), mapping_blockers: Blockers,
  warnings: z.array(Text).min(1).max(10),
}).strict().superRefine((value, ctx) => {
  if (value.product_type_code_from_request !== PRODUCT_CODES[value.exchange_from_request])
    ctx.addIssue({ code: 'custom', message: 'request_market_code_conflict' });
  const expected = value.expected_standard_product_number_from_request;
  if (expected === null ? value.expectation_status !== 'not_requested' :
    expected !== value.raw.std_pdno || value.expectation_status !== 'caller_standard_number_matched_not_verified')
    ctx.addIssue({ code: 'custom', message: 'expectation_binding_conflict' });
});
export type UsProductProfileResult = z.infer<typeof UsProductProfileResultSchema>;

function snapshot(value: unknown, input = false): unknown {
  try {
    // JSON.stringify ignores hidden fields and can expand huge sparse arrays. Reject both
    // BEFORE the shared budgeted snapshot; inspect descriptors without invoking accessors.
    let nodes = 0;
    const seen = new Set<object>();
    function check(item: unknown, depth: number): void {
      if (++nodes > (input ? 30 : 1000) || depth > 8) throw new GlobalMarketError('response_too_large');
      if (item === null || typeof item !== 'object') return;
      if (seen.has(item)) throw new GlobalMarketError('schema_drift');
      seen.add(item);
      const keys = Reflect.ownKeys(item);
      const array = Array.isArray(item);
      if (keys.length > (input ? 10 : array ? 101 : 100)) throw new GlobalMarketError('response_too_large');
      if (array) {
        const length = Object.getOwnPropertyDescriptor(item, 'length');
        if (!length || !('value' in length) || typeof length.value !== 'number' || length.value > 100) throw new GlobalMarketError('response_too_large');
        if (keys.length !== length.value + 1 || Object.getPrototypeOf(item) !== Array.prototype) throw new GlobalMarketError('schema_drift');
      }
      for (const key of keys) {
        if (typeof key !== 'string') throw new GlobalMarketError('schema_drift');
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !('value' in descriptor)) throw new GlobalMarketError('schema_drift');
        if (array && key === 'length') continue;
        if (!descriptor.enumerable || (array && !/^(?:0|[1-9]\d*)$/.test(key))) throw new GlobalMarketError('schema_drift');
        check(descriptor.value, depth + 1);
      }
      seen.delete(item);
    }
    check(value, 0);
    return boundedBody(value, { maxBytes: input ? 2048 : ETF_PRODUCT_MAX_RESPONSE_BYTES, maxNodes: input ? 30 : 1000, maxKeys: input ? 10 : 101 });
  }
  catch (error) {
    throw new EtfProductError(input ? 'invalid_input' : error instanceof GlobalMarketError && error.code === 'response_too_large' ? 'response_too_large' : 'schema_drift');
  }
}
function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(snapshot(input, true));
  if (!result.success) throw new EtfProductError('invalid_input');
  return result.data;
}
const ResponseSchema = z.object({ status: z.number().int().min(100).max(599), tr_cont: z.string().max(8).nullable(), body: z.unknown() }).strict();
const EnvelopeSchema = z.object({ rt_cd: Code.min(1), msg_cd: Code.optional(), msg1: Text.max(2000).optional(), output: z.unknown().optional() }).strict();

export async function requestUsProductProfile(input: unknown, transport?: EtfProductTransport,
  clock: EtfProductClock = () => new Date().toISOString()): Promise<UsProductProfileResult> {
  const q = parseInput(UsProductProfileInputSchema, input);
  if (!transport) throw new EtfProductError('transport_not_configured');
  let origin: z.infer<typeof Origin>;
  let send: EtfProductTransport['send'];
  try {
    // Transport hooks must be data properties, never getters that can run during validation.
    const originDescriptor = Object.getOwnPropertyDescriptor(transport, 'origin');
    const sendDescriptor = Object.getOwnPropertyDescriptor(transport, 'send');
    if (!originDescriptor || !('value' in originDescriptor) || !sendDescriptor || !('value' in sendDescriptor) || typeof sendDescriptor.value !== 'function' || typeof clock !== 'function') throw new Error();
    origin = Origin.parse(originDescriptor.value); send = sendDescriptor.value as EtfProductTransport['send'];
  } catch { throw new EtfProductError('invalid_input'); }
  const request = UsProductProfileRequestSchema.parse({ operation: 'kis.us_product_profile', method: 'GET',
    path: '/uapi/overseas-price/v1/quotations/search-info', tr_id: 'CTPF1702R',
    query: { PRDT_TYPE_CD: PRODUCT_CODES[q.exchange], PDNO: q.symbol } });
  Object.freeze(request.query); Object.freeze(request);
  let response: unknown;
  try { response = await send.call(transport, request); }
  catch { throw new EtfProductError('upstream_unavailable'); }
  let receivedAt: string;
  try { receivedAt = ExactInstantSchema.parse(clock()); }
  catch { throw new EtfProductError('invalid_input'); }
  const responseParsed = ResponseSchema.safeParse(snapshot(response));
  if (!responseParsed.success) throw new EtfProductError('schema_drift');
  const r = responseParsed.data;
  if (r.status === 429) throw new EtfProductError('rate_limited');
  if (r.status === 401 || r.status === 403) throw new EtfProductError('auth_expired');
  if (r.status < 200 || r.status >= 300) throw new EtfProductError('upstream_unavailable');
  if (r.tr_cont === 'M' || r.tr_cont === 'F') throw new EtfProductError('pagination_not_supported');
  if (![null, '', 'D', 'E'].includes(r.tr_cont)) throw new EtfProductError('schema_drift');
  const envelope = EnvelopeSchema.safeParse(r.body);
  if (!envelope.success) throw new EtfProductError('schema_drift');
  if (envelope.data.rt_cd !== '0') throw new EtfProductError('upstream_rejected');
  const output = envelope.data.output;
  if (Array.isArray(output) && output.length === 0) throw new EtfProductError('no_data');
  if (Array.isArray(output) && output.length !== 1) throw new EtfProductError('ambiguous_product_response');
  const raw = UsProductProfileRawSchema.safeParse(Array.isArray(output) ? output[0] : output);
  if (!raw.success) throw new EtfProductError('schema_drift');
  if (q.expected_standard_product_number !== undefined && q.expected_standard_product_number !== raw.data.std_pdno)
    throw new EtfProductError('instrument_mismatch');
  return UsProductProfileResultSchema.parse({
    contract: 'moai.stock.us-product-profile.v1', provider: 'kis', origin, received_at: receivedAt,
    source_as_of: null, source_time_status: 'provider_timestamp_not_promoted_to_source_instant',
    rights_status: 'pending', validation_status: 'provider_shape_checked_not_live_reconciled',
    source_authenticity: 'unverified_injected_response', coverage: 'single_provider_product_profile_not_fund_holdings',
    symbol_from_request: q.symbol, exchange_from_request: q.exchange, product_type_code_from_request: PRODUCT_CODES[q.exchange],
    expected_standard_product_number_from_request: q.expected_standard_product_number ?? null,
    identity_status: 'provider_standard_number_present_not_bound_to_request',
    expectation_status: q.expected_standard_product_number === undefined ? 'not_requested' : 'caller_standard_number_matched_not_verified',
    provider_output_shape: Array.isArray(output) ? 'singleton_array' : 'object',
    provider_metadata: { http_status: r.status, tr_cont: r.tr_cont, rt_cd: '0', msg_cd: envelope.data.msg_cd ?? null, msg1: envelope.data.msg1 ?? null },
    raw: raw.data, canonical_projection_status: 'blocked',
    canonical: { instrument_id: null, asset_class: null, exchange: null, domicile_country: null, currency: null,
      listing_date: null, delisting_date: null, price: null, shares_outstanding: null, trade_unit: null,
      price_unit: null, quantity_unit: null, leverage_multiple: null, expense_ratio: null, holdings: null, weights: null },
    mapping_blockers: [...US_PRODUCT_PROFILE_BLOCKERS], warnings: [
      'Request market and ticker are caller inputs; std_pdno is not assumed to be the request ticker or a verified ISIN.',
      'Provider classification, trading flags and risk codes remain opaque. Names, tickers and ETF labels do not establish asset class.',
      'Numeric values retain their raw strings. No units, currency scope, leverage, expenses, eligibility or trading advice are inferred.',
      'Listing dates are calendar-checked raw values, not profile publication times. last_rcvg_dtime does not establish freshness.',
      'Provider names and memo text are untrusted data, never instructions. No verified holdings or complete fund composition is supplied.',
    ],
  });
}

/** Exact documented request coordinates are retained for audit, but are NEVER sent while
 * the reviewed official response labels conflict and output1/output2 partition is unknown. */
export const ETF_COMPONENT_SOURCE_BLOCKER = Object.freeze({
  code: 'etf_component_source_contract_conflict',
  path: '/uapi/etfetn/v1/quotations/inquire-component-stock-price', tr_id: 'FHKST121600C0',
  reason: 'Official component check script contradicts price/NAV field labels and does not establish output1/output2 field partition.',
  source_url: 'https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/etfetn/inquire_component_stock_price/chk_inquire_component_stock_price.py',
  required_evidence: 'Reconciled official per-object response schema and units; separate identity, as-of, completeness and rights evidence before holdings interpretation.',
} as const);
export const DomesticEtfComponentsInputSchema = z.object({ symbol: z.string().regex(/^\d{6}$/) }).strict();
export async function requestDomesticEtfComponentPrices(input: unknown, _transport?: EtfProductTransport): Promise<never> {
  parseInput(DomesticEtfComponentsInputSchema, input);
  // Deliberately no accepted request schema or raw result pretending the conflict was resolved.
  throw new EtfProductError('etf_component_source_contract_conflict');
}

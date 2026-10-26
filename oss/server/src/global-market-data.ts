import { z } from 'zod';

/** Credential-free, read-only research adapters. There is deliberately no fetch fallback. */
export const GLOBAL_MARKET_MAX_RESPONSE_BYTES = 300_000;
const OriginSchema = z.enum(['actual', 'synthetic']);
const SymbolSchema = z.string().max(16).regex(/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/);
const ExchangeSchema = z.enum(['NAS', 'NYS', 'AMS']);
const ContractCodeSchema = z.string().regex(/^(?:1[0-9A-Z]{3}|A0[0-9A-Z]{2})(?:0[1-9]|1[0-2])$/);
const DecimalSchema = z.string().max(40).regex(/^-?\d+(?:\.\d+)?$/);
const NonnegativeDecimalSchema = z.string().max(40).regex(/^\d+(?:\.\d+)?$/);
const IntegerSchema = z.string().max(30).regex(/^\d+$/);
const BlankDecimalSchema = z.union([DecimalSchema, z.literal('')]);
const BlankNonnegativeSchema = z.union([NonnegativeDecimalSchema, z.literal('')]);
const BlankIntegerSchema = z.union([IntegerSchema, z.literal('')]);
const RawTextSchema = z.string().max(200);
const DateSchema = z.string().regex(/^\d{8}$/).refine((value) => {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, 'invalid_calendar_date');
const ReceivedAtSchema = z.string().datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value)));

export const UsQuoteInputSchema = z.object({
  symbol: SymbolSchema,
  exchange: ExchangeSchema,
  asset_class: z.enum(['stock', 'etf']).optional(),
}).strict();
export const DomesticEtfQuoteInputSchema = z.object({
  symbol: z.string().regex(/^\d{6}$/),
  board: z.enum(['J', 'NX', 'UN']).default('J'),
}).strict();
export const FuturesQuoteInputSchema = z.object({
  symbol: ContractCodeSchema,
  // This is an optional caller expectation, NEVER authoritative identity evidence.
  expected_name: RawTextSchema.min(1).optional(),
}).strict();

const UsRequestSchema = z.object({
  operation: z.literal('kis.us_quote'),
  method: z.literal('GET'),
  path: z.literal('/uapi/overseas-price/v1/quotations/price'),
  tr_id: z.literal('HHDFS00000300'),
  query: z.object({ AUTH: z.literal(''), EXCD: ExchangeSchema, SYMB: SymbolSchema }).strict(),
}).strict();
const FuturesRequestSchema = z.object({
  operation: z.literal('kis.futures_quote'),
  method: z.literal('GET'),
  path: z.literal('/uapi/domestic-futureoption/v1/quotations/inquire-price'),
  tr_id: z.literal('FHMIF10000000'),
  query: z.object({ FID_COND_MRKT_DIV_CODE: z.literal('F'), FID_INPUT_ISCD: ContractCodeSchema }).strict(),
}).strict();
const DomesticEtfRequestSchema = z.object({
  operation: z.literal('kis.domestic_etf_quote'),
  method: z.literal('GET'),
  path: z.literal('/uapi/etfetn/v1/quotations/inquire-price'),
  tr_id: z.literal('FHPST02400000'),
  query: z.object({ FID_COND_MRKT_DIV_CODE: z.enum(['J', 'NX', 'UN']), FID_INPUT_ISCD: z.string().regex(/^\d{6}$/) }).strict(),
}).strict();
export const GlobalMarketRequestSchema = z.discriminatedUnion('operation', [UsRequestSchema, FuturesRequestSchema, DomesticEtfRequestSchema]);
export type GlobalMarketRequest = z.infer<typeof GlobalMarketRequestSchema>;
export interface GlobalMarketResponse { status: number; tr_cont: string | null; body: unknown }
export interface GlobalMarketTransport {
  readonly origin: 'actual' | 'synthetic';
  /** Implementations must bound bytes while receiving a body. This adapter also bounds the decoded JSON. */
  send(request: GlobalMarketRequest): Promise<GlobalMarketResponse>;
}
export type GlobalMarketClock = () => string;
export type GlobalMarketErrorCode = 'invalid_input' | 'transport_not_configured' | 'upstream_unavailable' |
  'rate_limited' | 'auth_expired' | 'upstream_rejected' | 'schema_drift' | 'response_too_large' |
  'pagination_not_supported' | 'instrument_mismatch';
export class GlobalMarketError extends Error {
  constructor(readonly code: GlobalMarketErrorCode) { super(code); this.name = 'GlobalMarketError'; }
}

/** Only the documented price fields are accepted; provider extensions require review. */
export const UsQuoteRawSchema = z.object({
  rsym: z.string().min(1).max(24).regex(/^[A-Z0-9.-]+$/),
  zdiv: z.union([z.string().regex(/^\d{1,2}$/), z.literal('')]).optional(),
  base: BlankNonnegativeSchema.optional(),
  pvol: BlankIntegerSchema.optional(),
  last: NonnegativeDecimalSchema,
  sign: z.string().max(4).optional(),
  diff: BlankDecimalSchema.optional(),
  rate: BlankDecimalSchema.optional(),
  tvol: BlankIntegerSchema.optional(),
  tamt: BlankNonnegativeSchema.optional(),
  ordy: z.string().max(8).optional(),
}).strict();

// KIS's check script documents field names across output1/output2/output3, but not
// a complete per-object partition. Preserve each object rather than inventing one.
const FuturesFieldsSchema = z.object({
  hts_kor_isnm: RawTextSchema.optional(),
  futs_prpr: BlankNonnegativeSchema.optional(),
  futs_prdy_vrss: BlankDecimalSchema.optional(),
  prdy_vrss_sign: z.string().max(4).optional(),
  futs_prdy_clpr: BlankNonnegativeSchema.optional(),
  futs_prdy_ctrt: BlankDecimalSchema.optional(),
  acml_vol: BlankIntegerSchema.optional(),
  acml_tr_pbmn: BlankNonnegativeSchema.optional(),
  hts_otst_stpl_qty: BlankIntegerSchema.optional(),
  otst_stpl_qty_icdc: BlankDecimalSchema.optional(),
  futs_oprc: BlankNonnegativeSchema.optional(),
  futs_hgpr: BlankNonnegativeSchema.optional(),
  futs_lwpr: BlankNonnegativeSchema.optional(),
  futs_mxpr: BlankNonnegativeSchema.optional(),
  futs_llam: BlankNonnegativeSchema.optional(),
  basis: BlankDecimalSchema.optional(),
  futs_sdpr: BlankNonnegativeSchema.optional(),
  hts_thpr: BlankDecimalSchema.optional(),
  dprt: BlankDecimalSchema.optional(),
  crbr_aply_mxpr: BlankNonnegativeSchema.optional(),
  crbr_aply_llam: BlankNonnegativeSchema.optional(),
  futs_last_tr_date: z.union([DateSchema, z.literal('')]).optional(),
  hts_rmnn_dynu: BlankIntegerSchema.optional(),
  futs_lstn_medm_hgpr: BlankNonnegativeSchema.optional(),
  futs_lstn_medm_lwpr: BlankNonnegativeSchema.optional(),
  delta_val: BlankDecimalSchema.optional(),
  gama: BlankDecimalSchema.optional(),
  theta: BlankDecimalSchema.optional(),
  vega: BlankDecimalSchema.optional(),
  rho: BlankDecimalSchema.optional(),
  hist_vltl: BlankDecimalSchema.optional(),
  hts_ints_vltl: BlankDecimalSchema.optional(),
  mrkt_basis: BlankDecimalSchema.optional(),
  acpr: BlankNonnegativeSchema.optional(),
  bstp_cls_code: z.string().max(8).optional(),
  bstp_nmix_prpr: BlankNonnegativeSchema.optional(),
  bstp_nmix_prdy_vrss: BlankDecimalSchema.optional(),
  bstp_nmix_prdy_ctrt: BlankDecimalSchema.optional(),
}).strict();
export const FuturesQuoteRawSchema = z.object({
  output1: FuturesFieldsSchema.extend({ hts_kor_isnm: RawTextSchema.min(1), futs_prpr: NonnegativeDecimalSchema }),
  output2: FuturesFieldsSchema,
  output3: FuturesFieldsSchema,
}).strict();

/** Dedicated ETF/ETN endpoint, not the regular domestic equity quote schema. */
export const DomesticEtfQuoteRawSchema = z.object({
  stck_prpr: NonnegativeDecimalSchema,
  nav: BlankNonnegativeSchema,
  prdy_vrss_sign: z.string().max(4).optional(),
  prdy_vrss: BlankDecimalSchema.optional(),
  prdy_ctrt: BlankDecimalSchema.optional(),
  acml_vol: BlankIntegerSchema.optional(),
  prdy_vol: BlankIntegerSchema.optional(),
  stck_mxpr: BlankNonnegativeSchema.optional(),
  stck_llam: BlankNonnegativeSchema.optional(),
  stck_prdy_clpr: BlankNonnegativeSchema.optional(),
  stck_oprc: BlankNonnegativeSchema.optional(),
  prdy_clpr_vrss_oprc_rate: BlankDecimalSchema.optional(),
  stck_hgpr: BlankNonnegativeSchema.optional(),
  prdy_clpr_vrss_hgpr_rate: BlankDecimalSchema.optional(),
  stck_lwpr: BlankNonnegativeSchema.optional(),
  prdy_clpr_vrss_lwpr_rate: BlankDecimalSchema.optional(),
  prdy_last_nav: BlankNonnegativeSchema.optional(),
  nav_prdy_vrss: BlankDecimalSchema.optional(),
  nav_prdy_vrss_sign: z.string().max(4).optional(),
  nav_prdy_ctrt: BlankDecimalSchema.optional(),
  trc_errt: BlankDecimalSchema.optional(),
  stck_sdpr: BlankNonnegativeSchema.optional(),
  stck_sspr: BlankNonnegativeSchema.optional(),
  nmix_ctrt: BlankDecimalSchema.optional(),
  etf_crcl_stcn: BlankIntegerSchema.optional(),
  etf_ntas_ttam: BlankNonnegativeSchema.optional(),
  etf_frcr_ntas_ttam: BlankNonnegativeSchema.optional(),
  frgn_limt_rate: BlankDecimalSchema.optional(),
  frgn_oder_able_qty: BlankIntegerSchema.optional(),
  etf_cu_unit_scrt_cnt: BlankIntegerSchema.optional(),
  etf_cnfg_issu_cnt: BlankIntegerSchema.optional(),
  etf_dvdn_cycl: RawTextSchema.optional(),
  crcd: z.string().max(8).optional(),
  etf_crcl_ntas_ttam: BlankNonnegativeSchema.optional(),
  etf_frcr_crcl_ntas_ttam: BlankNonnegativeSchema.optional(),
  etf_frcr_last_ntas_wrth_val: BlankNonnegativeSchema.optional(),
  lp_oder_able_cls_code: z.string().max(8).optional(),
  stck_dryy_hgpr: BlankNonnegativeSchema.optional(),
  dryy_hgpr_vrss_prpr_rate: BlankDecimalSchema.optional(),
  dryy_hgpr_date: z.union([DateSchema, z.literal('')]).optional(),
  stck_dryy_lwpr: BlankNonnegativeSchema.optional(),
  dryy_lwpr_vrss_prpr_rate: BlankDecimalSchema.optional(),
  dryy_lwpr_date: z.union([DateSchema, z.literal('')]).optional(),
  bstp_kor_isnm: RawTextSchema.optional(),
  vi_cls_code: z.string().max(8).optional(),
  lstn_stcn: BlankIntegerSchema.optional(),
  frgn_hldn_qty: BlankIntegerSchema.optional(),
  frgn_hldn_qty_rate: BlankDecimalSchema.optional(),
  etf_trc_ert_mltp: BlankDecimalSchema.optional(),
  dprt: BlankDecimalSchema.optional(),
  mbcr_name: RawTextSchema.optional(),
  stck_lstn_date: z.union([DateSchema, z.literal('')]).optional(),
  // Observed official raw response uses '0'; preserve it as a non-date placeholder, never an expiry.
  mtrt_date: z.union([DateSchema, z.literal(''), z.literal('0')]).optional(),
  shrg_type_code: z.string().max(8).optional(),
  lp_hldn_rate: BlankDecimalSchema.optional(),
  etf_trgt_nmix_bstp_code: z.string().max(12).optional(),
  etf_div_name: RawTextSchema.optional(),
  etf_rprs_bstp_kor_isnm: RawTextSchema.optional(),
  lp_hldn_vol: BlankIntegerSchema.optional(),
}).strict();

const CommonResultShape = {
  provider: z.literal('kis'),
  origin: OriginSchema,
  received_at: ReceivedAtSchema,
  source_as_of: z.null(),
  source_time_status: z.literal('not_returned_by_reviewed_quote_contract'),
  rights_status: z.literal('pending'),
  validation_status: z.literal('provider_shape_checked_not_live_reconciled'),
  canonical_projection_status: z.literal('blocked'),
  mapping_blockers: z.array(z.string().min(1).max(200)).min(1).max(20),
  warnings: z.array(z.string().max(500)).max(20),
};
export const UsQuoteResultSchema = z.object({
  contract: z.literal('moai.stock.us-quote.v1'),
  ...CommonResultShape,
  symbol_from_request: SymbolSchema,
  exchange_from_request: ExchangeSchema,
  asset_class_from_request: z.enum(['stock', 'etf']).nullable(),
  identity_status: z.literal('conservative_rsym_guard_matched_not_master_verified'),
  raw: UsQuoteRawSchema,
  canonical: z.object({
    instrument_id: z.null(), asset_class: z.null(), currency: z.null(),
    last_price: z.null(), previous_close: z.null(), change: z.null(), change_percent: z.null(),
    volume: z.null(), turnover: z.null(), price_unit: z.null(), volume_unit: z.null(),
  }).strict(),
}).strict();
export const FuturesQuoteResultSchema = z.object({
  contract: z.literal('moai.stock.index-futures-quote.v1'),
  ...CommonResultShape,
  symbol_from_request: ContractCodeSchema,
  market_code_from_request: z.literal('F'),
  expected_name_from_request: RawTextSchema.min(1).nullable(),
  identity_status: z.enum(['no_returned_contract_code', 'caller_name_expectation_matched_not_verified']),
  raw: FuturesQuoteRawSchema,
  canonical: z.object({
    instrument_id: z.null(), underlying_id: z.null(), currency: z.null(), last_price: z.null(),
    previous_close: z.null(), change: z.null(), change_percent: z.null(), volume: z.null(),
    turnover: z.null(), open_interest: z.null(), expiry_date: z.null(), last_trading_date: z.null(),
    price_unit: z.null(), volume_unit: z.null(), contract_multiplier: z.null(),
  }).strict(),
}).strict();
export const DomesticEtfQuoteResultSchema = z.object({
  contract: z.literal('moai.stock.domestic-etf-quote.v1'),
  ...CommonResultShape,
  symbol_from_request: z.string().regex(/^\d{6}$/),
  board_from_request: z.enum(['J', 'NX', 'UN']),
  identity_status: z.literal('no_returned_instrument_code'),
  coverage: z.literal('dedicated_etf_etn_price_nav_not_holdings'),
  raw: DomesticEtfQuoteRawSchema,
  canonical: z.object({
    instrument_id: z.null(), asset_class: z.null(), currency: z.null(), last_price: z.null(),
    nav: z.null(), previous_nav: z.null(), nav_change: z.null(), nav_change_percent: z.null(),
    tracking_error: z.null(), premium_discount: z.null(), net_assets: z.null(), volume: z.null(),
    price_unit: z.null(), nav_unit: z.null(), net_assets_unit: z.null(),
  }).strict(),
}).strict();
export type DomesticEtfQuoteResult = z.infer<typeof DomesticEtfQuoteResultSchema>;
export type UsQuoteResult = z.infer<typeof UsQuoteResultSchema>;
export type FuturesQuoteResult = z.infer<typeof FuturesQuoteResultSchema>;

const ResponseSchema = z.object({ status: z.number().int().min(100).max(599), tr_cont: z.string().max(8).nullable(), body: z.unknown() }).strict();
const EnvelopeSchema = z.object({ rt_cd: z.string().max(10), msg_cd: z.string().max(40).optional(), msg1: z.string().max(2000).optional() }).passthrough();

/** Bounded JSON-only snapshot: rejects accessors, cycles, non-finite values, depth and oversized data. */
export function boundedBody(body: unknown, limits: { maxBytes?: number; maxNodes?: number; maxKeys?: number } = {}): unknown {
  const maxBytes=limits.maxBytes??GLOBAL_MARKET_MAX_RESPONSE_BYTES;
  const maxNodes=limits.maxNodes??10000;
  const maxKeys=limits.maxKeys??1000;
  let nodes = 0;
  let bytes = 0;
  const seen = new Set<object>();
  function inspect(value: unknown, depth: number): void {
    if (++nodes > maxNodes || depth > 8) throw new GlobalMarketError('response_too_large');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') {
      bytes += Buffer.byteLength(value, 'utf8');
      if (bytes > maxBytes) throw new GlobalMarketError('response_too_large');
      return;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || value === null || seen.has(value)) throw new GlobalMarketError('schema_drift');
    const prototype = Object.getPrototypeOf(value);
    const array = Array.isArray(value);
    if (array ? prototype !== Array.prototype && prototype !== null : prototype !== Object.prototype && prototype !== null) throw new GlobalMarketError('schema_drift');
    // Reject sparse/oversized arrays before ownKeys or JSON.stringify can allocate by length.
    const length = array ? Object.getOwnPropertyDescriptor(value, 'length')?.value : null;
    if (array && (!Number.isSafeInteger(length) || length < 0)) throw new GlobalMarketError('schema_drift');
    if (array && length > maxKeys) throw new GlobalMarketError('response_too_large');
    if (Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') || (array && Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON'))) throw new GlobalMarketError('schema_drift');
    seen.add(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some(key=>typeof key!=='string')) throw new GlobalMarketError('schema_drift');
    if (keys.length > maxKeys) throw new GlobalMarketError('response_too_large');
    if (array && keys.length !== length + 1) throw new GlobalMarketError('schema_drift');
    for (const key of keys) {
      bytes += Buffer.byteLength(String(key), 'utf8');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) throw new GlobalMarketError('schema_drift');
      if (array && key === 'length') continue;
      if (!descriptor.enumerable || (array && (!/^(0|[1-9][0-9]*)$/.test(String(key)) || Number(key) >= length))) throw new GlobalMarketError('schema_drift');
      inspect(descriptor.value, depth + 1);
    }
    seen.delete(value);
  }
  inspect(body, 0);
  let serialized: string | undefined;
  try { serialized = JSON.stringify(body); } catch { throw new GlobalMarketError('schema_drift'); }
  if (serialized === undefined) throw new GlobalMarketError('schema_drift');
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw new GlobalMarketError('response_too_large');
  return JSON.parse(serialized) as unknown;
}

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new GlobalMarketError('invalid_input');
  return parsed.data;
}

async function readQuote(request: GlobalMarketRequest, transport: GlobalMarketTransport | undefined, clock: GlobalMarketClock) {
  if (!transport) throw new GlobalMarketError('transport_not_configured');
  const origin = OriginSchema.safeParse(transport.origin);
  if (!origin.success || typeof transport.send !== 'function' || typeof clock !== 'function') throw new GlobalMarketError('invalid_input');
  GlobalMarketRequestSchema.parse(request);
  let response: unknown;
  try { response = await transport.send(request); } catch { throw new GlobalMarketError('upstream_unavailable'); }
  // Called only AFTER the transport has supplied its complete response body.
  let receivedAt: unknown;
  try { receivedAt = clock(); } catch { throw new GlobalMarketError('invalid_input'); }
  const time = ReceivedAtSchema.safeParse(receivedAt);
  if (!time.success) throw new GlobalMarketError('invalid_input');
  const r = ResponseSchema.safeParse(response);
  if (!r.success) throw new GlobalMarketError('schema_drift');
  if (r.data.status === 429) throw new GlobalMarketError('rate_limited');
  if (r.data.status === 401 || r.data.status === 403) throw new GlobalMarketError('auth_expired');
  if (r.data.status < 200 || r.data.status >= 300) throw new GlobalMarketError('upstream_unavailable');
  if (r.data.tr_cont === 'M' || r.data.tr_cont === 'F') throw new GlobalMarketError('pagination_not_supported');
  if (![null, '', 'D', 'E'].includes(r.data.tr_cont)) throw new GlobalMarketError('schema_drift');
  const body = boundedBody(r.data.body);
  const envelope = EnvelopeSchema.safeParse(body);
  if (!envelope.success) throw new GlobalMarketError('schema_drift');
  if (envelope.data.rt_cd !== '0') throw new GlobalMarketError('upstream_rejected');
  return { envelope: envelope.data, origin: origin.data, received_at: time.data };
}
const commonMetadata = {
  provider: 'kis', source_as_of: null, source_time_status: 'not_returned_by_reviewed_quote_contract',
  rights_status: 'pending', validation_status: 'provider_shape_checked_not_live_reconciled', canonical_projection_status: 'blocked',
} as const;
const defaultClock: GlobalMarketClock = () => new Date().toISOString();

export async function requestUsQuote(input: unknown, transport?: GlobalMarketTransport, clock: GlobalMarketClock = defaultClock): Promise<UsQuoteResult> {
  const q = parseInput(UsQuoteInputSchema, input);
  const result = await readQuote({ operation: 'kis.us_quote', method: 'GET', path: '/uapi/overseas-price/v1/quotations/price', tr_id: 'HHDFS00000300', query: { AUTH: '', EXCD: q.exchange, SYMB: q.symbol } }, transport, clock);
  const parsed = UsQuoteRawSchema.safeParse(result.envelope.output);
  if (!parsed.success) throw new GlobalMarketError('schema_drift');
  // Conservative guard only: the public example proves DNASAAPL, not a universal
  // master-data mapping. A match does NOT establish canonical instrument identity.
  if (parsed.data.rsym !== `D${q.exchange}${q.symbol}`) throw new GlobalMarketError('instrument_mismatch');
  return UsQuoteResultSchema.parse({
    contract: 'moai.stock.us-quote.v1', ...commonMetadata, origin: result.origin, received_at: result.received_at,
    symbol_from_request: q.symbol, exchange_from_request: q.exchange, asset_class_from_request: q.asset_class ?? null,
    identity_status: 'conservative_rsym_guard_matched_not_master_verified', raw: parsed.data,
    canonical: { instrument_id: null, asset_class: null, currency: null, last_price: null, previous_close: null, change: null, change_percent: null, volume: null, turnover: null, price_unit: null, volume_unit: null },
    mapping_blockers: ['authoritative_instrument_master_binding_missing', 'currency_not_returned_by_quote', 'price_volume_turnover_units_not_reconciled', 'stock_or_etf_classification_not_verified'],
    warnings: ['Request exchange and asset class are caller inputs, not verified classification.', 'rsym matching is a conservative request guard, not authoritative master-data reconciliation.', 'No live, delayed, session, timezone or freshness claim is inferred. Raw fields retain provider decimal strings.'],
  });
}

export async function requestFuturesQuote(input: unknown, transport?: GlobalMarketTransport, clock: GlobalMarketClock = defaultClock): Promise<FuturesQuoteResult> {
  const q = parseInput(FuturesQuoteInputSchema, input);
  const result = await readQuote({ operation: 'kis.futures_quote', method: 'GET', path: '/uapi/domestic-futureoption/v1/quotations/inquire-price', tr_id: 'FHMIF10000000', query: { FID_COND_MRKT_DIV_CODE: 'F', FID_INPUT_ISCD: q.symbol } }, transport, clock);
  const parsed = FuturesQuoteRawSchema.safeParse({ output1: result.envelope.output1, output2: result.envelope.output2, output3: result.envelope.output3 });
  if (!parsed.success) throw new GlobalMarketError('schema_drift');
  if (q.expected_name !== undefined && parsed.data.output1.hts_kor_isnm !== q.expected_name) throw new GlobalMarketError('instrument_mismatch');
  return FuturesQuoteResultSchema.parse({
    contract: 'moai.stock.index-futures-quote.v1', ...commonMetadata, origin: result.origin, received_at: result.received_at,
    symbol_from_request: q.symbol, market_code_from_request: 'F', expected_name_from_request: q.expected_name ?? null,
    identity_status: q.expected_name === undefined ? 'no_returned_contract_code' : 'caller_name_expectation_matched_not_verified', raw: parsed.data,
    canonical: { instrument_id: null, underlying_id: null, currency: null, last_price: null, previous_close: null, change: null, change_percent: null, volume: null, turnover: null, open_interest: null, expiry_date: null, last_trading_date: null, price_unit: null, volume_unit: null, contract_multiplier: null },
    mapping_blockers: ['returned_contract_code_missing', 'authoritative_contract_master_and_underlying_binding_missing', 'currency_units_and_contract_multiplier_not_reconciled', 'last_trading_date_not_verified_for_requested_contract'],
    warnings: ['The F market selector and contract code are caller inputs; the returned name alone does not verify identity.', 'A caller-supplied name expectation is only a mismatch guard, never authoritative evidence.', 'Final trading date is preserved as raw text and is not relabeled as expiry or used to construct a source timestamp.', 'No index-point, KRW, contracts, multiplier, settlement or live-data interpretation is inferred.'],
  });
}


export async function requestDomesticEtfQuote(input: unknown, transport?: GlobalMarketTransport, clock: GlobalMarketClock = defaultClock): Promise<DomesticEtfQuoteResult> {
  const q = parseInput(DomesticEtfQuoteInputSchema, input);
  const result = await readQuote({ operation: 'kis.domestic_etf_quote', method: 'GET', path: '/uapi/etfetn/v1/quotations/inquire-price', tr_id: 'FHPST02400000', query: { FID_COND_MRKT_DIV_CODE: q.board, FID_INPUT_ISCD: q.symbol } }, transport, clock);
  const parsed = DomesticEtfQuoteRawSchema.safeParse(result.envelope.output);
  if (!parsed.success) throw new GlobalMarketError('schema_drift');
  return DomesticEtfQuoteResultSchema.parse({
    contract: 'moai.stock.domestic-etf-quote.v1', ...commonMetadata, origin: result.origin, received_at: result.received_at,
    symbol_from_request: q.symbol, board_from_request: q.board, identity_status: 'no_returned_instrument_code',
    coverage: 'dedicated_etf_etn_price_nav_not_holdings', raw: parsed.data,
    canonical: { instrument_id: null, asset_class: null, currency: null, last_price: null, nav: null, previous_nav: null, nav_change: null, nav_change_percent: null, tracking_error: null, premium_discount: null, net_assets: null, volume: null, price_unit: null, nav_unit: null, net_assets_unit: null },
    mapping_blockers: ['returned_instrument_code_missing', 'etf_versus_etn_classification_not_verified', 'price_nav_net_assets_currency_and_units_not_reconciled', 'nav_and_tracking_metric_methodology_not_verified'],
    warnings: [...(parsed.data.mtrt_date==='0'?['mtrt_date raw zero placeholder is not a calendar date or verified maturity.']:[]), 'This is the dedicated ETF/ETN price and NAV endpoint, not a verified ETF holdings or composition feed.', 'The requested symbol and response classification strings are not an authoritative ETF identity binding.', 'crcd is preserved as a raw provider code; it is not assumed to denominate every price, NAV or asset-total field.', 'No live, delayed, session, timezone or freshness claim is inferred.'],
  });
}

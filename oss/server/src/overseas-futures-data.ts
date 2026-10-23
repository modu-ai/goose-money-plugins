import { z } from 'zod';

/** RC4-only, credential-free overseas futures research contract. No fetch fallback. */
export const OVERSEAS_FUTURES_MAX_RESPONSE_BYTES = 300_000;
const OriginSchema = z.enum(['actual', 'synthetic']);
// Narrow adapter policy for outright month/year series, not a product-master assertion.
const SeriesSchema = z.string().max(13).regex(/^[A-Z0-9]{1,10}[FGHJKMNQUVXZ]\d{2}$/);
const ExchangeSchema = z.string().min(1).max(8).regex(/^[A-Z0-9]+$/);
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);
const DecimalSchema = z.string().max(40).regex(/^-?\d+(?:\.\d+)?$/);
const NonnegativeDecimalSchema = z.string().max(40).regex(/^\d+(?:\.\d+)?$/);
const IntegerSchema = z.string().max(30).regex(/^\d+$/);
const SignedIntegerSchema = z.string().max(30).regex(/^-?\d+$/);
const BlankDecimalSchema = z.union([DecimalSchema, z.literal('')]);
const BlankIntegerSchema = z.union([IntegerSchema, z.literal('')]);
const DateSchema = z.string().regex(/^\d{8}$/).refine(value => {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, 'invalid_calendar_date');
const TimeSchema = z.string().regex(/^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/);
const BlankDateSchema = z.union([DateSchema, z.literal('')]);
const BlankTimeSchema = z.union([TimeSchema, z.literal('')]);
const ReceivedAtSchema = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));

export const OverseasFuturesQuoteInputSchema = z.object({
  symbol: SeriesSchema,
  // Local comparison expectations only, not transmitted or treated as master evidence.
  expected_exchange: ExchangeSchema.optional(),
  expected_currency: CurrencySchema.optional(),
}).strict();
export const OverseasFuturesRequestSchema = z.object({
  operation: z.literal('kis.overseas_futures_quote'),
  method: z.literal('GET'),
  path: z.literal('/uapi/overseas-futureoption/v1/quotations/inquire-price'),
  tr_id: z.literal('HHDFC55010000'),
  query: z.object({ SRS_CD: SeriesSchema }).strict(),
}).strict();
export type OverseasFuturesRequest = z.infer<typeof OverseasFuturesRequestSchema>;
export interface OverseasFuturesResponse { status: number; tr_cont: string | null; body: unknown }
export interface OverseasFuturesTransport {
  readonly origin: 'actual' | 'synthetic';
  /** A future network implementation must also enforce the byte bound while reading. */
  send(request: OverseasFuturesRequest): Promise<OverseasFuturesResponse>;
}
export type OverseasFuturesClock = () => string;
export type OverseasFuturesErrorCode = 'invalid_input' | 'transport_not_configured' | 'upstream_unavailable' |
  'rate_limited' | 'auth_expired' | 'upstream_rejected' | 'schema_drift' | 'response_too_large' |
  'pagination_not_supported' | 'instrument_mismatch' | 'identity_evidence_missing';
export class OverseasFuturesError extends Error {
  constructor(readonly code: OverseasFuturesErrorCode) { super(code); this.name = 'OverseasFuturesError'; }
}

/** Official quote fields only. Prices can be negative; no float conversion or scaling. */
export const OverseasFuturesQuoteRawSchema = z.object({
  proc_date: BlankDateSchema.optional(),
  high_price: BlankDecimalSchema.optional(),
  proc_time: BlankTimeSchema.optional(),
  open_price: BlankDecimalSchema.optional(),
  trst_mgn: z.union([NonnegativeDecimalSchema, z.literal('')]).optional(),
  low_price: BlankDecimalSchema.optional(),
  last_price: DecimalSchema,
  vol: BlankIntegerSchema.optional(),
  prev_diff_flag: z.string().max(8).optional(),
  prev_diff_price: BlankDecimalSchema.optional(),
  prev_diff_rate: BlankDecimalSchema.optional(),
  bid_qntt: BlankIntegerSchema.optional(),
  bid_price: BlankDecimalSchema.optional(),
  ask_qntt: BlankIntegerSchema.optional(),
  ask_price: BlankDecimalSchema.optional(),
  prev_price: BlankDecimalSchema.optional(),
  exch_cd: z.union([ExchangeSchema, z.literal('')]).optional(),
  crc_cd: z.union([CurrencySchema, z.literal('')]).optional(),
  trd_fr_date: BlankDateSchema.optional(),
  expr_date: BlankDateSchema.optional(),
  trd_to_date: BlankDateSchema.optional(),
  remn_cnt: z.union([SignedIntegerSchema, z.literal('')]).optional(),
  last_qntt: BlankIntegerSchema.optional(),
  tot_ask_qntt: BlankIntegerSchema.optional(),
  tot_bid_qntt: BlankIntegerSchema.optional(),
  tick_size: z.union([NonnegativeDecimalSchema, z.literal('')]).optional(),
  open_date: BlankDateSchema.optional(),
  open_time: BlankTimeSchema.optional(),
  close_date: BlankDateSchema.optional(),
  close_time: BlankTimeSchema.optional(),
  sbsnsdate: BlankDateSchema.optional(),
  sttl_price: BlankDecimalSchema.optional(),
}).strict();

const ProcessingTimeSchema = z.object({
  provider_date: DateSchema.nullable(),
  provider_time: TimeSchema.nullable(),
  timezone: z.null(),
  semantic: z.literal('provider_final_processing_not_verified_trade_time'),
  status: z.enum(['date_time_present_timezone_unverified', 'date_or_time_missing']),
}).strict();
export const OverseasFuturesQuoteResultSchema = z.object({
  contract: z.literal('moai.stock.overseas-futures-quote.v1'),
  provider: z.literal('kis'),
  origin: OriginSchema,
  received_at: ReceivedAtSchema,
  source_as_of: z.null(),
  source_time_status: z.literal('blocked_timezone_and_processing_semantics_not_reconciled'),
  rights_status: z.literal('pending'),
  validation_status: z.literal('provider_shape_checked_not_live_reconciled'),
  symbol_from_request: SeriesSchema,
  expected_exchange_from_request: ExchangeSchema.nullable(),
  expected_currency_from_request: CurrencySchema.nullable(),
  identity_status: z.literal('no_returned_contract_code'),
  expectation_status: z.enum(['not_requested', 'caller_metadata_expectations_matched_not_verified']),
  geographical_scope_status: z.literal('overseas_contract_us_listing_not_verified'),
  provider_output_shape: z.enum(['object', 'singleton_array']),
  processing_time: ProcessingTimeSchema,
  raw: OverseasFuturesQuoteRawSchema,
  canonical_projection_status: z.literal('blocked'),
  canonical: z.object({
    instrument_id: z.null(), underlying_id: z.null(), exchange: z.null(), country: z.null(), currency: z.null(),
    last_price: z.null(), previous_close: z.null(), open_price: z.null(), high_price: z.null(), low_price: z.null(),
    bid_price: z.null(), ask_price: z.null(), change: z.null(), change_percent: z.null(), volume: z.null(),
    settlement_price: z.null(), tick_size: z.null(), tick_value: z.null(), price_unit: z.null(), volume_unit: z.null(),
    contract_multiplier: z.null(), expiry_date: z.null(), last_trading_date: z.null(),
  }).strict(),
  mapping_blockers: z.array(z.string().min(1).max(200)).min(1).max(20),
  warnings: z.array(z.string().max(500)).max(20),
}).strict().superRefine((result, context) => {
  const date = result.raw.proc_date || null;
  const time = result.raw.proc_time || null;
  const status = date && time ? 'date_time_present_timezone_unverified' : 'date_or_time_missing';
  if (result.processing_time.provider_date !== date || result.processing_time.provider_time !== time || result.processing_time.status !== status) {
    context.addIssue({ code: 'custom', path: ['processing_time'], message: 'processing_time_provenance_mismatch' });
  }
  const expected = result.expected_exchange_from_request !== null || result.expected_currency_from_request !== null;
  if (result.expectation_status !== (expected ? 'caller_metadata_expectations_matched_not_verified' : 'not_requested') ||
      (result.expected_exchange_from_request !== null && result.raw.exch_cd !== result.expected_exchange_from_request) ||
      (result.expected_currency_from_request !== null && result.raw.crc_cd !== result.expected_currency_from_request)) {
    context.addIssue({ code: 'custom', path: ['expectation_status'], message: 'identity_expectation_mismatch' });
  }
});
export type OverseasFuturesQuoteResult = z.infer<typeof OverseasFuturesQuoteResultSchema>;

const ResponseSchema = z.object({ status: z.number().int().min(100).max(599), tr_cont: z.string().max(8).nullable(), body: z.unknown() }).strict();
const EnvelopeSchema = z.object({
  rt_cd: z.string().max(10), msg_cd: z.string().max(40).optional(), msg1: z.string().max(2000).optional(), output1: z.unknown().optional(),
}).strict();

function boundedBody(body: unknown): unknown {
  let nodes = 0;
  let bytes = 0;
  const seen = new Set<object>();
  function inspect(value: unknown, depth: number): void {
    if (++nodes > 10_000 || depth > 8) throw new OverseasFuturesError('response_too_large');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') {
      bytes += Buffer.byteLength(value, 'utf8');
      if (bytes > OVERSEAS_FUTURES_MAX_RESPONSE_BYTES) throw new OverseasFuturesError('response_too_large');
      return;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || value === null || seen.has(value)) throw new OverseasFuturesError('schema_drift');
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new OverseasFuturesError('schema_drift');
    seen.add(value);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some(key => typeof key !== 'string')) throw new OverseasFuturesError('schema_drift');
    const keys = (ownKeys as string[]).filter(key => !(Array.isArray(value) && key === 'length'));
    if (keys.length > 1000) throw new OverseasFuturesError('response_too_large');
    for (const key of keys) {
      bytes += Buffer.byteLength(key, 'utf8');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) throw new OverseasFuturesError('schema_drift');
      inspect(descriptor.value, depth + 1);
    }
    seen.delete(value);
  }
  inspect(body, 0);
  let serialized: string | undefined;
  try { serialized = JSON.stringify(body); } catch { throw new OverseasFuturesError('schema_drift'); }
  if (serialized === undefined) throw new OverseasFuturesError('schema_drift');
  if (Buffer.byteLength(serialized, 'utf8') > OVERSEAS_FUTURES_MAX_RESPONSE_BYTES) throw new OverseasFuturesError('response_too_large');
  return JSON.parse(serialized) as unknown;
}

export async function requestOverseasFuturesQuote(
  input: unknown,
  transport?: OverseasFuturesTransport,
  clock: OverseasFuturesClock = () => new Date().toISOString(),
): Promise<OverseasFuturesQuoteResult> {
  const parsedInput = OverseasFuturesQuoteInputSchema.safeParse(input);
  if (!parsedInput.success || typeof clock !== 'function') throw new OverseasFuturesError('invalid_input');
  const q = parsedInput.data;
  if (!transport) throw new OverseasFuturesError('transport_not_configured');
  const origin = OriginSchema.safeParse(transport.origin);
  if (!origin.success || typeof transport.send !== 'function') throw new OverseasFuturesError('invalid_input');
  const request = OverseasFuturesRequestSchema.parse({
    operation: 'kis.overseas_futures_quote', method: 'GET',
    path: '/uapi/overseas-futureoption/v1/quotations/inquire-price', tr_id: 'HHDFC55010000',
    query: { SRS_CD: q.symbol },
  });
  Object.freeze(request.query); Object.freeze(request);
  let response: unknown;
  try { response = await transport.send(request); } catch { throw new OverseasFuturesError('upstream_unavailable'); }
  let receivedAt: unknown;
  try { receivedAt = clock(); } catch { throw new OverseasFuturesError('invalid_input'); }
  const time = ReceivedAtSchema.safeParse(receivedAt);
  if (!time.success) throw new OverseasFuturesError('invalid_input');
  const r = ResponseSchema.safeParse(response);
  if (!r.success) throw new OverseasFuturesError('schema_drift');
  if (r.data.status === 429) throw new OverseasFuturesError('rate_limited');
  if (r.data.status === 401 || r.data.status === 403) throw new OverseasFuturesError('auth_expired');
  if (r.data.status < 200 || r.data.status >= 300) throw new OverseasFuturesError('upstream_unavailable');
  if (r.data.tr_cont === 'M' || r.data.tr_cont === 'F') throw new OverseasFuturesError('pagination_not_supported');
  if (![null, '', 'D', 'E'].includes(r.data.tr_cont)) throw new OverseasFuturesError('schema_drift');
  const envelope = EnvelopeSchema.safeParse(boundedBody(r.data.body));
  if (!envelope.success) throw new OverseasFuturesError('schema_drift');
  if (envelope.data.rt_cd !== '0') throw new OverseasFuturesError('upstream_rejected');
  const output = envelope.data.output1;
  if (Array.isArray(output) && output.length !== 1) throw new OverseasFuturesError('schema_drift');
  const parsedRaw = OverseasFuturesQuoteRawSchema.safeParse(Array.isArray(output) ? output[0] : output);
  if (!parsedRaw.success) throw new OverseasFuturesError('schema_drift');
  const raw = parsedRaw.data;
  for (const [expected, returned] of [[q.expected_exchange, raw.exch_cd], [q.expected_currency, raw.crc_cd]]) {
    if (expected === undefined) continue;
    if (returned === undefined || returned === '') throw new OverseasFuturesError('identity_evidence_missing');
    if (returned !== expected) throw new OverseasFuturesError('instrument_mismatch');
  }
  const date = raw.proc_date || null;
  const localTime = raw.proc_time || null;
  return OverseasFuturesQuoteResultSchema.parse({
    contract: 'moai.stock.overseas-futures-quote.v1', provider: 'kis', origin: origin.data, received_at: time.data,
    source_as_of: null, source_time_status: 'blocked_timezone_and_processing_semantics_not_reconciled',
    rights_status: 'pending', validation_status: 'provider_shape_checked_not_live_reconciled',
    symbol_from_request: q.symbol, expected_exchange_from_request: q.expected_exchange ?? null,
    expected_currency_from_request: q.expected_currency ?? null, identity_status: 'no_returned_contract_code',
    expectation_status: q.expected_exchange !== undefined || q.expected_currency !== undefined ? 'caller_metadata_expectations_matched_not_verified' : 'not_requested',
    geographical_scope_status: 'overseas_contract_us_listing_not_verified',
    provider_output_shape: Array.isArray(output) ? 'singleton_array' : 'object',
    processing_time: { provider_date: date, provider_time: localTime, timezone: null,
      semantic: 'provider_final_processing_not_verified_trade_time', status: date && localTime ? 'date_time_present_timezone_unverified' : 'date_or_time_missing' },
    raw, canonical_projection_status: 'blocked',
    canonical: { instrument_id: null, underlying_id: null, exchange: null, country: null, currency: null,
      last_price: null, previous_close: null, open_price: null, high_price: null, low_price: null, bid_price: null, ask_price: null,
      change: null, change_percent: null, volume: null, settlement_price: null, tick_size: null, tick_value: null,
      price_unit: null, volume_unit: null, contract_multiplier: null, expiry_date: null, last_trading_date: null },
    mapping_blockers: ['returned_contract_code_missing', 'authoritative_contract_and_us_exchange_binding_missing',
      'price_display_basis_currency_and_quantity_units_not_reconciled', 'contract_multiplier_not_returned',
      'expiry_and_final_trading_date_not_bound_to_verified_contract', 'provider_processing_time_timezone_and_trade_time_semantics_not_reconciled'],
    warnings: ['This overseas-futures endpoint does not by itself verify a US-listed contract or the requested series identity.',
      'Exchange/currency expectations are caller mismatch guards, not authoritative evidence.',
      'Raw processing, business, expiry and final-trading dates stay separate. No timezone, source instant or freshness is invented.',
      'Tick size is not tick value or a contract multiplier. Raw prices can be negative and are never rounded, scaled or converted.',
      'Entitlements and redistribution rights are pending; no market-data subscription or live provider reconciliation was performed.'],
  });
}

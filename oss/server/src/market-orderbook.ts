import { z } from 'zod';
import { ExactInstantSchema } from './exact-instant.js';
import { GlobalMarketError } from './global-market-data.js';
import { sanitizedKisError } from './kis-sanitized-error.js';
import { snapshotMarketJson, freezeMarket, marketCanonicalJson } from './market-reference-snapshot.js';

/** A bounded raw-only REST subset, never a live/firm/atomic canonical book. */
export const MARKET_ORDERBOOK_MAX_RESPONSE_BYTES = 200_000;
export const MARKET_REFERENCE_SOURCE_COMMIT = '2077773a69a428daf63e148182511f068cc45de3';
const SymbolCode = z.string().regex(/^\d{6}$/);
const Board = z.enum(['J', 'NX', 'UN']);
const Origin = z.enum(['actual', 'synthetic']);
const Text = z.string().max(200);
const Continuation = z.enum(['', 'D', 'E']).nullable();
export const MarketOrderbookInputSchema = z.object({ symbol: SymbolCode, board: Board }).strict();
export const MarketOrderbookRequestSchema = z.object({
  operation: z.literal('kis.market_orderbook'), method: z.literal('GET'),
  path: z.literal('/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn'),
  tr_id: z.literal('FHKST01010200'), tr_cont: z.literal(''),
  query: z.object({ FID_COND_MRKT_DIV_CODE: Board, FID_INPUT_ISCD: SymbolCode }).strict(),
}).strict();
export type MarketOrderbookInput = z.infer<typeof MarketOrderbookInputSchema>;
export type MarketOrderbookRequest = z.infer<typeof MarketOrderbookRequestSchema>;
export interface MarketOrderbookResponse { status: number; tr_cont: string | null; body: unknown }
export interface MarketOrderbookTransport {
  readonly origin: 'actual' | 'synthetic';
  /** Future implementations must also enforce a byte limit during receipt, before decoding. */
  send(request: MarketOrderbookRequest): Promise<MarketOrderbookResponse>;
}
export type MarketOrderbookErrorCode = 'invalid_input' | 'transport_not_configured' | 'upstream_unavailable' |
  'rate_limited' | 'auth_expired' | 'upstream_rejected' | 'schema_drift' | 'response_too_large' |
  'pagination_not_supported' | 'instrument_mismatch';
export class MarketOrderbookError extends Error {
  constructor(readonly code: MarketOrderbookErrorCode) { super(code); this.name = 'MarketOrderbookError'; }
}
function fail(code: MarketOrderbookErrorCode): never { throw new MarketOrderbookError(code); }

// This is the shared official dictionary, NOT a proven complete output1 field partition.
// Strings are preserved as text, including blank and unsupported numeric text.
const fields: Record<string, z.ZodOptional<typeof Text>> = {};
for (let level = 1; level <= 10; level++) {
  for (const prefix of ['askp', 'bidp', 'askp_rsqn', 'bidp_rsqn', 'askp_rsqn_icdc', 'bidp_rsqn_icdc']) fields[`${prefix}${level}`] = Text.optional();
}
for (const key of ['aspr_acpt_hour', 'total_askp_rsqn', 'total_bidp_rsqn', 'total_askp_rsqn_icdc', 'total_bidp_rsqn_icdc',
  'ovtm_total_askp_icdc', 'ovtm_total_bidp_icdc', 'ovtm_total_askp_rsqn', 'ovtm_total_bidp_rsqn', 'ntby_aspr_rsqn',
  'new_mkop_cls_code', 'antc_mkop_cls_code', 'stck_prpr', 'stck_oprc', 'stck_hgpr', 'stck_lwpr', 'stck_sdpr',
  'antc_cnpr', 'antc_cntg_vrss_sign', 'antc_cntg_vrss', 'antc_cntg_prdy_ctrt', 'antc_vol', 'stck_shrn_iscd', 'vi_cls_code']) fields[key] = Text.optional();
export const MarketOrderbookOutput1Schema = z.object(fields).strict();
// A deliberately bounded JSON subset. Cardinality, field partition and meaning stay unverified.
const Scalar = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]);
const Json1 = z.union([Scalar, z.array(Scalar).max(100), z.record(z.string().max(100), Scalar)]);
const Json2 = z.union([Scalar, z.array(Json1).max(100), z.record(z.string().max(100), Json1)]);
export const MarketOrderbookOutput2Schema = z.union([z.array(Json2).max(100), z.record(z.string().max(100), Json2)]);
export const MarketOrderbookRawSchema = z.object({ output1: MarketOrderbookOutput1Schema, output2: MarketOrderbookOutput2Schema }).strict();
const identityStatus = z.enum(['no_nonblank_symbol_echo', 'conservative_symbol_echo_matched_not_master_verified']);
function checkEchoes(raw: unknown, symbol: string): z.infer<typeof identityStatus> {
  let matched = false;
  function visit(value: unknown): void {
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'stck_shrn_iscd') {
        if (typeof child !== 'string') fail('schema_drift');
        if (child.trim() !== '') {
          // No trimming or coercion of nonblank codes; unsupported echo forms fail closed.
          if (child !== symbol) fail('instrument_mismatch');
          matched = true;
        }
      }
      visit(child);
    }
  }
  visit(raw);
  return matched ? 'conservative_symbol_echo_matched_not_master_verified' : 'no_nonblank_symbol_echo';
}
export function makeMarketOrderbookRequest(q: MarketOrderbookInput): MarketOrderbookRequest {
  return MarketOrderbookRequestSchema.parse({ operation: 'kis.market_orderbook', method: 'GET',
    path: '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn', tr_id: 'FHKST01010200', tr_cont: '',
    query: { FID_COND_MRKT_DIV_CODE: q.board, FID_INPUT_ISCD: q.symbol } });
}
export const MarketOrderbookResultSchema = z.object({
  contract: z.literal('moai.stock.market-orderbook.v1'), provider: z.literal('kis'), origin: Origin,
  source_commit: z.literal(MARKET_REFERENCE_SOURCE_COMMIT), requested: MarketOrderbookInputSchema,
  source_request: MarketOrderbookRequestSchema, received_at: ExactInstantSchema,
  source_at: z.null(), published_at: z.null(), available_at: z.null(), source_timezone: z.null(), session: z.null(),
  source_time_status: z.literal('raw_clock_text_only_no_date_timezone_or_exact_instant'),
  identity_status: identityStatus, market_identity_status: z.literal('requested_board_only_no_verified_market_echo'),
  field_partition_status: z.literal('shared_dictionary_not_complete_per_object_partition'),
  output2_status: z.literal('raw_json_shape_retained_cardinality_and_semantics_unverified'),
  quote_firmness: z.literal('unverified'), simultaneous_quotes_verified: z.literal(false),
  source_authenticated: z.literal(false), rights_status: z.literal('pending'),
  validation_status: z.literal('bounded_raw_subset_not_live_reconciled'), metric_ready: z.literal(false),
  canonical_observation: z.null(), canonical_projection_status: z.literal('blocked'),
  canonical: z.object({ instrument_id: z.null(), asset_class: z.null(), exchange: z.null(), currency: z.null(),
    price_unit: z.null(), quantity_unit: z.null(), best_bid: z.null(), best_ask: z.null(), spread: z.null() }).strict(),
  pagination: z.object({ responses_received: z.literal(1), tr_cont: Continuation, automatic_continuation: z.literal(false) }).strict(),
  raw: MarketOrderbookRawSchema,
  mapping_blockers: z.array(z.string().min(1).max(200)).min(1).max(20),
  warnings: z.array(z.string().min(1).max(500)).min(1).max(20),
}).strict().superRefine((r, c) => {
  if (MarketOrderbookInputSchema.safeParse(r.requested).success && marketCanonicalJson(r.source_request) !== marketCanonicalJson(makeMarketOrderbookRequest(r.requested))) c.addIssue({ code: 'custom', message: 'request_context_mismatch' });
  try { if (checkEchoes(r.raw, r.requested.symbol) !== r.identity_status) c.addIssue({ code: 'custom', message: 'echo_status_mismatch' }); }
  catch { c.addIssue({ code: 'custom', message: 'instrument_echo_invalid' }); }
});
export type MarketOrderbookResult = z.infer<typeof MarketOrderbookResultSchema>;
function checked<T>(schema: z.ZodType<T>, value: unknown, code: MarketOrderbookErrorCode): T {
  const result = schema.safeParse(value); if (!result.success) fail(code); return result.data;
}
function snapshot(value: unknown, maxBytes = MARKET_ORDERBOOK_MAX_RESPONSE_BYTES, maxNodes = 10_000, maxKeys = 1000): unknown {
  try { return snapshotMarketJson(value, maxBytes, maxNodes, maxKeys); }
  catch (e) { fail(e instanceof GlobalMarketError && e.code === 'response_too_large' ? 'response_too_large' : 'schema_drift'); }
}
/** Pure reconstruction shared with offline replay. No transport or live authorization is implied. */
export function reconstructMarketOrderbookResult(input: unknown, raw: unknown, provenance: unknown) {
  const q = checked(MarketOrderbookInputSchema, snapshot(input, 2000, 30, 20), 'invalid_input');
  const p = checked(z.object({ origin: Origin, received_at: ExactInstantSchema, tr_cont: Continuation }).strict(), snapshot(provenance, 2000, 30, 20), 'invalid_input');
  const rawSnapshot = snapshot(raw);
  const body = checked(MarketOrderbookRawSchema, rawSnapshot, 'schema_drift');
  if (marketCanonicalJson(rawSnapshot) !== marketCanonicalJson(body)) fail('schema_drift');
  const identity = checkEchoes(body, q.symbol);
  return freezeMarket(checked(MarketOrderbookResultSchema, {
    contract: 'moai.stock.market-orderbook.v1', provider: 'kis', origin: p.origin, source_commit: MARKET_REFERENCE_SOURCE_COMMIT,
    requested: q, source_request: makeMarketOrderbookRequest(q), received_at: p.received_at,
    source_at: null, published_at: null, available_at: null, source_timezone: null, session: null,
    source_time_status: 'raw_clock_text_only_no_date_timezone_or_exact_instant', identity_status: identity,
    market_identity_status: 'requested_board_only_no_verified_market_echo', field_partition_status: 'shared_dictionary_not_complete_per_object_partition',
    output2_status: 'raw_json_shape_retained_cardinality_and_semantics_unverified', quote_firmness: 'unverified',
    simultaneous_quotes_verified: false, source_authenticated: false, rights_status: 'pending',
    validation_status: 'bounded_raw_subset_not_live_reconciled', metric_ready: false, canonical_observation: null,
    canonical_projection_status: 'blocked', canonical: { instrument_id: null, asset_class: null, exchange: null, currency: null,
      price_unit: null, quantity_unit: null, best_bid: null, best_ask: null, spread: null },
    pagination: { responses_received: 1, tr_cont: p.tr_cont, automatic_continuation: false }, raw: body,
    mapping_blockers: ['source_authenticity_and_rights_unverified', 'complete_source_field_partition_and_cardinality_unverified',
      'security_class_venue_listing_and_split_basis_unverified', 'currency_price_scale_and_quantity_units_unverified',
      'source_date_timezone_and_exact_instant_unverified', 'firm_regular_session_atomic_book_unverified', 'publication_freshness_and_delay_unverified'],
    warnings: ['Public source field labels and synthetic tests are not a live response contract or market-data permission.',
      'output1 is a raw book candidate. output2 remains unchanged and is never flattened or promoted to firm bid/ask/last.',
      'Matching symbol echoes are conservative guards, not issuer, class, listing or market verification. UN is not a verified single venue.',
      'Receipt is local and post-response only. aspr_acpt_hour remains exact raw text, never combined with a date or timezone.',
      'A shared response does not prove simultaneous or firm quotes. Blank, zero, malformed text and crossed raw prices are not repaired.'],
  }, 'schema_drift'));
}
export async function requestMarketOrderbook(input: unknown, transport?: MarketOrderbookTransport, clock: () => string = () => new Date().toISOString()) {
  let q: MarketOrderbookInput;
  try { q = checked(MarketOrderbookInputSchema, snapshotMarketJson(input, 2000, 30, 20), 'invalid_input'); }
  catch { fail('invalid_input'); }
  if (!transport) fail('transport_not_configured');
  let origin: 'actual' | 'synthetic';
  try { origin = checked(Origin, transport.origin, 'invalid_input'); if (typeof transport.send !== 'function' || typeof clock !== 'function') fail('invalid_input'); }
  catch { fail('invalid_input'); }
  const request = makeMarketOrderbookRequest(q);
  Object.freeze(request.query); Object.freeze(request);
  let response: unknown;
  try { response = await transport.send(request); } catch (e) { throw sanitizedKisError(e) ?? new MarketOrderbookError('upstream_unavailable'); }
  let receipt: unknown;
  try { receipt = clock(); } catch { fail('invalid_input'); }
  const received_at = checked(ExactInstantSchema, receipt, 'invalid_input');
  const r = checked(z.object({ status: z.number().int().min(100).max(599), tr_cont: z.string().max(8).nullable(), body: z.unknown() }).strict(), snapshot(response), 'schema_drift');
  if (r.status === 429) fail('rate_limited');
  if (r.status === 401 || r.status === 403) fail('auth_expired');
  if (r.status < 200 || r.status >= 300) fail('upstream_unavailable');
  if (r.tr_cont === 'M' || r.tr_cont === 'F') fail('pagination_not_supported');
  const continuation = checked(Continuation, r.tr_cont, 'schema_drift');
  const envelope = checked(z.object({ rt_cd: z.string().max(10), msg_cd: z.string().max(40).optional(), msg1: z.string().max(2000).optional(),
    output1: z.unknown().optional(), output2: z.unknown().optional() }).strict(), r.body, 'schema_drift');
  if (envelope.rt_cd !== '0') fail('upstream_rejected');
  return reconstructMarketOrderbookResult(q, { output1: envelope.output1, output2: envelope.output2 }, { origin, received_at, tr_cont: continuation });
}

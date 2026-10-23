import { z } from 'zod';
import { ExactInstantSchema, compareInstants } from './exact-instant.js';
import { UsQuoteResultSchema, GlobalMarketRequestSchema, GlobalMarketError } from './global-market-data.js';
import { KrIntradayHistoryResultSchema, KrIntradayHistoryRequestSchema } from './history-breadth.js';
import { MarketOrderbookResultSchema, MarketOrderbookRequestSchema, reconstructMarketOrderbookResult, MARKET_REFERENCE_SOURCE_COMMIT } from './market-orderbook.js';
import { snapshotMarketJson, marketCanonicalJson, marketDigest, freezeMarket } from './market-reference-snapshot.js';

/** Existing report destination labels only; no canonical role binding or metric calculation. */
export const MARKET_REFERENCE_POLICIES = Object.freeze(['kr_orderbook_best_bid', 'kr_orderbook_best_ask', 'us_quote_previous_close', 'kr_intraday_previous_close'] as const);
export const MARKET_REFERENCE_MAX_BYTES = 500_000;
const Controls = { cutoff: ExactInstantSchema };
export const MarketReferenceEvidenceInputSchema = z.discriminatedUnion('policy', [
  z.object({ ...Controls, policy: z.literal('kr_orderbook_best_bid'), requested_role: z.literal('market.best_bid'), source_dto: MarketOrderbookResultSchema }).strict(),
  z.object({ ...Controls, policy: z.literal('kr_orderbook_best_ask'), requested_role: z.literal('market.best_ask'), source_dto: MarketOrderbookResultSchema }).strict(),
  z.object({ ...Controls, policy: z.literal('us_quote_previous_close'), requested_role: z.literal('market.previous_close'), source_dto: UsQuoteResultSchema }).strict(),
  z.object({ ...Controls, policy: z.literal('kr_intraday_previous_close'), requested_role: z.literal('market.previous_close'), source_dto: KrIntradayHistoryResultSchema }).strict(),
]);
export type MarketReferenceEvidenceErrorCode = 'invalid_input' | 'invalid_source_snapshot' | 'snapshot_too_large' |
  'source_normalization_conflict' | 'instrument_mismatch' | 'future_receipt' | 'candidate_mismatch';
export class MarketReferenceEvidenceError extends Error {
  constructor(readonly code: MarketReferenceEvidenceErrorCode) { super(code); this.name = 'MarketReferenceEvidenceError'; }
}
function fail(code: MarketReferenceEvidenceErrorCode): never { throw new MarketReferenceEvidenceError(code); }
function snapshot(value: unknown): unknown {
  try { return snapshotMarketJson(value, MARKET_REFERENCE_MAX_BYTES); }
  catch (e) { fail(e instanceof GlobalMarketError && e.code === 'response_too_large' ? 'snapshot_too_large' : 'invalid_source_snapshot'); }
}
const same = (a: unknown, b: unknown) => marketCanonicalJson(a) === marketCanonicalJson(b);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const SourceDto = z.union([MarketOrderbookResultSchema, UsQuoteResultSchema, KrIntradayHistoryResultSchema]);
const SourceRequest = z.union([MarketOrderbookRequestSchema, GlobalMarketRequestSchema, KrIntradayHistoryRequestSchema]);
const CandidateBodySchema = z.object({
  contract: z.literal('moai.market.selected-reference-evidence.v1'),
  status: z.literal('selected_raw_evidence_candidate_only'),
  policy: z.enum(MARKET_REFERENCE_POLICIES), cutoff: ExactInstantSchema,
  requested_role: z.enum(['market.best_bid', 'market.best_ask', 'market.previous_close']),
  role_association_status: z.literal('requested_destination_label_not_semantic_binding'),
  provider: z.literal('kis'), origin: z.enum(['actual', 'synthetic']),
  source_commit: z.literal(MARKET_REFERENCE_SOURCE_COMMIT),
  source_request: SourceRequest,
  request_evidence_status: z.enum(['retained_orderbook_request_not_authenticated_http_receipt', 'reconstructed_from_existing_dto_not_original_http_receipt']),
  selected: z.object({
    dto_selector: z.enum(['$.raw.output1.bidp1', '$.raw.output1.askp1', '$.raw.base', '$.raw.output1.stck_prdy_clpr']),
    provider_selector: z.enum(['$.output1.bidp1', '$.output1.askp1', '$.output.base', '$.output1.stck_prdy_clpr']),
    raw_lexeme: z.string().max(200).nullable(),
    raw_state: z.enum(['missing', 'blank', 'decimal_text_candidate', 'unsupported_raw_text']),
    lexical_profile: z.literal('ascii_unsigned_decimal_max_40_chars_no_whitespace_sign_exponent_or_grouping'),
    lexical_status_note: z.literal('syntax_only_not_economic_validity_units_or_canonical_value'),
  }).strict(),
  received_at: ExactInstantSchema, receipt_status: z.literal('local_receipt_not_source_or_publication_time'),
  source_at: z.null(), published_at: z.null(), available_at: z.null(), session: z.null(), previous_session_id: z.null(),
  previous_session_close_at: z.null(), currency: z.null(), price_unit: z.null(), split_basis: z.null(),
  source_authenticated: z.literal(false), identity_verified: z.literal(false), semantic_binding_verified: z.literal(false),
  simultaneous_quotes_verified: z.literal(false), quote_firmness: z.literal('unverified'),
  rights_status: z.literal('pending'), canonical_observation: z.null(), metric_ready: z.literal(false),
  snapshot: z.object({ value: SourceDto, sha256, hash_algorithm: z.literal('sha256'),
    serialization: z.literal('sorted_object_keys_json_utf8_v1'), hash_scope: z.literal('whole_validated_provider_dto_snapshot'),
    original_http_body_hash: z.null(), source_authentication: z.literal(false) }).strict(),
  mapping_blockers: z.array(z.string().min(1).max(200)).min(1).max(20),
  warnings: z.array(z.string().min(1).max(500)).min(1).max(20),
}).strict();
export const MarketReferenceEvidenceCandidateSchema = CandidateBodySchema.extend({ integrity: z.object({
  sha256, hash_algorithm: z.literal('sha256'), serialization: z.literal('sorted_object_keys_json_utf8_v1'),
  scope: z.literal('candidate_except_integrity'), source_authentication: z.literal(false),
}).strict() }).strict();

function lexical(value: string | undefined) {
  const raw_state = value === undefined ? 'missing' as const : value === '' ? 'blank' as const :
    value.length <= 40 && /^\d+(?:\.\d+)?$/.test(value) ? 'decimal_text_candidate' as const : 'unsupported_raw_text' as const;
  return { raw_lexeme: value ?? null, raw_state,
    lexical_profile: 'ascii_unsigned_decimal_max_40_chars_no_whitespace_sign_exponent_or_grouping' as const,
    lexical_status_note: 'syntax_only_not_economic_validity_units_or_canonical_value' as const };
}
/** Pure finite-field selection. No caller paths, numeric conversion, implied reference or network. */
export function selectMarketReferenceEvidence(value: unknown) {
  const safe = snapshot(value);
  const parsed = MarketReferenceEvidenceInputSchema.safeParse(safe);
  if (!parsed.success) fail('invalid_input');
  const q = parsed.data, source = q.source_dto;
  if (!same(safe, q)) fail('source_normalization_conflict');
  if (!ExactInstantSchema.safeParse(source.received_at).success) fail('invalid_input');
  if (compareInstants(source.received_at, q.cutoff) > 0) fail('future_receipt');
  let raw: string | undefined, dtoSelector: string, providerSelector: string;
  let request: z.infer<typeof SourceRequest>;
  let requestStatus: z.infer<typeof CandidateBodySchema>['request_evidence_status'];
  if (q.policy === 'kr_orderbook_best_bid' || q.policy === 'kr_orderbook_best_ask') {
    const s = q.source_dto;
    let reconstructed: unknown;
    try { reconstructed = reconstructMarketOrderbookResult(s.requested, s.raw, { origin: s.origin, received_at: s.received_at, tr_cont: s.pagination.tr_cont }); }
    catch { fail('source_normalization_conflict'); }
    if (!same(s, reconstructed)) fail('source_normalization_conflict');
    const field = q.policy === 'kr_orderbook_best_bid' ? 'bidp1' : 'askp1';
    raw = s.raw.output1[field]; dtoSelector = `$.raw.output1.${field}`; providerSelector = `$.output1.${field}`;
    request = s.source_request; requestStatus = 'retained_orderbook_request_not_authenticated_http_receipt';
  } else if (q.policy === 'us_quote_previous_close') {
    const s = q.source_dto;
    if (s.raw.rsym !== `D${s.exchange_from_request}${s.symbol_from_request}`) fail('instrument_mismatch');
    raw = s.raw.base; dtoSelector = '$.raw.base'; providerSelector = '$.output.base';
    request = { operation: 'kis.us_quote', method: 'GET', path: '/uapi/overseas-price/v1/quotations/price', tr_id: 'HHDFS00000300',
      query: { AUTH: '', EXCD: s.exchange_from_request, SYMB: s.symbol_from_request } };
    requestStatus = 'reconstructed_from_existing_dto_not_original_http_receipt';
  } else {
    const s = q.source_dto, r = s.requested;
    raw = s.raw.output1.stck_prdy_clpr; dtoSelector = '$.raw.output1.stck_prdy_clpr'; providerSelector = '$.output1.stck_prdy_clpr';
    request = { operation: 'kis.kr_intraday_history', method: 'GET', path: '/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice',
      tr_id: 'FHKST03010200', tr_cont: '', query: { FID_COND_MRKT_DIV_CODE: r.board, FID_INPUT_ISCD: r.symbol,
        FID_INPUT_HOUR_1: r.anchor_time, FID_PW_DATA_INCU_YN: r.include_past_data, FID_ETC_CLS_CODE: '' } };
    requestStatus = 'reconstructed_from_existing_dto_not_original_http_receipt';
  }
  const body = CandidateBodySchema.parse({
    contract: 'moai.market.selected-reference-evidence.v1', status: 'selected_raw_evidence_candidate_only',
    policy: q.policy, cutoff: q.cutoff, requested_role: q.requested_role,
    role_association_status: 'requested_destination_label_not_semantic_binding', provider: 'kis', origin: source.origin,
    source_commit: MARKET_REFERENCE_SOURCE_COMMIT, source_request: request, request_evidence_status: requestStatus,
    selected: { dto_selector: dtoSelector, provider_selector: providerSelector, ...lexical(raw) },
    received_at: source.received_at, receipt_status: 'local_receipt_not_source_or_publication_time',
    source_at: null, published_at: null, available_at: null, session: null, previous_session_id: null, previous_session_close_at: null,
    currency: null, price_unit: null, split_basis: null, source_authenticated: false, identity_verified: false,
    semantic_binding_verified: false, simultaneous_quotes_verified: false, quote_firmness: 'unverified',
    rights_status: 'pending', canonical_observation: null, metric_ready: false,
    snapshot: { value: source, sha256: marketDigest(source), hash_algorithm: 'sha256', serialization: 'sorted_object_keys_json_utf8_v1',
      hash_scope: 'whole_validated_provider_dto_snapshot', original_http_body_hash: null, source_authentication: false },
    mapping_blockers: ['source_authenticity_and_current_rights_unverified', 'security_class_venue_and_split_basis_unverified',
      'currency_scale_and_one_share_price_unit_unverified', 'exact_source_publication_and_availability_instants_unverified',
      'official_previous_session_reference_unverified', 'firm_regular_session_and_same_instant_book_unverified'],
    warnings: ['Finite raw field selection only. Existing market.* names are requested destination labels, not verified report inputs.',
      'Whole DTO and candidate SHA256 are deterministic integrity links, not original HTTP-body hashes, signatures or source authentication.',
      'No last-minus-change, stck_sdpr substitution, output2 indicative promotion, zdiv scaling or currency inference occurs.',
      'Receipt time and intraday bar dates/times never date an orderbook clock or an output1 prior-close header.',
      'A decimal-text syntax candidate may be zero, stale, crossed or economically invalid. No canonical value or metric is computed.',
      'This selector does not authorize acquisition, persistence, model-host egress, derived use, export or redistribution.'],
  });
  return freezeMarket(MarketReferenceEvidenceCandidateSchema.parse({ ...body, integrity: {
    sha256: marketDigest(body), hash_algorithm: 'sha256', serialization: 'sorted_object_keys_json_utf8_v1',
    scope: 'candidate_except_integrity', source_authentication: false,
  } }));
}
export type MarketReferenceEvidenceCandidate = ReturnType<typeof selectMarketReferenceEvidence>;
/** Full persisted replay: reconstruct deterministic output and compare every field, not booleans/digests alone. */
export function validateMarketReferenceEvidenceCandidate(value: unknown): MarketReferenceEvidenceCandidate {
  const safe = snapshot(value);
  const parsed = MarketReferenceEvidenceCandidateSchema.safeParse(safe);
  if (!parsed.success) fail('candidate_mismatch');
  const r = parsed.data;
  let expected: MarketReferenceEvidenceCandidate;
  try { expected = selectMarketReferenceEvidence({ policy: r.policy, cutoff: r.cutoff, requested_role: r.requested_role, source_dto: r.snapshot.value }); }
  catch { fail('candidate_mismatch'); }
  if (!same(safe, expected)) fail('candidate_mismatch');
  return expected;
}

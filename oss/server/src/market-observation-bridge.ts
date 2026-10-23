import { types } from 'node:util';
import { z } from 'zod';
import runtimePin from '../contracts/report-market-observation-reference/pin.json' with { type: 'json' };
import { ExactInstantSchema, compareInstants } from './exact-instant.js';
import { UsQuoteResultSchema, requestUsQuote } from './global-market-data.js';
import { MarketOrderbookResultSchema, reconstructMarketOrderbookResult } from './market-orderbook.js';
import { selectMarketReferenceEvidence, MarketReferenceEvidenceCandidateSchema } from './market-reference-evidence.js';
import { marketCanonicalJson, marketDigest, freezeMarket } from './market-reference-snapshot.js';

/** Offline supplied-assertion assembly. No production verifier, provider acquisition or MCP route. */
export const MARKET_OBSERVATION_POLICIES = Object.freeze(['us_equity_change', 'kr_equity_spread'] as const);
export const MARKET_OBSERVATION_AXES = Object.freeze(['original_bytes_dto_linkage', 'identity', 'field_semantics', 'units_currency_scales',
  'observation_reference_sessions', 'adjustment_basis', 'publication_availability', 'market_state', 'quote_firmness_simultaneity', 'finality_revision', 'rights'] as const);
const ROLES = Object.freeze(['market.last', 'market.previous_close', 'market.provider_change_pct', 'market.best_bid', 'market.best_ask'] as const);
const Role = z.enum(ROLES);
const Text = z.string().min(1).max(256).refine(s => s.trim() === s && !/[\u0000-\u001f\u007f]/.test(s));
const Id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/).refine(s => s.trim() === s);
const SHA = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const Scale = z.string().max(26).regex(/^(?:10{0,12}|0\.0{0,11}1)$/).refine(s => s.trim() === s);
const Decimal = z.string().max(40).regex(/^-?\d+(?:\.\d+)?$/).refine(s => s.trim() === s);
const Instant = ExactInstantSchema.refine(s => {
  if (s.length > 80) return false;
  const year = new Date(s.replace(/\.\d+(Z|[+-]\d{2}:\d{2})$/, '$1')).getUTCFullYear();
  return Number(s.slice(0, 4)) >= 1 && year >= 1 && year <= 9999;
});
const Refs = z.array(Id).min(1).max(16).refine(a => new Set(a).size === a.length);
const Evidence = z.object({ original_bytes_dto_linkage: Refs, identity: Refs, field_semantics: Refs, units_currency_scales: Refs,
  observation_reference_sessions: Refs, adjustment_basis: Refs, publication_availability: Refs, market_state: Refs,
  quote_firmness_simultaneity: Refs, finality_revision: Refs, rights: Refs }).strict();
const Locator = z.string().min(1).max(512).refine(s => {
  try { const u = new URL(s); return ['https:', 'synthetic:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash && !/[\u0000-\u0020\u007f]/.test(s); } catch { return false; }
});
const Artifact = z.object({ id: Id, data_kind: z.enum(['synthetic', 'actual']), digest_kind: z.enum(['original_bytes', 'review_record', 'synthetic_fixture']),
  sha256: SHA, locator: Locator, snapshot: z.object({ source_dto_sha256: SHA, received_at: Instant }).strict().nullable() }).strict();
const Source = z.union([UsQuoteResultSchema, MarketOrderbookResultSchema]);
const Selection = z.object({ role: Role, dto_selector: z.enum(['$.raw.last', '$.raw.base', '$.raw.rate', '$.raw.output1.bidp1', '$.raw.output1.askp1']),
  provider_selector: z.enum(['$.output.last', '$.output.base', '$.output.rate', '$.output1.bidp1', '$.output1.askp1']), raw_lexeme: z.string().max(200).nullable(),
  raw_state: z.enum(['missing', 'blank', 'decimal_text_candidate', 'unsupported_raw_text']), canonical_observation: z.null(), metric_ready: z.literal(false) }).strict();
export const MarketObservationSelectionInputSchema = z.object({ policy: z.enum(MARKET_OBSERVATION_POLICIES), cutoff: Instant,
  include_provider_percent: z.boolean(), source_dto: Source }).strict();
const CandidateBody = z.object({ contract: z.literal('moai.market.observation-evidence.v1'), policy: z.enum(MARKET_OBSERVATION_POLICIES), cutoff: Instant,
  include_provider_percent: z.boolean(), source_dto: Source, source_dto_sha256: SHA, origin: z.enum(['actual', 'synthetic']),
  reference_candidates: z.array(MarketReferenceEvidenceCandidateSchema).min(1).max(2), selections: z.array(Selection).min(2).max(3),
  source_authenticated: z.literal(false), canonical_observation: z.null(), metric_ready: z.literal(false),
  selection_status: z.literal('fixed_fields_only_no_semantic_binding'), warnings: z.array(Text).min(1).max(10) }).strict();
export const MarketObservationCandidateSchema = CandidateBody.extend({ integrity_sha256: SHA }).strict();
export type MarketObservationCandidate = z.infer<typeof MarketObservationCandidateSchema>;
const Instrument = z.object({ security_id: Text, symbol: Text, instrument_kind: z.literal('equity'), venue: Text, share_class: Text,
  share_unit: z.literal('one_share'), split_basis: Text }).strict();
const Freshness = z.object({ policy_id: Text, max_age_seconds: z.partialRecord(Role, z.string().max(30).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine(s => {
  // Zod may run refinements after max/regex failure. Bound conversion itself before BigInt or exponentiation.
  if (s.length > 30 || s.trim() !== s || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s)) return false;
  try { const [n, d] = decimalParts(s); return n <= 604800n * d; } catch { return false; }
})) }).strict();
const Independence = z.object({ assertion_id: Text, provider_percent_independent_of_local_calculation: z.literal(true), previous_close_independently_supplied: z.literal(true) }).strict();
const Rounding = z.object({ policy_id: Text, decimal_places: z.number().int().min(0).max(12), mode: z.enum(['half_even', 'half_up']), scope: z.literal('percent_value_after_scale') }).strict();
const CommonContext = { session_id: Text, session_type: z.literal('regular'), reference_id: Text, freshness_policy: Freshness };
const ChangeContext = z.object({ ...CommonContext, previous_session_id: Text, previous_close_at: Instant,
  independent_percent_assertion: Independence.optional(), provider_rounding_policy: Rounding.optional() }).strict();
const SpreadContext = z.object(CommonContext).strict();
const Revision = z.object({ revision_id: Text, status: z.enum(['original', 'unchanged', 'revised']), supersedes_revision_id: Text.optional(),
  finality: z.literal('final_current_at_cutoff'), evidence_ref: Id }).strict();
const ObservationBinding = z.object({ role: Role, source_at: Instant, published_at: Instant, available_at: Instant,
  observation_session_id: Text, unit: z.enum(['money_per_share', 'percent']), scale: Scale, currency: z.string().length(3).regex(/^[A-Z]{3}$/),
  numeric_semantics: z.literal('raw_decimal_times_explicit_scale'), revision: Revision }).strict();
const CommonBinding = { contract: z.literal('moai.market.observation-binding.v1'), entry_id: Id, candidate_sha256: SHA, instrument: Instrument,
  identity: z.object({ issuer_id: Text, listing_id: Text, provider_symbol: Text, provider_market: Text }).strict(),
  price_basis: z.literal('unadjusted_per_current_share'), market_state: z.literal('regular_open'),
  source_artifact_id: Id, document_id: Text, observations: z.array(ObservationBinding).min(2).max(3),
  rights: z.object({ purpose: z.literal('private_analysis'), processing_allowed: z.literal(true), portable_export_allowed: z.literal(false),
    assertion_id: Text, evidence_ref: Id, valid_from: Instant, valid_until: Instant }).strict(),
  evidence: Evidence, artifacts: z.array(Artifact).min(2).max(32) };
export const MarketObservationBindingSchema = z.discriminatedUnion('policy', [
  z.object({ ...CommonBinding, policy: z.literal('us_equity_change'), context: ChangeContext,
    valuation_basis: z.literal('regular_last_vs_official_previous_close'), quote_pair: z.null() }).strict(),
  z.object({ ...CommonBinding, policy: z.literal('kr_equity_spread'), context: SpreadContext,
    valuation_basis: z.literal('same_instant_firm_book'), quote_pair: z.object({ firmness: z.literal('firm'),
      simultaneity: z.literal('independently_verified_same_instant'), evidence_ref: Id }).strict() }).strict(),
]);
export type MarketObservationBinding = z.infer<typeof MarketObservationBindingSchema>;
export interface MarketObservationVerificationContext {
  readonly contract: 'moai.market.observation-verification-request.v1'; readonly input_sha256: string;
  readonly candidate: MarketObservationCandidate; readonly binding: MarketObservationBinding;
}
/** A separately trusted host dependency. A function from an untrusted payload is not a verifier. */
export interface TrustedMarketObservationVerifier {
  readonly adapter_id: string; readonly mode: 'synthetic_test_only' | 'external_trusted_verification';
  verify(context: Readonly<MarketObservationVerificationContext>): Promise<unknown>;
}
const Decision = z.object({ contract: z.literal('moai.market.observation-verifier-decision.v1'), input_sha256: SHA, adapter_id: Id,
  data_kind: z.enum(['synthetic', 'actual']), original_bytes_independently_reconstructed: z.literal(true), confirmed: Evidence }).strict();
export class MarketObservationBridgeError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'MarketObservationBridgeError'; }
}
function fail(code: string): never { throw new MarketObservationBridgeError(code); }
function must(ok: unknown, code: string): asserts ok { if (!ok) fail(code); }
const same = (a: unknown, b: unknown) => marketCanonicalJson(a) === marketCanonicalJson(b);
/** Descriptor-only bounded inert JSON. Never invokes getters, proxies, custom serialization or coercion. */
function snapshot(value: unknown, maxBytes = 2_000_000): unknown {
  let nodes = 0, bytes = 0; const seen = new Set<object>();
  function walk(v: unknown, depth: number): unknown {
    if (++nodes > 100000 || depth > 24 || (bytes += 16) > maxBytes) fail('input_too_large');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') { must(Number.isFinite(v) && !Object.is(v, -0), 'invalid_plain_json'); return v; }
    if (typeof v === 'string') { must(v.length <= maxBytes - bytes, 'input_too_large'); must(Buffer.from(v, 'utf8').toString('utf8') === v && !/[\u202a-\u202e\u2066-\u2069]/.test(v), 'invalid_plain_json'); bytes += Buffer.byteLength(v); if (bytes > maxBytes) fail('input_too_large'); return v; }
    must(typeof v === 'object' && !types.isProxy(v) && !seen.has(v), 'invalid_plain_json');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    must(array ? proto === Array.prototype || proto === null : proto === Object.prototype || proto === null, 'invalid_plain_json');
    const len = array ? Object.getOwnPropertyDescriptor(v, 'length')?.value : 0;
    must(!array || Number.isSafeInteger(len) && len >= 0, 'invalid_plain_json');
    const keys = Reflect.ownKeys(v); must(keys.length <= 1001 && (!array || keys.length === len + 1), 'invalid_plain_json');
    const out: any = array ? [] : Object.create(null); seen.add(v);
    for (const key of keys) {
      must(typeof key === 'string', 'invalid_plain_json');
      // UTF-16 length is a lower bound for well-formed UTF-8 bytes; reject before encoding or regex work.
      must(key.length <= maxBytes - bytes, 'input_too_large');
      must(!['__proto__', 'prototype', 'constructor'].includes(key) && Buffer.from(key, 'utf8').toString('utf8') === key && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(key), 'invalid_plain_json');
      bytes += Buffer.byteLength(key); if (bytes > maxBytes) fail('input_too_large');
      const d = Object.getOwnPropertyDescriptor(v, key); must(d && 'value' in d, 'invalid_plain_json');
      if (array && key === 'length') continue;
      must(d.enumerable && (!array || /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < len), 'invalid_plain_json');
      Object.defineProperty(out, key, { value: walk(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    seen.delete(v); return out;
  }
  return walk(value, 0);
}
function parsed<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const safe = snapshot(value), p = schema.safeParse(safe); must(p.success && same(safe, p.data), code); return p.data;
}
function lexical(role: z.infer<typeof Role>, dto_selector: z.infer<typeof Selection>['dto_selector'], provider_selector: z.infer<typeof Selection>['provider_selector'], raw: string | undefined) {
  return { role, dto_selector, provider_selector, raw_lexeme: raw ?? null,
    raw_state: raw === undefined ? 'missing' as const : raw === '' ? 'blank' as const : Decimal.safeParse(raw).success && (role === 'market.provider_change_pct' || !raw.startsWith('-')) ? 'decimal_text_candidate' as const : 'unsupported_raw_text' as const,
    canonical_observation: null, metric_ready: false as const };
}
/** Fixed-field replay only. The injected transport below only returns caller-supplied bytes; never a network fallback. */
export async function selectMarketObservationEvidence(value: unknown) {
  const q = parsed(MarketObservationSelectionInputSchema, value, 'invalid_selection_input');
  const s = q.source_dto; must(Instant.safeParse(s.received_at).success && compareInstants(s.received_at, q.cutoff) <= 0, 'invalid_chronology');
  let references: z.infer<typeof MarketReferenceEvidenceCandidateSchema>[], selections: z.infer<typeof Selection>[];
  if (q.policy === 'us_equity_change') {
    must(s.contract === 'moai.stock.us-quote.v1' && s.asset_class_from_request === 'stock', 'unsupported_source_scope');
    const replay = await requestUsQuote({ symbol: s.symbol_from_request, exchange: s.exchange_from_request, asset_class: 'stock' },
      { origin: s.origin, async send() { return { status: 200, tr_cont: '', body: { rt_cd: '0', output: s.raw } }; } }, () => s.received_at);
    must(same(replay, s), 'source_reconstruction_mismatch');
    references = [selectMarketReferenceEvidence({ policy: 'us_quote_previous_close', requested_role: 'market.previous_close', cutoff: q.cutoff, source_dto: s }) as z.infer<typeof MarketReferenceEvidenceCandidateSchema>];
    selections = [lexical('market.last', '$.raw.last', '$.output.last', s.raw.last), lexical('market.previous_close', '$.raw.base', '$.output.base', s.raw.base)];
    if (q.include_provider_percent) selections.push(lexical('market.provider_change_pct', '$.raw.rate', '$.output.rate', s.raw.rate));
  } else {
    must(s.contract === 'moai.stock.market-orderbook.v1' && s.requested.board !== 'UN' && !q.include_provider_percent, 'unsupported_source_scope');
    const replay = reconstructMarketOrderbookResult(s.requested, s.raw, { origin: s.origin, received_at: s.received_at, tr_cont: s.pagination.tr_cont });
    must(same(replay, s), 'source_reconstruction_mismatch');
    references = (['kr_orderbook_best_bid', 'kr_orderbook_best_ask'] as const).map(policy => selectMarketReferenceEvidence({ policy, requested_role: policy === 'kr_orderbook_best_bid' ? 'market.best_bid' : 'market.best_ask', cutoff: q.cutoff, source_dto: s }) as z.infer<typeof MarketReferenceEvidenceCandidateSchema>);
    selections = [lexical('market.best_bid', '$.raw.output1.bidp1', '$.output1.bidp1', s.raw.output1.bidp1), lexical('market.best_ask', '$.raw.output1.askp1', '$.output1.askp1', s.raw.output1.askp1)];
  }
  const body = CandidateBody.parse({ contract: 'moai.market.observation-evidence.v1', ...q, source_dto_sha256: marketDigest(s), origin: s.origin, reference_candidates: references, selections,
    source_authenticated: false, canonical_observation: null, metric_ready: false, selection_status: 'fixed_fields_only_no_semantic_binding',
    warnings: ['Fixed raw selection is not identity, unit, scale, session, finality, source authentication or rights verification.',
      'A shared response does not prove contemporaneous firm quotes or an independent provider-percent check.',
      'No previous close is derived from last minus change. Original raw numeric lexemes remain unchanged.'] });
  return freezeMarket(MarketObservationCandidateSchema.parse({ ...body, integrity_sha256: marketDigest(body) }));
}
export async function validateMarketObservationCandidate(value: unknown) {
  const p = parsed(MarketObservationCandidateSchema, value, 'invalid_candidate');
  const expected = await selectMarketObservationEvidence({ policy: p.policy, cutoff: p.cutoff, include_provider_percent: p.include_provider_percent, source_dto: p.source_dto });
  must(same(p, expected), 'candidate_mismatch'); return expected;
}
/** Formatting only, under separately verified raw-decimal-times-scale semantics; never changes scale. */
function canonicalDecimal(raw: string): string { return raw.replace(/^(-?)0+(?=\d)/, '$1'); }
function decimalParts(raw: string): [bigint, bigint] { const [whole, fraction = ''] = raw.split('.'); return [BigInt(whole! + fraction), 10n ** BigInt(fraction.length)]; }
function scaled(raw: string, scale: string): [bigint, bigint] { const [a, b] = decimalParts(raw), [c, d] = decimalParts(scale); return [a * c, b * d]; }
function compareValues(a: [bigint, bigint], b: [bigint, bigint]): number { const delta = a[0] * b[1] - b[0] * a[1]; return delta < 0 ? -1 : delta > 0 ? 1 : 0; }
function checks(c: MarketObservationCandidate, b: MarketObservationBinding) {
  must(c.policy === b.policy && c.integrity_sha256 === b.candidate_sha256, 'binding_candidate_mismatch');
  const s = c.source_dto;
  const symbol = s.contract === 'moai.stock.us-quote.v1' ? s.symbol_from_request : s.requested.symbol;
  const market = s.contract === 'moai.stock.us-quote.v1' ? s.exchange_from_request : s.requested.board;
  must(b.identity.provider_symbol === symbol && b.instrument.symbol === symbol && b.identity.provider_market === market, 'identity_mismatch');
  const roles = c.selections.map(x => x.role);
  must(same(b.observations.map(x => x.role), roles), 'role_mapping_mismatch');
  must(same(Object.keys(b.context.freshness_policy.max_age_seconds).sort(), [...roles].sort()), 'freshness_policy_mismatch');
  const currencies = new Set(b.observations.map(x => x.currency)); must(currencies.size === 1, 'unit_currency_mismatch');
  for (const [i, o] of b.observations.entries()) {
    const selection = c.selections[i]!;
    must(selection.raw_state === 'decimal_text_candidate' && selection.raw_lexeme !== null, 'invalid_raw_value');
    must(o.unit === (o.role === 'market.provider_change_pct' ? 'percent' : 'money_per_share'), 'unit_currency_mismatch');
    must(compareInstants(o.source_at, o.published_at) <= 0 && compareInstants(o.published_at, s.received_at) <= 0 &&
      compareInstants(s.received_at, o.available_at) <= 0 && compareInstants(o.available_at, c.cutoff) <= 0, 'invalid_chronology');
    const r = o.revision; must(r.status === 'revised' ? r.supersedes_revision_id && r.supersedes_revision_id !== r.revision_id : r.supersedes_revision_id === undefined, 'invalid_revision');
    const n = scaled(selection.raw_lexeme, o.scale);
    if (o.role !== 'market.provider_change_pct') must(n[0] >= 0n && (o.role !== 'market.previous_close' || n[0] > 0n), 'invalid_price');
  }
  if (b.policy === 'us_equity_change') {
    must(b.context.previous_session_id !== b.context.session_id && b.observations[0]!.observation_session_id === b.context.session_id && b.observations[1]!.observation_session_id === b.context.previous_session_id, 'reference_session_mismatch');
    must(compareInstants(b.observations[1]!.source_at, b.context.previous_close_at) === 0 && compareInstants(b.context.previous_close_at, b.observations[0]!.source_at) < 0, 'reference_session_mismatch');
    must(c.include_provider_percent ? b.context.independent_percent_assertion && b.context.provider_rounding_policy : !b.context.independent_percent_assertion && !b.context.provider_rounding_policy, 'percent_context_mismatch');
    if (c.include_provider_percent) must(b.observations[2]!.observation_session_id === b.context.session_id && compareInstants(b.observations[2]!.source_at, b.observations[0]!.source_at) === 0, 'percent_context_mismatch');
  } else {
    must(b.observations.every(x => x.observation_session_id === b.context.session_id) && compareInstants(b.observations[0]!.source_at, b.observations[1]!.source_at) === 0, 'quote_pair_mismatch');
    const bid = scaled(c.selections[0]!.raw_lexeme!, b.observations[0]!.scale), ask = scaled(c.selections[1]!.raw_lexeme!, b.observations[1]!.scale);
    must(compareValues(bid, ask) <= 0 && ask[0] > 0n, 'invalid_price');
  }
  const artifacts = new Map(b.artifacts.map(a => [a.id, a])); must(artifacts.size === b.artifacts.length, 'evidence_mismatch');
  const used = new Set<string>(); for (const axis of MARKET_OBSERVATION_AXES) for (const id of b.evidence[axis]) { must(artifacts.has(id), 'evidence_mismatch'); used.add(id); }
  must(used.size === artifacts.size && b.evidence.rights.includes(b.rights.evidence_ref) && b.observations.every(o => b.evidence.finality_revision.includes(o.revision.evidence_ref)), 'evidence_mismatch');
  if (b.quote_pair) must(b.evidence.quote_firmness_simultaneity.includes(b.quote_pair.evidence_ref), 'evidence_mismatch');
  for (const a of b.artifacts) {
    must(a.data_kind === c.origin, 'evidence_mismatch');
    if (c.origin === 'actual') must(a.digest_kind !== 'synthetic_fixture' && a.locator.startsWith('https://'), 'evidence_mismatch');
    if (a.snapshot) must(a.snapshot.source_dto_sha256 === c.source_dto_sha256 && compareInstants(a.snapshot.received_at, s.received_at) === 0, 'evidence_mismatch');
  }
  const source = artifacts.get(b.source_artifact_id);
  must(source?.snapshot && b.evidence.original_bytes_dto_linkage.includes(source.id) && source.digest_kind === (c.origin === 'synthetic' ? 'synthetic_fixture' : 'original_bytes'), 'evidence_mismatch');
  must(compareInstants(b.rights.valid_from, c.cutoff) <= 0 && compareInstants(c.cutoff, b.rights.valid_until) <= 0, 'rights_outside_window');
  return source;
}
const SEMANTICS = Object.freeze({ 'market.last': 'last_trade', 'market.previous_close': 'official_previous_session_close', 'market.provider_change_pct': 'provider_published_change_from_previous_close', 'market.best_bid': 'firm_best_bid', 'market.best_ask': 'firm_best_ask' });
freezeMarket(runtimePin);
export async function assembleMarketObservationReportInput(candidateValue: unknown, bindingValue: unknown, verifier?: TrustedMarketObservationVerifier, clock: () => string = () => new Date().toISOString()) {
  // Snapshot both inputs before the first async boundary; caller mutation cannot change an in-flight request.
  const candidateSnapshot = snapshot(candidateValue);
  const binding = freezeMarket(parsed(MarketObservationBindingSchema, bindingValue, 'invalid_binding')) as MarketObservationBinding;
  const candidate = await validateMarketObservationCandidate(candidateSnapshot) as MarketObservationCandidate;
  const sourceArtifact = checks(candidate, binding);
  must(verifier, 'verification_not_configured'); const { adapter_id, mode, verify } = verifier;
  must(Id.safeParse(adapter_id).success && typeof verify === 'function' && ['synthetic_test_only', 'external_trusted_verification'].includes(mode), 'verification_not_configured');
  if (candidate.origin === 'actual') must(mode === 'external_trusted_verification', 'actual_verifier_required');
  const input_sha256 = marketDigest({ candidate, binding });
  const context = freezeMarket({ contract: 'moai.market.observation-verification-request.v1' as const, input_sha256, candidate, binding }) as MarketObservationVerificationContext;
  let result: unknown; try { result = await verify.call(verifier, context); } catch { fail('verification_failed'); }
  const decision = parsed(Decision, result, 'verification_mismatch');
  must(decision.adapter_id === adapter_id && decision.input_sha256 === input_sha256 && decision.data_kind === candidate.origin, 'verification_mismatch');
  for (const axis of MARKET_OBSERVATION_AXES) must(same([...decision.confirmed[axis]].sort(), [...binding.evidence[axis]].sort()), 'verification_mismatch');
  let now: unknown; try { now = clock(); } catch { fail('invalid_chronology'); }
  const t = Instant.safeParse(now); must(t.success && compareInstants(candidate.cutoff, t.data) <= 0, 'invalid_chronology');
  must(compareInstants(binding.rights.valid_from, t.data) <= 0 && compareInstants(t.data, binding.rights.valid_until) <= 0, 'rights_outside_window');
  const observations = Object.fromEntries(binding.observations.map((o, i) => {
    const field = candidate.selections[i]!;
    return [o.role, { observation_id: 'moai:market:' + marketDigest({ input_sha256, role: o.role }), role: o.role, data_kind: candidate.origin,
      value: canonicalDecimal(field.raw_lexeme!), unit: o.unit, scale: o.scale, currency: o.currency, instrument: binding.instrument,
      basis: { session_id: binding.context.session_id, observation_session_id: o.observation_session_id, session_type: binding.context.session_type,
        reference_id: binding.context.reference_id, price_basis: binding.price_basis, valuation_basis: binding.valuation_basis, market_state: binding.market_state, semantics: SEMANTICS[o.role] },
      source_at: o.source_at, published_at: o.published_at, available_at: o.available_at,
      provenance: { source_id: 'KIS', document_id: binding.document_id, record_id: 'direct:' + o.role, locator: field.provider_selector, revision_id: o.revision.revision_id,
        source_sha256: sourceArtifact.sha256, origin: 'direct_observation', semantic_binding_asserted: true },
      rights: { processing_allowed: true, portable_export_allowed: false, assertion_id: binding.rights.assertion_id } }];
  }));
  return freezeMarket({ contract: 'moai.market.observation-report-handoff.v1' as const, status: 'conditional_supplied_report_input_only' as const,
    source_authenticated: false as const, actual_bindings: 0 as const, live_bindings: 0 as const, actual_provider_calls: 0 as const,
    report_input: { contract: 'moai.market-observations/0.1-rc7' as const, request: { cutoff: candidate.cutoff, data_kind: candidate.origin, purpose: 'private_analysis' as const },
      entries: [{ id: binding.entry_id, metric_id: binding.policy === 'us_equity_change' ? 'metric.change_pct' : 'metric.spread_bps', observations, context: binding.context }] },
    verification: { input_sha256, adapter_id, mode, verified_at: t.data, assurance: 'trusted_adapter_attestation_not_host_authentication' as const, confirmed: decision.confirmed },
    lineage: { source_dto_sha256: candidate.source_dto_sha256, original_body_sha256: sourceArtifact.sha256, selections: candidate.selections, artifacts: binding.artifacts,
      identity: binding.identity, revisions: binding.observations.map(o => ({ role: o.role, revision: o.revision })), receipt: candidate.source_dto.received_at },
    inputs: { candidate, binding }, rights: binding.rights, report_runtime: runtimePin,
    warnings: ['No production verifier is supplied or configured. Trusted host code must independently establish all evidence axes.',
      'No metric formula is implemented here. The unchanged pinned Python runtime independently validates and calculates supplied observations.',
      'Without an independently verified provider-percent observation, change arithmetic remains arithmetic-only, not an accepted canonical metric.',
      'Raw DTOs and candidates remain null-canonical and metric_ready=false. Serialized success never authorizes use.',
      'Private analysis only. No export, redistribution, source authentication, live acquisition or complete report-slot coverage is established.'] });
}
const Receipt = z.object({ input_sha256: SHA, adapter_id: Id, mode: z.enum(['synthetic_test_only', 'external_trusted_verification']), verified_at: Instant,
  assurance: z.literal('trusted_adapter_attestation_not_host_authentication'), confirmed: Evidence }).strict();
export const MarketObservationHandoffSchema = z.object({ contract: z.literal('moai.market.observation-report-handoff.v1'), status: z.literal('conditional_supplied_report_input_only'),
  source_authenticated: z.literal(false), actual_bindings: z.literal(0), live_bindings: z.literal(0), actual_provider_calls: z.literal(0), report_input: z.unknown(), verification: Receipt,
  lineage: z.unknown(), inputs: z.object({ candidate: MarketObservationCandidateSchema, binding: MarketObservationBindingSchema }).strict(), rights: z.unknown(), report_runtime: z.unknown(), warnings: z.unknown() }).strict();
/** Reconstruct every computed field, then freshly reverify original evidence and current rights. */
export async function reverifyMarketObservationHandoff(value: unknown, verifier?: TrustedMarketObservationVerifier, clock: () => string = () => new Date().toISOString()) {
  const old = parsed(MarketObservationHandoffSchema, value, 'invalid_handoff');
  const fresh = await assembleMarketObservationReportInput(old.inputs.candidate, old.inputs.binding, verifier, clock);
  for (const key of ['contract', 'status', 'source_authenticated', 'actual_bindings', 'live_bindings', 'actual_provider_calls', 'report_input', 'lineage', 'inputs', 'rights', 'report_runtime', 'warnings'] as const) must(same(old[key], fresh[key]), 'handoff_mismatch');
  must(old.verification.input_sha256 === fresh.verification.input_sha256 && old.verification.adapter_id === fresh.verification.adapter_id &&
    old.verification.mode === fresh.verification.mode && (fresh.inputs.candidate.origin !== 'actual' || old.verification.mode === 'external_trusted_verification'), 'handoff_mismatch');
  for (const axis of MARKET_OBSERVATION_AXES) must(same([...old.verification.confirmed[axis]].sort(), [...fresh.verification.confirmed[axis]].sort()), 'handoff_mismatch');
  must(compareInstants(fresh.report_input.request.cutoff, old.verification.verified_at) <= 0 && compareInstants(old.verification.verified_at, fresh.verification.verified_at) <= 0 &&
    compareInstants(fresh.rights.valid_from, old.verification.verified_at) <= 0 && compareInstants(old.verification.verified_at, fresh.rights.valid_until) <= 0, 'handoff_mismatch');
  return fresh;
}

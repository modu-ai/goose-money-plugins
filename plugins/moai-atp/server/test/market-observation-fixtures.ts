import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { requestUsQuote } from '../src/global-market-data.js';
import { reconstructMarketOrderbookResult } from '../src/market-orderbook.js';
import { marketCanonicalJson, marketDigest } from '../src/market-reference-snapshot.js';
import { MARKET_OBSERVATION_AXES, selectMarketObservationEvidence, type MarketObservationBinding, type MarketObservationCandidate, type TrustedMarketObservationVerifier } from '../src/market-observation-bridge.js';
export const RECEIVED = '2026-10-22T14:30:01.123456789123Z';
export const CUTOFF = '2026-10-22T14:30:01.123456789124Z';
export const VERIFIED = '2026-10-22T14:30:02.000000000001Z';
export const REVERIFIED = '2026-10-22T14:30:02.000000000002Z';
export const hashBytes = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
export const clone = <T>(v: T): Mutable<T> => JSON.parse(JSON.stringify(v));
export async function marketObservationFixture(policy: 'us_equity_change' | 'kr_equity_spread' = 'us_equity_change', include_provider_percent = policy === 'us_equity_change') {
  const body = policy === 'us_equity_change'
    ? { rt_cd: '0', output: { rsym: 'DNASSYNTH', zdiv: '4', base: '000100.0000', last: '000101.2500', rate: '001.25', diff: '1.25' } }
    : { rt_cd: '0', output1: { bidp1: '00099.9000', askp1: '00100.1000', aspr_acpt_hour: '123001', stck_shrn_iscd: '005930', new_mkop_cls_code: 'unverified' }, output2: {} };
  const source = policy === 'us_equity_change'
    ? await requestUsQuote({ symbol: 'SYNTH', exchange: 'NAS', asset_class: 'stock' }, { origin: 'synthetic', async send() { return { status: 200, tr_cont: '', body }; } }, () => RECEIVED)
    : reconstructMarketOrderbookResult({ symbol: '005930', board: 'J' }, { output1: (body as any).output1, output2: (body as any).output2 }, { origin: 'synthetic', received_at: RECEIVED, tr_cont: '' });
  const candidate = await selectMarketObservationEvidence({ policy, cutoff: CUTOFF, include_provider_percent, source_dto: source });
  const originalBytes = JSON.stringify(body, null, 2) + '\n';
  const reviewBytes = 'SYNTHETIC ONLY: independent fixture review of identity, source fields, units, scale, sessions, publication, firm book, finality and current private-analysis rights.\n';
  const evidence = Object.fromEntries(MARKET_OBSERVATION_AXES.map(axis => [axis, axis === 'original_bytes_dto_linkage' ? ['original-body', 'review-record'] : ['review-record']])) as MarketObservationBinding['evidence'];
  const isUs = policy === 'us_equity_change';
  const context = { session_id: 'SYNTHETIC:2026-10-22', session_type: 'regular' as const, reference_id: 'SYNTHETIC:unadjusted-reference',
    freshness_policy: { policy_id: 'synthetic-private-report-freshness', max_age_seconds: Object.fromEntries(candidate.selections.map(x => [x.role, x.role === 'market.previous_close' ? '172800' : '10'])) },
    ...(isUs ? { previous_session_id: 'SYNTHETIC:2026-10-21', previous_close_at: '2026-10-21T20:00:00Z',
      ...(include_provider_percent ? { independent_percent_assertion: { assertion_id: 'synthetic-percent-independence', provider_percent_independent_of_local_calculation: true as const, previous_close_independently_supplied: true as const },
        provider_rounding_policy: { policy_id: 'synthetic-pct-rounding', decimal_places: 2, mode: 'half_even' as const, scope: 'percent_value_after_scale' as const } } : {}) } : {}) };
  const binding: MarketObservationBinding = {
    contract: 'moai.market.observation-binding.v1', policy, entry_id: 'synthetic-' + policy, candidate_sha256: candidate.integrity_sha256,
    instrument: { security_id: 'SYNTHETIC:security:' + policy, symbol: isUs ? 'SYNTH' : '005930', instrument_kind: 'equity', venue: isUs ? 'SYNTHETIC:XNAS' : 'SYNTHETIC:XKRX', share_class: 'SYNTHETIC:common', share_unit: 'one_share', split_basis: 'SYNTHETIC:current-share-unadjusted' },
    identity: { issuer_id: 'SYNTHETIC:issuer:' + policy, listing_id: 'SYNTHETIC:listing:' + policy, provider_symbol: isUs ? 'SYNTH' : '005930', provider_market: isUs ? 'NAS' : 'J' },
    price_basis: 'unadjusted_per_current_share', market_state: 'regular_open', context,
    valuation_basis: isUs ? 'regular_last_vs_official_previous_close' : 'same_instant_firm_book',
    quote_pair: isUs ? null : { firmness: 'firm', simultaneity: 'independently_verified_same_instant', evidence_ref: 'review-record' },
    source_artifact_id: 'original-body', document_id: 'SYNTHETIC:original-response',
    observations: candidate.selections.map(x => ({ role: x.role, source_at: x.role === 'market.previous_close' ? '2026-10-21T20:00:00Z' : '2026-10-22T14:30:00.123456789123Z',
      published_at: x.role === 'market.previous_close' ? '2026-10-21T20:00:00.000000000001Z' : '2026-10-22T14:30:00.123456789124Z', available_at: CUTOFF,
      observation_session_id: x.role === 'market.previous_close' ? 'SYNTHETIC:2026-10-21' : 'SYNTHETIC:2026-10-22', unit: x.role === 'market.provider_change_pct' ? 'percent' : 'money_per_share', scale: '1', currency: isUs ? 'USD' : 'KRW',
      numeric_semantics: 'raw_decimal_times_explicit_scale', revision: { revision_id: 'SYNTHETIC:original', status: 'original', finality: 'final_current_at_cutoff', evidence_ref: 'review-record' } })),
    rights: { purpose: 'private_analysis', processing_allowed: true, portable_export_allowed: false, assertion_id: 'synthetic-private-analysis-only', evidence_ref: 'review-record', valid_from: '2026-10-21T00:00:00Z', valid_until: '2026-10-23T00:00:00Z' },
    evidence, artifacts: [{ id: 'original-body', data_kind: 'synthetic', digest_kind: 'synthetic_fixture', sha256: hashBytes(originalBytes), locator: 'synthetic://market-observation/original-body', snapshot: { source_dto_sha256: candidate.source_dto_sha256, received_at: RECEIVED } },
      { id: 'review-record', data_kind: 'synthetic', digest_kind: 'synthetic_fixture', sha256: hashBytes(reviewBytes), locator: 'synthetic://market-observation/review-record', snapshot: null }],
  } as MarketObservationBinding;
  return { originalBytes, reviewBytes, candidate: clone(candidate) as MarketObservationCandidate, binding: clone(binding) };
}
export type SyntheticMarketFixture = Awaited<ReturnType<typeof marketObservationFixture>>;
/** Test-only separately held fixture truth, never a verifier for actual-labelled or arbitrary caller data. */
export function syntheticMarketVerifier(trusted: SyntheticMarketFixture): TrustedMarketObservationVerifier {
  const expected = clone(trusted); // Closure detached from all later caller edits.
  return { adapter_id: 'synthetic-market-fixture-verifier', mode: 'synthetic_test_only', async verify(ctx) {
    assert.equal(ctx.candidate.origin, 'synthetic');
    assert.equal(ctx.input_sha256, marketDigest({ candidate: ctx.candidate, binding: ctx.binding }));
    assert.equal(marketCanonicalJson(ctx.candidate), marketCanonicalJson(expected.candidate));
    assert.equal(marketCanonicalJson(ctx.binding), marketCanonicalJson(expected.binding));
    const body = JSON.parse(expected.originalBytes), s = ctx.candidate.source_dto;
    const sourceArtifact = ctx.binding.artifacts.find(x => x.id === ctx.binding.source_artifact_id)!;
    assert.equal(sourceArtifact.sha256, hashBytes(expected.originalBytes));
    assert.equal(sourceArtifact.snapshot!.source_dto_sha256, marketDigest(s));
    assert.equal(ctx.binding.artifacts.find(x => x.id === 'review-record')!.sha256, hashBytes(expected.reviewBytes));
    assert.equal(marketCanonicalJson(s.raw), marketCanonicalJson(s.contract === 'moai.stock.us-quote.v1' ? body.output : { output1: body.output1, output2: body.output2 }));
    const reconstructed = await selectMarketObservationEvidence({ policy: ctx.candidate.policy, cutoff: ctx.candidate.cutoff, include_provider_percent: ctx.candidate.include_provider_percent, source_dto: s });
    assert.equal(marketCanonicalJson(reconstructed), marketCanonicalJson(ctx.candidate));
    return { contract: 'moai.market.observation-verifier-decision.v1', adapter_id: this.adapter_id, input_sha256: ctx.input_sha256,
      data_kind: 'synthetic', original_bytes_independently_reconstructed: true, confirmed: clone(expected.binding.evidence) };
  } };
}

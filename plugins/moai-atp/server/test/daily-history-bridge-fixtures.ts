/** Invented offline fixtures and echo verifier. NEVER imported by src or configured in a host. */
import { createHash } from 'node:crypto';
import { requestUsDailyHistory } from '../src/history-breadth.js';
import { DAILY_HISTORY_BRIDGE_AXES, type DailyHistoryBinding, type DailyHistoryVerificationContext, type TrustedDailyHistoryVerifier } from '../src/daily-history-bridge.js';
export const RECEIVED = '2026-10-22T00:00:00.123456789Z';
export const CUTOFF = '2026-10-22T00:00:00.123456790Z';
export const VERIFIED = '2026-10-22T01:00:00.000000001Z';
const stable = (v: any): string => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
export const fixtureDigest = (v: unknown) => createHash('sha256').update(stable(v)).digest('hex');
export const syntheticHistoryVerifier: TrustedDailyHistoryVerifier = Object.freeze({
  adapter_id: 'test-only-invented-history-verifier', mode: 'synthetic_test_only',
  async verify(c: Readonly<DailyHistoryVerificationContext>) {
    if (c.source.origin !== 'synthetic' || c.binding.artifacts.some(a => a.data_kind !== 'synthetic' || !a.locator.startsWith('synthetic:'))) throw new Error('synthetic-only');
    return { contract: 'moai.us-daily.history-verifier-decision.v1', adapter_id: this.adapter_id, input_sha256: c.input_sha256, data_kind: 'synthetic', confirmed: c.binding.evidence };
  },
});
export async function dailyHistoryFixture() {
  const body = {
      rt_cd: '0', output1: { rsym: 'DNASSYNTH', zdiv: '6', nrec: '99999' },
      output2: [
        { xymd: '20261021', open: '00100.000000000000000001', high: '102', low: '99', clos: '101', tvol: '9007199254740993000', tamt: '99999999999999999999.9' },
        { xymd: '20261020', open: '99', high: '101', low: '98', clos: '100', tvol: '1000', tamt: '88888888888888888888.8' },
      ],
  };
  const synthetic_body_bytes = JSON.stringify(body);
  const source = await requestUsDailyHistory({ symbol: 'SYNTH', exchange: 'NAS', basis_date: '20261021', adjustment_code: '0', asset_class: 'stock' }, {
    origin: 'synthetic', async send() { return { status: 200, tr_cont: 'M', body }; },
  }, () => RECEIVED);
  const binding: DailyHistoryBinding = {
    contract: 'moai.us-daily.history-binding.v1', history_id: 'synthetic:US-daily:1', cutoff: CUTOFF,
    request: { start_date: '2026-10-20', end_date: '2026-10-21' }, provider_identity: { symbol: 'SYNTH', exchange: 'NAS' },
    context: {
      identity: { instrument_id: 'synthetic:equity:1', issuer_id: 'synthetic:issuer:1', venue: 'SYNTHETIC-NOT-A-VENUE', asset_class: 'equity', share_class: 'synthetic:common', contract_id: 'not_applicable' },
      units: { price_unit: 'money_per_share', currency: 'USD', price_scale: '1', volume_unit: 'shares', volume_scale: '1' },
      session: { calendar_id: 'SYNTHETIC-NOT-EXCHANGE-CALENDAR', timezone: 'America/New_York', session_id: 'synthetic:regular', interval: 'daily', date_basis: 'trade_date', calendar_verified: true, calendar_evidence_ref: 'review', coverage_start: '2026-10-20', coverage_end: '2026-10-21', coverage_complete: true, expected_sessions: ['2026-10-20', '2026-10-21'] },
      basis: { price_kind: 'price_level', return_policy: 'price_return', adjustment: 'unadjusted', adjustment_id: 'synthetic:unadjusted', adjustment_asof: '2026-10-21T20:00:00Z', actions_coverage_verified: true, actions_evidence_ref: 'review', volume_adjustment: 'unadjusted', revision_policy: 'final_current_at_cutoff', price_definition: 'official_close', allow_negative_prices: false, roll_policy: 'not_applicable' },
    },
    document_id: 'synthetic:source-page:1', source_artifact_id: 'source-page',
    selector: { id: 'kis.us-daily.named-ohlcv/1', date: 'xymd', open: 'open', high: 'high', low: 'low', close: 'clos', volume: 'tvol' },
    publication_basis: 'explicit_publication_evidence_not_receipt_or_date_substitution', coverage: 'selected_single_page_not_complete_provider_collection',
    rights: { use: 'local_report', evidence_ref: 'review', valid_from: '2026-10-01T00:00:00Z', valid_until: '2026-10-23T00:00:00Z' },
    evidence: Object.fromEntries(DAILY_HISTORY_BRIDGE_AXES.map(a => [a, a === 'source_authenticity' ? ['source-page'] : ['review']])) as DailyHistoryBinding['evidence'],
    artifacts: [
      { id: 'source-page', data_kind: 'synthetic', digest_kind: 'synthetic_fixture', sha256: createHash('sha256').update(synthetic_body_bytes).digest('hex'), locator: 'synthetic://invented/source-page', snapshot: { dto_sha256: fixtureDigest(source), received_at: RECEIVED } },
      { id: 'review', data_kind: 'synthetic', digest_kind: 'review_record', sha256: 'b'.repeat(64), locator: 'synthetic://invented/all-independent-axis-assertions', snapshot: null },
    ],
    points: ['2026-10-21', '2026-10-20'].map((trade_date, row_index) => ({ row_index, trade_date, session_close_at: trade_date + 'T16:00:00-04:00', published_at: trade_date + 'T20:01:00Z', available_at: CUTOFF, finality: 'final', revision: { status: 'original', revision_id: 'synthetic:r1', evidence_ref: 'review' } })),
  };
  return { source, binding, synthetic_body_bytes };
}
export function relinkSource(source: unknown, binding: DailyHistoryBinding) { binding.artifacts[0]!.snapshot!.dto_sha256 = fixtureDigest(source); }

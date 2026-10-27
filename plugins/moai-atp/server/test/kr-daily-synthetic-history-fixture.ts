import { createHash } from 'node:crypto';
import { buildKrDailyRawEvidence } from '../src/kr-daily-raw-evidence.js';
import { KR_SYNTHETIC_HISTORY_AXES, type SyntheticKrHistoryVerifier, type KrSyntheticHistoryInput } from '../src/kr-daily-synthetic-history-bridge.js';
export const RECEIVED = '2026-10-21T08:00:00.123456789012345678901Z';
export const AVAILABLE = '2026-10-21T08:00:00.123456789012345678902Z';
export const CUTOFF = '2026-10-22T00:00:00.123456789012345678903Z';
export const VERIFIED = '2026-10-22T01:00:00.123456789012345678904Z';
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export function stable(v: any): string { if (v === null || typeof v !== 'object') return JSON.stringify(v); return Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'; }
export const hashText = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
export const fixtureDigest = (v: unknown) => hashText(stable(v));
export function fixture(): KrSyntheticHistoryInput {
  const body = { rt_cd: '0', output1: {}, output2: [
    { stck_bsop_date: '20261021', stck_clpr: '103.125', stck_oprc: '102', stck_hgpr: '105', stck_lwpr: '101', acml_vol: '9007199254740993', acml_tr_pbmn: '', flng_cls_code: '', prtt_rate: '', mod_yn: '', revl_issu_reas: '' },
    { stck_bsop_date: '20261019', stck_clpr: '000101.125', stck_oprc: '', stck_hgpr: '103', stck_lwpr: '99', acml_vol: '2000', acml_tr_pbmn: '', flng_cls_code: '', prtt_rate: '', mod_yn: '', revl_issu_reas: '' },
    { stck_bsop_date: '20261016', stck_clpr: '100.125', stck_oprc: '100', stck_hgpr: '102', stck_lwpr: '98', acml_vol: '1000', acml_tr_pbmn: '', flng_cls_code: '', prtt_rate: '', mod_yn: '', revl_issu_reas: '' },
  ] };
  const original_body_text = JSON.stringify(body, null, 2) + '\n';
  const raw_input = { request: { symbol: '999999', board: 'J' as const, start_date: '2026-10-16', end_date: '2026-10-22', interval: '1d' as const, adjustment_code: '0' as const }, capture: { origin: 'synthetic' as const, received_at: RECEIVED, expected_body_sha256: hashText(original_body_text) }, cutoff: CUTOFF };
  const raw_evidence = clone(buildKrDailyRawEvidence(raw_input, original_body_text));
  const evidence = Object.fromEntries(KR_SYNTHETIC_HISTORY_AXES.map(axis => [axis, 'synthetic:' + axis])) as KrSyntheticHistoryInput['binding']['evidence'];
  const statements: Record<typeof KR_SYNTHETIC_HISTORY_AXES[number], string> = {
    fixture_lineage: 'Invented JSON response and raw DTO linked by separately checked hashes. No provider call or source authentication.',
    identity: 'Fictional symbol 999999 represents SYNTHETIC-KR-COMMON equity on SYNTHETIC-KR-VENUE, common share class, issuer SYNTHETIC-KR-ISSUER.',
    field_semantics: 'Invented stck_oprc, stck_hgpr, stck_lwpr, stck_clpr and acml_vol mean open, high, low, official close and daily share volume respectively.',
    units: 'Fictional prices are money_per_share and fictional volume is shares. No endpoint unit inference.',
    currency: 'Fictional prices are explicitly KRW. No market-code currency inference.',
    scales: 'Both fictional price and volume scales are explicitly 1.',
    session_calendar: 'Invented complete calendar covers 2026-10-16 through 2026-10-22. Exactly 16, 19, 20, 21 are sessions; includes all supplied warm-up rows. This is NOT a verified exchange calendar.',
    unadjusted_basis: 'Invented data are unadjusted final daily official-close price levels and unadjusted quantities. Adjustment codes 0 and 1 remain opaque and unresolved for actual data.',
    no_actions: 'Invented world has no adjustment-relevant actions or price/share/quantity-unit changes from 2026-10-16 local midnight through the exact cutoff, including all warm-up dates and capture/adjustment vintage. No events are supported.',
    finality_revision: 'Invented original revision r1 is final and current at the exact cutoff for every supplied row.',
    publication_availability: 'Invented dates use Asia/Seoul close-date trade dates with explicit close and publication instants. Date-only observations have no observed_at instant.',
    rights: 'Invented fixtures alone permit local_report use from 2026-10-01T00:00:00Z through 2026-10-23T00:00:00Z. No real provider rights are established.',
  };
  const binding: KrSyntheticHistoryInput['binding'] = {
    contract: 'moai.kr-daily.synthetic-only-history-binding.v1', scope: 'synthetic_fixture_demonstration_only', history_id: 'SYNTHETIC-KR-DAILY', document_id: 'SYNTHETIC-KR-ORIGINAL-TEXT', cutoff: CUTOFF, request: { start_date: '2026-10-19', end_date: '2026-10-21' }, provider_identity: { symbol: '999999', board: 'J' },
    source_link: { original_body_sha256: hashText(original_body_text), raw_dto_sha256: fixtureDigest(raw_evidence), raw_input_sha256: fixtureDigest(raw_input) },
    selector: { id: 'kis.kr-daily.synthetic.named-ohlcv/1', date: 'stck_bsop_date', open: 'stck_oprc', high: 'stck_hgpr', low: 'stck_lwpr', close: 'stck_clpr', volume: 'acml_vol' }, adjustment_code_policy: 'opaque_uninterpreted_portal_sample_conflict_remains',
    context: { identity: { instrument_id: 'SYNTHETIC-KR-COMMON', issuer_id: 'SYNTHETIC-KR-ISSUER', venue: 'SYNTHETIC-KR-VENUE', asset_class: 'equity', share_class: 'common', contract_id: 'not_applicable' }, units: { price_unit: 'money_per_share', currency: 'KRW', price_scale: '1', volume_unit: 'shares', volume_scale: '1' },
      session: { calendar_id: 'SYNTHETIC-EXPLICIT-NOT-EXCHANGE-CALENDAR', timezone: 'Asia/Seoul', session_id: 'SYNTHETIC-REGULAR', interval: 'daily', date_basis: 'trade_date', calendar_verified: true, calendar_evidence_ref: evidence.session_calendar, coverage_start: '2026-10-16', coverage_end: '2026-10-22', coverage_complete: true, expected_sessions: ['2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21'] },
      basis: { price_kind: 'price_level', return_policy: 'price_return', adjustment: 'unadjusted', adjustment_id: 'SYNTHETIC-NO-ACTION-BASIS', adjustment_asof: '2026-10-21T09:00:00Z', actions_coverage_verified: true, actions_evidence_ref: evidence.no_actions, volume_adjustment: 'unadjusted', revision_policy: 'final_current_at_cutoff', price_definition: 'official_close', allow_negative_prices: false, roll_policy: 'not_applicable' } },
    no_actions: { policy: 'no_adjustment_relevant_actions', coverage_complete: true, coverage_start: '2026-10-16', coverage_end: '2026-10-22', effective_from: '2026-10-16T00:00:00+09:00', effective_through: CUTOFF, knowledge_asof: CUTOFF, events: [], price_basis_changes: false, share_basis_changes: false, quantity_unit_changes: false, evidence_ref: evidence.no_actions },
    rights: { use: 'local_report', scope: 'synthetic_fixture_only', evidence_ref: evidence.rights, valid_from: '2026-10-01T00:00:00Z', valid_until: '2026-10-23T00:00:00Z' }, evidence,
    artifacts: KR_SYNTHETIC_HISTORY_AXES.map(axis => ({ id: evidence[axis], axis, data_kind: 'synthetic', digest_kind: 'synthetic_fixture_definition_utf8', content: statements[axis], sha256: hashText(statements[axis]), locator: 'synthetic://kr-history-fixture/' + axis })),
    points: raw_evidence.rows.map(row => ({ source_row_index: row.source_row_index, trade_date: row.provider_business_date, session_close_at: row.provider_business_date + 'T15:30:00+09:00', published_at: row.provider_business_date + 'T15:31:00+09:00', available_at: AVAILABLE, finality: 'final', revision: { status: 'original', revision_id: 'r1', evidence_ref: evidence.finality_revision } })),
  };
  return { raw_input, raw_evidence, original_body_text, binding } as KrSyntheticHistoryInput;
}
/** Test-only independently held digest allowlist, not an echo verifier and never exported in runtime source. */
export function fixtureVerifier(expected: KrSyntheticHistoryInput): SyntheticKrHistoryVerifier {
  const pinned = fixtureDigest(expected), confirmed = clone(expected.binding.evidence);
  return { adapter_id: 'synthetic-fixture-digest-allowlist-v1', mode: 'synthetic_fixture_only', async verify(c) {
    if (c.input.raw_input.capture.origin !== 'synthetic' || c.input.raw_evidence.capture.origin !== 'synthetic' || c.input_sha256 !== pinned || fixtureDigest(c.input) !== pinned) throw new Error('synthetic fixture not in test allowlist');
    return { contract: 'moai.kr-daily.synthetic-only-verifier-decision.v1', adapter_id: this.adapter_id, input_sha256: pinned, data_kind: 'synthetic', confirmed };
  } };
}
export function rebody(input: KrSyntheticHistoryInput, mutate: (body: any) => void) { const body = JSON.parse(input.original_body_text); mutate(body); input.original_body_text = JSON.stringify(body, null, 2) + '\n'; input.raw_input.capture.expected_body_sha256 = hashText(input.original_body_text); relink(input); }
export function relink(input: KrSyntheticHistoryInput) { input.raw_evidence = clone(buildKrDailyRawEvidence(input.raw_input, input.original_body_text)) as KrSyntheticHistoryInput['raw_evidence']; input.binding.source_link = { original_body_sha256: hashText(input.original_body_text), raw_dto_sha256: fixtureDigest(input.raw_evidence), raw_input_sha256: fixtureDigest(input.raw_input) }; }
export function reportInput(h: Awaited<ReturnType<typeof import('../src/kr-daily-synthetic-history-bridge.js').assembleSyntheticKrDailyHistory>>) { return { contract: 'canonical-history/1.0', cutoff: h.cutoff, request: h.request, histories: { subject: h.history }, options: { sma_windows: [2, 3], volume_direction: { rule: 'neutral', evidence_ref: 'synthetic:neutral-volume', disclosure: 'Neutral quantity bars only.' }, aggregation_windows: [] } }; }

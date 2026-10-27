import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { normalizeKis072History, normalizeKis264History } from '../../dist/src/benchmark-history-inputs.js';
for (const op of ['072', '264']) {
 const domestic = op === '072', field = domestic ? 'bstp_nmix_prpr' : 'ovrs_nmix_prpr';
 const original_body_text = JSON.stringify({ rt_cd: '0', output1: domestic ? { unreviewed_header: 'synthetic only' } : { ovrs_nmix_prdy_clpr: '+00012.3400', prdy_ctrt: '-0.20', hts_kor_isnm: '합성 지수' }, output2: [
  { stck_bsop_date: '20261020', [field]: '-000123.4500', acml_vol: '000', mod_yn: 'N' },
  { stck_bsop_date: '20261019', [field]: '' }, { stck_bsop_date: '20261020' },
 ] });
 const input = { request: { market_code: domestic ? 'U' : 'N', instrument_code: domestic ? '0001' : 'SYNTH', start_date: '2026-10-01', end_date: '2026-10-20', period_code: 'D' },
  capture: { origin: 'synthetic', received_at: '2026-10-21T00:00:00.123456789012345678Z', expected_body_sha256: createHash('sha256').update(original_body_text).digest('hex'), http_status: 200, tr_cont: 'M' }, cutoff: '2026-10-21T00:00:00.123456789012345679Z' };
 const expected = (domestic ? normalizeKis072History : normalizeKis264History)(input, original_body_text);
 writeFileSync(new URL(`./kis${op}-synthetic.json`, import.meta.url), JSON.stringify({ synthetic_only: true, note: 'Deterministic local fixture, not a provider capture or live verification.', input, original_body_text, expected }, null, 2) + '\n');
}

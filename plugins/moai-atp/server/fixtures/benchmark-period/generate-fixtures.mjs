import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizeKis072Period, normalizeKis264Period } from '../../dist/src/benchmark-period-inputs.js';
for (const op of ['072', '264']) for (const period of ['W', 'M', 'Y']) {
  const domestic = op === '072', field = domestic ? 'bstp_nmix_prpr' : 'ovrs_nmix_prpr';
  const original_body_text = JSON.stringify({ rt_cd: '0', msg1: 'SYNTHETIC ONLY', output1: domestic ? {} : { hts_kor_isnm: '합성 자료', prdy_ctrt: '' }, output2: [
    { stck_bsop_date: '20261020', [field]: '-000123.4500', acml_vol: '', mod_yn: 'N' },
    { stck_bsop_date: '20261019', [field]: '1e2' },
    { stck_bsop_date: '20261020', [field]: '-0' },
    { stck_bsop_date: '', [field]: '' },
    {},
    { stck_bsop_date: '20260930', [field]: '1' },
  ] }, null, 2) + '\n';
  const input = { request: { instrument_code: domestic ? '0001' : 'SYNTH', market_code: domestic ? 'U' : 'N',
    start_date: '2026-10-01', end_date: '2026-10-20', period_code: period },
    capture: { origin: 'synthetic', received_at: '2026-10-21T00:00:00.123456789012345678Z',
      expected_body_sha256: createHash('sha256').update(original_body_text, 'utf8').digest('hex'), http_status: 200, tr_cont: 'M' },
    cutoff: '2026-10-21T00:00:00.123456789012345679Z' };
  const expected = (domestic ? normalizeKis072Period : normalizeKis264Period)(input, original_body_text);
  writeFileSync(new URL(`./kis${op}-${period}-synthetic.json`, import.meta.url), JSON.stringify({ synthetic_only: true,
    purpose: 'Native requested interval raw shape only; no authentic capture, period boundary, complete period or total-return evidence.', input, original_body_text, expected }, null, 2) + '\n');
}

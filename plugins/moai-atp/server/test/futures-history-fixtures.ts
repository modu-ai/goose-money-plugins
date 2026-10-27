import type { FuturesHistoryResponse, FuturesHistoryTransport } from '../src/futures-history.js';
export const receipt = '2026-10-22T03:00:00.123456789123Z';
export const dailyInput = { symbol: '101W09', start_date: '20250301', end_date: '20250331', period: 'D' };
export const minuteInput = { symbol: '101T12', anchor_date: '20230901', anchor_time: '100000', interval_seconds: '60', include_past_data: 'Y' };
export const overseasDailyInput = { symbol: 'CLM26', exchange: 'NYMEX', end_date: '20261021', count: '30', period: 'D' };
export const overseasMinuteInput = { symbol: 'BONU25', exchange: 'EUREX', end_date: '20250702', count: '120', interval_minutes: '5' };
export const dailyBody = { rt_cd: '0', msg_cd: 'SYNTHETIC_RC6', msg1: 'SYNTHETIC ONLY, NOT MARKET OBSERVATIONS',
  output1: { futs_shrn_iscd: '101W09', hts_kor_isnm: 'SYNTHETIC INDEX FUTURE', futs_prpr: '-000.7500', basis: '-00.10', otst_stpl_qty_icdc: '-00002' },
  output2: [
    { stck_bsop_date: '20250328', futs_prpr: '-000.7500', futs_oprc: '-001.2500', futs_hgpr: '000.0000', futs_lwpr: '-002.0000', acml_vol: '000000020', acml_tr_pbmn: '-00012.5000', mod_yn: 'N' },
    { stck_bsop_date: '20250326', futs_prpr: '', futs_oprc: '-000.0000', futs_hgpr: '001.0000', futs_lwpr: '-001.0000', acml_vol: '', mod_yn: '' },
  ],
};
export const minuteBody = { rt_cd: '0', msg_cd: 'SYNTHETIC_RC6', msg1: 'SYNTHETIC ONLY, NOT MARKET OBSERVATIONS',
  output1: { futs_shrn_iscd: '101T12', hts_kor_isnm: 'SYNTHETIC INDEX FUTURE', prdy_nmix: '-0.00' },
  output2: [
    { stck_bsop_date: '20230901', stck_cntg_hour: '095900', futs_prpr: '-1.12500', futs_oprc: '-2.12500', futs_hgpr: '0', futs_lwpr: '-3', cntg_vol: '00010', acml_tr_pbmn: '0000500' },
    { stck_bsop_date: '20230831', stck_cntg_hour: '235900', futs_prpr: '-000.00', futs_oprc: '', futs_hgpr: '', futs_lwpr: '', cntg_vol: '00000', acml_tr_pbmn: '' },
  ],
};
const overseasRows = [
  { data_date: '20261021', data_time: '235959', open_price: '-38.0000', high_price: '-35.0000', low_price: '-40.0000', last_price: '-37.630000', last_qntt: '0000001', vol: '00000234', prev_diff_flag: '5', prev_diff_price: '-001.00', prev_diff_rate: '-000.5' },
  { data_date: '20261020', data_time: '', open_price: '-000.0000', high_price: '', low_price: '', last_price: '0.0000', last_qntt: '', vol: '' },
];
export const overseasDailyBody = { rt_cd: '0', msg_cd: 'SYNTHETIC_RC6', msg1: 'SYNTHETIC ONLY, NOT MARKET OBSERVATIONS',
  output1: { tret_cnt: '0002', last_n_cnt: '0000', index_key: 'SYNTHETIC-PAGE-2' }, output2: overseasRows,
};
export const overseasMinuteBody = { rt_cd: '0', msg_cd: 'SYNTHETIC_RC6', msg1: 'SYNTHETIC ONLY, NOT MARKET OBSERVATIONS',
  output1: { ret_cnt: '0002', last_n_cnt: '0000', index_key: '' },
  output2: overseasRows.map((row, index) => ({ ...row, data_date: '20250702', data_time: index ? '000000' : '235959' })),
};
export function response(body: unknown, tr_cont: string | null = ''): FuturesHistoryResponse { return { status: 200, tr_cont, body }; }
export function transport(body: unknown, tr_cont: string | null = ''): FuturesHistoryTransport {
  return { origin: 'synthetic', async send() { return response(structuredClone(body), tr_cont); } };
}

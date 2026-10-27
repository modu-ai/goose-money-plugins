import type { KrHistoricalIntradayInput, KrHistoricalIntradayTransport, KrHistoricalIntradayResponse } from '../src/historical-stock-bars.js';
/** Entirely synthetic. Codes, dates, names and numeric values do not prove any market observation. */
export const receipt = '2026-10-22T03:00:00.123456789123Z';
export const input: KrHistoricalIntradayInput = { symbol: '005930', board: 'J', anchor_date: '20261020', anchor_time: '130000', include_past_data: 'N' };
export const body = {
  rt_cd: '0', msg_cd: 'SYNTHETIC_OK', msg1: 'SYNTHETIC ONLY; not observed market data.',
  output1: { hts_kor_isnm: 'SYNTHETIC ONLY', prdy_vrss: '-0001.00', prdy_vrss_sign: '5', prdy_ctrt: '-0.01',
    stck_prdy_clpr: '00070200', stck_prpr: '00070100.00', acml_vol: '000100', acml_tr_pbmn: '0007010000.00' },
  output2: [
    { stck_bsop_date: '20261020', stck_cntg_hour: '130000', stck_prpr: '00070100.00', stck_oprc: '00070000.00', stck_hgpr: '00070200.00', stck_lwpr: '00069900.00', cntg_vol: '000004', acml_tr_pbmn: '9007199254740993.10' },
    { stck_bsop_date: '20261020', stck_cntg_hour: '125900', stck_prpr: '', stck_oprc: '', stck_hgpr: '', stck_lwpr: '', cntg_vol: '', acml_tr_pbmn: '' },
  ],
};
export function response(value: unknown = body, tr_cont: string | null = ''): KrHistoricalIntradayResponse { return { status: 200, tr_cont, body: structuredClone(value) }; }
export function transport(value: unknown = body, tr_cont: string | null = ''): KrHistoricalIntradayTransport { return { origin: 'synthetic', async send() { return response(value, tr_cont); } }; }

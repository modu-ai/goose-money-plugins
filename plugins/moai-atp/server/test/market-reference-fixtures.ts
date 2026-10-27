import { requestMarketOrderbook, type MarketOrderbookTransport, type MarketOrderbookResponse } from '../src/market-orderbook.js';
import { requestUsQuote } from '../src/global-market-data.js';
import { requestKrIntradayHistory } from '../src/history-breadth.js';
export const RECEIPT = '2026-10-22T03:00:00.123456789123Z';
export const CUTOFF = '2026-10-22T03:00:00.123456789124Z';
export const bookInput = { symbol: '005930', board: 'UN' } as const;
export const bookBody = { rt_cd: '0', output1: { bidp1: '000100.00000000000001', askp1: '101', aspr_acpt_hour: 'raw clock: 03:00?',
  bidp_rsqn1: '0', askp_rsqn1: '', bidp_rsqn_icdc1: '-7', askp_rsqn_icdc1: '+3', stck_shrn_iscd: '005930',
  new_mkop_cls_code: 'UNREVIEWED', vi_cls_code: 'UNKNOWN', stck_sdpr: '777', antc_cnpr: '999' },
  output2: [{ antc_cnpr: '999', stck_shrn_iscd: '005930', extension: { note: 'synthetic fixture only', code: 7, missing: null } }, { antc_cnpr: '' }] };
export const response = (body: unknown = structuredClone(bookBody), tr_cont: string | null = ''): MarketOrderbookResponse => ({ status: 200, tr_cont, body });
export const bookTransport = (body: unknown = structuredClone(bookBody)): MarketOrderbookTransport => ({ origin: 'synthetic', async send() { return response(body); } });
export const book = (body: unknown = structuredClone(bookBody)) => requestMarketOrderbook(bookInput, bookTransport(body), () => RECEIPT);
export const us = (extra: Record<string, unknown> = {}) => requestUsQuote({ symbol: 'SYNTH', exchange: 'NAS', asset_class: 'stock' }, {
  origin: 'synthetic', async send() { return { status: 200, tr_cont: '', body: { rt_cd: '0', output: { rsym: 'DNASSYNTH', zdiv: '4', base: '00099.0000000000000001', last: '101', diff: '2', rate: '2.02', ...extra } } }; },
}, () => RECEIPT);
export const kr = (extra: Record<string, unknown> = {}) => requestKrIntradayHistory({ symbol: '005930', board: 'NX', anchor_time: '150000', include_past_data: 'N', expected_business_date: '20261021' }, {
  origin: 'synthetic', async send() { return { status: 200, tr_cont: 'M', body: { rt_cd: '0', output1: { stck_prpr: '101', stck_prdy_clpr: '99', prdy_vrss: '2', prdy_ctrt: '2.02', ...extra },
    output2: [{ stck_bsop_date: '20261021', stck_cntg_hour: '150000', stck_prpr: '101', stck_oprc: '100', stck_hgpr: '102', stck_lwpr: '99', cntg_vol: '7' }] } }; },
}, () => RECEIPT);
export async function selectionInput(policy: 'kr_orderbook_best_bid' | 'kr_orderbook_best_ask' | 'us_quote_previous_close' | 'kr_intraday_previous_close' = 'kr_orderbook_best_bid') {
  return { policy, cutoff: CUTOFF, requested_role: policy === 'kr_orderbook_best_bid' ? 'market.best_bid' : policy === 'kr_orderbook_best_ask' ? 'market.best_ask' : 'market.previous_close',
    source_dto: policy === 'us_quote_previous_close' ? await us() : policy === 'kr_intraday_previous_close' ? await kr() : await book() };
}

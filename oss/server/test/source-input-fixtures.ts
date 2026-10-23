import { readFileSync } from 'node:fs';
import type { ServerOptions } from '../src/server.js';
export const RECEIVED = '2026-10-22T08:00:00.123456789Z';
export const CUTOFF = '2026-10-22T08:00:00.123456790Z';
const fixture = (name: string) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8');
const benchmark = JSON.parse(fixture('benchmark-history/kis264-synthetic.json'));
const market = JSON.parse(fixture('remaining-source-market.synthetic.input.json'));
const ice = JSON.parse(fixture('remaining-source-ice.synthetic.input.json'));
const estimates = JSON.parse(fixture('remaining-source-estimates.synthetic.input.json'));
export const bodies = {
  'KIS-264': benchmark.original_body_text as string,
  'KIS-113': fixture('remaining-source-market.synthetic.original.json'),
  'KIS-280': fixture('remaining-source-ice.synthetic.original.json'),
};
export const inputs: Record<string, Record<string, unknown>> = {
  get_domestic_index_history: { request: { ...benchmark.input.request, market_code: 'U', instrument_code: '0001' }, cutoff: CUTOFF },
  get_global_index_history: { request: benchmark.input.request, cutoff: CUTOFF },
  get_market_industry_investor_aggregates: { request: market.request, cutoff: CUTOFF },
  get_kis_house_estimates: { request: estimates.request, cutoff: CUTOFF },
  get_overseas_ice_actions: { request: ice.request, cutoff: CUTOFF },
};
export const blocked = ['get_domestic_index_history', 'get_kis_house_estimates'];
export const active = ['get_global_index_history', 'get_market_industry_investor_aggregates', 'get_overseas_ice_actions'];
export function injectedOptions(): ServerOptions {
  return { rightsEnabled: true, clock: () => RECEIVED,
    benchmarkHistoryTransport: { origin: 'synthetic', async send() { return { http_status: 200, tr_cont: 'M', body_text: bodies['KIS-264'] }; } },
    remainingSourceTransport: { origin: 'synthetic', async send(request) {
      if (request.operation_ref === 'KIS-109') throw new Error('blocked_source_must_never_dispatch');
      return { status: 200, tr_cont: '', body_text: bodies[request.operation_ref] };
    } },
  };
}

import { readFileSync } from 'node:fs';
import type { ServerOptions } from '../src/server.js';
export type PeriodCode = 'W' | 'M' | 'Y';
export function nativePeriodFixture(period: PeriodCode = 'W', operation: '072' | '264' = '264') {
  return JSON.parse(readFileSync(new URL(`../../fixtures/benchmark-period/kis${operation}-${period}-synthetic.json`, import.meta.url), 'utf8'));
}
export function nativePeriodInput(period: PeriodCode = 'W', operation: '072' | '264' = '264') {
  const { input } = nativePeriodFixture(period, operation); return { request: input.request, cutoff: input.cutoff };
}
export function nativePeriodOptions(): ServerOptions {
  return { rightsEnabled: true, clock: () => nativePeriodFixture().input.capture.received_at,
    benchmarkPeriodTransport: { origin: 'synthetic', async send(request) {
      const body = request.query.FID_INPUT_ISCD === 'OVERSIZE'
        ? JSON.stringify({ rt_cd: '0', output2: Array.from({ length: 250 }, () => ({ stck_bsop_date: '20261020', ovrs_nmix_prpr: '1' })) })
        : nativePeriodFixture(request.query.FID_PERIOD_DIV_CODE).original_body_text;
      return { http_status: 200, tr_cont: 'M', body_text: body };
    } },
  };
}

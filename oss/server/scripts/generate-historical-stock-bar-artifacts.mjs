import { writeFileSync, mkdirSync } from 'node:fs';
import { z } from 'zod';
import * as f from '../dist/src/historical-stock-bars.js';
import * as fx from '../dist/test/historical-stock-bars-fixtures.js';
const dump = (path, value) => writeFileSync(new URL('../' + path, import.meta.url), JSON.stringify(value, null, 2) + '\n');
mkdirSync(new URL('../contracts/', import.meta.url), { recursive: true });
mkdirSync(new URL('../fixtures/', import.meta.url), { recursive: true });
for (const [kind, schema] of [['input', f.KrHistoricalIntradayInputSchema], ['request', f.KrHistoricalIntradayRequestSchema], ['raw', f.KrHistoricalIntradayRawSchema], ['result', f.KrHistoricalIntradayResultSchema]]) {
  const json = z.toJSONSchema(schema);
  json.$id = `https://schemas.moai.invalid/stock/kr-historical-intraday-${kind}-v1.schema.json`;
  json.$comment = 'Offline shape projection only. Runtime Zod additionally checks real calendar dates, exact receipt/availability equality, row counts/coverage, continuation provenance and duplicate/blank-label status. Entry point additionally snapshots and bounds hostile inputs and responses. The .invalid namespace is an identifier, not a hosted resource.';
  dump(`contracts/kr-historical-intraday-${kind}-v1.schema.json`, json);
}
const variants = [
  ['sample', fx.body],
  ['empty', { ...fx.body, output2: [] }],
  ['mixed-duplicates-blanks', { ...fx.body, output2: [fx.body.output2[1], { ...fx.body.output2[0], stck_bsop_date: '20261019' }, fx.body.output2[1], { ...fx.body.output2[1], stck_bsop_date: '', stck_cntg_hour: '' }] }],
];
for (const [name, body] of variants) {
  dump(`fixtures/kr-historical-intraday-${name}-response-synthetic.json`, { fixture_kind: 'synthetic_only', not_market_observations: true, request_input: fx.input, response: fx.response(body) });
  dump(`fixtures/kr-historical-intraday-${name}-result-synthetic.json`, await f.requestKrHistoricalIntraday(fx.input, fx.transport(body), () => fx.receipt));
}
dump('fixtures/kr-historical-intraday-fixture-provenance.json', {
  origin: 'synthetic', observed_market_data: false, source_commit: f.KR_HISTORICAL_INTRADAY_SOURCE_COMMIT,
  fixture_receipt: fx.receipt, purpose: 'Offline contract fixtures only; all market values, names and timestamps are fabricated, not listing or market-history evidence.',
  live_financial_api_calls: 0, account_or_order_operations: 0, secrets_read: 0,
});
console.log('Generated 4 JSON schemas, 3 synthetic transport fixtures, 3 synthetic results, and provenance.');

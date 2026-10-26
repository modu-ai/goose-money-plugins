import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import * as book from '../dist/src/market-orderbook.js';
import * as evidence from '../dist/src/market-reference-evidence.js';
import * as fx from '../dist/test/market-reference-fixtures.js';
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output-root' || !args[1])) throw new Error('invalid_generator_arguments');
const root = args.length ? pathToFileURL(resolve(args[1]) + '/') : new URL('../', import.meta.url);
const dump = (path, value) => writeFileSync(new URL(path, root), JSON.stringify(value, null, 2) + '\n');
for (const path of ['contracts/market-reference/', 'fixtures/market-reference/']) mkdirSync(new URL(path, root), { recursive: true });
const schemas = [
  ['orderbook-input', book.MarketOrderbookInputSchema], ['orderbook-request', book.MarketOrderbookRequestSchema],
  ['orderbook-output1', book.MarketOrderbookOutput1Schema], ['orderbook-output2', book.MarketOrderbookOutput2Schema],
  ['orderbook-raw', book.MarketOrderbookRawSchema], ['orderbook-result', book.MarketOrderbookResultSchema],
  ['reference-evidence-input', evidence.MarketReferenceEvidenceInputSchema], ['reference-evidence-candidate', evidence.MarketReferenceEvidenceCandidateSchema],
];
for (const [name, schema] of schemas) {
  const json = z.toJSONSchema(schema);
  json.$id = `https://schemas.moai.invalid/market-reference/${name}-v1.schema.json`;
  json.$comment = 'Offline shape projection only. Runtime entrypoints additionally enforce inert bounded plain JSON, conservative private-data marker rejection, exact instants, echo and request consistency, source DTO reconstruction where available, deterministic full-candidate replay and integrity links. Shape validity is not source authentication, economic validity, rights clearance or metric readiness. The .invalid namespace is an identifier, not a hosted resource.';
  dump(`contracts/market-reference/${name}-v1.schema.json`, json);
}
const variants = [
  ['sample', structuredClone(fx.bookBody)],
  ['output2-object', { ...fx.bookBody, output2: { antc_cnpr: '999', nested: ['raw', null, 7, false] } }],
  ['missing-and-blank', { rt_cd: '0', output1: { askp1: '', aspr_acpt_hour: '' }, output2: [] }],
  ['unsupported-and-crossed', { rt_cd: '0', output1: { bidp1: '102', askp1: '100', bidp2: '1e3', askp_rsqn_icdc1: '-2' }, output2: {} }],
  ['unsupported-lexeme', { rt_cd: '0', output1: { bidp1: '1e3', askp1: '0' }, output2: {} }],
];
for (const [name, body] of variants) {
  dump(`fixtures/market-reference/orderbook-${name}-response-synthetic.json`, { fixture_kind: 'synthetic_only', not_market_observations: true,
    request_input: fx.bookInput, response: fx.response(body) });
  const dto = await fx.book(body);
  dump(`fixtures/market-reference/orderbook-${name}-result-synthetic.json`, dto);
  for (const [policy, role] of [['kr_orderbook_best_bid', 'market.best_bid'], ['kr_orderbook_best_ask', 'market.best_ask']]) {
    dump(`fixtures/market-reference/${name}-${policy}-candidate-synthetic.json`, evidence.selectMarketReferenceEvidence({ policy, requested_role: role, cutoff: fx.CUTOFF, source_dto: dto }));
  }
}
for (const policy of ['us_quote_previous_close', 'kr_intraday_previous_close']) {
  const input = await fx.selectionInput(policy);
  dump(`fixtures/market-reference/${policy}-input-synthetic.json`, input);
  dump(`fixtures/market-reference/${policy}-candidate-synthetic.json`, evidence.selectMarketReferenceEvidence(input));
}
dump('fixtures/market-reference/provenance.json', { origin: 'synthetic', observed_market_data: false,
  source_commit: book.MARKET_REFERENCE_SOURCE_COMMIT, receipt: fx.RECEIPT, cutoff: fx.CUTOFF,
  purpose: 'Offline deterministic shape/reconstruction tests only. All values and times are fabricated. Public source labels do not authenticate these records or grant data rights.',
  source_authentication: false, canonical_observations: 0, metric_ready: false, live_financial_api_calls: 0,
  credentials_read: 0, account_or_order_operations: 0, dependencies_installed: 0 });
console.log('Generated 8 schemas and 25 synthetic-only fixture/provenance files.');

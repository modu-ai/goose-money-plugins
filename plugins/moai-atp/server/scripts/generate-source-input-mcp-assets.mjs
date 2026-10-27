/** Deterministic offline generation only; requires the compiled, reviewed local source. */
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { DomesticIndexHistoryToolInputSchema, GlobalIndexHistoryToolInputSchema, MarketIndustryInvestorToolInputSchema,
  KisHouseEstimatesToolInputSchema, OverseasIceActionsToolInputSchema } from '../dist/src/source-input-mcp.js';
import { createStockMcpServer } from '../dist/src/server.js';
import { executeGoosePlan } from '../dist/src/goose-orchestrator.js';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const write = (path, value) => writeFileSync(new URL(path, root), JSON.stringify(value, null, 2) + '\n');
const received = '2026-10-22T08:00:00.123456789Z', cutoff = '2026-10-22T08:00:00.123456790Z';
const benchmark = JSON.parse(read('fixtures/benchmark-history/kis264-synthetic.json'));
const remaining = Object.fromEntries(['market', 'estimates', 'ice'].map(kind => [kind, JSON.parse(read(`fixtures/remaining-source-${kind}.synthetic.input.json`))]));
const entries = [
  ['get_domestic_index_history', 'KIS-072', DomesticIndexHistoryToolInputSchema, { ...benchmark.input.request, market_code: 'U', instrument_code: '0001' }, 'hard_blocked_request_contract_conflict', []],
  ['get_global_index_history', 'KIS-264', GlobalIndexHistoryToolInputSchema, benchmark.input.request, 'injected_raw_only', ['market-behavior']],
  ['get_market_industry_investor_aggregates', 'KIS-113', MarketIndustryInvestorToolInputSchema, remaining.market.request, 'injected_raw_only', ['market-behavior']],
  ['get_kis_house_estimates', 'KIS-109', KisHouseEstimatesToolInputSchema, remaining.estimates.request, 'hard_blocked_request_contract_conflict', []],
  ['get_overseas_ice_actions', 'KIS-280', OverseasIceActionsToolInputSchema, remaining.ice.request, 'injected_raw_only', ['disclosure-event']],
];
const catalog = { contract: 'moai.source-input-mcp-registration.v1', total_registered_names: 32, default_policy: 'deny',
  tool_result_payload_max_utf8_bytes: 300000, size_scope: 'complete_serialized_tool_result_excluding_outer_JSON_RPC_envelope',
  oversize_action: 'reject_without_truncation', canonical_promotion: false, account_or_portfolio_roles: false,
  tools: [] };
const fixtures = [];
const server = createStockMcpServer({ rightsEnabled: true, clock: () => received,
  benchmarkHistoryTransport: { origin: 'synthetic', async send() { return { http_status: 200, tr_cont: 'M', body_text: benchmark.original_body_text }; } },
  remainingSourceTransport: { origin: 'synthetic', async send(request) {
    if (request.operation_ref === 'KIS-109') throw new Error('unexpected_blocked_dispatch');
    return { status: 200, tr_cont: '', body_text: read(`fixtures/remaining-source-${request.operation_ref === 'KIS-113' ? 'market' : 'ice'}.synthetic.original.json`) };
  } },
});
for (const [name, operation, schema, request, status, grants] of entries) {
  const schemaPath = `contracts/mcp-${name.replaceAll('_', '-')}.input.schema.json`;
  write(schemaPath, z.toJSONSchema(schema));
  const input = { request, cutoff };
  let result = null, error_code = null;
  try { result = (await server._registeredTools[name].handler(input)).structuredContent; }
  catch (e) { error_code = e.message.replace(/^error_code=/, ''); if (error_code !== 'request_contract_conflict') throw e; }
  fixtures.push({ name, operation_ref: operation, input, result, error_code, synthetic_only: true });
  catalog.tools.push({ name, operation_ref: operation, input_schema: schemaPath, read_only: true, default_denied: true, status, role_grants: grants });
}
write('contracts/source-input-mcp-tools-v1.json', catalog);
write('fixtures/source-input-mcp.synthetic.json', { contract: 'moai.source-input-mcp.synthetic-fixtures.v1', synthetic_only: true, provider_calls: 0, fixtures });
const execution = await executeGoosePlan({ run_id: 'synthetic-current-procedure-references', requested_scope: 'Synthetic procedure and grant fixture, not host execution',
  roles: ['company-analysis', 'disclosure-event', 'market-behavior', 'valuation', 'fact-check-report-qa'], cutoff_at: cutoff,
  evidence: [{ evidence_ref: 'synthetic-only', origin: 'synthetic', received_at: received, source_as_of: null }] }, {
  async run(task) { return { run_id: task.run_id, role_id: task.role_id, findings: [], tool_operation_ids: [], counterevidence: [], unresolved: ['Synthetic only; canonical metrics and actual host execution not established.'] }; },
}, { clock: () => cutoff });
write('fixtures/goose-execution-current.synthetic.json', execution);
process.stdout.write(JSON.stringify({ status: 'generated', tool_schemas: entries.length, source_fixture_cases: fixtures.length, current_role_records: execution.records.length, provider_calls: 0 }) + '\n');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { InMemoryTransport, type McpServer } from '@modelcontextprotocol/server';
import { createStockMcpServer } from '../src/server.js';
import { PACKAGE_VERSION } from '../src/package-metadata.js';
import { SOURCE_INPUT_MCP_NAMES } from '../src/source-input-mcp.js';
import { MCP_RESPONSE_MAX_BYTES, safeResult, safeErrorCode } from '../src/mcp-result.js';
import { executeGoosePlan, GooseExecutionResultSchema, type RoleTask } from '../src/goose-orchestrator.js';
import { inputs, blocked, active, bodies, RECEIVED, CUTOFF, injectedOptions } from './source-input-fixtures.js';
const handler = (server: McpServer, name: string) => (server as any)._registeredTools[name].handler;
const tool = (server: McpServer, name: string) => (server as any)._registeredTools[name];
async function connection(server: McpServer) {
  const [client, peer] = InMemoryTransport.createLinkedPair();
  let id = 0;
  const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  client.onmessage = message => { const msg = message as any; const q = waiting.get(msg.id); if (q) { clearTimeout(q.timer); waiting.delete(msg.id); q.resolve(msg); } };
  await client.start(); await server.connect(peer);
  async function rpc(method: string, params: any) {
    const requestId = ++id;
    const response = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(requestId); reject(new Error('in_memory_timeout')); }, 5000);
      waiting.set(requestId, { resolve, reject, timer });
    });
    await client.send({ jsonrpc: '2.0', id: requestId, method, params } as any);
    return response;
  }
  const initialize = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'synthetic-only', version: '1' } });
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return { initialize, rpc, close: async () => { for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(new Error('closed')); } await server.close(); await client.close(); } };
}
test('34 names are read only; defaults deny every new valid request without transport/clock calls', async () => {
  let calls = 0;
  const options = injectedOptions(); options.rightsEnabled = false;
  options.clock = () => { calls++; return RECEIVED; };
  options.benchmarkHistoryTransport = { origin: 'synthetic', async send() { calls++; throw new Error('forbidden'); } };
  options.remainingSourceTransport = { origin: 'synthetic', async send() { calls++; throw new Error('forbidden'); } };
  const server = createStockMcpServer(options);
  assert.equal(Object.keys((server as any)._registeredTools).length, 34);
  for (const name of SOURCE_INPUT_MCP_NAMES) {
    assert.deepEqual(tool(server, name).annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    await assert.rejects(handler(server, name)(inputs[name]), /^Error: error_code=rights_pending$/);
  }
  assert.equal(calls, 0);
});
test('072/109 have no dispatch or clock branch even with enabled rights, malicious hooks and synthetic injection', async () => {
  let calls = 0;
  const options = injectedOptions(); options.clock = () => { calls++; throw new Error('private'); };
  Object.defineProperty(options, 'benchmarkHistoryTransport', { get() { calls++; throw new Error('private'); } });
  Object.defineProperty(options, 'remainingSourceTransport', { get() { calls++; throw new Error('private'); } });
  const server = createStockMcpServer(options);
  for (const name of blocked) await assert.rejects(handler(server, name)(inputs[name]), /^Error: error_code=request_contract_conflict$/);
  assert.equal(calls, 0);
});
test('strict new schemas reject missing fields and origin/rights/endpoint/receipt overrides before dependencies', async () => {
  let calls = 0;
  const options = injectedOptions(); options.clock = () => { calls++; return RECEIVED; };
  for (const key of ['benchmarkHistoryTransport', 'remainingSourceTransport']) Object.defineProperty(options, key, { get() { calls++; throw new Error('forbidden'); } });
  const server = createStockMcpServer(options);
  for (const name of SOURCE_INPUT_MCP_NAMES) for (const input of [{}, { ...inputs[name], cutoff: 'not-a-date' },
    ...['origin', 'rightsEnabled', 'received_at', 'transport', 'endpoint', 'url', 'capture', 'continuation', 'retry'].map(key => ({ ...inputs[name], [key]: 'not_allowed' })),
    { ...inputs[name], request: { ...(inputs[name]!.request as object), origin: 'actual' } }]) {
    await assert.rejects(handler(server, name)(input), /^Error: error_code=invalid_input$/);
  }
  assert.equal(calls, 0);
});
test('global index uses a fixed immutable one-shot GET; after-response clock supplies exact receipt', async () => {
  let calls = 0, clocks = 0; const sequence: string[] = [];
  const options = injectedOptions(); options.origin = 'actual';
  options.benchmarkHistoryTransport = { origin: 'synthetic', async send(request) {
    calls++; sequence.push('send'); assert.ok(Object.isFrozen(request) && Object.isFrozen(request.query));
    assert.deepEqual(request, { operation_ref: 'KIS-264', method: 'GET', path: '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice', tr_id: 'FHKST03030100',
      query: { FID_COND_MRKT_DIV_CODE: 'N', FID_INPUT_ISCD: 'SYNTH', FID_INPUT_DATE_1: '20261001', FID_INPUT_DATE_2: '20261020', FID_PERIOD_DIV_CODE: 'D' } });
    assert.throws(() => { (request.query as any).FID_INPUT_ISCD = 'OVERRIDE'; });
    await Promise.resolve(); sequence.push('response'); return { http_status: 200, tr_cont: 'M', body_text: bodies['KIS-264'] };
  } };
  options.clock = () => { clocks++; sequence.push('clock'); return RECEIVED; };
  const input = structuredClone(inputs.get_global_index_history!);
  const output = await handler(createStockMcpServer(options), 'get_global_index_history')(input);
  (input.request as any).instrument_code = 'MUTATED_AFTER';
  const data = output.structuredContent;
  assert.deepEqual(sequence, ['send', 'response', 'clock']); assert.equal(calls, 1); assert.equal(clocks, 1);
  assert.equal(data.capture.origin, 'synthetic'); assert.equal(data.capture.received_at, RECEIVED); assert.equal(data.request.instrument_code, 'SYNTH');
  assert.equal(data.response_range_completeness, 'unknown_continuation_conflict'); assert.equal(data.continuation_action, 'none');
  assert.equal(data.rights_status, 'pending'); assert.equal(data.source_as_of, null); assert.equal(data.publication_at, null);
  assert.ok(data.rows.every((row: any) => Object.values(row.canonical).every(value => value === null)));
  assert.equal(data.rows[0].raw_fields.ovrs_nmix_prpr.value, '-000123.4500'); assert.ok(Object.isFrozen(data.rows));
});
for (const [name, op, endpoint, tr_id] of [
  ['get_market_industry_investor_aggregates', 'KIS-113', '/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market', 'FHPTJ04040000'],
  ['get_overseas_ice_actions', 'KIS-280', '/uapi/overseas-price/v1/quotations/rights-by-ice', 'HHDFS78330900'],
] as const) test(`${name} is fixed one-shot raw only, with host origin and immutable query`, async () => {
  const sequence: string[] = []; const options = injectedOptions(); options.origin = 'actual';
  options.remainingSourceTransport = { origin: 'synthetic', async send(request) {
    sequence.push('send'); assert.deepEqual(request, { operation_ref: op, method: 'GET', endpoint, tr_id, query: (inputs[name]!.request as any).query, pagination: 'none' });
    assert.ok(Object.isFrozen(request) && Object.isFrozen(request.query));
    assert.throws(() => { (request.query as any).ORIGIN = 'actual'; });
    await Promise.resolve(); sequence.push('response'); return { status: 200, tr_cont: '', body_text: bodies[op] };
  } };
  options.clock = () => { sequence.push('clock'); return RECEIVED; };
  const data = (await handler(createStockMcpServer(options), name)(inputs[name])).structuredContent;
  assert.deepEqual(sequence, ['send', 'response', 'clock']); assert.equal(data.capture.origin, 'synthetic'); assert.equal(data.capture.received_at, RECEIVED);
  assert.equal(data.metric_ready, false); assert.equal(data.rights_status, 'pending'); assert.equal(data.response_completeness, 'not_established');
  assert.equal(data.canonical_projection_status, 'blocked'); assert.equal(data.source_as_of, null); assert.equal(data.publication_at, null);
  assert.ok(data.groups.every((group: any) => group.rows.every((row: any) => Object.values(row.canonical).every(value => value === null))));
  assert.equal(data.scope, op === 'KIS-113' ? 'market_industry_one_day_aggregate_not_stock_flow' : 'overseas_ICE_A4_A5_not_domestic_KSD');
});
test('new active names require an explicitly injected transport', async () => {
  for (const name of active) await assert.rejects(handler(createStockMcpServer({ rightsEnabled: true }), name)(inputs[name]), /error_code=transport_not_configured/);
});
test('remaining host origin getters, invalid origin and proxies are rejected without executing traps', async () => {
  let calls = 0;
  for (const transport of [{ origin: 'forged', async send() { calls++; } },
    Object.defineProperty({ async send() { calls++; } }, 'origin', { enumerable: true, get() { calls++; return 'synthetic'; } }),
    new Proxy({}, { getPrototypeOf() { calls++; return Object.prototype; } })]) {
    const server = createStockMcpServer({ rightsEnabled: true, remainingSourceTransport: transport as any, clock: () => { calls++; return RECEIVED; } });
    await assert.rejects(handler(server, 'get_overseas_ice_actions')(inputs.get_overseas_ice_actions), /error_code=invalid_input/);
  }
  assert.equal(calls, 0);
});
test('finite errors never leak transport diagnostics, no retries or receipt clock on failed transport', async () => {
  for (const name of active) {
    let calls = 0, clocks = 0; const options = injectedOptions();
    const send = async () => { calls++; throw new Error('SYNTHETIC_PRIVATE_DIAGNOSTIC'); };
    options.benchmarkHistoryTransport = { origin: 'synthetic', send };
    options.remainingSourceTransport = { origin: 'synthetic', send };
    options.clock = () => { clocks++; return RECEIVED; };
    await assert.rejects(handler(createStockMcpServer(options), name)(inputs[name]), /^Error: error_code=(upstream_unavailable|transport_failed)$/);
    assert.equal(calls, 1); assert.equal(clocks, 0);
  }
  let reads = 0; const e = new Error(); Object.defineProperty(e, 'message', { get() { reads++; return 'SYNTHETIC_PRIVATE'; } });
  assert.equal(safeErrorCode(e), 'schema_drift'); assert.equal(safeErrorCode(new Proxy(e, { get() { reads++; return ''; } })), 'upstream_unavailable'); assert.equal(reads, 0);
});
test('MCP clock cutoff is checked at exact sub-millisecond precision after a response', async () => {
  for (const name of active) {
    const options = injectedOptions(); options.clock = () => '2026-10-22T08:00:00.123456791Z';
    await assert.rejects(handler(createStockMcpServer(options), name)(inputs[name]), /error_code=future_receipt/);
  }
});
test('complete result UTF-8 limit rejects without truncating, including multibyte and duplicated structuredContent', async () => {
  assert.equal(MCP_RESPONSE_MAX_BYTES, 300000);
  for (const text of ['x'.repeat(300000), 'x'.repeat(150000), '한'.repeat(60000)]) await assert.rejects(safeResult(async () => ({ text })), /error_code=response_too_large/);
  const result = await safeResult(async () => ({ text: '한'.repeat(100) })); assert.equal(result.structuredContent.text, '한'.repeat(100));
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') < 300000);
});
test('expanded valid raw rows exceeding the response cap fail, never silently drop rows', async () => {
  const body = JSON.stringify({ rt_cd: '0', output2: Array.from({ length: 250 }, () => ({ stck_bsop_date: '20261020', ovrs_nmix_prpr: '1' })) });
  assert.ok(Buffer.byteLength(body) < 262144);
  const options = injectedOptions(); options.benchmarkHistoryTransport = { origin: 'synthetic', async send() { return { http_status: 200, tr_cont: null, body_text: body }; } };
  await assert.rejects(handler(createStockMcpServer(options), 'get_global_index_history')(inputs.get_global_index_history), /error_code=response_too_large/);
});
test('in-memory MCP advertises 34 strict tools and package metadata version exactly', async () => {
  const session = await connection(createStockMcpServer());
  try {
    const metadata = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.equal(PACKAGE_VERSION, metadata.version); assert.equal(session.initialize.result.serverInfo.version, metadata.version);
    const listed = await session.rpc('tools/list', {}); assert.equal(listed.result.tools.length, 34);
    for (const name of SOURCE_INPUT_MCP_NAMES) {
      const t = listed.result.tools.find((t: any) => t.name === name); assert.ok(t); assert.equal(t.inputSchema.additionalProperties, false);
      const denied = await session.rpc('tools/call', { name, arguments: inputs[name] });
      assert.equal(denied.result.isError, true); assert.match(denied.result.content[0].text, /error_code=rights_pending/);
    }
  } finally { await session.close(); }
});
test('in-memory MCP validates malformed requests, rejects overrides, and returns only injected synthetic raw successes', async () => {
  const session = await connection(createStockMcpServer(injectedOptions()));
  try {
    for (const name of SOURCE_INPUT_MCP_NAMES) {
      for (const args of [{}, { ...inputs[name], origin: 'actual' }, { ...inputs[name], rightsEnabled: true }]) {
        const rejected = await session.rpc('tools/call', { name, arguments: args }); assert.ok(rejected.error || rejected.result?.isError);
      }
      const call = await session.rpc('tools/call', { name, arguments: inputs[name] });
      if (blocked.includes(name)) { assert.equal(call.result.isError, true); assert.match(call.result.content[0].text, /request_contract_conflict/); }
      else { assert.equal(call.result.isError, undefined); assert.equal(call.result.structuredContent.capture.origin, 'synthetic'); assert.equal(call.result.structuredContent.canonical_projection_status, 'blocked'); }
    }
  } finally { await session.close(); }
});
test('role grants are conservative and current receipts reject legacy paths rather than silently migrate', async () => {
  const roles = ['company-analysis', 'disclosure-event', 'market-behavior', 'valuation', 'fact-check-report-qa'];
  const observed: RoleTask[] = [];
  const execution = await executeGoosePlan({ run_id: 'synthetic-grants', requested_scope: 'Synthetic raw-source grants only', roles, cutoff_at: CUTOFF, evidence: [] }, {
    async run(task) { observed.push(task); return { run_id: task.run_id, role_id: task.role_id, findings: [], tool_operation_ids: [], counterevidence: [], unresolved: [] }; },
  }, { clock: () => CUTOFF });
  for (const task of observed) {
    assert.ok(!task.allowed_tool_operation_ids.includes('get_domestic_index_history')); assert.ok(!task.allowed_tool_operation_ids.includes('get_kis_house_estimates'));
    for (const name of active) assert.equal(task.allowed_tool_operation_ids.includes(name), name === 'get_overseas_ice_actions' ? task.role_id === 'disclosure-event' : task.role_id === 'market-behavior');
  }
  assert.ok(execution.records.every(record => record.skill.endsWith('/PROCEDURE.md')));
  const legacy = structuredClone(execution); legacy.records[0]!.skill = 'references/roles/company-analysis/SKILL.md';
  assert.equal(GooseExecutionResultSchema.safeParse(legacy).success, false);
});
test('release executable executes synthetic roles and resolves every emitted procedure path in both modes', () => {
  const script = fileURLToPath(new URL('../../../scripts/verify_goose_procedure_paths.mjs', import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' }));
  assert.equal(result.status, 'passed'); assert.equal(result.real_host_execution, false);
  assert.deepEqual(result.modes, ['sequential', 'synthetic_parallel_test']); assert.equal(result.resolved_procedure_paths.length, 5);
  assert.ok(result.resolved_procedure_paths.every((path: string) => path.endsWith('/PROCEDURE.md')));
});

test('complete serialized tool-result payload accepts the exact near-limit boundary and rejects the next increment', async () => {
  const empty = await safeResult(async () => ({ text: '' }));
  const overhead = Buffer.byteLength(JSON.stringify(empty), 'utf8');
  const length = Math.floor((MCP_RESPONSE_MAX_BYTES - overhead) / 2);
  const data = { text: 'x'.repeat(length) };
  const accepted = await safeResult(async () => data);
  const bytes = Buffer.byteLength(JSON.stringify(accepted), 'utf8');
  assert.ok(bytes <= MCP_RESPONSE_MAX_BYTES && bytes >= MCP_RESPONSE_MAX_BYTES - 1);
  assert.equal(accepted.structuredContent.text, data.text);
  assert.equal(JSON.parse(accepted.content[0]!.text).text, data.text);
  await assert.rejects(safeResult(async () => ({ text: 'x'.repeat(length + 1) })), /error_code=response_too_large/);
});
test('generated public schemas and current synthetic fixture remain reproducible against runtime contracts', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../../fixtures/source-input-mcp.synthetic.json', import.meta.url), 'utf8'));
  const catalog = JSON.parse(readFileSync(new URL('../../contracts/source-input-mcp-tools-v1.json', import.meta.url), 'utf8'));
  assert.equal(catalog.total_registered_names, 34); assert.deepEqual(catalog.tools.map((t: any) => t.name), [...SOURCE_INPUT_MCP_NAMES]);
  const server = createStockMcpServer(injectedOptions());
  for (const entry of fixture.fixtures) {
    if (entry.error_code) await assert.rejects(handler(server, entry.name)(entry.input), new RegExp(`^Error: error_code=${entry.error_code}$`));
    else assert.deepEqual((await handler(server, entry.name)(entry.input)).structuredContent, entry.result);
  }
  const receipt = JSON.parse(readFileSync(new URL('../../fixtures/goose-execution-current.synthetic.json', import.meta.url), 'utf8'));
  assert.ok(GooseExecutionResultSchema.safeParse(receipt).success);
});
test('request operation cannot route a remaining-source tool to a different source', async () => {
  let calls = 0;
  const options = injectedOptions(); options.remainingSourceTransport = { origin: 'synthetic', async send() { calls++; throw new Error('forbidden'); } };
  options.clock = () => { calls++; return RECEIVED; };
  const server = createStockMcpServer(options);
  for (const name of ['get_market_industry_investor_aggregates', 'get_kis_house_estimates', 'get_overseas_ice_actions']) {
    for (const other of ['get_market_industry_investor_aggregates', 'get_kis_house_estimates', 'get_overseas_ice_actions'].filter(other => other !== name)) {
      await assert.rejects(handler(server, name)(inputs[other]), /error_code=invalid_input/);
    }
  }
  assert.equal(calls, 0);
});
test('oversize decoded bodies reject before receipt clock on all active new paths', async () => {
  for (const name of active) {
    let calls = 0, clocks = 0; const options = injectedOptions();
    options.benchmarkHistoryTransport = { origin: 'synthetic', async send() { calls++; return { http_status: 200, tr_cont: '', body_text: 'x'.repeat(262145) }; } };
    options.remainingSourceTransport = { origin: 'synthetic', async send() { calls++; return { status: 200, tr_cont: '', body_text: 'x'.repeat(262145) }; } };
    options.clock = () => { clocks++; return RECEIVED; };
    await assert.rejects(handler(createStockMcpServer(options), name)(inputs[name]), /^Error: error_code=(input_too_large|invalid_input)$/);
    assert.equal(calls, 1); assert.equal(clocks, 0);
  }
});

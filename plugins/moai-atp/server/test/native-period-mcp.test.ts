import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createStockMcpServer, type ServerOptions } from './synthetic-member-access.js';
import { NATIVE_PERIOD_MCP_NAMES } from '../src/native-period-mcp.js';
import { executeGoosePlan } from '../src/goose-orchestrator.js';
import { nativePeriodFixture, nativePeriodInput, nativePeriodOptions } from './native-period-mcp-fixtures.js';
const [DOMESTIC, GLOBAL] = NATIVE_PERIOD_MCP_NAMES;
const handler = (options: ServerOptions, name: string = GLOBAL): ((input: unknown) => Promise<any>) => (createStockMcpServer(options) as any)._registeredTools[name].handler;
const finite = (code: string) => new RegExp(`^Error: error_code=${code}$`);
for (const period of ['W', 'M', 'Y'] as const) {
  for (const [name, op] of [[DOMESTIC, '072'], [GLOBAL, '264']] as const) test(`${name} ${period} default-denied before dependency reads or clock calls`, async () => {
    let calls = 0; const options: ServerOptions = { clock: () => { calls++; throw new Error('private'); } };
    Object.defineProperty(options, 'benchmarkPeriodTransport', { enumerable: true, get() { calls++; throw new Error('private'); } });
    await assert.rejects(handler(options, name)(nativePeriodInput(period, op)), finite('rights_pending')); assert.equal(calls, 0);
  });
  test(`072 ${period} hard block precedes host transport option and clock`, async () => {
    let calls = 0; const options: ServerOptions = { rightsEnabled: true, clock: () => { calls++; throw new Error('private'); } };
    Object.defineProperty(options, 'benchmarkPeriodTransport', { enumerable: true, get() { calls++; throw new Error('private'); } });
    await assert.rejects(handler(options, DOMESTIC)(nativePeriodInput(period, '072')), finite('request_contract_conflict')); assert.equal(calls, 0);
  });
  test(`264 ${period} one-shot preserves raw evidence and post-response receipt without canonical promotion`, async () => {
    const f = nativePeriodFixture(period); const events: string[] = []; const options = nativePeriodOptions();
    options.clock = () => { events.push('clock'); return f.input.capture.received_at; };
    options.benchmarkPeriodTransport = { origin: 'synthetic', async send(request) {
      events.push('send'); assert.equal(request.query.FID_PERIOD_DIV_CODE, period); assert.equal(request.method, 'GET');
      assert.equal(request.path, '/uapi/overseas-price/v1/quotations/inquire-daily-chartprice'); assert.equal(request.tr_id, 'FHKST03030100');
      assert.deepEqual(Object.keys(request.query).sort(), ['FID_COND_MRKT_DIV_CODE', 'FID_INPUT_DATE_1', 'FID_INPUT_DATE_2', 'FID_INPUT_ISCD', 'FID_PERIOD_DIV_CODE'].sort());
      assert.ok(Object.isFrozen(request) && Object.isFrozen(request.query));
      await Promise.resolve(); events.push('received'); return { http_status: 200, tr_cont: 'M', body_text: f.original_body_text };
    } };
    const result = await handler(options)(nativePeriodInput(period));
    assert.deepEqual(events, ['send', 'received', 'clock']); assert.deepEqual(result.structuredContent, f.expected);
    assert.deepEqual(JSON.parse(result.content[0].text), f.expected); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 300_000);
    assert.equal(result.structuredContent.metric_ready, false); assert.equal(result.structuredContent.actual_interval_status, 'not_verified');
  });
}
for (const key of ['origin', 'rightsEnabled', 'capture', 'received_at', 'url', 'endpoint', 'tr_id', 'transport', 'continuation', 'calendar', 'unit', 'return_basis']) test(`public ${key} override rejected before dispatch`, async () => {
  let count = 0; const options = nativePeriodOptions(); options.benchmarkPeriodTransport = { origin: 'synthetic', async send() { count++; throw new Error('forbidden'); } };
  await assert.rejects(handler(options)({ ...nativePeriodInput(), [key]: 'forbidden' }), finite('invalid_input'));
  const q = nativePeriodInput(); q.request[key] = 'forbidden'; await assert.rejects(handler(options)(q), finite('invalid_input')); assert.equal(count, 0);
});
for (const period of ['D', 'Q', 'w', 'W\n', '']) test(`no daily coercion or permissive period ${JSON.stringify(period)}`, async () => {
  const q = nativePeriodInput(); q.request.period_code = period; await assert.rejects(handler(nativePeriodOptions())(q), finite('invalid_input'));
});
for (const bad of [undefined, false, 1, 'true', null]) test(`rights require own literal true: ${String(bad)}`, async () => {
  const options = nativePeriodOptions(); (options as any).rightsEnabled = bad;
  await assert.rejects(handler(options)(nativePeriodInput()), finite('rights_pending'));
});
test('new names are immutable, unique, read-only and added after the unchanged 32 names', () => {
  assert.ok(Object.isFrozen(NATIVE_PERIOD_MCP_NAMES)); assert.throws(() => (NATIVE_PERIOD_MCP_NAMES as any).push('forbidden'));
  const all = (createStockMcpServer() as any)._registeredTools; assert.equal(Object.keys(all).length, 36);
  assert.deepEqual(Object.keys(all).slice(-2), [...NATIVE_PERIOD_MCP_NAMES]);
  for (const name of NATIVE_PERIOD_MCP_NAMES) assert.deepEqual(all[name].annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
});
test('request accessors, proxies, inherited fields and huge strings reject without hooks', async () => {
  let calls = 0; const invoke = handler(nativePeriodOptions());
  const getter = nativePeriodInput(); Object.defineProperty(getter.request, 'instrument_code', { enumerable: true, get() { calls++; return 'SYNTH'; } });
  const proxy = new Proxy(nativePeriodInput(), { get() { calls++; throw new Error('private'); }, ownKeys() { calls++; return []; } });
  const huge = nativePeriodInput(); huge.request.instrument_code = 'X'.repeat(1_000_000);
  const inherited = Object.create(nativePeriodInput());
  for (const q of [getter, proxy, huge, inherited]) await assert.rejects(invoke(q), finite('invalid_input'));
  assert.equal(calls, 0);
});
test('missing separate transport is not borrowed from daily transport', async () => {
  let calls = 0; const options: ServerOptions = { rightsEnabled: true, benchmarkHistoryTransport: { origin: 'synthetic', async send() { calls++; throw new Error('forbidden'); } } };
  await assert.rejects(handler(options)(nativePeriodInput()), finite('transport_not_configured')); assert.equal(calls, 0);
});
test('host transport getter and proxied or augmented injections reject without invocation', async () => {
  let calls = 0; const o = nativePeriodOptions(); Object.defineProperty(o, 'benchmarkPeriodTransport', { enumerable: true, get() { calls++; throw new Error('private'); } });
  await assert.rejects(handler(o)(nativePeriodInput()), finite('invalid_input'));
  for (const transport of [new Proxy({}, { get() { calls++; throw new Error('private'); } }), { origin: 'synthetic', send: async () => { calls++; }, endpoint: 'forbidden' }]) {
    const options = nativePeriodOptions(); (options as any).benchmarkPeriodTransport = transport;
    await assert.rejects(handler(options)(nativePeriodInput()), finite('invalid_input'));
  }
  assert.equal(calls, 0);
});
test('transport failure does not leak private messages, retry or invoke receipt clock', async () => {
  let calls = 0, clocks = 0; const options = nativePeriodOptions(); options.clock = () => { clocks++; throw new Error('forbidden'); };
  options.benchmarkPeriodTransport = { origin: 'synthetic', async send() { calls++; throw new Error('https://private.test/?token=PRIVATE'); } };
  await assert.rejects(handler(options)(nativePeriodInput()), finite('upstream_unavailable')); assert.equal(calls, 1); assert.equal(clocks, 0);
});
for (const clock of [() => { throw new Error('PRIVATE-CLOCK'); }, () => 'invalid', () => '2026-10-21T00:00:00-00:00']) test('hostile clock yields finite invalid_input after one response', async () => {
  const options = nativePeriodOptions(); options.clock = clock; await assert.rejects(handler(options)(nativePeriodInput()), finite('invalid_input'));
});
test('sub-nanosecond receipt after cutoff is rejected', async () => {
  const options = nativePeriodOptions(); options.clock = () => '2026-10-21T00:00:00.123456789012345680Z';
  await assert.rejects(handler(options)(nativePeriodInput()), finite('future_receipt'));
});
test('expanded dual-representation response is rejected, never truncated', async () => {
  const q = nativePeriodInput(); q.request.instrument_code = 'OVERSIZE';
  await assert.rejects(handler(nativePeriodOptions())(q), finite('response_too_large'));
});
test('only market-behavior receives the global native-period grant; domestic is never granted', async () => {
  const roles = ['company-analysis', 'disclosure-event', 'market-behavior', 'valuation', 'fact-check-report-qa'];
  const result = await executeGoosePlan({ run_id: 'period-grants', requested_scope: 'Synthetic only', roles, cutoff_at: nativePeriodInput().cutoff, evidence: [] }, {
    async run(task) {
      assert.ok(!task.allowed_tool_operation_ids.includes(DOMESTIC));
      assert.equal(task.allowed_tool_operation_ids.includes(GLOBAL), task.role_id === 'market-behavior');
      assert.ok(Object.isFrozen(task.allowed_tool_operation_ids));
      return { run_id: task.run_id, role_id: task.role_id, findings: [], tool_operation_ids: [GLOBAL], counterevidence: [], unresolved: [] };
    },
  }, { clock: () => nativePeriodInput().cutoff });
  for (const record of result.records) assert.equal(record.result !== null, record.role_id === 'market-behavior');
});
test('new public catalog reflects exact runtime input schemas and default-denied boundaries', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../contracts/native-period-mcp-tools-v1.json', import.meta.url), 'utf8'));
  assert.equal(catalog.total_registered_names, 34); assert.deepEqual(catalog.tools.map((t: any) => t.name), [...NATIVE_PERIOD_MCP_NAMES]);
  assert.ok(catalog.tools.every((t: any) => t.default_denied && t.canonical_promotion === false));
});

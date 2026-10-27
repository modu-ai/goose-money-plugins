// SPEC-ATP-AUTH-001 M0 measurement (card t13). Observation only: this file records what the
// baseline tree answers; it adds no behaviour and edits no existing file. Every request goes
// through an injected synthetic fetchImpl; globalThis.fetch is replaced by a rejecting counter
// for the duration of this file, so a real network call cannot happen. No real keys, no real HOME.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createCredentialBackedServer, createStockMcpServer } from './synthetic-member-access.js';
import { inputs as sourceInputs } from './source-input-fixtures.js';
import { nativePeriodInput } from './native-period-mcp-fixtures.js';

const realFetch = globalThis.fetch;
let globalFetchCalls = 0;
globalThis.fetch = (async () => { globalFetchCalls++; throw new Error('m0_measurement_no_network'); }) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

const spyUrls: string[] = [];
const spyFetch: typeof fetch = async (input) => {
  spyUrls.push(String(input));
  throw new Error('m0_measurement_no_network');
};

type Rpc = (method: string, params: Record<string, unknown>) => Promise<any>;
async function openSession(server: ReturnType<typeof createStockMcpServer>): Promise<{ rpc: Rpc; close: () => Promise<void> }> {
  const [client, peer] = InMemoryTransport.createLinkedPair();
  let id = 0;
  const pending = new Map<number, (message: any) => void>();
  client.onmessage = (message: any) => { pending.get(message.id)?.(message); pending.delete(message.id); };
  const rpc: Rpc = async (method, params) => {
    const n = ++id;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reply = new Promise<any>((resolve, reject) => {
      timer = setTimeout(() => { pending.delete(n); reject(new Error('m0_rpc_timeout')); }, 10_000);
      pending.set(n, resolve);
    });
    try { await client.send({ jsonrpc: '2.0', id: n, method, params } as any); return await reply; }
    finally { clearTimeout(timer); }
  };
  await client.start();
  await server.connect(peer);
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'm0-baseline-measurement', version: '1' } });
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as any);
  return { rpc, close: async () => { await server.close(); await client.close(); } };
}

/** One observable outcome per reply: OK, the error_code token, or a protocol-level error label. */
function outcome(reply: any): string {
  if (reply?.error) return `protocol_error:${String(reply.error.code)}:${String(reply.error.message).slice(0, 80)}`;
  const result = reply?.result;
  if (result?.isError) {
    const text = String(result.content?.[0]?.text ?? '');
    const match = /error_code=([A-Za-z0-9_]+)/.exec(text);
    return match ? match[1]! : `isError:${text.slice(0, 80)}`;
  }
  return 'OK';
}

const subject = { id: 'KRX:000660', name: '합성 자료', venue: 'KRX', currency: 'KRW' };
const reportArgs = { report_id: 'R01', subject, cutoff: '2026-10-23T03:00:00.000Z', display_timezone: 'Asia/Seoul' };

/** Synthetic arguments for every public tool (the same fixtures the existing stdio tests use). */
const toolArguments: Record<string, Record<string, unknown>> = {
  get_market_snapshot: { symbol: '000660', board: 'J' },
  get_price_history: { symbol: '000660', board: 'J', start_date: '2026-10-20', end_date: '2026-10-21', adjustment_code: '0' },
  get_market_flows: { symbol: '000660', board: 'J', input_date: '2026-10-20' },
  get_instrument_profile: { symbol: '000660' },
  get_market_headlines: { symbol: '000660' },
  get_fundamentals: { corp_code: '00126380', bsns_year: '2025', reprt_code: '11012', fs_div: 'CFS' },
  get_public_filings: { corp_code: '00126380', bgn_de: '20260101', end_de: '20261022' },
  get_credit_balances: { symbol: '000660', settlement_date: '2026-10-21' },
  get_short_sale_activity: { symbol: '000660', start_date: '2026-10-19', end_date: '2026-10-21' },
  get_stock_lending_activity: { symbol: '000660', start_date: '2026-10-19', end_date: '2026-10-21' },
  get_us_market_snapshot: { symbol: 'AAPL', exchange: 'NAS' },
  get_index_futures_snapshot: { symbol: '101W09' },
  get_domestic_etf_snapshot: { symbol: '069500' },
  get_sec_company_concept: { cik: '0000320193', taxonomy: 'us-gaap', concept: 'Assets' },
  get_sec_submissions: { cik: '0000320193' },
  search_instruments: { query: 'Synthetic' },
  resolve_instrument: { query: 'Synthetic' },
  get_overseas_futures_snapshot: { symbol: 'ESZ26' },
  get_us_price_history: { symbol: 'AAPL', exchange: 'NAS', basis_date: '20261021', adjustment_code: '1' },
  get_intraday_price_history: { symbol: '005930', anchor_time: '113000', include_past_data: 'N' },
  get_us_product_profile: { symbol: 'AAPL', exchange: 'NAS' },
  get_domestic_futures_price_history: { symbol: '101W09', start_date: '20250301', end_date: '20250331', period: 'D' },
  get_domestic_futures_intraday_history: { symbol: '101T12', anchor_date: '20230901', anchor_time: '100000', interval_seconds: '60', include_past_data: 'Y' },
  get_overseas_futures_price_history: { symbol: 'CLM26', exchange: 'NYMEX', end_date: '20261021', count: '30', period: 'D' },
  get_overseas_futures_intraday_history: { symbol: 'BONU25', exchange: 'EUREX', end_date: '20250702', count: '120', interval_minutes: '5' },
  get_historical_intraday_price_history: { symbol: '005930', board: 'J', anchor_date: '20261020', anchor_time: '130000', include_past_data: 'N' },
  get_market_orderbook: { symbol: '005930', board: 'UN' },
  build_report_input: { ...reportArgs, calls: [] },
  render_report_html: {}, // filled from the build_report_input result during the sweep
  ...sourceInputs,
  get_domestic_index_period_history: nativePeriodInput('W', '072'),
  get_global_index_period_history: nativePeriodInput('W'),
};

test('M0 baseline: every public tool answers once with read switches off (stub harness); code per tool is printed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'atp-m0-baseline-'));
  const server = createCredentialBackedServer({
    studentReleaseScope: true, rightsEnabled: false, openDartEnabled: false,
    authorizeOpenDartRead: async () => true, localReportViewEnabled: true,
    env: {}, homeDir: home, fetchImpl: spyFetch,
  });
  const session = await openSession(server);
  try {
    const listed: string[] = (await session.rpc('tools/list', {})).result.tools.map((tool: any) => tool.name as string);
    assert.equal(listed.length, 36);
    assert.deepEqual([...listed].sort(), Object.keys(toolArguments).sort());
    const lines: string[] = [];
    let builtReport: unknown;
    for (const [index, name] of listed.entries()) {
      const args = name === 'render_report_html' ? { report_input: builtReport } : toolArguments[name]!;
      const reply = await session.rpc('tools/call', { name, arguments: args });
      if (name === 'build_report_input') builtReport = reply.result?.structuredContent;
      lines.push(`M0_TOOL_CODE ${String(index + 1).padStart(2, '0')} ${name} ${outcome(reply)}`);
    }
    process.stdout.write(`M0_TOOL_CODE_BEGIN rightsEnabled=false openDartEnabled=false tools=${listed.length}\n${lines.join('\n')}\nM0_TOOL_CODE_END injected_fetch_calls=${spyUrls.length} global_fetch_calls=${globalFetchCalls}\n`);
    assert.equal(spyUrls.length, 0);
    assert.equal(globalFetchCalls, 0);
  } finally {
    await session.close();
    await rm(home, { recursive: true });
  }
});

test('M0 baseline: AC-005a-e observations on the stub harness (unknown URI, other-store receipt, TTL, tampered input, account tools)', async () => {
  const synthetic = { stck_prpr: '120', stck_oprc: '110', stck_hgpr: '130', stck_lwpr: '100', prdy_vrss: '10', prdy_vrss_sign: '2', prdy_ctrt: '9.09', acml_vol: '1000' };
  const start = Date.parse('2026-10-24T00:00:00.000Z');
  mock.timers.enable({ apis: ['Date'], now: start });
  let clockNow = '2026-10-24T00:00:00.000Z';
  const makeServer = () => createStockMcpServer({ rightsEnabled: true, localReportViewEnabled: true, origin: 'actual', clock: () => clockNow, transport: { getMarketSnapshot: async () => synthetic } });
  const first = await openSession(makeServer());
  const second = await openSession(makeServer());
  const lines: string[] = [];
  const args = { ...reportArgs, cutoff: '2026-10-24T00:00:00Z' };
  const receiptFrom = async (session: { rpc: Rpc }) => (await session.rpc('tools/call', { name: 'get_market_snapshot', arguments: { symbol: '005930', board: 'J' } })).result._meta['moai-atp.local-evidence'] as string;
  try {
    // 005a: a report URI this process never issued.
    lines.push(`M0_AC005 005a resources/read unissued uri -> ${outcome(await first.rpc('resources/read', { uri: 'moai-atp://reports/00000000-0000-4000-8000-000000000000' }))}`);
    // 005b: a receipt issued by a different server instance (different ReportEvidenceStore).
    const foreign = await receiptFrom(first);
    lines.push(`M0_AC005 005b build_report_input with receipt from another store -> ${outcome(await second.rpc('tools/call', { name: 'build_report_input', arguments: { ...args, source_receipts: [foreign] } }))}`);
    const sameStore = await receiptFrom(first);
    lines.push(`M0_AC005 005b (control) build_report_input with receipt from the same store -> ${outcome(await first.rpc('tools/call', { name: 'build_report_input', arguments: { ...args, source_receipts: [sameStore] } }))}`);
    // 005c (receipt): the same kind of receipt used after the 5 minute TTL.
    const aged = await receiptFrom(first);
    mock.timers.tick(300_001);
    clockNow = '2026-10-24T00:05:00.001Z';
    lines.push(`M0_AC005 005c build_report_input with receipt after TTL -> ${outcome(await first.rpc('tools/call', { name: 'build_report_input', arguments: { ...args, source_receipts: [aged] } }))}`);
    // 005c (report) and 005d: build a trusted report, tamper with a copy, then let the original age.
    const fresh = await receiptFrom(first);
    const built = (await first.rpc('tools/call', { name: 'build_report_input', arguments: { ...args, source_receipts: [fresh] } })).result.structuredContent;
    const rendered = await first.rpc('tools/call', { name: 'render_report_html', arguments: { report_input: built } });
    const uri = rendered.result.structuredContent.resource_uri as string;
    const tampered = structuredClone(built);
    tampered.subject.name = 'forged';
    lines.push(`M0_AC005 005d render_report_html with tampered ReportInput -> ${outcome(await first.rpc('tools/call', { name: 'render_report_html', arguments: { report_input: tampered } }))}`);
    lines.push(`M0_AC005 005c (control) resources/read of the same report uri before TTL -> ${outcome(await first.rpc('resources/read', { uri }))}`);
    mock.timers.tick(300_001);
    clockNow = '2026-10-24T00:10:00.002Z';
    lines.push(`M0_AC005 005c resources/read of expired report uri -> ${outcome(await first.rpc('resources/read', { uri }))}`);
    lines.push(`M0_AC005 005c render_report_html of original ReportInput after TTL -> ${outcome(await first.rpc('tools/call', { name: 'render_report_html', arguments: { report_input: built } }))}`);
    // 005e: account, balance, order and transfer requests.
    const names: string[] = (await first.rpc('tools/list', {})).result.tools.map((tool: any) => tool.name as string);
    assert.equal(names.some((name) => /account|transfer|holding|(^|_)(place|cancel|modify)_order|(^|_)balance(_|$)/.test(name)), false);
    for (const name of ['place_order', 'get_account_snapshot', 'transfer_money', 'get_account_balance']) {
      lines.push(`M0_AC005 005e tools/call ${name} -> ${outcome(await first.rpc('tools/call', { name, arguments: {} }))}`);
    }
    process.stdout.write(`M0_AC005_BEGIN\n${lines.join('\n')}\nM0_AC005_END\n`);
    assert.equal(globalFetchCalls, 0);
  } finally {
    mock.timers.reset();
    await first.close();
    await second.close();
  }
});

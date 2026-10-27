// SPEC-ATP-AUTH-001 AC-005 (card t13, M1 RED-first): the four MCP methods are not refused for a
// missing member verification on the stub-free default server, and the pre-existing local denials
// (005a-005e) keep answering exactly what the M0 baseline recorded (m0-baseline.md section 4).
//
// Servers come straight from ../src/server.js with an injected synthetic transport; the global fetch
// recorder is installed first so an accidental real request would be recorded and rejected.
import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import type { Session } from './default-server-harness.js';

const recorder = await import('./fetch-recorder.js');
const harness = await import('./default-server-harness.js');
after(() => recorder.restoreOriginalFetch());

const SYNTHETIC_QUOTE = { stck_prpr: '120', stck_oprc: '110', stck_hgpr: '130', stck_lwpr: '100', prdy_vrss: '10', prdy_vrss_sign: '2', prdy_ctrt: '9.09', acml_vol: '1000' };
const START = '2026-10-24T00:00:00.000Z';
const args = { ...harness.reportArgs, cutoff: '2026-10-24T00:00:00Z' };

function makeServer(clock: () => string = () => START) {
  return harness.createStockMcpServer({
    rightsEnabled: true, localReportViewEnabled: true, origin: 'actual', clock,
    transport: { getMarketSnapshot: async () => SYNTHETIC_QUOTE },
  });
}

/** get_market_snapshot on a session; asserts OK first so a refusal prints its code. */
async function receiptFrom(session: Session): Promise<string> {
  const reply = await session.rpc('tools/call', { name: 'get_market_snapshot', arguments: { symbol: '005930', board: 'J' } });
  assert.equal(harness.outcome(reply), 'OK', 'get_market_snapshot (receipt source)');
  const receipt = reply.result._meta['moai-atp.local-evidence'];
  assert.equal(typeof receipt, 'string');
  return receipt as string;
}

async function buildWith(session: Session, receipt: string) {
  return session.rpc('tools/call', { name: 'build_report_input', arguments: { ...args, source_receipts: [receipt] } });
}

const NOT_FOUND = /^protocol_error:-32602:Resource not found: moai-atp:\/\/reports\//;

test('AC-005 Then: initialize, tools/list, tools/call and resources/read succeed with no member verification', async () => {
  recorder.resetFetchRecords();
  const session = await harness.openSession(makeServer());
  try {
    const listed = await session.rpc('tools/list', {});
    assert.equal(listed.result.tools.length, 36);
    const receipt = await receiptFrom(session);
    const built = await buildWith(session, receipt);
    assert.equal(harness.outcome(built), 'OK', 'tools/call build_report_input');
    const rendered = await session.rpc('tools/call', { name: 'render_report_html', arguments: { report_input: built.result.structuredContent } });
    assert.equal(harness.outcome(rendered), 'OK', 'tools/call render_report_html');
    const read = await session.rpc('resources/read', { uri: rendered.result.structuredContent.resource_uri });
    assert.equal(harness.outcome(read), 'OK', 'resources/read');
    assert.equal(read.result.contents[0].mimeType, 'text/html');
    assert.deepEqual(recorder.readFetchRecords(), []);
  } finally { await session.close(); }
});

test('AC-005a: resources/read of a report URI this process never issued is refused as Resource not found', async () => {
  recorder.resetFetchRecords();
  const session = await harness.openSession(makeServer());
  try {
    const reply = await session.rpc('resources/read', { uri: harness.UNISSUED_REPORT_URI });
    assert.match(harness.outcome(reply), NOT_FOUND);
  } finally { await session.close(); }
});

test('AC-005b: a source receipt issued by another server process is refused with invalid_provenance (same-store receipt is accepted)', async () => {
  recorder.resetFetchRecords();
  const first = await harness.openSession(makeServer());
  const second = await harness.openSession(makeServer());
  try {
    const foreign = await receiptFrom(first);
    assert.equal(harness.outcome(await buildWith(second, foreign)), 'invalid_provenance');
    const sameStore = await receiptFrom(first);
    assert.equal(harness.outcome(await buildWith(first, sameStore)), 'OK', 'control: same-store receipt');
  } finally { await first.close(); await second.close(); }
});

test('AC-005c: after the 5 minute TTL the receipt, the report URI and the retained ReportInput are all refused', async () => {
  recorder.resetFetchRecords();
  mock.timers.enable({ apis: ['Date'], now: Date.parse(START) });
  let clockNow = START;
  const session = await harness.openSession(makeServer(() => clockNow));
  try {
    const aged = await receiptFrom(session);
    mock.timers.tick(300_001);
    clockNow = '2026-10-24T00:05:00.001Z';
    assert.equal(harness.outcome(await buildWith(session, aged)), 'invalid_provenance', 'receipt after TTL');

    const fresh = await receiptFrom(session);
    const built = await buildWith(session, fresh);
    assert.equal(harness.outcome(built), 'OK', 'control: fresh receipt');
    const rendered = await session.rpc('tools/call', { name: 'render_report_html', arguments: { report_input: built.result.structuredContent } });
    assert.equal(harness.outcome(rendered), 'OK', 'control: render before TTL');
    const uri = rendered.result.structuredContent.resource_uri as string;
    assert.equal(harness.outcome(await session.rpc('resources/read', { uri })), 'OK', 'control: report URI before TTL');

    mock.timers.tick(300_001);
    clockNow = '2026-10-24T00:10:00.002Z';
    assert.match(harness.outcome(await session.rpc('resources/read', { uri })), NOT_FOUND, 'expired report URI');
    const again = await session.rpc('tools/call', { name: 'render_report_html', arguments: { report_input: built.result.structuredContent } });
    assert.equal(harness.outcome(again), 'invalid_provenance', 'original ReportInput after TTL');
  } finally { mock.timers.reset(); await session.close(); }
});

test('AC-005d: a ReportInput changed by one byte is refused with invalid_provenance (the untouched one renders)', async () => {
  recorder.resetFetchRecords();
  const session = await harness.openSession(makeServer());
  try {
    const built = await buildWith(session, await receiptFrom(session));
    assert.equal(harness.outcome(built), 'OK', 'build_report_input');
    const tampered = structuredClone(built.result.structuredContent);
    tampered.subject.name = 'forged';
    const refused = await session.rpc('tools/call', { name: 'render_report_html', arguments: { report_input: tampered } });
    assert.equal(harness.outcome(refused), 'invalid_provenance');
    const control = await session.rpc('tools/call', { name: 'render_report_html', arguments: { report_input: built.result.structuredContent } });
    assert.equal(harness.outcome(control), 'OK', 'control: untouched ReportInput');
  } finally { await session.close(); }
});

test('AC-005e: account, balance, order and transfer requests find no such tool', async () => {
  recorder.resetFetchRecords();
  const session = await harness.openSession(makeServer());
  try {
    const names: string[] = (await session.rpc('tools/list', {})).result.tools.map((tool: any) => tool.name as string);
    assert.equal(names.some((name) => /account|transfer|holding|(^|_)(place|cancel|modify)_order|(^|_)balance(_|$)/.test(name)), false);
    for (const name of ['place_order', 'get_account_snapshot', 'transfer_money', 'get_account_balance']) {
      const reply = await session.rpc('tools/call', { name, arguments: {} });
      assert.equal(harness.outcome(reply), `protocol_error:-32602:Tool ${name} not found`, name);
    }
  } finally { await session.close(); }
});

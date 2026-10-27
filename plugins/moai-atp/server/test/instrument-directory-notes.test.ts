// Card t26 [도구설명정정] M1 (test-first): the directory tool description and the shared result warning must match the
// production wiring: the official loader downloads the KIS KOSPI/KOSDAQ master zip files on first use, the default install
// keeps the tools closed (rightsEnabled=false) and the master files' usage rights stay pending. Synthetic only, no network.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';

const recorder = await import('./fetch-recorder.js');
const harness = await import('./default-server-harness.js');
after(() => recorder.restoreOriginalFetch());

const at = '2026-10-22T00:02:00Z';
const entry = { instrument_ref: 'TEST:000660', symbol: '000660', name: 'Synthetic Company', market: 'KR' as const, asset_class: 'equity' as const, exchange: null, currency: null, cik: null, corp_code: null, aliases: ['합성회사'], source_ref: 'synthetic-fixture' };
const directory = { origin: 'synthetic', source_received_at: '2026-10-22T00:00:00Z', source_as_of: null, source_url: 'https://example.invalid/synthetic', coverage: 'Synthetic examples only', entries: [entry] };
const loader = { async load() { return directory; } };

async function withServer<T>(options: Parameters<typeof harness.createStockMcpServer>[0], run: (session: import('./default-server-harness.js').Session) => Promise<T>): Promise<T> {
  const session = await harness.openSession(harness.createStockMcpServer(options));
  try { return await run(session); } finally { await session.close(); }
}
const open = { directoryEnabled: true, instrumentDirectory: loader, clock: () => at };
const describeTool = (tools: any[], name: string): string => String(tools.find(t => t.name === name)?.description ?? '');
const warningsOf = async (session: import('./default-server-harness.js').Session, name: string): Promise<string[]> => {
  const reply = await session.rpc('tools/call', { name, arguments: { query: '000660' } });
  assert.equal(harness.outcome(reply), 'OK');
  return reply.result.structuredContent.warnings as string[];
};

// 001a: the shared warning no longer states that no master download occurs.
test('t26-001a result warning does not claim that no master download occurs', async () => {
  await withServer(open, async session => {
    for (const tool of ['search_instruments', 'resolve_instrument']) {
      const warnings = await warningsOf(session, tool);
      assert.ok(warnings.every(w => !/No network master download/i.test(w)), `${tool}: ${warnings.join(' | ')}`);
    }
  });
});

// 001b: the corrected warning (shown by BOTH tools) names the official master download, the rights state and keeps the
// account/credential statement that is true.
test('t26-001b corrected warning names the official KIS master download, pending rights, and no account or credential handling', async () => {
  await withServer(open, async session => {
    for (const tool of ['search_instruments', 'resolve_instrument']) {
      const text = (await warningsOf(session, tool)).join(' | ');
      assert.match(text, /official KIS KOSPI\/KOSDAQ master files/, tool);
      assert.match(text, /downloaded on first use/, tool);
      assert.match(text, /rights are pending/, tool);
      assert.match(text, /No account lookup or credential handling occurs/, tool);
    }
  });
});

// 001c: the two other warnings stay as they were (scope of the supplied directory, never auto-select).
test('t26-001c the other two warnings are unchanged', async () => {
  await withServer(open, async session => {
    const warnings = await warningsOf(session, 'search_instruments');
    assert.equal(warnings.length, 3);
    assert.equal(warnings[0], 'Search only covers the supplied directory; no match does not prove nonexistence.');
    assert.equal(warnings[1], 'Directory candidates require independent identity, current listing/classification and source-rights verification. Never auto-select an ambiguous candidate.');
  });
});

// 002a: search_instruments description no longer says only the injected directory is searched.
test('t26-002a search_instruments description does not say that only an injected directory is searched', async () => {
  await withServer(open, async session => {
    const text = describeTool((await session.rpc('tools/list', {})).result.tools, 'search_instruments');
    assert.ok(text.length > 0);
    assert.ok(!text.includes('주입된 디렉터리만'), text);
  });
});

// 002b: and says what the production wiring does, without changing the conservative contract.
test('t26-002b search_instruments description names the official master download, the closed default and pending rights', async () => {
  await withServer(open, async session => {
    const text = describeTool((await session.rpc('tools/list', {})).result.tools, 'search_instruments');
    assert.match(text, /KIS 공식 KOSPI·KOSDAQ 마스터/);
    assert.match(text, /첫 사용 시 내려받/);
    assert.match(text, /권리 스위치/);
    assert.match(text, /이용 권리는 확인되지 않았/);
    assert.match(text, /단일 후보도 확인된 종목으로 자동 선택하지 않습니다/);
  });
});

// 002c: resolve_instrument description (leader ruling): it never implied "injected directory only" and still does not.
test('t26-002c resolve_instrument description does not imply that only an injected directory is searched and keeps its contract', async () => {
  await withServer(open, async session => {
    const text = describeTool((await session.rpc('tools/list', {})).result.tools, 'resolve_instrument');
    assert.ok(text.length > 0);
    assert.ok(!/주입된|injected|No network/i.test(text), text);
    assert.match(text, /단일 후보도 검증된 종목으로 자동 확정하지 않습니다/);
  });
});

// 003a: behavior unchanged: the default server keeps both tools closed and the corrected texts do not open them.
test('t26-003a the default server keeps both directory tools closed', async () => {
  await withServer({ rightsEnabled: false, clock: () => at }, async session => {
    for (const tool of ['search_instruments', 'resolve_instrument']) {
      const reply = await session.rpc('tools/call', { name: tool, arguments: { query: '000660' } });
      assert.equal(harness.outcome(reply), 'source_not_enabled', tool);
    }
  });
});

// 003b: behavior unchanged: result rights stay pending and the single candidate stays unconfirmed; no request was made.
test('t26-003b results keep rights pending and an unconfirmed single candidate, and make no network request', async () => {
  await withServer(open, async session => {
    const reply = await session.rpc('tools/call', { name: 'search_instruments', arguments: { query: '000660' } });
    const result = reply.result.structuredContent;
    assert.equal(result.rights_status, 'pending');
    assert.equal(result.resolution_status, 'single_candidate_not_confirmed');
    assert.equal(result.candidates[0].identity_status, 'directory_candidate_not_confirmed');
    assert.equal(recorder.readFetchRecords().length, 0);
  });
});

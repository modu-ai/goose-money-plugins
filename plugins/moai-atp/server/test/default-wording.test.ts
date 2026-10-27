// Card t33 [기본차단문구정합] M1 (test-first): the wording "blocked by default" must agree with the shipped setting.
// The server code default (read switches off) blocks the data tools; the shipped plugins/moai-atp/mcp.json turns the
// read switches on, so with local keys a tool call reaches KIS / OpenDART. This file (a) pins the facts, per tool and
// per setting, (b) requires every sentence that claims a default block to say which setting it talks about.
// Synthetic only: an injected fetchImpl routes by host, no network, no real credentials.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const recorder = await import('./fetch-recorder.js');
const harness = await import('./default-server-harness.js');
const sc = await import('./auth002-m2-scenarios.js');
const { createCredentialBackedServer, localReadSwitches } = await import('../src/credential-runtime.js');
after(() => recorder.restoreOriginalFetch());

// dist/test/default-wording.test.js -> plugins/moai-atp/
const pluginRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (relative: string): Promise<string> => readFile(join(pluginRoot, relative), 'utf8');

type Klass = 'K' | 'D' | 'M' | 'X' | 'H' | 'L';
/** The switch matrix (observed, .moai/reports/t33/switch-matrix-observation.md). K: KIS read switch + local keys; D: OpenDART switch + local key;
 *  M: instrument directory (KIS read switch, no key needed, downloads the KIS master files); X: injected transport only; H: blocked by a request
 *  contract conflict in every setting; L: local tools. A new tool must be classified here. */
const CLASS: Readonly<Record<string, Klass>> = {
  get_market_snapshot: 'K', get_price_history: 'K', get_market_flows: 'K', get_instrument_profile: 'K', get_market_headlines: 'K',
  get_credit_balances: 'K', get_short_sale_activity: 'K', get_stock_lending_activity: 'K', get_us_market_snapshot: 'K', get_index_futures_snapshot: 'K',
  get_domestic_etf_snapshot: 'K', get_overseas_futures_snapshot: 'K', get_us_price_history: 'K', get_intraday_price_history: 'K', get_us_product_profile: 'K',
  get_domestic_futures_price_history: 'K', get_domestic_futures_intraday_history: 'K', get_overseas_futures_price_history: 'K',
  get_overseas_futures_intraday_history: 'K', get_historical_intraday_price_history: 'K', get_market_orderbook: 'K', get_global_index_history: 'K',
  get_market_industry_investor_aggregates: 'K', get_overseas_ice_actions: 'K', get_global_index_period_history: 'K',
  get_fundamentals: 'D', get_public_filings: 'D',
  search_instruments: 'M', resolve_instrument: 'M',
  get_sec_company_concept: 'X', get_sec_submissions: 'X',
  get_domestic_index_history: 'H', get_kis_house_estimates: 'H', get_domestic_index_period_history: 'H',
  build_report_input: 'L', render_report_html: 'L',
};
const NAMES = Object.keys(CLASS);
const ofClass = (k: Klass): string[] => NAMES.filter(n => CLASS[n] === k);

const QUALIFIER: Readonly<Record<'K' | 'D' | 'M', string>> = {
  K: '서버 기본값(읽기 스위치 꺼짐)에서는 차단됩니다. 출하 플러그인 설정(mcp.json)은 KIS 읽기 스위치를 켜므로 로컬 키가 있으면 호출 시 KIS로 요청이 나갑니다.',
  D: '서버 기본값(읽기 스위치 꺼짐)에서는 차단됩니다. 출하 플러그인 설정(mcp.json)은 OpenDART 읽기 스위치를 켜므로 로컬 키가 있으면 호출 시 OpenDART로 요청이 나갑니다.',
  M: '서버 기본값(읽기 스위치 꺼짐)에서는 닫혀 있습니다. 출하 플러그인 설정(mcp.json)은 KIS 읽기 스위치를 켜므로 키가 없어도 첫 사용 시 KIS 마스터 파일 요청이 나갑니다.',
};
/** Sentences that claim a default block with no setting named. */
const DEFAULT_CLAIM = /기본(값은)?\s*(권리 미확인(으로)?\s*)?(차단|비활성)|권리\s*(미확인 시|확인 전)\s*기본 차단|기본 권리 미확인 차단|기본 실행기는 비활성|기본 설치는 닫혀|default[- ]?denied/i;
/** The tools whose description made such a claim before this card (8cc4c6a). */
const WAS_CLAIMING: Readonly<Record<string, 'K' | 'D' | 'M'>> = {
  get_market_snapshot: 'K', get_credit_balances: 'K', get_short_sale_activity: 'K', get_stock_lending_activity: 'K', get_market_orderbook: 'K',
  get_global_index_history: 'K', get_market_industry_investor_aggregates: 'K', get_overseas_ice_actions: 'K', get_global_index_period_history: 'K',
  get_fundamentals: 'D', search_instruments: 'M',
};

interface Cell { code: string; requests: { token: number; data: number; dart: number; master: number } }
const zero = { token: 0, data: 0, dart: 0, master: 0 };
async function s0(name: string): Promise<Cell> { // server code default: no switch options at all
  const home = await mkdtemp(join(tmpdir(), 't33-s0-'));
  let count = 0;
  sc.resetPacer();
  const session = await harness.openSession(createCredentialBackedServer({ homeDir: home, env: {}, fetchImpl: (async () => { count++; throw new Error('s0_fetch'); }) as unknown as typeof fetch }));
  try { const r = await sc.call(session, name); return { code: r.code, requests: { ...zero, data: count } }; } finally { await session.close(); await rm(home, { recursive: true, force: true }); }
}
async function shipped(name: string, home: 'none' | 'both'): Promise<Cell> { // the three switches mcp.json turns on, with / without synthetic local keys
  const r = await sc.withSession({ home }, session => sc.call(session, name));
  const t = r.traffic;
  return { code: r.value.code, requests: { token: t.token.length, data: t.data.length, dart: t.dart.length, master: t.master.length } };
}
const total = (c: Cell): number => c.requests.token + c.requests.data + c.requests.dart + c.requests.master;
async function listTools(options: Parameters<typeof harness.createStockMcpServer>[0] = {}): Promise<any[]> {
  const session = await harness.openSession(harness.createStockMcpServer(options));
  try { return (await session.rpc('tools/list', {})).result.tools; } finally { await session.close(); }
}

// ---- 001 facts (these pass before and after the wording change) -----------------------------------------------------

test('t33-001a the shipped mcp.json turns the three read switches on, and the launcher reads them as switches', async () => {
  const env = JSON.parse(await read('mcp.json')).mcpServers['moai-kis-readonly'].env;
  assert.deepEqual(env, { GOOSE_KIS_READ_ENABLED: '1', GOOSE_OPENDART_READ_ENABLED: '1', GOOSE_LOCAL_REPORT_VIEW_ENABLED: '1' });
  assert.deepEqual(localReadSwitches(env), { kis: true, opendart: true, local_view: true });
  assert.deepEqual(localReadSwitches({}), { kis: false, opendart: false, local_view: false });
});

test('t33-001b every registered tool is classified in the switch matrix', async () => {
  const names = (await listTools()).map((t: any) => t.name as string).sort();
  assert.deepEqual(names, [...NAMES].sort());
});

for (const name of ofClass('K')) {
  test(`t33-001c K ${name}: blocked at the server default; keys missing before any request; token and data request with keys`, async () => {
    const a = await s0(name);
    assert.equal(a.code, 'rights_pending'); assert.equal(total(a), 0);
    const b = await shipped(name, 'none');
    assert.equal(b.code, 'credential_missing'); assert.equal(total(b), 0);
    const c = await shipped(name, 'both');
    assert.equal(c.requests.token, 1, name); assert.equal(c.requests.data, 1, name);
  });
}
for (const name of ofClass('D')) {
  test(`t33-001d D ${name}: blocked at the server default; key missing before any request; OpenDART request with a key`, async () => {
    const a = await s0(name);
    assert.equal(a.code, 'source_not_enabled'); assert.equal(total(a), 0);
    const b = await shipped(name, 'none');
    assert.equal(b.code, 'credential_missing'); assert.equal(total(b), 0);
    const c = await shipped(name, 'both');
    assert.equal(c.requests.dart, 1, name); assert.equal(c.requests.token + c.requests.data, 0);
  });
}
for (const name of ofClass('M')) {
  test(`t33-001e M ${name}: closed at the server default; the shipped setting requests the KIS master files even with no key`, async () => {
    const a = await s0(name);
    assert.equal(a.code, 'source_not_enabled'); assert.equal(total(a), 0);
    const b = await shipped(name, 'none');
    assert.ok(b.requests.master >= 1, `${name}: ${JSON.stringify(b)}`);
    assert.equal(b.requests.token + b.requests.data + b.requests.dart, 0);
  });
}
for (const name of ofClass('X')) {
  test(`t33-001f X ${name}: needs an injected transport in every setting`, async () => {
    for (const cell of [await s0(name), await shipped(name, 'none'), await shipped(name, 'both')]) { assert.equal(cell.code, 'source_not_enabled'); assert.equal(total(cell), 0); }
  });
}
for (const name of ofClass('H')) {
  test(`t33-001g H ${name}: stopped by the request contract conflict whenever a switch is on, and never requests`, async () => {
    for (const cell of [await shipped(name, 'none'), await shipped(name, 'both')]) { assert.equal(cell.code, 'request_contract_conflict'); assert.equal(total(cell), 0); }
  });
}
test('t33-001h L the local report builder and renderer work at the server default (no switch)', async () => {
  const home = await mkdtemp(join(tmpdir(), 't33-l-'));
  const session = await harness.openSession(createCredentialBackedServer({ homeDir: home, env: {}, fetchImpl: (async () => { throw new Error('l_fetch'); }) as unknown as typeof fetch }));
  try {
    const built = await sc.call(session, 'build_report_input');
    assert.equal(built.code, 'OK');
    const rendered = await session.rpc('tools/call', { name: 'render_report_html', arguments: { report_input: built.reply.result.structuredContent } });
    assert.equal(harness.outcome(rendered), 'OK');
  } finally { await session.close(); await rm(home, { recursive: true, force: true }); }
});

// ---- 002 wording: tool descriptions ----------------------------------------------------------------------------------

test('t33-002a no tool description claims a default block without naming the setting', async () => {
  const bad = (await listTools()).filter((t: any) => DEFAULT_CLAIM.test(String(t.description))).map((t: any) => `${t.name}: ${String(t.description).slice(0, 120)}`);
  assert.deepEqual(bad, []);
});
for (const [name, klass] of Object.entries(WAS_CLAIMING)) {
  test(`t33-002b ${name} names both settings (${klass})`, async () => {
    const text = String((await listTools()).find((t: any) => t.name === name)?.description ?? '');
    assert.ok(text.includes(QUALIFIER[klass]), `${name}: ${text}`);
  });
}
test('t33-002c descriptions of the always-blocked and injected-only tools stay as they were', async () => {
  const tools = await listTools();
  const text = (n: string): string => String(tools.find((t: any) => t.name === n)?.description ?? '');
  assert.match(text('get_domestic_index_history'), /모든 전송이 차단됩니다/);
  assert.match(text('get_kis_house_estimates'), /모두 차단됩니다/);
  assert.match(text('get_domestic_index_period_history'), /전송은 항상 차단됩니다/);
  assert.ok(!/별도 호스트 전송이 주입되면/.test(text('get_global_index_period_history')), 'the shipped setting does not need an injected transport');
});

// ---- 003 wording: documents and metadata -----------------------------------------------------------------------------

const DOC_CLAIM = /기본 (권리 )?차단|기본 거부|default[- ]denied|all default denied/i;
for (const file of ['README.md', 'server/package.json', 'skills/goose/references/roles/portfolio-risk/PROCEDURE.md', 'skills/goose/references/workflows/strategy.md', 'skill-sources/goose-strategy/SKILL.md']) {
  test(`t33-003a ${file} has no unqualified default-block claim`, async () => {
    const lines = (await read(file)).split('\n').filter(l => DOC_CLAIM.test(l)).map(l => l.slice(0, 140));
    assert.deepEqual(lines, []);
  });
}
test('t33-003b README names the server default and the shipped setting, and the keyless directory request', async () => {
  const text = await read('README.md');
  assert.match(text, /서버 기본값\(읽기 스위치 꺼짐\)/);
  assert.match(text, /출하 플러그인 설정\(`?mcp\.json`?\)은 .*읽기 스위치를 켭니다/);
  assert.match(text, /디렉터리 도구는 .*키가 없어도 .*마스터/);
  assert.match(text, /로컬 키가 없으면 .*요청 전에/);
});

// ---- 004 capability metadata -----------------------------------------------------------------------------------------

test('t33-004a CAPABILITIES.json keeps the default_denied key and adds a scope sentence that names both settings', async () => {
  const caps = JSON.parse(await read('CAPABILITIES.json'));
  assert.ok(Array.isArray(caps.default_denied) && caps.default_denied.includes('get_market_snapshot'));
  assert.equal(typeof caps.default_denied_scope, 'string');
  for (const part of ['서버 기본값', '읽기 스위치', '출하 플러그인 설정']) assert.ok(caps.default_denied_scope.includes(part), part);
});
test('t33-004b CAPABILITIES.json no longer calls the local report tools default-denied (they work at the server default)', async () => {
  const caps = JSON.parse(await read('CAPABILITIES.json'));
  assert.equal(caps.local_report_input_builder.default_denied, false);
  assert.equal(caps.local_html_report_renderer.default_denied, false);
});

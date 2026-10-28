// SPEC-ATP-AUTH-001 M1 (card t13): shared harness for the stub-free default server tests.
//
// "Stub-free" means no synthetic-member-access.ts: the servers below come straight from
// ../src/server.js and ../src/credential-runtime.js, the way main.ts builds them. Test files
// MUST install ./fetch-recorder.js before importing this module (it imports the server modules).
// Everything here is synthetic: injected fetchImpl, a mkdtemp home with synthetic keys, env {}.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createStockMcpServer } from '../src/server.js';
import { createCredentialBackedServer } from '../src/credential-runtime.js';
import { saveLocalCredentials } from '../src/local-credentials.js';
import { envForHome, prepareHome } from './credential-home.js';
import { inputs as sourceInputs } from './source-input-fixtures.js';
import { nativePeriodInput } from './native-period-mcp-fixtures.js';

export { createStockMcpServer };

export type Rpc = (method: string, params: Record<string, unknown>) => Promise<any>;
export interface Session { rpc: Rpc; close: () => Promise<void> }

export async function openSession(server: ReturnType<typeof createStockMcpServer>): Promise<Session> {
  const [client, peer] = InMemoryTransport.createLinkedPair();
  let id = 0;
  const pending = new Map<number, (message: any) => void>();
  client.onmessage = (message: any) => { pending.get(message.id)?.(message); pending.delete(message.id); };
  const rpc: Rpc = async (method, params) => {
    const n = ++id;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reply = new Promise<any>((resolve, reject) => {
      timer = setTimeout(() => { pending.delete(n); reject(new Error(`m1_rpc_timeout:${method}`)); }, 30_000);
      pending.set(n, resolve);
    });
    try { await client.send({ jsonrpc: '2.0', id: n, method, params } as any); return await reply; }
    finally { clearTimeout(timer); }
  };
  await client.start();
  await server.connect(peer);
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'm1-default-server', version: '1' } });
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as any);
  return { rpc, close: async () => { await server.close(); await client.close(); } };
}

/**
 * One observable outcome string per reply: `OK`, the `error_code` token of a tool error, or
 * `protocol_error:<code>:<message>` for a JSON-RPC error. Assertions compare this string so a
 * failure prints what the server actually answered (for example member_login_required).
 */
export function outcome(reply: any): string {
  if (reply?.error) return `protocol_error:${String(reply.error.code)}:${String(reply.error.message).slice(0, 160)}`;
  const result = reply?.result;
  if (result?.isError) {
    const text = String(result.content?.[0]?.text ?? '');
    const match = /error_code=([A-Za-z0-9_]+)/.exec(text);
    return match ? match[1]! : `isError:${text.slice(0, 160)}`;
  }
  return 'OK';
}

export const MEMBER_GUARD_CODE = /member_login_required|member_session_changed|provider_checks_required/;

// ---- provider allowlist (AC-001 table): parsed host name and port, never a substring match ----

const ALLOWED = new Set(['openapi.koreainvestment.com:9443', 'opendart.fss.or.kr:443', 'new.real.download.dws.co.kr:443']);
const SEC_ALLOWED = new Set(['data.sec.gov:443', 'www.sec.gov:443']);

/** `host:port` of a request URL; the port is 443 when the https URL names none. */
export function hostAndPort(raw: string): string {
  const url = new URL(raw);
  return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
}

export function isAllowlisted(raw: string, options: { secEnabled?: boolean } = {}): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const key = hostAndPort(raw);
  return ALLOWED.has(key) || (options.secEnabled === true && SEC_ALLOWED.has(key));
}

/** Request URLs whose (host name, port) is outside the allowlist. */
export function offAllowlist(urls: readonly string[]): string[] {
  return urls.filter((raw) => !isAllowlisted(raw));
}

// ---- synthetic provider spy (injected fetchImpl) ----

const QUOTE_OUTPUT = { stck_prpr: '120', stck_oprc: '110', stck_hgpr: '130', stck_lwpr: '100', prdy_vrss: '10', prdy_vrss_sign: '2', prdy_ctrt: '9.09', acml_vol: '1000' };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function syntheticResponse(url: URL): Response {
  if (url.hostname === 'openapi.koreainvestment.com') {
    if (url.pathname === '/oauth2/tokenP') return json({ access_token: 'synthetic-token-never-real', access_token_token_expired: '2099-01-01 00:00:00' });
    if (url.pathname === '/uapi/domestic-stock/v1/quotations/inquire-price') return json({ rt_cd: '0', msg_cd: 'MCA00000', msg1: 'synthetic', output: QUOTE_OUTPUT });
    return json({ rt_cd: '0', msg_cd: 'MCA00000', msg1: 'synthetic', output: {}, output1: {}, output2: [] });
  }
  if (url.hostname === 'opendart.fss.or.kr') return json({ status: '013', message: 'synthetic no data' });
  return new Response('', { status: 200 });
}

/** Records every requested URL. Allowlisted hosts get a synthetic success; any other host is rejected. */
export function createProviderSpy() {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(raw);
    if (!isAllowlisted(raw)) throw new Error('spy_rejected_host');
    return syntheticResponse(new URL(raw));
  };
  return { fetchImpl, urls };
}

// ---- default server construction ----

const SYNTHETIC_KIS = { appKey: 'synthetic-app-key-never-real', appSecret: 'synthetic-app-secret-never-real' };
const SYNTHETIC_DART_KEY = 'SYNTHETIC_OPENDART_KEY_00000000000000000';

/** The baseline (macOS) file-store preparation: a mkdtemp home holding synthetic KIS and OpenDART keys in the real keystore layout. */
export async function makeFileStoreSyntheticHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'atp-m1-home-'));
  await saveLocalCredentials({ kis: SYNTHETIC_KIS, opendart: { apiKey: SYNTHETIC_DART_KEY } }, process.cwd(), { confirmed: true, homeDir: home });
  return home;
}

/** mkdtemp home for a stub-free default server test; the shared helper decides how the home is prepared (card t30), and createDefaultServer finds the matching env by the home path. */
export async function makeSyntheticHome(): Promise<string> {
  return (await prepareHome('synthetic')).home;
}

/** The option keys main.ts passes, plus the test-only injections. No memberAccess. */
export function createDefaultServer(options: { homeDir: string; fetchImpl: typeof fetch; switchesOn: boolean }) {
  return createCredentialBackedServer({
    studentReleaseScope: true,
    rightsEnabled: options.switchesOn,
    openDartEnabled: options.switchesOn,
    authorizeOpenDartRead: async () => true,
    localReportViewEnabled: true,
    env: envForHome(options.homeDir),
    homeDir: options.homeDir,
    fetchImpl: options.fetchImpl,
  });
}

// ---- synthetic tool arguments (the same fixtures the existing stdio tests use) ----

const subject = { id: 'KRX:000660', name: '합성 자료', venue: 'KRX', currency: 'KRW' };
export const reportArgs = { report_id: 'R01', subject, display_timezone: 'Asia/Seoul' };

export const toolArguments: Record<string, Record<string, unknown>> = {
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
  build_report_input: { ...reportArgs, cutoff: '2026-10-23T03:00:00.000Z', calls: [] },
  render_report_html: {}, // filled from the build_report_input result during a sweep
  ...sourceInputs,
  get_domestic_index_period_history: nativePeriodInput('W', '072'),
  get_global_index_period_history: nativePeriodInput('W'),
};

/** Unissued but well-formed report URI, used when no report was rendered. */
export const UNISSUED_REPORT_URI = 'moai-atp://reports/00000000-0000-4000-8000-000000000000';

/**
 * tools/list, then every listed tool once with its synthetic arguments, then resources/read of the
 * rendered report URI (an unissued URI when no report was rendered). Returns one outcome per tool.
 */
export async function sweepAllTools(session: Session): Promise<{ listed: string[]; byTool: Record<string, string>; readOutcome: string; readReply: any }> {
  const listed: string[] = (await session.rpc('tools/list', {})).result.tools.map((tool: any) => tool.name as string);
  const byTool: Record<string, string> = {};
  let builtReport: unknown;
  let reportUri: string | undefined;
  for (const name of listed) {
    const args = name === 'render_report_html' ? { report_input: builtReport } : toolArguments[name] ?? {};
    const reply = await session.rpc('tools/call', { name, arguments: args });
    if (name === 'build_report_input') builtReport = reply.result?.structuredContent;
    if (name === 'render_report_html') reportUri = reply.result?.structuredContent?.resource_uri;
    byTool[name] = outcome(reply);
  }
  const readReply = await session.rpc('resources/read', { uri: reportUri ?? UNISSUED_REPORT_URI });
  return { listed, byTool, readOutcome: outcome(readReply), readReply };
}

/** Codes the baseline stub harness produced with both read switches off (m0-baseline.md section 3). */
export const SWITCH_OFF_SOURCE_NOT_ENABLED = ['get_fundamentals', 'get_public_filings', 'get_sec_company_concept', 'get_sec_submissions', 'search_instruments', 'resolve_instrument'];
export const SWITCH_OFF_OK = ['build_report_input', 'render_report_html'];
export function expectedSwitchOffCode(tool: string): string {
  if (SWITCH_OFF_SOURCE_NOT_ENABLED.includes(tool)) return 'source_not_enabled';
  if (SWITCH_OFF_OK.includes(tool)) return 'OK';
  return 'rights_pending';
}

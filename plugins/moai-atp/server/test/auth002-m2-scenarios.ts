// SPEC-ATP-AUTH-002 M2 (card t14): scenario machinery shared by the AC-002 matrix test and the
// M2 pre-start measurement script. This module is a helper, not a test (its name has no `.test.`).
//
// Everything here is synthetic: an injected fetchImpl routes by host, the keys live in a mkdtemp home
// (or in a synthetic env), and nothing reaches a network. Test files MUST install ./fetch-recorder.js
// before importing this module, so a request that bypasses the injected fetchImpl is recorded and
// rejected rather than sent.
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import dailyFixture from './fixtures/kis039_daily_rows_synthetic.json' with { type: 'json' };
import { createCredentialBackedServer } from '../src/credential-runtime.js';
import { PROCESS_PACER } from '../src/kis-http.js';
import { saveLocalCredentials } from '../src/local-credentials.js';
import { openSession, outcome, toolArguments, type Session } from './default-server-harness.js';
import { prepareHome } from './credential-home.js';

export type Family = 'K1' | 'K2' | 'K3' | 'K4' | 'O1' | 'O2';
export type FailureClass = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8';

/** The ten tools of the covered families (spec.md section 3.2 "적용 계열" table, K1-K4, O1, O2). */
export const COVERED: readonly { tool: string; family: Family; provider: 'kis' | 'opendart' }[] = [
  { tool: 'get_market_snapshot', family: 'K1', provider: 'kis' },
  { tool: 'get_price_history', family: 'K2', provider: 'kis' },
  { tool: 'get_instrument_profile', family: 'K3', provider: 'kis' },
  { tool: 'get_market_headlines', family: 'K3', provider: 'kis' },
  { tool: 'get_market_flows', family: 'K3', provider: 'kis' },
  { tool: 'get_credit_balances', family: 'K4', provider: 'kis' },
  { tool: 'get_short_sale_activity', family: 'K4', provider: 'kis' },
  { tool: 'get_stock_lending_activity', family: 'K4', provider: 'kis' },
  { tool: 'get_fundamentals', family: 'O1', provider: 'opendart' },
  { tool: 'get_public_filings', family: 'O2', provider: 'opendart' },
];

// ---- synthetic keys and homes -----------------------------------------------------------------

export const SYNTHETIC_KIS = { appKey: 'synthetic-app-key-never-real', appSecret: 'synthetic-app-secret-never-real' };
// 40 characters, the length the OpenDART key schema requires.
export const SYNTHETIC_DART_KEY = 'SYNTHETIC_OPENDART_KEY_00000000000000000';

export type HomeKind = 'both' | 'kis' | 'dart' | 'none' | 'corrupt' | 'unsafe';

/**
 * A mkdtemp home. `corrupt` and `unsafe` build the keystore by hand with `.goose` and `.goose/keystore`
 * at 0700 (so the keystore directory checks pass and the file itself is what is refused): `corrupt` is
 * a 0600 file that is not JSON, `unsafe` is a valid file at 0644.
 */
export async function makeHome(kind: HomeKind): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'atp-m2-home-'));
  if (kind === 'none') return home;
  if (kind === 'corrupt' || kind === 'unsafe') {
    const goose = join(home, '.goose');
    const keystore = join(goose, 'keystore');
    for (const path of [goose, keystore]) { await mkdir(path, { mode: 0o700 }); await chmod(path, 0o700); }
    const file = join(keystore, 'credentials.json');
    const content = kind === 'corrupt'
      ? '{"schemaVersion":1'
      : `${JSON.stringify({ schemaVersion: 1, providers: { kis: SYNTHETIC_KIS, opendart: { apiKey: SYNTHETIC_DART_KEY } } })}\n`;
    await writeFile(file, content, { mode: 0o600 });
    await chmod(file, kind === 'corrupt' ? 0o600 : 0o644);
    return home;
  }
  const providers = kind === 'both' ? { kis: SYNTHETIC_KIS, opendart: { apiKey: SYNTHETIC_DART_KEY } }
    : kind === 'kis' ? { kis: SYNTHETIC_KIS } : { opendart: { apiKey: SYNTHETIC_DART_KEY } };
  await saveLocalCredentials(providers, process.cwd(), { confirmed: true, homeDir: home });
  return home;
}

// ---- synthetic responses -----------------------------------------------------------------------

export type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;
export interface Overrides { token?: Handler; data?: Handler; dart?: Handler; /** KIS master-file host used by the instrument-directory tools. */ master?: Handler }
export interface Traffic { token: string[]; data: string[]; dart: string[]; master: string[]; other: string[] }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** The default OpenDART transport has origin `actual`, which refuses a response whose url is empty. */
const withUrl = (response: Response, url: URL): Response => { Object.defineProperty(response, 'url', { value: url.href }); return response; };
const QUOTE_OUTPUT = { stck_prpr: '120', stck_oprc: '110', stck_hgpr: '130', stck_lwpr: '100', prdy_vrss: '10', prdy_vrss_sign: '2', prdy_ctrt: '9.09', acml_vol: '1000' };
const Q = '/uapi/domestic-stock/v1/quotations/';

export const tokenOk: Handler = () => json({ access_token: 'synthetic-token-never-real', access_token_token_expired: '2099-01-01 00:00:00' });
export const dataOk: Handler = (url) => {
  switch (url.pathname) {
    case `${Q}inquire-price`: return json({ rt_cd: '0', msg_cd: 'MCA00000', msg1: 'synthetic', output: QUOTE_OUTPUT });
    case `${Q}inquire-daily-itemchartprice`: return json(dailyFixture.response);
    case `${Q}search-stock-info`: return json({ rt_cd: '0', output: { pdno: '000660', prdt_type_cd: '300', prdt_name: 'Synthetic company' } });
    case `${Q}news-title`: return json({ rt_cd: '0', output: [{ cntt_usiq_srno: '1', hts_pbnt_titl_cntt: 'Synthetic title' }] });
    case `${Q}inquire-investor`: return json({ rt_cd: '0', output: [{ stck_bsop_date: '20261020', prsn_ntby_qty: '1', prsn_ntby_tr_pbmn: '2', frgn_ntby_qty: '3', frgn_ntby_tr_pbmn: '4', orgn_ntby_qty: '5', orgn_ntby_tr_pbmn: '6' }] });
    case `${Q}daily-loan-trans`: return json({ rt_cd: '0', output1: [{ bsop_date: '20261020', new_stcn: '4', rdmp_stcn: '2', rmnd_stcn: '20' }] });
    case `${Q}daily-credit-balance`: return json({ rt_cd: '0', output: [{ deal_date: '20261019', stlm_date: '20261021', whol_loan_new_stcn: '10', whol_loan_rdmp_stcn: '2', whol_stln_new_stcn: '' }] });
    default: return json({ rt_cd: '0', msg_cd: 'MCA00000', msg1: 'synthetic', output: {}, output1: {}, output2: [] });
  }
};
export const dartOk: Handler = (url) => withUrl(json({ status: '013', message: 'synthetic no data' }), url);

/** HTTP answer with a short synthetic text body. */
export const httpStatus = (code: number): Handler => (url) => withUrl(new Response('synthetic failure', { status: code }), url);
/** The fetch call itself rejects with an error of the given `name` (`Error`, `TimeoutError`, `AbortError`). */
export const rejectsWith = (name: string): Handler => () => { throw Object.assign(new Error(`synthetic_${name}`), { name }); };
/** HTTP 200 whose body stream errors on the first read with an error of the given `name`. */
export const bodyErrorsWith = (name: string): Handler => (url) => withUrl(new Response(new ReadableStream({
  pull(controller) { controller.error(Object.assign(new Error(`synthetic_body_${name}`), { name })); },
}), { status: 200 }), url);
export const notJson: Handler = (url) => withUrl(new Response('not json at all', { status: 200 }), url);
export const wrongShapeJson: Handler = (url) => withUrl(json({ unexpected: 'shape' }), url);
export const declaredTooLarge: Handler = (url) => withUrl(new Response('{}', { status: 200, headers: { 'content-length': '300001' } }), url);
/** KIS answers HTTP 200 with rt_cd != 0 and no data roots, the usual shape of a provider-side refusal. */
export const providerRefusal: Handler = () => json({ rt_cd: '1', msg_cd: 'EGW00000', msg1: 'synthetic provider refusal' });
/** KIS-039 daily-bar answer whose second row repeats the first row's business date. */
export const duplicateBusinessDate: Handler = () => json({ ...dailyFixture.response, output2: [dailyFixture.response.output2[0], dailyFixture.response.output2[0]] });
export const dartRateLimitBody: Handler = (url) => withUrl(json({ status: '020', message: 'synthetic request limit exceeded' }), url);

function routedFetch(overrides: Overrides, traffic: Traffic): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    if (url.hostname === 'openapi.koreainvestment.com') {
      if (url.pathname === '/oauth2/tokenP') { traffic.token.push(raw); return (overrides.token ?? tokenOk)(url, init); }
      traffic.data.push(raw);
      return (overrides.data ?? dataOk)(url, init);
    }
    if (url.hostname === 'opendart.fss.or.kr') { traffic.dart.push(raw); return (overrides.dart ?? dartOk)(url, init); }
    if (url.hostname === 'new.real.download.dws.co.kr') {
      traffic.master.push(raw);
      if (overrides.master) return overrides.master(url, init);
    } else traffic.other.push(raw);
    throw new Error('m2_unexpected_host');
  }) as typeof fetch;
}

// ---- running a case ----------------------------------------------------------------------------

export interface CaseSetup { home: HomeKind; env?: NodeJS.ProcessEnv; overrides?: Overrides }
export interface CallResult { reply: any; code: string; isError: boolean }

/** Every tool reply the scenarios received (JSON), kept for the AC-002i status-wording search. */
export const observedReplies: string[] = [];

/** PROCESS_PACER is shared by every KIS data call in the process and spaces them by 1,000 ms; clear it per case. */
export function resetPacer(): void { (PROCESS_PACER as unknown as { nextSlotAt: number }).nextSlotAt = 0; }

export function newTraffic(): Traffic { return { token: [], data: [], dart: [], master: [], other: [] }; }

/** The server main.ts builds, with the switches on, the given synthetic env, home and routed fetch. */
export function buildServer(home: string, fetchImpl: typeof fetch, env: NodeJS.ProcessEnv = {}) {
  return createCredentialBackedServer({
    studentReleaseScope: true,
    rightsEnabled: true,
    openDartEnabled: true,
    authorizeOpenDartRead: async () => true,
    localReportViewEnabled: true,
    env,
    homeDir: home,
    fetchImpl,
  });
}

export async function call(session: Session, name: string, args?: Record<string, unknown>): Promise<CallResult> {
  const reply = await session.rpc('tools/call', { name, arguments: args ?? toolArguments[name] ?? {} });
  observedReplies.push(JSON.stringify(reply));
  return { reply, code: outcome(reply), isError: reply?.result?.isError === true };
}

/** One server session on a fresh home; `fn` makes the calls; the home is removed afterwards. */
export async function withSession<T>(setup: CaseSetup, fn: (session: Session, traffic: Traffic) => Promise<T>): Promise<{ value: T; traffic: Traffic }> {
  const prepared = await prepareHome(setup.home, { env: setup.env });
  const home = prepared.home;
  const traffic = newTraffic();
  resetPacer();
  const session = await openSession(buildServer(home, routedFetch(setup.overrides ?? {}, traffic), prepared.env));
  try { return { value: await fn(session, traffic), traffic }; }
  finally { await session.close(); await rm(home, { recursive: true, force: true }); }
}

export async function runCase(tool: string, setup: CaseSetup): Promise<CallResult & { traffic: Traffic }> {
  const { value, traffic } = await withSession(setup, (session) => call(session, tool));
  return { ...value, traffic };
}

// The real timer functions, captured while no mock is installed: runDartDeadline mocks setTimeout for its whole
// body, so a watchdog built on the global (mocked) setTimeout would never fire in real time.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
/**
 * Real-time bound on each wait inside runDartDeadline (SPEC-ATP-AUTH-002 D1, audit debt DART-DEADLINE-HANG).
 * The healthy case takes 8-158 ms (100 runs at load average ~120, D1 baseline), so 60,000 ms is ~380 times the
 * slowest observed run and still ends a hang in a minute instead of hanging CI.
 */
export const DART_DEADLINE_WATCHDOG_MS = 60_000;

/** `work` or, when it has not settled after `ms` of REAL time, a rejection that names what was awaited. The timer is cleared either way. */
function withWatchdog<T>(work: Promise<T>, ms: number, tool: string, awaited: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<never>((_, reject) => {
    timer = realSetTimeout(() => reject(new Error(`runDartDeadline watchdog: ${tool} did not ${awaited} within ${ms} ms of real time`)), ms);
  });
  return Promise.race([work, watchdog]).finally(() => realClearTimeout(timer));
}

/**
 * An OpenDART call that never completes within the transport's own 10,000 ms deadline. The deadline timer
 * is a real setTimeout inside opendart-http.ts; mocked timers let the case advance it without waiting.
 * `stage` says whether the fetch itself or the response body read is the part that hangs.
 * Both waits are bounded by a real-time watchdog (`watchdogMs`), so a tool that returns before it reaches the
 * injected fetch fails the case instead of hanging the run.
 */
export async function runDartDeadline(tool: string, stage: 'fetch' | 'body', watchdogMs: number = DART_DEADLINE_WATCHDOG_MS): Promise<CallResult & { traffic: Traffic }> {
  let started!: () => void;
  const hung = new Promise<void>((resolve) => { started = resolve; });
  const never = new Promise<never>(() => undefined);
  const dart: Handler = (url) => {
    if (stage === 'fetch') { started(); return never; }
    return withUrl(new Response(new ReadableStream({ pull() { started(); return never; } }), { status: 200 }), url);
  };
  const prepared = await prepareHome('both');
  const home = prepared.home;
  const traffic = newTraffic();
  resetPacer();
  const session = await openSession(buildServer(home, routedFetch({ dart }, traffic), prepared.env));
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = call(session, tool);
    pending.catch(() => undefined); // if the watchdog ends the case first, a later rejection of the call is not an unhandled one
    await withWatchdog(hung, watchdogMs, tool, `reach the injected OpenDART ${stage}`);
    mock.timers.tick(10_000);
    return { ...(await withWatchdog(pending, watchdogMs, tool, 'answer after the 10,000 ms deadline tick')), traffic };
  } finally {
    mock.timers.reset();
    await session.close();
    await rm(home, { recursive: true, force: true });
  }
}

// ---- the injection table (plan.md M2 code table; one entry per injected failure) ---------------

export interface Injection {
  id: string;
  /** acceptance.md AC-002 row that owns the injection. */
  row: '002d' | '002e' | '002f' | '002g' | '002h' | '002k';
  cls: FailureClass;
  text: string;
  setup: CaseSetup;
  /** Expected tool-surface code per family. A family with no entry is not asserted for this injection. */
  expect: Partial<Record<Family, string>>;
  /** Families the injection is run for. */
  runFor: readonly Family[];
  /** Mocked-timer OpenDART deadline case instead of a routed response. */
  dartDeadline?: 'fetch' | 'body';
}

const KIS4: readonly Family[] = ['K1', 'K2', 'K3', 'K4'];
const DART2: readonly Family[] = ['O1', 'O2'];
const ALL10: readonly Family[] = [...KIS4, ...DART2];
const same = (code: string, families: readonly Family[]): Partial<Record<Family, string>> => Object.fromEntries(families.map((f) => [f, code]));
const kis = (overrides: Overrides, extra: Partial<CaseSetup> = {}): CaseSetup => ({ home: 'both', overrides, ...extra });

export const INJECTIONS: readonly Injection[] = [
  // 002d: F1 / F2 (the third and fourth entries are T14-D6's two unreadable-key-file cases)
  { id: 'keys-unset', row: '002d', cls: 'F1', text: 'no key stored and no env key', setup: { home: 'none' }, runFor: ALL10, expect: same('credential_missing', ALL10) },
  { id: 'key-file-corrupt', row: '002d', cls: 'F1', text: 'credentials.json at 0600 is not JSON', setup: { home: 'corrupt' }, runFor: ALL10, expect: same('credential_missing', ALL10) },
  { id: 'key-file-unsafe', row: '002d', cls: 'F1', text: 'credentials.json is valid but at 0644', setup: { home: 'unsafe' }, runFor: ALL10, expect: same('credential_missing', ALL10) },
  { id: 'kis-env-partial', row: '002d', cls: 'F2', text: 'KIS_APP_KEY in the environment without KIS_APP_SECRET', setup: { home: 'both', env: { KIS_APP_KEY: SYNTHETIC_KIS.appKey } }, runFor: KIS4, expect: same('credential_environment_invalid', ['K1', 'K2', 'K4']) },
  // 002e: F3 / F4
  { id: 'token-401', row: '002e', cls: 'F3', text: 'token endpoint HTTP 401', setup: kis({ token: httpStatus(401) }), runFor: KIS4, expect: same('credential_rejected', ['K1', 'K2', 'K4']) },
  { id: 'token-403', row: '002e', cls: 'F3', text: 'token endpoint HTTP 403', setup: kis({ token: httpStatus(403) }), runFor: KIS4, expect: same('credential_rejected', ['K1', 'K2', 'K4']) },
  { id: 'data-401', row: '002e', cls: 'F4', text: 'KIS data endpoint HTTP 401', setup: kis({ data: httpStatus(401) }), runFor: KIS4, expect: same('auth_expired', KIS4) },
  { id: 'data-403', row: '002e', cls: 'F4', text: 'KIS data endpoint HTTP 403', setup: kis({ data: httpStatus(403) }), runFor: KIS4, expect: same('auth_expired', KIS4) },
  { id: 'dart-401', row: '002e', cls: 'F3', text: 'OpenDART HTTP 401', setup: kis({ dart: httpStatus(401) }), runFor: DART2, expect: same('credential_rejected', DART2) },
  { id: 'dart-403', row: '002e', cls: 'F3', text: 'OpenDART HTTP 403', setup: kis({ dart: httpStatus(403) }), runFor: DART2, expect: same('credential_rejected', DART2) },
  // 002f: F5
  { id: 'token-429', row: '002f', cls: 'F5', text: 'token endpoint HTTP 429', setup: kis({ token: httpStatus(429) }), runFor: KIS4, expect: same('rate_limited', KIS4) },
  { id: 'data-429', row: '002f', cls: 'F5', text: 'KIS data endpoint HTTP 429', setup: kis({ data: httpStatus(429) }), runFor: KIS4, expect: same('rate_limited', KIS4) },
  { id: 'dart-429', row: '002f', cls: 'F5', text: 'OpenDART HTTP 429', setup: kis({ dart: httpStatus(429) }), runFor: DART2, expect: same('rate_limited', DART2) },
  // 002g: F6
  { id: 'token-500', row: '002g', cls: 'F6', text: 'token endpoint HTTP 500', setup: kis({ token: httpStatus(500) }), runFor: KIS4, expect: { K1: 'upstream_rejected', K2: 'upstream_rejected', K3: 'upstream_unavailable', K4: 'upstream_rejected' } },
  { id: 'data-500', row: '002g', cls: 'F6', text: 'KIS data endpoint HTTP 500', setup: kis({ data: httpStatus(500) }), runFor: KIS4, expect: { K1: 'upstream_unavailable', K2: 'upstream_unavailable', K3: 'upstream_unavailable', K4: 'upstream_rejected' } },
  { id: 'dart-500', row: '002g', cls: 'F6', text: 'OpenDART HTTP 500', setup: kis({ dart: httpStatus(500) }), runFor: DART2, expect: same('upstream_rejected', DART2) },
  { id: 'dart-400', row: '002g', cls: 'F6', text: 'OpenDART HTTP 400 (other non-200)', setup: kis({ dart: httpStatus(400) }), runFor: DART2, expect: same('upstream_rejected', DART2) },
  { id: 'data-rt-cd-nonzero', row: '002g', cls: 'F6', text: 'KIS data endpoint HTTP 200 with rt_cd != 0 and no data roots', setup: kis({ data: providerRefusal }), runFor: KIS4,
    expect: { K1: 'upstream_unavailable', K2: 'upstream_rejected', K3: 'upstream_rejected', K4: 'upstream_rejected' } },
  { id: 'data-too-large', row: '002g', cls: 'F6', text: 'KIS data endpoint declares a body over 300,000 bytes', setup: kis({ data: declaredTooLarge }), runFor: KIS4, expect: { K1: 'response_too_large', K2: 'response_too_large', K3: 'upstream_unavailable', K4: 'response_too_large' } },
  { id: 'data-duplicate-date', row: '002g', cls: 'F6', text: 'KIS daily-bar answer repeats a business date (K2 only; found by the M2 pre-start measurement)', setup: kis({ data: duplicateBusinessDate }), runFor: ['K2'], expect: { K2: 'duplicate_provider_business_date' } },
  { id: 'token-transport', row: '002g', cls: 'F6', text: 'token endpoint transport failure', setup: kis({ token: rejectsWith('Error') }), runFor: KIS4, expect: same('upstream_unavailable', KIS4) },
  { id: 'data-transport', row: '002g', cls: 'F6', text: 'KIS data endpoint transport failure', setup: kis({ data: rejectsWith('Error') }), runFor: KIS4, expect: same('upstream_unavailable', KIS4) },
  { id: 'dart-transport', row: '002g', cls: 'F6', text: 'OpenDART transport failure', setup: kis({ dart: rejectsWith('Error') }), runFor: DART2, expect: same('upstream_unavailable', DART2) },
  { id: 'token-timeout', row: '002g', cls: 'F6', text: 'token endpoint fetch-stage timeout', setup: kis({ token: rejectsWith('TimeoutError') }), runFor: KIS4, expect: same('upstream_timeout', KIS4) },
  { id: 'data-timeout-fetch', row: '002g', cls: 'F6', text: 'KIS data endpoint fetch-stage timeout', setup: kis({ data: rejectsWith('TimeoutError') }), runFor: KIS4, expect: { K1: 'upstream_unavailable', K2: 'upstream_timeout', K3: 'upstream_unavailable', K4: 'upstream_timeout' } },
  { id: 'data-timeout-body', row: '002g', cls: 'F6', text: 'KIS data endpoint body-read-stage timeout', setup: kis({ data: bodyErrorsWith('TimeoutError') }), runFor: KIS4, expect: same('upstream_timeout', KIS4) },
  { id: 'dart-timeout-fetch', row: '002g', cls: 'F6', text: 'OpenDART fetch-stage timeout (10,000 ms deadline on mocked timers)', setup: { home: 'both' }, runFor: DART2, dartDeadline: 'fetch', expect: same('upstream_timeout', DART2) },
  { id: 'dart-timeout-body', row: '002g', cls: 'F6', text: 'OpenDART body-read-stage timeout (10,000 ms deadline on mocked timers)', setup: { home: 'both' }, runFor: DART2, dartDeadline: 'body', expect: same('upstream_timeout', DART2) },
  { id: 'token-cancel', row: '002g', cls: 'F6', text: 'token endpoint cancelled (AbortError)', setup: kis({ token: rejectsWith('AbortError') }), runFor: KIS4, expect: { K1: 'request_cancelled', K2: 'request_cancelled', K3: 'upstream_unavailable', K4: 'request_cancelled' } },
  { id: 'data-cancel-fetch', row: '002g', cls: 'F6', text: 'KIS data endpoint fetch-stage cancel (AbortError)', setup: kis({ data: rejectsWith('AbortError') }), runFor: KIS4, expect: { K1: 'upstream_unavailable', K2: 'request_cancelled', K3: 'upstream_unavailable', K4: 'upstream_unavailable' } },
  { id: 'data-cancel-body', row: '002g', cls: 'F6', text: 'KIS data endpoint body-read-stage cancel (AbortError)', setup: kis({ data: bodyErrorsWith('AbortError') }), runFor: KIS4, expect: { K1: 'request_cancelled', K2: 'request_cancelled', K3: 'upstream_unavailable', K4: 'request_cancelled' } },
  // 002h: F7
  { id: 'token-schema', row: '002h', cls: 'F7', text: 'token endpoint answers 200 with a non-JSON body', setup: kis({ token: notJson }), runFor: KIS4, expect: same('schema_drift', KIS4) },
  { id: 'data-schema', row: '002h', cls: 'F7', text: 'KIS data endpoint answers 200 with a non-JSON body', setup: kis({ data: notJson }), runFor: KIS4, expect: same('schema_drift', KIS4) },
  { id: 'dart-schema-not-json', row: '002h', cls: 'F7', text: 'OpenDART answers 200 with a non-JSON body', setup: kis({ dart: notJson }), runFor: DART2, expect: same('invalid_response', DART2) },
  { id: 'dart-schema-wrong-shape', row: '002h', cls: 'F7', text: 'OpenDART answers 200 with JSON of the wrong shape', setup: kis({ dart: wrongShapeJson }), runFor: DART2, expect: same('invalid_response', DART2) },
  // F8: OpenDART HTTP-layer rejections outside F1-F7
  { id: 'dart-redirect', row: '002g', cls: 'F8', text: 'OpenDART answers HTTP 302', setup: kis({ dart: httpStatus(302) }), runFor: DART2, expect: same('transport_error', DART2) },
  { id: 'dart-too-large', row: '002g', cls: 'F8', text: 'OpenDART declares a body over 300,000 bytes', setup: kis({ dart: declaredTooLarge }), runFor: DART2, expect: same('transport_error', DART2) },
];

export function familyOf(tool: string): Family {
  const found = COVERED.find((entry) => entry.tool === tool);
  if (!found) throw new Error(`not a covered tool: ${tool}`);
  return found.family;
}

/** Runs one injection against one covered tool. */
export function runInjection(injection: Injection, tool: string): Promise<CallResult & { traffic: Traffic }> {
  return injection.dartDeadline ? runDartDeadline(tool, injection.dartDeadline) : runCase(tool, injection.setup);
}

/** (provider, code) -> failure class, built from plan.md's M2 code table. A pair may appear in one class only. */
export const CLASS_TABLE: readonly (readonly [provider: 'kis' | 'opendart', code: string, cls: FailureClass])[] = [
  ['kis', 'credential_missing', 'F1'], ['opendart', 'credential_missing', 'F1'],
  ['kis', 'credential_environment_invalid', 'F2'],
  ['kis', 'credential_rejected', 'F3'], ['opendart', 'credential_rejected', 'F3'],
  ['kis', 'auth_expired', 'F4'],
  ['kis', 'rate_limited', 'F5'], ['opendart', 'rate_limited', 'F5'],
  ['kis', 'upstream_rejected', 'F6'], ['kis', 'upstream_unavailable', 'F6'], ['kis', 'upstream_timeout', 'F6'], ['kis', 'request_cancelled', 'F6'],
  ['kis', 'response_too_large', 'F6'], ['kis', 'empty_response', 'F6'], ['kis', 'pagination_limit_reached', 'F6'], ['kis', 'pagination_not_supported', 'F6'],
  // Not in spec.md 3.2 / plan.md M2 as written: found by the M2 pre-start measurement (K2 repeated business date); classed F6 with the other KIS response anomalies.
  ['kis', 'duplicate_provider_business_date', 'F6'],
  ['opendart', 'upstream_rejected', 'F6'], ['opendart', 'upstream_unavailable', 'F6'], ['opendart', 'upstream_timeout', 'F6'],
  ['kis', 'schema_drift', 'F7'], ['opendart', 'invalid_response', 'F7'],
  ['opendart', 'transport_error', 'F8'],
];

const CLASS_MAP = new Map(CLASS_TABLE.map(([provider, code, cls]) => [`${provider}:${code}`, cls] as const));
/** Failure class of a (provider, code) pair, or undefined when the pair is not in the table. */
export function classOf(provider: 'kis' | 'opendart', code: string): FailureClass | undefined { return CLASS_MAP.get(`${provider}:${code}`); }

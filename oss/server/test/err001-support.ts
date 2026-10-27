// SPEC-ATP-ERR-001 (card t17): pieces shared by the err001-*.test.ts files. This module is a helper, not a test
// (its name has no `.test.`). It imports the SPEC-ATP-AUTH-002 scenario helpers and never edits them.
//
// ./fetch-recorder.js MUST be the first import: it replaces the global fetch with a recorder that rejects, and the
// server modules below must see that replacement (the same rule the t14 scenario helper states).
import { readFetchRecords, resetFetchRecords, restoreOriginalFetch } from './fetch-recorder.js';
import assert from 'node:assert/strict';
import { types } from 'node:util';
import * as sc from './auth002-m2-scenarios.js';
import { SafeKisError } from '../src/kis-http.js';
import { inputs as sourceInputs, CUTOFF, RECEIVED } from './source-input-fixtures.js';
import { nativePeriodInput } from './native-period-mcp-fixtures.js';
import { toolArguments } from './default-server-harness.js';
import { requestUsQuote } from '../src/global-market-data.js';
import { requestOverseasFuturesQuote } from '../src/overseas-futures-data.js';
import { requestKrFuturesDailyHistory } from '../src/futures-history.js';
import { requestMarketOrderbook } from '../src/market-orderbook.js';
import { requestKrHistoricalIntraday } from '../src/historical-stock-bars.js';
import { requestUsDailyHistory } from '../src/history-breadth.js';
import { requestUsProductProfile } from '../src/etf-product-inputs.js';
import { requestKis264History } from '../src/benchmark-history-inputs.js';
import { requestKis264Period } from '../src/benchmark-period-inputs.js';
import { collectRemainingSourceEvidence } from '../src/remaining-source-inputs.js';

export { readFetchRecords, resetFetchRecords, restoreOriginalFetch, sc, SafeKisError };

// ---- REQ-ERR-007: every cell ends within a bounded real time and says which wait it was in ---------------------

/**
 * Real-time bound of one test cell, in ms. A normal cell (open a session, one tool call, close) takes tens of
 * milliseconds; the bound sits below the harness rpc timer (30,000 ms, default-server-harness.ts) so a hung tool
 * call is reported by THIS bound (message `err001_cell_bound`) and not by the harness (`m1_rpc_timeout`).
 * `ERR001_CELL_BOUND_MS` lowers it for mutant observations; it is never read for anything else.
 */
export const CELL_BOUND_MS = Number(process.env['ERR001_CELL_BOUND_MS']) > 0 ? Number(process.env['ERR001_CELL_BOUND_MS']) : 25_000;

/** `work`, or a rejection naming the wait it was in once `ms` of REAL time passed. The timer is cleared either way. */
export function bounded<T>(work: Promise<T>, label: string, stage: () => string, ms: number = CELL_BOUND_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`err001_cell_bound: ${label} was still in the wait "${stage()}" after ${ms} ms of real time`)), ms);
  });
  work.catch(() => undefined); // a late rejection of a case the bound already ended is not an unhandled one
  return Promise.race([work, guard]).finally(() => clearTimeout(timer));
}

export type BoundedCase = sc.CallResult & { traffic: sc.Traffic };

/** `sc.runCase` with the three waits bounded: open a session, the tool call, close the session. */
export async function boundedCase(tool: string, setup: sc.CaseSetup, label: string = tool): Promise<BoundedCase> {
  let stage = 'open session (home, server connect, initialize)';
  const work = sc.withSession(setup, async (session) => {
    stage = 'tool call (waiting for the tool reply)';
    try { return await sc.call(session, tool); } finally { stage = 'close session'; }
  });
  const { value, traffic } = await bounded(work, label, () => stage);
  return { ...value, traffic };
}

/** Nothing left the injected fetch: no request to an unknown host, none to the master host unless wanted, none reached the global fetch. */
export function nothingEscaped(traffic: sc.Traffic, options: { master?: boolean } = {}): void {
  assert.deepEqual(traffic.other, [], 'no request left the provider hosts');
  if (options.master !== true) assert.deepEqual(traffic.master, [], 'no master-host request');
  assert.deepEqual(readFetchRecords(), [], 'nothing reached the global fetch');
}

// ---- the 17 consumer tools in their 10 modules (spec.md section 2) ----------------------------------------------

export const CONSUMER_MODULES: readonly { file: string; tools: readonly string[] }[] = [
  { file: 'global-market-data.ts', tools: ['get_us_market_snapshot', 'get_index_futures_snapshot', 'get_domestic_etf_snapshot'] },
  { file: 'overseas-futures-data.ts', tools: ['get_overseas_futures_snapshot'] },
  { file: 'futures-history.ts', tools: ['get_domestic_futures_price_history', 'get_domestic_futures_intraday_history', 'get_overseas_futures_price_history', 'get_overseas_futures_intraday_history'] },
  { file: 'market-orderbook.ts', tools: ['get_market_orderbook'] },
  { file: 'historical-stock-bars.ts', tools: ['get_historical_intraday_price_history'] },
  { file: 'history-breadth.ts', tools: ['get_us_price_history', 'get_intraday_price_history'] },
  { file: 'etf-product-inputs.ts', tools: ['get_us_product_profile'] },
  { file: 'benchmark-history-inputs.ts', tools: ['get_global_index_history'] },
  { file: 'benchmark-period-inputs.ts', tools: ['get_global_index_period_history'] },
  { file: 'remaining-source-inputs.ts', tools: ['get_market_industry_investor_aggregates', 'get_overseas_ice_actions'] },
];
export const TOOLS_17: readonly string[] = CONSUMER_MODULES.flatMap((m) => m.tools);
/** Raw-text transports hand the body text to the module, which parses it AFTER send: a non-JSON data body never reaches the catch (spec.md section 4). */
export const RAW_TEXT_TOOLS: ReadonlySet<string> = new Set(['get_global_index_history', 'get_global_index_period_history', 'get_market_industry_investor_aggregates', 'get_overseas_ice_actions']);
export const K3_TOOLS: readonly string[] = ['get_instrument_profile', 'get_market_headlines', 'get_market_flows'];
export const K4_TOOLS: readonly string[] = ['get_credit_balances', 'get_short_sale_activity', 'get_stock_lending_activity'];
export const DIRECTORY_TOOLS: readonly string[] = ['search_instruments', 'resolve_instrument'];

/** 23 of the t14 KIS injections. Not used: `data-rt-cd-nonzero` (a 200 body judged by the module parser after send) and `data-duplicate-date` (K2 only). */
export const KIS_IDS: readonly string[] = ['keys-unset', 'key-file-corrupt', 'key-file-unsafe', 'kis-env-partial', 'token-401', 'token-403', 'data-401', 'data-403', 'token-429', 'data-429',
  'token-500', 'data-500', 'token-transport', 'data-transport', 'token-timeout', 'data-timeout-fetch', 'data-timeout-body', 'token-cancel', 'data-cancel-fetch', 'data-cancel-body', 'data-too-large', 'token-schema', 'data-schema'];

/**
 * The code the expanded transport itself throws for each injection, which is what the K4 tools (no catch) return;
 * spec.md section 2 "기준 코드". The consumer tools must return exactly this.
 */
export const REFERENCE_CODE: Readonly<Record<string, string>> = {
  'keys-unset': 'credential_missing', 'key-file-corrupt': 'credential_missing', 'key-file-unsafe': 'credential_missing', 'kis-env-partial': 'credential_environment_invalid',
  'token-401': 'credential_rejected', 'token-403': 'credential_rejected', 'data-401': 'auth_expired', 'data-403': 'auth_expired', 'token-429': 'rate_limited', 'data-429': 'rate_limited',
  'token-500': 'upstream_rejected', 'data-500': 'upstream_rejected', 'token-transport': 'upstream_unavailable', 'data-transport': 'upstream_unavailable',
  'token-timeout': 'upstream_timeout', 'data-timeout-fetch': 'upstream_timeout', 'data-timeout-body': 'upstream_timeout',
  'token-cancel': 'request_cancelled', 'data-cancel-fetch': 'upstream_unavailable', 'data-cancel-body': 'request_cancelled', 'data-too-large': 'response_too_large',
  'token-schema': 'schema_drift', 'data-schema': 'schema_drift',
};

export function injection(id: string): sc.Injection {
  const found = sc.INJECTIONS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`err001_missing_injection:${id}`);
  return found;
}

/** Requests the transport makes before a failure, by injection id (the t14 rule): key problems stop before any request. */
export function requestsFor(id: string): { token: number; data: number } {
  return id.startsWith('token-') ? { token: 1, data: 0 } : id.startsWith('data-') ? { token: 1, data: 1 } : { token: 0, data: 0 };
}

// ---- REQ-ERR-004: errors a module receives from outside, and direct calls of the ten modules ------------------------

/** A synthetic secret that must never reach a result, an error text or stderr. */
export const SECRET = 'SYNTHETIC_ERR001_SECRET_never_real';

export interface Counter { runs: number }
export interface Forgery { id: string; make(counter: Counter): unknown }

const KIS_ROOT_ERROR = (): SafeKisError => new SafeKisError('credential_rejected');
/** A native error holding `chain` empty links between itself and a holder that carries `name` and `code` only on the prototype side. */
function nativeWithInheritedMarkers(depth: number): Error {
  const holder = Object.create(Error.prototype, { name: { value: 'SafeKisError' }, code: { value: 'credential_rejected' } });
  let proto: object = holder;
  for (let level = 1; level < depth; level += 1) proto = Object.create(proto);
  return Object.setPrototypeOf(new Error('arbitrary_text_not_a_code'), proto);
}

/** acceptance.md AC-ERR-004 (a)..(d-3): the values a transport may throw that the module must not trust. */
export const FORGERIES: readonly Forgery[] = [
  { id: 'a-error-with-secret-message', make: () => new Error(SECRET) },
  { id: 'b1-plain-object-with-throwing-accessors', make: (c) => ({
    get name(): string { c.runs += 1; throw new Error(SECRET); },
    get message(): string { c.runs += 1; throw new Error(SECRET); },
    get code(): string { c.runs += 1; throw new Error(SECRET); },
  }) },
  { id: 'b2-native-error-with-throwing-accessors', make: (c) => {
    const e = new Error('x');
    for (const key of ['name', 'message', 'code']) Object.defineProperty(e, key, { get(): string { c.runs += 1; throw new Error(SECRET); } });
    return e;
  } },
  { id: 'c-proxy-around-a-real-sanitized-error', make: (c) => new Proxy(KIS_ROOT_ERROR(), {
    get(t, k, r) { c.runs += 1; return Reflect.get(t, k, r); },
    getPrototypeOf(t) { c.runs += 1; return Reflect.getPrototypeOf(t); },
    getOwnPropertyDescriptor(t, k) { c.runs += 1; return Reflect.getOwnPropertyDescriptor(t, k); },
    has(t, k) { c.runs += 1; return Reflect.has(t, k); },
    ownKeys(t) { c.runs += 1; return Reflect.ownKeys(t); },
  }) },
  { id: 'd1-native-error-sanitized-prototype-at-depth-2', make: () => Object.setPrototypeOf(new Error('credential_rejected'), Object.create(SafeKisError.prototype)) },
  { id: 'd2-non-native-object-sanitized-direct-prototype', make: () => Object.create(SafeKisError.prototype, { message: { value: 'credential_rejected' }, code: { value: 'credential_rejected' } }) },
  // S1 follow-up: native errors whose DIRECT prototype is SafeKisError.prototype, so only the own-data-descriptor and code-union parts of the criterion can reject them.
  { id: 'e1-sanitized-prototype-accessor-message-returning-a-union-code', make: (c) => {
    const e = Object.setPrototypeOf(new Error('placeholder'), SafeKisError.prototype) as Error;
    Object.defineProperty(e, 'message', { get(): string { c.runs += 1; return 'credential_rejected'; } });
    return e;
  } },
  { id: 'e2a-sanitized-prototype-own-data-message-outside-the-code-union', make: () => Object.setPrototypeOf(new Error(SECRET), SafeKisError.prototype) },
  { id: 'e2b-sanitized-prototype-own-data-message-near-miss-source_unavailable', make: () => Object.setPrototypeOf(new Error('source_unavailable'), SafeKisError.prototype) },
  { id: 'd3a-native-error-markers-on-prototype-depth-1', make: () => nativeWithInheritedMarkers(1) },
  { id: 'd3b-native-error-markers-on-prototype-depth-7', make: () => nativeWithInheritedMarkers(7) },
];

const syntheticTransport = (send: () => Promise<never>) => ({ origin: 'synthetic' as const, send });
const syntheticClock = (): string => RECEIVED;
export const sendThrowing = (thrown: unknown) => async (): Promise<never> => { throw thrown; };

/** One module request function called with a transport whose `send` throws what the caller chose. */
export interface DirectModule { name: string; existingCode: string; run(send: () => Promise<never>): Promise<unknown> }

/** The ten modules, each through one request function that reaches its `send` catch. `existingCode` is what that catch yielded before this SPEC. */
export const DIRECT_MODULES: readonly DirectModule[] = [
  { name: 'global-market-data', existingCode: 'upstream_unavailable', run: (send) => requestUsQuote(toolArguments['get_us_market_snapshot'], syntheticTransport(send), syntheticClock) },
  { name: 'overseas-futures-data', existingCode: 'upstream_unavailable', run: (send) => requestOverseasFuturesQuote(toolArguments['get_overseas_futures_snapshot'], syntheticTransport(send), syntheticClock) },
  { name: 'futures-history', existingCode: 'upstream_unavailable', run: (send) => requestKrFuturesDailyHistory(toolArguments['get_domestic_futures_price_history'], syntheticTransport(send), syntheticClock) },
  { name: 'market-orderbook', existingCode: 'upstream_unavailable', run: (send) => requestMarketOrderbook(toolArguments['get_market_orderbook'], syntheticTransport(send), syntheticClock) },
  { name: 'historical-stock-bars', existingCode: 'upstream_unavailable', run: (send) => requestKrHistoricalIntraday(toolArguments['get_historical_intraday_price_history'], syntheticTransport(send), syntheticClock) },
  { name: 'history-breadth', existingCode: 'upstream_unavailable', run: (send) => requestUsDailyHistory(toolArguments['get_us_price_history'], syntheticTransport(send), syntheticClock) },
  { name: 'etf-product-inputs', existingCode: 'upstream_unavailable', run: (send) => requestUsProductProfile(toolArguments['get_us_product_profile'], syntheticTransport(send), syntheticClock) },
  { name: 'benchmark-history-inputs', existingCode: 'upstream_unavailable', run: (send) => requestKis264History(sourceInputs['get_global_index_history'], syntheticTransport(send), syntheticClock) },
  { name: 'benchmark-period-inputs', existingCode: 'upstream_unavailable', run: (send) => requestKis264Period(nativePeriodInput('W'), syntheticTransport(send), syntheticClock) },
  { name: 'remaining-source-inputs', existingCode: 'transport_failed', run: (send) => collectRemainingSourceEvidence((sourceInputs['get_market_industry_investor_aggregates'] as { request: unknown }).request, { origin: 'synthetic', cutoff: CUTOFF }, { send, now: syntheticClock }) },
];

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
export async function settle<T>(work: Promise<T>): Promise<Settled<T>> {
  try { return { ok: true, value: await work }; } catch (error) { return { ok: false, error }; }
}

/** The error's own `message` data property (what the tool surface reads), never an accessor, never the prototype chain. */
export function ownMessage(error: unknown): string | undefined {
  if (!types.isNativeError(error)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
  return descriptor && 'value' in descriptor && typeof descriptor.value === 'string' ? descriptor.value : undefined;
}

/** Everything written to stderr while `fn` runs. */
export async function capturingStderr<T>(fn: () => Promise<T>): Promise<{ value: T; written: string }> {
  const original = process.stderr.write.bind(process.stderr);
  let written = '';
  (process.stderr as unknown as { write: (chunk: unknown, ...rest: unknown[]) => boolean }).write = (chunk: unknown, ...rest: unknown[]) => {
    written += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
    const callback = rest.find((value) => typeof value === 'function') as (() => void) | undefined;
    callback?.();
    return true;
  };
  try { return { value: await fn(), written }; } finally { (process.stderr as unknown as { write: unknown }).write = original; }
}

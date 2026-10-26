import type {MemberAccess} from './member-access.js';
import {type SecPublicTransport} from './sec-public-data.js';
import {OfficialKrEquityDirectoryLoader} from './kis-master-http.js';
import {createExpandedKisTransports} from './kis-expanded-http.js';
import {FetchReferenceTransport} from './kis-reference-data.js';
import { createStockMcpServer } from "./server.js";
import { AllowListedKisQuoteTransport, KIS_BASE_URL, readBoundedResponseText, SafeKisError, type KisCredentialProvider } from "./kis-http.js";
import { FetchKisR01Transport } from "./r01-kis-http-adapters.js";
import { createOneShotOpenDartHttpTransport, type OpenDartHttpOptions } from "./opendart-http.js";
import { resolveProviderCredentials, type CredentialProviders } from "./local-credentials.js";

type RuntimeOptions = {
  memberAccess?: MemberAccess;
  /** Explicit trusted host injection only; no SEC contact/env discovery or default activation. */
  secEnabled?: boolean;
  secTransport?: SecPublicTransport;
  studentReleaseScope?: boolean;
  projectRoot?: string; homeDir?: string; env?: NodeJS.ProcessEnv;
  rightsEnabled?: boolean;
  localReportViewEnabled?: boolean;
  obtainAccessToken?: (keys: NonNullable<CredentialProviders["kis"]>) => Promise<string>;
  fetchImpl?: typeof fetch;
  /** OpenDART remains disabled unless the host explicitly enables it and supplies a per-read authorization callback. */
  openDartEnabled?: boolean;
  authorizeOpenDartRead?: OpenDartHttpOptions["authorizeRead"];
  /** Synthetic mode is for injected tests only; production defaults to actual. */
  openDartOrigin?: OpenDartHttpOptions["origin"];
};
const TOKEN_SKEW_MS = 60_000;
type TokenGrant = { accessToken: string; expiresAt: number };

function tokenExpiry(payload: unknown, now = Date.now()): number {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new SafeKisError("schema_drift");
  const value = payload as Record<string, unknown>;
  const expiry = value.access_token_token_expired;
  if (typeof expiry === "string") {
    const kst = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(expiry);
    if (kst) {
      const [, ys, ms, ds, hs, mins, ss] = kst;
      const parts = [ys, ms, ds, hs, mins, ss].map(Number);
      const [year, month, day, hour, minute, second] = parts;
      if (year !== undefined && month !== undefined && day !== undefined && hour !== undefined && minute !== undefined && second !== undefined) {
        const utc = Date.UTC(year, month - 1, day, hour - 9, minute, second);
        const local = new Date(utc + 9 * 60 * 60 * 1000);
        if (local.getUTCFullYear() === year && local.getUTCMonth() === month - 1 && local.getUTCDate() === day && local.getUTCHours() === hour && local.getUTCMinutes() === minute && local.getUTCSeconds() === second && utc > now) return utc;
      }
      throw new SafeKisError("schema_drift");
    }
    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(expiry)) {
      const timestamp = Date.parse(expiry);
      if (Number.isFinite(timestamp) && timestamp > now) return timestamp;
    }
    throw new SafeKisError("schema_drift");
  }
  const seconds = value.expires_in;
  if (typeof seconds === "number" && Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 604_800) return now + seconds * 1_000;
  throw new SafeKisError("schema_drift");
}

async function requestAccessToken(keys: NonNullable<CredentialProviders["kis"]>, fetchImpl: typeof fetch): Promise<TokenGrant> {
  const url = new URL("/oauth2/tokenP", KIS_BASE_URL.production);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ grant_type: "client_credentials", appkey: keys.appKey, appsecret: keys.appSecret }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new SafeKisError("upstream_timeout");
    if (error instanceof Error && error.name === "AbortError") throw new SafeKisError("request_cancelled");
    throw new SafeKisError("upstream_unavailable");
  }
  if (response.status === 429) throw new SafeKisError("rate_limited");
  if (!response.ok) throw new SafeKisError("upstream_rejected");
  const text = await readBoundedResponseText(response, 16_384);
  let payload: unknown;
  try { payload = JSON.parse(text) as unknown; }
  catch { throw new SafeKisError("schema_drift"); }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new SafeKisError("schema_drift");
  const value = payload as Record<string, unknown>;
  if (typeof value.access_token !== "string" || value.access_token.length < 1 || value.access_token.length > 4096 || /[\r\n]/.test(value.access_token)) {
    throw new SafeKisError("schema_drift");
  }
  return { accessToken: value.access_token, expiresAt: tokenExpiry(payload) };
}

/** Credentials and access tokens remain lazy and process-memory-only; no startup reads or token persistence. */
export function createCredentialProvider(options: RuntimeOptions = {}): KisCredentialProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  type Cached = TokenGrant & NonNullable<CredentialProviders["kis"]>;
  let cached: Cached | undefined;
  let inFlight: Promise<Cached> | undefined;
  return { async getForMarketRead() {
    if (cached && Date.now() + TOKEN_SKEW_MS < cached.expiresAt) {
      return { appKey: cached.appKey, appSecret: cached.appSecret, accessToken: cached.accessToken };
    }
    // Independent concurrent reads share one token issuance in this server process.
    const pending = inFlight ??= (async () => {
      const keys = await resolveProviderCredentials("kis", options);
      const grant = options.obtainAccessToken
        ? { accessToken: await options.obtainAccessToken(keys), expiresAt: Number.POSITIVE_INFINITY }
        : await requestAccessToken(keys, fetchImpl);
      if (!grant.accessToken || /[\r\n]/.test(grant.accessToken) || grant.accessToken.length > 4096) throw new Error("credential_missing");
      cached = { ...keys, ...grant };
      return cached;
    })();
    try {
      const value=await pending;
      return {appKey:value.appKey,appSecret:value.appSecret,accessToken:value.accessToken};
    } finally { if (inFlight===pending) inFlight=undefined; }
  } };

}
/** Explicit local read switches. They are not public redistribution grants and contain no secrets. */
export function localReadSwitches(env:NodeJS.ProcessEnv){
 for(const name of ['GOOSE_KIS_READ_ENABLED','GOOSE_OPENDART_READ_ENABLED','GOOSE_LOCAL_REPORT_VIEW_ENABLED'])if(env[name]!==undefined&&!['0','1'].includes(env[name]!))throw new Error('invalid_input');
 return {kis:env.GOOSE_KIS_READ_ENABLED==='1',opendart:env.GOOSE_OPENDART_READ_ENABLED==='1',local_view:env.GOOSE_LOCAL_REPORT_VIEW_ENABLED==='1'};
}
export function createCredentialBackedServer(options: RuntimeOptions = {}) {
  const local={kis:false,opendart:false}; // Launcher alone reads non-secret switches; injected default gates stay lazy.
  const credentials = createCredentialProvider(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const enabled=options.openDartEnabled??local.opendart;
  const authorizeRead=options.authorizeOpenDartRead??(local.opendart?async()=>true:undefined);
  const dartEnabled=enabled===true&&typeof authorizeRead==='function';
  // Each explicit tool call has its own one-attempt adapter; no automatic retry or polling.
  const dartTransport=dartEnabled?{
    origin:options.openDartOrigin??'actual' as const,
    send:async(request:unknown)=>createOneShotOpenDartHttpTransport({
      origin:options.openDartOrigin??'actual',authorizeRead:authorizeRead!,
      readApiKey:async()=>(await resolveProviderCredentials('opendart',options)).apiKey,
      fetchImpl,clock:()=>new Date().toISOString(),
    }).send(request),
  }:undefined;
  return createStockMcpServer({
    ...(options.memberAccess?{memberAccess:options.memberAccess}:{}),
    ...(options.secEnabled===true && options.secTransport ? {secEnabled:true,secTransport:options.secTransport} : {}),
    studentReleaseScope: options.studentReleaseScope === true,
    directoryEnabled: options.rightsEnabled === true,
    instrumentDirectory: new OfficialKrEquityDirectoryLoader(fetchImpl),
    rightsEnabled: options.rightsEnabled ?? local.kis,
    localReportViewEnabled:options.localReportViewEnabled===true,
    ...(dartEnabled && dartTransport ? { openDartEnabled: true, openDartTransport: dartTransport, filingsTransport: dartTransport } : {}),
    ...createExpandedKisTransports(credentials,fetchImpl),
    referenceTransport: new FetchReferenceTransport('production',credentials,fetchImpl),
    transport: new AllowListedKisQuoteTransport("production", credentials, fetchImpl),
    historyTransport: new FetchKisR01Transport("production", credentials, fetchImpl),
  });
}

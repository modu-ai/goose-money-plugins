// SPEC-ATP-AUTH-002 T-prime (card t14, plan.md M2 prerequisite step 2, AC-007): four provider
// authentication properties that no earlier test asserts. They measure behaviour the source already
// has, so they are GREEN on the tree before the M2 source change and must stay green after it.
//
//   007a-skew     a KIS token is reused while more than 60 s of validity remain and re-issued once
//                 fewer than 60 s remain (credential-runtime.ts TOKEN_SKEW_MS). Two points, one
//                 second either side of the boundary, so a smaller AND a larger skew both fail.
//   007f-default  the default `new RequestPacer()` spaces two reservations by at least 1,000 ms
//                 (kis-http.ts MIN_INTERVAL_MS), measured on mocked timers.
//   007e-only     with both provider keys present, the OpenDART key appears in no KIS request URL,
//                 header or body.
//   007d-token    when the token endpoint answers 500, 429, a transport error or a timeout, one
//                 getForMarketRead() rejects after exactly ONE token request. No error code is
//                 asserted: M2 changes the 401/403 handling of this function.
//
// Everything is synthetic: injected fetchImpl, env-supplied fake keys, mkdtemp home, no real network.
// The global fetch recorder is installed first, so a request that bypasses an injected fetchImpl is
// recorded and rejected rather than sent.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, mock } from 'node:test';

const recorder = await import('./fetch-recorder.js');
const harness = await import('./default-server-harness.js');
const runtime = await import('../src/credential-runtime.js');
const kisHttp = await import('../src/kis-http.js');
after(() => recorder.restoreOriginalFetch());

const KIS_ENV = { KIS_APP_KEY: 'synthetic-app-key-never-real', KIS_APP_SECRET: 'synthetic-app-secret-never-real' };
const TOKEN_HOST = 'openapi.koreainvestment.com';
const TOKEN_PATH = '/oauth2/tokenP';
const TOKEN_LIFETIME_S = 3_600;

const requestUrl = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

/** Every request URL is the KIS token endpoint; the count is the number of token requests made. */
function tokenEndpointSpy(respond: (callNumber: number) => Promise<Response>) {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(requestUrl(input));
    return respond(urls.length);
  };
  return { fetchImpl, urls };
}

function assertOnlyTokenEndpoint(urls: readonly string[], label: string): void {
  for (const raw of urls) {
    const url = new URL(raw);
    assert.equal(`${url.hostname}${url.pathname}`, `${TOKEN_HOST}${TOKEN_PATH}`, `${label}: every request goes to the token endpoint`);
  }
}

const tokenResponse = (callNumber: number) => new Response(
  JSON.stringify({ access_token: `synthetic-token-${callNumber}`, expires_in: TOKEN_LIFETIME_S }),
  { status: 200, headers: { 'content-type': 'application/json' } },
);

// ---- 007a-skew -------------------------------------------------------------------------------

const T0 = Date.UTC(2026, 9, 26, 0, 0, 0);
const EXPIRES_AT = T0 + TOKEN_LIFETIME_S * 1_000;

/** Issues the first token at the mocked time T0 (expiry = T0 + 3,600 s) and returns the handles. */
async function issueFirstToken() {
  let now = T0;
  const clock = mock.method(Date, 'now', () => now);
  const spy = tokenEndpointSpy(async (callNumber) => tokenResponse(callNumber));
  const provider = runtime.createCredentialProvider({ env: KIS_ENV, fetchImpl: spy.fetchImpl });
  const first = await provider.getForMarketRead();
  assert.equal(first.accessToken, 'synthetic-token-1');
  assert.equal(spy.urls.length, 1, 'the first read issues exactly one token');
  assertOnlyTokenEndpoint(spy.urls, 'first issuance');
  return { provider, spy, setNow: (value: number) => { now = value; }, restore: () => clock.mock.restore() };
}

test('T-prime 007a-skew: with 61 s of validity left a second getForMarketRead() sends no new token request', async () => {
  const run = await issueFirstToken();
  try {
    run.setNow(EXPIRES_AT - 61_000);
    const second = await run.provider.getForMarketRead();
    assert.equal(second.accessToken, 'synthetic-token-1', 'the cached token is reused');
    assert.equal(run.spy.urls.length, 1, 'no further token request');
  } finally { run.restore(); }
  assert.equal(recorder.readFetchRecords().length, 0);
});

test('T-prime 007a-skew: with 59 s of validity left a second getForMarketRead() sends exactly one more token request', async () => {
  const run = await issueFirstToken();
  try {
    run.setNow(EXPIRES_AT - 59_000);
    const second = await run.provider.getForMarketRead();
    assert.equal(second.accessToken, 'synthetic-token-2', 'a new token was issued');
    assert.equal(run.spy.urls.length, 2, 'exactly one more token request');
    assertOnlyTokenEndpoint(run.spy.urls, 'reissue');
    // The reissued token carries a fresh lifetime, so an immediate third read reuses it.
    const third = await run.provider.getForMarketRead();
    assert.equal(third.accessToken, 'synthetic-token-2');
    assert.equal(run.spy.urls.length, 2, 'the reissued token is itself reused');
  } finally { run.restore(); }
  assert.equal(recorder.readFetchRecords().length, 0);
});

// ---- 007f-default ----------------------------------------------------------------------------

test('T-prime 007f-default: the default RequestPacer places a second reservation at least 1,000 ms after the first', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  try {
    const pacer = new kisHttp.RequestPacer();
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
    const started = Date.now();
    let secondSettledAt: number | undefined;
    await pacer.reserve(); // the first reservation is not delayed
    assert.equal(Date.now(), started, 'the first reservation waits for nothing');
    const second = pacer.reserve().then(() => { secondSettledAt = Date.now(); });
    await flush();
    assert.equal(secondSettledAt, undefined, 'the second reservation waits');
    mock.timers.tick(999);
    await flush();
    assert.equal(secondSettledAt, undefined, 'still waiting after 999 ms');
    mock.timers.tick(1);
    await second;
    assert.ok(secondSettledAt !== undefined && secondSettledAt - started >= 1_000, `the second reservation settled ${String(secondSettledAt === undefined ? undefined : secondSettledAt - started)} ms after the first`);
  } finally { mock.timers.reset(); }
  assert.equal(recorder.readFetchRecords().length, 0);
});

// ---- 007e-only -------------------------------------------------------------------------------

// 40 characters, the length the OpenDART key schema requires; distinct from every other test constant.
const DART_KEY = `T_PRIME_SYNTHETIC_DART_KEY_${'0'.repeat(13)}`;
const QUOTE_OUTPUT = { stck_prpr: '120', stck_oprc: '110', stck_hgpr: '130', stck_lwpr: '100', prdy_vrss: '10', prdy_vrss_sign: '2', prdy_ctrt: '9.09', acml_vol: '1000' };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** URL, every header and the body of one request, as one string for the key search. */
function serializeRequest(input: RequestInfo | URL, init: RequestInit | undefined): string {
  const headers = init?.headers;
  const entries: [string, string][] = headers instanceof Headers ? [...headers.entries()]
    : Array.isArray(headers) ? headers.map(([name, value]) => [String(name), String(value)] as [string, string])
      : Object.entries((headers ?? {}) as Record<string, string>);
  const body = init?.body === undefined || init.body === null ? '' : String(init.body);
  return [requestUrl(input), ...entries.map(([name, value]) => `${name}: ${value}`), body].join('\n');
}

test('T-prime 007e-only: the OpenDART key appears nowhere in the KIS request URL, headers or body', async () => {
  const kisRequests: string[] = [];
  const dartRequests: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const raw = requestUrl(input);
    const url = new URL(raw);
    if (url.hostname === TOKEN_HOST) {
      kisRequests.push(serializeRequest(input, init));
      if (url.pathname === TOKEN_PATH) return json({ access_token: 'synthetic-token-never-real', access_token_token_expired: '2099-01-01 00:00:00' });
      if (url.pathname === '/uapi/domestic-stock/v1/quotations/inquire-price') return json({ rt_cd: '0', msg_cd: 'MCA00000', msg1: 'synthetic', output: QUOTE_OUTPUT });
      return json({ rt_cd: '0', msg_cd: 'MCA00000', msg1: 'synthetic', output: {}, output1: {}, output2: [] });
    }
    if (url.hostname === 'opendart.fss.or.kr') {
      dartRequests.push(serializeRequest(input, init));
      // The default OpenDART transport has origin 'actual' and refuses an empty response url.
      const response = json({ status: '013', message: 'synthetic no data' });
      Object.defineProperty(response, 'url', { value: raw });
      return response;
    }
    throw new Error('t_prime_007e_unexpected_host');
  };
  const home = await mkdtemp(join(tmpdir(), 'atp-tprime-home-'));
  const session = await harness.openSession(runtime.createCredentialBackedServer({
    studentReleaseScope: true,
    rightsEnabled: true,
    openDartEnabled: true,
    authorizeOpenDartRead: async () => true,
    localReportViewEnabled: true,
    env: { ...KIS_ENV, OPENDART_API_KEY: DART_KEY },
    homeDir: home,
    fetchImpl,
  }));
  try {
    assert.equal(DART_KEY.length, 40);
    const kisReply = await session.rpc('tools/call', { name: 'get_market_snapshot', arguments: harness.toolArguments.get_market_snapshot });
    assert.equal(harness.outcome(kisReply), 'OK', 'the KIS tool call succeeds on the synthetic session');
    const dartReply = await session.rpc('tools/call', { name: 'get_fundamentals', arguments: harness.toolArguments.get_fundamentals });
    assert.equal(harness.outcome(dartReply), 'OK', 'the OpenDART tool call succeeds on the synthetic session');
  } finally {
    await session.close();
    await rm(home, { recursive: true });
  }
  // Not vacuous: the KIS tool sent a token request and a data request, the OpenDART tool sent one
  // request, and that request carries the key, so the key was in play and reached only OpenDART.
  assert.ok(kisRequests.length >= 2, `the KIS tool sent ${kisRequests.length} KIS requests`);
  assert.equal(dartRequests.length, 1, 'the OpenDART tool sent one request');
  assert.ok(dartRequests[0]!.includes(`crtfc_key=${DART_KEY}`), 'the OpenDART request carries the OpenDART key');
  kisRequests.forEach((serialized, index) => {
    assert.ok(!serialized.toLowerCase().includes(DART_KEY.toLowerCase()), `KIS request #${index + 1} carries the OpenDART key`);
  });
  assert.equal(recorder.readFetchRecords().length, 0);
});

// ---- 007d-token ------------------------------------------------------------------------------

const timeoutError = () => Object.assign(new Error('synthetic_token_timeout'), { name: 'TimeoutError' });
const TOKEN_FAILURES: readonly [string, (callNumber: number) => Promise<Response>][] = [
  ['HTTP 500', async () => new Response('synthetic upstream failure', { status: 500 })],
  ['HTTP 429', async () => new Response('synthetic rate limit', { status: 429 })],
  ['a transport error', async () => { throw new Error('synthetic_token_transport_failure'); }],
  ['a TimeoutError', async () => { throw timeoutError(); }],
];

for (const [label, respond] of TOKEN_FAILURES) {
  test(`T-prime 007d-token: a token endpoint answer of ${label} rejects one getForMarketRead() after exactly one token request`, async () => {
    const spy = tokenEndpointSpy(respond);
    const provider = runtime.createCredentialProvider({ env: KIS_ENV, fetchImpl: spy.fetchImpl });
    await assert.rejects(provider.getForMarketRead());
    assert.equal(spy.urls.length, 1, 'exactly one token request, no automatic retry');
    assertOnlyTokenEndpoint(spy.urls, label);
    assert.equal(recorder.readFetchRecords().length, 0);
  });
}

// SPEC-ATP-AUTH-002 AC-002 (card t14, M2, test-first): per-provider readiness and the provider error
// vocabulary at the TOOL RESULT surface, measured on the stub-free default server with injected
// synthetic responses. The expected code for every (covered tool, failure) cell comes from plan.md's M2
// code table; the injections and expectations live in ./auth002-m2-scenarios.ts.
//
//   002a/002b  one-key rules (regression guards)         002c   two-provider flows, one provider failing
//   002d-002h  F1-F8 per covered tool (K1-K4, O1, O2)     002i   no "connected" wording in any reply
//   002j       SAFE_CODES carry the new codes              002k   OpenDART body status 020 stays a result
//   002l       provider-less tools issue zero requests     plus   the (provider, code) -> class table and
//                                                               the OpenDART HTTP-layer -> tool-code map
//
// Not covered here, on purpose: the 17 KIS expanded-transport consumer tools and the instrument-directory
// tools (card t17, spec.md section 4), and the K3 cells that kis-reference-data.ts:13 rewrites
// (credential_environment_invalid, credential_rejected; spec.md section 3.2).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';

const recorder = await import('./fetch-recorder.js');
const harness = await import('./default-server-harness.js');
const sc = await import('./auth002-m2-scenarios.js');
const openDartHttp = await import('../src/opendart-http.js');
const openDart = await import('../src/opendart.js');
const filings = await import('../src/opendart-filings.js');
const mcpResult = await import('../src/mcp-result.js');
after(() => recorder.restoreOriginalFetch());

const begin = (): void => { recorder.resetFetchRecords(); assert.equal(recorder.readFetchRecords().length, 0); };
const nothingEscaped = (traffic: { other: string[]; master: string[] }): void => {
  assert.deepEqual([...traffic.other, ...traffic.master], [], 'no request left the two provider hosts');
  assert.deepEqual(recorder.readFetchRecords(), [], 'nothing reached the global fetch');
};

// ---- tool -> provider binding (spec.md section 3.2 "provider-identifiable": 36 tools, one provider each) ----

type Provider = 'kis' | 'opendart' | 'sec' | 'none';
const KIS_TOOLS = [
  'get_market_snapshot', 'get_price_history', 'get_market_flows', 'get_instrument_profile', 'get_market_headlines',
  'get_credit_balances', 'get_short_sale_activity', 'get_stock_lending_activity',
  'get_us_market_snapshot', 'get_index_futures_snapshot', 'get_domestic_etf_snapshot', 'get_overseas_futures_snapshot',
  'get_us_price_history', 'get_intraday_price_history', 'get_us_product_profile',
  'get_domestic_futures_price_history', 'get_domestic_futures_intraday_history',
  'get_overseas_futures_price_history', 'get_overseas_futures_intraday_history',
  'get_historical_intraday_price_history', 'get_market_orderbook', 'get_global_index_history', 'get_global_index_period_history',
  'get_market_industry_investor_aggregates', 'get_overseas_ice_actions',
  'get_domestic_index_history', 'get_kis_house_estimates', 'get_domestic_index_period_history',
  'search_instruments', 'resolve_instrument',
];
const BINDING: Record<string, Provider> = {
  ...Object.fromEntries(KIS_TOOLS.map((tool) => [tool, 'kis' as const])),
  get_fundamentals: 'opendart', get_public_filings: 'opendart',
  get_sec_company_concept: 'sec', get_sec_submissions: 'sec',
  build_report_input: 'none', render_report_html: 'none',
};

test('AC-002c binding table: 36 tools, each bound to exactly one of kis/opendart/sec/none, equal to the live tools/list', async () => {
  const { value: listed } = await sc.withSession({ home: 'both' }, async (session) => (await session.rpc('tools/list', {})).result.tools.map((tool: any) => tool.name as string));
  assert.equal(listed.length, 36);
  assert.deepEqual([...listed].sort(), Object.keys(BINDING).sort());
  assert.ok(Object.values(BINDING).every((provider) => ['kis', 'opendart', 'sec', 'none'].includes(provider)));
  for (const { tool, provider } of sc.COVERED) assert.equal(BINDING[tool], provider, tool);
});

// ---- (provider, code) -> failure class ----

test('AC-002 class table: a function from (provider, code) to one class that covers every code the matrix expects', () => {
  const seen = new Map<string, string>();
  for (const [provider, code, cls] of sc.CLASS_TABLE) {
    const key = `${provider}:${code}`;
    assert.ok(!seen.has(key), `${key} is listed twice (${seen.get(key)} and ${cls})`);
    seen.set(key, cls);
  }
  const used = new Set<string>();
  for (const injection of sc.INJECTIONS) {
    for (const { family, provider } of sc.COVERED) {
      const code = injection.expect[family];
      if (code === undefined) continue;
      assert.equal(sc.classOf(provider, code), injection.cls, `${provider}:${code} expected for ${injection.id} must be class ${injection.cls}`);
      used.add(`${provider}:${code}`);
    }
  }
  // Every class F1-F8 is exercised by at least one expectation.
  assert.deepEqual([...new Set(sc.INJECTIONS.map((injection) => injection.cls))].sort(), ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']);
  // Table rows nobody injects are the spec's own F6 anomaly codes that need KIS-side bodies this file does not build.
  const unexercised = sc.CLASS_TABLE.map(([provider, code]) => `${provider}:${code}`).filter((key) => !used.has(key)).sort();
  assert.deepEqual(unexercised, ['kis:empty_response', 'kis:pagination_limit_reached', 'kis:pagination_not_supported']);
});

// ---- 002d-002h: the covered-tool matrix ----

const requestsFor = (id: string): { token: number; data: number; dart: number } =>
  id.startsWith('token-') ? { token: 1, data: 0, dart: 0 }
    : id.startsWith('data-') ? { token: 1, data: 1, dart: 0 }
      : id.startsWith('dart-') ? { token: 0, data: 0, dart: 1 }
        : { token: 0, data: 0, dart: 0 }; // key problems stop the call before any provider request

for (const injection of sc.INJECTIONS) {
  for (const { tool, family, provider } of sc.COVERED) {
    const expected = injection.expect[family];
    if (!injection.runFor.includes(family) || expected === undefined) continue;
    test(`AC-${injection.row} ${injection.id} [${injection.cls}] ${tool} (${family}) -> ${expected}`, async () => {
      begin();
      const result = await sc.runInjection(injection, tool);
      assert.equal(result.code, expected, `${injection.text}: the tool answered ${result.code}`);
      assert.equal(result.isError, true, 'a provider failure is a tool error');
      assert.equal(sc.classOf(provider, result.code), injection.cls, `${provider}:${result.code} belongs to ${injection.cls}`);
      const want = requestsFor(injection.id);
      assert.deepEqual({ token: result.traffic.token.length, data: result.traffic.data.length, dart: result.traffic.dart.length }, want, 'one attempt per endpoint, no retry, no request for the other provider');
      nothingEscaped(result.traffic);
    });
  }
}

// ---- 002a / 002b: one key is enough (regression guards, first measured here) ----

test('AC-002a one-key rule: with only the KIS key stored every KIS-only covered tool succeeds and no OpenDART request is made', async () => {
  for (const { tool, provider } of sc.COVERED.filter((entry) => entry.provider === 'kis')) {
    begin();
    const result = await sc.runCase(tool, { home: 'kis' });
    assert.equal(result.code, 'OK', `${tool} answered ${result.code}`);
    assert.doesNotMatch(result.code, harness.MEMBER_GUARD_CODE);
    assert.equal(result.traffic.dart.length, 0, `${tool} (${provider}) sent an OpenDART request`);
    assert.equal(result.traffic.token.length, 1, `${tool}: one token request`);
    assert.equal(result.traffic.data.length, 1, `${tool}: one data request`);
    nothingEscaped(result.traffic);
  }
});

test('AC-002b one-key rule: with only the OpenDART key stored both OpenDART tools succeed and no KIS request is made', async () => {
  for (const { tool } of sc.COVERED.filter((entry) => entry.provider === 'opendart')) {
    begin();
    const result = await sc.runCase(tool, { home: 'dart' });
    assert.equal(result.code, 'OK', `${tool} answered ${result.code}`);
    assert.doesNotMatch(result.code, harness.MEMBER_GUARD_CODE);
    assert.equal(result.traffic.token.length + result.traffic.data.length, 0, `${tool} sent a KIS request`);
    assert.equal(result.traffic.dart.length, 1);
    nothingEscaped(result.traffic);
  }
});

// ---- 002c: two-provider flows with one provider failing ----

const KIS_REPS = ['get_market_snapshot', 'get_price_history', 'get_instrument_profile', 'get_credit_balances'];
const DART_TOOLS = ['get_fundamentals', 'get_public_filings'];
const FLOWS: readonly { id: string; failing: 'kis' | 'opendart'; cls: string; overrides: any; kis: { token: number; data: number }; skip?: readonly string[] }[] = [
  { id: '(i) OpenDART HTTP 500 -> F6', failing: 'opendart', cls: 'F6', overrides: { dart: sc.httpStatus(500) }, kis: { token: 1, data: 1 } },
  { id: '(ii) KIS data endpoint HTTP 500 -> F6', failing: 'kis', cls: 'F6', overrides: { data: sc.httpStatus(500) }, kis: { token: 1, data: 1 } },
  // K3 is out of REQ-RDY-003 for a token-endpoint F3 (kis-reference-data.ts:13), so its pair does not run.
  { id: '(iii) KIS token endpoint HTTP 401 -> F3', failing: 'kis', cls: 'F3', overrides: { token: sc.httpStatus(401) }, kis: { token: 1, data: 0 }, skip: ['get_instrument_profile'] },
  { id: '(iv) OpenDART HTTP 429 -> F5', failing: 'opendart', cls: 'F5', overrides: { dart: sc.httpStatus(429) }, kis: { token: 1, data: 1 } },
];

for (const flow of FLOWS) {
  for (const kisTool of KIS_REPS) {
    if (flow.skip?.includes(kisTool)) continue;
    for (const dartTool of DART_TOOLS) {
      test(`AC-002c ${flow.id}: ${kisTool} then ${dartTool} in one session`, async () => {
        begin();
        const { value, traffic } = await sc.withSession({ home: 'both', overrides: flow.overrides }, async (session) => {
          const kisResult = await sc.call(session, kisTool);
          const dartResult = await sc.call(session, dartTool);
          return { kisResult, dartResult };
        });
        const failing = flow.failing === 'kis' ? { tool: kisTool, result: value.kisResult } : { tool: dartTool, result: value.dartResult };
        const healthy = flow.failing === 'kis' ? { tool: dartTool, result: value.dartResult } : { tool: kisTool, result: value.kisResult };
        assert.equal(healthy.result.code, 'OK', `${healthy.tool} (healthy provider) answered ${healthy.result.code}`);
        assert.equal(healthy.result.isError, false);
        assert.equal(failing.result.isError, true, `${failing.tool} should fail`);
        const provider = BINDING[failing.tool];
        assert.ok(provider === 'kis' || provider === 'opendart');
        assert.equal(provider, flow.failing, 'the binding table names the failing provider');
        assert.equal(sc.classOf(provider, failing.result.code), flow.cls, `${provider}:${failing.result.code} must be class ${flow.cls}`);
        assert.deepEqual({ token: traffic.token.length, data: traffic.data.length, dart: traffic.dart.length }, { ...flow.kis, dart: 1 }, 'only the requests the flow needs');
        nothingEscaped(traffic);
      });
    }
  }
}

// ---- 002l: tools that use no provider send nothing, even with both keys stored ----

test('AC-002l build_report_input and render_report_html send no request of any kind with both keys stored', async () => {
  begin();
  const noneTools = Object.entries(BINDING).filter(([, provider]) => provider === 'none').map(([tool]) => tool).sort();
  assert.deepEqual(noneTools, ['build_report_input', 'render_report_html']);
  const { value, traffic } = await sc.withSession({ home: 'both' }, async (session) => {
    const built = await sc.call(session, 'build_report_input');
    const rendered = await sc.call(session, 'render_report_html', { report_input: built.reply.result?.structuredContent });
    return { built, rendered };
  });
  assert.equal(value.built.code, 'OK');
  assert.equal(value.rendered.code, 'OK');
  assert.deepEqual({ token: traffic.token.length, data: traffic.data.length, dart: traffic.dart.length }, { token: 0, data: 0, dart: 0 });
  nothingEscaped(traffic);
});

// ---- 002j: the new codes are in the allow list, once, on one line ----

test('AC-002j SAFE_CODES carries credential_environment_invalid and credential_rejected on exactly one line each', async () => {
  const source = await readFile(new URL('../../src/mcp-result.ts', import.meta.url), 'utf8');
  for (const code of ['credential_environment_invalid', 'credential_rejected']) {
    assert.equal(source.split('\n').filter((line) => line.includes(code)).length, 1, `grep -c ${code} oss/server/src/mcp-result.ts`);
  }
  for (const code of ['credential_environment_invalid', 'credential_rejected', 'credential_missing', 'rate_limited', 'auth_expired', 'upstream_rejected', 'upstream_unavailable', 'upstream_timeout', 'request_cancelled', 'schema_drift', 'invalid_response', 'transport_error']) {
    assert.equal(mcpResult.safeErrorCode(new Error(code)), code, `${code} must pass the allow list unchanged`);
  }
});

// ---- 002k: OpenDART body status 020 is a result, HTTP 429 is the error ----

test('AC-002k OpenDART HTTP 200 with body status 020 stays a successful result with status rate_limited (both paths)', async () => {
  begin();
  for (const tool of DART_TOOLS) {
    const result = await sc.runCase(tool, { home: 'both', overrides: { dart: sc.dartRateLimitBody } });
    assert.equal(result.isError, false, `${tool}: 020 is not a tool error`);
    assert.equal(result.code, 'OK');
    const structured = result.reply.result.structuredContent;
    assert.equal(structured.status, 'rate_limited');
    assert.equal(structured.provider_status, '020');
    assert.equal(structured.rows.length, 0);
    assert.equal(result.traffic.dart.length, 1);
    nothingEscaped(result.traffic);
  }
});

test('AC-002k the existing opendart.test.ts still asserts ["020", "rate_limited"] exactly once', async () => {
  const source = await readFile(new URL('../../test/opendart.test.ts', import.meta.url), 'utf8');
  assert.equal(source.split('\n').filter((line) => line.includes('["020", "rate_limited"]')).length, 1);
});

// ---- OpenDART HTTP-layer code -> tool-surface code (plan.md "OpenDART 매핑") ----

const HTTP_TO_TOOL: Record<string, string> = {
  credential_unavailable: 'credential_missing', // F1
  credential_rejected: 'credential_rejected', // F3: HTTP 401/403
  rate_limited: 'rate_limited', // F5: HTTP 429
  http_rejected: 'upstream_rejected', // F6: any other non-200
  transport_failed: 'upstream_unavailable', // F6
  request_timeout: 'upstream_timeout', // F6
  invalid_response: 'invalid_response', // F7
  invalid_configuration: 'transport_error', invalid_input: 'transport_error', already_attempted: 'transport_error', // F8
  authorization_denied: 'transport_error', redirect_rejected: 'transport_error', response_too_large: 'transport_error',
  credential_reflection: 'transport_error', invalid_clock: 'transport_error',
};

test('AC-002 OpenDART map: every OPENDART_HTTP_ERRORS member has a tool-surface code and the list is exactly the mapped set', () => {
  assert.deepEqual([...openDartHttp.OPENDART_HTTP_ERRORS].sort(), Object.keys(HTTP_TO_TOOL).sort());
  for (const code of Object.values(HTTP_TO_TOOL)) assert.ok(sc.classOf('opendart', code) !== undefined, `opendart:${code} is in the class table`);
});

for (const [httpCode, toolCode] of Object.entries(HTTP_TO_TOOL)) {
  test(`AC-002 OpenDART map: an HTTP-layer ${httpCode} reaches the tool result as ${toolCode} (financial and filings paths)`, async () => {
    const transport = { origin: 'synthetic' as const, send: async () => { throw new openDartHttp.SafeOpenDartHttpError(httpCode as never); } };
    const provenance = { origin: 'synthetic', received_at: '2026-10-26T00:00:00.000Z' };
    await assert.rejects(openDart.requestOpenDartFullStatement(harness.toolArguments.get_fundamentals, transport, provenance), (error: any) => error instanceof openDart.SafeOpenDartError && error.code === toolCode, 'get_fundamentals path');
    await assert.rejects(filings.requestOpenDartFilings(harness.toolArguments.get_public_filings, transport, provenance), (error: any) => error instanceof openDart.SafeOpenDartError && error.code === toolCode, 'get_public_filings path');
  });
}

// ---- 002i: last, so every reply above has been collected ----

test('AC-002i no reply received by any AC-002 case says a provider is connected or verified', () => {
  assert.ok(sc.observedReplies.length > 100, `only ${sc.observedReplies.length} replies were collected`);
  const joined = sc.observedReplies.join('\n');
  for (const phrase of ['연결됨', '연결 완료', '검증됨', 'both connected']) {
    assert.ok(!joined.includes(phrase), `a reply contains "${phrase}"`);
  }
});

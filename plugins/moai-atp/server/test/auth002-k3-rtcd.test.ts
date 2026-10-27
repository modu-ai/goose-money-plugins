// SPEC-ATP-AUTH-002 M2, K3 step (card t14, v0.3.2, leader ruling K3 option (a), test-first): the envelope
// check in kis-reference-data.ts. A KIS data answer is HTTP 200 whose body carries `rt_cd`.
//
//   (a) rt_cd != "0" and no `output` key  -> the tool result is `upstream_rejected` (F6). Before the fix the
//       envelope schema demands an `output` key, so this body is `schema_drift` (F7) and these cases are RED.
//   (b) rt_cd == "0" and no `output` key  -> the tool result stays `schema_drift` (F7). Behaviour preserved;
//       green before and after the fix.
//
// The three K3 tools are measured on the stub-free default server (the one main.ts builds, with the read
// switches on) with injected synthetic responses only: a mkdtemp home with synthetic keys, a routed fetchImpl,
// and the global fetch recorder installed first so a request that bypasses the injected fetchImpl is recorded
// and rejected rather than sent. Nothing here reads a real home, a real key, or a network.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';

const recorder = await import('./fetch-recorder.js');
const sc = await import('./auth002-m2-scenarios.js');
after(() => recorder.restoreOriginalFetch());

const K3_TOOLS = ['get_instrument_profile', 'get_market_headlines', 'get_market_flows'] as const;

/** HTTP 200 with a fixed JSON body and no `output` key. */
const answer = (body: Record<string, unknown>): import('./auth002-m2-scenarios.js').Handler =>
  () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const REJECTION_WITHOUT_OUTPUT = { rt_cd: '1', msg_cd: 'EGW00123', msg1: 'synthetic provider refusal' };
const SUCCESS_WITHOUT_OUTPUT = { rt_cd: '0' };

async function measure(tool: string, body: Record<string, unknown>) {
  recorder.resetFetchRecords();
  assert.equal(recorder.readFetchRecords().length, 0);
  const result = await sc.runCase(tool, { home: 'both', overrides: { data: answer(body) } });
  // The case really reached the KIS data endpoint once, after one token request, and nothing else was called.
  assert.equal(result.traffic.token.length, 1, `${tool}: one token request`);
  assert.equal(result.traffic.data.length, 1, `${tool}: one data request`);
  assert.deepEqual([...result.traffic.dart, ...result.traffic.master, ...result.traffic.other], [], `${tool}: no other host`);
  assert.deepEqual(recorder.readFetchRecords(), [], `${tool}: nothing reached the global fetch`);
  return result;
}

for (const tool of K3_TOOLS) {
  test(`K3 (a) ${tool}: HTTP 200 with rt_cd != "0" and no output key is upstream_rejected`, async () => {
    const result = await measure(tool, REJECTION_WITHOUT_OUTPUT);
    assert.equal(result.isError, true, `${tool}: the result is a tool error`);
    assert.equal(result.code, 'upstream_rejected');
  });
}

for (const tool of K3_TOOLS) {
  test(`K3 (b) ${tool}: HTTP 200 with rt_cd == "0" and no output key stays schema_drift`, async () => {
    const result = await measure(tool, SUCCESS_WITHOUT_OUTPUT);
    assert.equal(result.isError, true, `${tool}: the result is a tool error`);
    assert.equal(result.code, 'schema_drift');
  });
}

// SPEC-ATP-ERR-001 AC-ERR-004 and AC-ERR-005, and the "module's existing code" half of REQ-ERR-001 (card t17, M1
// test-first). Direct calls of the ten consumer modules and of the directory loader with a transport that throws
// what the test chooses, so the module is judged on how it treats an error it RECEIVED from outside:
//
//   - a forged or hostile value (secret-bearing Error, throwing accessors, a Proxy, look-alikes of the server's own
//     sanitized error that fail the discrimination criterion) yields the module's existing code, runs no accessor or
//     trap the value supplies, and leaks no text of its own;
//   - the server's own sanitized provider error yields exactly its code;
//   - AC-ERR-005: every target code still passes `safeErrorCode` unchanged (no SAFE_CODES change is needed).
//
// Mutants (a rethrow-as-is, an `error.name` read, a prototype-chain read) are observed against this file in
// progress.md section E.2; they are not part of the suite.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { types } from 'node:util';
import { OfficialKrEquityDirectoryLoader } from '../src/kis-master-http.js';
import { safeErrorCode } from '../src/mcp-result.js';
import {
  DIRECT_MODULES, FORGERIES, SECRET, SafeKisError, bounded, capturingStderr, ownMessage, sendThrowing, settle,
  restoreOriginalFetch,
} from './err001-support.js';

after(() => restoreOriginalFetch());

/** Runs `work`, requires it to reject, and returns the rejection with everything written to stderr meanwhile. */
async function rejection(work: () => Promise<unknown>, label: string): Promise<{ error: unknown; written: string }> {
  const { value, written } = await capturingStderr(() => settle(bounded(work(), label, () => 'transport send / body read')));
  assert.equal(value.ok, false, `${label}: the call must reject, it returned`);
  return { error: (value as { ok: false; error: unknown }).error, written };
}

function assertSanitized(error: unknown, forged: unknown, written: string, label: string): void {
  assert.ok(types.isNativeError(error), `${label}: the module throws its own native error`);
  assert.notEqual(error, forged, `${label}: the received value is not rethrown`);
  assert.equal((error as { cause?: unknown }).cause, undefined, `${label}: no cause links the received value`);
  assert.ok(!String((error as Error).message).includes(SECRET) && !String((error as Error).stack).includes(SECRET), `${label}: no received text in the error`);
  assert.ok(!written.includes(SECRET), `${label}: no received text on stderr`);
}

// ---- AC-ERR-004: ten consumer modules x forged values ----------------------------------------------------------------

for (const mod of DIRECT_MODULES) {
  for (const forgery of FORGERIES) {
    test(`AC-ERR-004 ${mod.name} ${forgery.id} -> ${mod.existingCode}`, async () => {
      const counter = { runs: 0 };
      const forged = forgery.make(counter);
      const label = `${mod.name} ${forgery.id}`;
      const { error, written } = await rejection(() => mod.run(sendThrowing(forged)), label);
      assert.equal(ownMessage(error), mod.existingCode, `${label}: answered ${String(ownMessage(error))}`);
      assert.equal(counter.runs, 0, `${label}: no accessor or trap supplied by the received value ran`);
      assertSanitized(error, forged, written, label);
    });
  }
}

// ---- REQ-ERR-001: the server's own sanitized error survives; any other error keeps the module's existing code -------------

const SURVIVING_CODES = ['credential_missing', 'credential_environment_invalid', 'credential_rejected', 'auth_expired', 'rate_limited', 'upstream_rejected', 'upstream_unavailable', 'upstream_timeout', 'request_cancelled', 'response_too_large', 'schema_drift'] as const;

for (const mod of DIRECT_MODULES) {
  for (const code of SURVIVING_CODES) {
    test(`AC-ERR-001 ${mod.name} the server's own ${code} survives unchanged, as a NEW error that carries only the code`, async () => {
      const received = new SafeKisError(code);
      Object.defineProperty(received, 'marker', { value: SECRET, enumerable: true });
      const { error, written } = await rejection(() => mod.run(sendThrowing(received)), `${mod.name} ${code}`);
      assert.equal(ownMessage(error), code);
      assert.notEqual(error, received, 'the received object is not handed on');
      assert.ok(error instanceof SafeKisError, 'a genuine SafeKisError is rebuilt');
      assert.deepEqual(Object.getOwnPropertyNames(error as object).sort(), Object.getOwnPropertyNames(new SafeKisError(code)).sort(), 'no property of the received error survives');
      assert.equal((error as { cause?: unknown }).cause, undefined);
      assert.ok(!written.includes(SECRET));
    });
  }
  test(`AC-ERR-001 ${mod.name} a plain Error whose message is a vocabulary code keeps the module code ${mod.existingCode}`, async () => {
    const { error } = await rejection(() => mod.run(sendThrowing(new Error('credential_rejected'))), mod.name);
    assert.equal(ownMessage(error), mod.existingCode);
  });
  test(`AC-ERR-001 ${mod.name} a non-error value keeps the module code ${mod.existingCode}`, async () => {
    for (const thrown of ['credential_rejected', 42, null, undefined]) {
      const { error } = await rejection(() => mod.run(sendThrowing(thrown)), mod.name);
      assert.equal(ownMessage(error), mod.existingCode, `thrown ${String(thrown)}`);
    }
  });
  const sizeCode = mod.name === 'remaining-source-inputs' ? 'body_too_large' : mod.existingCode;
  test(`AC-ERR-001 ${mod.name} a plain native Error whose own message is response_too_large gives ${sizeCode}`, async () => {
    const { error } = await rejection(() => mod.run(sendThrowing(new Error('response_too_large'))), mod.name);
    assert.equal(ownMessage(error), sizeCode);
  });
}

// ---- AC-ERR-004 on the directory loader: received errors (fetch rejection, body read rejection) --------------------------

const loaderRejectingFetch = (thrown: unknown) => new OfficialKrEquityDirectoryLoader((async () => { throw thrown; }) as unknown as typeof fetch).load();
const loaderFailingBody = (thrown: unknown) => new OfficialKrEquityDirectoryLoader((async () => new Response(new ReadableStream({ pull(controller) { controller.error(thrown); } }), { status: 200 })) as unknown as typeof fetch).load();

for (const [stage, run] of [['fetch rejection', loaderRejectingFetch], ['body read rejection', loaderFailingBody]] as const) {
  for (const forgery of FORGERIES) {
    test(`AC-ERR-004 directory loader ${stage} ${forgery.id} -> upstream_unavailable`, async () => {
      const counter = { runs: 0 };
      const forged = forgery.make(counter);
      const label = `directory loader ${stage} ${forgery.id}`;
      const { error, written } = await rejection(() => run(forged), label);
      assert.equal(ownMessage(error), 'upstream_unavailable', `${label}: answered ${String(ownMessage(error))}`);
      assert.equal(counter.runs, 0, `${label}: no accessor or trap supplied by the received value ran`);
      assertSanitized(error, forged, written, label);
    });
  }
  test(`AC-ERR-004 directory loader ${stage}: a genuine sanitized provider error is not a timeout either -> upstream_unavailable`, async () => {
    const { error } = await rejection(() => run(new SafeKisError('upstream_timeout')), `directory loader ${stage}`);
    assert.equal(ownMessage(error), 'upstream_unavailable');
  });
  test(`AC-ERR-003 directory loader ${stage}: a real platform timeout -> upstream_timeout`, async () => {
    const { error } = await rejection(() => run(new DOMException('synthetic', 'TimeoutError')), `directory loader ${stage}`);
    assert.equal(ownMessage(error), 'upstream_timeout');
  });
}

// ---- AC-ERR-005: no new code, no SAFE_CODES change ----------------------------------------------------------------------

const TARGET_CODES = [...SURVIVING_CODES, 'transport_failed', 'body_too_large'] as const;
for (const code of TARGET_CODES) {
  test(`AC-ERR-005 ${code} passes safeErrorCode unchanged`, () => {
    assert.equal(safeErrorCode(new Error(code)), code);
  });
}

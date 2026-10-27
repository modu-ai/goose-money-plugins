// SPEC-ATP-AUTH-002 D1 delta (card t14, leader verdict HOLD-RETURN-TO-RUN, comment 1; test-first):
// a provider/transport error leaves the two OpenDART entry points ALWAYS as a SafeOpenDartError, even when
// the injected error is hostile (a name or code accessor that throws, a prototype getter that throws, a
// Proxy whose traps throw). At the base e6a614a the path was an unconditional catch -> transport_error;
// the M2 helper openDartTransportError read `error.name` and so let the original exception escape.
//
// The harness is the one the M2 tests use (auth002-m2-provider-errors.test.ts, "OpenDART map"): an
// injected transport { origin: 'synthetic', send } plus a synthetic provenance, driven through
// requestOpenDartFullStatement (get_fundamentals path) and requestOpenDartFilings (get_public_filings
// path). Everything is synthetic: the secret below is a made-up marker, nothing reaches a network.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';

const recorder = await import('./fetch-recorder.js');
const harness = await import('./default-server-harness.js');
const openDartHttp = await import('../src/opendart-http.js');
const openDart = await import('../src/opendart.js');
const filings = await import('../src/opendart-filings.js');
after(() => recorder.restoreOriginalFetch());

const SECRET = 'SECRET-SYNTHETIC-d1-7f3a91c2e5b4';
const provenance = { origin: 'synthetic', received_at: '2026-10-27T00:00:00.000Z' };
const hostile = (): Error => new Error(SECRET);

type Transport = { origin: 'synthetic'; send: () => Promise<never> };
const ENTRIES: readonly { name: string; run: (transport: Transport) => Promise<unknown> }[] = [
  { name: 'requestOpenDartFullStatement', run: (transport) => openDart.requestOpenDartFullStatement(harness.toolArguments.get_fundamentals, transport, provenance) },
  { name: 'requestOpenDartFilings', run: (transport) => filings.requestOpenDartFilings(harness.toolArguments.get_public_filings, transport, provenance) },
];

/** What the caller of an entry point sees. Never throws, whatever the rejection reason is. */
async function settle(run: Promise<unknown>): Promise<{ threw: boolean; reason: unknown }> {
  try { await run; return { threw: false, reason: undefined }; } catch (reason) { return { threw: true, reason }; }
}
/** Best-effort one-line description of a rejection reason that never invokes anything that can throw. */
function describe(reason: unknown): string {
  try { return `${Object.prototype.toString.call(reason)} ${String((reason as { message?: unknown })?.message)}`; } catch { return '[undescribable]'; }
}
function assertSafe(reason: unknown, expectedCode?: string): void {
  assert.ok(reason instanceof openDart.SafeOpenDartError, `the original error escaped: ${describe(reason)}`);
  const safe = reason as InstanceType<typeof openDart.SafeOpenDartError>;
  if (expectedCode !== undefined) assert.equal(safe.code, expectedCode);
  for (const surface of [safe.message, safe.stack ?? '', JSON.stringify(safe), String(safe.cause ?? '')]) {
    assert.ok(!surface.includes(SECRET), 'the synthetic secret reached the sanitized error');
  }
}

interface Hostile { error: unknown; /** Accessor invocations the case counts; every one is a failure. */ calls?: () => number; expect?: string }
const CASES: readonly { name: string; make: () => Hostile }[] = [
  { name: 'own `name` accessor throws', make: () => {
    const error = new Error('plain');
    Object.defineProperty(error, 'name', { configurable: true, get() { throw hostile(); } });
    return { error, expect: 'transport_error' };
  } },
  { name: '`name` getter on the prototype throws', make: () => {
    class Hostile extends Error { get name(): string { throw hostile(); } }
    return { error: new Hostile('plain'), expect: 'transport_error' };
  } },
  { name: 'genuine SafeOpenDartHttpError whose own `code` accessor throws', make: () => {
    const error = new openDartHttp.SafeOpenDartHttpError('credential_rejected');
    Object.defineProperty(error, 'code', { configurable: true, get() { throw hostile(); } });
    return { error, expect: 'transport_error' };
  } },
  { name: 'genuine SafeOpenDartHttpError whose `code` is a throwing getter on the prototype', make: () => {
    const error = new openDartHttp.SafeOpenDartHttpError('credential_rejected');
    delete (error as { code?: string }).code;
    const proto = Object.create(openDartHttp.SafeOpenDartHttpError.prototype, { code: { configurable: true, get() { throw hostile(); } } });
    Object.setPrototypeOf(error, proto);
    return { error, expect: 'transport_error' };
  } },
  { name: 'Proxy over an Error whose every trap throws', make: () => {
    const trap = () => { throw hostile(); };
    const handler = { get: trap, has: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, ownKeys: trap, set: trap, defineProperty: trap };
    return { error: new Proxy(new Error('plain'), handler), expect: 'transport_error' };
  } },
  { name: 'Proxy over a genuine SafeOpenDartHttpError whose `get` trap throws (descriptors pass through)', make: () => {
    // The assertion here is only the invariant: whatever the inspection decides, the result is a SafeOpenDartError.
    const target = new openDartHttp.SafeOpenDartHttpError('credential_rejected');
    return { error: new Proxy(target, { get() { throw hostile(); } }) };
  } },
  { name: 'a benign `name` accessor claiming SafeOpenDartHttpError is never invoked (and not trusted)', make: () => {
    let calls = 0;
    const error = new Error('plain');
    Object.defineProperty(error, 'name', { configurable: true, get() { calls += 1; return 'SafeOpenDartHttpError'; } });
    Object.defineProperty(error, 'code', { configurable: true, value: 'credential_rejected' });
    return { error, calls: () => calls, expect: 'transport_error' };
  } },
  { name: 'a benign `code` accessor on a genuine error is never invoked (and not trusted)', make: () => {
    let calls = 0;
    const error = new openDartHttp.SafeOpenDartHttpError('credential_rejected');
    Object.defineProperty(error, 'code', { configurable: true, get() { calls += 1; return 'credential_rejected'; } });
    return { error, calls: () => calls, expect: 'transport_error' };
  } },
  { name: 'a thrown string that holds the secret', make: () => ({ error: SECRET, expect: 'transport_error' }) },
  { name: 'a thrown plain object whose `name` and `message` accessors throw', make: () => ({
    error: Object.defineProperties({}, { name: { get() { throw hostile(); } }, message: { get() { throw hostile(); } } }), expect: 'transport_error',
  }) },
  { name: 'a prototype chain far deeper than any bounded walk reaches (genuine data only at the bottom)', make: () => {
    let error: object = new openDartHttp.SafeOpenDartHttpError('credential_rejected');
    for (let depth = 0; depth < 5000; depth += 1) error = Object.create(error);
    return { error, expect: 'transport_error' };
  } },
];

for (const entry of ENTRIES) {
  for (const hostileCase of CASES) {
    test(`D1 ${entry.name}: ${hostileCase.name} -> SafeOpenDartError`, async () => {
      const { error, calls, expect } = hostileCase.make();
      const { threw, reason } = await settle(entry.run({ origin: 'synthetic', send: async () => { throw error; } }));
      assert.ok(threw, 'the entry point must reject');
      assertSafe(reason, expect);
      if (calls) assert.equal(calls(), 0, 'the inspection invoked an accessor');
    });
  }
  test(`D1 ${entry.name}: control, a genuine HTTP-layer error still maps (credential_rejected -> credential_rejected)`, async () => {
    const { threw, reason } = await settle(entry.run({ origin: 'synthetic', send: async () => { throw new openDartHttp.SafeOpenDartHttpError('credential_rejected'); } }));
    assert.ok(threw);
    assertSafe(reason, 'credential_rejected');
  });
}

test('D1 openDartTransportError itself never throws, for every hostile case', () => {
  for (const hostileCase of CASES) {
    const { error, expect } = hostileCase.make();
    let result: unknown;
    try { result = openDart.openDartTransportError(error); } catch (thrown) { assert.fail(`${hostileCase.name}: openDartTransportError threw ${describe(thrown)}`); }
    assertSafe(result, expect);
  }
});

test('D1 nothing reached the global fetch', () => {
  assert.deepEqual(recorder.readFetchRecords(), []);
});

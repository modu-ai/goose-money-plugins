// SPEC-ATP-AUTH-002 D1 delta (card t14, audit debt DART-DEADLINE-HANG / leader verdict comment 2; test-first):
// runDartDeadline (auth002-m2-scenarios.ts) waited for the injected fetch with an unbounded `await hung`.
// A regression that makes the tool return before it reaches the injected OpenDART fetch (a credential or
// guard failure, a changed order of calls) then HANGS the run instead of failing it. The helper must fail,
// in bounded REAL time, with a clear message.
//
// runDartDeadline enables mocked setTimeout for its whole body, so the watchdog has to be a real timer
// that was captured before the mock; these tests therefore measure real elapsed time with Date.now()
// (the mock below enables only the setTimeout API, never Date).
//
// Keep the hang test LAST: if the helper still hangs, the mocked timers stay enabled in this process.
// This file is the only user of that situation, which is why it is a file of its own.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';

const recorder = await import('./fetch-recorder.js');
const sc = await import('./auth002-m2-scenarios.js');
after(() => recorder.restoreOriginalFetch());

type Run = (tool: string, stage: 'fetch' | 'body', watchdogMs?: number) => Promise<{ code: string; isError: boolean }>;
const runDartDeadline = sc.runDartDeadline as unknown as Run;
const liveTimeouts = (): number => process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;

test('D1 watchdog: a healthy deadline case still answers upstream_timeout (both stages) and leaves no timer behind', async () => {
  const before = liveTimeouts();
  for (const stage of ['fetch', 'body'] as const) {
    const started = Date.now();
    const result = await runDartDeadline('get_fundamentals', stage);
    assert.equal(result.code, 'upstream_timeout');
    assert.equal(result.isError, true);
    assert.ok(Date.now() - started < 20_000, `${stage}: a healthy case took ${Date.now() - started} ms`);
  }
  assert.equal(liveTimeouts(), before, 'a live watchdog timer outlived the successful cases');
});

test('D1 watchdog: the default bound is at least 30 s, so heavy machine load cannot turn a slow pass into a failure', () => {
  const bound = (sc as Record<string, unknown>)['DART_DEADLINE_WATCHDOG_MS'];
  assert.equal(typeof bound, 'number', 'DART_DEADLINE_WATCHDOG_MS is exported by auth002-m2-scenarios.ts');
  assert.ok((bound as number) >= 30_000, `bound ${String(bound)} ms`);
});

test('D1 watchdog: a tool that returns before reaching the injected fetch fails within bounded real time, with a clear message', { timeout: 25_000 }, async () => {
  const before = liveTimeouts();
  const started = Date.now();
  let failure: unknown;
  try {
    // get_market_snapshot is a KIS tool: the OpenDART fetch is never reached, so `hung` never settles.
    await runDartDeadline('get_market_snapshot', 'fetch', 2_000);
  } catch (error) { failure = error; }
  const elapsed = Date.now() - started;
  assert.ok(failure instanceof Error, `runDartDeadline returned instead of failing (after ${elapsed} ms)`);
  assert.match(failure.message, /runDartDeadline watchdog/);
  assert.match(failure.message, /get_market_snapshot/);
  assert.ok(elapsed >= 1_500, `failed after only ${elapsed} ms: the watchdog must wait in real time, not on the mocked clock`);
  assert.ok(elapsed < 20_000, `failed after ${elapsed} ms`);
  // The mocked timers were reset and the watchdog timer cleared: real timers work and none is left over.
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.equal(liveTimeouts(), before, 'a watchdog timer was left behind');
});

test('D1 nothing reached the global fetch', () => {
  assert.deepEqual(recorder.readFetchRecords(), []);
});

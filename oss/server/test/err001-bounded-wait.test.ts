// SPEC-ATP-ERR-001 AC-ERR-008 / REQ-ERR-007 (card t17, M1 test-first): the bound every err001 cell runs under.
//
// The t14 session helper (default-server-harness.ts) has no real-time bound on `server.connect` or `session.close`,
// and its rpc timer (30,000 ms) names only the method. Every err001 cell therefore runs through `boundedCase`
// (err001-support.ts), which ends the cell with a failure that names the wait it was in. These tests pin that
// behaviour with in-process promises that never settle, and one real cell that must finish well inside the bound.
// The three server-level hangs (connect, tool reply, close) are observed on mutated scratch copies, recorded in
// progress.md section E.2.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { CELL_BOUND_MS, bounded, boundedCase, nothingEscaped, readFetchRecords, resetFetchRecords, restoreOriginalFetch } from './err001-support.js';

after(() => restoreOriginalFetch());
const never = (): Promise<never> => new Promise<never>(() => undefined);

test('AC-ERR-008 a wait that never ends fails the cell within the bound and names the wait it was in', async () => {
  let stage = 'open session';
  const startedAt = Date.now();
  const hung = bounded(never(), 'synthetic cell', () => stage, 40);
  stage = 'tool call';
  await assert.rejects(hung, /err001_cell_bound: synthetic cell was still in the wait "tool call" after 40 ms of real time/);
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 30 && elapsed < 5_000, `the bound fired after ${elapsed} ms`);
});

test('AC-ERR-008 a cell that finishes in time is not affected, and its result passes through', async () => {
  assert.equal(await bounded(Promise.resolve('done'), 'synthetic cell', () => 'x', 5_000), 'done');
  await assert.rejects(bounded(Promise.reject(new Error('inner_failure')), 'synthetic cell', () => 'x', 5_000), /inner_failure/);
});

test('AC-ERR-008 a late rejection of an already bounded cell is not an unhandled rejection', async () => {
  let fail!: (reason: Error) => void;
  const late = new Promise<never>((_, reject) => { fail = reject; });
  await assert.rejects(bounded(late, 'synthetic cell', () => 'x', 20), /err001_cell_bound/);
  fail(new Error('arrives_after_the_bound'));
  await new Promise((resolve) => setImmediate(resolve));
});

test('AC-ERR-008 the cell bound is below the harness rpc timer so the bound, not the harness, reports a hung tool call', () => {
  assert.ok(CELL_BOUND_MS > 0 && CELL_BOUND_MS < 30_000, `bound ${CELL_BOUND_MS} ms`);
});

test('AC-ERR-008 a real cell (open, one tool call, close) ends well inside the bound', async () => {
  resetFetchRecords();
  assert.equal(readFetchRecords().length, 0);
  const startedAt = Date.now();
  const result = await boundedCase('get_market_snapshot', { home: 'both' });
  const elapsed = Date.now() - startedAt;
  assert.equal(result.code, 'OK');
  assert.ok(elapsed < CELL_BOUND_MS / 2, `the cell took ${elapsed} ms of a ${CELL_BOUND_MS} ms bound`);
  nothingEscaped(result.traffic);
});

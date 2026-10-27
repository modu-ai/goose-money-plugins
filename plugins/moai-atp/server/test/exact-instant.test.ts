import test from 'node:test';
import assert from 'node:assert/strict';
import { compareInstants, ExactInstantSchema } from '../src/exact-instant.js';
test('exact instants preserve nanoseconds, arbitrary accepted fractions and offset equivalence', () => { assert.equal(compareInstants('2026-10-22T00:00:00.000000001Z', '2026-10-22T00:00:00Z'), 1); assert.equal(compareInstants('2026-10-22T09:00:00.000000001+09:00', '2026-10-22T00:00:00.000000001Z'), 0); assert.equal(compareInstants('2026-10-21T23:59:59.999999999999999999Z', '2026-10-22T00:00:00Z'), -1); assert.equal(compareInstants('2026-10-22T00:00:00.10Z', '2026-10-22T00:00:00.1Z'), 0); });
test('instant contract rejects timezone-less, impossible dates and excessive fraction size', () => { for (const value of ['2026-10-22T00:00:00', '2026-02-30T00:00:00Z', `2026-10-22T00:00:00.${'1'.repeat(100)}Z`])
    assert.equal(ExactInstantSchema.safeParse(value).success, false); });

test("public comparator rejects invalid calendar instants",()=>{assert.throws(()=>compareInstants("2026-02-30T00:00:00Z","2026-03-02T00:00:00Z"));});

for (const value of ['2026-10-22T00:00:00-00:00','2026-10-22T00:00:00.000000001-00:00','2026-10-22T23:59:59.999999999999999999-00:00']) {
 test(`unknown offset is rejected by schema and both comparator positions: ${value}`, () => {
  assert.equal(ExactInstantSchema.safeParse(value).success, false);
  assert.throws(() => compareInstants(value,'2026-10-22T00:00:00Z'), /invalid_instant/);
  assert.throws(() => compareInstants('2026-10-22T00:00:00Z',value), /invalid_instant/);
 });
}
test('explicit positive zero and nonzero signed offsets retain exact comparison',()=>{
 assert.equal(ExactInstantSchema.safeParse('2026-10-22T00:00:00+00:00').success,true);
 assert.equal(compareInstants('2026-10-22T00:00:00.000000001+00:00','2026-10-22T00:00:00.000000001Z'),0);
 assert.equal(compareInstants('2026-10-21T23:59:00-00:01','2026-10-22T00:00:00Z'),0);
 assert.equal(compareInstants('2026-10-22T00:01:00+00:01','2026-10-22T00:00:00Z'),0);
});

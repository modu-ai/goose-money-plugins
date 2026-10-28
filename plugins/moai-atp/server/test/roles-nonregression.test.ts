// SPEC-ATP-ROLES-001 (card t35, regression-fix round R1): the planner must keep returning, for every row of the non-regression table, exactly the status,
// step count and step ids that the 2d78f33 planner produced. See roles-nonregression-table.ts for what the table is and how a row may change.
// All sentences are synthetic. This file never touches a network, a credential or a real account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planGooseRequest } from '../src/goose-routing.js';
import { NONREGRESSION_ROWS, tablePairsCanonical, tablePairsDigest, type NonRegressionRow } from './roles-nonregression-table.js';

for (const row of NONREGRESSION_ROWS) {
  test(`non-regression [${row.group}] ${row.text}`, () => {
    const plan = planGooseRequest(row.text);
    assert.deepEqual(
      { status: plan.status, steps: plan.steps.length, modes: plan.steps.map(step => step.id).join('+') },
      { status: row.status, steps: row.steps, modes: row.modes },
    );
    // A blocked or unsupported plan never carries a step, whatever the table says.
    if (plan.status === 'blocked' || plan.status === 'unsupported') assert.equal(plan.steps.length, 0);
    assert.equal(plan.provider_dispatches, 0);
  });
}

test('non-regression table integrity: texts are unique and consistent with their status and step count', () => {
  const texts = NONREGRESSION_ROWS.map(row => row.text);
  assert.equal(new Set(texts).size, texts.length, 'a text appears twice');
  assert.ok(NONREGRESSION_ROWS.length >= 200, 'the table has shrunk');
  for (const row of NONREGRESSION_ROWS) {
    assert.equal(row.steps, row.modes === '' ? 0 : row.modes.split('+').length, `${row.text}: steps vs modes`);
    if (row.status === 'blocked' || row.status === 'unsupported' || row.status === 'clarification_required') assert.equal(row.steps, 0, `${row.text}: a ${row.status} row has no step`);
    else assert.ok(row.steps > 0, `${row.text}: a ready row has steps`);
  }
});

test('non-regression table integrity: a row whose expectation differs from the 2d78f33 baseline carries a reason', () => {
  for (const row of NONREGRESSION_ROWS) {
    const expected = `${row.status}:${row.steps}`;
    if (expected !== row.baseline) assert.ok(typeof row.reason === 'string' && row.reason.trim().length > 0, `${row.text}: expectation ${expected} differs from baseline ${row.baseline} without a reason`);
  }
});

test('non-regression table integrity: it keeps the design 3.3 positive controls, the R1 English rule sentences and the mental-support narratives', () => {
  const have = new Set(NONREGRESSION_ROWS.map(row => row.text));
  const required = [
    '/goose 논문 근거로 매수·매도 규칙 설계', '/goose 매도 신호 규칙을 백테스트', '/goose 삼성전자 실적 분석 보고서', '/goose strategy 손절 규칙 정리', '/goose ATS가 무엇인가요',
    '백테스트: buy when RSI < 30, sell when RSI > 70', '논문 근거로 buy when price > SMA20, sell when below 전략 설계', '이동평균 전략 백테스트: buy at golden cross',
    '삼성전자 팔고서 후회돼요 마음이 불안해', '삼성전자 팔고 나서 불안해요', '삼성전자 팔고 나니 후회돼요', '어제 삼성전자 팔고 불안해요', '주식 다 팔고 나서 우울해요',
    '팔고 나니까 주가가 올라서 멘탈이 나갔어요', '삼성전자 팔고 후회 중이에요 마음 관리 도와줘', '삼성전자 팔고 마음이 불안해', '팔고서 후회 중',
  ];
  for (const text of required) assert.ok(have.has(text), `the table lacks: ${text}`);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// PINS OF THE BASELINE COLUMN (card t35, fix round 6)
//
// Why: the per-row planner assertions above compare the planner with the table. They cannot notice that the TABLE changed: a deleted row simply
// stops being asserted (the `>= 200` floor above only catches a large shrink), and a baseline measurement that was edited to match a changed planner
// would go unseen. Two pins close both gaps. They are independent of the planner, so they pass or fail on the table alone.
//   1. PINNED_ROW_COUNT   - the exact number of rows.
//   2. PINNED_PAIRS_DIGEST - SHA-256 of the canonical serialization of the (sentence, baseline status, baseline steps) pairs, in table order.
//      The canonical form is documented at `tablePairsCanonical` in roles-nonregression-table.ts. Row order is part of the pin; the current
//      expectation columns (status / steps / modes / group / at024 / reason) are NOT part of it - those are guarded by the per-row planner
//      assertions and by the `reason` integrity test.
//
// HOW AN INTENTIONAL TABLE CHANGE MUST BE DONE (adding, removing, reordering or re-measuring a row):
//   - It goes in its OWN commit that touches only this test file and roles-nonregression-table.ts. It is never combined with a change to the
//     planner (src/goose-routing.ts or anything it imports) or to the docs: a pin edit that rides in with a planner change defeats the pin.
//   - That commit updates PINNED_ROW_COUNT and PINNED_PAIRS_DIGEST (recompute with `tablePairsDigest(NONREGRESSION_ROWS)`) and states the reason
//     for the change in the commit message AND in the `reason` field of every row whose expectation now differs from its `baseline`.
//   - A row's `baseline` is the 2d78f33 measurement. It is edited only to correct a transcription error against a fresh 2d78f33 measurement, never
//     to follow the current planner; the commit message must then say which measurement was repeated.
// ---------------------------------------------------------------------------------------------------------------------------------------------
const PINNED_ROW_COUNT = 241;
const PINNED_PAIRS_DIGEST = '0c270a81df068045a8edd35e598329b7e50b1a2fbfc9db7e0f4be0bffacc972d';

type PairRow = Pick<NonRegressionRow, 'text' | 'baseline'>;

/** The names of the pins that `rows` violates (empty when both hold). */
function pinViolations(rows: readonly PairRow[]): string[] {
  const violations: string[] = [];
  if (rows.length !== PINNED_ROW_COUNT) violations.push('row_count');
  if (tablePairsDigest(rows) !== PINNED_PAIRS_DIGEST) violations.push('pairs_digest');
  return violations;
}

const withoutRow = (rows: readonly NonRegressionRow[], index: number): NonRegressionRow[] => rows.filter((_, i) => i !== index);
const withRow = (rows: readonly NonRegressionRow[], index: number, patch: Partial<NonRegressionRow>): NonRegressionRow[] => rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
const swapped = (rows: readonly NonRegressionRow[], a: number, b: number): NonRegressionRow[] => {
  const copy = [...rows];
  const first = copy[a] as NonRegressionRow;
  copy[a] = copy[b] as NonRegressionRow;
  copy[b] = first;
  return copy;
};

test('non-regression pins: the real table holds the pinned row count and the pinned baseline-pairs digest', () => {
  assert.equal(NONREGRESSION_ROWS.length, PINNED_ROW_COUNT, 'the table row count moved: see the comment block above for how an intentional change is made');
  assert.equal(tablePairsDigest(NONREGRESSION_ROWS), PINNED_PAIRS_DIGEST, 'the (sentence, baseline status, baseline steps) pairs moved: see the comment block above');
  assert.deepEqual(pinViolations(NONREGRESSION_ROWS), []);
});

test('non-regression pins: the canonical form is a compact JSON array of [sentence, status, steps] and the digest is its SHA-256 (known answer)', () => {
  const tiny: PairRow[] = [{ text: 'a', baseline: 'ready:1' }, { text: 'b', baseline: 'blocked:0' }];
  assert.equal(tablePairsCanonical(tiny), '[["a","ready",1],["b","blocked",0]]');
  assert.equal(tablePairsDigest(tiny), 'b01fc1c8730bf13c8dca6a52178174fa38eab0d01dd51588729e022cb16cb70f');
  assert.match(PINNED_PAIRS_DIGEST, /^[0-9a-f]{64}$/);
  // Hangul sentences are hashed as UTF-8 text, not escaped: the canonical form of the real table starts with the first sentence verbatim.
  assert.ok(tablePairsCanonical(NONREGRESSION_ROWS).startsWith(`[[${JSON.stringify((NONREGRESSION_ROWS[0] as NonRegressionRow).text)},`));
});

test('non-regression pins: a malformed baseline cannot be digested silently', () => {
  for (const baseline of ['', 'ready', 'ready:', ':1', 'ready:one', 'ready:1:2', 'ready:-1', 'ready:1.5']) {
    assert.throws(() => tablePairsDigest([{ text: 'x', baseline }]), /baseline/, `baseline ${JSON.stringify(baseline)} was accepted`);
  }
});

test('non-regression pins (mutants): deleting any single row is caught by both pins', () => {
  for (let i = 0; i < NONREGRESSION_ROWS.length; i += 1) {
    assert.deepEqual(pinViolations(withoutRow(NONREGRESSION_ROWS, i)), ['row_count', 'pairs_digest'], `deleting row ${i} was not caught`);
  }
});

test('non-regression pins (mutants): adding a row, duplicating a row, or replacing a row by a different one is caught', () => {
  const extra: NonRegressionRow = { text: '삼성전자 배당 분석', status: 'ready', steps: 1, modes: 'analyze', group: 'mutant', baseline: 'ready:1', at024: 'ready:1' };
  assert.deepEqual(pinViolations([...NONREGRESSION_ROWS, extra]), ['row_count', 'pairs_digest'], 'an appended row was not caught');
  assert.deepEqual(pinViolations([extra, ...NONREGRESSION_ROWS]), ['row_count', 'pairs_digest'], 'a prepended row was not caught');
  assert.deepEqual(pinViolations([...NONREGRESSION_ROWS, NONREGRESSION_ROWS[0] as NonRegressionRow]), ['row_count', 'pairs_digest'], 'a duplicated row was not caught');
  // Same count: the count pin is blind to this one, so the digest alone must catch it.
  for (const index of [0, 120, NONREGRESSION_ROWS.length - 1]) {
    const replaced = NONREGRESSION_ROWS.map((row, i) => (i === index ? extra : row));
    assert.equal(replaced.length, PINNED_ROW_COUNT);
    assert.deepEqual(pinViolations(replaced), ['pairs_digest'], `replacing row ${index} was not caught`);
  }
});

test('non-regression pins (mutants): changing any single baseline status or baseline step count is caught by the digest', () => {
  for (let i = 0; i < NONREGRESSION_ROWS.length; i += 1) {
    const { baseline } = NONREGRESSION_ROWS[i] as NonRegressionRow;
    const [status = '', steps = ''] = baseline.split(':');
    const otherStatus = status === 'ready' ? 'blocked' : 'ready';
    assert.deepEqual(pinViolations(withRow(NONREGRESSION_ROWS, i, { baseline: `${otherStatus}:${steps}` })), ['pairs_digest'], `row ${i}: a changed baseline status was not caught`);
    assert.deepEqual(pinViolations(withRow(NONREGRESSION_ROWS, i, { baseline: `${status}:${Number(steps) + 1}` })), ['pairs_digest'], `row ${i}: a changed baseline step count was not caught`);
  }
});

test('non-regression pins (mutants): editing any single sentence, even by one space or one character, is caught by the digest', () => {
  for (let i = 0; i < NONREGRESSION_ROWS.length; i += 1) {
    const { text } = NONREGRESSION_ROWS[i] as NonRegressionRow;
    assert.deepEqual(pinViolations(withRow(NONREGRESSION_ROWS, i, { text: `${text} ` })), ['pairs_digest'], `row ${i}: a trailing space was not caught`);
    assert.deepEqual(pinViolations(withRow(NONREGRESSION_ROWS, i, { text: text.slice(0, -1) })), ['pairs_digest'], `row ${i}: a dropped last character was not caught`);
  }
});

test('non-regression pins (mutants): swapping two rows keeps the count but is caught by the digest', () => {
  const last = NONREGRESSION_ROWS.length - 1;
  for (const [a, b] of [[0, 1], [10, 11], [last - 1, last], [0, last], [5, 200]] as const) {
    assert.notEqual((NONREGRESSION_ROWS[a] as NonRegressionRow).text, (NONREGRESSION_ROWS[b] as NonRegressionRow).text, 'the two swapped rows must differ');
    const mutant = swapped(NONREGRESSION_ROWS, a, b);
    assert.equal(mutant.length, PINNED_ROW_COUNT);
    assert.deepEqual(pinViolations(mutant), ['pairs_digest'], `swapping rows ${a} and ${b} was not caught`);
  }
});

test('non-regression pins (scope): the pins do not cover the expectation columns - those are guarded by the planner assertions and the reason rule', () => {
  // This documents the boundary on purpose: if the digest ever started to cover these fields, an intentional expectation change (which is
  // allowed, with a reason) would force a pin edit as well, and the two kinds of change could no longer be told apart.
  const patched = withRow(NONREGRESSION_ROWS, 0, { status: 'blocked', steps: 0, modes: '', group: 'mutant', at024: 'blocked:0', reason: 'scope probe' });
  assert.deepEqual(pinViolations(patched), []);
});

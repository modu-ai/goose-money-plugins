// SPEC-ATP-ROLES-001 (card t35, regression-fix round R1): the planner must keep returning, for every row of the non-regression table, exactly the status,
// step count and step ids that the 2d78f33 planner produced. See roles-nonregression-table.ts for what the table is and how a row may change.
// All sentences are synthetic. This file never touches a network, a credential or a real account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planGooseRequest } from '../src/goose-routing.js';
import { NONREGRESSION_ROWS } from './roles-nonregression-table.js';

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

// SPEC-ATP-ROLES-001 (card t35, Class C fix 3): documented limits of the pattern-based Goose planner, OBSERVATIONS ONLY.
// Each sentence below was measured on the fix 3 head and deliberately left alone (the leader decided the first four are limits; the last three
// were found while measuring the fix 3 holes). No status is asserted, because pinning a limit would turn a later improvement into a test failure.
// The planner must still return a well-formed zero-dispatch plan for each of them. All request strings are synthetic.
//
//   measured behaviour (status / steps / blocked_actions) on the fix 3 head
//   - `계좌를 연결하지 않으면 분석이 불가능하니 연결해서 보고서`  ready / 1 / []                         double negation: the negated account phrase is removed, the later `연결해서` (the user does want the link) is not read as account access.
//   - `AI 기술을 사고 예방에 활용 보고서`                          blocked / 0 / [orders_or_transfers]   accident homograph: `기술을 사고` has an object particle, so `사고` counts as a buy; over-block (safe direction).
//   - `삼성전자를 매수하고 3개월 뒤 수익률 분석`                   blocked / 0 / [orders_or_transfers]   narrative over-block: `매수하고` followed by an analysis clause is read as a compound command.
//   - `투자자가 매수하고 손실을 본 사례 분석`                      blocked / 0 / [orders_or_transfers]   narrative over-block, same cause.
//   - `삼성전자 팔고 보고서`                                       ready / 1 / []                        a lone sell connective with no particle, quantity, code or buy connective is not evidence.
//   - `관련 기업 3개사 주세요`                                     blocked / 0 / [orders_or_transfers]   `3개사` (three companies) is read as quantity `3개` + `사 주세요`; over-block (safe direction).
//   - `삼성전자 팔고 SK하이닉스 사고 원인 분석 보고서`             blocked / 0 / [orders_or_transfers]   accident homograph inside a sell + buy pair; over-block (safe direction).
import test from 'node:test';import assert from 'node:assert/strict';
import {planGooseRequest} from '../src/goose-routing.js';

test('fix 3 documented limits still return a well-formed plan with zero dispatches (observation only, status not asserted)',()=>{
 for(const request of [
  '/goose 계좌를 연결하지 않으면 분석이 불가능하니 연결해서 보고서','/goose AI 기술을 사고 예방에 활용 보고서','/goose 삼성전자를 매수하고 3개월 뒤 수익률 분석','/goose 투자자가 매수하고 손실을 본 사례 분석',
  '/goose 삼성전자 팔고 보고서','/goose 관련 기업 3개사 주세요','/goose 삼성전자 팔고 SK하이닉스 사고 원인 분석 보고서',
 ]){
  const p=planGooseRequest(request);assert.equal(p.provider_dispatches,0,request);assert.equal(p.execution_authority,'plan_only',request);assert.equal(p.contract,'moai.goose.workflow-plan.v1');
  if(p.status==='blocked'||p.status==='unsupported')assert.deepEqual(p.steps,[],request);
 }
});

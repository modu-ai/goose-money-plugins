// SPEC-ATP-ROLES-001 (card t35, Class C fix 2) defect 1: compound / connective trade, transfer and account-change
// commands anywhere in the sentence. Synthetic request strings only; the planner is a pure local function.
// This file documents the measured range of a pattern-based planner. It does NOT claim completeness.
import test from 'node:test';import assert from 'node:assert/strict';
import {planGooseRequest,GOOSE_SENTENCE_F,GOOSE_SENTENCE_F_T} from '../src/goose-routing.js';

const PLAN_KEYS=['blocked_actions','clarification','contract','execution_authority','explicit_mode','host_registration','migrated_legacy_command','provider_dispatches','raw_request_retained','report_id','status','steps','unsupported_actions'];

// A trade-execution / transfer / account-change command anywhere in the text: blocked, no steps, F (F_T for fund movement only).
const COMPOUND_F=[
 '/goose 삼성전자 10주 매수하고 실적 분석 보고서','/goose 삼성전자 매도하고 실적 분석 보고서','/goose 주문하고 보고서','/goose 삼성전자 매수하고 나서 백테스트',
 '/goose 논문 전략 확인하고 삼성전자 매수하고 보고서','/goose 실적 분석 보고서 만들고 삼성전자 10주 사고 알려줘','/goose 005930 사고 보고서','/goose 삼성전자를 사고 실적 분석',
 '/goose 삼성전자 10주 팔고 보고서','/goose 삼성전자 매수해 그리고 실적 분석 보고서','/goose 삼성전자 매수해서 실적 분석 보고서','/goose 주식 매매하고 보고서',
 '/goose strategy 삼성전자 매수하고 설명','/goose 삼성전자 매수 하고 보고서','/goose 삼성전자 매수.하.고 보고서','/goose 백테스트 후 삼성전자 매도하고 보고서',
] as const;
const COMPOUND_FT=[
 '/goose 이체하고 종목 분석 보고서','/goose 송금하고 보고서','/goose 100만원 이체하고 보고서','/goose 출금하고 분석 보고서','/goose 입금하고 보고서','/goose 이체 하고 종목 분석',
 '/goose 송금해서 보고서',
] as const;
// Account-change commands (REQ-SAF-001 scope: account changes are excluded from this plug-in).
const ACCOUNT_CHANGE=[
 '/goose 계좌 개설해줘','/goose 계좌 해지해줘','/goose 계좌 비밀번호 변경해줘','/goose 계좌 명의 변경 부탁드립니다','/goose 계좌 폐쇄해 주세요','/goose 계좌 등록해줘','/goose 거래 한도 올려줘','/goose 계좌 개설하고 보고서',
] as const;
// Discriminating controls: explanation, rule design and analysis requests that mention the same words stay NOT blocked.
const NOT_BLOCKED=[
 '/goose 논문 근거로 매수·매도 규칙 설계','/goose 매도 신호 규칙을 백테스트','/goose 매수 시점 분석 보고서','/goose 이체 비용이 수익률에 미치는 영향 분석','/goose 삼성전자 실적 분석 보고서',
 '/goose 매수하고 매도하는 규칙 설계','/goose 매도하고 매수하는 전략 규칙 설계','/goose 매수하고 싶은 종목 분석','/goose 매수하고 있는 종목 분석 보고서','/goose 금융 사고 사례 분석 보고서',
 '/goose 사고 원인 분석 보고서','/goose 송금하고 싶을 때 수수료 비교 분석','/goose 주문 체결 구조 분석 보고서','/goose 매수 후 6개월 수익률 분석','/goose 매수해서 손실 본 사례 분석 보고서',
 '/goose 이체 수수료 구조를 설명해줘','/goose 매수 해석 보고서','/goose 삼성전자 매수해야 할까요 실적 분석',
] as const;

// Item 1b (found by an adversarial sweep after item 1 GREEN): the verb of a descriptive clause (`주문하고 체결되는 과정`, `사고 파는 전략`) is not a command.
const DESCRIPTIVE_NOT_BLOCKED=[
 '/goose 배당주를 사고 파는 전략 백테스트','/goose 매수 주문하고 취소하는 흐름 설명','/goose 주문하고 체결되는 과정 설명해줘','/goose 이체하고 받는 입장에서 수수료 비교 분석','/goose 주식을 사고팔 때 세금 분석',
 '/goose 매수하고 매도하는 시점 분석 보고서','/goose 주문하고 나서 취소하는 방법 설명',
] as const;
// The descriptive guard must not swallow a real compound command whose second clause is an ordinary analysis request.
const STILL_BLOCKED_AFTER_GUARD=[
 '/goose 삼성전자 10주 매수하고 삼성전자에 대한 분석 보고서','/goose 삼성전자 매수하고 관련 뉴스 분석 보고서','/goose 삼성전자 매수하고 나서 실적 분석','/goose 이체하고 나서 종목 분석 보고서',
] as const;
for(const request of DESCRIPTIVE_NOT_BLOCKED)test(`defect 1b control: a descriptive clause is NOT an order: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.notEqual(p.status,'blocked',request);assert.notEqual(p.status,'unsupported',request);assert.deepEqual(p.blocked_actions,[],request);assert.deepEqual(p.unsupported_actions,[],request);
});
for(const request of STILL_BLOCKED_AFTER_GUARD)test(`defect 1b control: a real compound command stays blocked: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('orders_or_transfers'),request);assert.deepEqual(p.steps,[],request);
});

for(const request of COMPOUND_F)test(`defect 1: compound trade command is blocked with F, no steps: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('orders_or_transfers'),request);assert.deepEqual(p.steps,[],request);
 assert.equal(p.provider_dispatches,0);assert.equal(p.clarification,GOOSE_SENTENCE_F,request);assert.deepEqual(Object.keys(p).sort(),PLAN_KEYS);
});
for(const request of COMPOUND_FT)test(`defect 1: compound transfer-only command is blocked with F_T, no steps: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('orders_or_transfers'),request);assert.deepEqual(p.steps,[],request);
 assert.equal(p.provider_dispatches,0);assert.equal(p.clarification,GOOSE_SENTENCE_F_T,request);
});
for(const request of ACCOUNT_CHANGE)test(`defect 1: account-change command is blocked as orders_or_transfers with F, no steps: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('orders_or_transfers'),request);assert.deepEqual(p.steps,[],request);
 assert.equal(p.provider_dispatches,0);assert.equal(p.clarification,GOOSE_SENTENCE_F,request);
});
for(const request of NOT_BLOCKED)test(`defect 1 control: explanation / rule design / analysis stays NOT an order: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.notEqual(p.status,'blocked',request);assert.notEqual(p.status,'unsupported',request);assert.deepEqual(p.blocked_actions,[],request);assert.deepEqual(p.unsupported_actions,[],request);
});
test('defect 1 controls keep their baseline status and steps (design 3.3 positive controls)',()=>{
 for(const [request,status,steps] of [['/goose 논문 근거로 매수·매도 규칙 설계','ready',['strategy']],['/goose 매도 신호 규칙을 백테스트','ready',['backtest']],['/goose 매수 시점 분석 보고서','ready',['report']],['/goose 삼성전자 실적 분석 보고서','ready',['analyze','report']]] as const){
  const p=planGooseRequest(request);assert.equal(p.status,status,request);assert.deepEqual(p.steps.map(s=>s.id),steps,request);
 }
});

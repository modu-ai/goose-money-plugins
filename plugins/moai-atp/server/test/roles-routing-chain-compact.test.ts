// SPEC-ATP-ROLES-001 (card t35, Class C fix 3): three safety-direction holes of the pattern-based Goose planner.
//   hole 1  explicit sell + buy connective chain (`팔고 ... 사서`) with no object particle or quantity
//   hole 2  a quantity / code evidenced `사고` / `팔고` chain that another sell / buy stem used to suppress
//   hole 3  quantity + unit fused to the command word (`10주사줘`) with no space
// Synthetic request strings only. This file documents the measured range of a pattern-based planner; it does NOT claim completeness.
import test from 'node:test';import assert from 'node:assert/strict';
import {planGooseRequest,GOOSE_SENTENCE_F} from '../src/goose-routing.js';

function assertBlockedOrder(request:string){
 const p=planGooseRequest(request);
 assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('orders_or_transfers'),request);assert.deepEqual(p.steps,[],request);
 assert.equal(p.clarification,GOOSE_SENTENCE_F,request);assert.equal(p.provider_dispatches,0,request);assert.equal(p.execution_authority,'plan_only',request);
}
function assertNoOrderCode(request:string){
 const p=planGooseRequest(request);
 assert.ok(!p.blocked_actions.includes('orders_or_transfers'),`${request} -> ${JSON.stringify(p.blocked_actions)}`);assert.ok(!p.unsupported_actions.includes('ats_scope_unsupported'),request);
}

// Hole 1: the leader's reproduced sentence ran `ready` with steps. A sell connective and a buy connective in one sentence is a rebalance command.
const SELL_BUY_CHAIN=[
 '/goose 삼성전자 팔고 SK하이닉스 사서 비교 보고서','/goose 삼성전자 팔아서 SK하이닉스 사서 비교 보고서','/goose SK하이닉스 사서 삼성전자 팔고 비교 보고서','/goose 삼성전자 사고 SK하이닉스 팔고 비교 분석 보고서',
 '/goose 삼성전자 팔고 현대차 사서 비교 분석',
 // An explicit mode word, punctuation between the words and a sell-first order do not change the verdict.
 '/goose report 삼성전자 팔고 SK하이닉스 사서 비교','/goose strategy 삼성전자 팔고 SK하이닉스 사서 설명','/goose 삼성전자 팔고, SK하이닉스 사서 비교 보고서','/goose 삼성전자 팔고_SK하이닉스 사서 비교 보고서',
] as const;
// Near misses that must not be read as a sell + buy chain: a lone `사서`, a wish / state of `팔고`, a described method.
const SELL_BUY_CHAIN_NEAR_MISS=[
 '/goose 사서 교사 채용 현황 분석 보고서','/goose 사서 선생님 인터뷰 분석 보고서','/goose 삼성전자 팔고 싶은 이유 분석 보고서','/goose 책을 팔고 있는 서점 분석 보고서','/goose 삼성전자 팔고 SK하이닉스 사서 비교하는 방법 설명',
  // previous-round controls stay as they were
 '/goose 금융 사고 사례 분석 보고서','/goose 기업 조사 주세요','/goose 연사 주세요','/goose 배당주를 사고 파는 전략 백테스트','/goose 주식을 사고팔 때 세금 분석',
] as const;
for(const request of SELL_BUY_CHAIN)test(`fix 3 hole 1: sell + buy connective chain is blocked with F, no steps: ${request}`,()=>assertBlockedOrder(request));
for(const request of SELL_BUY_CHAIN_NEAR_MISS)test(`fix 3 hole 1 control: near miss is NOT an order: ${request}`,()=>assertNoOrderCode(request));

// Hole 2: `사고` / `팔고` with quantity, code or object-particle evidence was suppressed whenever a sell stem (`팔`, `파`) followed it, which let `10주 사고 팔고` through.
// Only the descriptive continuations (`사고 파는`, `사고 팔 때`) stay suppressed; a connective or imperative sell stem (`팔고`, `팔아`, `팔아서`) after a buy is a chain of orders.
const EVIDENCED_CHAIN=[
 '/goose 삼성전자 10주 사고 팔고 보고서','/goose 005930 사고 팔고 비교 분석 보고서','/goose 삼성전자를 사고 팔고 보고서','/goose 삼성전자 10주 사고팔고 보고서','/goose 삼성전자 10주 사고 팔아 보고서','/goose 삼성전자 10주 사고 팔아서 보고서',
 // Another sell / buy stem before and after the evidenced one, an explicit mode word, a sell-first chain.
 '/goose 삼성전자 팔고 SK하이닉스 10주 사고 팔고 보고서','/goose 삼성전자 10주 팔고 10주 사고 팔고 보고서','/goose report 삼성전자 10주 사고 팔고 비교','/goose 삼성전자 10주 팔고 사고 보고서','/goose 삼성전자 10주 사고 SK하이닉스 5주 팔고 보고서',
] as const;
const EVIDENCED_CHAIN_NEAR_MISS=[
 '/goose 10주 사고 싶은 종목 분석','/goose 삼성전자를 사고 파는 시점 분석 보고서','/goose 10주 사고 팔 때 세금 분석','/goose 삼성전자 10주 사고 팔 수 있는지 분석','/goose 10주 사고 있는 종목 분석 보고서',
 '/goose 삼성전자를 사고 파는 전략 백테스트','/goose 사고 원인 분석 보고서','/goose 주식을 사고팔 때 세금 분석',
] as const;
for(const request of EVIDENCED_CHAIN)test(`fix 3 hole 2: evidenced buy / sell chain is blocked with F, no steps: ${request}`,()=>assertBlockedOrder(request));
for(const request of EVIDENCED_CHAIN_NEAR_MISS)test(`fix 3 hole 2 control: descriptive continuation is NOT an order: ${request}`,()=>assertNoOrderCode(request));

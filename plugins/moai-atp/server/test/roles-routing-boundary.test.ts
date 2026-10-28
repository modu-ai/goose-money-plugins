// SPEC-ATP-ROLES-001 (card t35, Class C fix 2) defect 3: word-boundary and negation over-blocks.
//  (a) a one-syllable buy / sell verb stem (사, 팔) is not a verb when it is the tail of a longer word (조사, 연사);
//  (b) an explicit negation next to an account form (`계좌 없이`) is not account access;
//  (c) the public-fund-holdings exemption (`ETF 보유 종목`) holds only while user-owned forms (`내 ETF 보유 종목`) are still account access.
// Synthetic request strings only. This file documents the measured range of a pattern-based planner. It does NOT claim completeness.
import test from 'node:test';import assert from 'node:assert/strict';
import {planGooseRequest,GOOSE_SENTENCE_F,GOOSE_SENTENCE_ACCOUNT} from '../src/goose-routing.js';

// (a) Not an order: the stem is part of a longer word.
const NOT_ORDER=[
 '/goose 기업 조사 주세요','/goose 시장 조사 줘','/goose 연사 주세요','/goose 업종 조사 달라고 요청','/goose 기업 조사 주세요 실적 분석 보고서','/goose 매수자 분석 보고서','/goose 매도자 동향 분석 보고서',
 '/goose 10주 사라진 종목 분석','/goose 3주 사라지는 종목 분석 보고서','/goose 기업조사 주세요','/goose 현장 조사 주라',
] as const;
// Still an order: the stem is its own word (or follows a digit / code), even when spaced or punctuated.
const STILL_ORDER=[
 '/goose 삼성전자 사줘','/goose 삼성전자 사 줘','/goose 삼성전자 사_줘','/goose 삼 성 전 자 사 줘','/goose 삼성전자 사 주세요','/goose 005930 사줘','/goose 10주 사줘','/goose 삼성전자 팔아줘','/goose 삼성전자 팔아 줘',
 '/goose 삼성전자 10주 팔아','/goose 삼성전자 10주 사라','/goose 삼성전자 3주만 사','/goose 삼성전자 팔아 주세요','/goose 삼성전자 사줘 실적 분석 보고서','/goose 실적 분석 보고서 만들고 삼성전자 사줘',
] as const;
// (b) A negated account form is not account access.
const NEGATED_ACCOUNT=[
 '/goose 계좌 없이 기업 실적 분석','/goose 계좌를 연결하지 않고 기업 실적 분석','/goose 계좌 말고 기업 실적 분석','/goose 계좌 제외 기업 실적 분석','/goose 계좌 연결 없이 삼성전자 실적 분석',
 '/goose 계좌 조회 없이 삼성전자 실적 분석 보고서','/goose 계좌 정보 없이 ETF 비교 분석','/goose 내 계좌 말고 삼성전자 실적 분석','/goose 계좌를 사용하지 않고 삼성전자 실적 분석','/goose 계좌는 필요 없고 삼성전자 실적 분석',
 '/goose 계좌를 제외하고 삼성전자 실적 분석',
] as const;
// A negation does not rescue a request that still asks for holdings, balance or deposit data.
const ACCOUNT_STILL=[
 '/goose 계좌 보유 종목 수익률','/goose 내 계좌 잔고','/goose 예수금 조회','/goose 계좌 없이 내 잔고 조회','/goose 계좌 조회','/goose 내 계좌 분석해줘','/goose 계좌 말고 예수금 조회해줘','/goose 내 계좌 수익률 알려줘',
 '/goose 계좌 보유 종목 보여줘','/goose 계좌 없이는 안 되니 내 계좌 잔고 알려줘',
] as const;
// (c) User-owned fund holdings are account access (the exemption must not hide them).
const OWNED_FUND=[
 '/goose 내 ETF 보유 종목','/goose 제 ETF 보유 종목','/goose 내가 가진 ETF','/goose 내 ETF 보유 종목 수익률 알려줘','/goose 내가 보유한 ETF 종목','/goose 제가 가진 펀드','/goose 내가 들고 있는 ETF',
 '/goose 내 펀드 보유 종목','/goose 내가 보유한 종목 보여줘','/goose 내 ETF 보유','/goose 우리 리츠 보유 종목',
] as const;
// Public holdings of a fund are not the user's account.
const PUBLIC_FUND=[
 '/goose ETF 보유 종목 분석','/goose KODEX 200 ETF 구성 보유 종목 비교','/goose 펀드 보유 종목 분석 보고서','/goose 리츠 보유 종목 점검','/goose 지수 보유 종목 비교 분석','/goose ETF의 보유 종목 분석',
] as const;

for(const request of NOT_ORDER)test(`defect 3a: a verb stem inside a longer word is not an order: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.notEqual(p.status,'blocked',request);assert.deepEqual(p.blocked_actions,[],request);assert.notEqual(p.clarification,GOOSE_SENTENCE_F,request);
});
for(const request of STILL_ORDER)test(`defect 3a control: a stand-alone buy / sell verb stem is still an order: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('orders_or_transfers'),request);assert.deepEqual(p.steps,[],request);assert.equal(p.clarification,GOOSE_SENTENCE_F,request);
});
for(const request of NEGATED_ACCOUNT)test(`defect 3b: an explicitly negated account form is not account access: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.notEqual(p.status,'blocked',request);assert.ok(!p.blocked_actions.includes('account_access'),request);assert.notEqual(p.clarification,GOOSE_SENTENCE_ACCOUNT,request);
 assert.ok(p.steps.length>0,request);assert.equal(p.status,'ready',request);
});
for(const request of ACCOUNT_STILL)test(`defect 3b control: holdings / balance / deposit / account data requests stay account_access: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('account_access'),request);assert.deepEqual(p.steps,[],request);assert.equal(p.clarification,GOOSE_SENTENCE_ACCOUNT,request);
});
for(const request of OWNED_FUND)test(`defect 3c: user-owned fund holdings are account access (the ETF exemption must not hide them): ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('account_access'),request);assert.deepEqual(p.steps,[],request);assert.equal(p.clarification,GOOSE_SENTENCE_ACCOUNT,request);
});
for(const request of PUBLIC_FUND)test(`defect 3c control: public fund holdings analysis is not account access: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.notEqual(p.status,'blocked',request);assert.deepEqual(p.blocked_actions,[],request);
});

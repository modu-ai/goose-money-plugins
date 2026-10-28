// SPEC-ATP-ROLES-001 (card t35, Class C fix 2) defect 2: running / operating / executing an automated or autonomous
// trading system or agent team, and `실제 매매 실행`. Run-now phrasing is a trade-execution request (blocked,
// orders_or_transfers); build / keep-running phrasing is an ATS-class request (unsupported, ats_scope_unsupported);
// when both match, blocked wins (design.md 3.5). Synthetic request strings only.
// This file documents the measured range of a pattern-based planner. It does NOT claim completeness.
import test from 'node:test';import assert from 'node:assert/strict';
import {planGooseRequest,GOOSE_SENTENCE_F} from '../src/goose-routing.js';

const RUN_BLOCKED=[
 '/goose 자동매매 시스템 실행해줘 논문 전략 보고서','/goose 실제 매매 실행해줘','/goose CrewAI로 자율매매 에이전트 팀 돌려줘','/goose 자동매매 시스템 돌려줘','/goose 자동매매 프로그램 가동해줘',
 '/goose 자동매매 봇 실행해','/goose 자율매매 에이전트 시작해줘','/goose 알고리즘 매매 시스템 실행해줘 백테스트 보고서','/goose 실전 매매 실행해줘 전략 설계','/goose 실제 거래 진행해줘',
 '/goose run the automated trading system now','/goose start autonomous trading','/goose 실제 매매 실행','/goose 논문 전략 설계하고 자동매매 시스템 실행해줘','/goose strategy 자동매매 시스템 실행해줘',
 '/goose 자동 매매 시스템 실행 해 줘',
] as const;
const OPERATE_UNSUPPORTED=[
 '/goose 자동매매 시스템 운영해줘','/goose 자동매매 시스템 24시간 운영해줘','/goose 자율매매 에이전트 팀 상시 운영해줘','/goose 자동매매 시스템 배포해줘','/goose 자동매매 시스템 구축해줘 논문 전략 보고서',
] as const;
const BOTH=['/goose 자동매매 시스템 구축하고 실제 매매 실행해줘','/goose 자동매매 시스템 구축하고 자동매매 시스템 실행해줘'] as const;
const NOT_BLOCKED=[
 '/goose 자동매매 시스템이란 무엇인가요','/goose 자동매매 시스템 실행 구조를 설명해줘','/goose 자동매매 시스템 실행 비용 분석 보고서','/goose 실제 매매 실행 결과 분석 보고서','/goose 실제 매매와 모의 매매 차이 설명',
 '/goose 자율매매 에이전트 팀이 뭔가요','/goose 실전 매매 심리 분석','/goose 알고리즘 매매 개념 정리','/goose 자동매매 시스템 사례 보고서','/goose 실제 거래 비용 분석 보고서',
 '/goose 퀀트 엔진이란 무엇인가요','/goose 팀 에이전트가 뭔가요',
] as const;

for(const request of RUN_BLOCKED)test(`defect 2: running an automated / autonomous trading system or real trading is blocked with F, no steps: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('orders_or_transfers'),request);assert.deepEqual(p.steps,[],request);
 assert.equal(p.provider_dispatches,0);assert.equal(p.clarification,GOOSE_SENTENCE_F,request);
});
for(const request of OPERATE_UNSUPPORTED)test(`defect 2: operating / building an ATS-class system is unsupported with ats_scope_unsupported, F, no steps: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.equal(p.status,'unsupported',request);assert.deepEqual(p.unsupported_actions,['ats_scope_unsupported'],request);assert.deepEqual(p.blocked_actions,[],request);
 assert.deepEqual(p.steps,[],request);assert.equal(p.provider_dispatches,0);assert.equal(p.clarification,GOOSE_SENTENCE_F,request);
});
for(const request of BOTH)test(`defect 2: when both a run command and an ATS-class form match, blocked wins and both arrays list their codes: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.equal(p.status,'blocked',request);assert.deepEqual(p.blocked_actions,['orders_or_transfers'],request);assert.deepEqual(p.unsupported_actions,['ats_scope_unsupported'],request);
 assert.deepEqual(p.steps,[],request);assert.equal(p.provider_dispatches,0);assert.equal(p.clarification,GOOSE_SENTENCE_F,request);
});
for(const request of NOT_BLOCKED)test(`defect 2 control: explanation / concept / analysis wording stays NOT an execution request: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.notEqual(p.status,'blocked',request);assert.notEqual(p.status,'unsupported',request);assert.deepEqual(p.blocked_actions,[],request);assert.deepEqual(p.unsupported_actions,[],request);
});

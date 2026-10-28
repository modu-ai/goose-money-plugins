// SPEC-ATP-ROLES-001 (card t35, Class C fix 2) defect 4: positive / negative phrase table for the Goose planner.
//
// WHAT THIS TABLE IS
//   It documents the MEASURED RANGE of a pattern-based planner: sentences the planner was observed to classify (positives)
//   and near-miss sentences it was observed to leave alone (negatives), per category. It does NOT claim completeness.
//   A sentence that is absent from the table is simply unmeasured; a paraphrase, a split-up spelling, a typo or a word the
//   lexicon does not know can still pass. The zero-step plan and the absence of any order tool (design.md 5) are the
//   last line of defence, not this table.
// HOW TO READ IT
//   - positive: the planner must classify the sentence into the category (status, reason code, fixed sentence, zero steps).
//   - negative: a near miss that must NOT be classified into the category. The check is on that category's own reason
//     code only; a negative may still be flagged by ANOTHER category (for example `계좌 변경 사례 분석` is account access
//     but not an order), and the rows say so in their comment.
//   - Known unclassified gaps are listed at the end as observations only (no status is asserted for them).
// All sentences are synthetic. No real account, quote or credential appears here.
import test from 'node:test';import assert from 'node:assert/strict';
import {planGooseRequest,GOOSE_SENTENCE_F,GOOSE_SENTENCE_F_T,GOOSE_SENTENCE_ACCOUNT,GOOSE_SENTENCE_PERFORMANCE} from '../src/goose-routing.js';

type Category='trade'|'transfer'|'account_change'|'ats_class'|'account_holdings'|'performance';
interface Rows{readonly positive:readonly string[];readonly negative:readonly string[]}

const TABLE:Record<Category,Rows>={
 // Trade execution: an order, cancellation, reservation, automated / real trading run, hand-off to execute, buy / sell command (also connective: 매수하고).
 trade:{
  positive:[
   '/goose 삼성전자 매수해','/goose 삼성전자 사줘','/goose 삼성전자 팔아줘','/goose 지금 매수 주문해줘','/goose buy 005930 now','/goose 주문 취소해줘','/goose 매도 예약 걸어줘',
   '/goose 매일 아침 자동으로 매매해줘','/goose 전략을 ATS로 보내서 실행해','/goose 삼성전자 10주 매수하고 실적 분석 보고서','/goose 삼성전자 매도하고 실적 분석 보고서','/goose 주문하고 보고서',
   '/goose 실제 매매 실행해줘','/goose 자동매매 시스템 실행해줘 논문 전략 보고서','/goose CrewAI로 자율매매 에이전트 팀 돌려줘','/goose 삼성전자 10주 사고 알려줘','/goose 삼성전자 매수해 그리고 실적 분석 보고서',
   '/goose 삼 성 전 자 사 줘','/goose 삼성전자 사_줘','/goose 백테스트 결과대로 실제 주문 넣어',
  ],
  negative:[
   '/goose 기업 조사 주세요','/goose 연사 주세요','/goose 논문 근거로 매수·매도 규칙 설계','/goose 매도 신호 규칙을 백테스트','/goose 매수 시점 분석 보고서','/goose 삼성전자 실적 분석 보고서',
   '/goose 매수 해석 보고서','/goose 주문 체결 구조 설명해줘','/goose 금융 사고 사례 분석 보고서','/goose 사고 원인 분석 보고서','/goose 매수하고 싶은 종목 분석','/goose 매수하고 매도하는 규칙 설계',
   '/goose 삼성전자 매수해야 할까요 실적 분석','/goose 자동매매 시스템 실행 비용 분석 보고서','/goose 실제 매매 실행 결과 분석 보고서','/goose ATS가 무엇인가요','/goose strategy 손절 규칙 정리','/goose 매수자 분석 보고서',
   '/goose 10주 사라진 종목 분석','/goose 매수 후 6개월 수익률 분석',
  ],
 },
 // Transfer / deposit / withdrawal command (fixed sentence F_T, no ATS wording).
 transfer:{
  positive:[
   '/goose 송금 실행해','/goose 100만원 이체해줘','/goose 예수금 출금해줘','/goose 이체하고 종목 분석 보고서','/goose 송금하고 보고서','/goose 입금하고 보고서','/goose 출금하고 분석 보고서',
   '/goose 이체 하고 종목 분석','/goose 송금해서 보고서','/goose transfer 1000000 won to my bank','/goose withdraw my money',
  ],
  negative:[
   '/goose 이체 비용이 수익률에 미치는 영향 분석','/goose 이체 수수료 구조를 설명해줘','/goose 송금하고 싶을 때 수수료 비교 분석','/goose 입금 내역 분석 보고서','/goose 이체 한도 개념 정리',
   '/goose 해외 송금 시장 규모 보고서','/goose 환전 수수료 비교 분석','/goose 출금 정책 변화 분석 보고서','/goose 삼성전자 실적 분석 보고서','/goose 논문 근거로 매수·매도 규칙 설계',
  ],
 },
 // Account-change command (개설, 해지, 비밀번호 변경, 한도 상향 ...). Excluded by spec 0.2.0; same orders_or_transfers code, fixed sentence F.
 account_change:{
  positive:[
   '/goose 계좌 개설해줘','/goose 계좌 해지해줘','/goose 계좌 비밀번호 변경해줘','/goose 계좌 명의 변경 부탁드립니다','/goose 계좌 폐쇄해 주세요','/goose 계좌 등록해줘','/goose 거래 한도 올려줘','/goose 계좌 개설하고 보고서',
   '/goose 이체 한도 올려줘',
  ],
  negative:[
   // These contain `계좌` and are account access (account_holdings category), but they are not account-change commands.
   '/goose 계좌 변경 사례 분석 보고서','/goose 계좌 해지 절차 설명','/goose 계좌 개설 요건 정리','/goose 계좌 없이 기업 실적 분석',
   // These carry no account form at all.
   '/goose 한도 개념 설명','/goose 거래 한도 제도 변화 분석 보고서','/goose 증권사 비교 분석 보고서','/goose 삼성전자 실적 분석 보고서','/goose 논문 근거로 전략 설계',
  ],
 },
 // ATS-class: build, install or keep running an automated-trading system, trading bot, quant engine or agent team (unsupported, ats_scope_unsupported, F).
 ats_class:{
  positive:[
   '/goose 자동매매 시스템 구축해줘','/goose 24시간 돌아가는 매매 봇 만들어','/goose 퀀트 시스템트레이딩 엔진 만들어줘','/goose 논문 근거로 퀀트 엔진 만들어줘','/goose 팀 에이전트 상시 실행해줘',
   '/goose CrewAI로 트레이딩 팀 구성해','/goose 자동매매 시스템 운영해줘','/goose 자율매매 에이전트 팀 상시 운영해줘','/goose 자동매매 시스템 구축해줘 논문 전략 보고서','/goose 자동매매 시스템 배포해줘',
   '/goose build an automated trading system','/goose 주식 봇 개발해줘',
  ],
  negative:[
   '/goose ATS가 무엇인가요','/goose 퀀트 엔진이란 무엇인가요','/goose 자동매매 시스템이란 무엇인가요','/goose 팀 에이전트가 뭔가요','/goose 자동매매 시스템 실행 구조를 설명해줘','/goose 퀀트 엔진 성능 설명 팀 에이전트 비교 개념 정리',
   '/goose 알고리즘 매매 개념 정리','/goose 자율매매 에이전트 팀이 뭔가요','/goose 자동매매 시스템 사례 보고서','/goose 논문 근거로 전략 설계',
  ],
 },
 // Account holdings / balance / deposit / account returns (blocked, account_access, account sentence). A negated account form is NOT account access.
 account_holdings:{
  positive:[
   '/goose 내 계좌 보유 종목 보여줘','/goose 보유 종목 현황','/goose 잔고 조회','/goose 예수금 조회','/goose 내 계좌 수익률 알려줘','/goose 계좌 보유 종목 수익률','/goose 내 계좌 잔고','/goose 내 계좌 분석해줘',
   '/goose 내 ETF 보유 종목','/goose 제 ETF 보유 종목','/goose 내가 가진 ETF','/goose 내가 보유한 종목 보여줘','/goose 계좌 없이 내 잔고 조회','/goose my account balance',
  ],
  negative:[
   '/goose 계좌 없이 기업 실적 분석','/goose 계좌를 연결하지 않고 기업 실적 분석','/goose 계좌 말고 기업 실적 분석','/goose 계좌 제외 기업 실적 분석','/goose ETF 보유 종목 분석','/goose KODEX 200 ETF 구성 보유 종목 비교',
   '/goose 펀드 보유 종목 분석 보고서','/goose 리츠 보유 종목 점검','/goose 삼성전자 실적 분석 보고서','/goose 기업 조사 주세요',
  ],
 },
 // Performance: the user's own return / performance with no price, quantity or ledger input (unsupported, performance_inputs_missing, performance sentence).
 performance:{
  positive:[
   '/goose 내 수익률 알려줘','/goose 내 포트폴리오 성과 분석','/goose 내 포트폴리오 성과 분석 보고서','/goose 제 수익 알려줘','/goose 포트폴리오 수익률 알려줘','/goose 우리 투자 성과 알려줘','/goose my portfolio returns',
   '/goose 내 손익 알려줘','/goose 나의 성과 분석',
  ],
  negative:[
   '/goose 논문 전략 백테스트 성과 보고서','/goose 삼성전자 수익률 비교 분석','/goose 내 수익률 매입가 70000원 10주 기준','/goose 삼성전자 실적 분석 보고서','/goose 백테스트 성과 지표 설명','/goose 수익률 계산 방법 설명',
   '/goose KOSPI 수익률 분석 보고서','/goose 내 수익률 1,200,000원 기준 분석','/goose 내 전략 백테스트 성과',
  ],
 },
};

const EXPECT:Record<Category,(request:string)=>void>={
 trade:request=>{const p=planGooseRequest(request);assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('orders_or_transfers'),request);assert.equal(p.clarification,GOOSE_SENTENCE_F,request);},
 transfer:request=>{const p=planGooseRequest(request);assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('orders_or_transfers'),request);assert.equal(p.clarification,GOOSE_SENTENCE_F_T,request);},
 account_change:request=>{const p=planGooseRequest(request);assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('orders_or_transfers'),request);assert.equal(p.clarification,GOOSE_SENTENCE_F,request);},
 ats_class:request=>{const p=planGooseRequest(request);assert.equal(p.status,'unsupported',request);assert.deepEqual(p.unsupported_actions,['ats_scope_unsupported'],request);assert.deepEqual(p.blocked_actions,[],request);assert.equal(p.clarification,GOOSE_SENTENCE_F,request);},
 account_holdings:request=>{const p=planGooseRequest(request);assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('account_access'),request);assert.equal(p.clarification,GOOSE_SENTENCE_ACCOUNT,request);},
 performance:request=>{const p=planGooseRequest(request);assert.equal(p.status,'unsupported',request);assert.ok(p.unsupported_actions.includes('performance_inputs_missing'),request);assert.equal(p.clarification,GOOSE_SENTENCE_PERFORMANCE,request);},
};
const OWN_CODE:Record<Category,{list:'blocked_actions'|'unsupported_actions';code:string}>={
 trade:{list:'blocked_actions',code:'orders_or_transfers'},transfer:{list:'blocked_actions',code:'orders_or_transfers'},account_change:{list:'blocked_actions',code:'orders_or_transfers'},
 ats_class:{list:'unsupported_actions',code:'ats_scope_unsupported'},account_holdings:{list:'blocked_actions',code:'account_access'},performance:{list:'unsupported_actions',code:'performance_inputs_missing'},
};

test('table size: every category has at least 8 positives and 8 negatives',()=>{
 for(const [category,rows] of Object.entries(TABLE)){assert.ok(rows.positive.length>=8,`${category} positives`);assert.ok(rows.negative.length>=8,`${category} negatives`);}
});
test('table rows are unique inside each list and every row is a /goose request',()=>{
 for(const [category,rows] of Object.entries(TABLE))for(const list of [rows.positive,rows.negative]){assert.equal(new Set(list).size,list.length,`${category} duplicate row`);for(const request of list)assert.ok(request.startsWith('/goose '),request);}
});

for(const [category,rows] of Object.entries(TABLE) as [Category,Rows][]){
 for(const request of rows.positive)test(`phrase table [${category}] positive is classified, zero steps, no dispatch: ${request}`,()=>{
  EXPECT[category](request);const p=planGooseRequest(request);assert.deepEqual(p.steps,[],request);assert.equal(p.provider_dispatches,0);assert.equal(p.execution_authority,'plan_only');
 });
 for(const request of rows.negative)test(`phrase table [${category}] negative is NOT classified into ${OWN_CODE[category].code}: ${request}`,()=>{
  const p=planGooseRequest(request);const own=OWN_CODE[category];assert.ok(!p[own.list].includes(own.code),`${request} -> ${JSON.stringify(p[own.list])}`);
 });
}

// Dash legacy forms: the H3 block precedes migration (REQ-ENT-003). A trade word mixed into `goose-<mode>` / `/goose goose-<mode>` leaves the request un-migrated.
for(const [request,sentence] of [
 ['goose-strategy 삼성전자 사줘',GOOSE_SENTENCE_F],['/goose goose-backtest 삼성전자 매수해',GOOSE_SENTENCE_F],['goose-backtest 삼성전자 10주 매수하고 보고서',GOOSE_SENTENCE_F],['goose-strategy 이체해줘',GOOSE_SENTENCE_F_T],
 ['/goose goose-report 삼성전자 주문 넣어',GOOSE_SENTENCE_F],['/goose goose-strategy 삼성전자 팔아줘',GOOSE_SENTENCE_F],['goose-backtest 실제 매매 실행해줘',GOOSE_SENTENCE_F],
 // The slash form already did this before this fix (kept as a control).
 ['/goose-strategy 삼성전자 사줘',GOOSE_SENTENCE_F],['/goose-backtest 주문해줘',GOOSE_SENTENCE_F],
] as const)test(`dash legacy form with a trade word is blocked, not migrated, no steps, fixed sentence: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.equal(p.status,'blocked',request);assert.equal(p.migrated_legacy_command,false,request);assert.equal(p.explicit_mode,null,request);assert.deepEqual(p.steps,[],request);
 assert.ok(p.blocked_actions.includes('orders_or_transfers'),request);assert.equal(p.clarification,sentence,request);assert.equal(p.provider_dispatches,0);
});
for(const [request,mode] of [['goose-strategy 논문으로 설계','strategy'],['/goose goose-backtest 과거 검증','backtest'],['goose-backtest 과거 검증','backtest'],['goose-report 삼성전자 실적 분석 보고서','report']] as const)test(`dash legacy form without a trade word still migrates to its non-trading mode: ${request}`,()=>{
 const p=planGooseRequest(request);assert.equal(p.status,'ready',request);assert.equal(p.migrated_legacy_command,true,request);assert.equal(p.explicit_mode,mode,request);assert.ok(p.steps.some(s=>s.id===mode),request);assert.deepEqual(p.blocked_actions,[]);
});

// Known unclassified gaps (OBSERVATIONS ONLY, no status asserted). The planner is pattern-based; these were measured and deliberately not forced:
//   - `/goose 삼성전자 사고 실적 분석 보고서`  bare-name `사고`: homograph of the noun "accident" (사고 원인 분석), no object evidence (quantity, code, particle).
//   - `/goose 삼성전자사줘`                    no space before the one-syllable stem `사`: indistinguishable from `기업조사주세요` without a word list.
//   - `/goose 삼성전자 매수하고자 합니다`      `하고자` (intend to) is treated as a wish, not a command.
//   - `/goose 삼성전자 매수한 뒤 보고서`        past-tense connective (`한 뒤`, `한 후`) is not a form; `매수 후 6개월 수익률 분석` is a legitimate analysis request.
//   - paraphrases, split-up spellings and typos that the lexicon does not know.
// The planner must still return a well-formed zero-dispatch plan for them.
test('known unclassified gaps still return a well-formed plan with zero dispatches (observation only, status not asserted)',()=>{
 for(const request of ['/goose 삼성전자 사고 실적 분석 보고서','/goose 삼성전자사줘','/goose 삼성전자 매수하고자 합니다','/goose 삼성전자 매수한 뒤 보고서']){
  const p=planGooseRequest(request);assert.equal(p.provider_dispatches,0,request);assert.equal(p.execution_authority,'plan_only',request);assert.equal(p.contract,'moai.goose.workflow-plan.v1');
 }
});

// SPEC-ATP-ROLES-001 M1 (card t35): planner classification of trade-execution, ATS-class, account and
// performance requests, fixed sentences F / F_T, step clearing, and the slash legacy form `/goose-<mode>`.
// Synthetic request strings only. The planner is a pure local function: no network, no credentials, no dispatch.
import test from 'node:test';import assert from 'node:assert/strict';
import * as routing from '../src/goose-routing.js';import {dispatchGooseCommand} from '../src/cli.js';
const {planGooseRequest,GOOSE_MODES}=routing;
type Form={readonly id:string;readonly pattern:RegExp};
// Namespace access keeps this file compiling before the M1 exports exist (RED = assertion failures, not a broken build).
const R=routing as unknown as {GOOSE_SENTENCE_F?:string;GOOSE_SENTENCE_F_T?:string;GOOSE_SENTENCE_ACCOUNT?:string;GOOSE_SENTENCE_PERFORMANCE?:string;GOOSE_TRADE_FORMS?:readonly Form[];GOOSE_ATS_FORMS?:readonly Form[];matchGooseForms?:(forms:readonly Form[],text:string)=>string[]};

// Full sentences pinned verbatim (design.md 3.2 / 3.5). The pieces below are the SPEC-required parts.
const F='이 플러그인은 지원하지 않으며 별도 시스템(ATS)의 영역입니다. 대신 전략 수립(매매 전략 명세로 정리)이나 백테스트(과거 자료 검증 계획)는 다시 요청해 주시면 도와드릴 수 있습니다. 실거래는 사용자께서 직접 판단·실행하십시오.';
const F_T='이 플러그인은 이체·입출금을 지원하지 않습니다. 자금 이동은 사용자께서 직접 하십시오.';
const ACCOUNT='읽기 전용 보유·계좌 수익률 조회는 아직 제공하지 않습니다(별도 승인 뒤 제공 예정)';
const PERFORMANCE='수익률·성과를 계산할 입력(매입가 또는 자산곡선, 기간, 통화, 입출금 흐름)이 없어 계산할 수 없습니다';
const PLAN_KEYS=['blocked_actions','clarification','contract','execution_authority','explicit_mode','host_registration','migrated_legacy_command','provider_dispatches','raw_request_retained','report_id','status','steps','unsupported_actions'];

const TRADE_F=[
 '/goose 삼성전자 매수해','/goose 삼성전자 사줘','/goose 삼성전자 10주 사줘','/goose 삼성전자 팔아줘','/goose buy 005930 now','/goose sell 005930',
 '/goose 매도 예약 걸어줘','/goose 매일 아침 자동으로 매매해줘','/goose 전략을 ATS로 보내서 실행해','/goose 예약 주문 자동화해줘','/goose 지금 매수 주문해줘',
 '/goose 주문 취소해줘','/goose 백테스트 결과대로 실제 주문 넣어','/trade 삼성전자 매수해','/전략가 삼성전자 매수해',
] as const;
const TRADE_FT=['/goose 송금 실행해','/goose 100만원 이체해줘','/goose 예수금 출금해줘'] as const;
const ATS_F=[
 '/goose 자동매매 시스템 구축해줘','/goose 24시간 돌아가는 매매 봇 만들어','/goose 퀀트 시스템트레이딩 엔진 만들어줘','/goose 논문 근거로 퀀트 엔진 만들어줘',
 '/goose 팀 에이전트 상시 실행해줘','/goose CrewAI로 트레이딩 팀 구성해',
] as const;
const ACCOUNT_REQUESTS=['/goose 내 계좌 보유 종목 보여줘','/goose 보유 종목 현황','/goose 잔고 조회','/goose 예수금 조회','/goose 내 계좌 수익률 알려줘'] as const;
const PERFORMANCE_REQUESTS=['/goose 내 수익률 알려줘','/goose 내 포트폴리오 성과 분석','/goose 내 포트폴리오 성과 분석 보고서'] as const;
const CONTROLS=[
 ['/goose 논문 근거로 매수·매도 규칙 설계','ready',['strategy']],['/goose 매도 신호 규칙을 백테스트','ready',['backtest']],['/goose 삼성전자 실적 분석 보고서','ready',['analyze','report']],
 ['/goose strategy 손절 규칙 정리','ready',['strategy']],['/goose ATS가 무엇인가요','clarification_required',[]],
] as const;

function noRawRequest(p:object,request:string){assert.ok(!JSON.stringify(p).includes(request.replace(/^\/goose\s+/,'')),'plan must not echo the request');}
function assertBlockedTrade(request:string,sentence:string){
 const p=planGooseRequest(request);
 assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('orders_or_transfers'),request);
 assert.deepEqual(p.steps,[],request);assert.equal(p.provider_dispatches,0);assert.equal(p.clarification,sentence,request);
 assert.equal(p.execution_authority,'plan_only');
}

test('plan object keeps exactly the moai.goose.workflow-plan.v1 key set',()=>{
 for(const request of ['/goose 삼성전자 사줘','/goose 자동매매 시스템 구축해줘','/goose 내 수익률 알려줘','/goose 논문 근거로 전략 설계','도와줘']){const p=planGooseRequest(request);assert.deepEqual(Object.keys(p).sort(),PLAN_KEYS,request);assert.equal(p.contract,'moai.goose.workflow-plan.v1');}
});

test('fixed sentences F and F_T: required pieces are included and the full sentences are pinned (design 3.2)',()=>{
 assert.equal(R.GOOSE_SENTENCE_F,F);assert.equal(R.GOOSE_SENTENCE_F_T,F_T);assert.equal(R.GOOSE_SENTENCE_ACCOUNT,ACCOUNT);assert.equal(R.GOOSE_SENTENCE_PERFORMANCE,PERFORMANCE);
 const f=R.GOOSE_SENTENCE_F??'';
 assert.ok(f.includes('이 플러그인은 지원하지 않으며 별도 시스템(ATS)의 영역입니다'),'F piece 1');
 assert.ok(f.includes('전략 수립(매매 전략 명세로 정리)'),'F piece 2');
 assert.ok(f.includes('백테스트(과거 자료 검증 계획)'),'F piece 3');
 assert.ok(f.includes('실거래는 사용자께서 직접 판단·실행하십시오'),'F piece 4');
 const t=R.GOOSE_SENTENCE_F_T??'';
 assert.ok(t.includes('이 플러그인은 이체·입출금을 지원하지 않습니다'),'F_T piece 1');assert.ok(t.includes('자금 이동은 사용자께서 직접 하십시오'),'F_T piece 2');
 assert.ok(!t.includes('ATS'),'F_T must not name ATS');assert.ok(!/전략|백테스트/.test(t),'F_T gives no strategy/backtest alternative');
});

for(const request of TRADE_F)test(`AC-004 trade-execution request is blocked with F, no steps, no dispatch: ${request}`,()=>{
 assertBlockedTrade(request,F);const p=planGooseRequest(request);assert.deepEqual(p.blocked_actions,['orders_or_transfers'],request);noRawRequest(p,request);
});
for(const request of TRADE_FT)test(`AC-004 fund-movement-only request is blocked with F_T (no ATS, no alternative): ${request}`,()=>{
 assertBlockedTrade(request,F_T);const p=planGooseRequest(request);assert.ok(!(p.clarification??'').includes('ATS'));
 assert.deepEqual(p.blocked_actions,request.includes('예수금')?['orders_or_transfers','account_access']:['orders_or_transfers'],request);
});

test('AC-004 quantity-less 사줘 and mode words never produce a step',()=>{
 for(const request of ['/goose 삼성전자 사줘','/goose 논문 전략으로 삼성전자 사줘','/goose 백테스트 후 보고서 만들고 삼성전자 매수해','/goose conditions HTS 조건식 만들고 주문 넣어','/goose strategy 삼성전자 팔아줘'])assertBlockedTrade(request,F);
});

for(const [argv,sentence] of [[['/goose','삼성전자','매수해'],F],[['/goose','삼성전자','사줘'],F],[['/goose','송금','실행해'],F_T],[['/goose','자동매매','시스템','구축해줘'],F]] as const)test(`AC-004/026 CLI exits 64 without setup or key callbacks: ${argv.join(' ')}`,async()=>{
 let setup=0,keys=0;const out:string[]=[];const err:string[]=[];
 const code=await dispatchGooseCommand([...argv],async()=>{setup++;return 0;},{write:s=>err.push(s)},async()=>{keys++;return 0;},{write:s=>out.push(s)});
 assert.equal(code,64);assert.equal(setup+keys,0);assert.equal(out.length,1);
 const p=JSON.parse(out[0]!);assert.deepEqual(p,planGooseRequest(argv.slice(1).join(' ')));assert.equal(p.clarification,sentence);assert.deepEqual(p.steps,[]);assert.equal(p.provider_dispatches,0);
});

for(const [request,status,steps] of CONTROLS)test(`AC-005 positive control keeps baseline status and steps: ${request}`,()=>{
 const p=planGooseRequest(request);assert.equal(p.status,status);assert.deepEqual(p.steps.map(s=>s.id),steps);
 assert.deepEqual(p.blocked_actions,[]);assert.deepEqual(p.unsupported_actions,[]);
});

for(const request of [
 '/goose 매수 해석 보고서','/goose 최근 3주 사이 삼성전자 실적 분석','/goose buy and hold 전략을 백테스트','/goose ETF 보유 종목 분석','/goose 퀀트 엔진이란 무엇인가요',
 '/goose 자동매매 시스템이란 무엇인가요','/goose 팀 에이전트가 뭔가요','/goose 매수 신호 규칙을 백테스트','/goose 삼성전자 매수해야 할까요 실적 분석',
 // Separator-collapsed view must not stretch the baseline `.{0,N}` windows over unrelated words (found while tuning; baseline status is not blocked).
 '/goose 주문 체결 구조 설명해줘','/goose 이체 수수료 구조를 설명해줘','/goose 매수 처리 현황 분석 보고서','/goose 퀀트 엔진 성능 설명 팀 에이전트 비교 개념 정리',
])test(`over-block guard (not a SPEC sentence): explanation, rule design and analysis stay unblocked: ${request}`,()=>{
 const p=planGooseRequest(request);assert.notEqual(p.status,'blocked',request);assert.notEqual(p.status,'unsupported',request);assert.deepEqual(p.blocked_actions,[]);assert.deepEqual(p.unsupported_actions,[]);
});

for(const request of ATS_F)test(`AC-026 ATS-class request is unsupported with ats_scope_unsupported, F, no steps: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.equal(p.status,'unsupported',request);assert.deepEqual(p.unsupported_actions,['ats_scope_unsupported'],request);assert.deepEqual(p.blocked_actions,[],request);
 assert.deepEqual(p.steps,[],request);assert.equal(p.provider_dispatches,0);assert.equal(p.clarification,F,request);noRawRequest(p,request);
});

test('AC-026 overlap: trade-execution and ATS-class forms together are blocked and both arrays list their codes',()=>{
 for(const request of ['/goose 매매 봇 만들어서 삼성전자 사줘','/goose 자동매매 시스템 구축하고 지금 매수 주문해줘']){
  const p=planGooseRequest(request);
  assert.equal(p.status,'blocked',request);assert.deepEqual(p.blocked_actions,['orders_or_transfers'],request);assert.deepEqual(p.unsupported_actions,['ats_scope_unsupported'],request);
  assert.deepEqual(p.steps,[]);assert.equal(p.provider_dispatches,0);assert.equal(p.clarification,F,request);
 }
});

test('design 3.2: a request with a fund-movement form and another trade-execution form gets F, not F_T',()=>{
 const p=planGooseRequest('/goose 삼성전자 사줘 그리고 100만원 이체해줘');assert.equal(p.status,'blocked');assert.equal(p.clarification,F);
});

test('design 3.5: every blocked or unsupported plan has zero steps, whatever the reason code or mode word',()=>{
 const requests=[...TRADE_F,...TRADE_FT,...ATS_F,...ACCOUNT_REQUESTS,...PERFORMANCE_REQUESTS,'/goose 논문 전략 실행해','/goose 조건식 자동 등록해','/goose 보고서 게시해줘','/goose 전략 실행해','/goose 논문으로 전략 설계하고 백테스트 후 보고서 주문해줘'];
 for(const request of requests){const p=planGooseRequest(request);assert.ok(p.status==='blocked'||p.status==='unsupported',request);assert.deepEqual(p.steps,[],request);assert.equal(p.provider_dispatches,0);}
});

test('AC-007 unsupported engine request with a mode word has zero steps and keeps its own code (REQ-RPL-003 exception: 조건식 자동 등록해, 논문 전략 실행해)',()=>{
 let p=planGooseRequest('/goose 논문 전략 실행해');assert.equal(p.status,'unsupported');assert.deepEqual(p.unsupported_actions,['strategy_execution_engine_unavailable']);assert.deepEqual(p.steps,[]);
 p=planGooseRequest('/goose 전략 실행해');assert.equal(p.status,'unsupported');assert.deepEqual(p.unsupported_actions,['strategy_execution_engine_unavailable']);assert.deepEqual(p.steps,[]);
 p=planGooseRequest('조건식 자동 등록해');assert.equal(p.status,'unsupported');assert.deepEqual(p.steps,[]);
});

for(const request of ACCOUNT_REQUESTS)test(`AC-006 account holdings/returns request is blocked with account_access and the account sentence: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.equal(p.status,'blocked',request);assert.ok(p.blocked_actions.includes('account_access'),request);assert.deepEqual(p.steps,[],request);assert.equal(p.provider_dispatches,0);assert.equal(p.clarification,ACCOUNT,request);noRawRequest(p,request);
});
test('AC-006 account sentence asks for no key, account identifier or consent',()=>{assert.ok(!/키|식별자|동의|비밀번호/.test(R.GOOSE_SENTENCE_ACCOUNT??'x키'));});

for(const request of PERFORMANCE_REQUESTS)test(`AC-007 performance request without inputs is unsupported with performance_inputs_missing: ${request}`,()=>{
 const p=planGooseRequest(request);
 assert.equal(p.status,'unsupported',request);assert.ok(p.unsupported_actions.includes('performance_inputs_missing'),request);assert.deepEqual(p.blocked_actions,[]);
 assert.deepEqual(p.steps,[],request);assert.equal(p.clarification,PERFORMANCE,request);assert.equal(p.provider_dispatches,0);
});
test('performance rule does not swallow strategy/backtest reports or requests that already carry price/quantity inputs (over-block guard, not a SPEC sentence)',()=>{
 for(const request of ['/goose 논문 전략 백테스트 성과 보고서','/goose 삼성전자 수익률 비교 분석','/goose 내 수익률 매입가 70000원 10주 기준']){const p=planGooseRequest(request);assert.notEqual(p.status,'blocked',request);assert.ok(!p.unsupported_actions.includes('performance_inputs_missing'),request);}
});
test('REQ-CAP-007: account rule precedes performance rule (blocked precedes unsupported)',()=>{
 const p=planGooseRequest('/goose 내 계좌 수익률 알려줘');assert.equal(p.status,'blocked');assert.equal(p.clarification,ACCOUNT);
});

for(const [request,mode] of [
 ['/goose strategy 논문으로 설계','strategy'],['/goose backtest 과거 검증','backtest'],['goose-strategy 논문으로 설계','strategy'],['/goose goose-backtest 과거 검증','backtest'],
 ['/goose-backtest 과거 검증','backtest'],['/goose-strategy 논문으로 설계','strategy'],['/goose-backtest','backtest'],
] as const)test(`AC-003 legacy form migrates to its non-trading internal mode: ${request}`,()=>{
 const p=planGooseRequest(request);assert.equal(p.status,'ready',request);assert.deepEqual(p.steps.map(s=>s.id),[mode],request);
 assert.equal(p.migrated_legacy_command,request.includes('goose-'),request);assert.deepEqual(p.blocked_actions,[]);
});
test('AC-003 slash legacy form migrates only the seven currently mapped modes',()=>{
 assert.equal(GOOSE_MODES.length,7);
 for(const mode of GOOSE_MODES){const p=planGooseRequest(`/goose-${mode}`);assert.equal(p.migrated_legacy_command,true,mode);assert.equal(p.explicit_mode,mode);assert.deepEqual(p.steps.map(s=>s.id),[mode]);}
 for(const mode of ['order','trade','account','paper-trading','전략가']){const p=planGooseRequest(`/goose-${mode} 보고서`);assert.equal(p.migrated_legacy_command,false,mode);assert.equal(p.explicit_mode,null,mode);}
});
test('AC-003 slash legacy form is case-insensitive like the existing goose- form',()=>{const p=planGooseRequest('/GOOSE-Backtest 과거 검증');assert.equal(p.migrated_legacy_command,true);assert.deepEqual(p.steps.map(s=>s.id),['backtest']);});
test('AC-003 trade/order/transfer words in a legacy form: H3 block precedes migration (/goose-strategy 삼성전자 매수해)',()=>{
 for(const request of ['/goose-strategy 삼성전자 매수해','/goose-strategy 삼성전자 사줘','/goose-backtest 주문해줘']){assertBlockedTrade(request,F);const p=planGooseRequest(request);assert.equal(p.migrated_legacy_command,false,request);assert.equal(p.explicit_mode,null,request);}
});
test('AC-003 H11 clause: /goose-strategy 논문 전략, /goose-order 삼성전자 매수, /goose-order 보고서',()=>{
 let p=planGooseRequest('/goose-strategy 논문 전략');assert.equal(p.status,'ready');assert.deepEqual(p.steps.map(s=>s.id),['strategy']);assert.equal(p.migrated_legacy_command,true);
 assertBlockedTrade('/goose-order 삼성전자 매수',F);p=planGooseRequest('/goose-order 삼성전자 매수');assert.equal(p.migrated_legacy_command,false);assert.deepEqual(p.blocked_actions,['orders_or_transfers']);
 p=planGooseRequest('/goose-order 보고서');assert.equal(p.migrated_legacy_command,false);assert.equal(p.status,'ready');assert.deepEqual(p.steps.map(s=>s.id),['report']);
});
test('REQ-ENT-004 other slash tokens stay natural language: no command is created for /전략가 or /trade',()=>{
 let p=planGooseRequest('/전략가 논문으로 전략 설계');assert.equal(p.status,'ready');assert.deepEqual(p.steps.map(s=>s.id),['strategy']);assert.equal(p.migrated_legacy_command,false);assert.equal(p.explicit_mode,null);
 p=planGooseRequest('/account 잔고 조회');assert.equal(p.status,'blocked');assert.deepEqual(p.steps,[]);
});

test('normalization: NFC, case and separator-collapsed text are checked in addition to the original text (not a claim of complete paraphrase blocking)',()=>{
 for(const request of ['/goose 삼성전자 매수해'.normalize('NFD'),'/goose 삼성전자 매.수.해','/goose 삼성전자 사_줘','/goose 삼성전자 매​수해','/goose BUY 005930 NOW','/goose 삼 성 전 자 사 줘'])assertBlockedTrade(request,F);
 for(const request of ['/goose 자동매매 시스템 구축해줘'.normalize('NFD'),'/goose 자동매매-시스템-구축해줘','/goose 자 동 매 매 시 스 템 구 축 해 줘','/goose 퀀트·엔진 만들어줘']){const p=planGooseRequest(request);assert.equal(p.status,'unsupported',request);assert.deepEqual(p.unsupported_actions,['ats_scope_unsupported'],request);assert.equal(p.clarification,F,request);}
});

function forms(kind:'trade'|'ats'):readonly Form[]{const f=kind==='trade'?R.GOOSE_TRADE_FORMS:R.GOOSE_ATS_FORMS;assert.ok(Array.isArray(f)&&f.length>0,`${kind} lexicon must be exported as a non-empty table`);return f;}
function matched(kind:'trade'|'ats',text:string,without?:string):string[]{
 assert.equal(typeof R.matchGooseForms,'function','matchGooseForms must be exported');
 const table=forms(kind).filter(f=>f.id!==without);return R.matchGooseForms!(table,text);
}
test('lexicon tables: unique ids, trade and ATS forms never overlap on any SPEC sentence unless the sentence is a documented overlap',()=>{
 for(const kind of ['trade','ats'] as const){const ids=forms(kind).map(f=>f.id);assert.equal(new Set(ids).size,ids.length,`${kind} ids unique`);}
 const overlap=new Set(['/goose 매매 봇 만들어서 삼성전자 사줘','/goose 자동매매 시스템 구축하고 지금 매수 주문해줘']);
 for(const request of [...TRADE_F,...TRADE_FT])assert.deepEqual(matched('ats',request),[],`ATS form on trade sentence ${request}`);
 for(const request of ATS_F)assert.deepEqual(matched('trade',request),[],`trade form on ATS sentence ${request}`);
 for(const request of overlap){assert.ok(matched('trade',request).length>0,request);assert.ok(matched('ats',request).length>0,request);}
});
// Mutation-style: removing the one form that carries a sentence must leave it unmatched (RED if another form silently covers it).
for(const [mutant,kind,removedId,sentences] of [
 ['RM1 drop 사줘 form','trade','ko_sa_jwo',['/goose 삼성전자 사줘']],
 ['RM5 drop hand-off-to-execute form','trade','handoff_execute',['/goose 전략을 ATS로 보내서 실행해']],
 ['RM7 drop 출금/입금 form','trade','fund_withdraw_deposit',['/goose 예수금 출금해줘']],
 ['drop English buy/sell form','trade','en_buy_sell',['/goose buy 005930 now','/goose sell 005930']],
 ['drop reserved-order form','trade','reserved_order',['/goose 매도 예약 걸어줘']],
 ['drop auto/scheduled trading form','trade','auto_trading_command',['/goose 매일 아침 자동으로 매매해줘']],
 ['V1 drop 자동매매 시스템 구축','ats','ats_autotrade_system',['/goose 자동매매 시스템 구축해줘']],
 ['V2 drop 매매 봇','ats','ats_trading_bot',['/goose 24시간 돌아가는 매매 봇 만들어']],
 ['V3 drop 퀀트/시스템트레이딩 엔진','ats','ats_quant_engine',['/goose 퀀트 시스템트레이딩 엔진 만들어줘','/goose 논문 근거로 퀀트 엔진 만들어줘']],
 ['V4 drop 팀/상시 에이전트','ats','ats_team_agent',['/goose 팀 에이전트 상시 실행해줘','/goose CrewAI로 트레이딩 팀 구성해']],
] as const)test(`mutation ${mutant}: removing "${removedId}" leaves its sentences unmatched, keeping it matches`,()=>{
 for(const sentence of sentences){assert.ok(matched(kind,sentence).includes(removedId),`${sentence} should be matched by ${removedId}`);assert.deepEqual(matched(kind,sentence,removedId),[],`${sentence} must not be covered by a second form`);}
});
test('mutation RM1b (equivalent mutant, documented): dropping N주 사 keeps 10주 사줘 matched by the 사줘 form',()=>{
 assert.ok(matched('trade','/goose 삼성전자 10주 사줘','ko_n_ju_sa').length>0);
});
test('mutation V7: the bare word ATS is not an ATS-class form and not a trade form',()=>{
 assert.deepEqual(matched('ats','/goose ATS가 무엇인가요'),[]);assert.deepEqual(matched('trade','/goose ATS가 무엇인가요'),[]);
 const p=planGooseRequest('/goose ATS가 무엇인가요');assert.notEqual(p.status,'blocked');assert.notEqual(p.status,'unsupported');
});

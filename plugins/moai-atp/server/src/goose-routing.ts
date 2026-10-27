export const GOOSE_MODES=['setup','analyze','conditions','strategy','backtest','mental-support','report'] as const;
export type GooseMode=typeof GOOSE_MODES[number];
const refs:Record<GooseMode,string>={setup:'SKILL.md',analyze:'references/catalog.json',conditions:'references/workflows/conditions.md',strategy:'references/workflows/strategy.md',backtest:'references/workflows/backtest.md','mental-support':'references/workflows/mental-support.md',report:'references/report-writing.md'};
/** Conservative local planning helper. No model, provider dispatch, storage, evidence issuance or host registration. */
export function planGooseRequest(value:unknown){
 if(typeof value!=='string'||value.length>2000||/[\x00-\x1f\x7f]/.test(value))throw new Error('invalid_input');
 let text=value.trim().replace(/^\/goose(?:\s+|$)/i,'');
 const first=text.split(/\s+/)[0]?.toLowerCase()??'';const legacy=first.startsWith('goose-')?first.slice(6):first;
 const explicit=GOOSE_MODES.includes(legacy as GooseMode)?legacy as GooseMode:undefined;
 if(explicit)text=text.slice(first.length).trim();
 const blockedActions:string[]=[];
 if(/(?:주문|매수|매도).{0,6}(?:넣어|실행|해줘|해 줘)|(?:이체|송금).{0,10}(?:해|실행|진행)/.test(text))blockedActions.push('orders_or_transfers');
 if(/계좌.{0,6}(?:조회|연결|분석)|(?:잔고|예수금).{0,6}(?:조회|분석)/.test(text))blockedActions.push('account_access');
 const modes=new Set<GooseMode>();if(explicit)modes.add(explicit);
 if(!explicit||explicit!=='setup'){
  if(/조건식|HTS|MTS/i.test(text))modes.add('conditions');
  if((/논문|전략.{0,10}(?:설계|만들)/.test(text))&&!/전략.{0,10}(?:만들지|설계하지)/.test(text))modes.add('strategy');
  if(/백테스트|과거.{0,8}검증|walk.?forward/i.test(text))modes.add('backtest');
  if(/멘탈|불안|마음|후회|만회.{0,8}충동/.test(text))modes.add('mental-support');
  if(/보고서|리포트|HTML/i.test(text))modes.add('report');
  if(/(?:종목|기업|수급|실적|공시|재무|ETF|선물).{0,12}(?:분석|비교|점검)|분석.{0,10}(?:종목|기업|ETF|선물)/i.test(text))modes.add('analyze');
 }
 const unsupported:string[]=[];
 if(/게시|댓글|자료실.{0,8}(?:올려|업로드)/.test(text))unsupported.push('community_service_not_configured');
 if(/(?:조건식|조건).{0,10}(?:자동.{0,3}등록|저장해)/.test(text))unsupported.push('automatic_condition_registration_unavailable');
 if(/전략.{0,6}실행해/.test(text))unsupported.push('strategy_execution_engine_unavailable');
 const order:GooseMode[]=['setup','mental-support','conditions','strategy','analyze','backtest','report'];
 const chosen=order.filter(mode=>modes.has(mode));
 const status=blockedActions.length?'blocked':unsupported.length?'unsupported':chosen.length?'ready':'clarification_required';
 const steps=status==='blocked'?[]:chosen.map((mode,index)=>({id:mode,workflow_ref:refs[mode],depends_on:index?[chosen[index-1]!]:[],execution_status:'not_run' as const,requirements:mode==='backtest'?['explicit_rules','validated_history','cost_model','supported_execution_engine']:mode==='report'?['validated_source_receipts','cutoff_and_units','report_input_validation']:[]}));
 return {contract:'moai.goose.workflow-plan.v1' as const,status,explicit_mode:explicit??null,migrated_legacy_command:explicit!==undefined&&first.startsWith('goose-'),steps,report_id:modes.has('report')||modes.has('analyze')?(/ETF/i.test(text)?'R12':/선물/.test(text)?'R13':'R01'):null,blocked_actions:blockedActions,unsupported_actions:unsupported,clarification:status==='clarification_required'?'어떤 대상에 대해 어떤 도움을 원하시나요?':null,execution_authority:'plan_only' as const,host_registration:'unverified' as const,provider_dispatches:0,raw_request_retained:false};
}

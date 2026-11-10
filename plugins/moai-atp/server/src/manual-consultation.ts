import {z} from 'zod';
import {createHash} from 'node:crypto';
import type {ReportInput,ReportPlan} from './report-pipeline.js';
export const MANUAL_CONSULTATION_ERROR_CODES=['manual_snapshot_after_cutoff','manual_costs_only_supported_by_R05','manual_target_weights_must_total_100','manual_decimal_out_of_range','manual_consultation_input_only','manual_consultation_route_mismatch','manual_consultation_only','manual_consultation_origin_mismatch'] as const;

const text=z.string().trim().min(1).max(160).refine(v=>!/[\x00-\x1f\x7f]/.test(v),'control_character');
const money=z.string().regex(/^(0|[1-9]\d{0,17})(?:\.\d{1,6})?$/);
const percent=z.string().regex(/^(0|[1-9]\d{0,2})(?:\.\d{1,6})?$/).refine(v=>Number(v)<=100,'percent_out_of_range');
const currency=z.string().regex(/^[A-Z]{3}$/);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===v;},'invalid_calendar_date');
const ref=z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
export const ManualConsultationInputSchema=z.object({
 origin:z.enum(['manual','synthetic_fixture']).default('manual'),
 snapshot:z.object({as_of:date,currency,cash:money.nullable(),target_cash_weight_percent:percent.optional(),
  positions:z.array(z.object({id:ref,label:text.max(100),currency,market_value:money.nullable(),target_weight_percent:percent.optional()}).strict()).min(1).max(50),
 }).strict(),
 context:z.object({goal:text.optional(),horizon_months:z.number().int().min(1).max(1200).optional(),liquidity_need:money.optional(),constraints:text.optional()}).strict().optional(),
 costs:z.array(z.object({id:ref,label:text,currency,basis_amount:money.nullable(),annual_fee_percent:percent.nullable(),annual_fixed_cost:money.nullable()}).strict()).max(20).default([]),
}).strict().superRefine((v,c)=>{
 for(const rows of [v.snapshot.positions,v.costs])if(new Set(rows.map(r=>r.id)).size!==rows.length)c.addIssue({code:'custom',message:'manual_duplicate_id'});
});
export const ManualConsultationMetadataSchema=z.object({contract:z.literal('moai.manual-consultation.v1'),privacy:z.literal('private'),kind:z.enum(['holdings_snapshot','cost_impact']),origin:z.enum(['manual','synthetic_fixture','missing']),missing_inputs:z.array(z.string().max(160)).max(200)}).strict();
type Math={add:(a:string,b:string)=>string|null;subtract:(a:string,b:string)=>string|null;multiply:(a:string,b:string)=>string|null;ratio:(a:string,b:string,m:number,places?:number)=>string|null;compare:(a:string,b:string)=>number|null};
const required=(v:string|null):string=>{if(v===null)throw Error('manual_decimal_out_of_range');return v;};

/** Point-in-time manual data only: no credential loader, provider, account, trade or persistence. */
export function buildManualConsultation(args:{reportId:'R04'|'R05';input:unknown;cutoff:string;receivedAt:string;displayTimezone:ReportInput['display_timezone'];plan:ReportPlan;math:Math}):ReportInput {
 const {reportId,math,plan}=args;
 const input=args.input===undefined?undefined:ManualConsultationInputSchema.parse(args.input);
 const s=input?.snapshot,synthetic=input?.origin==='synthetic_fixture',sourceId='src-manual-consultation';
 const needs:string[]=[],metrics:ReportInput['metrics']=[],tables:NonNullable<ReportInput['source_tables']>=[],visuals:NonNullable<ReportInput['visuals']>=[];
 const sourceIds=input?[sourceId]:[];
 const add=(id:string,label:string,value:string|null,unit:string,cur:string|null,reason='manual_input_incomplete')=>{
  metrics.push({field_id:'manual.'+id,label,value,unit,currency:cur,status:value===null?'missing':synthetic?'synthetic':'provided_unverified',source_id:sourceId,period:s!.as_of,scale:'1',period_kind:'observation',scope:'not_applicable',...(value===null?{missing_reason:reason}:{})});
 };
 if(!input)needs.push('manual_consultation.snapshot');
 if(input&&s){
  const cutoffParts=new Intl.DateTimeFormat('en-CA',{timeZone:args.displayTimezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(args.cutoff));
  const at=(type:string)=>cutoffParts.find(p=>p.type===type)!.value;
  if(s.as_of>`${at('year')}-${at('month')}-${at('day')}`)throw Error('manual_snapshot_after_cutoff');
  if(reportId==='R04'&&input.costs.length)throw Error('manual_costs_only_supported_by_R05');
  const complete=s.cash!==null&&s.positions.every(p=>p.market_value!==null&&p.currency===s.currency);
  if(s.cash===null)needs.push('snapshot.cash');
  for(const p of s.positions){if(p.market_value===null)needs.push('snapshot.positions.'+p.id+'.market_value');if(p.currency!==s.currency)needs.push('snapshot.positions.'+p.id+'.FX_conversion_not_supplied');}
  const total=complete?s.positions.reduce((v,p)=>required(math.add(v,p.market_value!)),s.cash!):null;
  const positive=total!==null&&math.compare(total,'0')===1;
  add('total_value','수동 입력 총평가액',total,s.currency,s.currency,'complete_same_currency_snapshot_required');
  const targets=s.target_cash_weight_percent!==undefined&&s.positions.every(p=>p.target_weight_percent!==undefined);
  if(targets){const sum=s.positions.reduce((v,p)=>required(math.add(v,p.target_weight_percent!)),s.target_cash_weight_percent!);if(math.compare(sum,'100')!==0)throw Error('manual_target_weights_must_total_100');}
  else if(reportId==='R04')needs.push('snapshot.complete_target_weights');
  const context=input.context;
  for(const key of ['goal','horizon_months','liquidity_need','constraints'] as const)if(context?.[key]===undefined)needs.push('context.'+key);
  if(reportId==='R04'){
   const weights:Array<{id:string;label:string;value:string}>=[];
   const rows=s.positions.map(p=>{
    const weight=positive?math.ratio(p.market_value!,total!,100):null;
    const gap=weight!==null&&targets?math.subtract(p.target_weight_percent!,weight):null;
    const label=`${p.label} [${p.id}]`;
    add('position.'+p.id+'.value',label+' 평가액',p.market_value,p.currency,p.currency);
    add('position.'+p.id+'.weight',label+' 현재 비중',weight,'%',null,'positive_complete_same_currency_snapshot_required');
    add('position.'+p.id+'.target',label+' 사용자 목표 비중',p.target_weight_percent??null,'%',null);
    add('position.'+p.id+'.target_gap',label+' 목표−현재 비중',gap,'%p',null,'complete_targets_and_snapshot_required');
    if(weight!==null)weights.push({id:'manual.position.'+p.id+'.weight',label,value:weight});
    return [label,p.currency,p.market_value??'미입력',weight??'계산 보류',p.target_weight_percent??'미입력',gap??'계산 보류'];
   });
   const cashWeight=positive?math.ratio(s.cash!,total!,100):null;
   add('cash_value','수동 입력 현금',s.cash,s.currency,s.currency);add('cash_weight','현금 비중',cashWeight,'%',null);
   if(cashWeight!==null)weights.push({id:'manual.cash_weight',label:'현금',value:cashWeight});
   const max=positive?weights.filter(w=>w.id!=='manual.cash_weight').reduce((m,w)=>math.compare(w.value,m)===1?w.value:m,'0'):null;
   add('largest_position_weight','최대 단일 보유 비중',max,'%',null);
   add('liquidity_gap','입력 현금−명시 현금 필요액',s.cash!==null&&context?.liquidity_need!==undefined?math.subtract(s.cash,context.liquidity_need):null,s.currency,s.currency,'cash_and_explicit_liquidity_need_required');
   if(positive&&weights.length>=2&&weights.length<=50)visuals.push({section_id:'R04.S02',kind:'donut',title:'수동 입력 총평가액 기준 구성 · 소수 4자리 반올림',labels:weights.map(w=>w.label),values:weights.map(w=>w.value),unit:'%',source_id:sourceId,metric_ids:weights.map(w=>w.id)});
   const gaps=metrics.filter(m=>m.field_id.endsWith('.target_gap')&&m.value!==null);
   if(gaps.length>=2)visuals.push({section_id:'R04.S05',kind:'bar',title:'사용자 목표−현재 비중 · 실행 지시 아님',labels:gaps.map(m=>m.label),values:gaps.map(m=>m.value!),unit:'%p',source_id:sourceId,metric_ids:gaps.map(m=>m.field_id)});
   tables.push({source_id:sourceId,title:'비공개 수동 입력 보유 snapshot',columns:['사용자 식별자','통화','평가액','현재 비중 %','목표 비중 %','차이 %p'],rows,coverage_note:'종목·평가액·가격시각은 사용자 입력이며 공급자 확인값이 아닙니다. 비중 분모는 같은 통화의 현금 포함 총평가액입니다. FX·업종·발행사 동일성을 추정하지 않습니다.'});
   tables.push({source_id:sourceId,title:'사용자가 명시한 상담 맥락 · 비공개',columns:['항목','사용자 명시 입력'],rows:[['목표',context?.goal??'미입력'],['기간(개월)',context?.horizon_months?.toString()??'미입력'],['현금 필요액 · '+s.currency,context?.liquidity_need??'미입력'],['제약',context?.constraints??'미입력']],coverage_note:'입력하지 않은 목표·기간·유동성·제약을 추정하거나 저장하지 않았습니다. 현금 차이는 거래 지시가 아닙니다.'});
  }else{
   if(!input.costs.length)needs.push('costs');
   const rows:string[][]=[];
   const costs=input.costs.map(p=>{
    const variable=p.basis_amount!==null&&p.annual_fee_percent!==null?math.multiply(required(math.multiply(p.basis_amount,p.annual_fee_percent)),'0.01'):null;
    const annual=variable!==null&&p.annual_fixed_cost!==null?math.add(variable,p.annual_fixed_cost):null;
    return {p,variable,annual};
   });
   for(const {p,variable,annual}of costs){
    if(annual===null)needs.push('costs.'+p.id+'.complete_annual_assumptions');
    const first=costs[0],comparable=first&&p.currency===first.p.currency&&p.basis_amount!==null&&first.p.basis_amount!==null&&math.compare(p.basis_amount,first.p.basis_amount)===0;
    const difference=comparable&&annual!==null&&first.annual!==null?math.subtract(annual,first.annual):null;
    add('cost.'+p.id+'.basis',p.label+' 명시 적용금액',p.basis_amount,p.currency,p.currency);
    add('cost.'+p.id+'.rate',p.label+' 연간 비용률 가정',p.annual_fee_percent,'%',null);
    add('cost.'+p.id+'.fixed',p.label+' 연간 고정 비용 가정',p.annual_fixed_cost,p.currency,p.currency);
    add('cost.'+p.id+'.annual_total',p.label+' 정적 연간 비용',annual,p.currency,p.currency);
    add('cost.'+p.id+'.difference',p.label+' 첫 가정 대비 연간 비용 차이',difference,p.currency,p.currency,'same_currency_basis_and_complete_assumptions_required');
    rows.push([p.label,p.currency,p.basis_amount??'미입력',p.annual_fee_percent??'미입력',p.annual_fixed_cost??'미입력',annual??'계산 보류',difference??'비교 보류']);
   }
   const first=costs[0];
   const safeChart=costs.length>=2&&costs.every(({p,annual})=>annual!==null&&/^\d+$/.test(annual)&&Number.isSafeInteger(Number(annual))&&p.currency===first!.p.currency&&p.basis_amount!==null&&first!.p.basis_amount!==null&&math.compare(p.basis_amount,first!.p.basis_amount)===0);
   if(safeChart)visuals.push({section_id:'R05.S03',kind:'bar',title:'동일 적용금액의 정적 연간 비용 · 가정',labels:costs.map(c=>c.p.label),values:costs.map(c=>c.annual!),unit:first!.p.currency,source_id:sourceId,metric_ids:costs.map(c=>'manual.cost.'+c.p.id+'.annual_total')});
   // Fractional or unsafe money stays exact in tables instead of being rounded for a chart.
   tables.push({source_id:sourceId,title:'비공개 정적 연간 비용 가정',columns:['가정','통화','명시 적용금액','연간률 %','연간 고정액','연간 비용','첫 가정 대비 차이'],rows,coverage_note:'연간 비용 = 명시 적용금액 × 입력 연간률 ÷ 100 + 입력 연간 고정액. 명시 적용금액을 현금·보유 전체에 자동 적용하지 않습니다. 거래·세금·FX·실현/예상 수익률 계산이 아니며 누락 비용은 0으로 간주하지 않습니다.'});
  }
 }
 const origin=input?input.origin:'missing';
 const common=`${synthetic?'합성 fixture · 실제 사용자 자료 아님. ':''}개인 수동 입력 · 비공개. 외부 API·계좌 조회·주문·파일/서비스 영구 저장·게시를 실행하지 않았습니다. 입력의 정확성·종목 동일성·시세 시각은 독립 검증되지 않았습니다.`;
 const bodies=reportId==='R04'?[
  '같은 통화·같은 snapshot의 평가액과 현금만 합산합니다. 결측이나 통화 차이가 있으면 총평가액과 비중을 보류합니다.',
  '현재 비중은 평가액 ÷ 현금 포함 총평가액 × 100입니다. 소수 4자리에서 반올림하며 0 분모를 계산하지 않습니다.',
  '최대 단일 보유 비중은 입력 식별자별로만 계산합니다. 발행사·섹터·상품 중복은 자료가 없어 추정하지 않습니다.',
  '목표·기간·현금 필요·제약이 없으면 개인별 선택을 권하지 않습니다. 기존 보유 입력의 정적 수치만 제시합니다.',
  '목표−현재 비중은 전체 목표 합계가 100일 때만 계산합니다. 차이는 주문·매수/매도 수량이나 실행 지시가 아닙니다.',
  '가격·FX·종목 식별·전체 coverage와 사용자 목표를 확인해야 합니다. 거래 원장·TWR/MWR·백테스트는 포함하지 않습니다.',
 ]:[
  '현재 보유 snapshot과 별도로 각 비용 가정의 적용금액·통화·연간률·고정액을 명시합니다.',
  '입력 비용은 실제 상품의 확인된 수수료가 아니라 사용자가 제시한 가정입니다. 미입력 비용을 0으로 대체하지 않습니다.',
  '정적 연간 비용 = 적용금액 × 입력 연간률 ÷ 100 + 연간 고정액입니다. 복리·체결·성과를 모의 계산하지 않습니다. 차트는 동일 기준·안전한 정수 금액만 사용하고 소수/큰 금액은 정확한 표로 제공합니다.',
  '첫 번째 가정과 통화·적용금액이 같고 비용 입력이 완전할 때만 금액 차이를 제시합니다. 더 낮은 비용이 상품 추천을 뜻하지 않습니다.',
  '세금·거래비·환전·스프레드·개별 계약 조건과 비용 산정 기준은 별도 확인 대상이며 자동 추정하지 않습니다.',
  '비용 차이는 선택지의 한 요소입니다. 목표·기간·유동성·위험·실제 상품 약관이 확인되지 않으면 최종 선택을 보류합니다.',
 ];
 const belongs=(id:string,index:number)=>reportId==='R04'?[id==='manual.total_value',id.includes('.position.')&&!/target/.test(id)||id==='manual.cash_value'||id==='manual.cash_weight',id==='manual.largest_position_weight',id==='manual.liquidity_gap',/target/.test(id),false][index]:[id==='manual.total_value',/\.(basis|rate|fixed)$/.test(id),id.endsWith('.annual_total'),id.endsWith('.difference'),false,false][index];
 const sections=plan.sections.map((section,index)=>({id:section.id,status:input?'partial' as const:'not_run' as const,required_fields:section.field_ids,missing_reason:needs.length?'미입력/미확인: '+needs.join(', '):'수동 입력 기준 계산 · 독립 대사 전',body:common+' '+bodies[index],source_ids:sourceIds,metric_ids:metrics.filter(m=>belongs(m.field_id,index)).map(m=>m.field_id)}));
 return {contract_version:'atp.template/1.1',report_id:reportId,mode:synthetic?'synthetic':'supplied',subject:{id:'manual-consultation',name:reportId==='R04'?'수동 입력 보유·리스크 상담':'수동 입력 비용 영향 상담',venue:'MANUAL',currency:s?.currency??'UNSPECIFIED'},cutoff:args.cutoff,display_timezone:args.displayTimezone,
  sources:input?[{id:sourceId,kind:synthetic?'synthetic':'user_supplied',title:synthetic?'합성 수동 입력 fixture · 실제 개인 자료 아님':'사용자 수동 입력 · 비공개',url:null,observed_at:args.receivedAt,available_at:args.receivedAt,rights:synthetic?'synthetic_only':'local_view',revision:createHash('sha256').update(JSON.stringify(input)).digest('hex'),source_as_of:s!.as_of,received_at:args.receivedAt,operation_ref:'local.manual-consultation.v1',validation_status:synthetic?'synthetic_fixture':'unverified'}]:[],metrics,sections,source_tables:tables,visuals,chart:null,time_series:null,execution_status:!input?'not_run':synthetic?'synthetic_fixture_rendered':'provided_unverified',
  analysis_claims:[{id:reportId+'.MANUAL.method',kind:'method',text:common,status:input?'partial':'not_run',confidence:'unrated',source_ids:sourceIds,metric_ids:metrics.map(m=>m.field_id)},{id:reportId+'.MANUAL.limits',kind:'uncertainty',text:needs.length?'추가 확인 입력: '+needs.join(', '):'입력·상품 계약·공급자 자료 대사는 별도로 필요합니다.',status:'partial',confidence:'unrated',source_ids:sourceIds,metric_ids:[]}],
  consultation:{contract:'moai.manual-consultation.v1',privacy:'private',kind:reportId==='R04'?'holdings_snapshot':'cost_impact',origin,missing_inputs:needs}};
}

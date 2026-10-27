import {z} from 'zod';
import {ACTIVE_REPORT_ROUTE_IDS,ReportInputSchema,type ReportInput} from './report-pipeline.js';
const id=z.string().min(1).max(160);
const paragraph=z.object({kind:z.enum(['fact','calculation','interpretation','uncertainty','condition']),text:z.string().min(1).max(2000),source_ids:z.array(id).max(12),metric_ids:z.array(id).max(20)}).strict();
const binding=z.discriminatedUnion('kind',[
 z.object({id:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/),kind:z.literal('investor_direction_days'),source_id:id,actor:z.enum(['individual','foreign','institution']),direction:z.enum(['positive','negative','zero'])}).strict(),
 z.object({id:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/),kind:z.literal('metric'),source_id:id,metric_id:id,format:z.enum(['raw','grouped']).default('raw')}).strict(),
 z.object({id:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/),kind:z.enum(['source_as_of','received_date','investor_period_start','investor_period_end','investor_observation_count']),source_id:id}).strict(),
]);
export const NarrativeDraftSchema=z.object({contract:z.literal('moai.report.narrative-draft.v1'),report_id:z.enum(ACTIVE_REPORT_ROUTE_IDS),bindings:z.array(binding).max(100),sections:z.array(z.object({section_id:z.string().regex(/^(?:R\d{2}|U01)\.[SX]\d{2}$/),paragraphs:z.array(paragraph).min(1).max(6)}).strict()).max(30),goose_opinion:z.object({conclusion:paragraph,rationale:z.array(paragraph).min(1).max(5),risks:z.array(paragraph).min(1).max(5),next_checks:z.array(paragraph).min(1).max(5)}).strict()}).strict();
export type NarrativeDraft=z.infer<typeof NarrativeDraftSchema>;
const label={fact:'확인된 자료',calculation:'계산',interpretation:'해석',uncertainty:'한계',condition:'다음 확인'};
function visible(s:ReportInput['sources'][number]){return s.rights==='synthetic_only'&&s.kind==='synthetic'&&s.validation_status==='synthetic_fixture'||s.rights==='local_view'&&(s.kind==='user_supplied'||['provider_shape_checked','independently_reconciled'].includes(s.validation_status??''));}
function group(value:string){const m=/^(-?)(\d+)(\.\d+)?$/.exec(value);if(!m)throw Error('narrative_metric_unavailable');return m[1]+m[2]!.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(m[3]??'');}
function civilDate(value:string,timeZone:string):string {
 if(/^\d{4}-\d{2}-\d{2}$/.test(value)){const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(d.valueOf())||d.toISOString().slice(0,10)!==value)throw Error('narrative_metric_unavailable');return value;}
 const d=new Date(value);if(!Number.isFinite(d.valueOf())||d.getUTCFullYear()<1||d.getUTCFullYear()>9999)throw Error('narrative_metric_unavailable');
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d),at=(key:string)=>parts.find(p=>p.type===key)?.value;
 return `${at('year')!.padStart(4,'0')}-${at('month')}-${at('day')}`;
}
/** Counts signed raw observations only, never converts native quantities or amounts. */
export function investorDirectionCounts(doc:ReportInput,sourceId:string){
 const source=doc.sources.find(s=>s.id===sourceId);if(!source||!visible(source)||source.operation_ref!=='KIS-inquire-investor')throw Error('narrative_invalid_reference');
 const tables=(doc.source_tables??[]).filter(t=>t.source_id===sourceId&&t.title==='개인·외국인·기관 순매수 수급');if(tables.length!==1||!tables[0]!.rows.length)throw Error('narrative_metric_unavailable');const table=tables[0]!;
 const columns={individual:'개인 순매수 수량 원문',foreign:'외국인 순매수 수량 원문',institution:'기관 순매수 수량 원문'};
 const count={individual:{positive:0,negative:0,zero:0},foreign:{positive:0,negative:0,zero:0},institution:{positive:0,negative:0,zero:0}};
 const dates:string[]=[];
 for(const row of table.rows){const raw=row[table.columns.indexOf('영업일')];if(!raw||!/^\d{8}$/.test(raw))throw Error('narrative_metric_unavailable');const day=civilDate(`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`,'UTC');if(dates.includes(day))throw Error('narrative_invalid_reference');dates.push(day);
  for(const actor of ['individual','foreign','institution'] as const){const text=row[table.columns.indexOf(columns[actor])];if(!text||!/^(-?)(\d+)(?:\.(\d+))?$/.test(text))throw Error('narrative_metric_unavailable');const zero=/^-?0+(?:\.0+)?$/.test(text);count[actor][zero?'zero':text.startsWith('-')?'negative':'positive']++;}
 }
 dates.sort();return {observations:dates.length,start:dates[0]!,end:dates.at(-1)!,counts:count,method:'signed-raw-net-quantity-observation-days.v1'};
}
/** Text-only host draft. It cannot alter provider sources, metric values, rights, or validation. */
export function applyNarrativeDraft(input:ReportInput,draftValue:unknown):ReportInput {
 const doc=ReportInputSchema.parse(input),draft=NarrativeDraftSchema.parse(draftValue);
 if(draft.report_id!==doc.report_id)throw Error('narrative_report_mismatch');
 if(Buffer.byteLength(JSON.stringify(draft))>80000)throw Error('response_too_large');
 if(new Set(draft.bindings.map(b=>b.id)).size!==draft.bindings.length||new Set(draft.sections.map(s=>s.section_id)).size!==draft.sections.length)throw Error('narrative_invalid_reference');
 const sources=new Map(doc.sources.map(s=>[s.id,s])),sections=new Set(doc.sections.map(s=>s.id));
 const slots=new Map<string,{value:string,source:string,metric?:string}>();
 for(const b of draft.bindings){const source=sources.get(b.source_id);if(!source||!visible(source))throw Error('narrative_invalid_reference');
  if(b.kind==='metric'){
   const matches=doc.metrics.filter(m=>m.field_id===b.metric_id&&m.source_id===b.source_id);if(matches.length!==1)throw Error('narrative_invalid_reference');const m=matches[0]!;
   if(m.value===null||!['synthetic','provided','provided_unverified'].includes(m.status)||/미확인|unverified|unknown/i.test(m.unit))throw Error('narrative_metric_unavailable');
   slots.set(b.id,{value:b.format==='grouped'?group(m.value):m.value,source:b.source_id,metric:b.metric_id});
  }else if(b.kind==='investor_direction_days'){const c=investorDirectionCounts(doc,b.source_id);slots.set(b.id,{value:String(c.counts[b.actor][b.direction]),source:b.source_id});}
  else if(b.kind.startsWith('investor_')){const c=investorDirectionCounts(doc,b.source_id);slots.set(b.id,{value:b.kind==='investor_period_start'?c.start:b.kind==='investor_period_end'?c.end:String(c.observations),source:b.source_id});}
  else{const value=b.kind==='source_as_of'?source.source_as_of:source.received_at??source.observed_at;if(!value)throw Error('narrative_metric_unavailable');slots.set(b.id,{value:civilDate(value,doc.display_timezone),source:b.source_id});}
 }
 const resolve=(p:z.infer<typeof paragraph>)=>{
  if((p.kind==='fact'||p.kind==='calculation'||p.kind==='interpretation')&&p.source_ids.length===0)throw Error('narrative_missing_citation');
  for(const source of p.source_ids){const s=sources.get(source);if(!s||(!visible(s)&&p.kind!=='uncertainty'&&p.kind!=='condition'))throw Error('narrative_invalid_reference');}
  for(const metric of p.metric_ids)if(!doc.metrics.some(m=>m.field_id===metric&&p.source_ids.includes(m.source_id)&&m.value!==null&&['synthetic','provided','provided_unverified'].includes(m.status)))throw Error('narrative_invalid_reference');
  const stripped=p.text.replace(/\{\{[A-Za-z][A-Za-z0-9_]{0,39}\}\}/g,'');
  if(/\p{Nd}/u.test(stripped))throw Error('narrative_unbound_number');
  if(/\{\{|\}\}/.test(stripped))throw Error('narrative_placeholder_mismatch');
  const text=p.text.replace(/\{\{([A-Za-z][A-Za-z0-9_]{0,39})\}\}/g,(_whole,alias:string)=>{const slot=slots.get(alias);if(!slot||!p.source_ids.includes(slot.source)||(slot.metric&&!p.metric_ids.includes(slot.metric)))throw Error('narrative_placeholder_mismatch');return slot.value;});
  return {...p,text};
 };
 const claims:ReportInput['analysis_claims']=[];
 for(const section of draft.sections){if(!sections.has(section.section_id))throw Error('narrative_invalid_reference');const original=doc.sections.find(s=>s.id===section.section_id)!;const lines=section.paragraphs.map(resolve);original.body=lines.map(p=>`${label[p.kind]}: ${p.text}`).join('\n\n');for(const [i,p]of lines.entries())claims.push({id:`${doc.report_id}.NARRATIVE.${section.section_id}.${i}`,kind:p.kind==='calculation'?'method':p.kind,text:p.text,status:p.source_ids.length?'partial':'missing',confidence:'unrated',source_ids:p.source_ids,metric_ids:p.metric_ids});}
 if(!['interpretation','uncertainty'].includes(draft.goose_opinion.conclusion.kind))throw Error('invalid_input');
 for(const [group,items]of Object.entries({conclusion:[draft.goose_opinion.conclusion],rationale:draft.goose_opinion.rationale,risks:draft.goose_opinion.risks,next_checks:draft.goose_opinion.next_checks}))for(const [i,item]of items.entries()){const p=resolve(item);claims.push({id:`${doc.report_id}.GOOSE_OPINION.${group}.${i}`,kind:p.kind==='calculation'?'method':p.kind,text:p.text,status:p.source_ids.length?'partial':'missing',confidence:'unrated',source_ids:p.source_ids,metric_ids:p.metric_ids});}
 if(draft.bindings.some(b=>b.kind.startsWith('investor_')))claims.push({id:`${doc.report_id}.NARRATIVE.investor-method`,kind:'method',text:'수급 일수는 반환된 서로 다른 영업일의 순매수 수량 원문 부호로만 셌습니다. 수량·금액 환산이나 누적 규모 계산이 아니며, 순매수 일수가 많아도 누적 순매수 규모가 크다는 뜻은 아닙니다. 기간 전체 완전성은 확인하지 않았습니다.',status:'partial',confidence:'unrated',source_ids:[...new Set(draft.bindings.filter(b=>b.kind.startsWith('investor_')).map(b=>b.source_id))],metric_ids:[]});
 doc.analysis_claims=doc.analysis_claims.filter(c=>!c.id.includes('.NARRATIVE.')&&!c.id.includes('.GOOSE_OPINION.'));
 doc.analysis_claims.push(...claims,{id:`${doc.report_id}.NARRATIVE.method`,kind:'method',text:'본문은 호스트 언어모델이 작성한 분석 초안입니다. 수치는 원본 지표에 바인딩했으며, 해석의 독립 검증이나 자료 전체의 완전성을 보증하지 않습니다.',status:'partial',confidence:'unrated',source_ids:[],metric_ids:[]});
 return ReportInputSchema.parse(doc);
}

// SPEC-ATP-R02-001 (card t5-A): explicit-subjects comparison for report R02.
// Pure functions over already-normalized report parts: nothing here reads a provider, a file or a clock.
// Sources are bound to subjects only by the identifier their own content carries (never by call position
// or by a caller's claim), and every refusal is a short code from the SAFE_CODES vocabulary.
import {z} from 'zod';
import type {ReportInput} from './report-pipeline.js';

type Metric=ReportInput['metrics'][number];
type Source=ReportInput['sources'][number];
type SourceTable=NonNullable<ReportInput['source_tables']>[number];
type Visual=NonNullable<ReportInput['visuals']>[number];

export const COMPARISON_PILOT_TOOLS=['get_market_snapshot','get_fundamentals','get_public_filings'] as const;
export const ACQUISITION_KINDS=['process_receipt','caller_supplied_unverified','synthetic_fixture'] as const;
export const MAPPING_STATUSES=['verified_by_dart_filing','synthetic_fixture_match','unverified'] as const;
export const COMPARISON_REASONS=['period_mismatch','period_unconfirmed','scope_mismatch','currency_mismatch','unit_mismatch','scale_mismatch','scale_unconfirmed','value_missing','rights_not_confirmed','issuer_mapping_unverified'] as const;
export type AcquisitionKind=typeof ACQUISITION_KINDS[number];
export type MappingStatus=typeof MAPPING_STATUSES[number];
export type ComparisonReason=typeof COMPARISON_REASONS[number];
export type ComparisonSubject={id:string;name:string;venue:string;currency:string;kis_symbol:string;corp_code_candidate:string};

const Text=z.string().min(1).max(200);
const SubjectSchema=z.object({id:Text,name:Text,venue:Text,currency:Text,kis_symbol:z.string().regex(/^\d{6}$/),corp_code_candidate:z.string().regex(/^\d{8}$/)}).strict();
const DecimalOrNull=z.union([z.string().regex(/^-?(0|[1-9]\d*)(\.\d+)?$/),z.null()]);
/** The `comparison` block of an `atp.template/1.2` ReportInput. */
export const ComparisonBlockSchema=z.object({
  subjects:z.array(SubjectSchema).min(2).max(4),
  source_bindings:z.array(z.object({source_id:z.string(),subject_id:z.string()}).strict()).max(100),
  mappings:z.array(z.object({subject_id:z.string(),status:z.enum(MAPPING_STATUSES),kis_symbol:z.string(),corp_code:z.string(),evidence_source_id:z.union([z.string(),z.null()]),matched_rcept_nos:z.array(z.string()).max(100),corp_name:z.union([z.string(),z.null()]),acquisition:z.union([z.enum(ACQUISITION_KINDS),z.null()])}).strict()).max(4),
  acquisitions:z.array(z.object({source_id:z.string(),kind:z.enum(ACQUISITION_KINDS)}).strict()).max(100),
  rows:z.array(z.object({field_id:z.string(),cells:z.array(z.object({subject_id:z.string(),value:DecimalOrNull,source_id:z.union([z.string(),z.null()])}).strict()).min(2).max(4),comparable:z.boolean(),reasons:z.array(z.enum(COMPARISON_REASONS))}).strict()).max(500),
}).strict();
export type ComparisonBlock=z.infer<typeof ComparisonBlockSchema>;
type Mapping=ComparisonBlock['mappings'][number];

const SYMBOL=/^\d{6}$/;
const CORP_CODE=/^\d{8}$/;
// The derived subject (`compare:` + ids, names, venues joined) must fit the 200-character subject fields of the document.
const SUBJECT_TEXT_MAX=40;
const refuse=(code:string):never=>{throw new Error(code);};
const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);

/** REQ-SUB-002: 2 to 4 distinct subjects, no single `subject` beside them, report R02 only; Korean-won subjects only. */
export function validateComparisonSubjects(reportId:string,subject:unknown,subjects:readonly ComparisonSubject[]):ComparisonSubject[]{
  if(reportId!=='R02'||subject!==undefined||subjects.length<2||subjects.length>4)return refuse('comparison_subjects_invalid');
  for(const item of subjects){
    if(!SYMBOL.test(item.kis_symbol)||!CORP_CODE.test(item.corp_code_candidate)||item.currency.length<1)return refuse('comparison_subjects_invalid');
    if([item.id,item.name,item.venue].some(text=>text.length<1||text.length>SUBJECT_TEXT_MAX))return refuse('comparison_subjects_invalid');
  }
  for(const key of ['id','kis_symbol','corp_code_candidate'] as const)if(new Set(subjects.map(item=>item[key])).size!==subjects.length)return refuse('comparison_subjects_invalid');
  if(subjects.some(item=>item.currency!=='KRW'))return refuse('comparison_scope_unsupported');
  return subjects.map(item=>({...item}));
}

/** Header subject of a comparison document, derived from the subjects list (never taken from the caller). */
export function comparisonHeaderSubject(subjects:readonly ComparisonSubject[]):{id:string;name:string;venue:string;currency:string}{
  return {id:'compare:'+subjects.map(item=>item.id).join('+'),name:subjects.map(item=>item.name).join(' · '),venue:[...new Set(subjects.map(item=>item.venue))].join(' · '),currency:'KRW'};
}

// Each pilot tool owns exactly one shape: the top-level keys of its strict output schema (QuoteSnapshotSchema,
// openDartResultSchema, openDartFilingsResultSchema). A result with any other key — a metric-bearing contract, an
// observation list, a data block, another tool's request — is a shape that tool never returns, so it identifies nothing.
// None of the three outputs carries a `contract` key, so the observation carrier is refused under every tool name.
const QUOTE_OPERATION='kis.kr.quote.snapshot.v1';
const QUOTE_KEYS=['ok','provider','operation_id','market','instrument_ref','provenance','data','warnings','error'];
const FUNDAMENTALS_KEYS=['status','provider_status','error_code','request','provenance','source','documentation','rows'];
const FILINGS_KEYS=[...FUNDAMENTALS_KEYS,'total_count','total_page','next_page_no','has_more'];
const hasOnlyKeys=(payload:Record<string,unknown>,keys:readonly string[])=>Object.keys(payload).every(key=>keys.includes(key));

/** REQ-SUB-004 identity: read from the source's own content; a result that names nothing readable is unidentifiable. */
function identifySource(tool:string,payload:Record<string,unknown>):{field:'kis_symbol'|'corp_code_candidate';value:string}{
  if(tool==='get_market_snapshot'){
    if(payload.operation_id!==QUOTE_OPERATION||!hasOnlyKeys(payload,QUOTE_KEYS))return refuse('comparison_source_unidentifiable');
    const ref=payload.instrument_ref;
    if(!isRecord(ref)||typeof ref.symbol!=='string'||!SYMBOL.test(ref.symbol)||typeof ref.market!=='string'||typeof ref.asset_type!=='string')return refuse('comparison_source_unidentifiable');
    if(ref.market!=='KR'||ref.asset_type!=='equity')return refuse('comparison_scope_unsupported');
    return {field:'kis_symbol',value:ref.symbol};
  }
  const request=payload.request;
  if(!isRecord(request)||typeof request.corp_code!=='string'||!CORP_CODE.test(request.corp_code))return refuse('comparison_source_unidentifiable');
  // An OpenDART result of exactly this tool's key set; a financial statement request names `fs_div`, a filings list request does not.
  // A result under the other tool's name is not the source its name claims, so it identifies nothing.
  if(payload.source!=='opendart'||!hasOnlyKeys(payload,tool==='get_fundamentals'?FUNDAMENTALS_KEYS:FILINGS_KEYS))return refuse('comparison_source_unidentifiable');
  if(('fs_div' in request)!==(tool==='get_fundamentals'))return refuse('comparison_source_unidentifiable');
  // Rows that name another issuer than the request make the whole source unattributable.
  for(const row of Array.isArray(payload.rows)?payload.rows:[])if(isRecord(row)&&isRecord(row.raw)&&typeof row.raw.corp_code==='string'&&row.raw.corp_code!==request.corp_code)return refuse('comparison_source_subject_mismatch');
  return {field:'corp_code_candidate',value:request.corp_code};
}

export type ComparisonCall={tool_name:string;outcome:'success'|'error';source:Source|null;origin:'actual'|'synthetic'|'unverified';trusted:boolean;payload:Record<string,unknown>|null};
type Bound={call:ComparisonCall;source:Source;subject:ComparisonSubject};
export type ComparisonAnalysis={bindings:Map<string,ComparisonSubject>;acquisitions:Map<string,AcquisitionKind>;mappings:Mapping[];hidden:Set<string>;hiddenTables:Set<string>};

/** D5: a receipt of this process, else a synthetic source, else whatever the caller handed in. */
const acquisitionOf=(call:ComparisonCall):AcquisitionKind=>call.trusted?'process_receipt':call.origin==='synthetic'?'synthetic_fixture':'caller_supplied_unverified';

function filingRows(payload:Record<string,unknown>|null):{stock_code:string;rcept_no:string;corp_name:string|null}[]{
  if(payload===null||payload.status!=='ok'||!Array.isArray(payload.rows))return [];
  const rows:{stock_code:string;rcept_no:string;corp_name:string|null}[]=[];
  for(const row of payload.rows)if(isRecord(row)&&isRecord(row.raw))rows.push({stock_code:typeof row.raw.stock_code==='string'?row.raw.stock_code:'',rcept_no:typeof row.raw.rcept_no==='string'?row.raw.rcept_no:'',corp_name:typeof row.raw.corp_name==='string'?row.raw.corp_name:null});
  return rows;
}

/**
 * Binds every source to exactly one subject by its content, refuses the whole comparison on any
 * ambiguity (REQ-SUB-004), and decides each subject's issuer-mapping status (REQ-MAP-001).
 * An error result carries no source: it stays a missing value and is never a refusal.
 */
export function analyzeComparison(subjects:readonly ComparisonSubject[],calls:readonly ComparisonCall[]):ComparisonAnalysis{
  const bound:Bound[]=[];
  for(const call of calls){
    if(call.outcome==='error'||call.source===null)continue;
    if(call.payload===null)return refuse('comparison_source_unidentifiable');
    const identity=identifySource(call.tool_name,call.payload);
    const matches=subjects.filter(item=>item[identity.field]===identity.value);
    if(matches.length!==1)return refuse('comparison_source_subject_mismatch');
    bound.push({call,source:call.source,subject:matches[0]!});
  }
  // Synthetic and non-synthetic sources never share a comparison, within one subject or across subjects.
  if(new Set(bound.map(item=>item.call.origin==='synthetic')).size>1)return refuse('comparison_origin_mixed');
  // One source per tool and subject: a second one would leave a field with two competing values.
  const seen=new Set<string>();
  for(const item of bound){const key=item.subject.id+'\u0000'+item.call.tool_name;if(seen.has(key))return refuse('comparison_source_subject_mismatch');seen.add(key);}
  // Canonical source order (subject order, then pilot-tool order) so nothing downstream depends on the order of `calls`.
  const toolRank=(item:Bound)=>COMPARISON_PILOT_TOOLS.indexOf(item.call.tool_name as typeof COMPARISON_PILOT_TOOLS[number]);
  bound.sort((left,right)=>subjects.indexOf(left.subject)-subjects.indexOf(right.subject)||toolRank(left)-toolRank(right));
  const mappings=subjects.map((subject):Mapping=>{
    const evidence=bound.find(item=>item.subject===subject&&item.call.tool_name==='get_public_filings');
    const rows=filingRows(evidence?evidence.call.payload:null);
    if(rows.some(row=>row.stock_code!==''&&row.stock_code!==subject.kis_symbol))return refuse('issuer_mapping_conflict');
    const matched=rows.filter(row=>row.stock_code===subject.kis_symbol);
    const status:MappingStatus=!evidence||matched.length===0?'unverified':evidence.call.origin==='synthetic'?'synthetic_fixture_match':evidence.call.origin==='actual'&&evidence.call.trusted?'verified_by_dart_filing':'unverified';
    const accepted=status==='unverified'?undefined:evidence;
    return {subject_id:subject.id,status,kis_symbol:subject.kis_symbol,corp_code:subject.corp_code_candidate,evidence_source_id:accepted?accepted.source.id:null,matched_rcept_nos:accepted?matched.map(row=>row.rcept_no):[],corp_name:accepted?matched[0]?.corp_name??null:null,acquisition:accepted?acquisitionOf(accepted.call):null};
  });
  const statusOf=new Map(mappings.map(item=>[item.subject_id,item.status]));
  // REQ-MAP-002: no DART-derived value of a subject without accepted evidence (nor an actual one under a synthetic match).
  // DART-derived is read from the source (its provider, or the payload naming OpenDART), never from the tool name the caller attached.
  const withheld=bound.filter(item=>{
    const status=statusOf.get(item.subject.id);
    return (item.source.provider==='opendart'||item.call.payload?.source==='opendart')&&(status==='unverified'||(status==='synthetic_fixture_match'&&item.call.origin==='actual'));
  });
  return {bindings:new Map(bound.map(item=>[item.source.id,item.subject])),acquisitions:new Map(bound.map(item=>[item.source.id,acquisitionOf(item.call)])),mappings,hidden:new Set(withheld.map(item=>item.source.id)),hiddenTables:new Set(withheld.map(item=>item.source.id))};
}

// A DART-derived value's period carries the filing receipt number and the term label of its issuer
// (`<year>:FY:<fs_div>:<statement>:<term>:<rcept_no>`); neither says anything about the period itself.
// The report code is 11011 for every DART metric the pipeline admits (dartReportedMetrics).
const DART_PERIOD=/^(\d{4}):FY:(?:CFS|OFS):(?:IS|BS|CF):.*:\d{14}$/;
const periodBasis=(metric:ComparableMetric)=>{const dart=DART_PERIOD.exec(metric.period);return (dart?`dart:${dart[1]}:11011`:`period:${metric.period}`)+`|${metric.period_kind}`;};

// `period_undated` marks a metric whose period is not a date its source reported: the source has no `source_as_of`
// and the pipeline took the receipt time instead (`source_as_of ?? received_at ?? observed_at`). The receipt time is
// one value for the whole run, so two undated metrics always carry equal periods, and that equality says nothing about
// the market date they describe. Only a flag set by the caller that can see the source is trusted; a caller that
// passes metrics alone (no flag) gets the period comparison it always had.
export type ComparableMetric=Pick<Metric,'value'|'unit'|'currency'|'scale'|'period'|'period_kind'|'scope'|'status'>&{missing_reason?:string|undefined;period_undated?:boolean|undefined};
/**
 * REQ-BAS-001: comparable only when every subject has a displayable value on an identical basis;
 * otherwise every applicable reason. An absent entry (a subject without the field) is a missing value.
 * A shown value whose period is undated makes the field `period_unconfirmed` (the dates are unknown, not different);
 * `period_mismatch` is judged among the dated values only. Nothing is converted, ranked or subtracted.
 */
export function judgeFieldComparability(metrics:readonly (ComparableMetric|null|undefined)[]):{comparable:boolean;reasons:ComparisonReason[]}{
  const reasons=new Set<ComparisonReason>();
  const shown:ComparableMetric[]=[];
  for(const metric of metrics){
    if(!metric){reasons.add('value_missing');continue;}
    if(metric.value!==null){shown.push(metric);continue;}
    const rights=metric.status==='rights_pending',mapping=metric.missing_reason==='issuer_mapping_unverified';
    if(rights)reasons.add('rights_not_confirmed');
    if(mapping)reasons.add('issuer_mapping_unverified');
    if(!rights&&!mapping)reasons.add('value_missing');
  }
  const differ=(pick:(metric:ComparableMetric)=>unknown)=>new Set(shown.map(pick)).size>1;
  if(shown.some(metric=>metric.unit.includes('배율 미확인')))reasons.add('scale_unconfirmed');
  const dated=shown.filter(metric=>metric.period_undated!==true);
  if(dated.length<shown.length)reasons.add('period_unconfirmed');
  if(new Set(dated.map(periodBasis)).size>1)reasons.add('period_mismatch');
  if(differ(metric=>metric.scope))reasons.add('scope_mismatch');
  if(differ(metric=>metric.currency))reasons.add('currency_mismatch');
  if(differ(metric=>metric.unit))reasons.add('unit_mismatch');
  if(differ(metric=>metric.scale))reasons.add('scale_mismatch');
  return {comparable:reasons.size===0,reasons:COMPARISON_REASONS.filter(reason=>reasons.has(reason))};
}

export type ComparisonParts={sources:readonly Source[];metrics:readonly Metric[];source_tables:readonly SourceTable[];visuals:readonly Visual[]};
/**
 * D6 and REQ-MAP-002 on the assembled parts: hide the DART values of unaccepted subjects (metrics, their period,
 * which carries the filing receipt number, and every source table including the filing list),
 * prefix every metric label, source title, table title and visual title with the owning
 * subject's name, and derive the comparison rows in the request's subject order.
 */
export function attributeComparison(subjects:readonly ComparisonSubject[],analysis:ComparisonAnalysis,parts:ComparisonParts):{sources:Source[];metrics:Metric[];source_tables:SourceTable[];visuals:Visual[];comparison:ComparisonBlock}{
  const prefix=(sourceId:string,text:string)=>{const owner=analysis.bindings.get(sourceId);return owner?`${owner.name} · ${text}`:text;};
  const metrics:Metric[]=parts.metrics.map(metric=>{
    const shown:Metric=analysis.hidden.has(metric.source_id)?{...metric,value:null,status:metric.status==='rights_pending'?'rights_pending':'missing',missing_reason:'issuer_mapping_unverified',period:'issuer_mapping_unverified'}:metric;
    return {...shown,label:prefix(metric.source_id,metric.label)};
  });
  const sources=parts.sources.map(source=>({...source,title:prefix(source.id,source.title)}));
  const source_tables=parts.source_tables.filter(table=>!analysis.hiddenTables.has(table.source_id)).map(table=>({...table,title:prefix(table.source_id,table.title)}));
  const visuals=parts.visuals.map(visual=>({...visual,title:prefix(visual.source_id,visual.title)}));
  const ownerOf=(metric:Metric)=>analysis.bindings.get(metric.source_id)?.id;
  // The pipeline's own fallback, read back from the source: no `source_as_of` and a period equal to the receipt time.
  const sourceOf=new Map(parts.sources.map(source=>[source.id,source]));
  const periodUndated=(metric:Metric)=>{const source=sourceOf.get(metric.source_id);return source!==undefined&&(source.source_as_of===null||source.source_as_of===undefined)&&metric.period===(source.received_at??source.observed_at);};
  // Metrics in the canonical source order of the analysis (never the order of `calls`).
  const rank=new Map([...analysis.bindings.keys()].map((id,index)=>[id,index]));
  const ordered=[...metrics].sort((left,right)=>(rank.get(left.source_id)??rank.size)-(rank.get(right.source_id)??rank.size));
  // A field has one source per subject: a second source declaring it would leave two competing values and the row would
  // pick one by position, so the comparison is refused instead (the same refusal as a second source per tool and subject).
  const first=new Map<string,Metric>();
  for(const metric of ordered){
    const key=ownerOf(metric)+'\u0000'+metric.field_id;const held=first.get(key);
    if(held===undefined)first.set(key,metric);
    else if(held.source_id!==metric.source_id)return refuse('comparison_source_subject_mismatch');
  }
  // Row order follows the subjects' input order, then each subject's metric order; never a value order.
  const fieldIds=[...new Set(subjects.flatMap(subject=>ordered.filter(metric=>ownerOf(metric)===subject.id).map(metric=>metric.field_id)))];
  const rows=fieldIds.map(field_id=>{
    const found=subjects.map(subject=>first.get(subject.id+'\u0000'+field_id));
    const verdict=judgeFieldComparability(found.map(metric=>metric&&{...metric,period_undated:periodUndated(metric)}));
    return {field_id,cells:subjects.map((subject,index)=>({subject_id:subject.id,value:found[index]?.value??null,source_id:found[index]?.source_id??null})),comparable:verdict.comparable,reasons:verdict.reasons};
  });
  return {sources,metrics,source_tables,visuals,comparison:{
    subjects:subjects.map(subject=>({...subject})),
    source_bindings:[...analysis.bindings].map(([source_id,subject])=>({source_id,subject_id:subject.id})),
    mappings:analysis.mappings,
    acquisitions:[...analysis.acquisitions].map(([source_id,kind])=>({source_id,kind})),
    rows,
  }};
}

export type ComparisonInvariantInput={contract_version:string;report_id:string;sources:readonly {id:string;kind:string;rights:string;validation_status?:string|undefined}[];comparison?:ComparisonBlock|undefined};
/**
 * REQ-TRU-001 / D7: the issues of a contract-1.2 document, one message per clause, independent of each other.
 * The five clause messages are emitted by those five clauses only; the structure rules emit their own.
 */
export function comparisonInvariantIssues(doc:ComparisonInvariantInput):string[]{
  const issues=new Set<string>();
  const is12=doc.contract_version==='atp.template/1.2';
  if(doc.comparison===undefined){if(is12)issues.add('comparison_block_required');return [...issues];}
  if(!is12)issues.add('comparison_requires_contract_1_2');
  if(doc.report_id!=='R02')issues.add('comparison_requires_report_r02');
  if(!is12)return [...issues];
  const block=doc.comparison;
  const sources=new Map(doc.sources.map(source=>[source.id,source]));
  const subjectIds=new Set(block.subjects.map(subject=>subject.id));
  // Structure: every source is bound exactly once to a listed subject and labelled exactly once; one mapping per subject.
  for(const source of doc.sources){
    const bindings=block.source_bindings.filter(binding=>binding.source_id===source.id);
    if(bindings.length!==1||!subjectIds.has(bindings[0]!.subject_id))issues.add('comparison_source_binding_invalid');
    if(block.acquisitions.filter(label=>label.source_id===source.id).length!==1)issues.add('comparison_acquisition_label_invalid');
  }
  if(block.mappings.length!==subjectIds.size||new Set(block.mappings.map(mapping=>mapping.subject_id)).size!==subjectIds.size||block.mappings.some(mapping=>!subjectIds.has(mapping.subject_id)))issues.add('comparison_mapping_invalid');
  // Clause user_supplied: a comparison document holds no user-supplied source.
  if(doc.sources.some(source=>source.kind==='user_supplied'))issues.add('comparison_user_supplied_source');
  // Clauses existence, kind, rights and validation status, on both label paths: a source labelled
  // `process_receipt` and the evidence source of a `verified_by_dart_filing` mapping.
  const labelled=[...block.acquisitions.filter(label=>label.kind==='process_receipt').map(label=>label.source_id),...block.mappings.filter(mapping=>mapping.status==='verified_by_dart_filing').map(mapping=>mapping.evidence_source_id??'')];
  for(const id of labelled){
    const source=sources.get(id);
    if(!source){issues.add('label_source_missing');continue;}
    if(source.kind==='synthetic'||source.kind==='user_supplied')issues.add('label_source_kind_invalid');
    if(source.rights!=='local_view')issues.add('label_source_rights_invalid');
    if(source.validation_status!=='provider_shape_checked')issues.add('label_source_validation_invalid');
  }
  return [...issues];
}

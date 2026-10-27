// SPEC-ATP-R02-001 T1 (card t5-A): synthetic fixtures and harness helpers for the R02 comparison tests.
// Everything here is synthetic. The numbers below are test identifiers that make no claim about any
// real issuer; the corp_code <-> stock_code relation is decided only by the filing rows these helpers
// create. Nothing here reaches a provider: transports are in-process objects that count their calls.
//
// CONTRACT SHAPE UNDER TEST (chosen by T1, read ONLY through the accessors at the bottom of this file).
// The SPEC fixes the vocabulary (contract atp.template/1.2, a `comparison` block, per-subject mapping
// status, acquisition kinds, row keys {field_id,cells,comparable,reasons}); the remaining key names are
// fixed here so that M1 has one target. A rename in M1 is a one-place edit in the accessors, and must be
// reported to the lane, never made silently:
//   doc.comparison = {
//     subjects:       [{id,name,venue,currency,kis_symbol,corp_code_candidate}]            input order
//     source_bindings:[{source_id,subject_id}]                  every doc.sources[].id exactly once
//     mappings:       [{subject_id,status,kis_symbol,corp_code,evidence_source_id|null,
//                       matched_rcept_nos:string[],corp_name|null,acquisition|null}]       one per subject
//     acquisitions:   [{source_id,kind}]                        kind in the closed acquisition set
//     rows:           [{field_id,cells:[{subject_id,value|null,source_id|null}],comparable,reasons:string[]}]
//   }
// Tool results come in the shapes the existing tools return (normalizeKrQuote, parseOpenDartFullStatement,
// parseOpenDartFilings), so the fixtures also exercise the real normalizers.
import assert from 'node:assert/strict';
import {InMemoryTransport} from '@modelcontextprotocol/server';
import {normalizeKrQuote} from '../src/normalize-kr-quote.js';
import {parseOpenDartFullStatement} from '../src/opendart.js';
import {parseOpenDartFilings} from '../src/opendart-filings.js';
import {buildReportInput} from '../src/report-pipeline.js';
import {createStockMcpServer} from './synthetic-member-access.js';

export const CUTOFF='2026-10-23T03:00:00.000Z';
export const RECEIVED=CUTOFF;

export type Origin='synthetic'|'actual';
export type Subject={id:string;name:string;venue:string;currency:string;kis_symbol:string;corp_code_candidate:string};
export type Call={tool_name:string;result:unknown};
export const mk=(id:string,name:string,kis_symbol:string,corp_code_candidate:string):Subject=>({id,name,venue:'KRX',currency:'KRW',kis_symbol,corp_code_candidate});
export const SUBJECT_A=mk('KRX:005930','합성전자','005930','00126380');
export const SUBJECT_B=mk('KRX:000660','합성하이닉스','000660','00164779');
export const SUBJECT_C=mk('KRX:035420','합성포털','035420','00266961');
export const SUBJECT_D=mk('KRX:051910','합성화학','051910','00356361');
export const SUBJECT_E=mk('KRX:066570','합성부품','066570','00401731');
/** A symbol that belongs to no subject of the comparison (AC-003a). */
export const SUBJECT_OTHER=mk('KRX:035720','합성다른종목','035720','00999001');
export const SUBJECTS_AB=[SUBJECT_A,SUBJECT_B];
export const ACQUISITION_KINDS=['process_receipt','caller_supplied_unverified','synthetic_fixture'] as const;
export const MAPPING_STATUSES=['verified_by_dart_filing','synthetic_fixture_match','unverified'] as const;
export const REASONS=['period_mismatch','period_unconfirmed','scope_mismatch','currency_mismatch','unit_mismatch','scale_mismatch','scale_unconfirmed','value_missing','rights_not_confirmed','issuer_mapping_unverified'] as const;
export const NEW_CODES=['comparison_subjects_invalid','comparison_source_subject_mismatch','comparison_source_unidentifiable','comparison_tool_not_supported','comparison_scope_unsupported','comparison_origin_mixed','issuer_mapping_conflict','comparison_narrative_not_supported'] as const;
/** The five D7 clause messages; every clause emits its own and only its own. */
export const CLAUSE_MESSAGES=['comparison_user_supplied_source','label_source_missing','label_source_kind_invalid','label_source_rights_invalid','label_source_validation_invalid'] as const;
/** Live-query phrase set L (acceptance.md "실조회 문구 집합 L"). */
export const LIVE_PHRASES=['실시간 조회','실조회','새 조회','live query','fresh query','실시간','최신 조회','현재 조회'] as const;
export const SENTINEL_AMOUNT='7777777001';

// ---------------------------------------------------------------- tool results
export const toolResult=(structured:unknown)=>({structuredContent:structured,content:[{type:'text',text:JSON.stringify(structured)}]});
export const errorResult=(code:string)=>({isError:true,content:[{type:'text',text:`error_code=${code}`}]});

// Every compared quote field of B is larger than A's, so a value-sorted implementation puts B first.
const QUOTE_RAW:Record<string,Record<string,string>>={
  '005930':{stck_prpr:'100',stck_oprc:'90',stck_hgpr:'110',stck_lwpr:'80',prdy_vrss:'10',prdy_vrss_sign:'2',prdy_ctrt:'10.5',acml_vol:'1000',stck_bsop_date:'20261022'},
  '000660':{stck_prpr:'200',stck_oprc:'190',stck_hgpr:'210',stck_lwpr:'180',prdy_vrss:'20',prdy_vrss_sign:'2',prdy_ctrt:'12.5',acml_vol:'2000',stck_bsop_date:'20261022'},
  '035420':{stck_prpr:'300',stck_oprc:'290',stck_hgpr:'310',stck_lwpr:'280',prdy_vrss:'30',prdy_vrss_sign:'2',prdy_ctrt:'13.5',acml_vol:'3000',stck_bsop_date:'20261022'},
  '051910':{stck_prpr:'400',stck_oprc:'390',stck_hgpr:'410',stck_lwpr:'380',prdy_vrss:'40',prdy_vrss_sign:'2',prdy_ctrt:'14.5',acml_vol:'4000',stck_bsop_date:'20261022'},
  '066570':{stck_prpr:'500',stck_oprc:'490',stck_hgpr:'510',stck_lwpr:'480',prdy_vrss:'50',prdy_vrss_sign:'2',prdy_ctrt:'15.5',acml_vol:'5000',stck_bsop_date:'20261022'},
  '035720':{stck_prpr:'600',stck_oprc:'590',stck_hgpr:'610',stck_lwpr:'580',prdy_vrss:'60',prdy_vrss_sign:'2',prdy_ctrt:'16.5',acml_vol:'6000',stck_bsop_date:'20261022'},
};
const RCEPT:Record<string,string>={'005930':'20260310000001','000660':'20260311000002','035420':'20260312000003','051910':'20260313000004','066570':'20260314000005','035720':'20260315000006'};
const TERM:Record<string,string>={'005930':'제 56 기','000660':'제 72 기','035420':'제 33 기','051910':'제 25 기','066570':'제 40 기','035720':'제 12 기'};
const REVENUE:Record<string,string>={'005930':'1234567890','000660':'2234567890','035420':'3234567890','051910':'4234567890','066570':'5234567890','035720':'6234567890'};

export type QuoteOpts={origin?:Origin;symbol?:string;date?:string;omit?:readonly string[];assetType?:string};
export function quoteResult(subject:Subject,o:QuoteOpts={}){
  const symbol=o.symbol??subject.kis_symbol;
  const raw={...QUOTE_RAW[symbol]!};
  if(o.date)raw.stck_bsop_date=o.date;
  for(const key of o.omit??[])delete raw[key];
  const snapshot:any=normalizeKrQuote(raw,{symbol,board:'J',receivedAt:RECEIVED,origin:o.origin??'synthetic'});
  if(o.assetType)snapshot.instrument_ref={...snapshot.instrument_ref,asset_type:o.assetType};
  return toolResult(snapshot);
}
export const quoteRaw=(symbol:string)=>({...QUOTE_RAW[symbol]!});

export type DartOpts={origin?:Origin;year?:string;fsDiv?:'CFS'|'OFS';currency?:string;revenue?:string;corpCode?:string;termName?:string;rceptNo?:string};
function dartRows(subject:Subject,o:DartOpts):Record<string,unknown>[]{
  const corp=o.corpCode??subject.corp_code_candidate;const year=o.year??'2025';
  const rcept=o.rceptNo??RCEPT[subject.kis_symbol]!;const term=o.termName??TERM[subject.kis_symbol]!;const currency=o.currency??'KRW';
  const revenue=o.revenue??REVENUE[subject.kis_symbol]!;
  const base={rcept_no:rcept,reprt_code:'11011',bsns_year:year,corp_code:corp,thstrm_nm:term,frmtrm_nm:'전기',currency};
  return [
    {...base,sj_div:'IS',sj_nm:'손익계산서',account_id:'ifrs-full_Revenue',account_nm:'매출액',thstrm_amount:revenue,frmtrm_amount:'1000000007',ord:'1'},
    {...base,sj_div:'IS',sj_nm:'손익계산서',account_id:'dart_OperatingIncomeLoss',account_nm:'영업이익',thstrm_amount:'234567890',frmtrm_amount:'200000003',ord:'2'},
    {...base,sj_div:'BS',sj_nm:'재무상태표',account_id:'ifrs-full_Assets',account_nm:'자산총계',thstrm_amount:'9234567890',frmtrm_amount:'9000000005',ord:'3'},
  ];
}
/** Raw provider payload as a transport would return it. */
export const dartPayload=(subject:Subject,o:DartOpts={})=>({status:'000',message:'ok',list:dartRows(subject,o)});
export function fundamentalsResult(subject:Subject,o:DartOpts={}){
  const input={corp_code:o.corpCode??subject.corp_code_candidate,bsns_year:o.year??'2025',reprt_code:'11011',fs_div:o.fsDiv??'CFS'};
  return toolResult(parseOpenDartFullStatement(input,dartPayload(subject,o),{origin:o.origin??'synthetic',received_at:RECEIVED}));
}

export type FilingsOpts={origin?:Origin;stockCode?:string;corpCode?:string;corpName?:string;noData?:boolean;rows?:readonly {stockCode:string;rceptNo:string}[]};
const FILINGS_INPUT=(corp:string)=>({corp_code:corp,bgn_de:'20260101',end_de:'20261022'});
export function filingsPayload(subject:Subject,o:FilingsOpts={}){
  if(o.noData)return {status:'013',message:'no data'};
  const corp=o.corpCode??subject.corp_code_candidate;
  const plan=o.rows??[{stockCode:o.stockCode??subject.kis_symbol,rceptNo:RCEPT[subject.kis_symbol]!},{stockCode:o.stockCode??subject.kis_symbol,rceptNo:'2026042000000'+subject.kis_symbol.slice(-1)}];
  const list=plan.map((row,i)=>({corp_cls:'Y',corp_name:o.corpName??`${subject.name} 주식회사`,corp_code:corp,stock_code:row.stockCode,report_nm:i===0?'사업보고서 (2025.12)':'반기보고서 (2026.06)',rcept_no:row.rceptNo,flr_nm:subject.name,rcept_dt:i===0?'20260310':'20260420',rm:''}));
  return {status:'000',message:'ok',page_no:1,page_count:100,total_count:list.length,total_page:1,list};
}
export function filingsResult(subject:Subject,o:FilingsOpts={}){
  const corp=o.corpCode??subject.corp_code_candidate;
  return toolResult(parseOpenDartFilings(FILINGS_INPUT(corp),filingsPayload(subject,o),{origin:o.origin??'synthetic',received_at:RECEIVED}));
}
/** `get_fundamentals` result in the observation contract: it names no instrument or issuer (AC-003c). */
export const unidentifiedFundamentalsResult=()=>toolResult({contract:'moai.stock.report-observations.v1',origin:'synthetic',operation_id:'r02-unidentified-fixture',provenance:{origin:'synthetic',source_as_of:'2026-10-22',validation_status:'synthetic_fixture',provider_api_version:'fixture-only'},observations:[{field_id:'reported.revenue',label:'매출',value:'1000',unit:'KRW',currency:'KRW',period:'2025-FY',scale:'1',period_kind:'FY',scope:'consolidated'}]});
/** A tool outside the pilot set (AC-003d). */
export const priceHistoryCall=():Call=>{
  const bar=(date:string)=>({date,open:'100',high:'101',low:'99',close:'100',volume:'1000',turnover:'100000',currency:'KRW',price_unit:'KRW/share',volume_unit:'shares',turnover_unit:'KRW',adjusted:false,source_ref:'fixture-only',mapping_status:'verified',blockers:[]});
  return {tool_name:'get_price_history',result:toolResult({contract:'moai.stock.price-history.v1',provider:'kis',operation_id:'KIS-039-fixture-only',origin:'synthetic',source_as_of:'2026-10-22',received_at:RECEIVED,rights_status:'pending',bars:[bar('2026-10-21'),bar('2026-10-22')]})};
};

// ---------------------------------------------------------------- call lists and request arguments
export type Over={quote?:Call|null;funds?:Call|null;filings?:Call|null};
export type Opts={quote?:QuoteOpts;funds?:DartOpts;filings?:FilingsOpts};
/** [quote, fundamentals, filings] of one subject; an `over` entry replaces a call, null drops it. */
export function callsOf(subject:Subject,origin:Origin,over:Over={},opts:Opts={}):Call[]{
  const out:Call[]=[];
  const quote=over.quote===undefined?{tool_name:'get_market_snapshot',result:quoteResult(subject,{origin,...opts.quote})}:over.quote;
  const funds=over.funds===undefined?{tool_name:'get_fundamentals',result:fundamentalsResult(subject,{origin,...opts.funds})}:over.funds;
  const filings=over.filings===undefined?{tool_name:'get_public_filings',result:filingsResult(subject,{origin,...opts.filings})}:over.filings;
  for(const call of [quote,funds,filings])if(call)out.push(call);
  return out;
}
/** Flatten per-subject call groups and reverse them: call order is the opposite of subject order. */
export const reversedCalls=(groups:readonly Call[][]):Call[]=>groups.flat().reverse();
export function allCalls(subjects:readonly Subject[],origin:Origin):Call[]{return reversedCalls(subjects.map(subject=>callsOf(subject,origin)));}
/** Arguments for the function harness. `subjects` is deliberately not part of BuildReportInputArgs yet. */
export const comparisonArgs=(subjects:readonly Subject[],calls:readonly Call[],extra:Record<string,unknown>={})=>({report_id:'R02',subjects:subjects.map(s=>({...s})),cutoff:CUTOFF,display_timezone:'Asia/Seoul',received_at:RECEIVED,calls,...extra});
/** Arguments for the build_report_input tool (no received_at: the server stamps it). */
export const mcpArgs=(args:Record<string,unknown>)=>{const {received_at:_ignored,...rest}=args;return rest;};

export const describeError=(error:unknown)=>error instanceof Error?error.message.slice(0,200):String(error).slice(0,200);
export function buildDoc(args:Record<string,unknown>):any{
  try{return buildReportInput(args as unknown as Parameters<typeof buildReportInput>[0]) as any;}
  catch(error){return assert.fail(`comparison document could not be built: ${describeError(error)}`);}
}
/** Refusal code thrown by the function harness, or a description of what happened instead. */
export function refusalOf(args:Record<string,unknown>):string{
  try{buildReportInput(args as unknown as Parameters<typeof buildReportInput>[0]);return 'NOT_REFUSED_DOCUMENT_BUILT';}
  catch(error){return describeError(error);}
}

// ---------------------------------------------------------------- MCP harness
export type Rpc=(method:string,params:Record<string,unknown>)=>Promise<any>;
export type McpSession={rpc:Rpc;close:()=>Promise<void>};
export async function openMcp(server:ReturnType<typeof createStockMcpServer>):Promise<McpSession>{
  const [client,peer]=InMemoryTransport.createLinkedPair();let id=0;const pending=new Map<number,(reply:any)=>void>();
  client.onmessage=(message:any)=>{const done=pending.get(message.id);if(done){pending.delete(message.id);done(message);}};
  const rpc:Rpc=async(method,params)=>{
    const n=++id;let timer:ReturnType<typeof setTimeout>|undefined;
    const answer=new Promise<any>((resolve,reject)=>{timer=setTimeout(()=>{pending.delete(n);reject(new Error('r02_mcp_timeout'));},10_000);pending.set(n,resolve);});
    try{await client.send({jsonrpc:'2.0',id:n,method,params} as any);return await answer;}finally{clearTimeout(timer);}
  };
  await client.start();await server.connect(peer);
  await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'r02-comparison-test',version:'1'}});
  await client.send({jsonrpc:'2.0',method:'notifications/initialized'} as any);
  return {rpc,close:async()=>{await server.close();await client.close();}};
}
/** Observable outcome of a tool reply: OK, the error_code token, or a description of any other refusal. */
export function outcomeOf(reply:any):{ok:boolean;code:string}{
  if(reply?.error)return {ok:false,code:`protocol_error:${String(reply.error.message).slice(0,140)}`};
  const result=reply?.result;
  if(result?.isError){
    const text=String(result.content?.[0]?.text??'');const match=/error_code=([A-Za-z0-9_]+)/.exec(text);
    return {ok:false,code:match?match[1]!:`isError:${text.slice(0,140)}`};
  }
  return {ok:true,code:'OK'};
}
export const hasResourceLink=(reply:any)=>Array.isArray(reply?.result?.content)&&reply.result.content.some((item:any)=>item?.type==='resource_link');
/** A refusal at render time: either the handler's code or the SDK's input-schema refusal in front of it. */
export function isRenderRefusal(reply:any):boolean{
  const outcome=outcomeOf(reply);
  return !outcome.ok&&!hasResourceLink(reply)&&(outcome.code==='schema_drift'||outcome.code==='invalid_provenance'||outcome.code.startsWith('isError:Input validation error'));
}

export type Counters={quote:number;dart:number;filings:number};
export type ActualServerOptions={retained?:Subject;localView?:boolean};
/** Server whose providers are in-process synthetic transports labelled `actual`, so receipts can be issued. */
export function actualServer(o:ActualServerOptions={}){
  const counters:Counters={quote:0,dart:0,filings:0};
  const bySymbol=(symbol:string)=>QUOTE_RAW[symbol];
  const known=[SUBJECT_A,SUBJECT_B,SUBJECT_C,SUBJECT_D,SUBJECT_E,SUBJECT_OTHER];
  const subjectOf=(corp:string)=>known.find(s=>s.corp_code_candidate===corp);
  const server=createStockMcpServer({
    rightsEnabled:true,localReportViewEnabled:o.localView??true,openDartEnabled:true,origin:'actual',clock:()=>CUTOFF,
    transport:{async getMarketSnapshot(symbol){counters.quote++;const raw=bySymbol(symbol);if(!raw)throw new Error('r02_unknown_symbol');return {...raw};}},
    openDartTransport:{origin:'actual',async send(request){counters.dart++;const subject=subjectOf(request.params.corp_code);if(!subject)throw new Error('r02_unknown_corp');return dartPayload(subject,{corpCode:request.params.corp_code});}},
    filingsTransport:{origin:'actual',async send(request){counters.filings++;const subject=subjectOf(request.params.corp_code);if(!subject)throw new Error('r02_unknown_corp');return filingsPayload(subject,{corpCode:request.params.corp_code});}},
    ...(o.retained?{retainedQuoteSnapshot:(quoteResult(o.retained,{origin:'actual'}).structuredContent as never)}:{}),
  });
  return {server,counters};
}
export type ReceiptKind='quote'|'funds'|'filings';
/** Issue one provider receipt through the real tool and return its id. */
export async function receiptFor(rpc:Rpc,kind:ReceiptKind,subject:Subject):Promise<string>{
  const call=kind==='quote'?{name:'get_market_snapshot',arguments:{symbol:subject.kis_symbol,board:'J'}}
    :kind==='funds'?{name:'get_fundamentals',arguments:{corp_code:subject.corp_code_candidate,bsns_year:'2025',reprt_code:'11011',fs_div:'CFS'}}
    :{name:'get_public_filings',arguments:{corp_code:subject.corp_code_candidate,bgn_de:'20260101',end_de:'20261022'}};
  const reply=await rpc('tools/call',call);
  const id=reply?.result?._meta?.['moai-atp.local-evidence'];
  assert.ok(typeof id==='string'&&id.length>0,`${call.name} for ${subject.kis_symbol} issued no receipt: ${JSON.stringify(outcomeOf(reply))}`);
  return id as string;
}
/** Receipts of all three tools for each subject, subject order, [quote, funds, filings] within one subject. */
export async function receiptsFor(rpc:Rpc,subjects:readonly Subject[]):Promise<string[]>{
  const ids:string[]=[];
  for(const subject of subjects)for(const kind of ['quote','funds','filings'] as const)ids.push(await receiptFor(rpc,kind,subject));
  return ids;
}
export const mcpBuild=(rpc:Rpc,args:Record<string,unknown>)=>rpc('tools/call',{name:'build_report_input',arguments:mcpArgs(args)});
export const mcpRender=(rpc:Rpc,reportInput:unknown,extra:Record<string,unknown>={})=>rpc('tools/call',{name:'render_report_html',arguments:{report_input:reportInput,...extra}});
/** MCP request over receipts: the receipt order is the reverse of the subject order. */
export const receiptArgs=(subjects:readonly Subject[],receipts:readonly string[],extra:Record<string,unknown>={})=>({report_id:'R02',subjects:subjects.map(s=>({...s})),cutoff:CUTOFF,display_timezone:'Asia/Seoul',source_receipts:[...receipts].reverse(),...extra});
/** Build over a fresh synthetic-calls MCP session (default server, no transports). */
export async function withDefaultSession<T>(work:(rpc:Rpc)=>Promise<T>):Promise<T>{
  const session=await openMcp(createStockMcpServer({clock:()=>CUTOFF}));
  try{return await work(session.rpc);}finally{await session.close();}
}

// ---------------------------------------------------------------- accessors for the 1.2 comparison block
export const sourceTool=(sourceId:string)=>sourceId.replace(/^src-\d+-/,'');
export const bindingMap=(doc:any):Map<string,string>=>new Map((doc.comparison?.source_bindings??[]).map((b:any)=>[b.source_id,b.subject_id]));
export const subjectName=(doc:any,subjectId:string):string=>doc.comparison.subjects.find((s:any)=>s.id===subjectId)?.name;
export const sourceIdsOf=(doc:any,subjectId:string,tool?:string):string[]=>doc.sources.map((s:any)=>s.id as string).filter((id:string)=>bindingMap(doc).get(id)===subjectId&&(tool===undefined||sourceTool(id)===tool));
export const metricsOf=(doc:any,subjectId:string,tool?:string):any[]=>{const ids=new Set(sourceIdsOf(doc,subjectId,tool));return doc.metrics.filter((m:any)=>ids.has(m.source_id));};
export const rowFor=(doc:any,fieldId:string):any=>{const row=(doc.comparison?.rows??[]).find((r:any)=>r.field_id===fieldId);assert.ok(row,`comparison row ${fieldId} exists`);return row;};
export const mappingOf=(doc:any,subjectId:string):any=>{const mapping=(doc.comparison?.mappings??[]).find((m:any)=>m.subject_id===subjectId);assert.ok(mapping,`mapping of ${subjectId} exists`);return mapping;};
export const acquisitionOf=(doc:any,sourceId:string):string|undefined=>(doc.comparison?.acquisitions??[]).find((a:any)=>a.source_id===sourceId)?.kind;
export const reasonSet=(row:any):string[]=>[...new Set<string>(row.reasons)].sort();
/** Which of the five D7 clause messages a failed safeParse produced, as a sorted set. */
export function clauseMessages(parsed:{success:boolean;error?:{issues:readonly {message:string}[]}}):string[]{
  if(parsed.success)return [];
  return [...new Set((parsed.error?.issues??[]).map(i=>i.message).filter(m=>(CLAUSE_MESSAGES as readonly string[]).includes(m)))].sort();
}
/** Find (and assert) the sources of the A subject in a built document. */
export function firstSourceOf(doc:any,subject:Subject,tool:string):string{
  const id=sourceIdsOf(doc,subject.id,tool)[0];
  assert.ok(id,`document has a ${tool} source bound to ${subject.id}`);
  return id as string;
}

// ---------------------------------------------------------------- AC-007h forgery generators
// Each forger takes a valid synthetic comparison document (AC-002a) and returns a copy that breaks
// exactly one D7 clause. Sources they alter lose the tables and visuals that point at them, so the
// frozen display rule (allowed(), report-pipeline.ts:170-172) does not fire. All shape knowledge about
// labels lives here and in the accessors above.
function detach(doc:any,sourceId:string){
  if(Array.isArray(doc.source_tables))doc.source_tables=doc.source_tables.filter((t:any)=>t.source_id!==sourceId);
  if(Array.isArray(doc.visuals))doc.visuals=doc.visuals.filter((v:any)=>v.source_id!==sourceId);
}
function relabel(doc:any,sourceId:string,kind:string){
  const label=(doc.comparison.acquisitions as any[]).find(a=>a.source_id===sourceId);
  if(label)label.kind=kind;else doc.comparison.acquisitions.push({source_id:sourceId,kind});
}
function patchSource(doc:any,sourceId:string,patch:Record<string,unknown>){
  const source=(doc.sources as any[]).find(s=>s.id===sourceId);assert.ok(source,`source ${sourceId} to forge exists`);Object.assign(source,patch);detach(doc,sourceId);
}
function verifyMapping(doc:any,subjectId:string,evidenceSourceId:string){
  const mapping=mappingOf(doc,subjectId);mapping.status='verified_by_dart_filing';mapping.evidence_source_id=evidenceSourceId;
}
export type ForgeKey='v'|'vi'|'vii'|'viii'|'ix'|'x'|'xi'|'xii'|'xiii'|'aux-i'|'aux-ii'|'aux-iii'|'aux-iv';
export const CLAUSE_OF:Record<'v'|'vi'|'vii'|'viii'|'ix'|'x'|'xi'|'xii'|'xiii',string>={v:'label_source_missing',vi:'label_source_kind_invalid',vii:'label_source_kind_invalid',viii:'label_source_validation_invalid',ix:'comparison_user_supplied_source',x:'label_source_rights_invalid',xi:'label_source_missing',xii:'label_source_rights_invalid',xiii:'label_source_validation_invalid'};
export function forge(base:any,key:ForgeKey,subject:Subject=SUBJECT_A):any{
  const doc=structuredClone(base);
  const quote=firstSourceOf(doc,subject,'get_market_snapshot');const filings=firstSourceOf(doc,subject,'get_public_filings');
  switch(key){
    case 'v':relabel(doc,'src-missing','process_receipt');break;
    case 'vi':patchSource(doc,quote,{kind:'synthetic',rights:'local_view',validation_status:'provider_shape_checked'});relabel(doc,quote,'process_receipt');break;
    case 'vii':patchSource(doc,filings,{kind:'synthetic',rights:'local_view',validation_status:'provider_shape_checked'});verifyMapping(doc,subject.id,filings);break;
    case 'viii':patchSource(doc,quote,{kind:'kis',rights:'local_view',validation_status:'unverified'});relabel(doc,quote,'process_receipt');break;
    case 'ix':
      doc.sources.push({id:'src-user-forged',kind:'user_supplied',title:'사용자 제공 위조 출처',url:null,observed_at:CUTOFF,available_at:CUTOFF,rights:'local_view',revision:'user-input-v1',validation_status:'unverified'});
      doc.comparison.source_bindings.push({source_id:'src-user-forged',subject_id:subject.id});
      doc.comparison.acquisitions.push({source_id:'src-user-forged',kind:'caller_supplied_unverified'});break;
    case 'x':patchSource(doc,quote,{kind:'kis',rights:'pending',validation_status:'provider_shape_checked'});relabel(doc,quote,'process_receipt');break;
    case 'xi':verifyMapping(doc,subject.id,'src-missing-evidence');break;
    case 'xii':patchSource(doc,filings,{kind:'opendart',rights:'pending',validation_status:'provider_shape_checked'});verifyMapping(doc,subject.id,filings);break;
    case 'xiii':patchSource(doc,filings,{kind:'opendart',rights:'local_view',validation_status:'unverified'});verifyMapping(doc,subject.id,filings);break;
    case 'aux-i':verifyMapping(doc,subject.id,filings);break;
    case 'aux-ii':relabel(doc,quote,'process_receipt');break;
    case 'aux-iii':
      patchSource(doc,quote,{kind:'user_supplied',rights:'local_view',validation_status:'unverified'});relabel(doc,quote,'process_receipt');verifyMapping(doc,subject.id,filings);
      doc.mode='supplied';doc.execution_status='provided_unverified';break;
    case 'aux-iv':patchSource(doc,quote,{kind:'kis',rights:'local_view',validation_status:'provider_shape_checked'});relabel(doc,quote,'process_receipt');break;
  }
  return doc;
}

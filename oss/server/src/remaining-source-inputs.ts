import { createHash } from 'node:crypto';
import { constants, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { types, TextDecoder } from 'node:util';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ExactInstantSchema, compareInstants } from './exact-instant.js';

/** Offline, additive R01 source inputs. No network, credential, account, trade, route or metric dependency. */
export const REMAINING_SOURCE_LIMITS = Object.freeze({ body_bytes:262144, input_bytes:32768, persisted_bytes:1048576,
  depth:12, nodes:20000, entries:1024, rows:100, string_units:16384, key_units:128, number_units:128 });
export const REMAINING_SOURCE_ERRORS = Object.freeze(['invalid_input','invalid_snapshot','input_too_large','invalid_body_text',
  'body_too_large','invalid_json','duplicate_json_key','complexity_limit','invalid_metadata_number','capture_hash_mismatch',
  'future_receipt','unsupported_provider_status','upstream_rejected','provider_schema_drift','invalid_provider_date',
  'provider_date_mismatch','invalid_provider_numeric_string','request_contract_conflict','transport_failed','clock_failed',
  'unsupported_http_status','pagination_not_supported','evidence_mismatch','invalid_file'] as const);
export type RemainingSourceErrorCode = typeof REMAINING_SOURCE_ERRORS[number];
export class RemainingSourceError extends Error { constructor(readonly code:RemainingSourceErrorCode){super(code);this.name='RemainingSourceError';} }
function fail(code:RemainingSourceErrorCode):never {throw new RemainingSourceError(code);}
function need(value:unknown,code:RemainingSourceErrorCode):asserts value {if(!value)fail(code);}
function safe<T>(f:()=>T):T {try{return f();}catch(e){if(e instanceof RemainingSourceError)throw e;fail('invalid_input');}}
function wellFormed(s:string):boolean {for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=s.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}return true;}
function validDay(s:string):boolean {if(!/^\d{8}(?![\s\S])/.test(s)||Number(s.slice(0,4))<100)return false;
  const iso=`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`,d=new Date(`${iso}T00:00:00Z`);return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===iso;}
const Day=z.string().length(8).refine(validDay);
const Instant=z.string().max(80).regex(/^[\x20-\x7e]+(?![\s\S])/).pipe(ExactInstantSchema);
const Sha=z.string().length(64).regex(/^[a-f0-9]{64}(?![\s\S])/);
const OpaqueCode=z.string().max(12).regex(/^[A-Za-z0-9]*(?![\s\S])/);
const MarketQuery=z.object({FID_COND_MRKT_DIV_CODE:z.literal('U'),FID_INPUT_ISCD:OpaqueCode.min(1),
  FID_INPUT_DATE_1:Day,FID_INPUT_DATE_2:Day,FID_INPUT_ISCD_1:z.enum(['KSP','KSQ']),FID_INPUT_ISCD_2:OpaqueCode}).strict()
  .refine(q=>q.FID_INPUT_DATE_1===q.FID_INPUT_DATE_2);
const EstimateQuery=z.object({SHT_CD:z.string().regex(/^(?:\d{2}|\d{6})(?![\s\S])/)}).strict();
const IceQuery=z.object({NCOD:z.enum(['CN','HK','US','JP','VN']),SYMB:z.string().min(1).max(20).regex(/^[A-Z0-9][A-Z0-9.-]*(?![\s\S])/),
  ST_YMD:Day,ED_YMD:Day}).strict().refine(q=>q.ST_YMD<=q.ED_YMD);
/** Request-only public schemas, intentionally separate from capture/origin/receipt metadata. */
export const Kis113MarketInvestorRequestSchema=z.object({operation_ref:z.literal('KIS-113'),query:MarketQuery}).strict();
export const Kis109HouseEstimateRequestSchema=z.object({operation_ref:z.literal('KIS-109'),query:EstimateQuery}).strict();
export const Kis280IceActionRequestSchema=z.object({operation_ref:z.literal('KIS-280'),query:IceQuery}).strict();
export const RemainingSourceRequestSchema=z.discriminatedUnion('operation_ref',[
 Kis113MarketInvestorRequestSchema,Kis109HouseEstimateRequestSchema,Kis280IceActionRequestSchema,
]);
export const RemainingSourceCollectionContextSchema=z.object({origin:z.enum(['actual','synthetic']),cutoff:Instant}).strict();
export const RemainingSourceInputSchema=z.object({request:RemainingSourceRequestSchema,capture:z.object({origin:z.enum(['actual','synthetic']),
  received_at:Instant,expected_body_sha256:Sha}).strict(),cutoff:Instant}).strict();
export type RemainingSourceRequest=z.infer<typeof RemainingSourceRequestSchema>;
export type RemainingSourceInput=z.infer<typeof RemainingSourceInputSchema>;
type Operation=RemainingSourceRequest['operation_ref'];
export const REMAINING_SOURCE_FIELDS = Object.freeze({
  'KIS-113':Object.freeze({output:Object.freeze({stck_bsop_date:8,frgn_ntby_qty:12,prsn_ntby_qty:12,orgn_ntby_qty:18,
    frgn_ntby_tr_pbmn:18,prsn_ntby_tr_pbmn:18,orgn_ntby_tr_pbmn:18,bstp_nmix_prpr:112,bstp_nmix_prdy_ctrt:82})}),
  'KIS-109':Object.freeze({output2:Object.freeze({data1:15,data2:15,data3:15,data4:15,data5:15}),
    output3:Object.freeze({data1:15,data2:15,data5:15}),output4:Object.freeze({dt:8})}),
  'KIS-280':Object.freeze({output1:Object.freeze({anno_dt:8,ca_title:12,div_lock_dt:8,pay_dt:8,record_dt:8,validity_dt:8,
    local_end_dt:8,lock_dt:8,delist_dt:8,redempt_dt:8,early_redempt_dt:8,effective_dt:8})}),
});
const Specs={
 'KIS-113':{endpoint:'/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market',tr_id:'FHPTJ04040000',catalog_id:'kis.catalog.commit2077773a.row.145',
  scope:'market_industry_one_day_aggregate_not_stock_flow',ambiguities:['currency_scale_quantity_unit_unknown_do_not_borrow_KIS_115','subgroup_code_semantics_not_verified','industry_and_market_identity_request_context_only']},
 'KIS-109':{endpoint:'/uapi/domestic-stock/v1/quotations/estimate-perform',tr_id:'HHKST668300C0',catalog_id:'kis.catalog.commit2077773a.row.141',
  scope:'positional_KIS_house_estimates_not_cross_broker_consensus',ambiguities:['SHT_CD_portal_length_2_vs_six_digit_sample_actual_dispatch_blocked','output1_ELW_label_conflict_excluded','output3_data3_data4_not_documented_individually_excluded',
    'metric_row_and_output4_period_alignment_unresolved','metric_specific_unit_notes_not_assigned','pagination_portal_vs_sample_conflict_no_paging']},
 'KIS-280':{endpoint:'/uapi/overseas-price/v1/quotations/rights-by-ice',tr_id:'HHDFS78330900',catalog_id:'kis.catalog.commit2077773a.row.328',
  scope:'overseas_ICE_A4_A5_not_domestic_KSD',ambiguities:['ca_title_taxonomy_incomplete_no_event_type_mapping','request_date_basis_varies_by_event_no_announcement_date_range_filter','future_payment_or_effective_dates_allowed','country_and_symbol_identity_request_context_only']},
} as const;
const GlobalBlockers=['response_identity_not_independently_verified','publication_time_not_available','source_authenticity_not_established',
 'rights_and_host_egress_not_approved','canonical_values_not_promoted'] as const;
const Warnings=['Hash binds decoded original response text encoded as UTF-8, not wire bytes or source authenticity.',
 'Request, origin, receipt and cutoff are independent caller-supplied context. Pure normalization does not assert a request occurred or first-page origin was verified.',
 'Only explicitly documented fields are projected; unreviewed envelope, message, output1 estimate data and output3 data3/data4 stay only in separately retained original text.',
 'Source array order, duplicates, blank strings and missing fields are retained. Empty success does not prove completeness or absence of data.',
 'Date-only fields and estimate-period labels are not publication timestamps. Canonical values, units and identities remain null.'
] as const;
function Cell(length:number){return z.discriminatedUnion('state',[
 z.object({state:z.literal('present'),value:z.string().min(1).max(length).regex(/^[^\x00-\x1f\x7f-\x9f]+(?![\s\S])/)}).strict(),
 z.object({state:z.literal('blank'),value:z.literal('')}).strict(),z.object({state:z.literal('missing'),value:z.null()}).strict()]);}
const Canonical=z.object({instrument_id:z.null(),market_id:z.null(),value:z.null(),unit:z.null(),currency:z.null(),period:z.null(),metric:z.null(),
 event_type:z.null(),date:z.null(),source_as_of:z.null(),publication_at:z.null()}).strict();
function Group(root:string,fields:Record<string,number>){return z.object({source_root:z.literal(root),row_count:z.number().int().min(0).max(100),
 rows:z.array(z.object({source_row_index:z.number().int().min(0).max(99),raw_fields:z.object(Object.fromEntries(Object.entries(fields).map(([k,n])=>[k,Cell(n)]))).strict(),
 canonical:Canonical}).strict()).max(100)}).strict();}
function ResultFor(op:Operation){const s=Specs[op];return z.object({contract:z.literal('moai.kis.remaining-source-inputs.v1'),provider:z.literal('KIS'),operation_ref:z.literal(op),
 catalog_id:z.literal(s.catalog_id),endpoint:z.literal(s.endpoint),tr_id:z.literal(s.tr_id),request:RemainingSourceRequestSchema,
 capture:z.object({origin:z.enum(['actual','synthetic']),received_at:Instant,body_sha256:Sha,body_byte_length:z.number().int().min(1).max(REMAINING_SOURCE_LIMITS.body_bytes),
 hash_scope:z.literal('decoded_response_text_utf8'),hash_algorithm:z.literal('sha256'),provenance_status:z.literal('caller_supplied_unverified'),source_authentication:z.literal('not_established')}).strict(),
 cutoff:Instant,scope:z.literal(s.scope),provider_success_status:z.literal('0'),request_execution_status:z.literal('not_asserted'),first_page_origin:z.literal('not_verified'),
 identity_status:z.literal('request_context_only_not_response_verified'),source_as_of:z.null(),publication_at:z.null(),receipt_policy:z.literal('receipt_not_after_cutoff_no_publication_inference'),
 groups:z.tuple(Object.entries(REMAINING_SOURCE_FIELDS[op]).map(([k,v])=>Group(k,v)) as [ReturnType<typeof Group>,...ReturnType<typeof Group>[]]),
 row_order:z.literal('captured_array_order_zero_based_indices'),response_completeness:z.literal('not_established'),rights_status:z.literal('pending'),
 canonical_projection_status:z.literal('blocked'),metric_ready:z.literal(false),ambiguities:z.tuple(s.ambiguities.map(x=>z.literal(x)) as [z.ZodLiteral<string>,...z.ZodLiteral<string>[]]),
 blockers:z.tuple(GlobalBlockers.map(x=>z.literal(x)) as [z.ZodLiteral<string>,...z.ZodLiteral<string>[]]),
 warnings:z.tuple(Warnings.map(x=>z.literal(x)) as [z.ZodLiteral<string>,...z.ZodLiteral<string>[]])}).strict();}
const ResultSchemaInternal=z.discriminatedUnion('operation_ref',[ResultFor('KIS-113'),ResultFor('KIS-109'),ResultFor('KIS-280')]);
export type RemainingSourceResult=Omit<z.infer<typeof ResultSchemaInternal>,'groups'|'ambiguities'|'blockers'|'warnings'>&{groups:z.infer<ReturnType<typeof Group>>[];ambiguities:string[];blockers:string[];warnings:string[]};
export const RemainingSourceResultSchema:z.ZodType<RemainingSourceResult>=ResultSchemaInternal;
type ReadonlyDeep<T>=T extends object?{readonly [K in keyof T]:ReadonlyDeep<T[K]>}:T;
function freeze<T>(v:T):ReadonlyDeep<T>{if(v!==null&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v as ReadonlyDeep<T>;}
/** Own enumerable data only. Proxies, accessors, prototypes, cycles and toJSON callbacks never execute. */
function snapshot(v:unknown,limit:number):unknown {let nodes=0,bytes=0;const seen=new Set<object>();
 function add(n:number){bytes+=n;need(bytes<=limit,'input_too_large');}
 function str(s:string){need(s.length<=limit&&wellFormed(s),'invalid_snapshot');add(Buffer.byteLength(s,'utf8')+2);return s;}
 function copy(x:unknown,depth:number):unknown{need(++nodes<=REMAINING_SOURCE_LIMITS.nodes&&depth<=REMAINING_SOURCE_LIMITS.depth,'complexity_limit');
  if(x===null||typeof x==='boolean'){add(5);return x;}if(typeof x==='number'){need(Number.isSafeInteger(x)&&!Object.is(x,-0),'invalid_metadata_number');add(24);return x;}if(typeof x==='string')return str(x);
  need(typeof x==='object'&&!types.isProxy(x)&&!seen.has(x),'invalid_snapshot');const a=Array.isArray(x),p=Object.getPrototypeOf(x);need(a?p===Array.prototype||p===null:p===Object.prototype||p===null,'invalid_snapshot');
  const keys=Reflect.ownKeys(x),len=a?Object.getOwnPropertyDescriptor(x,'length')?.value:null;need(keys.length<=REMAINING_SOURCE_LIMITS.entries+1,'complexity_limit');
  if(a)need(Number.isSafeInteger(len)&&len>=0&&len<=REMAINING_SOURCE_LIMITS.entries&&keys.length===len+1,'invalid_snapshot');
  const out=a?[]:Object.create(null);seen.add(x);add(2);for(const k of keys){need(typeof k==='string','invalid_snapshot');if(a&&k==='length')continue;need(k.length<=REMAINING_SOURCE_LIMITS.key_units,'complexity_limit');
   const d=Object.getOwnPropertyDescriptor(x,k);need(d&&'value'in d&&d.enumerable,'invalid_snapshot');need(!a||/^(0|[1-9]\d*)(?![\s\S])/.test(k)&&Number(k)<len,'invalid_snapshot');str(k);add(2);Object.defineProperty(out,k,{value:copy(d.value,depth+1),enumerable:true,writable:true,configurable:true});}
  seen.delete(x);return out;}
 return copy(v,0);}
function parsed<T>(schema:z.ZodType<T>,v:unknown,limit:number=REMAINING_SOURCE_LIMITS.input_bytes):T {const r=schema.safeParse(snapshot(v,limit));need(r.success,'invalid_input');return r.data;}
const RawNumber=Symbol('unconverted_json_number');
function record(v:unknown):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v)&&!Object.hasOwn(v,RawNumber);}
/** Duplicate-aware bounded grammar. Raw provider numeric tokens remain opaque, never rounded. Metadata uses canonical safe integers only. */
function strictJson(input:unknown,limit:number,metadata:boolean):unknown {need(typeof input==='string','invalid_body_text');const text=input;need(text.length<=limit,'body_too_large');need(wellFormed(text),'invalid_body_text');need(Buffer.byteLength(text,'utf8')<=limit,'body_too_large');
 let p=0,nodes=0;function ws(){while(p<text.length&&/[ \t\r\n]/.test(text[p]!))p++;}
 function str(key=false):string{const start=p;need(text[p++]==='"','invalid_json');const lim=key?REMAINING_SOURCE_LIMITS.key_units:REMAINING_SOURCE_LIMITS.string_units;let done=false;
  while(p<text.length){need(p-start<=lim*6+2,'complexity_limit');const c=text[p++]!;if(c==='"'){done=true;break;}if(c==='\\')p++;else need(c.charCodeAt(0)>=32,'invalid_json');}need(done,'invalid_json');
  let s:unknown;try{s=JSON.parse(text.slice(start,p));}catch{fail('invalid_json');}need(typeof s==='string'&&s.length<=lim&&wellFormed(s),'invalid_json');return s;}
 function val(depth:number):unknown{need(++nodes<=REMAINING_SOURCE_LIMITS.nodes&&depth<=REMAINING_SOURCE_LIMITS.depth,'complexity_limit');ws();const c=text[p];if(c==='"')return str();
  if(c==='{'||c==='['){const a=c==='[',out=a?[]:Object.create(null),keys=new Set<string>();p++;ws();if(text[p]===(a?']':'}')){p++;return out;}let n=0;
   while(p<text.length){need(++n<=REMAINING_SOURCE_LIMITS.entries,'complexity_limit');ws();if(a)(out as unknown[]).push(val(depth+1));else{const k=str(true);need(!keys.has(k),'duplicate_json_key');keys.add(k);ws();need(text[p++]===':','invalid_json');Object.defineProperty(out,k,{value:val(depth+1),enumerable:true});}ws();const next=text[p++];if(next===(a?']':'}'))return out;need(next===',','invalid_json');}fail('invalid_json');}
  for(const [word,v]of [['true',true],['false',false],['null',null]]as const)if(text.startsWith(word,p)){p+=word.length;return v;}
  const start=p;while(p<text.length&&!/[ \t\r\n,\]}]/.test(text[p]!)){need(p-start<REMAINING_SOURCE_LIMITS.number_units,'complexity_limit');p++;}const token=text.slice(start,p);
  need(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\s\S])/.test(token),'invalid_json');if(!metadata)return{[RawNumber]:token};
  need(/^(?:0|[1-9]\d*)(?![\s\S])/.test(token)&&Number.isSafeInteger(Number(token)),'invalid_metadata_number');return Number(token);}
 const out=val(0);ws();need(p===text.length,'invalid_json');return out;}
function canonical(v:unknown):string{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return`[${v.map(canonical).join(',')}]`;return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical((v as Record<string,unknown>)[k])}`).join(',')}}`;}
function nullCanonical(){return{instrument_id:null,market_id:null,value:null,unit:null,currency:null,period:null,metric:null,event_type:null,date:null,source_as_of:null,publication_at:null};}
function build(input:unknown,original:unknown):ReadonlyDeep<RemainingSourceResult>{const q=parsed(RemainingSourceInputSchema,input);need(typeof original==='string','invalid_body_text');
 need(original.length<=REMAINING_SOURCE_LIMITS.body_bytes&&Buffer.byteLength(original,'utf8')<=REMAINING_SOURCE_LIMITS.body_bytes,'body_too_large');need(wellFormed(original),'invalid_body_text');
 const hash=createHash('sha256').update(original,'utf8').digest('hex');need(hash===q.capture.expected_body_sha256,'capture_hash_mismatch');need(compareInstants(q.capture.received_at,q.cutoff)<=0,'future_receipt');
 const raw=strictJson(original,REMAINING_SOURCE_LIMITS.body_bytes,false);need(record(raw),'provider_schema_drift');need(typeof raw.rt_cd==='string','unsupported_provider_status');need(raw.rt_cd==='0','upstream_rejected');
 const op=q.request.operation_ref,spec=Specs[op];const groups=Object.entries(REMAINING_SOURCE_FIELDS[op]).map(([root,fields])=>{const rows=raw[root];need(Array.isArray(rows)&&rows.length<=REMAINING_SOURCE_LIMITS.rows,'provider_schema_drift');return{source_root:root,row_count:rows.length,rows:rows.map((row,i)=>{
  need(record(row),'provider_schema_drift');for(const k of Object.keys(row))need(Object.hasOwn(fields,k)||(op==='KIS-109'&&root==='output3'&&(k==='data3'||k==='data4')),'provider_schema_drift');
  const raw_fields=Object.fromEntries(Object.entries(fields as Record<string,number>).map(([k,max])=>{if(!Object.hasOwn(row,k))return[k,{state:'missing',value:null}];const value=row[k];need(typeof value==='string'&&value.length<=max&&!/[\x00-\x1f\x7f-\x9f]/.test(value),'provider_schema_drift');
   if(value==='')return[k,{state:'blank',value:''}];const date=k==='stck_bsop_date'||op==='KIS-280'&&k!=='ca_title';if(date)need(validDay(value),'invalid_provider_date');
   if(op==='KIS-113'&&k!=='stck_bsop_date'||op==='KIS-109'&&root!=='output4')need(/^-?\d+(?:\.\d+)?(?![\s\S])/.test(value),'invalid_provider_numeric_string');
   return[k,{state:'present',value}];}));
  if(q.request.operation_ref==='KIS-113'){need(typeof row.stck_bsop_date==='string'&&validDay(row.stck_bsop_date),'invalid_provider_date');need(row.stck_bsop_date===q.request.query.FID_INPUT_DATE_1,'provider_date_mismatch');}
  return{source_row_index:i,raw_fields,canonical:nullCanonical()};})};});
 const out=RemainingSourceResultSchema.safeParse({contract:'moai.kis.remaining-source-inputs.v1',provider:'KIS',operation_ref:op,catalog_id:spec.catalog_id,endpoint:spec.endpoint,tr_id:spec.tr_id,request:q.request,
 capture:{origin:q.capture.origin,received_at:q.capture.received_at,body_sha256:hash,body_byte_length:Buffer.byteLength(original,'utf8'),hash_scope:'decoded_response_text_utf8',hash_algorithm:'sha256',provenance_status:'caller_supplied_unverified',source_authentication:'not_established'},
 cutoff:q.cutoff,scope:spec.scope,provider_success_status:'0',request_execution_status:'not_asserted',first_page_origin:'not_verified',identity_status:'request_context_only_not_response_verified',source_as_of:null,publication_at:null,
 receipt_policy:'receipt_not_after_cutoff_no_publication_inference',groups,row_order:'captured_array_order_zero_based_indices',response_completeness:'not_established',rights_status:'pending',canonical_projection_status:'blocked',metric_ready:false,
 ambiguities:[...spec.ambiguities],blockers:[...GlobalBlockers],warnings:[...Warnings]});need(out.success,'provider_schema_drift');return freeze(out.data);}
/** Pure replay: no dispatch, wall clock, authenticity or first-page assertion. */
export function buildRemainingSourceEvidence(input:unknown,originalBodyText:unknown):ReadonlyDeep<RemainingSourceResult>{return safe(()=>build(input,originalBodyText));}
/** Expectations MUST come from independent trusted request/context, never from the persisted result. */
export function verifyRemainingSourceEvidence(persisted:unknown,independentInput:unknown,originalBodyText:unknown):ReadonlyDeep<RemainingSourceResult>{return safe(()=>{
 const given=parsed(RemainingSourceResultSchema,persisted,REMAINING_SOURCE_LIMITS.persisted_bytes),rebuilt=build(independentInput,originalBodyText);need(canonical(given)===canonical(rebuilt),'evidence_mismatch');return rebuilt;});}
export function buildRemainingSourceEvidenceFromText(inputText:unknown,originalBodyText:unknown):ReadonlyDeep<RemainingSourceResult>{return safe(()=>build(strictJson(inputText,REMAINING_SOURCE_LIMITS.input_bytes,true),originalBodyText));}
export function verifyRemainingSourceEvidenceFromText(persistedText:unknown,independentInputText:unknown,originalBodyText:unknown):ReadonlyDeep<RemainingSourceResult>{return safe(()=>verifyRemainingSourceEvidence(
 strictJson(persistedText,REMAINING_SOURCE_LIMITS.persisted_bytes,true),strictJson(independentInputText,REMAINING_SOURCE_LIMITS.input_bytes,true),originalBodyText));}
function anchoredFile(path:unknown):number {
 need(process.platform==='linux'&&[constants.O_NOFOLLOW,constants.O_NONBLOCK,constants.O_DIRECTORY].every(x=>Number.isInteger(x)&&x>0),'invalid_file');
 need(typeof path==='string'&&path.length>0&&path.length<=4096&&!path.includes('\0')&&wellFormed(path)&&!path.split('/').includes('..'),'invalid_file');
 const parts=resolve(path).split('/').filter(Boolean);need(parts.length>0,'invalid_file');
 const flags=constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK|constants.O_DIRECTORY;let directory=openSync('/',flags);
 try {for(const part of parts.slice(0,-1)){const next=openSync(`/proc/self/fd/${directory}/${part}`,flags);closeSync(directory);directory=next;}
  return openSync(`/proc/self/fd/${directory}/${parts.at(-1)}`,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 } finally {closeSync(directory);}
}
function fileText(path:unknown,limit:number):string {let fd:number|undefined;
 try {fd=anchoredFile(path);const before=fstatSync(fd,{bigint:true});need(before.isFile()&&before.size<=BigInt(limit),'invalid_file');
  const b=Buffer.alloc(limit+1);let n=0;while(n<b.length){const count=readSync(fd,b,n,b.length-n,null);if(count===0)break;n+=count;}
  const after=fstatSync(fd,{bigint:true});const unchanged=(['dev','ino','mode','nlink','uid','gid','size','mtimeNs','ctimeNs']as const).every(k=>before[k]===after[k]);
  need(after.isFile()&&unchanged&&n<=limit&&BigInt(n)===before.size,'invalid_file');return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b.subarray(0,n));
 } catch {return fail('invalid_file');} finally {if(fd!==undefined)closeSync(fd);}
}
/** Strict bounded regular-file reader: no symlinks, FIFOs, devices, invalid UTF-8, duplicate metadata or rounded numbers. */
export function verifyRemainingSourceEvidenceFiles(persistedPath:unknown,independentInputPath:unknown,originalBodyPath:unknown):ReadonlyDeep<RemainingSourceResult>{return safe(()=>verifyRemainingSourceEvidenceFromText(
 fileText(persistedPath,REMAINING_SOURCE_LIMITS.persisted_bytes),fileText(independentInputPath,REMAINING_SOURCE_LIMITS.input_bytes),fileText(originalBodyPath,REMAINING_SOURCE_LIMITS.body_bytes)));}
export type RemainingSourceWireRequest=ReadonlyDeep<{operation_ref:Operation;method:'GET';endpoint:string;tr_id:string;query:RemainingSourceRequest['query'];pagination:'none'}>;
export type RemainingSourceDependencies={send:(request:RemainingSourceWireRequest)=>Promise<unknown>;now:()=>unknown};
function callback(deps:unknown,key:'send'|'now'):Function{need(deps!==null&&typeof deps==='object'&&!types.isProxy(deps),'invalid_input');const p=Object.getPrototypeOf(deps);need(p===Object.prototype||p===null,'invalid_input');
 const d=Object.getOwnPropertyDescriptor(deps,key);need(d&&'value'in d&&typeof d.value==='function'&&!types.isProxy(d.value),'invalid_input');return d.value;}
/** Injection only, not a production HTTP client. KIS-109 always fails before dependency access, send or clock. */
export async function collectRemainingSourceEvidence(request:unknown,context:unknown,dependencies:RemainingSourceDependencies):Promise<ReadonlyDeep<RemainingSourceResult>>{
 const req=safe(()=>parsed(RemainingSourceRequestSchema,request));if(req.operation_ref==='KIS-109')fail('request_contract_conflict');
 const ctx=safe(()=>parsed(RemainingSourceCollectionContextSchema,context));const send=safe(()=>callback(dependencies,'send')),now=safe(()=>callback(dependencies,'now'));
 const s=Specs[req.operation_ref],wire=freeze({operation_ref:req.operation_ref,method:'GET' as const,endpoint:s.endpoint,tr_id:s.tr_id,query:req.query,pagination:'none' as const});
 let response:unknown;try{response=await send(wire);}catch{fail('transport_failed');}
 const r=safe(()=>parsed(z.object({status:z.number().int(),tr_cont:z.union([z.string().max(8),z.null()]),body_text:z.string().max(REMAINING_SOURCE_LIMITS.body_bytes)}).strict(),response,REMAINING_SOURCE_LIMITS.body_bytes+4096));
 need(r.status===200,'unsupported_http_status');need(r.tr_cont===null||r.tr_cont==='','pagination_not_supported');let received:unknown;try{received=now();}catch{fail('clock_failed');}const receivedAt=safe(()=>parsed(Instant,received));
 return buildRemainingSourceEvidence({request:req,capture:{origin:ctx.origin,received_at:receivedAt,expected_body_sha256:createHash('sha256').update(r.body_text,'utf8').digest('hex')},cutoff:ctx.cutoff},r.body_text);
}

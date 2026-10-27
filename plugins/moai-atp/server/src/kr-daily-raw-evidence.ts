import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { z } from 'zod';
import { ExactInstantSchema, compareInstants } from './exact-instant.js';
import { parseKis039DailyChartResponse, SafeKisParserError } from './r01-kis-field-parsers.js';

/** Additive, offline, evidence-only projection. No transport, credentials, wall clock or canonical promotion. */
export const KR_DAILY_EVIDENCE_LIMITS = Object.freeze({ body_bytes:262_144, body_depth:12, body_nodes:10_000,
  container_entries:1_024, string_code_units:16_384, key_code_units:128, number_code_units:128,
  input_bytes:32_768, persisted_bytes:524_288, rows:100 });
export const KR_DAILY_EVIDENCE_ERROR_CODES = Object.freeze(['invalid_input','invalid_snapshot','input_too_large',
  'invalid_body_text','body_too_large','body_complexity_limit','invalid_json','duplicate_json_key',
  'capture_hash_mismatch','future_receipt','unsupported_provider_status','upstream_rejected',
  'provider_response_schema_drift','invalid_provider_business_date','provider_numeric_format_invalid',
  'provider_date_outside_requested_range','duplicate_provider_business_date','evidence_mismatch'] as const);
export type KrDailyEvidenceErrorCode = typeof KR_DAILY_EVIDENCE_ERROR_CODES[number];
export class KrDailyEvidenceError extends Error {
  constructor(readonly code:KrDailyEvidenceErrorCode) { super(code); this.name='KrDailyEvidenceError'; }
}
function fail(code:KrDailyEvidenceErrorCode):never { throw new KrDailyEvidenceError(code); }
function requireThat(ok:unknown,code:KrDailyEvidenceErrorCode):asserts ok { if(!ok)fail(code); }
function wellFormed(s:string):boolean { for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xD800&&c<=0xDBFF){const n=s.charCodeAt(++i);if(!(n>=0xDC00&&n<=0xDFFF))return false;}else if(c>=0xDC00&&c<=0xDFFF)return false;}return true; }
const Day=z.string().length(10).pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).refine(s=>{
  const d=new Date(`${s}T00:00:00Z`);return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===s&&Number(s.slice(0,4))>=100;
});
const Instant=z.string().max(80).pipe(z.string().regex(/^[\x20-\x7e]+(?![\s\S])/)).pipe(ExactInstantSchema);
const Sha=z.string().length(64).pipe(z.string().regex(/^[a-f0-9]{64}$/));
export const KrDailyEvidenceRequestSchema=z.object({
  symbol:z.string().length(6).pipe(z.string().regex(/^\d{6}$/)),board:z.enum(['J','NX','UN']),
  start_date:Day,end_date:Day,interval:z.literal('1d'),adjustment_code:z.enum(['0','1']),
}).strict().refine(q=>q.start_date<=q.end_date,'reversed_date_range');
export const KrDailyEvidenceInputSchema=z.object({request:KrDailyEvidenceRequestSchema,
  capture:z.object({origin:z.enum(['actual','synthetic']),received_at:Instant,expected_body_sha256:Sha}).strict(),cutoff:Instant,
}).strict();
export type KrDailyEvidenceInput=z.infer<typeof KrDailyEvidenceInputSchema>;
export const KR_DAILY_RAW_FIELD_LENGTHS=Object.freeze({stck_bsop_date:8,stck_clpr:10,stck_oprc:10,stck_hgpr:10,
  stck_lwpr:10,acml_vol:18,acml_tr_pbmn:18,flng_cls_code:2,prtt_rate:11,mod_yn:1,revl_issu_reas:2} as const);
export type KrDailyRawField=keyof typeof KR_DAILY_RAW_FIELD_LENGTHS;
const NumericFields=new Set<KrDailyRawField>(['stck_clpr','stck_oprc','stck_hgpr','stck_lwpr','acml_vol','acml_tr_pbmn','prtt_rate']);
function fieldSchema(field:KrDailyRawField){
  const text=z.string().min(1).max(KR_DAILY_RAW_FIELD_LENGTHS[field]).pipe(z.string().regex(/^[^\x00-\x1f\x7f-\x9f]+(?![\s\S])/));
  const present=NumericFields.has(field)?text.pipe(z.string().regex(/^-?\d+(?:\.\d+)?(?![\s\S])/)):field==='stck_bsop_date'?text.pipe(z.string().regex(/^\d{8}$/)):text;
  if(field==='stck_bsop_date')return z.object({state:z.literal('present'),value:present}).strict();
  return z.discriminatedUnion('state',[
    z.object({state:z.literal('present'),value:present}).strict(),
    z.object({state:z.literal('blank'),value:z.literal('')}).strict(),
    z.object({state:z.literal('missing'),value:z.null()}).strict(),
  ]);
}
const RawFields=z.object({stck_bsop_date:fieldSchema('stck_bsop_date'),stck_clpr:fieldSchema('stck_clpr'),
  stck_oprc:fieldSchema('stck_oprc'),stck_hgpr:fieldSchema('stck_hgpr'),stck_lwpr:fieldSchema('stck_lwpr'),
  acml_vol:fieldSchema('acml_vol'),acml_tr_pbmn:fieldSchema('acml_tr_pbmn'),flng_cls_code:fieldSchema('flng_cls_code'),
  prtt_rate:fieldSchema('prtt_rate'),mod_yn:fieldSchema('mod_yn'),revl_issu_reas:fieldSchema('revl_issu_reas')}).strict();
const Canonical=z.object({instrument_id:z.null(),date:z.null(),open:z.null(),high:z.null(),low:z.null(),close:z.null(),volume:z.null(),turnover:z.null(),
  currency:z.null(),price_unit:z.null(),volume_unit:z.null(),turnover_unit:z.null(),adjusted:z.null(),adjustment_factor:z.null(),
  source_as_of:z.null(),publication_at:z.null(),session:z.null()}).strict();
const Blockers=[ 'price_currency_and_scale_not_stated_in_endpoint_schema','volume_unit_not_stated_in_endpoint_schema',
  'trade_amount_currency_and_scale_not_stated_in_endpoint_schema','adjustment_code_portal_sample_conflict',
  'response_identity_not_independently_verified','date_only_no_provider_time_or_timezone','data_rights_and_host_egress_not_approved_by_this_contract'] as const;
const Warnings=[
  'SHA256 binds original decoded response text encoded as UTF-8, not wire bytes or source authenticity. Original text must be retained separately.',
  'Request, origin, receipt and cutoff are caller-supplied metadata, not authenticated transport observations or publication evidence.',
  'Only the eleven documented output2 row fields are projected. Provider messages, output1, headers and arbitrary metadata are never public evidence fields.',
  'Provider order and date labels are retained without sorting, deduplication, calendar-session inference, completeness claims or canonical chart/metric promotion.',
  'Empty successful output2 is retained as empty capture evidence only, not proof of no trading or complete history. The existing price-history v1 contract is unchanged.',
] as const;
export const KrDailyEvidenceResultSchema=z.object({
  contract:z.literal('moai.kis.kr-daily-raw-evidence.v1'),provider:z.literal('KIS'),operation_id:z.literal('KIS-039'),
  endpoint:z.literal('/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice'),tr_id:z.literal('FHKST03010100'),
  request:KrDailyEvidenceRequestSchema,
  capture:z.object({origin:z.enum(['actual','synthetic']),received_at:Instant,body_sha256:Sha,
    body_byte_length:z.number().int().min(1).max(KR_DAILY_EVIDENCE_LIMITS.body_bytes),hash_scope:z.literal('decoded_response_text_utf8'),
    hash_algorithm:z.literal('sha256'),provenance_status:z.literal('caller_supplied_capture_metadata'),source_authentication:z.literal('not_established')}).strict(),
  cutoff:Instant,provider_success_status:z.literal('0'),success_policy:z.literal('string_zero_only'),
  identity_status:z.literal('request_context_only_not_response_verified'),source_as_of:z.null(),publication_at:z.null(),
  receipt_cutoff_status:z.literal('receipt_not_after_cutoff_no_publication_inference'),
  adjustment_code_interpretation:z.literal('blocked_portal_sample_conflict'),
  row_order:z.literal('captured_output2_array_order'),row_index_basis:z.literal('zero_based_output2_index'),
  row_count:z.number().int().min(0).max(100),response_status:z.enum(['rows_preserved','empty_success_capture']),
  rows:z.array(z.object({source_row_index:z.number().int().min(0).max(99),provider_business_date:Day,raw_fields:RawFields,canonical:Canonical}).strict()).max(100),
  response_range_completeness:z.literal('unknown_pagination_not_demonstrated'),rights_status:z.literal('pending'),
  source_time_status:z.literal('date_only_no_provider_time_or_timezone'),canonical_projection_status:z.literal('blocked'),
  blockers:z.tuple([z.literal(Blockers[0]),z.literal(Blockers[1]),z.literal(Blockers[2]),z.literal(Blockers[3]),z.literal(Blockers[4]),z.literal(Blockers[5]),z.literal(Blockers[6])]),
  warnings:z.tuple([z.literal(Warnings[0]),z.literal(Warnings[1]),z.literal(Warnings[2]),z.literal(Warnings[3]),z.literal(Warnings[4])]),
}).strict();
export type KrDailyEvidenceResult=z.infer<typeof KrDailyEvidenceResultSchema>;
type DeepReadonly<T>=T extends object?{readonly[K in keyof T]:DeepReadonly<T[K]>}:T;
function freeze<T>(v:T):DeepReadonly<T>{if(v!==null&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v as DeepReadonly<T>;}

/** Only plain own enumerable data is copied. Proxies (including revoked ones), accessors and toJSON never run. */
function snapshot(value:unknown,maxBytes:number):unknown {
  let nodes=0,bytes=0;const seen=new Set<object>();
  function add(n:number){bytes+=n;if(bytes>maxBytes)fail('input_too_large');}
  function string(s:string){requireThat(s.length<=maxBytes-bytes,'input_too_large');requireThat(wellFormed(s),'invalid_snapshot');add(Buffer.byteLength(s,'utf8')+2);return s;}
  function copy(v:unknown,depth:number):unknown {
    requireThat(++nodes<=KR_DAILY_EVIDENCE_LIMITS.body_nodes&&depth<=KR_DAILY_EVIDENCE_LIMITS.body_depth,'input_too_large');
    if(v===null||typeof v==='boolean'){add(5);return v;}
    if(typeof v==='number'){requireThat(Number.isFinite(v)&&!Object.is(v,-0),'invalid_snapshot');add(24);return v;}
    if(typeof v==='string')return string(v);
    requireThat(typeof v==='object'&&!types.isProxy(v)&&!seen.has(v),'invalid_snapshot');
    const a=Array.isArray(v),p=Object.getPrototypeOf(v);requireThat(a?p===Array.prototype||p===null:p===Object.prototype||p===null,'invalid_snapshot');
    const length=a?Object.getOwnPropertyDescriptor(v,'length')?.value:null;
    if(a)requireThat(Number.isSafeInteger(length)&&length>=0&&length<=KR_DAILY_EVIDENCE_LIMITS.container_entries,'input_too_large');
    const keys=Reflect.ownKeys(v);requireThat(keys.length<=KR_DAILY_EVIDENCE_LIMITS.container_entries+1,'input_too_large');
    requireThat(!a||keys.length===length+1,'invalid_snapshot');const out=a?[]:Object.create(null);seen.add(v);add(2);
    for(const key of keys){requireThat(typeof key==='string','invalid_snapshot');if(a&&key==='length')continue;
      requireThat(key.length<=KR_DAILY_EVIDENCE_LIMITS.key_code_units,'input_too_large');
      const d=Object.getOwnPropertyDescriptor(v,key);requireThat(d&&'value'in d&&d.enumerable,'invalid_snapshot');
      requireThat(!a||/^(0|[1-9]\d*)$/.test(key)&&Number(key)<length,'invalid_snapshot');string(key);add(2);
      Object.defineProperty(out,key,{value:copy(d.value,depth+1),enumerable:true,writable:true,configurable:true});}
    seen.delete(v);return out;
  }
  return copy(value,0);
}
function parsed<T>(schema:z.ZodType<T>,v:unknown,bytes:number):T {const p=schema.safeParse(snapshot(v,bytes));if(!p.success)fail('invalid_input');return p.data;}
const RawNumber=Symbol('unconverted_json_number');
/** Bounded JSON grammar. Numeric tokens never become binary64 values; string-only provider status is deliberate. */
function parseOriginal(text:string):unknown {
  let pos=0,nodes=0;const len=text.length;
  const whitespace=(c:string|undefined)=>c===' '||c==='\t'||c==='\r'||c==='\n';
  function ws(){while(pos<len&&whitespace(text[pos]))pos++;}
  function string(key=false):string {const start=pos;requireThat(text[pos++]==='"','invalid_json');let closed=false;
    const limit=key?KR_DAILY_EVIDENCE_LIMITS.key_code_units:KR_DAILY_EVIDENCE_LIMITS.string_code_units;
    while(pos<len){requireThat(pos-start<=limit*6+2,'body_complexity_limit');const c=text[pos++]!;if(c==='"'){closed=true;break;}if(c==='\\')pos++;else if(c.charCodeAt(0)<32)fail('invalid_json');}
    requireThat(closed,'invalid_json');let s:unknown;try{s=JSON.parse(text.slice(start,pos));}catch{fail('invalid_json');}
    requireThat(typeof s==='string'&&s.length<=limit,'body_complexity_limit');requireThat(wellFormed(s),'invalid_json');return s;
  }
  function value(depth:number):unknown {
    requireThat(++nodes<=KR_DAILY_EVIDENCE_LIMITS.body_nodes&&depth<=KR_DAILY_EVIDENCE_LIMITS.body_depth,'body_complexity_limit');ws();const c=text[pos];
    if(c==='"')return string();
    if(c==='{'||c==='['){const a=c==='[',out=a?[]:Object.create(null),keys=new Set<string>();pos++;ws();if(text[pos]===(a?']':'}')){pos++;return out;}let n=0;
      while(pos<len){requireThat(++n<=KR_DAILY_EVIDENCE_LIMITS.container_entries,'body_complexity_limit');ws();
        if(a)(out as unknown[]).push(value(depth+1));else{const key=string(true);requireThat(!keys.has(key),'duplicate_json_key');keys.add(key);ws();requireThat(text[pos++]===':','invalid_json');
          Object.defineProperty(out,key,{value:value(depth+1),enumerable:true,writable:true,configurable:true});}
        ws();const next=text[pos++];if(next===(a?']':'}'))return out;requireThat(next===',','invalid_json');}
      fail('invalid_json');}
    for(const [word,v]of [['true',true],['false',false],['null',null]]as const)if(text.startsWith(word,pos)){pos+=word.length;return v;}
    const start=pos;while(pos<len&&!whitespace(text[pos])&&text[pos]!==','&&text[pos]!==']'&&text[pos]!=='}'){
      requireThat(pos-start<KR_DAILY_EVIDENCE_LIMITS.number_code_units,'body_complexity_limit');pos++;}
    const lexeme=text.slice(start,pos);requireThat(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(lexeme),'invalid_json');
    return {[RawNumber]:lexeme};
  }
  const v=value(0);ws();requireThat(pos===len,'invalid_json');return v;
}
function record(v:unknown):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v)&&!Object.hasOwn(v,RawNumber);}
function canonical(v:unknown):string {if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return`[${v.map(canonical).join(',')}]`;return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical((v as Record<string,unknown>)[k])}`).join(',')}}`;}
function safe<T>(run:()=>T):T {try{return run();}catch(e){if(e instanceof KrDailyEvidenceError)throw e;
  if(e instanceof SafeKisParserError&&(KR_DAILY_EVIDENCE_ERROR_CODES as readonly string[]).includes(e.code))fail(e.code as KrDailyEvidenceErrorCode);
  fail('invalid_input');}}
function build(input:unknown,originalBodyText:unknown):DeepReadonly<KrDailyEvidenceResult> {
  const q=parsed(KrDailyEvidenceInputSchema,input,KR_DAILY_EVIDENCE_LIMITS.input_bytes);
  requireThat(typeof originalBodyText==='string','invalid_body_text');requireThat(originalBodyText.length<=KR_DAILY_EVIDENCE_LIMITS.body_bytes,'body_too_large');
  requireThat(wellFormed(originalBodyText),'invalid_body_text');const bytes=Buffer.byteLength(originalBodyText,'utf8');requireThat(bytes<=KR_DAILY_EVIDENCE_LIMITS.body_bytes,'body_too_large');
  const hash=createHash('sha256').update(originalBodyText,'utf8').digest('hex');requireThat(hash===q.capture.expected_body_sha256,'capture_hash_mismatch');
  requireThat(compareInstants(q.capture.received_at,q.cutoff)<=0,'future_receipt');
  const raw=parseOriginal(originalBodyText);requireThat(record(raw),'provider_response_schema_drift');
  requireThat(typeof raw.rt_cd==='string','unsupported_provider_status');requireThat(raw.rt_cd==='0','upstream_rejected');
  requireThat(record(raw.output1)&&Array.isArray(raw.output2)&&raw.output2.length<=100,'provider_response_schema_drift');
  // Tighten the additive boundary without altering the legacy parser's permissive final-dollar regex.
  for(const row of raw.output2){requireThat(record(row),'provider_response_schema_drift');for(const [key,value]of Object.entries(row)){
    requireThat(Object.hasOwn(KR_DAILY_RAW_FIELD_LENGTHS,key),'provider_response_schema_drift');const field=key as KrDailyRawField;
    requireThat(typeof value==='string'&&value.length<=KR_DAILY_RAW_FIELD_LENGTHS[field],'provider_response_schema_drift');
    requireThat(!/[\x00-\x1f\x7f-\x9f]/.test(value),'provider_response_schema_drift');
    if(NumericFields.has(field)&&value!=='')requireThat(/^-?\d+(?:\.\d+)?(?![\s\S])/.test(value),'provider_numeric_format_invalid');
  }}
  // Deliberately pass only reviewed row data; arbitrary envelope/header/message fields stay in separately retained text.
  const rows=parseKis039DailyChartResponse({rt_cd:'0',output1:{},output2:raw.output2},{symbol:q.request.symbol,board:q.request.board,
    startDate:q.request.start_date.replaceAll('-',''),endDate:q.request.end_date.replaceAll('-',''),periodCode:'D',adjustmentCode:q.request.adjustment_code,
    receivedAt:q.capture.received_at,origin:q.capture.origin==='synthetic'?'synthetic_fixture':'provider_payload'});
  const evidenceRows=rows.map((r,i)=>{const fields=Object.fromEntries(Object.entries(r.raw_fields).map(([k,f])=>[k,{state:f.state,value:f.state==='blank'?'':f.value}]));
    return {source_row_index:i,provider_business_date:r.provider_business_date,raw_fields:fields,
      canonical:{instrument_id:null,date:null,open:null,high:null,low:null,close:null,volume:null,turnover:null,currency:null,price_unit:null,
        volume_unit:null,turnover_unit:null,adjusted:null,adjustment_factor:null,source_as_of:null,publication_at:null,session:null}};});
  const result=KrDailyEvidenceResultSchema.safeParse({contract:'moai.kis.kr-daily-raw-evidence.v1',provider:'KIS',operation_id:'KIS-039',
    endpoint:'/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',tr_id:'FHKST03010100',request:q.request,
    capture:{origin:q.capture.origin,received_at:q.capture.received_at,body_sha256:hash,body_byte_length:bytes,hash_scope:'decoded_response_text_utf8',
      hash_algorithm:'sha256',provenance_status:'caller_supplied_capture_metadata',source_authentication:'not_established'},cutoff:q.cutoff,
    provider_success_status:'0',success_policy:'string_zero_only',identity_status:'request_context_only_not_response_verified',source_as_of:null,publication_at:null,
    receipt_cutoff_status:'receipt_not_after_cutoff_no_publication_inference',adjustment_code_interpretation:'blocked_portal_sample_conflict',
    row_order:'captured_output2_array_order',row_index_basis:'zero_based_output2_index',row_count:rows.length,response_status:rows.length?'rows_preserved':'empty_success_capture',rows:evidenceRows,
    response_range_completeness:'unknown_pagination_not_demonstrated',rights_status:'pending',source_time_status:'date_only_no_provider_time_or_timezone',
    canonical_projection_status:'blocked',blockers:[...Blockers],warnings:[...Warnings]});
  requireThat(result.success,'provider_response_schema_drift');return freeze(result.data);
}
/** Original decoded JSON text must be supplied verbatim, never JSON.stringify(parsed). Input expectations are separate. */
export function buildKrDailyRawEvidence(input:unknown,originalBodyText:unknown):DeepReadonly<KrDailyEvidenceResult>{return safe(()=>build(input,originalBodyText));}
/** Rebuild from independent input and original text. Schema-only validation or self-derived expectations are NOT verification. */
export function verifyKrDailyRawEvidence(persisted:unknown,input:unknown,originalBodyText:unknown):DeepReadonly<KrDailyEvidenceResult>{return safe(()=>{
  const given=parsed(KrDailyEvidenceResultSchema,persisted,KR_DAILY_EVIDENCE_LIMITS.persisted_bytes),rebuilt=build(input,originalBodyText);
  requireThat(canonical(given)===canonical(rebuilt),'evidence_mismatch');return rebuilt;
});}

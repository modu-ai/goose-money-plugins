import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { z } from 'zod';
import { SecConceptInputSchema } from './sec-public-data.js';
import { ExactInstantSchema, compareInstants } from './exact-instant.js';

/** Offline, additive capture selection. Never a first-N v1 DTO or financial candidate. */
export const SEC_CAPTURE_SLICE_LIMITS = Object.freeze({ body_bytes:3_000_000, selected_facts:100, rows_per_unit:10_000,
  nodes:250_000, keys_per_container:10_001, depth:16, input_bytes:100_000, persisted_bytes:3_000_000 });
export const SEC_CAPTURE_SLICE_ERROR_CODES = ['invalid_input','invalid_snapshot','input_too_large','invalid_body_text',
  'body_too_large','body_complexity_limit','duplicate_json_key','invalid_json','invalid_source_metadata',
  'capture_hash_mismatch','source_context_mismatch','invalid_calendar_guard','future_receipt','future_source_date',
  'invalid_chronology','selection_out_of_bounds','slice_mismatch'] as const;
export type SecCaptureSliceErrorCode = typeof SEC_CAPTURE_SLICE_ERROR_CODES[number];
export class SecCaptureSliceError extends Error {
  constructor(readonly code: SecCaptureSliceErrorCode) { super(code); this.name='SecCaptureSliceError'; }
}
function wellFormed(s:string):boolean { for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xD800&&c<=0xDBFF){const next=s.charCodeAt(++i);if(!(next>=0xDC00&&next<=0xDFFF))return false;}else if(c>=0xDC00&&c<=0xDFFF)return false;}return true; }
function fail(code:SecCaptureSliceErrorCode):never { throw new SecCaptureSliceError(code); }
function requireThat(ok:unknown,code:SecCaptureSliceErrorCode):asserts ok { if(!ok) fail(code); }
const Day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(`${s}T00:00:00Z`);return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===s;});
const Index=z.number().int().min(0).max(SEC_CAPTURE_SLICE_LIMITS.nodes);
const Unit=z.string().regex(/^[A-Za-z][A-Za-z0-9_/-]{0,79}$/);
const Lexeme=z.string().max(200).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/);
const Sha=z.string().regex(/^[a-f0-9]{64}$/);
export const SecCaptureSliceSelectionSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('source_indices'),indices:z.array(Index).min(1).max(100).refine(a=>a.every((v,i)=>i===0||a[i-1]!<v))}).strict(),
  z.object({kind:z.literal('provider_order_window'),offset:Index,count:z.number().int().min(1).max(100)}).strict(),
]);
export const SecCaptureSliceInputSchema=z.object({
  request:z.object({cik:z.string(),taxonomy:z.enum(['us-gaap','ifrs-full']),concept:z.string().max(200)}).strict()
    .refine(q=>SecConceptInputSchema.safeParse(q).success),
  selection:SecCaptureSliceSelectionSchema,
  capture:z.object({origin:z.enum(['actual','synthetic']),received_at:ExactInstantSchema,source_url:z.string().max(500).url(),expected_body_sha256:Sha}).strict(),
  cutoff:ExactInstantSchema,
  calendar_guard:z.object({timezone:z.string().min(1).max(100),cutoff_local_date:Day}).strict(),
}).strict();
export type SecCaptureSliceInput=z.infer<typeof SecCaptureSliceInputSchema>;
const FactShape={source_index:Index,source_unit_index:Index,source_row_index:Index,unit_raw:Unit,numeric_lexeme:Lexeme,
  start:Day.nullable(),end:Day,accession_number:z.string().regex(/^\d{10}-\d{2}-\d{6}$/),filed:Day,
  fiscal_year:z.number().int().min(1900).max(9999).nullable(),fiscal_period:z.string().max(10).nullable(),
  form:z.string().min(1).max(30),frame:z.string().max(60).nullable(),period_kind:z.enum(['duration','instant']),
  accounting_basis:z.null(),canonical_metric:z.null()};
const Fact=z.object(FactShape).strict().refine(f=>(f.start===null)===(f.period_kind==='instant')&&(f.start===null||f.start<=f.end));
const Warnings=[
  'Decoded response text encoded as UTF-8 SHA256 binds the requested capture and indices, not compressed or TLS wire bytes; integrity is not source authentication or rights clearance.',
  'Capture origin, source URL and receipt are caller-supplied provenance, not independently verified transport observations.',
  'Absolute ordinals follow captured units member order then array row order, a capture convention not financial chronology. Numeric lexemes are retained; no latest, restatement or fiscal-period inference occurs.',
  'Date-only labels are not publication instants. Caller-selected calendar guards do not establish publication availability.',
  'No canonical metric, financial candidate, accounting basis, security identity or eligibility is produced. Source text is supplied separately.',
] as const;
export const SecCaptureSliceResultSchema=z.object({
  contract:z.literal('moai.sec.company-concept-capture-slice.v1'),provider:z.literal('SEC'),
  request:SecCaptureSliceInputSchema.shape.request,selection:SecCaptureSliceSelectionSchema,
  capture:z.object({origin:z.enum(['actual','synthetic']),received_at:ExactInstantSchema,source_url:z.string().max(500).url(),
    body_sha256:Sha,body_byte_length:z.number().int().min(0).max(3_000_000),
    hash_scope:z.literal('decoded_response_text_utf8'),hash_algorithm:z.literal('sha256'),
    provenance_status:z.literal('caller_supplied_capture_metadata'),source_authentication:z.literal('not_established')}).strict(),
  cutoff:ExactInstantSchema,calendar_guard:SecCaptureSliceInputSchema.shape.calendar_guard,
  identity_status:z.literal('source_cik_matched_not_security_identity'),source_as_of:z.null(),rights:z.literal('pending'),
  entity_name:z.string().max(1000),taxonomy:z.enum(['us-gaap','ifrs-full']),concept:z.string().max(200),label:z.string().max(1000),
  source_units:z.array(z.object({unit_raw:Unit,source_unit_index:Index,first_source_index:Index,fact_count:z.number().int().min(0).max(10_000)}).strict()).max(10_000),
  facts:z.array(Fact).max(100),total_fact_count:Index,selected_fact_count:z.number().int().min(0).max(100),omitted_fact_count:Index,
  omitted_before_count:Index,omitted_between_count:Index,omitted_after_count:Index,selected_source_index_min:Index.nullable(),selected_source_index_max:Index.nullable(),
  selection_policy:z.literal('explicit_capture_bound_provider_order_no_semantic_selection'),
  coverage_status:z.literal('supplied_capture_only_not_complete_filing_history'),warnings:z.tuple(Warnings.map(w=>z.literal(w)) as [z.ZodLiteral<typeof Warnings[0]>,z.ZodLiteral<typeof Warnings[1]>,z.ZodLiteral<typeof Warnings[2]>,z.ZodLiteral<typeof Warnings[3]>,z.ZodLiteral<typeof Warnings[4]>]),
}).strict();
export type SecCaptureSliceResult=z.infer<typeof SecCaptureSliceResultSchema>;
type DeepReadonly<T>=T extends object?{readonly[K in keyof T]:DeepReadonly<T[K]>}:T;
function freeze<T>(v:T):DeepReadonly<T>{if(v!==null&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v as DeepReadonly<T>;}

/** Descriptor-only copy before validation; getters, Proxy traps and toJSON are never invoked. */
function snapshot(value:unknown,maxBytes:number):unknown {
  let nodes=0,bytes=0;const seen=new Set<object>();
  function add(n:number){bytes+=n;if(bytes>maxBytes)fail('input_too_large');}
  function copy(v:unknown,depth:number):unknown {
    if(++nodes>SEC_CAPTURE_SLICE_LIMITS.nodes||depth>SEC_CAPTURE_SLICE_LIMITS.depth)fail('input_too_large');
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='number'){requireThat(Number.isFinite(v),'invalid_snapshot');return v;}
    if(typeof v==='string'){if(v.length>maxBytes-bytes)fail('input_too_large');add(Buffer.byteLength(v,'utf8'));return v;}
    requireThat(typeof v==='object'&&!types.isProxy(v)&&!seen.has(v),'invalid_snapshot');
    const a=Array.isArray(v),p=Object.getPrototypeOf(v);requireThat(a?p===Array.prototype||p===null:p===Object.prototype||p===null,'invalid_snapshot');
    const length=a?Object.getOwnPropertyDescriptor(v,'length')?.value:null;
    if(a)requireThat(Number.isSafeInteger(length)&&length>=0&&length<SEC_CAPTURE_SLICE_LIMITS.keys_per_container,'input_too_large');
    const keys=Reflect.ownKeys(v);if(keys.length>SEC_CAPTURE_SLICE_LIMITS.keys_per_container)fail('input_too_large');
    requireThat(!a||keys.length===length+1,'invalid_snapshot');const out=a?[]:Object.create(null);seen.add(v);
    for(const k of keys){requireThat(typeof k==='string','invalid_snapshot');const d=Object.getOwnPropertyDescriptor(v,k);requireThat(d&&'value'in d,'invalid_snapshot');
      if(a&&k==='length')continue;requireThat(d.enumerable&&(!a||/^(0|[1-9]\d*)$/.test(k)&&Number(k)<length),'invalid_snapshot');if(k.length>maxBytes-bytes)fail('input_too_large');add(Buffer.byteLength(k,'utf8'));
      Object.defineProperty(out,k,{value:copy(d.value,depth+1),enumerable:true,writable:true,configurable:true});}
    seen.delete(v);return out;
  }
  try{return copy(value,0);}catch(e){if(e instanceof SecCaptureSliceError)throw e;fail('invalid_snapshot');}
}
function parsed<T>(s:z.ZodType<T>,v:unknown,maxBytes:number):T{const r=s.safeParse(snapshot(v,maxBytes));if(!r.success)fail('invalid_input');return r.data;}

const NUMBER=Symbol('original-number-lexeme');
/** CIK/fiscal-year integers must be exact in the original decimal, not merely rounded integers in binary64. */
function exactMetadataInteger(lexeme:string):number {
  requireThat(lexeme.length<=200,'invalid_source_metadata');
  const m=/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(lexeme)!;
  let digits=(m[2]!+(m[3]??'')).replace(/^0+/,'');
  if(!digits)return 0;
  const exponent=Number(m[4]??'0');requireThat(Number.isSafeInteger(exponent),'invalid_source_metadata');
  const scale=exponent-(m[3]?.length??0);
  if(scale<0){const removed=-scale;requireThat(removed<digits.length&&/^0+$/.test(digits.slice(-removed)),'invalid_source_metadata');digits=digits.slice(0,-removed);}
  else{requireThat(digits.length+scale<=16,'invalid_source_metadata');digits+='0'.repeat(scale);}
  const n=Number((m[1]??'')+digits);requireThat(Number.isSafeInteger(n),'invalid_source_metadata');return n;
}

/** Bounded JSON grammar with decoded duplicate-key rejection, before any recursive schema walk. */
function parseOriginal(text:string):unknown {
  let pos=0,nodes=0;const len=text.length;
  function ws(){while(pos<len&&/[\x20\t\r\n]/.test(text[pos]!))pos++;}
  function string():string {const start=pos;requireThat(text[pos++]==='"','invalid_json');let closed=false;
    while(pos<len){const c=text[pos++]!;if(c==='"'){closed=true;break;}if(c==='\\'){pos++;}else if(c.charCodeAt(0)<32)fail('invalid_json');}
    requireThat(closed,'invalid_json');try{const s=JSON.parse(text.slice(start,pos)) as string;requireThat(wellFormed(s),'invalid_json');return s;}catch{fail('invalid_json');}}
  function value(depth:number,key?:string):unknown {
    if(++nodes>SEC_CAPTURE_SLICE_LIMITS.nodes||depth>SEC_CAPTURE_SLICE_LIMITS.depth)fail('body_complexity_limit');ws();const c=text[pos];
    if(c==='"')return string();
    if(c==='{'||c==='['){const a=c==='[',out=a?[]:Object.create(null),seen=new Set<string>();pos++;ws();if(text[pos]===(a?']':'}')){pos++;return out;}let n=0;
      while(pos<len){if(++n>SEC_CAPTURE_SLICE_LIMITS.keys_per_container)fail('body_complexity_limit');ws();
        if(a)(out as unknown[]).push(value(depth+1));else{const k=string();requireThat(!seen.has(k),'duplicate_json_key');seen.add(k);ws();requireThat(text[pos++]===':','invalid_json');Object.defineProperty(out,k,{value:value(depth+1,k),enumerable:true,writable:true,configurable:true});}
        ws();const next=text[pos++];if(next===(a?']':'}'))return out;requireThat(next===',','invalid_json');}
      fail('invalid_json');}
    for(const [word,v]of [['true',true],['false',false],['null',null]] as const){if(text.startsWith(word,pos)){pos+=word.length;return v;}}
    const m=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;m.lastIndex=pos;const found=m.exec(text);requireThat(found,'invalid_json');pos=m.lastIndex;
    if(key==='val'){requireThat(Lexeme.safeParse(found[0]).success,'invalid_source_metadata');return {lexeme:found[0],[NUMBER]:true};}
    if(key==='cik'||key==='fy')return exactMetadataInteger(found[0]);
    const number=Number(found[0]);requireThat(Number.isFinite(number),'invalid_source_metadata');return number;
  }
  const out=value(0);ws();requireThat(pos===len,'invalid_json');return out;
}
const RawFact=z.object({val:z.custom<{lexeme:string}>(v=>typeof v==='object'&&v!==null&&(v as Record<symbol,unknown>)[NUMBER]===true&&Lexeme.safeParse((v as {lexeme:unknown}).lexeme).success),
  start:Day.optional(),end:Day,accn:FactShape.accession_number,filed:Day,fy:FactShape.fiscal_year.optional(),fp:FactShape.fiscal_period.optional(),
  form:FactShape.form,frame:z.string().max(60).optional()}).strip().refine(f=>!f.start||f.start<=f.end);
const RawPayload=z.object({cik:z.unknown(),entityName:z.string().max(1000),taxonomy:z.string(),tag:z.string(),label:z.string().max(1000),units:z.record(Unit,z.array(RawFact).max(10_000))}).strip();
function cik(v:unknown):string {if(typeof v==='number'&&Number.isSafeInteger(v)&&v>0)return String(v).padStart(10,'0');if(typeof v==='string'&&/^\d{1,10}$/.test(v))return v.padStart(10,'0');fail('invalid_source_metadata');}
function localDay(instant:string,timezone:string):string {
  try{const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',era:'short'}).formatToParts(new Date(instant.replace(/\.\d+(?=Z$|[+-]\d{2}:\d{2}$)/,'')));
    const f=(t:string)=>parts.find(p=>p.type===t)?.value;const d=`${f('year')?.padStart(4,'0')}-${f('month')}-${f('day')}`;requireThat(f('era')==='AD'&&Day.safeParse(d).success,'invalid_calendar_guard');return d;
  }catch{fail('invalid_calendar_guard');}
}
function canonical(v:unknown):string {if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return`[${v.map(canonical).join(',')}]`;return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical((v as Record<string,unknown>)[k])}`).join(',')}}`;}

/** Pass the original response text, never JSON.stringify(parsed). No network, clock or credentials. */
export function sliceSecCompanyConceptCapture(value:unknown,originalBodyText:unknown):DeepReadonly<SecCaptureSliceResult> {
  const q=parsed(SecCaptureSliceInputSchema,value,SEC_CAPTURE_SLICE_LIMITS.input_bytes);
  requireThat(typeof originalBodyText==='string','invalid_body_text');
  requireThat(originalBodyText.length<=SEC_CAPTURE_SLICE_LIMITS.body_bytes,'body_too_large');
  requireThat(wellFormed(originalBodyText),'invalid_body_text');
  const bytes=Buffer.byteLength(originalBodyText,'utf8');requireThat(bytes<=SEC_CAPTURE_SLICE_LIMITS.body_bytes,'body_too_large');
  const hash=createHash('sha256').update(originalBodyText,'utf8').digest('hex');requireThat(hash===q.capture.expected_body_sha256,'capture_hash_mismatch');
  const url=`https://data.sec.gov/api/xbrl/companyconcept/CIK${q.request.cik}/${q.request.taxonomy}/${q.request.concept}.json`;
  requireThat(q.capture.source_url===url,'source_context_mismatch');
  requireThat(localDay(q.cutoff,q.calendar_guard.timezone)===q.calendar_guard.cutoff_local_date,'invalid_calendar_guard');
  requireThat(compareInstants(q.capture.received_at,q.cutoff)<=0,'future_receipt');
  const receiptDay=localDay(q.capture.received_at,q.calendar_guard.timezone);
  const p=RawPayload.safeParse(parseOriginal(originalBodyText));if(!p.success)fail('invalid_source_metadata');const raw=p.data;
  requireThat(cik(raw.cik)===q.request.cik&&raw.taxonomy===q.request.taxonomy&&raw.tag===q.request.concept,'source_context_mismatch');
  const source_units:SecCaptureSliceResult['source_units']=[],all:SecCaptureSliceResult['facts']=[];
  for(const [unit,rows]of Object.entries(raw.units)){const ui=source_units.length;source_units.push({unit_raw:unit,source_unit_index:ui,first_source_index:all.length,fact_count:rows.length});
    for(const [ri,f]of rows.entries())all.push({source_index:all.length,source_unit_index:ui,source_row_index:ri,unit_raw:unit,numeric_lexeme:f.val.lexeme,
      start:f.start??null,end:f.end,accession_number:f.accn,filed:f.filed,fiscal_year:f.fy??null,fiscal_period:f.fp??null,form:f.form,frame:f.frame??null,
      period_kind:f.start?'duration':'instant',accounting_basis:null,canonical_metric:null});}
  let facts:SecCaptureSliceResult['facts'];
  if(q.selection.kind==='source_indices'){requireThat(q.selection.indices.every(i=>i<all.length),'selection_out_of_bounds');facts=q.selection.indices.map(i=>all[i]!);}
  else{requireThat(q.selection.offset<=all.length,'selection_out_of_bounds');facts=all.slice(q.selection.offset,q.selection.offset+q.selection.count);}
  for(const f of facts){requireThat(f.end<=q.calendar_guard.cutoff_local_date&&f.filed<=q.calendar_guard.cutoff_local_date,'future_source_date');requireThat(f.end<=f.filed&&f.filed<=receiptDay,'invalid_chronology');}
  const result=SecCaptureSliceResultSchema.safeParse({contract:'moai.sec.company-concept-capture-slice.v1',provider:'SEC',request:q.request,selection:q.selection,
    capture:{origin:q.capture.origin,received_at:q.capture.received_at,source_url:url,body_sha256:hash,body_byte_length:bytes,hash_scope:'decoded_response_text_utf8',hash_algorithm:'sha256',provenance_status:'caller_supplied_capture_metadata',source_authentication:'not_established'},
    cutoff:q.cutoff,calendar_guard:q.calendar_guard,identity_status:'source_cik_matched_not_security_identity',source_as_of:null,rights:'pending',entity_name:raw.entityName,taxonomy:raw.taxonomy,concept:raw.tag,label:raw.label,
    source_units,facts,total_fact_count:all.length,selected_fact_count:facts.length,omitted_fact_count:all.length-facts.length,omitted_before_count:facts[0]?.source_index??(q.selection.kind==='provider_order_window'?q.selection.offset:0),omitted_between_count:facts.length?facts.at(-1)!.source_index-facts[0]!.source_index+1-facts.length:0,omitted_after_count:facts.length?all.length-facts.at(-1)!.source_index-1:0,selected_source_index_min:facts[0]?.source_index??null,selected_source_index_max:facts.at(-1)?.source_index??null,
    selection_policy:'explicit_capture_bound_provider_order_no_semantic_selection',coverage_status:'supplied_capture_only_not_complete_filing_history',warnings:[...Warnings]});
  if(!result.success)fail('invalid_source_metadata');return freeze(result.data);
}
/** Runtime verification requires separate trusted expectations AND original text; structural schemas are insufficient. */
export function verifySecCompanyConceptCaptureSlice(persisted:unknown,input:unknown,originalBodyText:unknown):DeepReadonly<SecCaptureSliceResult> {
  const given=parsed(SecCaptureSliceResultSchema,persisted,SEC_CAPTURE_SLICE_LIMITS.persisted_bytes);
  const rebuilt=sliceSecCompanyConceptCapture(input,originalBodyText);requireThat(canonical(given)===canonical(rebuilt),'slice_mismatch');return rebuilt;
}

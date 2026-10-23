import {z} from 'zod';
import {SEC_US_GAAP_CONCEPTS,SEC_IFRS_FULL_CONCEPTS,isSecConceptAllowed} from './sec-concept-catalog.js';
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(`${s}T00:00:00Z`);return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===s;});
// Cheap shape checks only: invalid/overlong CIKs never reach numeric conversion.
const cik=z.string().length(10,{abort:true}).regex(/^[0-9]{10}$/).refine(s=>s!=='0000000000');
const accession=z.string().regex(/^\d{10}-\d{2}-\d{6}$/);
// Only raw-input support expands. Taxonomy membership is exact; no aliases or financial-role mapping.
export const SecConceptInputSchema=z.object({cik,taxonomy:z.enum(['us-gaap','ifrs-full']),concept:z.enum([...SEC_US_GAAP_CONCEPTS,...SEC_IFRS_FULL_CONCEPTS]),max_facts:z.number().int().min(1).max(100).default(50)}).strict().refine(x=>isSecConceptAllowed(x.taxonomy,x.concept));
export const SecSubmissionsInputSchema=z.object({cik,max_filings:z.number().int().min(1).max(100).default(50)}).strict();
const Lexeme=z.string().max(200).regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/);
const Unit=z.string().regex(/^[A-Za-z][A-Za-z0-9_/-]{0,79}$/);
const Fact=z.object({unit_raw:Unit,numeric_lexeme:Lexeme,start:day.nullable(),end:day,accession_number:accession,filed:day,fiscal_year:z.number().int().min(1900).max(9999).nullable(),fiscal_period:z.string().max(10).nullable(),form:z.string().min(1).max(30),frame:z.string().max(60).nullable(),period_kind:z.enum(['duration','instant']),accounting_basis:z.null(),canonical_metric:z.null()}).strict().superRefine((x,c)=>{if((x.start===null)!==(x.period_kind==='instant')||(x.start&&x.start>x.end))c.addIssue({code:'custom',message:'period_conflict'});});
const common={provider:z.literal('SEC'),origin:z.enum(['actual','synthetic']),received_at:z.string().datetime({offset:true}),source_as_of:z.null(),rights:z.literal('pending'),identity_status:z.literal('cik_matched'),source_url:z.string().url(),warnings:z.array(z.string()).min(1)};
export const SecConceptResultSchema=z.object({contract:z.literal('moai.sec.company-concept.v1'),...common,request:SecConceptInputSchema,entity_name:z.string().max(1000),taxonomy:z.enum(['us-gaap','ifrs-full']),concept:z.string(),label:z.string().max(1000),facts:z.array(Fact).max(100),total_fact_count:z.number().int().nonnegative(),truncated:z.boolean(),selection:z.literal('provider_unit_and_row_order_first_n')}).strict().superRefine((x,c)=>{if(x.taxonomy!==x.request.taxonomy||x.concept!==x.request.concept||x.source_url!==`https://data.sec.gov/api/xbrl/companyconcept/CIK${x.request.cik}/${x.request.taxonomy}/${x.request.concept}.json`||x.facts.length!==Math.min(x.total_fact_count,x.request.max_facts)||x.truncated!==(x.total_fact_count>x.facts.length))c.addIssue({code:'custom',message:'concept_context_conflict'});});
const Filing=z.object({accession_number:accession,filing_date:day,report_date:day.nullable(),acceptance_datetime:z.string().datetime({offset:true}).nullable(),form:z.string().min(1).max(30),primary_document:z.string().max(500),primary_doc_description:z.string().max(2000)}).strict();
export const SecSubmissionsResultSchema=z.object({contract:z.literal('moai.sec.submissions.v1'),...common,request:SecSubmissionsInputSchema,entity_name:z.string().max(1000),tickers:z.array(z.string().max(30)).max(100),exchanges:z.array(z.string().max(100)).max(100),filings:z.array(Filing).max(100),recent_filing_count:z.number().int().nonnegative(),omitted_recent_count:z.number().int().nonnegative(),historical_file_count:z.number().int().nonnegative(),completeness:z.literal('recent_subset_historical_files_not_fetched')}).strict().superRefine((x,c)=>{if(x.source_url!==`https://data.sec.gov/submissions/CIK${x.request.cik}.json`||x.filings.length!==Math.min(x.recent_filing_count,x.request.max_filings)||x.omitted_recent_count!==x.recent_filing_count-x.filings.length)c.addIssue({code:'custom',message:'submissions_context_conflict'});if(new Set(x.filings.map(f=>f.accession_number)).size!==x.filings.length)c.addIssue({code:'custom',message:'duplicate_accession'});});
export interface SecRequest{operation:'sec.company_concept'|'sec.submissions';method:'GET';url:string}
/** Body MUST be the original JSON response text, not JSON.stringify(parsed), to preserve numeric lexemes. */
export interface SecPublicTransport{origin:'actual'|'synthetic';send(request:SecRequest):Promise<{status:number;body_text:string}>}
const NUMBER_TOKEN=Symbol('original-json-number');
function exactMetadataInteger(value:number,source?:string):boolean{
 // Bound work before scanning the original token; Number.isInteger alone loses tiny fractional tails.
 if(!source||source.length>200)return false;
 const match=/^-?(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);if(!match)return false;
 const exponentText=match[3]??'0';const exponentDigits=exponentText.replace(/^[+-]?0*/,'');
 // Convert at most three significant exponent digits, never expand powers or unbounded zero strings.
 if(exponentDigits.length>3)return false;
 const exponent=(exponentText.startsWith('-')?-1:1)*Number(exponentDigits||'0');if(Math.abs(exponent)>200)return false;
 const fraction=match[2]??'';const digits=match[1]!+fraction;const discardedPlaces=fraction.length-exponent;
 if(discardedPlaces>0&&!/^0+$/.test(discardedPlaces>=digits.length?digits:digits.slice(-discardedPlaces)))return false;
 return Number.isSafeInteger(value);
}
// Local resource/ambiguity profile, not SEC completeness or authenticity evidence.
const SEC_JSON_LIMITS=Object.freeze({text_code_units:3_000_000,utf8_bytes:3_000_000,depth:64,nodes:250_000,key_encoded_code_units:1536,key_decoded_code_units:256});
/** Reject duplicate decoded keys before JSON.parse can overwrite source tokens.
 * This bounded structural pass performs no numeric conversion. The existing JSON
 * parser remains authoritative for primitive grammar and original number tokens.
 */
function assertUnambiguousJson(text:string):void{
 let index=0,nodes=0;
 const fail=():never=>{throw new Error('provider_response_schema_drift');};
 const space=()=>{while(index<text.length&&(text[index]===' '||text[index]==='\t'||text[index]==='\r'||text[index]==='\n'))index++;};
 const quoted=(key:boolean):string|undefined=>{
  if(text[index]!=='"')return fail();
  const start=index++;
  while(index<text.length){
   // Bound the encoded key before slicing, decoding, hashing or comparing it.
   if(key&&index-start-1>SEC_JSON_LIMITS.key_encoded_code_units)return fail();
   const c=text.charCodeAt(index++);
   if(c===34){
    if(!key)return undefined;
    const decoded:unknown=JSON.parse(text.slice(start,index));
    if(typeof decoded!=='string'||decoded.length>SEC_JSON_LIMITS.key_decoded_code_units)return fail();
    return decoded;
   }
   if(c<32)return fail();
   if(c===92){if(index>=text.length)return fail();index++;}
  }
  return fail();
 };
 const value=(depth:number):void=>{
  if(depth>SEC_JSON_LIMITS.depth||++nodes>SEC_JSON_LIMITS.nodes)return fail();
  space();const c=text[index];
  if(c==='{'){
   index++;space();const seen=new Set<string>();if(text[index]==='}'){index++;return;}
   while(true){
    space();const key=quoted(true)!;if(seen.has(key))return fail();seen.add(key);
    space();if(text[index++]!==':')return fail();value(depth+1);space();
    const separator=text[index++];if(separator==='}')return;if(separator!==',')return fail();
   }
  }
  if(c==='['){
   index++;space();if(text[index]===']'){index++;return;}
   while(true){value(depth+1);space();const separator=text[index++];if(separator===']')return;if(separator!==',')return fail();}
  }
  if(c==='"'){quoted(false);return;}
  const start=index;
  while(index<text.length){const p=text[index];if(p===','||p===']'||p==='}'||p===' '||p==='\t'||p==='\r'||p==='\n')break;index++;}
  if(index===start)return fail();
 };
 value(0);space();if(index!==text.length)fail();
}
function parseText(text:string):unknown{if(typeof text!=='string'||text.length>SEC_JSON_LIMITS.text_code_units||Buffer.byteLength(text,'utf8')>SEC_JSON_LIMITS.utf8_bytes)throw new Error('response_too_large');try{assertUnambiguousJson(text);return JSON.parse(text,(key,value,context?:{source?:string})=>{if(key==='val'&&typeof value==='number'){if(!context?.source||!Lexeme.safeParse(context.source).success)throw new Error('numeric_lexeme_unavailable');return {lexeme:context.source,[NUMBER_TOKEN]:true};}if((key==='cik'||key==='fy')&&typeof value==='number'&&!exactMetadataInteger(value,context?.source))throw new Error('invalid_integer_metadata');return value;});}catch{throw new Error('provider_response_schema_drift');}}
function normalizedCik(v:unknown):string{if(typeof v==='number'&&Number.isSafeInteger(v)&&v>0)return String(v).padStart(10,'0');if(typeof v==='string'&&/^\d{1,10}$/.test(v))return v.padStart(10,'0');throw new Error('provider_response_schema_drift');}
const RawFact=z.object({val:z.custom<{lexeme:string}>(v=>typeof v==='object'&&v!==null&&(v as Record<symbol,unknown>)[NUMBER_TOKEN]===true&&Lexeme.safeParse((v as {lexeme:unknown}).lexeme).success),start:day.optional(),end:day,accn:accession,filed:day,fy:z.number().int().min(1900).max(9999).nullable().optional(),fp:z.string().max(10).nullable().optional(),form:z.string().min(1).max(30),frame:z.string().max(60).optional()}).strip().refine(x=>!x.start||x.start<=x.end);
export async function requestSecCompanyConcept(input:unknown,transport:SecPublicTransport,clock:()=>string=()=>new Date().toISOString()){
 const query=SecConceptInputSchema.safeParse(input);if(!query.success)throw new Error('invalid_input');const q=query.data;const url=`https://data.sec.gov/api/xbrl/companyconcept/CIK${q.cik}/${q.taxonomy}/${q.concept}.json`;const response=await transport.send({operation:'sec.company_concept',method:'GET',url});const received_at=clock();if(response.status!==200)throw new Error('upstream_rejected');
 const payload=z.object({cik:z.unknown(),entityName:z.string().max(1000),taxonomy:z.string(),tag:z.string(),label:z.string().max(1000),units:z.record(Unit,z.array(RawFact).max(10000))}).strip().safeParse(parseText(response.body_text));if(!payload.success)throw new Error('provider_response_schema_drift');const raw=payload.data;if(normalizedCik(raw.cik)!==q.cik||raw.taxonomy!==q.taxonomy||raw.tag!==q.concept)throw new Error('instrument_mismatch');
 const facts=Object.entries(raw.units).flatMap(([unit,rows])=>rows.map(f=>({unit_raw:unit,numeric_lexeme:f.val.lexeme,start:f.start??null,end:f.end,accession_number:f.accn,filed:f.filed,fiscal_year:f.fy??null,fiscal_period:f.fp??null,form:f.form,frame:f.frame??null,period_kind:f.start?'duration' as const:'instant' as const,accounting_basis:null,canonical_metric:null})));
 return SecConceptResultSchema.parse({contract:'moai.sec.company-concept.v1',provider:'SEC',origin:transport.origin,received_at,source_as_of:null,rights:'pending',identity_status:'cik_matched',source_url:url,request:q,entity_name:raw.entityName,taxonomy:raw.taxonomy,concept:raw.tag,label:raw.label,facts:facts.slice(0,q.max_facts),total_fact_count:facts.length,truncated:facts.length>q.max_facts,selection:'provider_unit_and_row_order_first_n',warnings:['Original JSON numeric lexemes retained exactly; raw transport must never reserialize previously parsed numeric data.','Units are source XBRL units, not an implicit currency conversion or inferred reporting scale.','All reported versions retained in provider order, not latest/restatement selection. No quarterly/cumulative or accounting-basis inference.','No complete company financial model, recommendation, rights clearance or live verification is implied.']});
}
export async function requestSecSubmissions(input:unknown,transport:SecPublicTransport,clock:()=>string=()=>new Date().toISOString()){
 const query=SecSubmissionsInputSchema.safeParse(input);if(!query.success)throw new Error('invalid_input');const q=query.data;const url=`https://data.sec.gov/submissions/CIK${q.cik}.json`;const response=await transport.send({operation:'sec.submissions',method:'GET',url});const received_at=clock();if(response.status!==200)throw new Error('upstream_rejected');
 const columns=z.object({accessionNumber:z.array(accession),filingDate:z.array(day),reportDate:z.array(z.union([day,z.literal('')])),acceptanceDateTime:z.array(z.union([z.string().datetime({offset:true}),z.literal('')])),form:z.array(z.string().min(1).max(30)),primaryDocument:z.array(z.string().max(500)),primaryDocDescription:z.array(z.string().max(2000))}).strip();
 const payload=z.object({cik:z.unknown(),name:z.string().max(1000),tickers:z.array(z.string().max(30)).max(100),exchanges:z.array(z.string().max(100)).max(100),filings:z.object({recent:columns,files:z.array(z.object({name:z.string().max(200)}).strip()).max(1000)}).strip()}).strip().safeParse(parseText(response.body_text));if(!payload.success)throw new Error('provider_response_schema_drift');const raw=payload.data;if(normalizedCik(raw.cik)!==q.cik)throw new Error('instrument_mismatch');const recent=raw.filings.recent;const count=recent.accessionNumber.length;if(count>10000||Object.values(recent).some(v=>v.length!==count)||new Set(recent.accessionNumber).size!==count)throw new Error('provider_response_schema_drift');
 const filings=recent.accessionNumber.slice(0,q.max_filings).map((acc,i)=>({accession_number:acc,filing_date:recent.filingDate[i],report_date:recent.reportDate[i]||null,acceptance_datetime:recent.acceptanceDateTime[i]||null,form:recent.form[i],primary_document:recent.primaryDocument[i],primary_doc_description:recent.primaryDocDescription[i]}));
 return SecSubmissionsResultSchema.parse({contract:'moai.sec.submissions.v1',provider:'SEC',origin:transport.origin,received_at,source_as_of:null,rights:'pending',identity_status:'cik_matched',source_url:url,request:q,entity_name:raw.name,tickers:raw.tickers,exchanges:raw.exchanges,filings,recent_filing_count:count,omitted_recent_count:count-filings.length,historical_file_count:raw.filings.files.length,completeness:'recent_subset_historical_files_not_fetched',warnings:['No historical files or linked primary documents fetched. Filing metadata is not article/report text.','CIK identifies reporting entity; ticker/exchange lists are not proven one-to-one or current security mappings.','Acceptance timestamps retained only with explicit timezone; filing/report dates are not publication instants.','User-agent/fair-access transport integration and data use review remain host responsibilities.']});
}

import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { z } from 'zod';
import { SecCaptureSliceInputSchema, SecCaptureSliceResultSchema, verifySecCompanyConceptCaptureSlice } from './sec-capture-slices.js';
import { SecSubmissionsResultSchema } from './sec-public-data.js';
import { FinancialCalendarGuardSchema, REPORTED_FINANCIAL_ROLES, SecFinancialSelectorSchema } from './financial-evidence-selection.js';
import { ExactInstantSchema, compareInstants } from './exact-instant.js';

/** Additive, offline and noncanonical. Never a legacy first-N DTO or a financial bridge input. */
export const SEC_CAPTURE_FINANCIAL_LIMITS = Object.freeze({ input_bytes:6_000_000, persisted_bytes:12_000_000,
  body_bytes:3_000_000, nodes:500_000, depth:24, keys_per_container:10_001 });
export const SEC_CAPTURE_FINANCIAL_ERROR_CODES = ['invalid_input','invalid_snapshot','input_too_large','invalid_body_text',
  'body_too_large','forbidden_field','source_context_mismatch','issuer_mismatch','origin_mismatch','selection_absent',
  'selection_ambiguous','source_locator_mismatch','filing_absent','filing_ambiguous','filing_metadata_mismatch',
  'invalid_calendar_guard','future_receipt','future_source_date','invalid_chronology','candidate_mismatch'] as const;
export type SecCaptureFinancialErrorCode=typeof SEC_CAPTURE_FINANCIAL_ERROR_CODES[number];
export class SecCaptureFinancialError extends Error {
  constructor(readonly code:SecCaptureFinancialErrorCode){super(code);this.name='SecCaptureFinancialError';}
}
function fail(code:SecCaptureFinancialErrorCode):never{throw new SecCaptureFinancialError(code);}
function check(ok:unknown,code:SecCaptureFinancialErrorCode):asserts ok{if(!ok)fail(code);}
const Sha=z.string().regex(/^[a-f0-9]{64}$/);
const Index=z.number().int().min(0).max(250_000);
export const SecCaptureFinancialSourceLocatorSchema=z.object({source_index:Index,source_unit_index:Index,source_row_index:Index}).strict();
const Submissions=SecSubmissionsResultSchema.refine(s=>ExactInstantSchema.safeParse(s.received_at).success &&
  [s.recent_filing_count,s.omitted_recent_count,s.historical_file_count].every(Number.isSafeInteger) &&
  s.filings.every(f=>f.acceptance_datetime===null||ExactInstantSchema.safeParse(f.acceptance_datetime).success));
export const SecCaptureFinancialSelectionInputSchema=z.object({
  requested_role:z.enum(REPORTED_FINANCIAL_ROLES),cutoff:ExactInstantSchema,calendar_guard:FinancialCalendarGuardSchema,
  selector:SecFinancialSelectorSchema,source_locator:SecCaptureFinancialSourceLocatorSchema,
  capture_slice_input:SecCaptureSliceInputSchema,capture_slice_result:SecCaptureSliceResultSchema,submissions_result:Submissions,
}).strict();
export type SecCaptureFinancialSelectionInput=z.infer<typeof SecCaptureFinancialSelectionInputSchema>;
const BLOCKERS=[ 'source_authenticity_not_independently_verified','security_identity_not_verified','semantic_role_binding_not_verified',
  'unit_scale_currency_and_accounting_basis_not_verified','publication_availability_not_verified',
  'complete_coverage_finality_and_revision_choice_not_verified','rights_pending' ] as const;
const WARNINGS=[
  'Capture-bound selected evidence is not a canonical fact, an authenticated source, or an eligible metric input.',
  'Original capture SHA256 binds decoded response text encoded as UTF-8 to independent caller expectations; it is not a signature, authenticated transport, compressed HTTP bytes, or rights clearance.',
  'Capture metadata and supplied submissions DTO remain caller assertions. The submissions hash covers only a validated DTO, not its original HTTP body.',
  'Numeric lexeme, source ordinals, unit and period labels are preserved without conversion, scaling, accounting-basis inference, aggregation or semantic role binding.',
  'Exact uniqueness applies only to the supplied capture slice and bounded submissions subset; there is no latest, restatement, complete-history or publication-availability inference.',
  'Date labels, acceptance timestamps and constituent receipts do not prove publication availability. Calendar timezone remains caller-selected and unverified.',
  'Persisted verification must reconstruct from separately retained independent inputs and original capture text; embedded expectations and successful flags are not trusted.',
] as const;
const Controls={requested_role:z.enum(REPORTED_FINANCIAL_ROLES),cutoff:ExactInstantSchema,
  calendar_guard:FinancialCalendarGuardSchema.extend({status:z.literal('caller_selected_timezone_not_source_verified')})};
const Slice=SecCaptureSliceResultSchema;
export const SecCaptureFinancialEvidenceCandidateSchema=z.object({
  contract:z.literal('moai.sec.capture-financial-evidence-candidate.v1'),provider:z.literal('SEC'),
  status:z.literal('capture_bound_selected_evidence_candidate_only'),origin:z.enum(['actual','synthetic']),...Controls,
  selector:SecFinancialSelectorSchema,source_locator:SecCaptureFinancialSourceLocatorSchema,
  role_association_status:z.literal('unverified_caller_request'),semantic_binding_verified:z.literal(false),
  canonical_fact:z.null(),metric_eligible:z.literal(false),published_at:z.null(),available_at:z.null(),source_authentication:z.literal('not_established'),
  rights_status:z.literal('pending'),unit_scale:z.null(),accounting_basis:z.null(),finality:z.literal('unknown'),coverage_complete:z.literal(false),
  selection_policy:z.literal('exact_caller_selector_and_capture_ordinal_no_latest_or_restatement_inference'),
  constituent_receipt_latest:ExactInstantSchema,receipt_status:z.literal('capture_and_dto_receipts_checked_not_publication_times'),
  issuer:z.object({cik:z.string().regex(/^\d{10}$/),status:z.literal('capture_and_supplied_dto_cik_join_only_not_security_identity')}).strict(),
  selected:z.object({row:Slice.shape.facts.element,filing:SecSubmissionsResultSchema.shape.filings.element,
    numeric_lexeme:Slice.shape.facts.element.shape.numeric_lexeme,unit_raw:Slice.shape.facts.element.shape.unit_raw,
    acceptance_datetime:ExactInstantSchema.nullable(),acceptance_status:z.literal('source_acceptance_metadata_not_publication_availability')}).strict(),
  coverage:z.object({concept_total_fact_count:Index,concept_selected_fact_count:z.number().int().min(0).max(100),concept_omitted_fact_count:Index,
    capture_coverage:Slice.shape.coverage_status,filings_recent_count:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    filings_omitted_recent_count:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),historical_file_count:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    filings_completeness:SecSubmissionsResultSchema.shape.completeness,complete:z.literal(false)}).strict(),
  lineage:z.object({
    capture:z.object({independent_input:SecCaptureSliceInputSchema,value:Slice,body_sha256:Sha,
      hash_scope:z.literal('decoded_response_text_utf8'),original_text_included:z.literal(false),
      reconstruction_status:z.literal('reconstructed_against_supplied_independent_input_and_original_text'),source_authentication:z.literal('not_established')}).strict(),
    submissions:z.object({value:Submissions,sha256:Sha,hash_scope:z.literal('validated_provider_dto_snapshot'),hash_algorithm:z.literal('sha256'),
      serialization:z.literal('sorted_object_keys_json_utf8_v1'),original_http_body_hash:z.null(),source_authentication:z.literal('not_established')}).strict(),
  }).strict(),mapping_blockers:z.array(z.enum(BLOCKERS)).length(BLOCKERS.length),warnings:z.array(z.enum(WARNINGS)).length(WARNINGS.length),
}).strict();
export type SecCaptureFinancialEvidenceCandidate=z.infer<typeof SecCaptureFinancialEvidenceCandidateSchema>;
type DeepReadonly<T>=T extends object?{readonly[K in keyof T]:DeepReadonly<T[K]>}:T;
function freeze<T>(v:T):DeepReadonly<T>{if(v!==null&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v as DeepReadonly<T>;}
const forbidden=new Set(['__proto__','prototype','constructor','toJSON']);
function wellFormed(s:string):boolean{for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xD800&&c<=0xDBFF){const next=s.charCodeAt(++i);if(!(next>=0xDC00&&next<=0xDFFF))return false;}else if(c>=0xDC00&&c<=0xDFFF)return false;}return true;}
/** Descriptor-only, bounded plain JSON snapshot before any schema or serialization work. */
function snapshot(value:unknown,maxBytes:number):unknown{
  let nodes=0,bytes=0;const seen=new Set<object>();
  function string(s:string){check(s.length<=maxBytes-bytes,'input_too_large');bytes+=Buffer.byteLength(s,'utf8');check(bytes<=maxBytes,'input_too_large');check(wellFormed(s),'invalid_snapshot');}
  function copy(v:unknown,depth:number):unknown{
    check(++nodes<=SEC_CAPTURE_FINANCIAL_LIMITS.nodes&&depth<=SEC_CAPTURE_FINANCIAL_LIMITS.depth,'input_too_large');
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='number'){check(Number.isSafeInteger(v)&&!Object.is(v,-0),'invalid_snapshot');return v;}
    if(typeof v==='string'){string(v);return v;}
    check(typeof v==='object'&&!types.isProxy(v)&&!seen.has(v),'invalid_snapshot');
    const a=Array.isArray(v),p=Object.getPrototypeOf(v);check(a?p===Array.prototype||p===null:p===Object.prototype||p===null,'invalid_snapshot');
    const length=a?Object.getOwnPropertyDescriptor(v,'length')?.value:null;
    if(a)check(Number.isSafeInteger(length)&&length>=0&&length<SEC_CAPTURE_FINANCIAL_LIMITS.keys_per_container,'input_too_large');
    const keys=Reflect.ownKeys(v);check(keys.length<=SEC_CAPTURE_FINANCIAL_LIMITS.keys_per_container,'input_too_large');
    check(!a||keys.length===length+1,'invalid_snapshot');const out=a?[]:Object.create(null);seen.add(v);
    for(const k of keys){check(typeof k==='string','invalid_snapshot');
      if(a&&k==='length')continue;
      // Array bounds make long index spellings impossible; reject before regex, hashing, UTF-8 or Number conversion.
      check(!a||k.length<=String(length-1).length,'invalid_snapshot');string(k);check(!forbidden.has(k),'forbidden_field');
      const d=Object.getOwnPropertyDescriptor(v,k);check(d&&'value'in d,'invalid_snapshot');
      check(d.enumerable&&(!a||/^(0|[1-9]\d*)$/.test(k)&&Number(k)<length),'invalid_snapshot');
      // Frozen SEC refinements call BigInt even after regex issues. Guard shape before copying/converting or running any schema.
      if(k==='cik')check(typeof d.value==='string'&&d.value.length===10&&/^\d{10}$/.test(d.value),'invalid_input');
      Object.defineProperty(out,k,{value:copy(d.value,depth+1),enumerable:true,writable:true,configurable:true});}
    seen.delete(v);return out;
  }
  try{return copy(value,0);}catch(e){if(e instanceof SecCaptureFinancialError)throw e;fail('invalid_snapshot');}
}
function canonical(v:unknown):string{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return`[${v.map(canonical).join(',')}]`;return`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical((v as Record<string,unknown>)[k])}`).join(',')}}`;}
function parsed<T>(schema:z.ZodType<T>,value:unknown,maxBytes:number):T{
  const safe=snapshot(value,maxBytes);let data:T;
  // Legacy schema refinements can throw rather than return an issue; never expose native errors/source text.
  try{const p=schema.safeParse(safe);check(p.success,'invalid_input');data=p.data;}catch{fail('invalid_input');}
  // No silent defaults, stripped properties or lossy JSON normalization are accepted at this boundary.
  check(canonical(safe)===canonical(data),'invalid_input');return data;
}
/** This preflight rejects prototype-bearing source keys, including escaped aliases, without converting any source number. */
function bodyPreflight(body:unknown):asserts body is string{
  check(typeof body==='string','invalid_body_text');check(body.length<=SEC_CAPTURE_FINANCIAL_LIMITS.body_bytes,'body_too_large');
  check(Buffer.byteLength(body,'utf8')<=SEC_CAPTURE_FINANCIAL_LIMITS.body_bytes,'body_too_large');check(wellFormed(body),'invalid_body_text');
  for(let i=0;i<body.length;i++){if(body[i]!=='"')continue;const start=i++;let closed=false;
    for(;i<body.length;i++){if(body[i]==='\\'){i++;continue;}if(body[i]==='"'){closed=true;break;}}
    check(closed,'invalid_body_text');let j=i+1;while(j<body.length&&/[\x20\t\r\n]/.test(body[j]!))j++;
    if(body[j]===':'){let key:unknown;try{key=JSON.parse(body.slice(start,i+1));}catch{fail('invalid_body_text');}check(typeof key==='string'&&!forbidden.has(key),'forbidden_field');}
  }
}
function localDay(instant:string,timezone:string):string{
  try{const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',era:'short'}).formatToParts(new Date(instant.replace(/\.\d+(?=Z$|[+-]\d{2}:\d{2}$)/,'')));
    const f=(t:string)=>parts.find(p=>p.type===t)?.value;check(f('era')==='AD','invalid_calendar_guard');return`${f('year')?.padStart(4,'0')}-${f('month')}-${f('day')}`;
  }catch{fail('invalid_calendar_guard');}
}
function only<T>(rows:readonly T[],absent:SecCaptureFinancialErrorCode,ambiguous:SecCaptureFinancialErrorCode):T{check(rows.length>0,absent);check(rows.length===1,ambiguous);return rows[0]!;}

/** Independent input means separately retained caller controls, not values extracted from an untrusted candidate. No I/O or clock. */
export function selectSecCaptureFinancialEvidence(value:unknown,originalBodyText:unknown):DeepReadonly<SecCaptureFinancialEvidenceCandidate>{
  const q=parsed(SecCaptureFinancialSelectionInputSchema,value,SEC_CAPTURE_FINANCIAL_LIMITS.input_bytes);bodyPreflight(originalBodyText);
  // Authoritative capture verification is mandatory even for a previously successful serialized slice.
  const c=verifySecCompanyConceptCaptureSlice(q.capture_slice_result,q.capture_slice_input,originalBodyText),s=q.selector,f=q.submissions_result;
  check(q.cutoff===c.cutoff&&canonical(q.calendar_guard)===canonical(c.calendar_guard),'source_context_mismatch');
  check(c.request.cik===f.request.cik&&s.cik===c.request.cik,'issuer_mismatch');check(c.capture.origin===f.origin,'origin_mismatch');
  check(s.taxonomy===c.taxonomy&&s.concept===c.concept,'source_context_mismatch');
  check(localDay(q.cutoff,q.calendar_guard.timezone)===q.calendar_guard.cutoff_local_date,'invalid_calendar_guard');
  const receipts=[c.capture.received_at,f.received_at];for(const r of receipts)check(compareInstants(r,q.cutoff)<=0,'future_receipt');
  const row=only(c.facts.filter(r=>r.unit_raw===s.unit_raw&&r.start===s.start&&r.end===s.end&&r.period_kind===s.period_kind&&
    r.accession_number===s.accession_number&&r.filed===s.filed&&r.fiscal_year===s.fiscal_year&&r.fiscal_period===s.fiscal_period&&r.form===s.form&&r.frame===s.frame),'selection_absent','selection_ambiguous');
  check(row.source_index===q.source_locator.source_index&&row.source_unit_index===q.source_locator.source_unit_index&&row.source_row_index===q.source_locator.source_row_index,'source_locator_mismatch');
  const filing=only(f.filings.filter(r=>r.accession_number===s.accession_number),'filing_absent','filing_ambiguous');
  check(filing.form===row.form&&filing.filing_date===row.filed&&filing.filing_date===s.filing.filing_date&&filing.report_date===s.filing.report_date&&
    filing.acceptance_datetime===s.filing.acceptance_datetime&&filing.primary_document===s.filing.primary_document,'filing_metadata_mismatch');
  function checkDate(day:string,receipt:string){check(day<=q.calendar_guard.cutoff_local_date,'future_source_date');check(day<=localDay(receipt,q.calendar_guard.timezone),'invalid_chronology');}
  checkDate(row.end,c.capture.received_at);checkDate(row.filed,c.capture.received_at);checkDate(filing.filing_date,f.received_at);check(row.end<=row.filed,'invalid_chronology');
  if(filing.report_date!==null){checkDate(filing.report_date,f.received_at);check(row.end<=filing.report_date&&filing.report_date<=filing.filing_date,'invalid_chronology');}
  if(filing.acceptance_datetime!==null){for(const latest of [...receipts,q.cutoff])check(compareInstants(filing.acceptance_datetime,latest)<=0,'invalid_chronology');}
  const result={contract:'moai.sec.capture-financial-evidence-candidate.v1',provider:'SEC',status:'capture_bound_selected_evidence_candidate_only',
    origin:c.capture.origin,requested_role:q.requested_role,cutoff:q.cutoff,calendar_guard:{...q.calendar_guard,status:'caller_selected_timezone_not_source_verified'},
    selector:s,source_locator:q.source_locator,role_association_status:'unverified_caller_request',semantic_binding_verified:false,
    canonical_fact:null,metric_eligible:false,published_at:null,available_at:null,source_authentication:'not_established',rights_status:'pending',
    unit_scale:null,accounting_basis:null,finality:'unknown',coverage_complete:false,
    selection_policy:'exact_caller_selector_and_capture_ordinal_no_latest_or_restatement_inference',
    constituent_receipt_latest:receipts.reduce((a,b)=>compareInstants(a,b)>=0?a:b),receipt_status:'capture_and_dto_receipts_checked_not_publication_times',
    issuer:{cik:s.cik,status:'capture_and_supplied_dto_cik_join_only_not_security_identity'},
    selected:{row,filing,numeric_lexeme:row.numeric_lexeme,unit_raw:row.unit_raw,acceptance_datetime:filing.acceptance_datetime,acceptance_status:'source_acceptance_metadata_not_publication_availability'},
    coverage:{concept_total_fact_count:c.total_fact_count,concept_selected_fact_count:c.selected_fact_count,concept_omitted_fact_count:c.omitted_fact_count,
      capture_coverage:c.coverage_status,filings_recent_count:f.recent_filing_count,filings_omitted_recent_count:f.omitted_recent_count,
      historical_file_count:f.historical_file_count,filings_completeness:f.completeness,complete:false},
    lineage:{capture:{independent_input:q.capture_slice_input,value:c,body_sha256:c.capture.body_sha256,hash_scope:'decoded_response_text_utf8',original_text_included:false,
      reconstruction_status:'reconstructed_against_supplied_independent_input_and_original_text',source_authentication:'not_established'},
      submissions:{value:f,sha256:createHash('sha256').update(canonical(f),'utf8').digest('hex'),hash_scope:'validated_provider_dto_snapshot',hash_algorithm:'sha256',
        serialization:'sorted_object_keys_json_utf8_v1',original_http_body_hash:null,source_authentication:'not_established'}},mapping_blockers:[...BLOCKERS],warnings:[...WARNINGS]};
  return freeze(SecCaptureFinancialEvidenceCandidateSchema.parse(result));
}
/** Rebuild every field from separately supplied controls, slice expectations, submissions and original text. Never derive expectations from persisted. */
export function verifySecCaptureFinancialEvidenceCandidate(persisted:unknown,independentInput:unknown,originalBodyText:unknown):DeepReadonly<SecCaptureFinancialEvidenceCandidate>{
  const given=parsed(SecCaptureFinancialEvidenceCandidateSchema,persisted,SEC_CAPTURE_FINANCIAL_LIMITS.persisted_bytes);
  const rebuilt=selectSecCaptureFinancialEvidence(independentInput,originalBodyText);check(canonical(given)===canonical(rebuilt),'candidate_mismatch');return rebuilt;
}

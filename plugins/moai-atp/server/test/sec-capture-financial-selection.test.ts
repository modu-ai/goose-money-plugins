import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { selectSecCaptureFinancialEvidence, verifySecCaptureFinancialEvidenceCandidate, SecCaptureFinancialError,
  SecCaptureFinancialEvidenceCandidateSchema, SEC_CAPTURE_FINANCIAL_LIMITS } from '../src/sec-capture-financial-selection.js';
import { sliceSecCompanyConceptCapture, SecCaptureSliceError } from '../src/sec-capture-slices.js';
import { REPORTED_FINANCIAL_ROLES, validateFinancialEvidenceCandidate, selectSecFinancialEvidence } from '../src/financial-evidence-selection.js';
import { assembleFinancialFact } from '../src/financial-fact-bridge.js';
import { SecConceptResultSchema } from '../src/sec-public-data.js';
import { captureFinancialFixture, captureFinancialFact, CAPTURE_FINANCIAL_RECEIPT } from './sec-capture-financial-selection-fixtures.js';
const failure=(code?:string)=>(e:unknown)=>(e instanceof SecCaptureFinancialError||e instanceof SecCaptureSliceError)&&(!code||e.code===code);
const clone=<T>(x:T):T=>JSON.parse(JSON.stringify(x));
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
function rebuild(q:Awaited<ReturnType<typeof captureFinancialFixture>>['input'],body:string){q.capture_slice_input.capture.expected_body_sha256=sha(body);q.capture_slice_result=JSON.parse(JSON.stringify(sliceSecCompanyConceptCapture(q.capture_slice_input,body)));}

test('capture financial: exact row beyond first 100 retains ordinal, lexeme, null fiscal metadata and independent lineage',async()=>{
 const {body,input:q}=await captureFinancialFixture(),before=clone(q),r=selectSecCaptureFinancialEvidence(q,body);
 assert.equal(r.contract,'moai.sec.capture-financial-evidence-candidate.v1');assert.equal(r.selected.row.source_index,110);
 assert.equal(r.selected.numeric_lexeme,'9007199254740993.2500');assert.equal(r.selected.row.fiscal_year,null);assert.equal(r.selected.row.fiscal_period,null);
 assert.deepEqual(r.source_locator,{source_index:110,source_unit_index:0,source_row_index:110});assert.equal(r.coverage.concept_total_fact_count,126);
 assert.equal(r.lineage.capture.body_sha256,sha(body));assert.deepEqual(r.lineage.capture.independent_input,q.capture_slice_input);
 assert.deepEqual(r.lineage.capture.value,q.capture_slice_result);assert.deepEqual(r.lineage.submissions.value,q.submissions_result);
 assert.equal(r.lineage.submissions.original_http_body_hash,null);assert.equal(r.lineage.submissions.hash_scope,'validated_provider_dto_snapshot');
 assert.equal(r.canonical_fact,null);assert.equal(r.metric_eligible,false);assert.equal(r.published_at,null);assert.equal(r.available_at,null);
 assert.equal(r.accounting_basis,null);assert.equal(r.unit_scale,null);assert.equal(r.rights_status,'pending');assert.equal(r.source_authentication,'not_established');
 assert.equal(r.semantic_binding_verified,false);assert.equal(r.coverage_complete,false);assert.equal(r.mapping_blockers.length,7);
 assert.deepEqual(q,before);assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.lineage.capture.value.facts));
 q.capture_slice_result.facts[1]!.numeric_lexeme='3';assert.equal(r.selected.numeric_lexeme,'9007199254740993.2500');
 assert.throws(()=>{(r.selected.row as{numeric_lexeme:string}).numeric_lexeme='3';},TypeError);
});
test('capture financial: persisted verification round trips and never upgrades to v1 or legacy candidate',async()=>{
 const {body,input:q}=await captureFinancialFixture(),r=selectSecCaptureFinancialEvidence(q,body);
 assert.deepEqual(verifySecCaptureFinancialEvidenceCandidate(clone(r),q,body),r);
 assert.ok(SecCaptureFinancialEvidenceCandidateSchema.safeParse(r).success);assert.ok(!SecConceptResultSchema.safeParse(r.lineage.capture.value).success);
 assert.throws(()=>validateFinancialEvidenceCandidate(r));assert.throws(()=>selectSecFinancialEvidence({...q,concept_result:q.capture_slice_result}));
});
test('capture financial: every existing role remains an unverified caller association',async()=>{
 const {body,input:q}=await captureFinancialFixture();for(const requested_role of REPORTED_FINANCIAL_ROLES){q.requested_role=requested_role;const r=selectSecCaptureFinancialEvidence(q,body);assert.equal(r.requested_role,requested_role);assert.equal(r.metric_eligible,false);assert.equal(r.semantic_binding_verified,false);}
 assert.throws(()=>selectSecCaptureFinancialEvidence({...q,requested_role:'reported.assets'},body),failure('invalid_input'));
});
for(const [key,value]of [['unit_raw','EUR'],['start','2025-01-02'],['end','2025-12-30'],['accession_number','0000000001-26-000112'],['filed','2026-02-11'],['fiscal_year',2025],['fiscal_period','FY'],['form','10-K/A'],['frame','CY2025']]as const){
 test(`capture financial: exact selector ${key} mismatch never falls back`,async()=>{const{body,input:q}=await captureFinancialFixture();Object.assign(q.selector,{[key]:value});assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('selection_absent'));});
}
for(const key of ['source_index','source_unit_index','source_row_index']as const){test(`capture financial: exact ${key} is enforced`,async()=>{const{body,input:q}=await captureFinancialFixture();q.source_locator[key]++;assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('source_locator_mismatch'));});}
test('capture financial: duplicate metadata rows remain ambiguous despite explicit ordinal, never latest inference',async()=>{
 const base=await captureFinancialFixture();const body=base.body.replace(captureFinancialFact(124),captureFinancialFact(110)),q=base.input;rebuild(q,body);
 assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('selection_ambiguous'));
});
test('capture financial: an excluded or empty slice does not infer another row',async()=>{
 const{body,input:q}=await captureFinancialFixture();q.capture_slice_input.selection={kind:'source_indices',indices:[100]};rebuild(q,body);
 assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('selection_absent'));
 q.capture_slice_input.selection={kind:'provider_order_window',offset:126,count:1};rebuild(q,body);assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('selection_absent'));
});
test('capture financial: issuer, origin and concept joins fail closed',async()=>{
 for(const mode of ['issuer','origin','taxonomy','concept']as const){const{body,input:q}=await captureFinancialFixture();
  if(mode==='issuer')q.selector.cik='0000000002';else if(mode==='origin')q.submissions_result.origin='actual';else if(mode==='taxonomy'){q.selector.taxonomy='ifrs-full';q.selector.concept='Revenue';}else q.selector.concept='Assets';
  assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure(mode==='issuer'?'issuer_mismatch':mode==='origin'?'origin_mismatch':'source_context_mismatch'));
 }
});
test('capture financial: absent and duplicate filings reject rather than select or deduplicate',async()=>{
 const{body,input:q}=await captureFinancialFixture();q.submissions_result.filings=[];q.submissions_result.recent_filing_count=0;
 assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('filing_absent'));
 const v=await captureFinancialFixture();v.input.submissions_result.filings.push(clone(v.input.submissions_result.filings[0]!));v.input.submissions_result.recent_filing_count=2;
 assert.throws(()=>selectSecCaptureFinancialEvidence(v.input,v.body),failure('invalid_input'));
});
for(const [key,value]of [['form','10-K/A'],['filing_date','2026-02-11'],['report_date','2025-12-30'],['acceptance_datetime','2026-02-10T15:30:00.000000002Z'],['primary_document','other.htm']]as const){test(`capture financial: filing ${key} join exact`,async()=>{const{body,input:q}=await captureFinancialFixture();Object.assign(q.submissions_result.filings[0]!,{[key]:value});assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('filing_metadata_mismatch'));});}
test('capture financial: candidate cutoff and calendar must match independently retained slice controls exactly',async()=>{
 const{body,input:q}=await captureFinancialFixture();q.cutoff='2026-10-22T00:00:00.123456790Z';assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('source_context_mismatch'));
 q.cutoff=CAPTURE_FINANCIAL_RECEIPT;q.calendar_guard={timezone:'America/New_York',cutoff_local_date:'2026-10-21'};assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('source_context_mismatch'));
 q.calendar_guard={timezone:'UTC',cutoff_local_date:'2026-10-21'};assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('source_context_mismatch'));
 q.calendar_guard=q.capture_slice_input.calendar_guard;q.cutoff='2026-10-22T09:00:00.123456789+09:00';assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('source_context_mismatch'));
});
test('capture financial: consistent offset-equivalent receipt comparisons succeed without rounding',async()=>{
 const{body,input:q}=await captureFinancialFixture();q.cutoff='2026-10-22T09:00:00.123456789+09:00';q.capture_slice_input.cutoff=q.cutoff;rebuild(q,body);
 q.submissions_result.received_at='2026-10-21T19:00:00.123456789-05:00';assert.equal(selectSecCaptureFinancialEvidence(q,body).metric_eligible,false);
 q.submissions_result.received_at='2026-10-21T19:00:00.123456790-05:00';assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('future_receipt'));
});
test('capture financial: acceptance <= both receipts and cutoff at exact subnanosecond precision',async()=>{
 for(const later of ['capture','submissions']as const){const{body,input:q}=await captureFinancialFixture();
  const earlier='2026-10-22T00:00:00.1234567889Z',acceptance='2026-10-22T00:00:00.123456789Z';
  q.selector.filing.acceptance_datetime=acceptance;q.submissions_result.filings[0]!.acceptance_datetime=acceptance;
  if(later==='capture'){q.capture_slice_input.capture.received_at=earlier;rebuild(q,body);}else q.submissions_result.received_at=earlier;
  assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('invalid_chronology'));
 }
 const{body,input:q}=await captureFinancialFixture();q.selector.filing.acceptance_datetime=q.cutoff;q.submissions_result.filings[0]!.acceptance_datetime=q.cutoff;
 assert.equal(selectSecCaptureFinancialEvidence(q,body).published_at,null);
 q.selector.filing.acceptance_datetime='2026-10-22T00:00:00.1234567891Z';q.submissions_result.filings[0]!.acceptance_datetime=q.selector.filing.acceptance_datetime;
 assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('invalid_chronology'));
});
test('capture financial: null acceptance/report dates stay null, invalid report chronology rejects',async()=>{
 const{body,input:q}=await captureFinancialFixture();q.selector.filing.acceptance_datetime=null;q.submissions_result.filings[0]!.acceptance_datetime=null;
 q.selector.filing.report_date=null;q.submissions_result.filings[0]!.report_date=null;assert.equal(selectSecCaptureFinancialEvidence(q,body).selected.acceptance_datetime,null);
 for(const date of ['2025-12-30','2026-02-11']){q.selector.filing.report_date=date;q.submissions_result.filings[0]!.report_date=date;assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('invalid_chronology'));}
});
for(const invalid of ['2026-02-30T00:00:00Z','2026-10-22T00:00:00-00:00','2026-10-22T00:00:00','2026-10-22T00:00:60Z']){test(`capture financial: invalid exact instant ${invalid} rejects`,async()=>{const{body,input:q}=await captureFinancialFixture();q.submissions_result.received_at=invalid;assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('invalid_input'));});}
test('capture financial: authoritative body and complete slice reconstruction reject same-semantics body changes and forged metadata',async()=>{
 const{body,input:q}=await captureFinancialFixture();assert.throws(()=>selectSecCaptureFinancialEvidence(q,body+' '),failure('capture_hash_mismatch'));
 for(const field of ['numeric_lexeme','unit_raw','source_index']as const){const changed=clone(q);Object.assign(changed.capture_slice_result.facts[1]!,{[field]:field==='source_index'?111:'3'});assert.throws(()=>selectSecCaptureFinancialEvidence(changed,body),failure());}
 const changed=clone(q);changed.capture_slice_result.entity_name='forged';assert.throws(()=>selectSecCaptureFinancialEvidence(changed,body),failure('slice_mismatch'));
});
test('capture financial: malicious persisted candidate cannot provide its own successful flags or altered expectations',async()=>{
 const{body,input:q}=await captureFinancialFixture(),original=selectSecCaptureFinancialEvidence(q,body),changedInput=clone(q);
 changedInput.requested_role='reported.debt';const altered=selectSecCaptureFinancialEvidence(changedInput,body);
 assert.throws(()=>verifySecCaptureFinancialEvidenceCandidate(altered,q,body),failure('candidate_mismatch'));
 const withFlag={...original,verified:true};assert.throws(()=>verifySecCaptureFinancialEvidenceCandidate(withFlag,q,body),failure('invalid_input'));
 const changed=clone(original) as unknown as{lineage:{capture:{independent_input:{capture:{expected_body_sha256:string}}}}};changed.lineage.capture.independent_input.capture.expected_body_sha256='0'.repeat(64);
 assert.throws(()=>verifySecCaptureFinancialEvidenceCandidate(changed,q,body),failure('candidate_mismatch'));
});
test('capture financial: persisted reconstruction checks every output family, including warnings and hashes',async()=>{
 const{body,input:q}=await captureFinancialFixture(),r=selectSecCaptureFinancialEvidence(q,body);
 const changes:((v:any)=>void)[]=[v=>v.selected.numeric_lexeme='3',v=>v.selected.row.numeric_lexeme='3',v=>v.lineage.capture.value.facts[0].numeric_lexeme='3',
  v=>v.lineage.capture.body_sha256='0'.repeat(64),v=>v.lineage.submissions.sha256='0'.repeat(64),v=>v.lineage.submissions.value.entity_name='forged',
  v=>v.source_locator.source_row_index++,v=>v.selector.filing.primary_document='forged.htm',v=>v.selected.filing.primary_doc_description='forged',
  v=>v.coverage.concept_total_fact_count++,v=>v.constituent_receipt_latest='2026-10-22T00:00:00.123456788Z',v=>v.warnings.reverse(),v=>v.mapping_blockers.reverse()];
 for(const change of changes){const modified=clone(r);change(modified);assert.throws(()=>verifySecCaptureFinancialEvidenceCandidate(modified,q,body),failure('candidate_mismatch'));}
});
test('capture financial: metadata exact-integer parsing is authoritative, no rounded fractional fiscal years',async()=>{
 const base=await captureFinancialFixture();for(const fy of ['2025.0000000000000000000001','2025e-999','9007199254740993']){
  const body=base.body.replace('"fy":null',`"fy":${fy}`),q=clone(base.input);q.capture_slice_input.capture.expected_body_sha256=sha(body);
  assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('invalid_source_metadata'));
 }
});
test('capture financial: body is primitive bounded original text; no object serialization or numeric conversion',async()=>{
 const{body,input:q}=await captureFinancialFixture();let calls=0;
 for(const bad of [new String(body),Buffer.from(body),{toString(){calls++;return body;}},null])assert.throws(()=>selectSecCaptureFinancialEvidence(q,bad),failure('invalid_body_text'));
 assert.equal(calls,0);assert.throws(()=>selectSecCaptureFinancialEvidence(q,' '.repeat(SEC_CAPTURE_FINANCIAL_LIMITS.body_bytes+1)),failure('body_too_large'));
 assert.throws(()=>selectSecCaptureFinancialEvidence(q,'한'.repeat(1_000_001)),failure('body_too_large'));
});
test('capture financial: prototype source keys and escaped aliases reject, including ignored fields',async()=>{
 const base=await captureFinancialFixture();for(const key of ['__proto__','constructor','prototype','toJSON','__pr\\u006fto__']){
  const body=base.body.replace('{',`{"${key}":{},`),q=clone(base.input);q.capture_slice_input.capture.expected_body_sha256=sha(body);
  assert.throws(()=>selectSecCaptureFinancialEvidence(q,body),failure('forbidden_field'));
 }
});
test('capture financial: bounded descriptor snapshots reject non-JSON inputs without invoking traps/accessors',async()=>{
 const{body,input:q}=await captureFinancialFixture();let invoked=0;
 const getter=clone(q);Object.defineProperty(getter,'selector',{enumerable:true,get(){invoked++;return q.selector;}});
 const proxy=new Proxy(q,{ownKeys(){invoked++;throw Error('trap');}}),revoked=Proxy.revocable({},{});revoked.revoke();
 const cycle:any=clone(q);cycle.self=cycle;
 const hidden=clone(q);Object.defineProperty(hidden,'hidden',{value:1,enumerable:false});
 const symbol=clone(q);Object.defineProperty(symbol,Symbol('hidden'),{value:1,enumerable:true});
 const sparse=clone(q);sparse.capture_slice_input.selection={kind:'source_indices',indices:new Array(2)};
 for(const bad of [getter,proxy,revoked.proxy,cycle,hidden,symbol,sparse,new Date(),{...q,unknown:undefined},{...q,unknown:()=>1},{...q,unknown:1n},Object.assign(Object.create({inherited:true}),q)])assert.throws(()=>selectSecCaptureFinancialEvidence(bad,body),failure('invalid_snapshot'));
 assert.equal(invoked,0);
});
test('capture financial: unsafe or lossy number inputs and Unicode reject before schemas',async()=>{
 const{body,input:q}=await captureFinancialFixture();for(const n of [NaN,Infinity,-0,1.1,Number.MAX_SAFE_INTEGER+1]){
  const bad=clone(q);bad.submissions_result.historical_file_count=n;assert.throws(()=>selectSecCaptureFinancialEvidence(bad,body),failure('invalid_snapshot'));
 }
 assert.throws(()=>selectSecCaptureFinancialEvidence({...q,unknown:'\ud800'},body),failure('invalid_snapshot'));
 assert.throws(()=>selectSecCaptureFinancialEvidence({...q,unknown:'x'.repeat(SEC_CAPTURE_FINANCIAL_LIMITS.input_bytes+1)},body),failure('input_too_large'));
});
test('capture financial: prototype fields, symbol array fields, sparse arrays and depth are rejected before conversion',async()=>{
 const{body,input:q}=await captureFinancialFixture();for(const key of ['__proto__','constructor','prototype','toJSON']){
  const bad=clone(q);Object.defineProperty(bad,key,{value:'forbidden',enumerable:true});assert.throws(()=>selectSecCaptureFinancialEvidence(bad,body),failure('forbidden_field'));
 }
 let deep:any={};for(let i=0;i<30;i++)deep={a:deep};assert.throws(()=>selectSecCaptureFinancialEvidence({...q,extra:deep},body),failure('input_too_large'));
 const array=clone(q);Object.defineProperty(array.capture_slice_result.facts,'extra',{value:1,enumerable:true});assert.throws(()=>selectSecCaptureFinancialEvidence(array,body),failure('invalid_snapshot'));
});
test('capture financial: no default max_filings insertion and no unknown-field stripping',async()=>{
 const{body,input:q}=await captureFinancialFixture(),bad=clone(q)as any;delete bad.submissions_result.request.max_filings;
 assert.throws(()=>selectSecCaptureFinancialEvidence(bad,body),failure('invalid_input'));assert.throws(()=>selectSecCaptureFinancialEvidence({...q,extra:1},body),failure('invalid_input'));
});
test('capture financial: every original numeric spelling survives without expansion or rounding',async()=>{
 const cases=[[102,'-0'],[103,'1.2300'],[104,'9007199254740993.2500'],[105,'1e+0300'],[106,'-9.9E-099'],[107,'1e999']]as const;
 for(const[index,lexeme]of cases){const initial=await captureFinancialFixture(),{body,input}=await captureFinancialFixture(initial.body,[index]);
  const r=selectSecCaptureFinancialEvidence(input,body);assert.equal(r.selected.numeric_lexeme,lexeme);assert.equal(r.selected.row.numeric_lexeme,lexeme);
  assert.deepEqual(verifySecCaptureFinancialEvidenceCandidate(clone(r),input,body),r);
 }
});
test('capture financial: synthetic instant cash selector retains null start and never infers accounting basis',async()=>{
 const base=await captureFinancialFixture(),q=base.input;
 const body=base.body.replaceAll('"start":"2025-01-01",','').replace('"tag":"Revenues"','"tag":"CashAndCashEquivalentsAtCarryingValue"');
 q.capture_slice_input.request.concept='CashAndCashEquivalentsAtCarryingValue';
 q.capture_slice_input.capture.source_url='https://data.sec.gov/api/xbrl/companyconcept/CIK0000000001/us-gaap/CashAndCashEquivalentsAtCarryingValue.json';
 q.requested_role='reported.cash';q.selector.concept=q.capture_slice_input.request.concept;q.selector.start=null;q.selector.period_kind='instant';rebuild(q,body);
 const r=selectSecCaptureFinancialEvidence(q,body);assert.equal(r.selected.row.start,null);assert.equal(r.selected.row.period_kind,'instant');
 assert.equal(r.accounting_basis,null);assert.equal(r.metric_eligible,false);assert.equal(r.semantic_binding_verified,false);
});
test('capture financial: current financial fact bridge rejects new candidates before verifier or clock can run',async()=>{
 const{body,input}=await captureFinancialFixture(),r=selectSecCaptureFinancialEvidence(input,body);let calls=0;
 await assert.rejects(assembleFinancialFact(r,{}, {adapter_id:'synthetic',mode:'synthetic_test_only',async verify(){calls++;return{};}},()=>{calls++;return CAPTURE_FINANCIAL_RECEIPT;}));
 assert.equal(calls,0);
});
test('capture financial: malformed and oversized CIK rejects before inherited BigInt refinements, including persisted lineage',async()=>{
 const{body,input:q}=await captureFinancialFixture(),candidate=selectSecCaptureFinancialEvidence(q,body);
 const original=globalThis.BigInt;let unsafeCalls=0;
 const invalids=['bad','1.2','1'.repeat(1_000_000)];
 globalThis.BigInt=((value:unknown)=>{if(typeof value==='string'&&invalids.includes(value)){unsafeCalls++;throw Error('unsafe_bigint_work');}return original(value as string);})as BigIntConstructor;
 try{
  for(const invalid of invalids){
   const inputMutations:((v:any)=>void)[]=[v=>v.selector.cik=invalid,v=>v.submissions_result.request.cik=invalid,
    v=>v.capture_slice_input.request.cik=invalid,v=>v.capture_slice_result.request.cik=invalid];
   for(const mutate of inputMutations){const bad=clone(q);mutate(bad);assert.throws(()=>selectSecCaptureFinancialEvidence(bad,body),failure('invalid_input'));}
   const candidateMutations:((v:any)=>void)[]=[v=>v.selector.cik=invalid,v=>v.lineage.submissions.value.request.cik=invalid,
    v=>v.lineage.capture.independent_input.request.cik=invalid,v=>v.lineage.capture.value.request.cik=invalid,v=>v.issuer.cik=invalid];
   for(const mutate of candidateMutations){const bad=clone(candidate);mutate(bad);assert.throws(()=>verifySecCaptureFinancialEvidenceCandidate(bad,q,body),failure('invalid_input'));}
  }
 }finally{globalThis.BigInt=original;}
 assert.equal(unsafeCalls,0);
});
test('capture financial: oversized sparse-array property names reject before regex/Number conversion',async()=>{
 const{body,input:q}=await captureFinancialFixture(),candidate=selectSecCaptureFinancialEvidence(q,body);
 const original=globalThis.Number;let unsafeCalls=0;
 const keys=['1'.repeat(1_000_000),'1'.repeat(SEC_CAPTURE_FINANCIAL_LIMITS.input_bytes+1)];
 const guarded=(value:unknown)=>{if(typeof value==='string'&&keys.includes(value)){unsafeCalls++;throw Error('unsafe_number_work');}return original(value);};
 Object.setPrototypeOf(guarded,original);globalThis.Number=guarded as NumberConstructor;
 try{
  for(const key of keys){const array=new Array(1);Object.defineProperty(array,key,{value:0,enumerable:true});
   const badInput=clone(q);badInput.capture_slice_input.selection={kind:'source_indices',indices:array};
   assert.throws(()=>selectSecCaptureFinancialEvidence(badInput,body),failure('invalid_snapshot'));
   const badCandidate=clone(candidate)as any;badCandidate.lineage.capture.independent_input.selection={kind:'source_indices',indices:array};
   assert.throws(()=>verifySecCaptureFinancialEvidenceCandidate(badCandidate,q,body),failure('invalid_snapshot'));
  }
 }finally{globalThis.Number=original;}
 assert.equal(unsafeCalls,0);
});

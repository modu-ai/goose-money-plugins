import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { selectSecFinancialEvidence, selectDartFinancialEvidence, FinancialSelectionError, REPORTED_FINANCIAL_ROLES, FINANCIAL_SELECTION_MAX_BYTES, validateFinancialEvidenceCandidate } from '../src/financial-evidence-selection.js';
import { openDartResultSchema } from '../src/opendart.js';
import { openDartFilingsResultSchema } from '../src/opendart-filings.js';
import { secFixture, dartFixture, CUTOFF } from './financial-selection-fixtures.js';
const fails=(code?:string)=>(e:unknown)=>e instanceof FinancialSelectionError && (!code||e.code===code);
const json=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(json).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${json((v as Record<string,unknown>)[k])}`).join(',')}}`;
const hash=(v:unknown)=>createHash('sha256').update(json(v)).digest('hex');

test('SEC exact selection preserves lexeme, original period context, acceptance and snapshots without canonical promotion',async()=>{
 const q=await secFixture(), r=selectSecFinancialEvidence(q);
 assert.equal(r.selected.numeric_lexeme,'9007199254740993.2500');
 assert.deepEqual(r.selected.row,q.concept_result.facts[0]); assert.deepEqual(r.selected.filing,q.submissions_result.filings[0]);
 assert.equal(r.selected.acceptance_datetime,'2026-02-10T10:30:00.000000001-05:00');
 assert.equal(r.published_at,null);assert.equal(r.available_at,null);assert.equal(r.canonical_fact,null);assert.equal(r.semantic_binding_verified,false);
 assert.equal(r.role_association_status,'unverified_caller_request');assert.equal(r.coverage_complete,false);assert.equal(r.rights_status,'pending');
 assert.equal(r.snapshots.financial.sha256,hash(q.concept_result));assert.equal(r.snapshots.filings.sha256,hash(q.submissions_result));
 assert.equal(r.snapshots.financial.original_http_body_hash,null);assert.equal(r.snapshots.financial.hash_scope,'validated_provider_dto_snapshot');
 assert.equal(r.snapshots.financial.value.warnings.length,q.concept_result.warnings.length);
 assert.equal(r.coverage.historical_file_count,1);assert.equal(r.coverage.filings_completeness,'recent_subset_historical_files_not_fetched');
 assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.selected.row));assert.ok(Object.isFrozen(r.snapshots.financial.value.facts));
 q.concept_result.facts[0]!.numeric_lexeme='2';assert.equal(r.selected.numeric_lexeme,'9007199254740993.2500');
 assert.throws(()=>{(r.selected.row as {numeric_lexeme:string}).numeric_lexeme='3';},TypeError);
});
test('DART exact account/statement/detail/current amount and filing preserve raw and normalized evidence separately',()=>{
 const q=dartFixture(),r=selectDartFinancialEvidence(q);
 assert.deepEqual(r.selected.row,q.statement_result.rows[0]);assert.deepEqual(r.selected.filing,q.filings_result.rows[0]);
 assert.deepEqual(r.selected.amount,{state:'value',raw:'+9,007,199,254,740,993.2500',decimal:'+9007199254740993.2500'});
 assert.equal(r.selected.period_start,null);assert.equal(r.selected.period_end,null);assert.equal(r.selected.amount_field,'thstrm_amount');
 assert.equal(r.selected.current_period_kind_applies_to,'current_amount_only_not_cumulative');assert.equal(r.selected.provider_current_period_kind,'three_months');
 assert.equal(r.coverage.has_more,true);assert.equal(r.coverage.next_page_no,2);assert.equal(r.coverage.complete,false);
 assert.equal(r.snapshots.financial.sha256,hash(q.statement_result));assert.equal(r.snapshots.filings.sha256,hash(q.filings_result));
 assert.ok(Object.isFrozen(r.selected.row.raw));assert.ok(Object.isFrozen(r.selected.amount));
});
test('DART all six amount roles preserve blanks, missing, zero, signed values and labels without conversion or sum',()=>{
 const cases=[['current','Synthetic current label','value','thstrm_amount'],['current_cumulative','Synthetic current label','value','thstrm_add_amount'],['prior',null,'blank','frmtrm_amount'],['prior_comparable','Synthetic comparable label','value','frmtrm_q_amount'],['prior_cumulative',null,'value','frmtrm_add_amount'],['two_years_prior',null,'missing','bfefrmtrm_amount']] as const;
 for(const [kind,label,state,field] of cases){const q=dartFixture();q.selector.amount_kind=kind;q.selector.period_label=label;const r=selectDartFinancialEvidence(q);assert.equal(r.selected.amount.state,state);assert.equal(r.selected.amount_field,field);assert.equal(r.canonical_fact,null);}
 const q=dartFixture();q.selector.amount_kind='prior';q.selector.period_label=null;assert.deepEqual(selectDartFinancialEvidence(q).selected.amount,{state:'blank',raw:'  '});
 q.selector.amount_kind='two_years_prior';assert.deepEqual(selectDartFinancialEvidence(q).selected.amount,{state:'missing'});
});
test('all existing R01 reported roles remain unverified associations, never guessed semantic bindings',async()=>{
 for(const requested_role of REPORTED_FINANCIAL_ROLES){const q=await secFixture();q.requested_role=requested_role;const r=selectSecFinancialEvidence(q);assert.equal(r.requested_role,requested_role);assert.equal(r.semantic_binding_verified,false);assert.equal(r.canonical_fact,null);}
 assert.throws(()=>selectDartFinancialEvidence({...dartFixture(),requested_role:'reported.net_income'}),fails('invalid_input'));
});
for(const [key,value] of [['unit_raw','shares'],['start','2025-01-02'],['end','2025-12-30'],['accession_number','0000000001-26-000002'],['filed','2026-02-11'],['fiscal_year',2024],['fiscal_period','Q4'],['form','10-K/A'],['frame',null]] as const){
 test(`SEC selector never falls back when exact ${key} mismatches`,async()=>{const q=await secFixture();Object.assign(q.selector,{[key]:value});assert.throws(()=>selectSecFinancialEvidence(q),fails('selection_absent'));});
}
for(const [key,value] of [['account_id','ifrs-full_ProfitLoss'],['account_nm','Other'],['sj_div','CIS'],['account_detail',null],['ord','2'],['currency',null],['period_label',null],['rcept_no','20250814000002']] as const){
 test(`DART selector never falls back when exact ${key} mismatches`,()=>{const q=dartFixture();Object.assign(q.selector,{[key]:value});assert.throws(()=>selectDartFinancialEvidence(q),fails('selection_absent'));});
}
test('SEC duplicates are ambiguous even if numerically identical; absence is not zero',async()=>{
 const q=await secFixture();q.concept_result.facts.push(structuredClone(q.concept_result.facts[0]!));q.concept_result.total_fact_count=2;
 assert.throws(()=>selectSecFinancialEvidence(q),fails('selection_ambiguous'));
 q.concept_result.facts=[];q.concept_result.total_fact_count=0;assert.throws(()=>selectSecFinancialEvidence(q),fails('selection_absent'));
});
test('DART duplicate rows and receipts reject rather than pick first or deduplicate',()=>{
 const q=dartFixture();q.statement_result.rows.push(structuredClone(q.statement_result.rows[0]!));assert.throws(()=>selectDartFinancialEvidence(q),fails('selection_ambiguous'));
 const f=dartFixture();f.filings_result.request.page_count=2;f.filings_result.total_page=1;f.filings_result.has_more=false;f.filings_result.next_page_no=null;f.filings_result.rows.push(structuredClone(f.filings_result.rows[0]!));assert.throws(()=>selectDartFinancialEvidence(f),fails('filing_ambiguous'));
});
test('absent SEC and DART filings fail closed',async()=>{
 const s=await secFixture();s.submissions_result.filings=[];s.submissions_result.recent_filing_count=0;assert.throws(()=>selectSecFinancialEvidence(s),fails('filing_absent'));
 const d=dartFixture();d.filings_result.rows=[];assert.throws(()=>selectDartFinancialEvidence(d),fails('filing_absent'));
});
for(const field of ['concept_result','submissions_result'] as const){test(`SEC ${field} receipt 1ns after cutoff rejects`,async()=>{const q=await secFixture();q[field].received_at='2026-10-22T00:00:00.123456790Z';assert.throws(()=>selectSecFinancialEvidence(q),fails('future_receipt'));});}
for(const field of ['statement_result','filings_result'] as const){test(`DART ${field} receipt 1ns after cutoff rejects`,()=>{const q=dartFixture();q[field].provenance.received_at='2026-10-22T00:00:00.123456790Z';assert.throws(()=>selectDartFinancialEvidence(q),fails('future_receipt'));});}
test('exact offset-equivalent cutoffs succeed and 1ns earlier cutoffs fail',async()=>{
 const s=await secFixture();s.cutoff='2026-10-21T19:00:00.123456789-05:00';assert.equal(selectSecFinancialEvidence(s).constituent_receipt_latest,CUTOFF);
 s.cutoff='2026-10-22T00:00:00.123456788Z';assert.throws(()=>selectSecFinancialEvidence(s),fails('future_receipt'));
 const d=dartFixture();d.cutoff='2026-10-22T09:00:00.123456789+09:00';selectDartFinancialEvidence(d);
});
test('calendar timezone is required, projected exactly, and remains unverified',async()=>{
 const s=await secFixture();assert.throws(()=>selectSecFinancialEvidence({...s,calendar_guard:undefined}),fails());
 for(const timezone of ['Invalid/Zone','', 'UTC+9'])assert.throws(()=>selectSecFinancialEvidence({...s,calendar_guard:{timezone,cutoff_local_date:'2026-10-22'}}),fails());
 s.calendar_guard={timezone:'America/New_York',cutoff_local_date:'2026-10-21'};assert.equal(selectSecFinancialEvidence(s).calendar_guard.status,'caller_selected_timezone_not_source_verified');
 s.calendar_guard.cutoff_local_date='2026-10-22';assert.throws(()=>selectSecFinancialEvidence(s),fails('invalid_calendar_guard'));
});
test('cross-origin and cross-issuer SEC joins reject, including matching accession',async()=>{
 const q=await secFixture();q.submissions_result.origin='actual';assert.throws(()=>selectSecFinancialEvidence(q),fails('origin_mismatch'));
 q.submissions_result.origin='synthetic';q.submissions_result.request.cik='0000000002';q.submissions_result.source_url='https://data.sec.gov/submissions/CIK0000000002.json';assert.throws(()=>selectSecFinancialEvidence(q),fails('issuer_mismatch'));
});
test('cross-origin and cross-issuer DART joins reject, including matching receipt',()=>{
 const q=dartFixture();q.filings_result.provenance.origin='actual';assert.throws(()=>selectDartFinancialEvidence(q),fails('origin_mismatch'));
 q.filings_result.provenance.origin='synthetic';q.filings_result.request.corp_code='00000002';q.filings_result.rows[0]!.raw.corp_code='00000002';assert.throws(()=>selectDartFinancialEvidence(q),fails('issuer_mismatch'));
});
test('SEC source fixed URLs and source DTO context/count guards rerun',async()=>{
 for(const mutate of [(q:Awaited<ReturnType<typeof secFixture>>)=>{q.concept_result.source_url='https://evil.invalid/a';},(q:Awaited<ReturnType<typeof secFixture>>)=>{q.concept_result.total_fact_count=3;},(q:Awaited<ReturnType<typeof secFixture>>)=>{q.submissions_result.omitted_recent_count=2;},(q:Awaited<ReturnType<typeof secFixture>>)=>{q.concept_result.facts[0]!.end='2025-02-30';}]){const q=await secFixture();mutate(q);assert.throws(()=>selectSecFinancialEvidence(q),fails('invalid_input'));}
});
test('SEC all required filing metadata must match, including form/date/expected report date/acceptance/document',async()=>{
 for(const change of [{form:'10-Q'},{filing_date:'2026-02-11'},{report_date:null},{acceptance_datetime:null},{primary_document:'other.htm'}]){const q=await secFixture();Object.assign(q.submissions_result.filings[0]!,change);assert.throws(()=>selectSecFinancialEvidence(q),fails('filing_metadata_mismatch'));}
});
test('DART all required filing metadata must match',()=>{
 for(const change of [{rcept_dt:'20250815'},{report_nm:'Other'},{corp_cls:'Y'},{stock_code:'000002'}]){const q=dartFixture();Object.assign(q.filings_result.rows[0]!.raw,change);assert.throws(()=>selectDartFinancialEvidence(q),fails('filing_metadata_mismatch'));}
});
test('DART weak-schema normalized decimal tampering is detected by reparsing raw rows',()=>{
 const q=dartFixture(),amount=q.statement_result.rows[0]!.amounts.current;if(amount.state==='value')amount.decimal='1';
 assert.equal(openDartResultSchema.safeParse(q.statement_result).success,true);
 assert.throws(()=>selectDartFinancialEvidence(q),fails('source_normalization_conflict'));
});
test('DART tampered raw numeric normalization, normalized blanks/missing and current-vs-cumulative cannot pass',()=>{
 const changes=[(q:ReturnType<typeof dartFixture>)=>{q.statement_result.rows[0]!.current_period_kind='unspecified';},(q:ReturnType<typeof dartFixture>)=>{q.statement_result.rows[0]!.fs_div='OFS';},(q:ReturnType<typeof dartFixture>)=>{q.statement_result.rows[0]!.amounts.current=q.statement_result.rows[0]!.amounts.current_cumulative;},(q:ReturnType<typeof dartFixture>)=>{q.statement_result.rows[0]!.amounts.prior={state:'missing'};},(q:ReturnType<typeof dartFixture>)=>{q.statement_result.rows[0]!.amounts.two_years_prior={state:'blank',raw:''};},(q:ReturnType<typeof dartFixture>)=>{q.statement_result.rows[0]!.raw.corp_code='00000002';}];
 for(const change of changes){const q=dartFixture();change(q);assert.throws(()=>selectDartFinancialEvidence(q),fails('source_normalization_conflict'));}
});
test('DART normalized filing URLs, page metadata, statuses and provider-request mismatches are revalidated',()=>{
 const changes=[(q:ReturnType<typeof dartFixture>)=>{q.statement_result.rows[0]!.filing_url='https://evil.invalid';},(q:ReturnType<typeof dartFixture>)=>{q.filings_result.rows[0]!.filing_url='https://evil.invalid';},(q:ReturnType<typeof dartFixture>)=>{q.filings_result.has_more=false;},(q:ReturnType<typeof dartFixture>)=>{q.filings_result.next_page_no=null;},(q:ReturnType<typeof dartFixture>)=>{q.filings_result.total_page=99;},(q:ReturnType<typeof dartFixture>)=>{q.filings_result.status='no_data';},(q:ReturnType<typeof dartFixture>)=>{q.filings_result.request.corp_cls='Y';}];
 for(const change of changes){const q=dartFixture();change(q);assert.equal(openDartFilingsResultSchema.safeParse(q.filings_result).success,true);assert.throws(()=>selectDartFinancialEvidence(q),fails('source_normalization_conflict'));}
});
test('DART malformed dates/numeric raw values and blank-vs-missing detail never coerced',()=>{
 const q=dartFixture();q.filings_result.rows[0]!.raw.rcept_dt='20250230';assert.throws(()=>selectDartFinancialEvidence(q),fails('invalid_input'));
 const d=dartFixture();d.statement_result.rows[0]!.raw.thstrm_amount='1e9';assert.throws(()=>selectDartFinancialEvidence(d),fails('invalid_input'));
});
test('SEC selected future/reversed dates and future acceptance are rejected, never publication availability',async()=>{
 const q=await secFixture();q.selector.filing.acceptance_datetime='2026-10-22T00:00:00.123456790Z';q.submissions_result.filings[0]!.acceptance_datetime=q.selector.filing.acceptance_datetime;assert.throws(()=>selectSecFinancialEvidence(q),fails('invalid_chronology'));
 const r=await secFixture();r.selector.filed='2024-02-10';r.selector.filing.filing_date='2024-02-10';r.concept_result.facts[0]!.filed='2024-02-10';r.submissions_result.filings[0]!.filing_date='2024-02-10';assert.throws(()=>selectSecFinancialEvidence(r),fails('invalid_chronology'));
 const t=await secFixture();t.selector.filed='2026-10-23';t.selector.filing.filing_date='2026-10-23';t.concept_result.facts[0]!.filed='2026-10-23';t.submissions_result.filings[0]!.filing_date='2026-10-23';assert.throws(()=>selectSecFinancialEvidence(t),fails('future_source_date'));
});
test('DART future filing dates are rejected without inventing financial period dates',()=>{
 const q=dartFixture();q.selector.filing.rcept_dt='20261023';q.filings_result.rows[0]!.raw.rcept_dt='20261023';assert.throws(()=>selectDartFinancialEvidence(q),fails('future_source_date'));
});
test('SEC truncation and DART later pages remain incomplete, not latest or exhaustive',async()=>{
 const q=await secFixture();q.concept_result.request.max_facts=1;q.concept_result.total_fact_count=2;q.concept_result.truncated=true;q.submissions_result.request.max_filings=1;q.submissions_result.recent_filing_count=2;q.submissions_result.omitted_recent_count=1;
 const r=selectSecFinancialEvidence(q);assert.equal(r.coverage.concept_truncated,true);assert.equal(r.coverage.filings_omitted_recent_count,1);assert.equal(r.coverage.complete,false);
 const d=dartFixture();d.filings_result.request.page_no=2;d.filings_result.has_more=false;d.filings_result.next_page_no=null;d.filings_result.request.last_reprt_at='Y';const dr=selectDartFinancialEvidence(d);assert.equal(dr.coverage.previous_pages_status,'not_supplied_or_verified');assert.equal(dr.coverage.complete,false);assert.equal(dr.coverage.last_reprt_at,'Y');
});
test('request selectors are strict and caller attempts to assert semantic verification are rejected',()=>{
 for(const change of [{semantic_binding_verified:true},{canonical_fact:{}},{rights_status:'approved'},{endpoint:'https://evil.invalid'},{requested_role:'metric.roe'}])assert.throws(()=>selectDartFinancialEvidence({...dartFixture(),...change}),fails('invalid_input'));
});
test('source getters, proxies, revoked proxies and toJSON callbacks never execute',()=>{
 let touched=0;const getter=Object.defineProperty({},'rows',{get(){touched++;throw new Error('secret');},enumerable:true});
 const p=new Proxy({}, {get(){touched++;throw new Error('secret');},ownKeys(){touched++;throw new Error('secret');},getPrototypeOf(){touched++;throw new Error('secret');}});
 const revoked=Proxy.revocable({},{});revoked.revoke();
 for(const body of [getter,p,revoked.proxy,{toJSON(){touched++;return {};}}])assert.throws(()=>selectDartFinancialEvidence({...dartFixture(),statement_result:body}),fails('invalid_source_snapshot'));
 assert.equal(touched,0);
});
test('hostile cycles, sparse arrays, symbols, custom prototypes, nonfinite and oversized snapshots fail bounded',()=>{
 const cycle:Record<string,unknown>={};cycle.self=cycle;const symbol={[Symbol('x')]:1};const sparse=Array(9999);const large=Array(10001).fill(null);
 for(const body of [cycle,symbol,sparse,new Date(),NaN,Infinity,1n,()=>{},Object.create({x:1})])assert.throws(()=>selectDartFinancialEvidence({...dartFixture(),statement_result:body}),fails('invalid_source_snapshot'));
 for(const body of [large,'x'.repeat(FINANCIAL_SELECTION_MAX_BYTES+1)])assert.throws(()=>selectDartFinancialEvidence({...dartFixture(),statement_result:body}),fails('snapshot_too_large'));
});
test('snapshot SHA changes with raw amount precision, warnings or receipt; object key insertion order does not matter',async()=>{
 const q=await secFixture(),a=selectSecFinancialEvidence(q);q.concept_result.facts[0]!.numeric_lexeme='9007199254740993.250';const b=selectSecFinancialEvidence(q);assert.notEqual(a.snapshots.financial.sha256,b.snapshots.financial.sha256);
 const ordered=Object.fromEntries(Object.entries(q).reverse());assert.equal(selectSecFinancialEvidence(ordered).snapshots.financial.sha256,b.snapshots.financial.sha256);
 q.concept_result.warnings.push('Additional caveat');assert.notEqual(selectSecFinancialEvidence(q).snapshots.financial.sha256,b.snapshots.financial.sha256);
});

test('serialized candidates revalidate the complete source join, selected row, cutoff, SHA and all fixed noncanonical gates',async()=>{
 for(const candidate of [selectSecFinancialEvidence(await secFixture()),selectDartFinancialEvidence(dartFixture())]) {
  assert.deepEqual(validateFinancialEvidenceCandidate(JSON.parse(JSON.stringify(candidate))),candidate);
  for(const mutate of [(r:any)=>r.semantic_binding_verified=true,(r:any)=>r.canonical_fact={value:'1'},(r:any)=>r.published_at=r.constituent_receipt_latest,(r:any)=>r.rights_status='approved',(r:any)=>r.snapshots.financial.sha256='a'.repeat(64),(r:any)=>r.coverage.complete=true,(r:any)=>r.warnings=[],(r:any)=>r.injected='extra',(r:any)=>r.snapshots.financial.original_http_body_hash='b'.repeat(64)]) {
   const altered=JSON.parse(JSON.stringify(candidate));mutate(altered);assert.throws(()=>validateFinancialEvidenceCandidate(altered),fails('candidate_mismatch'));
  }
 }
});
test('serialized candidate revalidation also rejects nested hostile input without invoking callbacks',()=>{
 let calls=0;const proxy=new Proxy({}, {get(){calls++;return {};}});assert.throws(()=>validateFinancialEvidenceCandidate(proxy),fails('invalid_source_snapshot'));assert.equal(calls,0);
});
test('no-data DART snapshots remain non-selectable rather than zero-valued evidence',()=>{
 const q=dartFixture();q.statement_result.provider_status='013';q.statement_result.status='no_data';q.statement_result.rows=[];
 assert.throws(()=>selectDartFinancialEvidence(q),fails('source_not_ok'));
});
test('SEC original scientific lexemes and explicit missing fiscal/frame metadata survive unchanged',async()=>{
 const q=await secFixture();q.concept_result.facts[0]!.numeric_lexeme='1.2300000000000000001e-3';q.concept_result.facts[0]!.fiscal_year=null;q.concept_result.facts[0]!.fiscal_period=null;q.concept_result.facts[0]!.frame=null;
 q.selector.fiscal_year=null;q.selector.fiscal_period=null;q.selector.frame=null;
 assert.equal(selectSecFinancialEvidence(q).selected.numeric_lexeme,'1.2300000000000000001e-3');
});
test('SEC instantaneous facts remain instantaneous, and historical comparative end can precede filing report date',async()=>{
 const q=await secFixture();q.concept_result.facts[0]!.start=null;q.concept_result.facts[0]!.period_kind='instant';q.selector.start=null;q.selector.period_kind='instant';
 assert.equal(selectSecFinancialEvidence(q).selected.row.start,null);
 q.concept_result.facts[0]!.end='2024-12-31';q.selector.end='2024-12-31';assert.equal(selectSecFinancialEvidence(q).selected.filing.report_date,'2025-12-31');
});
test('prototype toJSON is refused without execution and no secret input leaks through errors',()=>{
 let called=0;Object.defineProperty(Object.prototype,'toJSON',{value(){called++;throw new Error('secret-test');},configurable:true});
 try {assert.throws(()=>selectDartFinancialEvidence({secret:'secret-test'}),fails('invalid_source_snapshot'));}
 finally {delete (Object.prototype as {toJSON?:unknown}).toJSON;}
 assert.equal(called,0);
 try{selectDartFinancialEvidence({secret:'secret-test'});}catch(e){assert.ok(e instanceof FinancialSelectionError);assert.ok(!String(e).includes('secret-test'));}
});

test('SEC acceptance metadata cannot postdate either constituent receipt by even 1ns',async()=>{
 for(const field of ['concept_result','submissions_result'] as const) {
  const q=await secFixture();q[field].received_at='2026-02-10T15:30:00.000000000Z';
  assert.throws(()=>selectSecFinancialEvidence(q),fails('invalid_chronology'));
  q[field].received_at='2026-02-10T15:30:00.000000001Z';
  const r=selectSecFinancialEvidence(q);assert.equal(r.published_at,null);assert.equal(r.available_at,null);
  assert.equal(r.selected.acceptance_datetime,'2026-02-10T10:30:00.000000001-05:00');
 }
});

test('checked-in synthetic fixture inputs and candidate outputs replay identically through strict validation',()=>{
 for(const provider of ['sec','dart']) {
  const input=JSON.parse(readFileSync(new URL(`../../fixtures/${provider}-financial-selection.synthetic.input.json`,import.meta.url),'utf8'));
  const expected=JSON.parse(readFileSync(new URL(`../../fixtures/${provider}-financial-selection.synthetic.candidate.json`,import.meta.url),'utf8'));
  const actual=provider==='sec'?selectSecFinancialEvidence(input):selectDartFinancialEvidence(input);
  assert.deepEqual(actual,expected);assert.deepEqual(validateFinancialEvidenceCandidate(expected),expected);assert.equal(actual.origin,'synthetic');
 }
});

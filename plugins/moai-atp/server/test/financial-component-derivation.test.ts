import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinancialDerivationCandidate as create,validateFinancialDerivationCandidate as validate,FINANCIAL_COMPONENT_POLICIES as POLICIES,FinancialDerivationError} from '../src/financial-component-derivation.js';
import {assembleFinancialFact} from '../src/financial-fact-bridge.js';
import {bindingFixture,syntheticVerifier,VERIFIED} from './financial-bridge-fixtures.js';
import {selectDartFinancialEvidence} from '../src/financial-evidence-selection.js';
import {dartFixture} from './financial-selection-fixtures.js';
import {componentFixture} from './financial-component-fixtures.js';
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const code=(expected:string)=>(e:unknown)=>e instanceof FinancialDerivationError&&e.code===expected;
for(const id of Object.keys(POLICIES) as (keyof typeof POLICIES)[])test(`raw component policy ${id} remains non-metric-ready`,async()=>{
 const q=await componentFixture(id),r=create(q);assert.equal(r.raw_arithmetic.decimal,q.leaves.length===3?'123.000':'120.000');assert.equal(r.canonical_fact,null);assert.equal(r.metric_ready,false);assert.equal(r.rights_status,'pending');assert.equal(r.coverage_complete,false);assert.equal(r.component_disjointness_verified,false);assert.equal(r.unit_scale,null);assert.equal(r.available_at,null);assert.deepEqual(validate(JSON.parse(JSON.stringify(r))),r);assert.ok(Object.isFrozen(r.leaves[0]!.candidate));
});
for(const [values,result] of [
 [['9007199254740993.2500','0.7500'],'9007199254740994.0000'],[['1e-3','2E-3'],'0.003'],[['1e3','2.50e2'],'1250'],[['-0','0.00'],'0.00'],[['0','0'],'0'],[['1.200','2.3'],'3.500'],[['1e254','1e-254'],'1'+'0'.repeat(254)+'.'+'0'.repeat(253)+'1'],
] as [string[],string][])test(`exact raw addition ${values.join('+')}`,async()=>{const r=create(await componentFixture(undefined,values));assert.equal(r.raw_arithmetic.decimal,result);assert.equal(r.operation.rounding,'none');assert.deepEqual(r.leaves.map(x=>x.candidate.selected.numeric_lexeme),values);});
for(const value of ['-1','-0.001'])test(`negative component ${value} is not abs-converted`,async()=>{const q=await componentFixture(undefined,[value,'2']);assert.throws(()=>create(q),code('negative_component'));});
test('expansion bound fails closed rather than rounding',async()=>{const q=await componentFixture(undefined,['1e256','2']);assert.throws(()=>create(q),code('arithmetic_limit'));});
test('policy and nested component grants are immutable',()=>{assert.ok(Object.isFrozen(POLICIES));assert.ok(Object.isFrozen(POLICIES['us-gaap.ppe-plus-intangibles.v1'].components));assert.throws(()=>{(POLICIES as any)['bad']=1;},TypeError);assert.throws(()=>{(POLICIES['us-gaap.ppe-plus-intangibles.v1'].components as any).ppe='Revenues';},TypeError);});
test('input order canonicalized to finite component order',async()=>{const q=await componentFixture();const a=create(q);q.leaves.reverse();assert.deepEqual(create(q),a);});
for(const mode of ['missing','duplicate','unknown','extra'] as const)test(`component set ${mode} rejected`,async()=>{const q:any=await componentFixture();if(mode==='missing')q.leaves.pop();if(mode==='duplicate')q.leaves[1].component_id=q.leaves[0].component_id;if(mode==='unknown')q.leaves[1].component_id='lease';if(mode==='extra')q.leaves.push({...q.leaves[0],component_id:'lease'});assert.throws(()=>create(q));});
test('unlisted policy and role substitutions denied',async()=>{const q:any=await componentFixture();q.request.policy_id='subtract-preferred-par';assert.throws(()=>create(q),code('invalid_input'));q.request.policy_id='us-gaap.ppe-plus-intangibles.v1';q.request.destination_role='reported.debt';assert.throws(()=>create(q),code('policy_mismatch'));});
test('direct bridge cannot accept a component candidate as reported scalar',async()=>{const q=await componentFixture(),r=create(q);await assert.rejects(()=>assembleFinancialFact(r,bindingFixture(q.leaves[0]!.candidate),syntheticVerifier,()=>VERIFIED));});
test('OpenDART unknown canonical scale cannot enter SEC raw arithmetic policy',async()=>{const q:any=await componentFixture();q.leaves[0].candidate=selectDartFinancialEvidence(dartFixture());assert.throws(()=>create(q),code('unsupported_provider'));});
for(const field of ['frame','fiscal_period','fiscal_year','start','end','unit_raw','origin','timezone','filings_receipt','cutoff'] as const)test(`different constituent ${field} rejected`,async()=>{
 const q=await componentFixture(undefined,undefined,(x,i)=>{if(i!==1)return;const row=x.concept_result.facts[0]!;
  if(field==='frame'){x.selector.frame=null;row.frame=null;}if(field==='fiscal_period'){x.selector.fiscal_period=null;row.fiscal_period=null;}if(field==='fiscal_year'){x.selector.fiscal_year=null;row.fiscal_year=null;}
  if(field==='start'){x.selector.start='2025-02-01';row.start='2025-02-01';}if(field==='end'){x.selector.end='2025-11-30';row.end='2025-11-30';}
  if(field==='unit_raw'){x.selector.unit_raw='EUR';row.unit_raw='EUR';}if(field==='origin'){x.concept_result.origin='actual';x.submissions_result.origin='actual';}
  if(field==='timezone'){x.calendar_guard.timezone='Etc/UTC';}if(field==='filings_receipt'){x.submissions_result.received_at='2026-10-22T00:00:00Z';}
  if(field==='cutoff')x.cutoff='2026-10-22T00:00:00.123456790Z';
 });assert.throws(()=>create(q),code(field==='unit_raw'?'source_unit_mismatch':'source_context_mismatch'));
});
test('source shares label cannot be monetary component',async()=>{const q=await componentFixture(undefined,undefined,x=>{x.selector.unit_raw='shares';x.concept_result.facts[0]!.unit_raw='shares';});assert.throws(()=>create(q),code('source_unit_mismatch'));});
test('offset-equivalent constituent cutoff allowed, finer-than-nanosecond mismatch denied',async()=>{const q:any=await componentFixture(undefined,undefined,x=>{x.cutoff='2026-10-22T09:00:00.123456789+09:00';});assert.equal(create(q).metric_ready,false);q.request.cutoff='2026-10-22T00:00:00.1234567890001Z';assert.throws(()=>create(q),code('source_context_mismatch'));});
test('latest receipt retained exactly, not asserted as public availability',async()=>{const q=await componentFixture(undefined,undefined,(x,i)=>{x.concept_result.received_at=i?'2026-10-22T00:00:00.123456789Z':'2026-10-22T00:00:00.123456788Z';});const r=create(q);assert.equal(r.source_context.constituent_receipt_latest,'2026-10-22T00:00:00.123456789Z');assert.equal(r.available_at,null);});
for(const field of ['arithmetic','unit','source_context','hash','rights','metric','canonical','unresolved','warning','leaf_hash','leaf_order','extra'] as const)test(`persisted ${field} tamper rejected`,async()=>{const r:any=clone(create(await componentFixture()));
 if(field==='arithmetic')r.raw_arithmetic.decimal='999';if(field==='unit')r.raw_arithmetic.source_unit_label='KRW';if(field==='source_context')r.source_context.cik='0000000002';if(field==='hash')r.input_sha256='0'.repeat(64);if(field==='rights')r.rights_status='verified';if(field==='metric')r.metric_ready=true;if(field==='canonical')r.canonical_fact={role:'reported.capex',value:'120'};if(field==='unresolved')r.unresolved=[];if(field==='warning')r.warnings=[];if(field==='leaf_hash')r.leaves[0].candidate_sha256='0'.repeat(64);if(field==='leaf_order')r.leaves.reverse();if(field==='extra')r.signed=true;
 assert.throws(()=>validate(r),(e:unknown)=>e instanceof FinancialDerivationError&&['candidate_mismatch','invalid_candidate'].includes(e.code));
});
test('leaf source modification cannot reuse old selected evidence digest',async()=>{const r:any=clone(create(await componentFixture()));r.leaves[0].candidate.selected.numeric_lexeme='1000';assert.throws(()=>validate(r));});
for(const mode of ['getter','proxy','revoked_proxy','toJSON','cycle','sparse','symbol','nonfinite','surrogate','bidi'] as const)test(`hostile plain JSON ${mode} rejected without executing hooks`,async()=>{let called=0;const q:any=await componentFixture();let value:any=q;
 if(mode==='getter')Object.defineProperty(q,'attack',{enumerable:true,get(){called++;return 1;}});
 if(mode==='proxy')value=new Proxy(q,{ownKeys(){called++;return[];}});
 if(mode==='revoked_proxy'){const r=Proxy.revocable(q,{});r.revoke();value=r.proxy;}
 if(mode==='toJSON')q.toJSON=()=>{called++;return{};};if(mode==='cycle')q.attack=q;if(mode==='sparse')q.leaves=new Array(2);if(mode==='symbol')q[Symbol('x')]=1;if(mode==='nonfinite')q.attack=Infinity;if(mode==='surrogate')q.attack='\ud800';if(mode==='bidi')q.attack='\u202e';
 assert.throws(()=>create(value),code('invalid_plain_json'));assert.equal(called,0);
});
for(const mode of ['huge_string','huge_array','deep'])test(`resource bound ${mode} enforced`,async()=>{const q:any=await componentFixture();q.attack=mode==='huge_string'?'x'.repeat(100001):mode==='huge_array'?Array(20001).fill(0):Array.from({length:30}).reduce(x=>({nested:x}),{});assert.throws(()=>create(q),code('input_too_large'));});
test('input remains detached and outputs deeply frozen',async()=>{const q:any=clone(await componentFixture());const r=create(q);q.leaves[0].candidate.selected.numeric_lexeme='999';assert.equal(r.leaves[0]!.candidate.selected.numeric_lexeme,'100.00');assert.throws(()=>{(r.raw_arithmetic as any).decimal='999';},TypeError);});
test('different issuer cannot be silently combined even with same accession labels',async()=>{const q=await componentFixture(undefined,undefined,(x,i)=>{if(!i)return;x.selector.cik='0000000002';x.concept_result.request.cik='0000000002';x.submissions_result.request.cik='0000000002';x.concept_result.source_url=x.concept_result.source_url.replace('CIK0000000001','CIK0000000002');x.submissions_result.source_url=x.submissions_result.source_url.replace('CIK0000000001','CIK0000000002');});assert.throws(()=>create(q),code('source_context_mismatch'));});
test('different filing cannot be silently combined',async()=>{const q=await componentFixture(undefined,undefined,(x,i)=>{if(!i)return;const a='0000000001-26-000002';x.selector.accession_number=a;x.concept_result.facts[0]!.accession_number=a;x.submissions_result.filings[0]!.accession_number=a;});assert.throws(()=>create(q),code('source_context_mismatch'));});
test('actual origin labels confer no authentication, rights, or metric readiness',async()=>{const q=await componentFixture(undefined,undefined,x=>{x.concept_result.origin='actual';x.submissions_result.origin='actual';});const r=create(q);assert.equal(r.origin,'actual');assert.equal(r.rights_status,'pending');assert.equal(r.semantic_binding_verified,false);assert.equal(r.metric_ready,false);assert.equal(r.canonical_fact,null);assert.ok(r.unresolved.includes('source_authenticity_and_original_bytes_linkage'));});
test('source component tag cannot replace a finite component by label similarity',async()=>{const q=await componentFixture();const other=await componentFixture('us-gaap.short-plus-long-debt.v1');q.leaves[0]!.candidate=other.leaves[0]!.candidate;assert.throws(()=>create(q),code('policy_mismatch'));});
test('canonical timezone spelling is not silently substituted within component join',async()=>{const q=await componentFixture(undefined,undefined,(x,i)=>{if(i)x.calendar_guard.timezone='utc';});assert.throws(()=>create(q),code('source_context_mismatch'));});
test('escaped byte expansion bound enforced before schema validation',async()=>{const q:any=await componentFixture();q.attack=Array(60).fill('\u0000'.repeat(90000));assert.throws(()=>create(q),code('input_too_large'));});
test('massive sparse array rejected before allocating its holes',async()=>{const q:any=await componentFixture();q.attack=new Array(2**32-1);assert.throws(()=>create(q),code('input_too_large'));});
test('array non-index lookalike key cannot bypass sparse-array guard',async()=>{const q:any=await componentFixture();const a=new Array(1);Object.defineProperty(a,'0\n',{value:1,enumerable:true});q.attack=a;assert.throws(()=>create(q),code('invalid_plain_json'));});
import {FinancialComponentDerivationEnvelopeSchema} from '../src/financial-component-derivation.js';
for(const id of Object.keys(POLICIES) as (keyof typeof POLICIES)[])test(`complete envelope structural profile accepts ${id} but does not replace reconstruction`,async()=>{const r:any=clone(create(await componentFixture(id)));assert.ok(FinancialComponentDerivationEnvelopeSchema.safeParse(r).success);r.raw_arithmetic.decimal='999';assert.ok(FinancialComponentDerivationEnvelopeSchema.safeParse(r).success);assert.throws(()=>validate(r),code('candidate_mismatch'));});
for(const key of ['\ud800','\u202e'])test(`unsafe Unicode property key rejected ${JSON.stringify(key)}`,async()=>{const q:any=await componentFixture();q[key]=1;assert.throws(()=>create(q),code('invalid_plain_json'));});
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {FinancialComponentDerivationInputSchema} from '../src/financial-component-derivation.js';
const readArtifact=(path:string)=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url),'utf8'));
for(const id of Object.keys(POLICIES) as (keyof typeof POLICIES)[])test(`persisted synthetic artifact pair reconstructs ${id}`,async()=>{
 const q=readArtifact(`fixtures/financial-components/${id}.input.json`),r=readArtifact(`fixtures/financial-components/${id}.candidate.json`);
 assert.deepEqual(q,await componentFixture(id));assert.deepEqual(validate(r),create(q));assert.equal(r.origin,'synthetic');
});
test('exported structural schema and finite policy registry match executable sources',()=>{
 assert.deepEqual(readArtifact('contracts/financial-components/input-v1.schema.json'),z.toJSONSchema(FinancialComponentDerivationInputSchema));
 assert.deepEqual(readArtifact('contracts/financial-components/candidate-envelope-v1.schema.json'),z.toJSONSchema(FinancialComponentDerivationEnvelopeSchema));
 assert.deepEqual(readArtifact('contracts/financial-components/policies-v1.json'),POLICIES);
});
test('every finite policy component has matching inherited primary taxonomy declarations',()=>{const evidence=readArtifact('fixtures/source-contracts/rc9-component-source-evidence.json');for(const p of Object.values(POLICIES))for(const concept of Object.values(p.components)){const e=evidence.entries.find((e:any)=>e.taxonomy===p.taxonomy&&e.concept===concept);assert.ok(e);assert.ok(e.verified_schema_declarations.length>0);for(const d of e.verified_schema_declarations){assert.equal(d.declared_period_type,p.period);assert.equal(d.declared_item_type,'xbrli:monetaryItemType');}}});

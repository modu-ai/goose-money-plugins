import assert from 'node:assert/strict';
import test from 'node:test';
import { sliceSecCompanyConceptCapture as slice, verifySecCompanyConceptCaptureSlice as verify, SecCaptureSliceError, SEC_CAPTURE_SLICE_ERROR_CODES, SecCaptureSliceResultSchema } from '../src/sec-capture-slices.js';
import { SecConceptResultSchema, requestSecCompanyConcept } from '../src/sec-public-data.js';
import { SecFinancialSelectionInputSchema, selectSecFinancialEvidence, validateFinancialEvidenceCandidate } from '../src/financial-evidence-selection.js';
import { secFixture } from './financial-selection-fixtures.js';
import { captureInput, syntheticCapture, syntheticFact, syntheticLexemes } from './sec-capture-slices-fixtures.js';
const body=syntheticCapture();
function reject(fn:()=>unknown,code?:string){assert.throws(fn,(e:unknown)=>e instanceof SecCaptureSliceError&&SEC_CAPTURE_SLICE_ERROR_CODES.includes(e.code)&&(!code||e.code===code)&&e.message===e.code);}
function withBody(b:string,code?:string){reject(()=>slice(captureInput(b,{kind:'provider_order_window',offset:0,count:100}),b),code);}
function clone<T>(v:T):T{return JSON.parse(JSON.stringify(v)) as T;}

test('capture-bound selection crosses first 100 without relabeling first-N, preserving source order and omissions',()=>{
 const q=captureInput(body),r=slice(q,body);assert.deepEqual(r.facts.map(f=>f.source_index),[100,110,124,125]);
 assert.deepEqual(r.source_units.map(u=>u.unit_raw),['ZZZ','USD','EUR']);assert.deepEqual(r.source_units.map(u=>u.first_source_index),[0,125,126]);
 assert.equal(r.facts[3]!.source_unit_index,1);assert.equal(r.facts[3]!.source_row_index,0);assert.equal(r.facts[3]!.unit_raw,'USD');
 assert.equal(r.total_fact_count,126);assert.equal(r.selected_fact_count,4);assert.equal(r.omitted_fact_count,122);
 assert.equal(r.omitted_before_count,100);assert.equal(r.omitted_between_count,22);assert.equal(r.omitted_after_count,0);
 assert.equal(r.capture.received_at,q.capture.received_at);assert.equal(r.capture.source_authentication,'not_established');assert.equal(r.rights,'pending');
 assert.deepEqual(verify(clone(r),q,body),r);assert.equal(JSON.stringify(r).includes('body_text'),false);assert.equal(JSON.stringify(r).includes('"units":'),false);
});
test('window clips only at end and correctly accounts before/between/after omissions',()=>{
 const r=slice(captureInput(body,{kind:'provider_order_window',offset:101,count:100}),body);assert.equal(r.facts.length,25);assert.equal(r.omitted_before_count,101);assert.equal(r.omitted_between_count,0);assert.equal(r.omitted_after_count,0);
 const s=slice(captureInput(body,{kind:'provider_order_window',offset:10,count:5}),body);assert.deepEqual([s.omitted_before_count,s.omitted_between_count,s.omitted_after_count],[10,0,111]);
});
test('empty and exactly exhausted windows are explicit, further offsets fail',()=>{
 for(const [b,offset]of [[body,126],[syntheticCapture(0).replace(`"USD":[${syntheticFact(500)}]`,'"USD":[]'),0]] as const){const r=slice(captureInput(b,{kind:'provider_order_window',offset,count:1}),b);assert.equal(r.facts.length,0);assert.equal(r.selected_source_index_min,null);assert.equal(r.selected_source_index_max,null);assert.equal(r.omitted_fact_count,r.omitted_before_count+r.omitted_between_count+r.omitted_after_count);verify(r,captureInput(b,{kind:'provider_order_window',offset,count:1}),b);}
 reject(()=>slice(captureInput(body,{kind:'provider_order_window',offset:127,count:1}),body),'selection_out_of_bounds');
 reject(()=>slice(captureInput(body,{kind:'source_indices',indices:[126]}),body),'selection_out_of_bounds');
});
test('all numeric spellings including unbounded exponent remain exact, without Number rounding',()=>{const r=slice(captureInput(body,{kind:'provider_order_window',offset:0,count:6}),body);assert.deepEqual(r.facts.map(f=>f.numeric_lexeme),syntheticLexemes);});
test('fiscal nulls and missing metadata remain null, with no accounting or semantic inference',()=>{const r=slice(captureInput(body),body);for(const f of r.facts){assert.equal(f.fiscal_year,null);assert.equal(f.fiscal_period,null);assert.equal(f.frame,null);assert.equal(f.start,null);assert.equal(f.period_kind,'instant');assert.equal(f.canonical_metric,null);assert.equal(f.accounting_basis,null);}});
test('duration preserves start and valid provider labels',()=>{const b=body.replace('"end":"2025-12-31"','"start":"2025-01-01","end":"2025-12-31","frame":"CY2025"');const r=slice(captureInput(b,{kind:'source_indices',indices:[0]}),b);assert.equal(r.facts[0]!.period_kind,'duration');assert.equal(r.facts[0]!.frame,'CY2025');});
test('changed capture, whitespace and reserialized numbers cannot reuse expected digest',()=>{
 const q=captureInput(body);for(const b of [body+' ',body.replace('1.2300','1.23'),JSON.stringify(JSON.parse(body))])reject(()=>slice(q,b),'capture_hash_mismatch');
 reject(()=>slice(q,JSON.parse(body)),'invalid_body_text');reject(()=>slice(q,Buffer.from(body)),'invalid_body_text');
});
test('a reserialization with caller-rebound hash is a different asserted capture, not an authenticated original',()=>{
 const b=syntheticCapture(2),roundtrip=JSON.stringify(JSON.parse(b)),r=slice(captureInput(roundtrip,{kind:'source_indices',indices:[1]}),roundtrip);
 assert.equal(r.facts[0]!.numeric_lexeme,'1.23');assert.equal(r.capture.source_authentication,'not_established');
 reject(()=>verify(r,captureInput(b,{kind:'source_indices',indices:[1]}),b),'slice_mismatch');
});
for(const [name,mutator]of [
 ['top-level',(b:string)=>b.replace('"cik":1','"cik":1,"cik":1')],
 ['escaped',(b:string)=>b.replace('"cik":1','"cik":1,"\\u0063ik":1')],
 ['nested',(b:string)=>b.replace('"fy":null','"fy":null,"fy":2025')],
 ['unit',(b:string)=>b.replace('"ZZZ":[','"ZZZ":[],"ZZZ":[')],
 ['ignored field',(b:string)=>b.replace('"cik":1','"other":{"a":1,"\\u0061":2},"cik":1')],
] as const)test(`duplicate decoded JSON keys fail: ${name}`,()=>withBody(mutator(body),'duplicate_json_key'));
for(const b of [body+'x',body.replace('"cik":1','"cik":01'),body.replace('"cik":1','"cik":+1'),body.replace('"cik":1','"cik":1.'),body.replace('"cik":1','"cik":1e'),body.replace('"cik":1','"cik":NaN'),body.replace('"cik":1','"cik":Infinity'),body.replace('"cik":1','"cik":undefined'),body.slice(0,-1),body.replace('"cik":1','"cik":1,'),body.replace('"ZZZ"','"bad\\x"')])test('invalid original JSON grammar is a finite rejection',()=>withBody(b));
test('numeric-looking unit names are rejected, never implicitly reordered into accepted ordinals',()=>withBody(body.replace('"ZZZ"','"2"'),'invalid_source_metadata'));
test('nonalphabetic unit labels and unknown unit aliases are not silently normalized',()=>withBody(body.replace('"ZZZ"','"$USD"'),'invalid_source_metadata'));
test('unit order is original capture order, never alphabetic',()=>{const b=body.replace('"ZZZ"','"usd"');const r=slice(captureInput(b),b);assert.deepEqual(r.source_units.map(u=>u.unit_raw),['usd','USD','EUR']);});
test('all metadata is checked, including unselected rows',()=>{withBody(body.replace('"fy":null','"fy":"2025"'),'invalid_source_metadata');withBody(body.replace('"fp":null','"fp":false'),'invalid_source_metadata');withBody(body.replace('"val":-0','"val":null'),'invalid_source_metadata');withBody(body.replace('"val":-0','"val":"-0"'),'invalid_source_metadata');withBody(body.replace('"end":"2025-12-31"','"end":"2025-02-30"'),'invalid_source_metadata');withBody(body.replace('"form":"10-K"','"form":null'),'invalid_source_metadata');withBody(body.replace('"fy":null','"frame":null,"fy":null'),'invalid_source_metadata');});
test('identity, taxonomy, concept, URL and exact existing allowlist semantics are guarded',()=>{
 for(const [from,to]of [['"cik":1','"cik":2'],['"tag":"Assets"','"tag":"Liabilities"'],['"taxonomy":"us-gaap"','"taxonomy":"ifrs-full"']])withBody(body.replace(from!,to!),'source_context_mismatch');
 for(const patch of [{cik:'1'},{concept:'assets'},{taxonomy:'US-GAAP'},{concept:'UnknownMetric'}]){const q=captureInput(body);Object.assign(q.request,patch);reject(()=>slice(q,body),'invalid_input');}
 const q=captureInput(body);q.capture.source_url+='?x=1';reject(()=>slice(q,body),'source_context_mismatch');
});
test('strict input, finite selections, no defaults or automatic latest selection',()=>{
 for(const selection of [{kind:'latest'},{kind:'source_indices',indices:[]},{kind:'source_indices',indices:[1,1]},{kind:'source_indices',indices:[2,1]},{kind:'source_indices',indices:[-1]},{kind:'source_indices',indices:[1.1]},{kind:'source_indices',indices:Array.from({length:101},(_,i)=>i)},{kind:'provider_order_window',offset:0,count:0},{kind:'provider_order_window',offset:0,count:101},{kind:'provider_order_window',offset:-1,count:1}])reject(()=>slice({...captureInput(body),selection},body),'invalid_input');
 reject(()=>slice({...captureInput(body),source_authenticated:true},body),'invalid_input');
 const q=captureInput(body);Object.assign(q.capture,{authenticated:true});reject(()=>slice(q,body),'invalid_input');
});
test('receipt exact fractions and timezone-equivalent cutoff are compared without milliseconds loss',()=>{
 const q=captureInput(body);q.cutoff='2026-10-21T20:00:00.123456789-04:00';assert.equal(slice(q,body).cutoff,q.cutoff);
 q.cutoff='2026-10-22T00:00:00.123456788Z';reject(()=>slice(q,body),'future_receipt');
});
for(const bad of ['2026-02-30T00:00:00Z','2026-10-22T24:00:00Z','2026-10-22T00:00:00-00:00','2026-10-22T00:00:00+24:00','2026-10-22T00:00:00','2026-10-22T00:00:60Z'])test(`impossible or unknown-offset cutoff rejected: ${bad}`,()=>{const q=captureInput(body);q.cutoff=bad;reject(()=>slice(q,body),'invalid_input');});
test('calendar projections and date-only chronology remain explicit',()=>{
 const q=captureInput(body);q.calendar_guard.timezone='America/New_York';reject(()=>slice(q,body),'invalid_calendar_guard');q.calendar_guard.cutoff_local_date='2026-10-21';slice(q,body);
 q.calendar_guard.timezone='Invalid/Timezone';reject(()=>slice(q,body),'invalid_calendar_guard');
 const b=body.replace('"filed":"2026-02-10"','"filed":"2027-02-10"');withBody(b,'future_source_date');
 const past=body.replace('"filed":"2026-02-10"','"filed":"2025-02-10"');withBody(past,'invalid_chronology');
 const later=body.replace('"filed":"2026-02-10"','"filed":"2026-10-23"');const x=captureInput(later,{kind:'source_indices',indices:[0]});x.cutoff='2026-10-24T00:00:00Z';x.calendar_guard.cutoff_local_date='2026-10-24';reject(()=>slice(x,later),'invalid_chronology');
});
test('oversized body, excessive tree depth/nodes/keys/rows are bounded before normalization',()=>{
 reject(()=>slice(captureInput(' '.repeat(3_000_001)), ' '.repeat(3_000_001)),'body_too_large');
 withBody('{"extra":'+ '['.repeat(30)+'0'+']'.repeat(30)+',"rest":null}','body_complexity_limit');
 withBody('{'+Array.from({length:10_002},(_,i)=>`"k${i}":0`).join(',')+'}','body_complexity_limit');
 withBody('['+Array.from({length:10_000},()=> '['+'0,'.repeat(24)+'0]').join(',')+']','body_complexity_limit');
 withBody(syntheticCapture(10_001),'invalid_source_metadata');
});
test('unpaired source and decoded-string surrogates reject but Unicode scalar pairs remain valid',()=>{
 withBody(body.replace('SYNTHETIC ONLY CAPTURE','\ud800'),'invalid_body_text');withBody(body.replace('SYNTHETIC ONLY CAPTURE','\\ud800'),'invalid_json');
 const b=body.replace('SYNTHETIC ONLY CAPTURE','SYNTHETIC 🪿');assert.equal(slice(captureInput(b),b).entity_name,'SYNTHETIC 🪿');
});
test('input accessors, proxies, toJSON, nonplain objects, sparse arrays and cycles reject without executing code',()=>{
 let calls=0;const getter=Object.defineProperty({},'request',{get(){calls++;throw Error('secret');},enumerable:true});reject(()=>slice(getter,body),'invalid_snapshot');
 const proxy=new Proxy({}, {get(){calls++;throw Error('secret');},ownKeys(){calls++;throw Error('secret');}});reject(()=>slice(proxy,body),'invalid_snapshot');
 const revoked=Proxy.revocable({},{});revoked.revoke();reject(()=>slice(revoked.proxy,body),'invalid_snapshot');
 for(const obj of [new Date(),{toJSON(){calls++;return captureInput(body);}},Object.create({x:1}),{a:BigInt(1)},{a:Infinity},{[Symbol('x')]:1}])reject(()=>slice(obj,body),'invalid_snapshot');
 const cycle:Record<string,unknown>={};cycle.a=cycle;reject(()=>slice(cycle,body),'invalid_snapshot');
 const q=captureInput(body);q.selection={kind:'source_indices',indices:Array(2)};reject(()=>slice(q,body),'invalid_snapshot');assert.equal(calls,0);
});
test('input limits are separate from body limits',()=>{reject(()=>slice({...captureInput(body),extra:'x'.repeat(100_001)},body),'input_too_large');let deep:unknown={};for(let i=0;i<30;i++)deep={x:deep};reject(()=>slice(deep,body),'input_too_large');});
test('returned result is deeply immutable and does not alias caller input',()=>{
 const q=captureInput(body),r=slice(q,body);assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.facts)&&Object.isFrozen(r.facts[0])&&Object.isFrozen(r.selection));
 q.capture.received_at='2026-10-21T00:00:00Z';assert.notEqual(r.capture.received_at,q.capture.received_at);assert.throws(()=>{(r.facts[0] as unknown as {numeric_lexeme:string}).numeric_lexeme='0';},TypeError);
});
test('persisted tampering is detected by full reconstruction, not a serialized success flag',()=>{
 const q=captureInput(body),r=slice(q,body);const cases=[(x:any)=>x.facts[0].numeric_lexeme='5',(x:any)=>x.facts[0].source_index++, (x:any)=>x.facts[0].source_unit_index++, (x:any)=>x.facts[0].source_row_index++, (x:any)=>x.facts[0].unit_raw='USD',(x:any)=>x.facts.reverse(),(x:any)=>x.source_units.reverse(),(x:any)=>x.source_units[0].fact_count--,(x:any)=>x.omitted_fact_count--,(x:any)=>x.omitted_before_count--,(x:any)=>x.omitted_between_count--,(x:any)=>x.omitted_after_count++,(x:any)=>x.total_fact_count++,(x:any)=>x.capture.origin='actual',(x:any)=>x.capture.received_at='2026-10-21T00:00:00Z',(x:any)=>x.capture.body_byte_length++,(x:any)=>x.capture.body_sha256='0'.repeat(64),(x:any)=>x.selected_source_index_min++,(x:any)=>x.label='fake',(x:any)=>x.selection.indices=[100,111,124,125],(x:any)=>x.cutoff='2026-10-23T00:00:00Z'];
 for(const edit of cases){const p=clone(r);edit(p);reject(()=>verify(p,q,body),'slice_mismatch');}
 for(const edit of [(x:any)=>x.source_authenticated=true,(x:any)=>x.capture.source_authentication='authenticated',(x:any)=>x.facts[0].canonical_metric='assets']){const p=clone(r);edit(p);reject(()=>verify(p,q,body),'invalid_input');}
 const p=clone(r);Object.defineProperty(p,'facts',{get(){throw Error('secret');},enumerable:true});reject(()=>verify(p,q,body),'invalid_snapshot');
});
test('schema acceptance alone is not reconstruction verification',()=>{const p:any=clone(slice(captureInput(body),body));p.total_fact_count++;assert.ok(SecCaptureSliceResultSchema.safeParse(p).success);reject(()=>verify(p,captureInput(body),body),'slice_mismatch');});
test('new capture slice is rejected by legacy first-N and financial consumers',async()=>{
 const r=slice(captureInput(body),body);assert.equal(SecConceptResultSchema.safeParse(r).success,false);const old=await secFixture();const input={...old,concept_result:r};assert.equal(SecFinancialSelectionInputSchema.safeParse(input).success,false);assert.throws(()=>selectSecFinancialEvidence(input));assert.throws(()=>validateFinancialEvidenceCandidate(r));
});
test('legacy first-N semantics stay exact and synthetic capture adapter fields match without any promotion',async()=>{
 const q=captureInput(body,{kind:'provider_order_window',offset:0,count:100}),r=slice(q,body);
 const legacy=await requestSecCompanyConcept({...q.request,max_facts:100},{origin:'synthetic',async send(){return {status:200,body_text:body};}},()=>q.capture.received_at);
 assert.equal(legacy.contract,'moai.sec.company-concept.v1');assert.equal(legacy.selection,'provider_unit_and_row_order_first_n');assert.equal(legacy.facts.length,100);assert.equal(legacy.total_fact_count,126);
 assert.deepEqual(r.facts.map(({source_index,source_unit_index,source_row_index,...fact})=>fact),legacy.facts);
});

test('CIK and fiscal years require exact integral decimal metadata, not binary64 rounding or underflow',()=>{
 for(const v of ['1.0000000000000000000001','0.99999999999999999999999','1e-999','9007199254740993'])withBody(body.replace('"cik":1',`"cik":${v}`),'invalid_source_metadata');
 for(const v of ['2025.00000000000000000000001','2024.9999999999999999999999','2.025000000000000000001e3'])withBody(body.replace('"fy":null',`"fy":${v}`),'invalid_source_metadata');
 for(const v of ['1.0','1e0','100e-2']){const b=body.replace('"cik":1',`"cik":${v}`);slice(captureInput(b),b);}
 for(const v of ['2025.0','2.025e3','202500e-2']){const b=body.replace('"fy":null',`"fy":${v}`);const r=slice(captureInput(b,{kind:'source_indices',indices:[0]}),b);assert.equal(r.facts[0]!.fiscal_year,2025);}
});
test('original lexeme token cannot be forged with an object and oversize lexemes reject',()=>{
 withBody(body.replace('"val":-0','"val":{"lexeme":"-0"}'),'invalid_source_metadata');
 withBody(body.replace('"val":-0','"val":'+ '9'.repeat(201)),'invalid_source_metadata');
});
test('all declared capture timestamps and metadata must be explicit, not null or malformed',()=>{
 for(const patch of [{received_at:null},{received_at:'2026-02-30T00:00:00Z'},{received_at:'2026-10-22T00:00:00-00:00'},{expected_body_sha256:null},{origin:null},{source_url:null}]){const q=captureInput(body);Object.assign(q.capture,patch);reject(()=>slice(q,body),'invalid_input');}
 withBody(body.replace('"entityName":"SYNTHETIC ONLY CAPTURE"','"entityName":null'),'invalid_source_metadata');
 withBody(body.replace('"fy":null','"start":null,"fy":null'),'invalid_source_metadata');
});
test('source prototype-looking keys do not run code or pollute prototypes',()=>{
 const b=body.replace('"cik":1','"__proto__":{"polluted":true},"cik":1').replace('"ZZZ"','"constructor"');
 const r=slice(captureInput(b),b);assert.equal(r.source_units[0]!.unit_raw,'constructor');assert.equal(({} as Record<string,unknown>).polluted,undefined);
});
test('unselected cutoff-future source labels remain disclosed as omitted, not silently selected or eligibility-validated',()=>{
 const b=body.replace('"filed":"2026-02-10"','"filed":"2027-02-10"');const r=slice(captureInput(b,{kind:'source_indices',indices:[1]}),b);assert.equal(r.facts[0]!.source_index,1);assert.equal(r.omitted_before_count,1);assert.equal(r.total_fact_count,126);
});

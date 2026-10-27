import test from 'node:test';import assert from 'node:assert/strict';
import {SecConceptInputSchema,SecSubmissionsInputSchema,requestSecCompanyConcept,requestSecSubmissions,type SecPublicTransport} from '../src/sec-public-data.js';
const at='2026-10-22T00:00:00Z';const q={cik:'0000320193',taxonomy:'us-gaap',concept:'Assets',max_facts:100};
const fact={end:'2025-09-27',val:123,accn:'0000320193-26-000001',filed:'2026-01-28',form:'8-K',fy:2025,fp:'FY'};
const concept={cik:320193,entityName:'Synthetic',taxonomy:'us-gaap',tag:'Assets',label:'Assets',units:{USD:[fact]}};
const base=JSON.stringify(concept);
const submissions=JSON.stringify({cik:320193,name:'Synthetic',tickers:[],exchanges:[],filings:{recent:{accessionNumber:[],filingDate:[],reportDate:[],acceptanceDateTime:[],form:[],primaryDocument:[],primaryDocDescription:[]},files:[]}});
const transport=(body:string):SecPublicTransport=>({origin:'synthetic',async send(){return{status:200,body_text:body};}});
const read=(body:string)=>requestSecCompanyConcept(q,transport(body),()=>at);
const finite=(code:string)=>(e:unknown)=>e instanceof Error&&e.name==='Error'&&e.message===code;
for(const cik of ['BAD-CIK','1.2','0000000000','0000320193\n','0000320193\r\n','３２０１９３００００','9'.repeat(1_000_000)]){
 const name=cik.length>30?'overlong':JSON.stringify(cik);
 test(`CIK ${name} is finite invalid_input without numeric conversion or transport`,async()=>{
  const original=globalThis.BigInt;let converted=0,sent=0;
  globalThis.BigInt=((_:unknown)=>{converted++;throw new Error('conversion_must_not_run');}) as unknown as BigIntConstructor;
  try{
   assert.equal(SecConceptInputSchema.safeParse({...q,cik}).success,false);
   assert.equal(SecSubmissionsInputSchema.safeParse({cik}).success,false);
   const t:SecPublicTransport={origin:'synthetic',async send(){sent++;throw Error('must_not_send');}};
   await assert.rejects(requestSecCompanyConcept({...q,cik},t,()=>at),finite('invalid_input'));
   await assert.rejects(requestSecSubmissions({cik},t,()=>at),finite('invalid_input'));
   assert.equal(converted,0);assert.equal(sent,0);
  }finally{globalThis.BigInt=original;}
 });
}
test('CIK accepts exact nonzero ten ASCII digits without BigInt',()=>{for(const cik of ['0000000001','0000320193','9999999999'])assert.equal(SecConceptInputSchema.safeParse({...q,cik}).success,true);});
const duplicateCases:[string,string][]=[
 ['root CIK',base.replace('"cik":320193','"cik":999999,"cik":320193')],
 ['fractional first CIK',base.replace('"cik":320193','"cik":320193.000000000000000001,"cik":320193')],
 ['escaped CIK',base.replace('"cik":320193','"cik":320193,"c\\u0069k":320193')],
 ['numeric val',base.replace('"val":123','"val":999,"val":123')],
 ['escaped val',base.replace('"val":123','"val":999,"va\\u006c":123')],
 ['fiscal metadata',base.replace('"fy":2025','"fy":2024,"fy":2025')],
 ['unit object',base.replace('"units":{','"units":{},"units":{')],
 ['unknown object',base.slice(0,-1)+',"extra":{"x":1,"x":2}}'],
 ['unknown array object',base.slice(0,-1)+',"extra":[{"x":1,"x":2}]}'],
 ['escaped slash',base.slice(0,-1)+',"extra":{"a/b":1,"a\\/b":2}}'],
 ['surrogate-equivalent key',base.slice(0,-1)+',"extra":{"𝄞":1,"\\ud834\\udd1e":2}}'],
 ['same value duplicate',base.slice(0,-1)+',"extra":{"x":1,"x":1}}'],
];
for(const [name,body]of duplicateCases)test(`decoded duplicate rejects: ${name}`,async()=>{await assert.rejects(read(body),finite('provider_response_schema_drift'));});
test('duplicate submissions metadata rejects before identity is emitted',async()=>{await assert.rejects(requestSecSubmissions({cik:q.cik},transport(submissions.replace('"cik":320193','"cik":1,"cik":320193')),()=>at),finite('provider_response_schema_drift'));});
test('same keys in sibling rows and distinct Unicode spellings are not duplicate keys',async()=>{
 const body=JSON.stringify({...concept,units:{USD:[fact,{...fact,val:456}]},extra:[{x:1},{x:2}],unicode:{'é':1,'é':2}});
 const r=await read(body);assert.deepEqual(r.facts.map(f=>f.numeric_lexeme),['123','456']);
});
test('braces, commas, escaped quotes and slashes inside string values do not affect structural scan',async()=>{
 const entityName='Synthetic { [ , : " \\ / } ]';const r=await read(JSON.stringify({...concept,entityName}));assert.equal(r.entity_name,entityName);
});
test('exact integer exponent metadata and original numeric value spelling remain unchanged',async()=>{
 const body=base.replace('"cik":320193','"cik":3.2019300e5').replace('"fy":2025','"fy":202500e-2').replace('"val":123','"val":1.2300000000000000001e-3');
 const r=await read(body);assert.equal(r.facts[0]?.numeric_lexeme,'1.2300000000000000001e-3');assert.equal(r.facts[0]?.fiscal_year,2025);
});
for(const token of ['320193.0000000000000000001','3.20193000000000000000001e5'])test(`fractional CIK token remains rejected: ${token}`,async()=>{await assert.rejects(read(base.replace('"cik":320193',`"cik":${token}`)),finite('provider_response_schema_drift'));});
for(const bad of ['{"x":1,}', '[1,]', '{"x" 1}', '{"x":}', '{"x":"\\q"}', '{"x":"unterminated}', '{"x":NaN}', '{"x":01}', '{} {}'])test(`malformed JSON remains finite: ${bad}`,async()=>{await assert.rejects(read(bad),finite('provider_response_schema_drift'));});
test('depth budget permits 63 nested extra arrays and rejects 64 without native stack errors',async()=>{
 const wrap=(n:number)=>base.slice(0,-1)+',"extra":'+'['.repeat(n)+'0'+']'.repeat(n)+'}';
 assert.equal((await read(wrap(63))).facts.length,1);
 await assert.rejects(read(wrap(64)),finite('provider_response_schema_drift'));
 await assert.rejects(read(wrap(10000)),finite('provider_response_schema_drift'));
});
test('node budget bounds otherwise ignored arrays',async()=>{
 const body=(n:number)=>base.slice(0,-1)+',"extra":['+Array(n).fill('0').join(',')+']}';
 assert.equal((await read(body(249900))).facts.length,1);
 await assert.rejects(read(body(250000)),finite('provider_response_schema_drift'));
});
test('encoded/decoded key budgets reject before unbounded key decoding',async()=>{
 const withKey=(k:string)=>'{"'+k+'":0,'+base.slice(1);
 assert.equal((await read(withKey('a'.repeat(256)))).facts.length,1);
 assert.equal((await read(withKey('\\u0061'.repeat(256)))).facts.length,1);
 await assert.rejects(read(withKey('a'.repeat(257))),finite('provider_response_schema_drift'));
 const original=JSON.parse;let decodes=0;
 JSON.parse=((...args:Parameters<typeof JSON.parse>)=>{decodes++;return original(...args);}) as typeof JSON.parse;
 try{await assert.rejects(read(withKey('a'.repeat(100000))),finite('provider_response_schema_drift'));assert.equal(decodes,0);}finally{JSON.parse=original;}
});
test('cheap text length limit runs before UTF-8 byte scan',async()=>{
 const original=Buffer.byteLength;let scanned=0;
 Buffer.byteLength=((...args:Parameters<typeof Buffer.byteLength>)=>{scanned++;return original(...args);}) as typeof Buffer.byteLength;
 try{await assert.rejects(read('x'.repeat(3_000_001)),finite('response_too_large'));assert.equal(scanned,0);}finally{Buffer.byteLength=original;}
});
test('UTF-8 byte budget remains enforced for non-ASCII text',async()=>{await assert.rejects(read('가'.repeat(1_000_001)),finite('response_too_large'));});
test('duplicate rejection happens before original full-text reviver parsing',async()=>{
 const body=duplicateCases[0]![1];const original=JSON.parse;let fullParses=0;
 JSON.parse=((text:string,...args:unknown[])=>{if(text===body)fullParses++;return (original as (...a:unknown[])=>unknown)(text,...args);}) as typeof JSON.parse;
 try{await assert.rejects(read(body),finite('provider_response_schema_drift'));assert.equal(fullParses,0);}finally{JSON.parse=original;}
});

test('overlong CIK aborts before the regex check',()=>{
 const original=RegExp.prototype.test;let scanned=0;
 RegExp.prototype.test=function(value:string){if(typeof value==='string'&&value.length>1000){scanned++;throw Error('unbounded_regex');}return original.call(this,value);};
 try{assert.equal(SecConceptInputSchema.safeParse({...q,cik:'9'.repeat(1_000_000)}).success,false);assert.equal(scanned,0);}finally{RegExp.prototype.test=original;}
});

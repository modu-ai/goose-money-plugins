import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile,writeFile,mkdtemp,rm,symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildKrDailyRawEvidence as build,verifyKrDailyRawEvidence as verify,KrDailyEvidenceError,
  KR_DAILY_EVIDENCE_ERROR_CODES as codes,KR_DAILY_EVIDENCE_LIMITS as limits,KR_DAILY_RAW_FIELD_LENGTHS as fields,
  KrDailyEvidenceInputSchema,KrDailyEvidenceResultSchema } from '../src/kr-daily-raw-evidence.js';
import { parseKis039DailyChartResponse } from '../src/r01-kis-field-parsers.js';
import { buildHistoryResult } from '../src/history-contract.js';
// BUILD-PIN tests: they exercise the evidence tooling that is pinned to the build Node. Anywhere else they are skipped, never passed.
const buildPinSkip = process.version === 'v24.22.1' ? false : `requires the build pin Node 24.22.1 (running ${process.version})`;
const hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const body=()=>({rt_cd:'0',msg_cd:'PRIVATE_CODE',msg1:'PRIVATE_PROVIDER_MESSAGE',output1:{private_header:'PRIVATE_HEADER'},output2:[
  {stck_bsop_date:'20261021',stck_clpr:'000123.00',stck_oprc:'-0.00',stck_hgpr:'123.4',stck_lwpr:'001.00',acml_vol:'999999999999999999',acml_tr_pbmn:'000000000000000001',flng_cls_code:'00',prtt_rate:'0001.000',mod_yn:'N',revl_issu_reas:'01'},
  {stck_bsop_date:'20261019',stck_clpr:'',stck_oprc:'',stck_hgpr:'',stck_lwpr:'',acml_vol:'',acml_tr_pbmn:'',flng_cls_code:'',prtt_rate:'',mod_yn:'',revl_issu_reas:''},
  {stck_bsop_date:'20261020'},
] as Array<Record<string,unknown>>});
const text=JSON.stringify(body());
function input(s=text){return {request:{symbol:'000000',board:'J',start_date:'2026-10-19',end_date:'2026-10-21',interval:'1d',adjustment_code:'0'},
  capture:{origin:'synthetic',received_at:'2026-10-22T00:00:00.12345678901234567890Z',expected_body_sha256:hash(s)},cutoff:'2026-10-22T09:00:00.12345678901234567891+09:00'};}
function expectError(fn:()=>unknown,code?:string){assert.throws(fn,(e:unknown)=>e instanceof KrDailyEvidenceError&&codes.includes(e.code)&&e.message===e.code&&(!code||e.code===code));}
function changeBody(fn:(b:ReturnType<typeof body>)=>void){const b=body();fn(b);const s=JSON.stringify(b);return ()=>build(input(s),s);}
function reordered(v:unknown):unknown {if(v===null||typeof v!=='object')return v;if(Array.isArray(v))return v.map(reordered);return Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reordered(x)]));}

test('KIS daily evidence uses pinned Node and preserves all raw strings/states/order/indices',{skip:buildPinSkip},()=>{
  assert.equal(process.version,'v24.22.1');const r=build(input(),text);
  assert.equal(r.contract,'moai.kis.kr-daily-raw-evidence.v1');assert.equal(r.row_count,3);
  assert.deepEqual(r.rows.map(x=>x.provider_business_date),['2026-10-21','2026-10-19','2026-10-20']);assert.deepEqual(r.rows.map(x=>x.source_row_index),[0,1,2]);
  assert.equal(r.capture.body_sha256,hash(text));assert.equal(r.capture.body_byte_length,Buffer.byteLength(text));
  for(const k of Object.keys(fields) as Array<keyof typeof fields>){assert.deepEqual(r.rows[0]!.raw_fields[k],{state:'present',value:body().output2[0]![k]});
    if(k!=='stck_bsop_date'){assert.deepEqual(r.rows[1]!.raw_fields[k],{state:'blank',value:''});assert.deepEqual(r.rows[2]!.raw_fields[k],{state:'missing',value:null});}}
  assert.deepEqual(verify(JSON.parse(JSON.stringify(r)),input(),text),r);assert.deepEqual(verify(reordered(r),reordered(input()),text),r);
  assert.ok(KrDailyEvidenceInputSchema.safeParse(input()).success);assert.ok(KrDailyEvidenceResultSchema.safeParse(r).success);
});
test('result is recursively immutable, canonical values all null, metadata never authenticates or leaks',()=>{
  const r=build(input(),text);assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.rows)&&Object.isFrozen(r.rows[0]!.raw_fields.stck_clpr));
  assert.ok(r.rows.every(x=>Object.values(x.canonical).every(v=>v===null)));assert.equal(r.source_as_of,null);assert.equal(r.publication_at,null);
  assert.equal(r.capture.source_authentication,'not_established');assert.equal(r.identity_status,'request_context_only_not_response_verified');
  assert.equal(r.adjustment_code_interpretation,'blocked_portal_sample_conflict');assert.equal(r.canonical_projection_status,'blocked');
  const serial=JSON.stringify(r);for(const secret of ['PRIVATE_CODE','PRIVATE_PROVIDER_MESSAGE','PRIVATE_HEADER','msg1','output1','original_body_text']){
    if(secret==='output1')assert.ok(!Object.hasOwn(r,'output1'));else assert.ok(!serial.includes(secret));}
  const q=input();q.capture.origin='actual';assert.equal(build(q,text).capture.source_authentication,'not_established');
});
test('empty success retained only as evidence; v1 still rejects empty and sorts nonempty canonical-null rows',()=>{
  const s=JSON.stringify({rt_cd:'0',output1:{},output2:[]}),r=build(input(s),s);assert.equal(r.response_status,'empty_success_capture');assert.equal(r.row_count,0);assert.deepEqual(r.rows,[]);
  assert.equal(r.response_range_completeness,'unknown_pagination_not_demonstrated');assert.deepEqual(verify(r,input(s),s),r);
  const q=input();const legacy=parseKis039DailyChartResponse(body(),{symbol:'000000',board:'J',startDate:'20261019',endDate:'20261021',periodCode:'D',adjustmentCode:'0',receivedAt:q.capture.received_at,origin:'synthetic_fixture'});
  assert.equal(legacy[1]!.raw_fields.stck_clpr.value,null);assert.equal(legacy[1]!.raw_fields.stck_clpr.state,'blank');
  const old=buildHistoryResult(q.request,legacy);assert.deepEqual(old.bars.map(x=>x.date),['2026-10-19','2026-10-20','2026-10-21']);assert.ok(old.bars.every(x=>x.close===null));
  assert.throws(()=>buildHistoryResult(q.request,[]),/empty_response/);
});
test('date duplicate is rejected, not sorted or deduped; request/range/date guards remain strict',()=>{
  expectError(changeBody(b=>{b.output2[2]!.stck_bsop_date='20261021';}),'duplicate_provider_business_date');
  expectError(changeBody(b=>{b.output2[0]!.stck_bsop_date='20261018';}),'provider_date_outside_requested_range');
  for(const d of ['20260230','20261301','2026101','2026-10-21',''])expectError(changeBody(b=>{b.output2[0]!.stck_bsop_date=d;}));
  for(const patch of [{start_date:'2026-10-22'},{end_date:'2026-10-18'},{board:'XX'},{symbol:'00000'},{interval:'1w'},{adjustment_code:'2'},{start_date:'0099-01-01'},{start_date:'2026-02-30'}]){const q=input();Object.assign(q.request,patch);expectError(()=>build(q,text),'invalid_input');}
});
test('weekends do not imply sessions, source date does not imply publication or receipt timezone',()=>{
  const s=JSON.stringify({rt_cd:'0',output1:{},output2:[{stck_bsop_date:'20261018',stck_clpr:'100'}]}),q=input(s);q.request.start_date='2026-10-18';
  q.capture.received_at='2026-10-17T23:00:00Z';q.cutoff='2026-10-18T00:00:00Z';const r=build(q,s);
  assert.equal(r.rows[0]!.provider_business_date,'2026-10-18');assert.equal(r.rows[0]!.canonical.session,null);assert.equal(r.rows[0]!.canonical.publication_at,null);
});
test('only exactly string 0 succeeds; numeric status can never underflow/round into success',()=>{
  for(const token of ['0','-0','0.0','0e99','-1e-9999','1e-9999','0.000000000000000000001','9007199254740993','true','null','{}','[]']){
    const s=`{"rt_cd":${token},"output1":{},"output2":[]}`;expectError(()=>build(input(s),s),'unsupported_provider_status');}
  for(const token of ['1','00',' 0','0 ','0.0','-0','0e0']){const s=JSON.stringify({rt_cd:token,output1:{},output2:[]});expectError(()=>build(input(s),s),'upstream_rejected');}
});
test('provider field types/lengths/formats are exact, no numeric coercion or semantic repair',()=>{
  for(const value of [1,null,[],{},true,'1e6','+1','1,000',' 1','1 ','NaN','Infinity','1.','-.1','1\n','1\r','1\u2028','1\u2029','1\u0000'])expectError(changeBody(b=>{b.output2[0]!.stck_clpr=value;}));
  for(const k of ['flng_cls_code','mod_yn','revl_issu_reas'])for(const v of ['\n','\r','\u0000','\u0085'])expectError(changeBody(b=>{b.output2[0]![k]=v;}),'provider_response_schema_drift');
  for(const [k,max]of Object.entries(fields))expectError(changeBody(b=>{b.output2[0]![k]='1'.repeat(max+1);}));
  expectError(changeBody(b=>{b.output2[0]!.unknown_provider_key='PRIVATE';}),'provider_response_schema_drift');
  expectError(changeBody(b=>{delete b.output2[0]!.stck_bsop_date;}));
  expectError(changeBody(b=>{b.output2=Array.from({length:101},()=>({stck_bsop_date:'20261021'}));}),'provider_response_schema_drift');
  for(const envelope of [null,[],{}, {rt_cd:'0',output2:[]},{rt_cd:'0',output1:[],output2:[]},{rt_cd:'0',output1:null,output2:[]},{rt_cd:'0',output1:{},output2:{}}]){
    const s=JSON.stringify(envelope);expectError(()=>build(input(s),s));}
});
test('original hash binds whitespace, hidden messages and encoding, not JSON.stringify(parsed)',()=>{
  const r=build(input(),text);expectError(()=>build(input(),text+' '),'capture_hash_mismatch');
  const reformatted=JSON.stringify(JSON.parse(text),null,2);expectError(()=>verify(r,input(reformatted),reformatted),'evidence_mismatch');
  const changed=text.replace('PRIVATE_PROVIDER_MESSAGE','DIFFERENT_PRIVATE_MESSAGE');expectError(()=>verify(r,input(changed),changed),'evidence_mismatch');
  const unicode=text.replace('PRIVATE_PROVIDER_MESSAGE','비공개 😀');assert.equal(build(input(unicode),unicode).capture.body_byte_length,Buffer.byteLength(unicode));
  const escaped=text.replace('000123.00','\\u003000123.00');assert.equal(build(input(escaped),escaped).rows[0]!.raw_fields.stck_clpr.value,'000123.00');
});
test('decoded duplicate JSON keys reject everywhere, including ignored provider metadata and escaped names',()=>{
  for(const s of ['{"rt_cd":"1","rt_cd":"0","output1":{},"output2":[]}',
    '{"rt_cd":"0","\\u0072t_cd":"0","output1":{},"output2":[]}',
    '{"rt_cd":"0","output1":{"secret":"a","secret":"b"},"output2":[]}',
    '{"rt_cd":"0","output1":{},"output2":[{"stck_bsop_date":"20261020","stck_clpr":"1","stck_clpr":"2"}]}',
    '{"rt_cd":"0","output1":{},"output2":[],"extra":{"__proto__":1,"__proto__":2}}'])expectError(()=>build(input(s),s),'duplicate_json_key');
});
test('bounded JSON syntax rejects malformed/ambiguous inputs and unsafe unicode',()=>{
  for(const s of ['', ' ', '{} trailing','{"rt_cd":"0",}','[1,]','{"x":01}','{"x":NaN}','{"x":1.}','{"x":+1}',
    '{"x":"\\uD800"}','{"x":"\\uDC00"}','{"x":"\\x01"}','{"x":"line\nfeed"}','{"x":"unterminated}', '\uFEFF{}'])expectError(()=>build(input(s),s),'invalid_json');
  expectError(()=>build(input(),null),'invalid_body_text');expectError(()=>build(input(),new String(text)),'invalid_body_text');
  const s='\uD800';expectError(()=>build(input(s),s),'invalid_body_text');
  const ok='{"rt_cd":"0","output1":{"n":1e999999999,"__proto__":{"x":"private"}},"output2":[]}';assert.equal(build(input(ok),ok).row_count,0);
  assert.equal(({} as Record<string,unknown>).x,undefined);
});
test('all cheap size bounds precede encoding, number conversion and unbounded recursive schema traversal',()=>{
  const large=' '.repeat(limits.body_bytes+1);expectError(()=>build(input(),large),'body_too_large');
  const multibyte='한'.repeat(Math.floor(limits.body_bytes/3)+1);expectError(()=>build(input(),multibyte),'body_too_large');
  for(const s of ['['.repeat(limits.body_depth+1)+'0'+']'.repeat(limits.body_depth+1),
    JSON.stringify(Array.from({length:limits.container_entries+1},()=>null)),
    '{"x":'+ '1'.repeat(limits.number_code_units+1)+'}',JSON.stringify({x:'x'.repeat(limits.string_code_units+1)}),
    JSON.stringify({['k'.repeat(limits.key_code_units+1)]:0}),JSON.stringify(Array.from({length:100},()=>Array.from({length:100},()=>null)))])expectError(()=>build(input(s),s),'body_complexity_limit');
  const q=input();q.cutoff='1'.repeat(limits.input_bytes+1);expectError(()=>build(q,text),'input_too_large');
  const long=input();long.capture.received_at='1'.repeat(81);expectError(()=>build(long,text),'invalid_input');
});
test('exact fractional time comparison rejects even submillisecond future receipts and honors offsets',()=>{
  const q=input();q.capture.received_at='2026-10-22T00:00:00.00000000000000000002Z';q.cutoff='2026-10-22T09:00:00.00000000000000000001+09:00';expectError(()=>build(q,text),'future_receipt');
  q.cutoff='2026-10-22T09:00:00.000000000000000000020+09:00';assert.equal(build(q,text).capture.received_at,q.capture.received_at);
  for(const t of ['2026-10-22T00:00:00-00:00','2026-02-30T00:00:00Z','2026-10-22','2026-10-22T24:00:00Z','2026-10-22T00:00:60Z','2026-10-22T00:00:00+24:00','2026-10-22T00:00:00Z\n','2026-10-22T00:00:00Z\r']){q.cutoff=t;expectError(()=>build(q,text),'invalid_input');}
});
test('input and persisted snapshots reject getters, proxies, revoked proxies, cycles, symbols, sparse arrays and exotic prototypes without invoking hooks',()=>{
  let calls=0;const hook=()=>{calls++;throw new Error('PRIVATE_HOOK');};
  const getter=Object.defineProperty({},'request',{get:hook,enumerable:true});
  const proxy=new Proxy(input(),{get:hook,getPrototypeOf:hook,ownKeys:hook});const rev=Proxy.revocable(input(),{});rev.revoke();
  const cyclic:Record<string,unknown>={};cyclic.self=cyclic;
  const hidden=Object.defineProperty(input(),'secret',{value:1,enumerable:false});
  for(const v of [getter,proxy,rev.proxy,cyclic,new Date(),new Map(),Object.create(input()),{...input(),[Symbol('s')]:1},{...input(),toJSON:hook},hidden])expectError(()=>build(v,text));
  const r=JSON.parse(JSON.stringify(build(input(),text)));
  for(const rows of [new Array(3),Object.assign([r.rows[0]],{extra:1}),new Proxy(r.rows,{get:hook}),Object.setPrototypeOf([...r.rows],{})])expectError(()=>verify({...r,rows},input(),text));
  const nested=structuredClone(input());Object.defineProperty(nested.capture,'received_at',{get:hook,enumerable:true});expectError(()=>build(nested,text));
  const pr=structuredClone(r);Object.defineProperty(pr.rows[0].raw_fields.stck_clpr,'value',{get:hook,enumerable:true});expectError(()=>verify(pr,input(),text));assert.equal(calls,0);
  const nullPrototype=Object.assign(Object.create(null),input());assert.equal(build(nullPrototype,text).row_count,3);
});
test('full reconstruction rejects persisted field tampering, omitted/reordered rows and independent-context replays',()=>{
  const r=build(input(),text);
  const edits:Array<(p:any)=>void>=[p=>{p.rows[0].raw_fields.stck_clpr.value='123.00';},p=>{p.rows[0].source_row_index=1;},p=>{p.rows.reverse();},p=>{p.rows.pop();},p=>{p.row_count=2;},
    p=>{p.rows[1].raw_fields.stck_clpr={state:'missing',value:null};},p=>{p.rows[0].canonical.close='123';},p=>{p.rows[0].canonical.price_unit='KRW/share';},
    p=>{p.rows[0].provider_business_date='2026-10-20';},p=>{p.capture.origin='actual';},p=>{p.request.symbol='999999';},p=>{p.request.adjustment_code='1';},
    p=>{p.capture.received_at='2026-10-22T00:00:00Z';},p=>{p.cutoff='2026-10-23T00:00:00Z';},p=>{p.capture.body_sha256='0'.repeat(64);},
    p=>{p.capture.body_byte_length++;},p=>{p.source_as_of='2026-10-22T00:00:00Z';},p=>{p.capture.source_authentication='verified';},p=>{p.msg1='PRIVATE';},p=>{p.warnings.pop();}];
  for(const edit of edits){const p=JSON.parse(JSON.stringify(r));edit(p);expectError(()=>verify(p,input(),text));}
  for(const edit of [(q:any)=>{q.request.symbol='999999';},(q:any)=>{q.request.board='NX';},(q:any)=>{q.request.adjustment_code='1';},(q:any)=>{q.capture.origin='actual';},
    (q:any)=>{q.capture.received_at='2026-10-22T00:00:00Z';},(q:any)=>{q.cutoff='2026-10-23T00:00:00Z';},(q:any)=>{q.request.start_date='2026-10-18';}]){
    const q=input();edit(q);expectError(()=>verify(r,q,text),'evidence_mismatch');}
});
test('sanitized finite errors never echo provider data, hostile text or caller metadata',()=>{
  const s='{"rt_cd":"PRIVATE_ERROR_FROM_PROVIDER","msg1":"SECRET","output1":{},"output2":[]}';try{build(input(s),s);assert.fail('must reject');}catch(e){assert.ok(e instanceof KrDailyEvidenceError);assert.equal(e.message,'upstream_rejected');assert.ok(!JSON.stringify(e).includes('SECRET'));}
  for(const weird of [undefined,Symbol('PRIVATE'),()=>{},NaN,Infinity,-Infinity,-0,1n])expectError(()=>build(weird,text));
});
test('deterministic retained fixtures reconstruct and schema files describe the additive contract',async()=>{
  const root=new URL('../../fixtures/kr-daily-raw/',import.meta.url);
  for(const name of ['mixed-order','empty-success']){const s=await readFile(new URL(`${name}.body.json`,root),'utf8');const q=JSON.parse(await readFile(new URL(`${name}.input.json`,root),'utf8'));
    const r=JSON.parse(await readFile(new URL(`${name}.evidence.json`,root),'utf8'));assert.deepEqual(verify(r,q,s),r);}
  const schema=JSON.parse(await readFile(new URL('../../contracts/kr-daily-raw-evidence-result-v1.schema.json',import.meta.url),'utf8'));
  assert.equal(schema.properties.contract.const,'moai.kis.kr-daily-raw-evidence.v1');assert.equal(schema.additionalProperties,false);
});

test('desktop file replay rejects unsupported execution without exposing provider payloads',{skip:buildPinSkip},async()=>{
  const root=new URL('../../',import.meta.url),fixture=new URL('fixtures/kr-daily-raw/',root);
  const script=fileURLToPath(new URL('scripts/replay-kr-daily-raw-evidence.mjs',root));
  const q=fileURLToPath(new URL('mixed-order.input.json',fixture)),b=fileURLToPath(new URL('mixed-order.body.json',fixture));
  if (process.platform === 'darwin' || process.platform === 'win32') {
    const run=spawnSync(process.execPath,[script,q,b,fileURLToPath(new URL('mixed-order.evidence.json',fixture))],{encoding:'utf8',timeout:5000});
    assert.equal(run.status,1); assert.equal(run.stdout,''); assert.equal(run.stderr.trim(),'evidence_replay_failed'); return;
  }
  const dir=await mkdtemp(join(tmpdir(),'moai-kr-replay-'));
  const dto=await readFile(new URL('mixed-order.evidence.json',fixture),'utf8');
  try{for(const [i,source]of [dto,dto.replace('"source_row_index": 0','"source_row_index": 1e-9999'),dto.replace('"row_count": 3','"row_count": 3.0000000000000001'),dto.replace('"source_row_index": 0','"source_row_index": 0.0000000000000001'),dto.replace('"row_count": 3','"row_count": 1, "row_count": 3'),' '.repeat(limits.persisted_bytes+1)].entries()){
    const path=`${dir}/evidence-${i}.json`;await writeFile(path,source);const run=spawnSync(process.execPath,[script,q,b,path],{encoding:'utf8',timeout:5000});
    assert.equal(run.status,i===0?0:1);if(i===0)assert.equal(JSON.parse(run.stdout).status,'verified_reconstruction');else assert.equal(run.stderr.trim(),'evidence_replay_failed');
  }
  await symlink(q,`${dir}/symlink.json`);
  await symlink(fileURLToPath(fixture),`${dir}/parent-link`);
  assert.equal(spawnSync('mkfifo',[`${dir}/fifo.json`],{encoding:'utf8'}).status,0);
  for(const path of [`${dir}/symlink.json`,`${dir}/fifo.json`,`${dir}/parent-link/mixed-order.input.json`,dir]){const run=spawnSync(process.execPath,[script,path,b,fileURLToPath(new URL('mixed-order.evidence.json',fixture))],{encoding:'utf8',timeout:5000});assert.equal(run.status,1);assert.equal(run.stderr.trim(),'evidence_replay_failed');}
  }finally{await rm(dir,{recursive:true,force:true});}
});

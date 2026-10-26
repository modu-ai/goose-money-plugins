import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { buildRemainingSourceEvidence as build, verifyRemainingSourceEvidence as verify,
 buildRemainingSourceEvidenceFromText as buildText,verifyRemainingSourceEvidenceFromText as verifyText,
 verifyRemainingSourceEvidenceFiles as verifyFiles,collectRemainingSourceEvidence as collect,
 RemainingSourceError,REMAINING_SOURCE_ERRORS,REMAINING_SOURCE_FIELDS,
 RemainingSourceRequestSchema,Kis113MarketInvestorRequestSchema,Kis109HouseEstimateRequestSchema,Kis280IceActionRequestSchema,
 RemainingSourceInputSchema,RemainingSourceResultSchema, type RemainingSourceRequest } from '../src/remaining-source-inputs.js';
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const at='2026-10-22T08:00:00.123456789Z';
const market:RemainingSourceRequest={operation_ref:'KIS-113',query:{FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:'0001',FID_INPUT_DATE_1:'20261021',FID_INPUT_DATE_2:'20261021',FID_INPUT_ISCD_1:'KSP',FID_INPUT_ISCD_2:''}};
const estimates:RemainingSourceRequest={operation_ref:'KIS-109',query:{SHT_CD:'005930'}};
const ice:RemainingSourceRequest={operation_ref:'KIS-280',query:{NCOD:'US',SYMB:'SYNTH',ST_YMD:'20261001',ED_YMD:'20261031'}};
const marketBody={rt_cd:'0',msg1:'PRIVATE_ENVELOPE_MARKER',output:[{stck_bsop_date:'20261021',frgn_ntby_qty:'000012',prsn_ntby_qty:'',orgn_ntby_tr_pbmn:'-00001.500',bstp_nmix_prpr:'0'.repeat(112)},{stck_bsop_date:'20261021',frgn_ntby_qty:'000012'}]};
const estimateBody={rt_cd:'0',output1:{secret:'PRIVATE_ESTIMATE_OUTPUT1'},output2:[{data1:'001.20',data2:'',data5:'-0.0'},{}],output3:[{data1:'11',data2:'',data3:'PRIVATE_COLUMN_THREE',data4:{nested:'PRIVATE_COLUMN_FOUR'},data5:'12'}],output4:[{dt:'FY26E'},{dt:''},{}]};
const iceBody={rt_cd:'0',output1:[{anno_dt:'20250101',ca_title:'TickerChange',effective_dt:'20261010',pay_dt:'20280101',div_lock_dt:''},{ca_title:'UNKNOWN'},{ca_title:'UNKNOWN'}]};
function input(req:RemainingSourceRequest,body:string){return{request:structuredClone(req),capture:{origin:'synthetic' as const,received_at:at,expected_body_sha256:sha(body)},cutoff:at};}
function result(req=market,body=JSON.stringify(marketBody)){return build(input(req,body),body);}
function reject(fn:()=>unknown,code?:string){assert.throws(fn,e=>e instanceof RemainingSourceError&&REMAINING_SOURCE_ERRORS.includes(e.code)&&(!code||e.code===code));}
async function rejectAsync(fn:()=>Promise<unknown>,code:string){await assert.rejects(fn,e=>e instanceof RemainingSourceError&&e.code===code);}

test('KIS-113 is market aggregate; raw strings, blanks, missing, duplicates, order and anomalous lengths retained',()=>{
 const r=result();assert.equal(r.scope,'market_industry_one_day_aggregate_not_stock_flow');assert.equal(r.groups[0]!.rows.length,2);
 assert.deepEqual(r.groups[0]!.rows.map(x=>x.source_row_index),[0,1]);const f=r.groups[0]!.rows[0]!.raw_fields;
 assert.deepEqual(f.frgn_ntby_qty,{state:'present',value:'000012'});assert.deepEqual(f.prsn_ntby_qty,{state:'blank',value:''});assert.deepEqual(f.orgn_ntby_qty,{state:'missing',value:null});
 assert.equal(f.bstp_nmix_prpr!.value!.length,112);assert.equal(r.identity_status,'request_context_only_not_response_verified');
 assert.equal(r.metric_ready,false);for(const row of r.groups[0]!.rows)assert.ok(Object.values(row.canonical).every(x=>x===null));
 assert.equal(r.request_execution_status,'not_asserted');assert.equal(r.first_page_origin,'not_verified');assert.equal(r.response_completeness,'not_established');assert.ok(!JSON.stringify(r).includes('PRIVATE_ENVELOPE_MARKER'));
 assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.request.query)&&Object.isFrozen(r.groups[0]!.rows[0]!.raw_fields));
});
test('KIS-109 positional evidence only; conflicted output1 and undocumented output3 columns never projected',()=>{
 const r=result(estimates,JSON.stringify(estimateBody));assert.equal(r.scope,'positional_KIS_house_estimates_not_cross_broker_consensus');
 assert.deepEqual(r.groups.map(g=>g.source_root),['output2','output3','output4']);assert.deepEqual(Object.keys(r.groups[1]!.rows[0]!.raw_fields),['data1','data2','data5']);
 assert.equal(r.groups[2]!.rows[0]!.raw_fields.dt!.value,'FY26E');assert.ok(!JSON.stringify(r).includes('PRIVATE_'));assert.equal(r.groups[0]!.rows[0]!.canonical.period,null);
 assert.ok(r.ambiguities.some(x=>x.includes('portal_length_2')));assert.ok(r.ambiguities.some(x=>x.includes('data3_data4')));
});
test('KIS-280 does not constrain announcement date to request or future event dates to receipt',()=>{
 const r=result(ice,JSON.stringify(iceBody));assert.equal(r.scope,'overseas_ICE_A4_A5_not_domestic_KSD');assert.equal(r.groups[0]!.rows[0]!.raw_fields.pay_dt!.value,'20280101');assert.equal(r.groups[0]!.rows[0]!.raw_fields.anno_dt!.value,'20250101');assert.equal(r.publication_at,null);assert.equal(r.groups[0]!.rows.length,3);
});
for(const [req,raw]of [[market,{rt_cd:'0',output:[]}],[estimates,{rt_cd:'0',output2:[],output3:[],output4:[]}],[ice,{rt_cd:'0',output1:[]}]]as const){
 test(`${req.operation_ref} empty success does not prove complete/no data`,()=>{const r=result(req,JSON.stringify(raw));assert.ok(r.groups.every(g=>g.row_count===0));assert.equal(r.response_completeness,'not_established');});}
for(const [name,modify]of [
 ['market', (q:any)=>q.query.FID_COND_MRKT_DIV_CODE='J'],['different dates',(q:any)=>q.query.FID_INPUT_DATE_2='20261022'],['missing subgroup',(q:any)=>delete q.query.FID_INPUT_ISCD_2],
 ['missing market',(q:any)=>delete q.query.FID_INPUT_ISCD_1],['unknown market',(q:any)=>q.query.FID_INPUT_ISCD_1='NYSE'],['invalid calendar',(q:any)=>q.query.FID_INPUT_DATE_1=q.query.FID_INPUT_DATE_2='20260229'],
 ['extra continuation',(q:any)=>q.continuation='N'],['blank industry',(q:any)=>q.query.FID_INPUT_ISCD=''],['industry too long',(q:any)=>q.query.FID_INPUT_ISCD='0'.repeat(13)],['newline suffix',(q:any)=>q.query.FID_INPUT_ISCD='0001\n']
]as const)test(`reject invalid KIS-113 request ${name}`,()=>{const q=structuredClone(market);modify(q);reject(()=>result(q),'invalid_input');});
for(const [name,modify]of [['missing date',(q:any)=>delete q.query.ST_YMD],['missing country',(q:any)=>delete q.query.NCOD],['unknown country',(q:any)=>q.query.NCOD='KR'],['missing symbol',(q:any)=>delete q.query.SYMB],['reversed dates',(q:any)=>q.query.ST_YMD='20261101'],['symbol url',(q:any)=>q.query.SYMB='https://private'],['newline',(q:any)=>q.query.SYMB='SYNTH\n']]as const)
 test(`reject invalid KIS-280 request ${name}`,()=>{const q=structuredClone(ice);modify(q);reject(()=>result(q,JSON.stringify(iceBody)),'invalid_input');});
for(const value of ['20260229','20261301','20261032','2026102','20261021\n','00000101'])test(`KIS-113 rejects provider date ${JSON.stringify(value)}`,()=>{const b=JSON.stringify({rt_cd:'0',output:[{stck_bsop_date:value}]});reject(()=>result(market,b));});
test('KIS-113 matching date must be supplied, not synthesized',()=>{for(const row of [{},{stck_bsop_date:''},{stck_bsop_date:'20261020'}])reject(()=>result(market,JSON.stringify({rt_cd:'0',output:[row]})));});
for(const value of [1,1.2,null,true,{},[], '1e9','1,000','NaN','Infinity','1\n','\u0000','secret_marker'])test(`raw numeric field rejects ${JSON.stringify(value)}`,()=>{
 reject(()=>result(market,JSON.stringify({rt_cd:'0',output:[{stck_bsop_date:'20261021',frgn_ntby_qty:value}]})));});
test('negative zero, leading zeros and decimal text survive unchanged',()=>{for(const value of ['-0','-0.00','000.001','123456789012']){const r=result(market,JSON.stringify({rt_cd:'0',output:[{stck_bsop_date:'20261021',frgn_ntby_qty:value}]}));assert.equal(r.groups[0]!.rows[0]!.raw_fields.frgn_ntby_qty!.value,value);}});
for(const value of [0,{},null,'1'])test(`exact string zero status rejects ${JSON.stringify(value)}`,()=>{reject(()=>result(market,JSON.stringify({...marketBody,rt_cd:value})),typeof value==='string'?'upstream_rejected':'unsupported_provider_status');});
for(const body of ['{"rt_cd":"0","rt_cd":"1","output":[]}', '{"rt_cd":"0","output":[],"outp\\u0075t":[]}', '{"rt_cd":"0","output":[{"stck_bsop_date":"20261021","stck_bsop_date":"20261020"}]}', '{"rt_cd":"0","output":[],"private":{"a":1,"a":2}}'])
 test('duplicate decoded JSON keys rejected everywhere '+sha(body).slice(0,8),()=>reject(()=>result(market,body),'duplicate_json_key'));
for(const body of ['','[1]','{','{"rt_cd":"0","output":[],}','{"rt_cd":"0","output":[]} trailing','{"rt_cd":"0","output":[],"x":01}','{"rt_cd":"0","output":[],"x":NaN}','{"rt_cd":"0","output":[],"x":"\\ud800"}'])
 test('strict original JSON rejects '+JSON.stringify(body),()=>reject(()=>result(market,body)));
test('opaque numeric envelope tokens never rounded, converted, or emitted',()=>{const body='{"rt_cd":"0","output":[],"unknown":1e9999,"unsafe":9007199254740993,"underflow":1e-9999}';assert.equal(result(market,body).groups[0]!.row_count,0);});
test('unknown provider row fields fail closed',()=>reject(()=>result(market,JSON.stringify({rt_cd:'0',output:[{stck_bsop_date:'20261021',secret:'PRIVATE'}]})),'provider_schema_drift'));
test('exact textual hash includes whitespace and original key order',()=>{const b=JSON.stringify(marketBody),q=input(market,b);reject(()=>build(q,b+' '),'capture_hash_mismatch');reject(()=>build(q,JSON.stringify(JSON.parse(b),null,2)),'capture_hash_mismatch');});
test('nanosecond cutoff comparison and equivalent offset',()=>{const b=JSON.stringify(marketBody),q=input(market,b);q.capture.received_at='2026-10-22T08:00:00.123456790Z';reject(()=>build(q,b),'future_receipt');q.capture.received_at='2026-10-22T17:00:00.123456789+09:00';build(q,b);});
for(const received of ['2026-10-22','2026-10-22T08:00:00-00:00','2026-10-22T08:00:00Z\n','2026-02-30T08:00:00Z'])test('invalid receipt '+received,()=>{const b=JSON.stringify(marketBody),q=input(market,b);q.capture.received_at=received;reject(()=>build(q,b));});
test('persisted result is reconstructed, not trusted flags',()=>{const body=JSON.stringify(marketBody),q=input(market,body),r=result();assert.deepEqual(verify(r,q,body),r);
 for(const change of [(x:any)=>x.groups[0]!.rows[0].raw_fields.frgn_ntby_qty.value='555',(x:any)=>x.groups[0]!.row_count=1,(x:any)=>x.groups[0]!.rows.reverse(),(x:any)=>x.groups[0]!.rows[0].source_row_index=1,(x:any)=>x.capture.origin='actual',(x:any)=>x.request.query.FID_INPUT_ISCD='0002',(x:any)=>x.operation_ref='KIS-280',(x:any)=>x.metric_ready=true,(x:any)=>x.capture.received_at='2026-10-22T08:00:00Z']){const p=structuredClone(r);change(p);reject(()=>verify(p,q,body));}
 const changedInput=input(market,body);(changedInput.request.query as any).FID_INPUT_ISCD='0002';reject(()=>verify(r,changedInput,body),'evidence_mismatch');});
test('metadata original JSON duplicates and noncanonical numeric forms fail before trust',()=>{const body=JSON.stringify(marketBody),q=JSON.stringify(input(market,body)),r=JSON.stringify(result());verifyText(r,q,body);buildText(q,body);
 reject(()=>buildText(q.replace('"cutoff":','"cutoff":"2026-10-22T08:00:00Z","cutoff":'),body),'duplicate_json_key');
 for(const token of ['2.0','2e0','-0','9007199254740993','1e-9999','1e9999'])reject(()=>verifyText(r.replace('"row_count":2','"row_count":'+token),q,body),'invalid_metadata_number');
 reject(()=>verifyText(r.replace('"row_count":2','"row_count":2,"row_count":2'),q,body),'duplicate_json_key');});
test('snapshots reject accessor, toJSON, proxy, revoked proxy, prototype, cycles without invoking handlers',()=>{const b=JSON.stringify(marketBody);let ran=0;
 const accessor=Object.defineProperty({},'request',{get(){ran++;throw Error('SECRET');},enumerable:true});reject(()=>build(accessor,b),'invalid_snapshot');
 const q:any=input(market,b);q.toJSON=()=>{ran++;return q};reject(()=>build(q,b));const proxy=new Proxy({}, {ownKeys(){ran++;return[]},get(){ran++;return null}});reject(()=>build(proxy,b),'invalid_snapshot');
 const rev=Proxy.revocable({},{});rev.revoke();reject(()=>build(rev.proxy,b),'invalid_snapshot');reject(()=>build(Object.create({request:market}),b),'invalid_snapshot');const cycle:any={};cycle.request=cycle;reject(()=>build(cycle,b),'invalid_snapshot');assert.equal(ran,0);
});
test('sparse and custom-property arrays rejected during persisted verification',()=>{const b=JSON.stringify(marketBody),q=input(market,b),p:any=structuredClone(result());delete p.groups[0]!.rows[0];reject(()=>verify(p,q,b),'invalid_snapshot');const other:any=structuredClone(result());other.groups[0]!.rows.foo=1;reject(()=>verify(other,q,b),'invalid_snapshot');});
test('body and row budgets',()=>{reject(()=>result(market,' '.repeat(262145)),'body_too_large');reject(()=>result(market,JSON.stringify({rt_cd:'0',output:Array.from({length:101},()=>({stck_bsop_date:'20261021'}))})),'provider_schema_drift');
 reject(()=>result(market,'{"rt_cd":"0","output":[],"x":'+ '['.repeat(14)+'0'+']'.repeat(14)+'}'),'complexity_limit');
 reject(()=>result(market,'{"rt_cd":"0","output":[],"x":'+ '1'.repeat(129)+'}'),'complexity_limit');});
test('safe errors never echo source marker or nested errors',async()=>{const body=JSON.stringify({rt_cd:'PRIVATE_ACCOUNT_PASSWORD',output:[]});try{result(market,body);}catch(e){assert.equal((e as Error).message,'upstream_rejected');assert.ok(!JSON.stringify(e).includes('PRIVATE_'));}
 await rejectAsync(()=>collect(market,{origin:'synthetic',cutoff:at},{send:async()=>{throw Error('PRIVATE_TOKEN')},now:()=>at}),'transport_failed');});
test('injected adapter uses fixed frozen request, explicit dates and copied context, snapshots response before clock',async()=>{
 const req:any=structuredClone(market),ctx:any={origin:'synthetic',cutoff:at};const b=JSON.stringify(marketBody);const response:any={status:200,tr_cont:null,body_text:b};let calls=0;
 const r=await collect(req,ctx,{send:async wire=>{calls++;assert.ok(Object.isFrozen(wire)&&Object.isFrozen(wire.query));assert.equal(wire.endpoint,'/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market');assert.equal(wire.method,'GET');assert.equal(wire.pagination,'none');assert.throws(()=>{(wire.query as any).FID_INPUT_ISCD='evil'});req.query.FID_INPUT_ISCD='9999';ctx.cutoff='1900-01-01T00:00:00Z';return response;},now:()=>{calls++;response.body_text='changed';return at;}});
 assert.equal(calls,2);assert.equal((r.request.query as any).FID_INPUT_ISCD,'0001');assert.equal(r.cutoff,at);assert.equal(r.capture.body_sha256,sha(b));assert.equal(r.request_execution_status,'not_asserted');
});
test('KIS-109 blocked before accessing dependency getters, transport and clock for both conflicting code lengths',async()=>{for(const code of ['12','005930']){let called=0;const dependencies:any={get send(){called++;throw Error('PRIVATE')},get now(){called++;throw Error('PRIVATE')}};await rejectAsync(()=>collect({operation_ref:'KIS-109',query:{SHT_CD:code}},null,dependencies),'request_contract_conflict');assert.equal(called,0);}});
test('invalid requests stop before transport or clock',async()=>{let called=0;await rejectAsync(()=>collect({operation_ref:'KIS-280',query:{NCOD:'US',SYMB:'SYNTH'}},{origin:'synthetic',cutoff:at},{send:async()=>{called++},now:()=>{called++}}),'invalid_input');assert.equal(called,0);});
test('dependency accessor is not invoked',async()=>{let calls=0;const deps:any={get send(){calls++;return async()=>null},now:()=>at};await rejectAsync(()=>collect(market,{origin:'synthetic',cutoff:at},deps),'invalid_input');assert.equal(calls,0);});
for(const cont of ['M','F','N','0'])test('continuation '+cont+' blocked without clock or automatic pagination',async()=>{let times=0;await rejectAsync(()=>collect(ice,{origin:'synthetic',cutoff:at},{send:async()=>({status:200,tr_cont:cont,body_text:JSON.stringify(iceBody)}),now:()=>{times++;return at}}),'pagination_not_supported');assert.equal(times,0);});
test('non200, fractional numeric status and response accessors rejected without clock',async()=>{for(const status of [201,500,200.5,NaN]){let times=0;await assert.rejects(()=>collect(market,{origin:'synthetic',cutoff:at},{send:async()=>({status,tr_cont:'',body_text:JSON.stringify(marketBody)}),now:()=>{times++;return at}}),RemainingSourceError);assert.equal(times,0);}
 let calls=0;await rejectAsync(()=>collect(market,{origin:'synthetic',cutoff:at},{send:async()=>({get status(){calls++;return 200},tr_cont:'',body_text:''}),now:()=>at}),'invalid_snapshot');assert.equal(calls,0);});
test('clock failure sanitized and no publication inference',async()=>{await rejectAsync(()=>collect(market,{origin:'synthetic',cutoff:at},{send:async()=>({status:200,tr_cont:'',body_text:JSON.stringify(marketBody)}),now:()=>{throw Error('PRIVATE')}}),'clock_failed');});
test('desktop strict-file verification fails closed on unsupported platforms',()=>{const dir=mkdtempSync(join(tmpdir(),'remaining-source-'));try{const b=JSON.stringify(marketBody),q=JSON.stringify(input(market,b)),r=JSON.stringify(result());const p=join(dir,'persisted.json'),ip=join(dir,'input.json'),bp=join(dir,'body.json');writeFileSync(p,r);writeFileSync(ip,q);writeFileSync(bp,b);
 if (process.platform === 'darwin' || process.platform === 'win32') {reject(()=>verifyFiles(p,ip,bp),'invalid_file');reject(()=>verifyFiles(dir,ip,bp),'invalid_file');return;}
 assert.deepEqual(verifyFiles(p,ip,bp),result());
 const link=join(dir,'link');symlinkSync(bp,link);reject(()=>verifyFiles(p,ip,link),'invalid_file');reject(()=>verifyFiles(dir,ip,bp),'invalid_file');writeFileSync(bp,Buffer.from([0xc3,0x28]));reject(()=>verifyFiles(p,ip,bp),'invalid_file');writeFileSync(bp,b);writeFileSync(p,r.replace('"row_count":2','"row_count":2e0'));reject(()=>verifyFiles(p,ip,bp),'invalid_metadata_number');
 writeFileSync(p,r);writeFileSync(ip,q.replace('"cutoff":','"cutoff":"x","cutoff":'));reject(()=>verifyFiles(p,ip,bp),'duplicate_json_key');}finally{rmSync(dir,{recursive:true,force:true});}});
test('schemas convert structurally; semantic checks remain required',()=>{for(const schema of [RemainingSourceInputSchema,RemainingSourceResultSchema]){const converted=z.toJSONSchema(schema);assert.equal(converted.$schema,'https://json-schema.org/draft/2020-12/schema');}});
test('field projection matches pinned literal response field evidence, not catalog row IDs',()=>{const evidence=JSON.parse(readFileSync(new URL('../../contracts/r01-kis-official-response-schemas-v1.json',import.meta.url),'utf8'));
 for(const [op,roots]of Object.entries(REMAINING_SOURCE_FIELDS)){const entry=evidence.operations.find((x:any)=>x.operation_ref===op);assert.ok(entry);const actual=Object.entries(roots).flatMap(([root,fields])=>Object.entries(fields).map(([k,n])=>({path:`$.${root}[*].${k}`,n})));assert.deepEqual(actual.map(x=>x.path).sort(),entry.response_fields.map((x:any)=>x.response_path).sort());for(const f of actual)assert.equal(f.n,entry.response_fields.find((x:any)=>x.response_path===f.path).portal_max_length);}});
test('all persisted synthetic fixture triplets reconstruct from separate original text and input',()=>{
 const root=new URL('../../',import.meta.url),manifest=JSON.parse(readFileSync(new URL('fixtures/remaining-source-fixtures-v1.json',root),'utf8'));
 assert.equal(manifest.synthetic_only,true);assert.equal(manifest.network_requests,0);assert.equal(manifest.cases.length,6);
 for(const c of manifest.cases){const original=readFileSync(new URL(c.original,root),'utf8'),inputText=readFileSync(new URL(c.input,root),'utf8'),persisted=readFileSync(new URL(c.result,root),'utf8');assert.equal(sha(original),c.original_sha256);
 const r=verifyText(persisted,inputText,original);assert.equal(r.capture.origin,'synthetic');assert.equal(r.metric_ready,false);assert.ok(!JSON.stringify(r).includes('PRIVATE_SYNTHETIC'));}
});
test('structural schema artifacts match generated runtime schema including literals and row field limits',()=>{
 for(const [name,schema]of [['request',RemainingSourceRequestSchema],['input',RemainingSourceInputSchema],['result',RemainingSourceResultSchema]]as const){const artifact=JSON.parse(readFileSync(new URL(`../../contracts/remaining-source-${name}-v1.schema.json`,import.meta.url),'utf8'));delete artifact.$id;delete artifact.title;delete artifact.description;assert.deepEqual(artifact,z.toJSONSchema(schema));}
});
test('provider field length limits are applied literally for all documented fields',()=>{
 const reqs={'KIS-113':market,'KIS-109':estimates,'KIS-280':ice};for(const [op,groups]of Object.entries(REMAINING_SOURCE_FIELDS))for(const [root,fields]of Object.entries(groups))for(const [field,length]of Object.entries(fields as Record<string,number>)){
  const raw:any={rt_cd:'0'};for(const r of Object.keys(groups))raw[r]=[];raw[root]=[{...(op==='KIS-113'?{stck_bsop_date:'20261021'}:{}),[field]:'1'.repeat(length+1)}];
  reject(()=>result(reqs[op as keyof typeof reqs],JSON.stringify(raw)),'provider_schema_drift');}
});
test('escaped reviewed numeric keys resolve normally but unpaired surrogates and private row fields do not',()=>{
 const body='{"rt_cd":"0","output":[{"stck_bsop_date":"20261021","frgn_ntby_\\u0071ty":"01"}]}';assert.equal(result(market,body).groups[0]!.rows[0]!.raw_fields.frgn_ntby_qty!.value,'01');
 reject(()=>result(ice,'{"rt_cd":"0","output1":[{"ca_title":"\\ud800"}]}'),'invalid_json');
});
test('KIS-280 valid country and symbol contexts remain request claims, not resolved instrument identity',async()=>{
 for(const NCOD of ['CN','HK','US','JP','VN']as const){const req=structuredClone(ice);req.query.NCOD=NCOD;const original=JSON.stringify(iceBody);
 const r=await collect(req,{origin:'synthetic',cutoff:at},{send:async wire=>{assert.equal(wire.endpoint,'/uapi/overseas-price/v1/quotations/rights-by-ice');assert.equal(wire.tr_id,'HHDFS78330900');return{status:200,tr_cont:'',body_text:original};},now:()=>at});assert.equal(r.identity_status,'request_context_only_not_response_verified');}
});
test('file boundary rejects symlink ancestors, parent traversal, BOM and byte-budget overflow',()=>{
 const dir=mkdtempSync(join(tmpdir(),'remaining-source-path-'));try{const b=JSON.stringify(marketBody),q=JSON.stringify(input(market,b)),r=JSON.stringify(result());
 const pp=join(dir,'persisted.json'),ip=join(dir,'input.json'),bp=join(dir,'body.json');writeFileSync(pp,r);writeFileSync(ip,q);writeFileSync(bp,b);
 const parent=join(dir,'aliased');symlinkSync(dir,parent);reject(()=>verifyFiles(pp,ip,join(parent,'body.json')),'invalid_file');
 reject(()=>verifyFiles(pp,ip,dir+'/../'+dir.split('/').at(-1)+'/body.json'),'invalid_file');writeFileSync(bp,'\ufeff'+b);reject(()=>verifyFiles(pp,ip,bp));
 writeFileSync(bp,' '.repeat(262145));reject(()=>verifyFiles(pp,ip,bp),'invalid_file');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('maximum supported row counts and documented field lengths remain reconstructable for all three operations',()=>{
 for(const request of [market,estimates,ice]){const raw:any={rt_cd:'0'};for(const [root,fields]of Object.entries(REMAINING_SOURCE_FIELDS[request.operation_ref]))raw[root]=Array.from({length:100},()=>Object.fromEntries(Object.entries(fields as Record<string,number>).map(([k,n])=>[k,k==='stck_bsop_date'||k.endsWith('_dt')?'20261021':k==='ca_title'?'Unknown':k==='dt'?'F'.repeat(8):'1'.repeat(n)])));
 const body=JSON.stringify(raw),q=input(request,body),r=build(q,body);assert.ok(r.groups.every(g=>g.row_count===100));assert.deepEqual(verifyText(JSON.stringify(r),JSON.stringify(q),body),r);}
});
test('request-only exports accept exactly their operation with no capture metadata',()=>{
 for(const [schema,request]of [[Kis113MarketInvestorRequestSchema,market],[Kis109HouseEstimateRequestSchema,estimates],[Kis280IceActionRequestSchema,ice]]as const){
 assert.ok(schema.safeParse(request).success);assert.ok(RemainingSourceRequestSchema.safeParse(request).success);assert.ok(!schema.safeParse({...request,capture:{origin:'actual'}}).success);
 for(const other of [market,estimates,ice])if(other.operation_ref!==request.operation_ref)assert.ok(!schema.safeParse(other).success);
 }
});


test('bounded receive size errors are diagnosed without exposing transport text or invoking getters',async()=>{
 await rejectAsync(()=>collect(market,{origin:'synthetic',cutoff:at},{send:async()=>{throw Error('response_too_large')},now:()=>at}),'body_too_large');
 let touches=0;const hostile=new Error();Object.defineProperty(hostile,'message',{get(){touches++;return 'PRIVATE_TOKEN'}});
 await rejectAsync(()=>collect(market,{origin:'synthetic',cutoff:at},{send:async()=>{throw hostile},now:()=>at}),'transport_failed');assert.equal(touches,0);
});

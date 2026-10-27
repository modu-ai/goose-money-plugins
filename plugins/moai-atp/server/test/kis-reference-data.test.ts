import assert from 'node:assert/strict';import test from 'node:test';
import {requestInstrumentProfile,requestMarketHeadlines,type ReferenceRequest,type ReferenceTransport} from '../src/kis-reference-data.js';
const at='2026-10-22T01:00:00Z';
function mock(output:unknown,tr_cont:string|null=null,status=200){const calls:ReferenceRequest[]=[];const transport:ReferenceTransport={origin:'synthetic',async send(r){calls.push(r);return {status,tr_cont,body:{rt_cd:'0',output}};}};return {calls,transport};}
test('profile fixes GET path/type and strips unknown extensions without inventing class',async()=>{const m=mock({pdno:'000660',prdt_type_cd:'300',prdt_name:'Synthetic company',secret_extension:'omit'});const r=await requestInstrumentProfile({symbol:'000660'},m.transport,at);assert.deepEqual(m.calls[0]?.query,{PRDT_TYPE_CD:'300',PDNO:'000660'});assert.equal(r.origin,'synthetic');assert.equal('secret_extension' in r.profile,false);});
test('profile rejects wrong instrument, multirows, unsupported asset input and no retry',async()=>{for(const output of [{pdno:'005930',prdt_type_cd:'300'},[{pdno:'000660',prdt_type_cd:'300'},{pdno:'000660',prdt_type_cd:'300'}]])await assert.rejects(requestInstrumentProfile({symbol:'000660'},mock(output).transport,at));const m=mock({});await assert.rejects(requestInstrumentProfile({symbol:'Q500001'},m.transport,at));assert.equal(m.calls.length,0);});
test('headlines return title metadata only and no inferred source timestamp or article body',async()=>{const m=mock([{cntt_usiq_srno:'1',hts_pbnt_titl_cntt:'Synthetic <script> title',data_dt:'20261021',data_tm:'093000',body:'not accepted'}]);const r=await requestMarketHeadlines({symbol:'000660'},m.transport,at);assert.equal(r.coverage,'headline_metadata_only');assert.equal(r.source_as_of,null);assert.equal('body' in r.headlines[0]!,false);assert.equal(m.calls[0]?.query.FID_INPUT_DATE_1,'');});
test('reference data fails closed on continuation, errors, unknown inputs and oversized text',async()=>{await assert.rejects(requestMarketHeadlines({symbol:'000660'},mock([],'M').transport,at),/pagination_not_supported/);const m=mock([],null,429);await assert.rejects(requestMarketHeadlines({symbol:'000660'},m.transport,at),/rate_limited/);assert.equal(m.calls.length,1);await assert.rejects(requestMarketHeadlines({symbol:'000660',url:'https://evil.test'},m.transport,at));await assert.rejects(requestMarketHeadlines({symbol:'000660'},mock([{cntt_usiq_srno:'1',hts_pbnt_titl_cntt:'x'.repeat(1001)}]).transport,at),/schema_drift/);});

test('reference fetch transport enforces operation/path/query before credentials and binds only official origin',async()=>{
 const {FetchReferenceTransport}=await import('../src/kis-reference-data.js');const {RequestPacer}=await import('../src/kis-http.js');
 let calls=0,secrets=0;
 const t=new FetchReferenceTransport('production',{async getForMarketRead(){secrets++;return {appKey:'fixture-key',appSecret:'fixture-secret',accessToken:'fixture-token'};}},async(url,init)=>{calls++;assert.equal(new URL(String(url)).origin,'https://openapi.koreainvestment.com:9443');assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');return new Response(JSON.stringify({rt_cd:'0',output:{pdno:'000660',prdt_type_cd:'300'}}),{status:200});},new RequestPacer(0));
 const req:ReferenceRequest={operation:'kis.profile',method:'GET',path:'/uapi/domestic-stock/v1/quotations/search-stock-info',tr_id:'CTPF1002R',query:{PDNO:'000660',PRDT_TYPE_CD:'300'}};
 await assert.rejects(t.send({...req,path:'https://evil.invalid'}),/invalid_input/);await assert.rejects(t.send({...req,query:{...req.query,account:'x'}}),/invalid_input/);assert.equal(secrets,0);assert.equal(calls,0);
 const r=await requestInstrumentProfile({symbol:'000660'},t,at);assert.equal(r.origin,'actual');assert.equal(secrets,1);assert.equal(calls,1);
});
test('reference received_at is post-response, not request start across a report cutoff',async()=>{
 let now='2026-10-22T00:00:00Z';const after='2026-10-22T00:02:00Z';
 const transport:ReferenceTransport={origin:'synthetic',async send(r){await Promise.resolve();now=after;return {status:200,tr_cont:null,body:{rt_cd:'0',output:r.operation==='kis.profile'?{pdno:'000660',prdt_type_cd:'300'}:[{cntt_usiq_srno:'1',hts_pbnt_titl_cntt:'Synthetic'}]}};}};
 const profile=await requestInstrumentProfile({symbol:'000660'},transport,()=>now);assert.equal(profile.received_at,after);
 now='2026-10-22T00:00:00Z';const news=await requestMarketHeadlines({symbol:'000660'},transport,()=>now);assert.equal(news.received_at,after);assert.ok(news.received_at>'2026-10-22T00:01:00Z');
});
test('headlines reject explicit wrong-symbol rows and mark missing identity evidence',async()=>{
 await assert.rejects(requestMarketHeadlines({symbol:'000660'},mock([{cntt_usiq_srno:'1',hts_pbnt_titl_cntt:'Synthetic',iscd1:'005930'}]).transport,at),/instrument_mismatch/);
 const missing=await requestMarketHeadlines({symbol:'000660'},mock([{cntt_usiq_srno:'1',hts_pbnt_titl_cntt:'Synthetic'}]).transport,at);assert.equal(missing.headlines[0]?.instrument_association,'unverified_missing_codes');
 const match=await requestMarketHeadlines({symbol:'000660'},mock([{cntt_usiq_srno:'1',hts_pbnt_titl_cntt:'Synthetic',iscd1:'005930',iscd2:'000660'}]).transport,at);assert.equal(match.headlines[0]?.instrument_association,'matched_returned_code');
});

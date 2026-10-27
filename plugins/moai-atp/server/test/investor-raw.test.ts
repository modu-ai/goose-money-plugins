import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FetchReferenceTransport,requestInvestorRaw,type ReferenceTransport} from '../src/kis-reference-data.js';
const input={symbol:'005930',board:'J',input_date:'2026-10-23'};
const row={stck_bsop_date:'20261023',prsn_ntby_qty:'-10',frgn_ntby_qty:'20',orgn_ntby_qty:'-10',prsn_ntby_tr_pbmn:'-1',frgn_ntby_tr_pbmn:'2',orgn_ntby_tr_pbmn:'-1'};
test('official investor endpoint mock preserves raw units and returned dates',async()=>{
 let calls=0;const transport:ReferenceTransport={origin:'synthetic',send:async r=>{calls++;assert.equal(r.path,'/uapi/domestic-stock/v1/quotations/inquire-investor');assert.equal(r.tr_id,'FHKST01010900');assert.deepEqual(r.query,{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'005930'});return {status:200,tr_cont:null,body:{rt_cd:'0',output:[row]}};}};
 const result=await requestInvestorRaw(input,transport,()=> '2026-10-24T00:00:00Z');assert.equal(calls,1);assert.equal(result.amount_unit,'unverified');assert.equal(result.quantity_unit,'unverified');assert.equal(result.rows[0]?.prsn_ntby_qty,'-10');assert.equal(result.origin,'synthetic');assert.equal(result.source_as_of,'2026-10-23');
});
test('investor shape, HTTP denial, continuation and unsupported board fail closed',async()=>{
 for(const [response,expected] of [[{status:429,tr_cont:null,body:null},'rate_limited'],[{status:200,tr_cont:'M',body:{rt_cd:'0',output:[row]}},'pagination_not_supported'],[{status:200,tr_cont:null,body:{rt_cd:'0',output:[{...row,frgn_ntby_qty:'not-number'}]}},'schema_drift']] as const){
  await assert.rejects(requestInvestorRaw(input,{origin:'synthetic',send:async()=>response},()=> '2026-10-24T00:00:00Z'),new RegExp(expected));
 }
 let calls=0;await assert.rejects(requestInvestorRaw({...input,board:'UN'},{origin:'synthetic',send:async()=>{calls++;throw Error('unexpected');}},()=> '2026-10-24T00:00:00Z'));assert.equal(calls,0);
});
test('fetch investor allowlist uses scoped GET and never accepts arbitrary URLs',async()=>{
 let calls=0;const transport=new FetchReferenceTransport('production',{getForMarketRead:async()=>({appKey:'synthetic-key',appSecret:'synthetic-secret',accessToken:'synthetic-token'})},async(url,init)=>{calls++;assert.equal(new URL(String(url)).pathname,'/uapi/domestic-stock/v1/quotations/inquire-investor');assert.equal(init?.method,'GET');return new Response(JSON.stringify({rt_cd:'0',output:[row]}),{status:200});});
 await requestInvestorRaw(input,transport,()=> '2026-10-24T00:00:00Z');assert.equal(calls,1);
 await assert.rejects(transport.send({operation:'kis.investors',method:'GET',path:'https://example.com',tr_id:'FHKST01010900',query:{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'005930'}}),/invalid_input/);assert.equal(calls,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountBalanceInputSchema, FetchAccountBalanceTransport} from '../src/account-balance.js';
import {RequestPacer} from '../src/kis-http.js';

// Generated, visibly synthetic identity shared by request and reflection assertions.
const syntheticAccountNumber='9'.repeat(8);
const identity=async()=>({cano:syntheticAccountNumber,productCode:'01'});
const auth={getForMarketRead:async()=>({appKey:'fixture-app-key',appSecret:'fixture-app-secret',accessToken:'fixture-access-token'})};
const payload={rt_cd:'0',output1:[{pdno:'000660',prdt_name:'합성 종목',hldg_qty:'9007199254740993',pchs_avg_pric:'10.25',pchs_amt:'100',prpr:'11',evlu_amt:'110',evlu_pfls_amt:'-0.01',evlu_pfls_rt:'-0.01'}],output2:[{dnca_tot_amt:'20',tot_evlu_amt:'130',nass_amt:'125',pchs_amt_smtl_amt:'100',evlu_amt_smtl_amt:'110',evlu_pfls_smtl_amt:'-0.01'}]};
test('synthetic account GET exact endpoint/TR and decimal preservation; no identity echo',async()=>{
 let count=0;
 const f:typeof fetch=async(url,init)=>{count++;const u=new URL(String(url));assert.equal(u.origin,'https://openapi.koreainvestment.com:9443');assert.equal(u.pathname,'/uapi/domestic-stock/v1/trading/inquire-balance');assert.equal(u.searchParams.get('CANO'),syntheticAccountNumber);assert.equal(u.searchParams.get('INQR_DVSN'),'02');assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('tr_id'),'TTTC8434R');return new Response(JSON.stringify({...payload,CANO:syntheticAccountNumber,unknown:'discard'}),{headers:{tr_cont:'M'}});};
 const t=new FetchAccountBalanceTransport('production',auth,identity,f,()=> '2026-10-24T00:00:00Z',new RequestPacer(0),'synthetic');const r=await t.read();assert.equal(count,1);assert.equal(r.holdings[0]?.hldg_qty,'9007199254740993');assert.equal(r.holdings[0]?.evlu_pfls_amt,'-0.01');assert.equal(r.completeness,'partial_more_pages');assert.equal(r.source_as_of,null);assert.equal(r.currency,null);assert.ok(!JSON.stringify(r).includes(syntheticAccountNumber));
});
test('account rate limit no retry and sanitized transport exception',async()=>{
 for(const status of [429,401,500]){let calls=0;const f:typeof fetch=async()=>{calls++;return new Response('',{status});};const t=new FetchAccountBalanceTransport('production',auth,identity,f,undefined,new RequestPacer(0));await assert.rejects(t.read(),new RegExp(status===429?'rate_limited':status===401?'auth_expired':'upstream_rejected'));assert.equal(calls,1);}
 const f:typeof fetch=async()=>{throw new Error('fixture-app-secret');};await assert.rejects(new FetchAccountBalanceTransport('production',auth,identity,f,undefined,new RequestPacer(0)).read(),/^Error: upstream_unavailable$/);
});
test('account invalid identity fails before credential read/fetch; partial/empty schema fails closed',async()=>{
 let reads=0;const c={getForMarketRead:async()=>{reads++;return await auth.getForMarketRead();}};const f:typeof fetch=async()=>new Response('{}');await assert.rejects(new FetchAccountBalanceTransport('production',c,async()=>({cano:'x',productCode:'01'}),f).read(),/credential_missing/);assert.equal(reads,0);
 await assert.rejects(new FetchAccountBalanceTransport('production',auth,identity,f,undefined,new RequestPacer(0)).read(),/schema_drift/);
});
test('account business failure without data maps rejection; arbitrary provider fields never escape',async()=>{
 const f:typeof fetch=async()=>new Response(JSON.stringify({rt_cd:'1',msg1:'fixture-app-secret'}));await assert.rejects(new FetchAccountBalanceTransport('production',auth,identity,f,undefined,new RequestPacer(0)).read(),/^Error: upstream_rejected$/);
});

test('secrets reflected inside allowed string fields are rejected, never returned',async()=>{
 for(const secret of ['fixture-app-key','fixture-app-secret','fixture-access-token',syntheticAccountNumber]){
  const f:typeof fetch=async()=>new Response(JSON.stringify({...payload,output1:[{...payload.output1[0],prdt_name:secret}]}));
  await assert.rejects(new FetchAccountBalanceTransport('production',auth,identity,f,undefined,new RequestPacer(0)).read(),/^Error: schema_drift$/);
 }
});
test('paper endpoint is fixed and bad environment never reads identity or credentials',async()=>{
 let count=0;
 const f:typeof fetch=async(url,init)=>{count++;assert.equal(new URL(String(url)).origin,'https://openapivts.koreainvestment.com:29443');assert.equal(new Headers(init?.headers).get('tr_id'),'VTTC8434R');return new Response(JSON.stringify(payload));};
 await new FetchAccountBalanceTransport('paper',auth,identity,f,undefined,new RequestPacer(0),'synthetic').read();
 assert.equal(count,1);
 await assert.rejects(new FetchAccountBalanceTransport('invalid' as any,auth,identity,f,undefined,new RequestPacer(0)).read(),/invalid_input/);
 assert.equal(count,1);
});
test('bounded body and unsupported continuation fail without retry',async()=>{
 for(const [text,headers,code] of [[' '.repeat(300001),{},'response_too_large'],[JSON.stringify(payload),{tr_cont:'unexpected'},'schema_drift']] as const){
  let calls=0;const f:typeof fetch=async()=>{calls++;return new Response(text,{headers});};
  await assert.rejects(new FetchAccountBalanceTransport('production',auth,identity,f,undefined,new RequestPacer(0)).read(),new RegExp(code));assert.equal(calls,1);
 }
});
test('no caller operation/path/method and no private clock or credential error escapes',async()=>{
 for(const input of [{operation:'order'},{path:'/transfer'},{method:'POST'},{account:syntheticAccountNumber}])assert.equal(AccountBalanceInputSchema.safeParse(input).success,false);
 const f:typeof fetch=async()=>new Response(JSON.stringify(payload));
 await assert.rejects(new FetchAccountBalanceTransport('production',auth,identity,f,()=> 'synthetic-private',new RequestPacer(0)).read(),/^Error: schema_drift$/);
 await assert.rejects(new FetchAccountBalanceTransport('production',{getForMarketRead:async()=>{throw new Error('fixture-app-secret');}},identity,f).read(),/^Error: credential_missing$/);
});

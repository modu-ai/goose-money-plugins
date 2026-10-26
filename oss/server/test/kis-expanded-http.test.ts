import test from 'node:test';import assert from 'node:assert/strict';
import {createExpandedKisTransports} from '../src/kis-expanded-http.js';
import {createCredentialProvider} from '../src/credential-runtime.js';
import {RequestPacer} from '../src/kis-http.js';
const credentials={getForMarketRead:async()=>({appKey:'synthetic-expanded-key',appSecret:'synthetic-expanded-secret',accessToken:'synthetic-expanded-token'})};
const wire=(operation:string,path:string,tr_id:string,query:Record<string,string>,cont=false)=>({operation,method:'GET',path,tr_id,...(cont?{tr_cont:''}:{}),query});
const requests=[
 wire('kis.us_quote','/uapi/overseas-price/v1/quotations/price','HHDFS00000300',{AUTH:'',EXCD:'NAS',SYMB:'AAPL'}),
 wire('kis.futures_quote','/uapi/domestic-futureoption/v1/quotations/inquire-price','FHMIF10000000',{FID_COND_MRKT_DIV_CODE:'F',FID_INPUT_ISCD:'101V12'}),
 wire('kis.domestic_etf_quote','/uapi/etfetn/v1/quotations/inquire-price','FHPST02400000',{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'069500'}),
 wire('kis.overseas_futures_quote','/uapi/overseas-futureoption/v1/quotations/inquire-price','HHDFC55010000',{SRS_CD:'ESZ26'}),
 wire('kis.us_daily_history','/uapi/overseas-price/v1/quotations/dailyprice','HHDFS76240000',{AUTH:'',EXCD:'NAS',SYMB:'AAPL',GUBN:'0',BYMD:'20261023',MODP:'0'},true),
 wire('kis.kr_intraday_history','/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice','FHKST03010200',{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'005930',FID_INPUT_HOUR_1:'153000',FID_PW_DATA_INCU_YN:'Y',FID_ETC_CLS_CODE:''},true),
 wire('kis.us_product_profile','/uapi/overseas-price/v1/quotations/search-info','CTPF1702R',{PRDT_TYPE_CD:'512',PDNO:'AAPL'}),
 wire('kis.kr_futures_daily_history','/uapi/domestic-futureoption/v1/quotations/inquire-daily-fuopchartprice','FHKIF03020100',{FID_COND_MRKT_DIV_CODE:'F',FID_INPUT_ISCD:'101V12',FID_INPUT_DATE_1:'20261001',FID_INPUT_DATE_2:'20261023',FID_PERIOD_DIV_CODE:'D'},true),
 wire('kis.kr_futures_minute_history','/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice','FHKIF03020200',{FID_COND_MRKT_DIV_CODE:'F',FID_INPUT_ISCD:'101V12',FID_HOUR_CLS_CODE:'60',FID_PW_DATA_INCU_YN:'Y',FID_FAKE_TICK_INCU_YN:'N',FID_INPUT_DATE_1:'20261023',FID_INPUT_HOUR_1:'153000'},true),
 wire('kis.overseas_futures_daily_history','/uapi/overseas-futureoption/v1/quotations/daily-ccnl','HHDFC55020100',{SRS_CD:'ESZ26',EXCH_CD:'CME',START_DATE_TIME:'',CLOSE_DATE_TIME:'20261023',QRY_TP:'Q',QRY_CNT:'40',QRY_GAP:'',INDEX_KEY:''},true),
 wire('kis.overseas_futures_minute_history','/uapi/overseas-futureoption/v1/quotations/inquire-time-futurechartprice','HHDFC55020400',{SRS_CD:'ESZ26',EXCH_CD:'CME',START_DATE_TIME:'',CLOSE_DATE_TIME:'20261023',QRY_TP:'Q',QRY_CNT:'120',QRY_GAP:'5',INDEX_KEY:''},true),
 wire('kis.kr_historical_intraday','/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice','FHKST03010230',{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'005930',FID_INPUT_DATE_1:'20261023',FID_INPUT_HOUR_1:'153000',FID_PW_DATA_INCU_YN:'Y',FID_FAKE_TICK_INCU_YN:''},true),
 wire('kis.market_orderbook','/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn','FHKST01010200',{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'005930'},true),
 wire('kis.credit','/uapi/domestic-stock/v1/quotations/daily-credit-balance','FHPST04760000',{FID_COND_MRKT_DIV_CODE:'J',FID_COND_SCR_DIV_CODE:'20476',FID_INPUT_ISCD:'005930',FID_INPUT_DATE_1:'20261023'}),
 wire('kis.short_sale','/uapi/domestic-stock/v1/quotations/daily-short-sale','FHPST04830000',{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:'005930',FID_INPUT_DATE_1:'20261001',FID_INPUT_DATE_2:'20261023'}),
 wire('kis.lending','/uapi/domestic-stock/v1/quotations/daily-loan-trans','HHPST074500C0',{MRKT_DIV_CLS_CODE:'3',MKSC_SHRN_ISCD:'005930',START_DATE:'20261001',END_DATE:'20261023',CTS:''}),
];
for(const request of requests)test(`expanded fixed GET serialization (synthetic fetch): ${request.operation}`,async()=>{
 let count=0;const fetchImpl:typeof fetch=async(input,init)=>{count++;const u=new URL(String(input)),headers=new Headers(init?.headers);assert.equal(u.origin,'https://openapi.koreainvestment.com:9443');assert.equal(u.pathname,request.path);assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(headers.get('tr_id'),request.tr_id);assert.equal(init?.body,undefined);assert.deepEqual(Object.fromEntries(u.searchParams),request.query);assert.ok(!u.toString().includes('synthetic-expanded'));return new Response('{"rt_cd":"0","output":{}}',{status:200,headers:{tr_cont:'M'}});};
 const t=createExpandedKisTransports(credentials,fetchImpl,new RequestPacer(0));const result=await t.globalMarketTransport.send(request);assert.equal(count,1);assert.equal(result.tr_cont,'M');assert.deepEqual(result.body,{rt_cd:'0',output:{}});
});
for(const period of ['D','M'])test(`raw benchmark preserves exact original text (${period}, synthetic fetch)`,async()=>{const text=' { "rt_cd" : "0", "output2" : [] }\n';const t=createExpandedKisTransports(credentials,async()=>new Response(text,{status:200}),new RequestPacer(0));const result=await t.benchmarkHistoryTransport.send({operation_ref:'KIS-264',method:'GET',path:'/uapi/overseas-price/v1/quotations/inquire-daily-chartprice',tr_id:'FHKST03030100',query:{FID_COND_MRKT_DIV_CODE:'N',FID_INPUT_ISCD:'.IXIC',FID_INPUT_DATE_1:'20261001',FID_INPUT_DATE_2:'20261023',FID_PERIOD_DIV_CODE:period}});assert.equal(result.body_text,text);assert.equal(result.http_status,200);});
for(const request of [
 {operation_ref:'KIS-113',method:'GET',endpoint:'/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market',tr_id:'FHPTJ04040000',pagination:'none',query:{FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:'0001',FID_INPUT_DATE_1:'20261023',FID_INPUT_DATE_2:'20261023',FID_INPUT_ISCD_1:'KSP',FID_INPUT_ISCD_2:''}},
 {operation_ref:'KIS-280',method:'GET',endpoint:'/uapi/overseas-price/v1/quotations/rights-by-ice',tr_id:'HHDFS78330900',pagination:'none',query:{NCOD:'US',SYMB:'AAPL',ST_YMD:'20261001',ED_YMD:'20261023'}},
])test(`remaining-source raw text envelope (${request.operation_ref}, synthetic fetch)`,async()=>{const text='{"rt_cd":"0","output":[]}';const t=createExpandedKisTransports(credentials,async()=>new Response(text,{status:200}),new RequestPacer(0));assert.equal((await t.remainingSourceTransport.send(request)).body_text,text);});
test('unlisted endpoints, orders, account fields, mutated TR and accessors reject before credentials or fetch',async()=>{let touched=0;const t=createExpandedKisTransports({getForMarketRead:async()=>{touched++;throw Error('must_not_read');}},async()=>{touched++;throw Error('must_not_fetch');},new RequestPacer(0));for(const mutate of [(x:any)=>x.path='https://example.com', (x:any)=>x.path='/uapi/domestic-stock/v1/trading/order-cash',(x:any)=>x.method='POST',(x:any)=>x.tr_id='FAKE',(x:any)=>x.query.CANO='12345678',(x:any)=>Object.defineProperty(x,'path',{get(){touched++;return 'x';}})]){const q=structuredClone(requests[0]);mutate(q);await assert.rejects(t.globalMarketTransport.send(q),/invalid_input/);}assert.equal(touched,0);});
test('transport size/auth/rate/secret reflection failures are bounded and not retried',async()=>{for(const [response,error]of [[()=>new Response('x',{status:429}),'rate_limited'],[()=>new Response('x',{status:403}),'auth_expired'],[()=>new Response('x'.repeat(300001)),'response_too_large'],[()=>new Response('{"reflected":"synthetic-expanded-secret"}'),'schema_drift']] as const){let calls=0;const t=createExpandedKisTransports(credentials,async()=>{calls++;return response();},new RequestPacer(0));await assert.rejects(t.globalMarketTransport.send(requests[0]),new RegExp(error));assert.equal(calls,1);}});
test('concurrent token requests share one in-memory issuance and subsequent reads reuse it (synthetic)',async()=>{let grants=0;const provider=createCredentialProvider({env:{KIS_APP_KEY:'synthetic-shared-key',KIS_APP_SECRET:'synthetic-shared-secret'},obtainAccessToken:async()=>{grants++;await new Promise(r=>setTimeout(r,10));return 'synthetic-shared-token';}});const values=await Promise.all(Array.from({length:12},()=>provider.getForMarketRead()));assert.equal(grants,1);assert.ok(values.every(v=>v.accessToken==='synthetic-shared-token'));await provider.getForMarketRead();assert.equal(grants,1);});
test('failed in-flight issuance clears pending state without automatic retry (synthetic)',async()=>{let grants=0;const provider=createCredentialProvider({env:{KIS_APP_KEY:'synthetic-shared-key',KIS_APP_SECRET:'synthetic-shared-secret'},obtainAccessToken:async()=>{grants++;await new Promise(r=>setTimeout(r,5));if(grants===1)throw Error('synthetic-denied');return 'synthetic-shared-token';}});const results=await Promise.allSettled([provider.getForMarketRead(),provider.getForMarketRead()]);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(grants,1);await provider.getForMarketRead();assert.equal(grants,2);});

const remainingBoundaryRequest={operation_ref:'KIS-113',method:'GET',endpoint:'/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market',tr_id:'FHPTJ04040000',pagination:'none',query:{FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:'0001',FID_INPUT_DATE_1:'20261023',FID_INPUT_DATE_2:'20261023',FID_INPUT_ISCD_1:'KSP',FID_INPUT_ISCD_2:''}};
for(const size of [262144,262145,300000])test(`remaining source enforces parser byte ceiling at HTTP reader (${size}, synthetic)`,async()=>{
 const original='{"rt_cd":"0","output":[]}';const text=original+' '.repeat(size-Buffer.byteLength(original));let calls=0;
 const t=createExpandedKisTransports(credentials,async()=>{calls++;return new Response(text);},new RequestPacer(0));
 if(size===262144)assert.equal((await t.remainingSourceTransport.send(remainingBoundaryRequest)).body_text,text);
 else await assert.rejects(t.remainingSourceTransport.send(remainingBoundaryRequest),/response_too_large/);
 assert.equal(calls,1);
});
test('remaining source counts UTF-8 bytes and cancels oversized streams without retry (synthetic)',async()=>{
 let cancelled=0,calls=0;const bytes=new TextEncoder().encode('가'.repeat(90000));
 const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes);},cancel(){cancelled++;}});
 const t=createExpandedKisTransports(credentials,async()=>{calls++;return new Response(stream);},new RequestPacer(0));
 await assert.rejects(t.remainingSourceTransport.send(remainingBoundaryRequest),/response_too_large/);
 assert.equal(calls,1);assert.equal(cancelled,1);
});
test('unrelated expanded readers retain their existing ceiling (synthetic)',async()=>{
 const text='{"rt_cd":"0","output":{}}'+' '.repeat(270000);
 const t=createExpandedKisTransports(credentials,async()=>new Response(text),new RequestPacer(0));
 assert.deepEqual((await t.globalMarketTransport.send(requests[0])).body,{rt_cd:'0',output:{}});
});

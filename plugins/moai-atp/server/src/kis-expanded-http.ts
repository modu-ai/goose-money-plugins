import {types} from 'node:util';
import {z} from 'zod';
import {GlobalMarketRequestSchema} from './global-market-data.js';
import {OverseasFuturesRequestSchema} from './overseas-futures-data.js';
import {HistoryBreadthRequestSchema} from './history-breadth.js';
import {UsProductProfileRequestSchema} from './etf-product-inputs.js';
import {FuturesHistoryRequestSchema} from './futures-history.js';
import {KrHistoricalIntradayRequestSchema} from './historical-stock-bars.js';
import {MarketOrderbookRequestSchema} from './market-orderbook.js';
import {REMAINING_SOURCE_LIMITS,Kis113MarketInvestorRequestSchema,Kis280IceActionRequestSchema} from './remaining-source-inputs.js';
import {KIS_BASE_URL,PROCESS_PACER,SafeKisError,kisCredentialError,readBoundedResponseText,type KisCredentialProvider,type RequestPacer} from './kis-http.js';
const day=z.string().regex(/^\d{8}$/);
const benchmark=z.object({operation_ref:z.literal('KIS-264'),method:z.literal('GET'),path:z.literal('/uapi/overseas-price/v1/quotations/inquire-daily-chartprice'),tr_id:z.literal('FHKST03030100'),query:z.object({FID_COND_MRKT_DIV_CODE:z.enum(['N','X','I','S']),FID_INPUT_ISCD:z.string().min(1).max(12).regex(/^[A-Za-z0-9.]+$/),FID_INPUT_DATE_1:day,FID_INPUT_DATE_2:day,FID_PERIOD_DIV_CODE:z.enum(['D','W','M','Y'])}).strict()}).strict();
const remaining=z.union([
 Kis113MarketInvestorRequestSchema.extend({method:z.literal('GET'),endpoint:z.literal('/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market'),tr_id:z.literal('FHPTJ04040000'),pagination:z.literal('none')}).strict(),
 Kis280IceActionRequestSchema.extend({method:z.literal('GET'),endpoint:z.literal('/uapi/overseas-price/v1/quotations/rights-by-ice'),tr_id:z.literal('HHDFS78330900'),pagination:z.literal('none')}).strict(),
]);
const symbol=z.string().regex(/^\d{6}$/);
const marketRisk=z.union([
 z.object({operation:z.literal('kis.credit'),method:z.literal('GET'),path:z.literal('/uapi/domestic-stock/v1/quotations/daily-credit-balance'),tr_id:z.literal('FHPST04760000'),query:z.object({FID_COND_MRKT_DIV_CODE:z.literal('J'),FID_COND_SCR_DIV_CODE:z.literal('20476'),FID_INPUT_ISCD:symbol,FID_INPUT_DATE_1:day}).strict()}).strict(),
 z.object({operation:z.literal('kis.short_sale'),method:z.literal('GET'),path:z.literal('/uapi/domestic-stock/v1/quotations/daily-short-sale'),tr_id:z.literal('FHPST04830000'),query:z.object({FID_COND_MRKT_DIV_CODE:z.literal('J'),FID_INPUT_ISCD:symbol,FID_INPUT_DATE_1:day,FID_INPUT_DATE_2:day}).strict()}).strict(),
 z.object({operation:z.literal('kis.lending'),method:z.literal('GET'),path:z.literal('/uapi/domestic-stock/v1/quotations/daily-loan-trans'),tr_id:z.literal('HHPST074500C0'),query:z.object({MRKT_DIV_CLS_CODE:z.literal('3'),MKSC_SHRN_ISCD:symbol,START_DATE:day,END_DATE:day,CTS:z.literal('')}).strict()}).strict(),
]);
const RequestSchema=z.union([GlobalMarketRequestSchema,OverseasFuturesRequestSchema,HistoryBreadthRequestSchema,UsProductProfileRequestSchema,FuturesHistoryRequestSchema,KrHistoricalIntradayRequestSchema,MarketOrderbookRequestSchema,benchmark,remaining,marketRisk]);
/** Own-data snapshot before schema validation: never run a request getter or accept arbitrary endpoint/query keys. */
function snapshot(value:unknown,depth=0):unknown {
 if(typeof value==='string'){if(value.length>256||/[\r\n\0]/.test(value))throw new SafeKisError('invalid_input');return value;}
 if(depth>2||value===null||typeof value!=='object'||types.isProxy(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new SafeKisError('invalid_input');
 const out:Record<string,unknown>={};const keys=Reflect.ownKeys(value);if(keys.length>24)throw new SafeKisError('invalid_input');
 for(const key of keys){if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key))throw new SafeKisError('invalid_input');const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!d.enumerable||!('value' in d))throw new SafeKisError('invalid_input');out[key]=snapshot(d.value,depth+1);}
 return out;
}
export function createExpandedKisTransports(credentials:KisCredentialProvider,fetchImpl:typeof fetch=fetch,pacer:RequestPacer=PROCESS_PACER){
 async function text(request:unknown){
  const parsed=RequestSchema.safeParse(snapshot(request));if(!parsed.success)throw new SafeKisError('invalid_input');const q=parsed.data;
  const keys=await credentials.getForMarketRead().catch((e:unknown)=>{throw kisCredentialError(e);});if([keys.appKey,keys.appSecret,keys.accessToken].some(v=>!v||/[\r\n\0]/.test(v)))throw new SafeKisError('credential_missing');
  const url=new URL('path' in q?q.path:q.endpoint,KIS_BASE_URL.production);for(const [key,value]of Object.entries(q.query))url.searchParams.set(key,value);
  await pacer.reserve();let response:Response;
  try{response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10_000),headers:{'content-type':'application/json; charset=utf-8',authorization:`Bearer ${keys.accessToken}`,appkey:keys.appKey,appsecret:keys.appSecret,tr_id:q.tr_id,tr_cont:'tr_cont' in q?q.tr_cont:'',custtype:'P'}});}catch(error){if(error instanceof Error&&error.name==='TimeoutError')throw new SafeKisError('upstream_timeout');throw new SafeKisError('upstream_unavailable');}
  if(response.status===429){await response.body?.cancel();throw new SafeKisError('rate_limited');}
  if(response.status===401||response.status===403){await response.body?.cancel();throw new SafeKisError('auth_expired');}
  if(response.status!==200){await response.body?.cancel();throw new SafeKisError('upstream_rejected');}
  // Raw-source readers use the same byte ceiling as their parser; no truncation or limit increase.
  const rawSource='operation_ref' in q && (q.operation_ref==='KIS-113'||q.operation_ref==='KIS-280');
  const body_text=await readBoundedResponseText(response,rawSource?REMAINING_SOURCE_LIMITS.body_bytes:300_000);if([keys.appKey,keys.appSecret,keys.accessToken].some(v=>body_text.includes(v)))throw new SafeKisError('schema_drift');
  return {status:response.status,tr_cont:response.headers.get('tr_cont'),body_text};
 }
 const json={origin:'actual' as const,send:async(request:unknown)=>{const r=await text(request);let body:unknown;try{body=JSON.parse(r.body_text);}catch{throw new SafeKisError('schema_drift');}return {status:r.status,tr_cont:r.tr_cont,body};}};
 // Raw evidence adapters require the original decoded text; never JSON.parse/stringify it.
 const history={origin:'actual' as const,send:async(request:unknown)=>{const r=await text(request);return {http_status:r.status,tr_cont:r.tr_cont,body_text:r.body_text};}};
 const source={origin:'actual' as const,send:async(request:unknown)=>text(request)};
 return {globalMarketTransport:json,overseasFuturesTransport:json,historyBreadthTransport:json,etfProductTransport:json,futuresHistoryTransport:json,historicalStockTransport:json,marketOrderbookTransport:json,marketRiskTransport:json,benchmarkHistoryTransport:history,benchmarkPeriodTransport:history,remainingSourceTransport:source};
}

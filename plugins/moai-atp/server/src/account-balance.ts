import {z} from 'zod';
import {KIS_BASE_URL,PROCESS_PACER,RequestPacer,readBoundedResponseText,type KisCredentialProvider,type KisEnvironment} from './kis-http.js';
/** Official domestic inquire_balance/chk_inquire_balance fields. No account identifiers in tool arguments/results. */
export const AccountBalanceInputSchema=z.object({}).strict();
export const AccountIdentitySchema=z.object({cano:z.string().regex(/^\d{8}$/),productCode:z.string().regex(/^\d{2}$/)}).strict();
export type AccountIdentity=z.infer<typeof AccountIdentitySchema>;
const text=z.string().max(1000);
const numeric=z.string().regex(/^(?:|-?\d+(?:\.\d+)?)$/).max(100);
const holding=z.object({pdno:text,prdt_name:text,hldg_qty:numeric,pchs_avg_pric:numeric,pchs_amt:numeric,prpr:numeric,evlu_amt:numeric,evlu_pfls_amt:numeric,evlu_pfls_rt:numeric});
const summary=z.object({dnca_tot_amt:numeric,tot_evlu_amt:numeric,nass_amt:numeric,pchs_amt_smtl_amt:numeric,evlu_amt_smtl_amt:numeric,evlu_pfls_smtl_amt:numeric});
export const AccountBalanceResultSchema=z.object({contract:z.literal('moai.account.balance.v1'),provider:z.literal('kis'),origin:z.enum(['actual','synthetic']),received_at:z.string().datetime({offset:true}),source_as_of:z.null(),currency:z.null(),unit_status:z.literal('provider_lexemes_not_unit_reconciled'),holdings:z.array(holding).max(50),summary:z.array(summary).max(1),completeness:z.enum(['single_response_no_continuation','partial_more_pages']),warnings:z.array(z.string().max(300)).max(4)}).strict();
export interface AccountBalanceTransport {read():Promise<z.infer<typeof AccountBalanceResultSchema>>}
export class FetchAccountBalanceTransport implements AccountBalanceTransport {
 constructor(private readonly environment:KisEnvironment,private readonly credentials:KisCredentialProvider,private readonly identity:()=>Promise<AccountIdentity>,private readonly fetchImpl:typeof fetch=fetch,private readonly clock:()=>string=()=>new Date().toISOString(),private readonly pacer:RequestPacer=PROCESS_PACER,private readonly origin:'actual'|'synthetic'='actual'){}
 async read(){
  if(!['production','paper'].includes(this.environment))throw new Error('invalid_input');
  let id:AccountIdentity;try{id=AccountIdentitySchema.parse(await this.identity());}catch{throw new Error('credential_missing');}
  let auth;try{auth=await this.credentials.getForMarketRead();}catch{throw new Error('credential_missing');}
  if(!auth.appKey||!auth.appSecret||!auth.accessToken||[auth.appKey,auth.appSecret,auth.accessToken].some(v=>/[\r\n\0]/.test(v)))throw new Error('credential_missing');
  const url=new URL('/uapi/domestic-stock/v1/trading/inquire-balance',KIS_BASE_URL[this.environment]);
  const params={CANO:id.cano,ACNT_PRDT_CD:id.productCode,AFHR_FLPR_YN:'N',OFL_YN:'',INQR_DVSN:'02',UNPR_DVSN:'01',FUND_STTL_ICLD_YN:'N',FNCG_AMT_AUTO_RDPT_YN:'N',PRCS_DVSN:'00',CTX_AREA_FK100:'',CTX_AREA_NK100:''};
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  await this.pacer.reserve();let response:Response;
  try{response=await this.fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{authorization:`Bearer ${auth.accessToken}`,appkey:auth.appKey,appsecret:auth.appSecret,tr_id:this.environment==='production'?'TTTC8434R':'VTTC8434R',custtype:'P'}});}catch(e){throw new Error(e instanceof Error&&e.name==='TimeoutError'?'upstream_timeout':'upstream_unavailable');}
  if(!response.ok){await response.body?.cancel().catch(()=>undefined);throw new Error(response.status===429?'rate_limited':[401,403].includes(response.status)?'auth_expired':'upstream_rejected');}
  const raw=await readBoundedResponseText(response,300000);let json:unknown;try{json=JSON.parse(raw);}catch{throw new Error('schema_drift');}
  const code=z.object({rt_cd:z.string()}).safeParse(json);if(!code.success)throw new Error('schema_drift');if(code.data.rt_cd!=='0')throw new Error('upstream_rejected');
  const envelope=z.object({rt_cd:z.string(),output1:z.array(holding).max(this.environment==='production'?50:20),output2:z.array(summary).max(1)}).safeParse(json);
  if(!envelope.success)throw new Error('schema_drift');if(envelope.data.rt_cd!=='0')throw new Error('upstream_rejected');
  const cont=response.headers.get('tr_cont');if(![null,'','D','E','M','F'].includes(cont))throw new Error('schema_drift');
  const parsed=AccountBalanceResultSchema.safeParse({contract:'moai.account.balance.v1',provider:'kis',origin:this.origin,received_at:this.clock(),source_as_of:null,currency:null,unit_status:'provider_lexemes_not_unit_reconciled',holdings:envelope.data.output1,summary:envelope.data.output2,completeness:cont==='M'||cont==='F'?'partial_more_pages':'single_response_no_continuation',warnings:['첫 응답만 조회하며 자동 연속조회·재시도하지 않습니다.','예수금은 주문가능금액이 아닙니다. 단위·계좌 전체성·평가시각 확인 전 배분·손익을 계산하지 않습니다.']});
  if(!parsed.success)throw new Error('schema_drift');
  const result=parsed.data;
  const encoded=JSON.stringify(result);if([id.cano,auth.appKey,auth.appSecret,auth.accessToken].some(v=>v&&encoded.includes(v)))throw new Error('schema_drift');
  return result;
 }
}

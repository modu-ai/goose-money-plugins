import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {z} from 'zod';
import {KIS_BASE_URL,type KisQuoteCapture,SafeKisError} from './kis-http.js';
import {KIS_QUOTE_CATALOG,normalizeKrQuote} from './normalize-kr-quote.js';
import {validateProviderQuoteJson,QuoteSnapshotSchema} from './domain.js';
import {selectQuoteEnvelope} from './model-input-envelope.js';
import {ExactInstantSchema,compareInstants} from './exact-instant.js';

const SOURCE_URL=KIS_BASE_URL.production+KIS_QUOTE_CATALOG.path;
const Input=z.object({symbol:z.string().regex(/^\d{6}$/),board:z.enum(['J','NX','UN'])}).strict();
type Request=z.infer<typeof Input>;
const GateDecision=z.object({contract:z.literal('moai.quote-smoke.read-gate.v1'),symbol:Input.shape.symbol,board:Input.shape.board,origin:z.enum(['actual','synthetic']),purpose:z.literal('single_quote_smoke'),maximum_reads:z.literal(1),action_authorized:z.literal(true),source_read_entitled:z.literal(true),ephemeral_transport_ready:z.literal(true),valid_from:ExactInstantSchema,valid_until:ExactInstantSchema}).strict();
/** Trusted host callback only: serialized consent/rights flags are never accepted as dependencies. */
export interface QuoteSmokeReadGate {check(request:Readonly<Request&{origin:'actual'|'synthetic';purpose:'single_quote_smoke';source_url:string}>):Promise<unknown>}
export interface QuoteSmokeCaptureTransport {getMarketSnapshotCapture(symbol:string,board:'J'|'NX'|'UN'):Promise<KisQuoteCapture>}
export interface QuoteSmokeDependencies {readGate?:QuoteSmokeReadGate;transport?:QuoteSmokeCaptureTransport;origin:'actual'|'synthetic';clock?:()=>string}
export type QuoteSmokeErrorCode='already_attempted'|'invalid_input'|'read_gate_not_configured'|'read_gate_rejected'|'transport_not_configured'|'clock_invalid'|'transport_failed'|'credential_missing'|'auth_expired'|'rate_limited'|'source_capture_invalid'|'response_not_public_only'|'response_invalid'|'normalization_failed';
class SmokeError extends Error{constructor(readonly code:QuoteSmokeErrorCode){super(code);}}
function fail(code:QuoteSmokeErrorCode):never{throw new SmokeError(code);}
function plainRecord(v:unknown,maxString=2048):Record<string,unknown>{
 if(!v||typeof v!=='object'||types.isProxy(v)||Array.isArray(v))fail('invalid_input');const proto=Object.getPrototypeOf(v);if(proto!==Object.prototype&&proto!==null)fail('invalid_input');const keys=Reflect.ownKeys(v);if(keys.length>30)fail('invalid_input');const out=Object.create(null);
 for(const k of keys){if(typeof k!=='string'||k.length>100)fail('invalid_input');const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!('value'in d)||!d.enumerable||!['string','number','boolean'].includes(typeof d.value))fail('invalid_input');if(typeof d.value==='string'&&d.value.length>maxString)fail('invalid_input');Object.defineProperty(out,k,{value:d.value,enumerable:true});}return out;
}
function checkedTime(clock:()=>string):string{let t:unknown;try{t=clock();}catch{fail('clock_invalid');}if(!ExactInstantSchema.safeParse(t).success)fail('clock_invalid');return t as string;}
/** Bounded token scan rejects duplicate keys and credential-shaped response fields before capture persistence. */
function publicJson(text:string):void{
 if(typeof text!=='string'||Buffer.byteLength(text)>300000||Buffer.from(text,'utf8').toString('utf8')!==text)fail('response_invalid');
 if(/https?:\/\/[^\s"<>]*\?/i.test(text)||/bearer\s+|(?:app[_-]?key|app[_-]?secret|access[_-]?token|refresh[_-]?token|authorization)\s*=/i.test(text))fail('response_not_public_only');
 const inspectString=(tokenText:string):string=>{let value:string;try{value=JSON.parse(tokenText);}catch{fail('response_invalid');}if(Buffer.from(value,'utf8').toString('utf8')!==value||/[\u202a-\u202e\u2066-\u2069]/.test(value))fail('response_invalid');if(/https?:\/\/[^\s"<>]*\?/i.test(value)||/bearer\s+|(?:app[_-]?key|app[_-]?secret|access[_-]?token|refresh[_-]?token|authorization)\s*=/i.test(value))fail('response_not_public_only');return value;};
 const token=/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]/y;let pos=0,nodes=0;
 const next=()=>{while(/[\x20\t\n\r]/.test(text[pos]??'')&&pos<text.length)pos++;token.lastIndex=pos;const m=token.exec(text);if(!m)fail('response_invalid');pos=token.lastIndex;return m[0];};
 const peek=()=>{let p=pos;while(/[\x20\t\n\r]/.test(text[p]??'')&&p<text.length)p++;return text[p];};
 function value(depth:number){if(++nodes>20000||depth>16)fail('response_invalid');const t=next();if(t==='{'){const keys=new Set<string>();if(peek()==='}'){next();return;}for(;;){const keyToken=next();if(!keyToken.startsWith('"'))fail('response_invalid');const key=inspectString(keyToken);if(keys.has(key))fail('response_invalid');keys.add(key);if(/app[_-]?key|app[_-]?secret|access[_-]?token|refresh[_-]?token|authorization|password|credential|account[_-]?(?:number|no)|^cano$/i.test(key))fail('response_not_public_only');if(next()!==':')fail('response_invalid');value(depth+1);const end=next();if(end==='}')break;if(end!==',')fail('response_invalid');}}
  else if(t==='['){if(peek()===']'){next();return;}for(;;){value(depth+1);const end=next();if(end===']')break;if(end!==',')fail('response_invalid');}}
  else if(t.startsWith('"')){inspectString(t);}
  else if(!t.startsWith('"')&&!/^(?:true|false|null|-?\d)/.test(t))fail('response_invalid');
 }value(0);while(/[\x20\t\n\r]/.test(text[pos]??'')&&pos<text.length)pos++;if(pos!==text.length)fail('response_invalid');
}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
const SAFE_TRANSPORT_CODES=new Set(['credential_missing','auth_expired','rate_limited']);
/** One controller permits at most ONE attempt, including denied/invalid/failed attempts. No retry or state mutation. */
export function createOneShotQuoteSmoke(deps:QuoteSmokeDependencies){
 let attempted=false,transportInvocations=0;const clock=deps.clock??(()=>new Date().toISOString());const origin=deps.origin;const checkGate=typeof deps.readGate?.check==='function'?deps.readGate.check.bind(deps.readGate):undefined;const captureOnce=typeof deps.transport?.getMarketSnapshotCapture==='function'?deps.transport.getMarketSnapshotCapture.bind(deps.transport):undefined;
 return Object.freeze({async run(value:unknown){
  if(attempted)return freeze({status:'blocked' as const,error_code:'already_attempted' as const,transport_invocations:transportInvocations});attempted=true;
  try{
   const p=Input.safeParse(plainRecord(value));if(!p.success||!['actual','synthetic'].includes(origin))fail('invalid_input');const q=Object.freeze(p.data);
   if(!checkGate)fail('read_gate_not_configured');if(!captureOnce)fail('transport_not_configured');
   let rawGate:unknown;try{rawGate=await checkGate(Object.freeze({...q,origin,purpose:'single_quote_smoke',source_url:SOURCE_URL}));}catch{fail('read_gate_rejected');}
   let g;try{g=GateDecision.safeParse(plainRecord(rawGate));}catch{fail('read_gate_rejected');}if(!g.success)fail('read_gate_rejected');const gate=g.data,authorizedAt=checkedTime(clock);
   if(gate.symbol!==q.symbol||gate.board!==q.board||gate.origin!==origin||compareInstants(gate.valid_from,authorizedAt)>0||compareInstants(authorizedAt,gate.valid_until)>0)fail('read_gate_rejected');
   let rawCapture:unknown;transportInvocations++;
   try{rawCapture=await captureOnce(q.symbol,q.board);}catch(e){if(e&&typeof e==='object'&&!types.isProxy(e)&&e instanceof SafeKisError){const c=Object.getOwnPropertyDescriptor(e,'code');if(c&&'value'in c&&SAFE_TRANSPORT_CODES.has(c.value))fail(c.value as QuoteSmokeErrorCode);}fail('transport_failed');}
   const receivedAt=checkedTime(clock);if(compareInstants(receivedAt,authorizedAt)<0)fail('clock_invalid');if(compareInstants(receivedAt,gate.valid_until)>0)fail('read_gate_rejected');let capture:Record<string,unknown>;try{capture=plainRecord(rawCapture,300000);}catch{fail('source_capture_invalid');}
   if(Object.keys(capture).sort().join(',')!=='rawResponseText,responseStatus,sourceUrl'||capture.sourceUrl!==SOURCE_URL||capture.responseStatus!==200||typeof capture.rawResponseText!=='string')fail('source_capture_invalid');
   publicJson(capture.rawResponseText);let raw;try{raw=validateProviderQuoteJson(capture.rawResponseText);}catch{fail('response_invalid');}if(raw.rt_cd!=='0'||!raw.output||typeof raw.output.stck_prpr!=='string')fail('response_invalid');if(origin==='actual'&&typeof raw.fixture_status==='string'&&/synthetic|mock|fixture/i.test(raw.fixture_status))fail('source_capture_invalid');
   let dto,envelope;try{const normalized=normalizeKrQuote(raw.output!,{symbol:q.symbol,board:q.board,receivedAt,origin});dto=QuoteSnapshotSchema.parse({...normalized,provenance:{...normalized.provenance,report_cutoff:receivedAt}});envelope=selectQuoteEnvelope(dto,['last','open','high','low','change','change_percent','volume']);}catch{fail('normalization_failed');}
   return freeze({status:'quote_capture_ready_for_local_review' as const,contract:'moai.stock.quote-smoke-packet.v1' as const,request:q,origin,report_cutoff:receivedAt,
    source:{url:SOURCE_URL,method:'GET' as const,response_status:200,received_at:receivedAt,raw_response_text:capture.rawResponseText,sha256:createHash('sha256').update(capture.rawResponseText,'utf8').digest('hex'),hash_scope:'utf8_decoded_response_text_not_original_wire_bytes' as const},dto,envelope,
    audit:{normalized_partial:dto.provenance.partial,transport_invocations:transportInvocations,automatic_retries:0,credentials_loaded_by_harness:false,token_issuance:false,operational_server_configuration_changed:false,read_gate:'trusted_host_attested_current_not_independently_authenticated' as const,source_assurance:'injected_adapter_capture_not_independent_transport_authentication' as const,html_comparison:'not_run' as const,full_actual_report_complete:false},
    warnings:['One quote capture is not a full actual financial report or independent source authentication.','Source instant, identity and rights limitations in the DTO and renderer must remain visible.','Only a separately approved existing ephemeral credential route and current entitlement check may enable an actual run.','No credentials, request headers or URL queries are included in audit fields; keep the raw public response out of logs and review it before sharing.']});
  }catch(e){const code=e instanceof SmokeError?e.code:'response_invalid';return freeze({status:transportInvocations?'failed' as const:'blocked' as const,error_code:code,transport_invocations:transportInvocations});}
 }});
}

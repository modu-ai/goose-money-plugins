import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {z} from 'zod';
import timezoneInventory from '../contracts/report-financial-reference/compatible-timezones.json' with {type:'json'};
import roles from '../contracts/report-financial-reference/reported-roles.json' with {type:'json'};
import {validateFinancialEvidenceCandidate, REPORTED_FINANCIAL_ROLES, type FinancialEvidenceCandidate} from './financial-evidence-selection.js';
import {ExactInstantSchema,compareInstants} from './exact-instant.js';

/** Internal conditional assembly, not a public tool or a production verification implementation. */
export const FINANCIAL_BRIDGE_AXES=Object.freeze(['source_authenticity','rights','identity','semantic_role','unit_scale_currency','period','accounting_basis','publication_availability','coverage_finality','revision_split'] as const);
type Axis=typeof FINANCIAL_BRIDGE_AXES[number];
const Text=z.string().min(1).max(512).refine(x=>x.trim()===x&&!/[\u0000-\u001f\u007f]/.test(x));
const Id=z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
const SHA=z.string().regex(/^[a-f0-9]{64}$/);
const Day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s+'T00:00:00Z');return Number(s.slice(0,4))>=1&&Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===s;});
const Locator=z.string().min(1).max(512).refine(s=>{try {const u=new URL(s);return ['https:','synthetic:'].includes(u.protocol)&&!u.username&&!u.password&&!/[\u0000-\u0020\u007f]/.test(s);}catch{return false;}});
const Refs=z.array(Id).min(1).max(32).refine(a=>new Set(a).size===a.length);
const EvidenceRefs=z.object({source_authenticity:Refs,rights:Refs,identity:Refs,semantic_role:Refs,unit_scale_currency:Refs,period:Refs,accounting_basis:Refs,publication_availability:Refs,coverage_finality:Refs,revision_split:Refs}).strict();
const Scale=z.string().max(26).regex(/^(?:10{0,12}|0\.0{0,11}1)$/);
const Period=z.object({kind:z.enum(['FY','TTM','quarter','YTD','instant']),start:Day,end:Day,label:Text}).strict();
const Basis=z.object({scope:z.enum(['consolidated','standalone']),standard:z.enum(['US-GAAP','IFRS','K-IFRS','K-GAAP']),revision_basis:Text,split_basis:Text,methodology_id:Text,
 cash_sign:z.literal('positive_outflow').optional(),lease_cash_payments:z.enum(['included','excluded']).optional(),acquisition_cash_payments:z.enum(['included','excluded']).optional(),lease_liabilities:z.enum(['included','excluded']).optional()}).strict();
const Artifact=z.object({id:Id,data_kind:z.enum(['actual','synthetic']),digest_kind:z.enum(['original_bytes','review_record','synthetic_fixture']),sha256:SHA,locator:Locator,
 snapshot:z.object({name:z.enum(['financial','filings']),sha256:SHA,received_at:ExactInstantSchema}).strict().nullable()}).strict();
export const FinancialFactBindingSchema=z.object({
 contract:z.literal('moai.financial.fact-binding.v1'),role:z.enum(REPORTED_FINANCIAL_ROLES),provider_issuer_id:Text,
 identity:z.object({issuer_id:Text,security_id:Text,share_class:Text,venue:Text,population:Text}).strict(),
 unit:z.object({currency:z.string().regex(/^(?:[A-Z]{3}|not_applicable)$/),scale:Scale,
   source_currency_interpretation:z.enum(['quantity_currency','statement_currency_not_quantity_unit'])}).strict(),
 basis:Basis,period:Period,date_timezone:Text,
 published_at:ExactInstantSchema,available_at:ExactInstantSchema,
 publication_basis:z.literal('explicit_publication_evidence_not_receipt_or_acceptance_substitution'),
 finality:z.literal('final'),coverage:z.literal('complete_selected_fact_not_complete_api_collection'),
 document_id:Text,revision_id:Text,value_source_artifact_id:Id,
 rights:z.object({purpose:z.literal('private_owner_research_report'),valid_from:ExactInstantSchema,valid_until:ExactInstantSchema}).strict(),
 evidence:EvidenceRefs,artifacts:z.array(Artifact).min(2).max(100),
}).strict();
export type FinancialFactBinding=z.infer<typeof FinancialFactBindingSchema>;
const Decision=z.object({contract:z.literal('moai.financial.verifier-decision.v1'),input_sha256:SHA,adapter_id:Id,
 data_kind:z.enum(['actual','synthetic']),confirmed:EvidenceRefs}).strict();
export interface FinancialVerificationContext {
 readonly contract:'moai.financial.verification-request.v1';
 readonly input_sha256:string;
 readonly candidate:FinancialEvidenceCandidate;
 readonly binding:FinancialFactBinding;
}
/** MUST be supplied by separately trusted host code. Never deserialize a verifier from input.
 * No production adapter is shipped/configured. IDs, hashes and successful schema checks do not authenticate it.
 */
export interface TrustedFinancialVerifier {
 readonly adapter_id:string;
 readonly mode:'synthetic_test_only'|'external_trusted_verification';
 verify(context:Readonly<FinancialVerificationContext>):Promise<unknown>;
}
export type FinancialBridgeErrorCode='invalid_binding'|'input_too_large'|'invalid_plain_json'|'role_mismatch'|'unsupported_direct_mapping'|'issuer_mismatch'|'source_value_unavailable'|'invalid_decimal'|'source_unit_mismatch'|'period_mismatch'|'accounting_basis_mismatch'|'invalid_chronology'|'source_evidence_mismatch'|'verification_not_configured'|'actual_verifier_required'|'verification_failed'|'verification_mismatch'|'rights_outside_window'|'invalid_handoff'|'handoff_mismatch';
export class FinancialBridgeError extends Error {constructor(readonly code:FinancialBridgeErrorCode){super(code);this.name='FinancialBridgeError';}}
function fail(c:FinancialBridgeErrorCode):never{throw new FinancialBridgeError(c);}
function must(v:unknown,c:FinancialBridgeErrorCode):asserts v{if(!v)fail(c);}
/** Descriptor-only snapshot: no getters, Proxy traps, toJSON, sparse arrays or custom instances. */
function snapshot(value:unknown,limits={nodes:30000,depth:8,bytes:300000,array:1000}):unknown {
 let nodes=0,bytes=0;const seen=new Set<object>();
 function walk(v:unknown,depth:number):unknown {
  if(++nodes>limits.nodes||depth>limits.depth||(bytes+=16)>limits.bytes)fail('input_too_large');
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'){must(Number.isFinite(v),'invalid_plain_json');return v;}
  if(typeof v==='string'){if(v.length>Math.min(limits.bytes,100000))fail('input_too_large');must(Buffer.from(v,'utf8').toString('utf8')===v&&!/[\u202a-\u202e\u2066-\u2069]/.test(v),'invalid_plain_json');bytes+=Buffer.byteLength(JSON.stringify(v));if(bytes>limits.bytes)fail('input_too_large');return v;}
  must(typeof v==='object'&&!types.isProxy(v)&&!seen.has(v),'invalid_plain_json');
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v);must(array?proto===Array.prototype||proto===null:proto===Object.prototype||proto===null,'invalid_plain_json');
  const len=array?Object.getOwnPropertyDescriptor(v,'length')?.value:0;must(!array||Number.isSafeInteger(len)&&len>=0,'invalid_plain_json');if(array&&len>limits.array)fail('input_too_large');
  const keys=Reflect.ownKeys(v);if(keys.length>Math.max(1001,limits.array+1))fail('input_too_large');must(!array||keys.length===len+1,'invalid_plain_json');
  const out:any=array?[]:Object.create(null);seen.add(v);
  for(const key of keys){must(typeof key==='string','invalid_plain_json');const d=Object.getOwnPropertyDescriptor(v,key);must(d&&'value'in d,'invalid_plain_json');if(array&&key==='length')continue;
   must(d.enumerable&&(!array||/^(?:0|[1-9]\d*)$/.test(key)&&Number(key)<len),'invalid_plain_json');if(key.length>100000)fail('input_too_large');bytes+=Buffer.byteLength(JSON.stringify(key));if(bytes>limits.bytes)fail('input_too_large');Object.defineProperty(out,key,{value:walk(d.value,depth+1),enumerable:true,writable:true,configurable:true});}
  seen.delete(v);return out;
 }
 return walk(value,0);
}
function freeze<T>(x:T):T{if(x&&typeof x==='object'){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;}
function stable(x:any):string{if(x===null||typeof x!=='object')return JSON.stringify(x);return Array.isArray(x)?'['+x.map(stable).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';}
function financialBridgeDigest(x:unknown):string{return createHash('sha256').update(stable(x)).digest('hex');}
/** Expand an exact SEC number lexeme, without Number(value), rounding, rescaling or sign reversal. */
export function expandFinancialDecimal(value:string):string{
 must(typeof value==='string'&&value.length<=256,'invalid_decimal');const m=/^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);must(m,'invalid_decimal');
 const exponent=Number(m[4]??'0');must(Number.isSafeInteger(exponent)&&Math.abs(exponent)<=256,'invalid_decimal');
 const digits=m[2]!+(m[3]??''),point=m[2]!.length+exponent;let result:string;
 if(point<=0){must(2-point+digits.length<=256,'invalid_decimal');result='0.'+'0'.repeat(-point)+digits;}
 else if(point>=digits.length){must(point<=256,'invalid_decimal');result=digits+'0'.repeat(point-digits.length);}
 else result=digits.slice(0,point)+'.'+digits.slice(point);
 result=result.replace(/^0+(?=\d)/,'');result=m[1]+result;must(result.length<=256,'invalid_decimal');return result;
}
const DIRECT:Readonly<Record<string,readonly string[]>>=freeze({
 'reported.revenue':['us-gaap:Revenues','us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax','ifrs-full:Revenue'],
 'reported.operating_profit':['us-gaap:OperatingIncomeLoss','ifrs-full:ProfitLossFromOperatingActivities','ifrs-full:OperatingProfitLossOperating'],
 'reported.net_income_total':['us-gaap:ProfitLoss','ifrs-full:ProfitLoss'],
 'reported.net_income_common':['us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic','ifrs-full:ProfitLossAttributableToOrdinaryEquityHoldersOfParentEntity'],
 'reported.cfo':['us-gaap:NetCashProvidedByUsedInOperatingActivities','ifrs-full:CashFlowsFromUsedInOperatingActivities'],
 'reported.cash':['us-gaap:CashAndCashEquivalentsAtCarryingValue','ifrs-full:CashAndCashEquivalents'],
 'reported.equity':['us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest','ifrs-full:Equity'],
 'reported.liabilities':['us-gaap:Liabilities','ifrs-full:Liabilities'],
 'reported.shares_weighted':['us-gaap:WeightedAverageNumberOfSharesOutstandingBasic','ifrs-full:WeightedAverageShares'],
});
freeze(roles);freeze(timezoneInventory);
const COMPATIBLE_TIMEZONES=new Set(timezoneInventory.timezones);
const INSTANT=new Set(['reported.debt','reported.cash','reported.equity','reported.liabilities','reported.equity_common_open','reported.equity_common_close']);
function localDay(instant:string,timezone:string):string{
 try{must(COMPATIBLE_TIMEZONES.has(timezone),'invalid_chronology');const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?(Z|[+-]\d\d:\d\d)$/.exec(instant);must(m,'invalid_chronology');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(m[1]!+m[2]!));
  const field=(k:string)=>parts.find(p=>p.type===k)?.value;const day=`${field('year')}-${field('month')}-${field('day')}`;must(Day.safeParse(day).success,'invalid_chronology');return day;
 }catch{fail('invalid_chronology');}
}
function checks(c:FinancialEvidenceCandidate,b:FinancialFactBinding):{value:string;role:typeof roles.roles[keyof typeof roles.roles];numeric_lexeme:string;raw_value:string}{
 must(c.requested_role===b.role,'role_mismatch');must(b.date_timezone===c.calendar_guard.timezone,'invalid_chronology');const role=roles.roles[b.role];must(role,'role_mismatch');
 const isInstant=INSTANT.has(b.role);must((b.period.kind==='instant')===isInstant&&b.period.start<=b.period.end&&(isInstant?b.period.start===b.period.end:b.period.start<b.period.end),'period_mismatch');
 must(compareInstants(b.published_at,b.available_at)<=0&&compareInstants(b.available_at,c.constituent_receipt_latest)<=0&&compareInstants(c.constituent_receipt_latest,c.cutoff)<=0,'invalid_chronology');
 for(const s of Object.values(c.snapshots))must(compareInstants(b.available_at,s.received_at)<=0,'invalid_chronology');
 must(b.period.end<=localDay(b.published_at,b.date_timezone)&&b.period.end<=localDay(c.cutoff,b.date_timezone),'invalid_chronology');
 must(compareInstants(b.rights.valid_from,b.rights.valid_until)<=0,'rights_outside_window');
 must(role.unit==='shares'?b.unit.currency==='not_applicable':/^[A-Z]{3}$/.test(b.unit.currency),'source_unit_mismatch');
 let value:string,numeric_lexeme:string,raw_value:string;
 if(c.provider==='SEC'){
  must(localDay(b.published_at,b.date_timezone)>=c.selector.filed,'invalid_chronology');
  must(b.provider_issuer_id===c.issuer.cik&&b.document_id===c.selector.accession_number,'issuer_mismatch');
  must(DIRECT[b.role]?.includes(c.selector.taxonomy+':'+c.selector.concept),'unsupported_direct_mapping');
  must(b.basis.standard===(c.selector.taxonomy==='us-gaap'?'US-GAAP':'IFRS'),'accounting_basis_mismatch');
  must(b.period.end===c.selector.end&&b.period.start===(c.selector.start??c.selector.end)&&(isInstant?c.selector.period_kind==='instant':c.selector.period_kind==='duration'),'period_mismatch');
  must(b.unit.scale==='1'&&b.unit.source_currency_interpretation==='quantity_currency'&&c.selected.unit_raw===(role.unit==='shares'?'shares':b.unit.currency),'source_unit_mismatch');
  if(c.selected.acceptance_datetime)must(compareInstants(c.selected.acceptance_datetime,b.published_at)<=0,'invalid_chronology');
  numeric_lexeme=c.selected.numeric_lexeme;raw_value=numeric_lexeme;value=expandFinancialDecimal(numeric_lexeme);
 }else{
  const filingDay=c.selector.filing.rcept_dt.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
  must(localDay(b.published_at,b.date_timezone)>=filingDay,'invalid_chronology');
  must(b.provider_issuer_id===c.issuer.corp_code&&b.document_id===c.selector.rcept_no,'issuer_mismatch');
  const standardAccount=/^(ifrs-full|us-gaap)[_:](.+)$/.exec(c.selector.account_id);
  if(standardAccount)must(DIRECT[b.role]?.includes(standardAccount[1]+':'+standardAccount[2]),'unsupported_direct_mapping');
  must(b.basis.scope===(c.selector.fs_div==='CFS'?'consolidated':'standalone'),'accounting_basis_mismatch');
  if(c.selector.sj_div==='BS')must(isInstant,'period_mismatch');
  if(['IS','CIS','CF'].includes(c.selector.sj_div))must(!isInstant,'period_mismatch');
  if(c.selected.amount_kind==='current'&&c.selected.provider_current_period_kind==='three_months')must(b.period.kind==='quarter','period_mismatch');
  must(role.unit==='shares'?b.unit.source_currency_interpretation==='statement_currency_not_quantity_unit':b.unit.source_currency_interpretation==='quantity_currency'&&c.selector.currency===b.unit.currency,'source_unit_mismatch');
  must(c.selected.amount.state==='value'&&c.selected.amount.decimal!==null,'source_value_unavailable');numeric_lexeme=c.selected.amount.decimal;raw_value=c.selected.amount.raw;value=expandFinancialDecimal(numeric_lexeme.replace(/^\+/, '').replace(/^(-?)0+(?=\d)/,'$1'));
 }
 if(['reported.debt','reported.cash','reported.liabilities','reported.capex','reported.shares_weighted'].includes(b.role))must(!value.startsWith('-')||/^-0(?:\.0+)?$/.test(value),'source_value_unavailable');
 if(b.role==='reported.capex')must(b.basis.cash_sign==='positive_outflow'&&b.basis.lease_cash_payments&&b.basis.acquisition_cash_payments,'invalid_binding');
 else must(b.basis.cash_sign===undefined&&b.basis.lease_cash_payments===undefined&&b.basis.acquisition_cash_payments===undefined,'invalid_binding');
 if(b.role==='reported.debt')must(b.basis.lease_liabilities,'invalid_binding');else must(b.basis.lease_liabilities===undefined,'invalid_binding');
 const artifacts=new Map(b.artifacts.map(a=>[a.id,a]));must(artifacts.size===b.artifacts.length,'source_evidence_mismatch');
 const used=new Set<string>();for(const axis of FINANCIAL_BRIDGE_AXES)for(const id of b.evidence[axis]){must(artifacts.has(id),'source_evidence_mismatch');used.add(id);}
 must(used.size===artifacts.size,'source_evidence_mismatch');
 for(const a of b.artifacts){must(a.data_kind===c.origin,'source_evidence_mismatch');if(c.origin==='actual')must(a.digest_kind!=='synthetic_fixture'&&a.locator.startsWith('https://'),'source_evidence_mismatch');
  if(a.snapshot){const source=c.snapshots[a.snapshot.name];must(a.snapshot.sha256===source.sha256&&compareInstants(a.snapshot.received_at,source.received_at)===0,'source_evidence_mismatch');}
 }
 for(const name of ['financial','filings'] as const)must(b.evidence.source_authenticity.some(id=>{const a=artifacts.get(id)!;return a.snapshot?.name===name&&(c.origin==='synthetic'?a.digest_kind==='synthetic_fixture':a.digest_kind==='original_bytes');}),'source_evidence_mismatch');
 const source=artifacts.get(b.value_source_artifact_id);must(source?.snapshot?.name==='financial'&&b.evidence.source_authenticity.includes(source.id)&&source.digest_kind===(c.origin==='actual'?'original_bytes':'synthetic_fixture'),'source_evidence_mismatch');
 return {value,role,numeric_lexeme,raw_value};
}
export async function assembleFinancialFact(candidate:unknown,binding:unknown,verifier?:TrustedFinancialVerifier,clock:()=>string=()=>new Date().toISOString()){
 const c=validateFinancialEvidenceCandidate(candidate),parsed=FinancialFactBindingSchema.safeParse(snapshot(binding));if(!parsed.success)fail('invalid_binding');const b=freeze(parsed.data);
 const {value,role,numeric_lexeme,raw_value}=checks(c,b);must(verifier,'verification_not_configured');
 const adapterId=verifier.adapter_id,mode=verifier.mode,verify=verifier.verify;must(Id.safeParse(adapterId).success&&typeof verify==='function'&&['synthetic_test_only','external_trusted_verification'].includes(mode),'verification_not_configured');
 if(c.origin==='actual')must(mode==='external_trusted_verification','actual_verifier_required');
 const input_sha256=financialBridgeDigest({candidate:c,binding:b});const context=freeze({contract:'moai.financial.verification-request.v1' as const,input_sha256,candidate:c,binding:b});
 let raw:unknown;try{raw=await verify.call(verifier,context);}catch{fail('verification_failed');}
 const checked=Decision.safeParse(snapshot(raw));must(checked.success,'verification_mismatch');const decision=checked.data;
 must(decision.adapter_id===adapterId&&decision.input_sha256===input_sha256&&decision.data_kind===c.origin,'verification_mismatch');
 for(const axis of FINANCIAL_BRIDGE_AXES)must(stable([...decision.confirmed[axis]].sort())===stable([...b.evidence[axis]].sort()),'verification_mismatch');
 const verified_at=ExactInstantSchema.parse(clock());must(compareInstants(b.rights.valid_from,verified_at)<=0&&compareInstants(verified_at,b.rights.valid_until)<=0,'rights_outside_window');must(compareInstants(c.cutoff,verified_at)<=0,'invalid_chronology');
 const artifact=b.artifacts.find(a=>a.id===b.value_source_artifact_id)!;
 const fact={fact_id:'moai:financial:'+input_sha256,concept:b.role,state:'available' as const,value,unit:role.unit,scale:b.unit.scale,currency:b.unit.currency,...b.identity,data_kind:c.origin,
  basis:{...b.basis,attribution:role.attribution,definition:role.definition},period:b.period,published_at:b.published_at,available_at:b.available_at,finality:'final' as const,coverage_complete:true,date_timezone:b.date_timezone,
  provenance:{source_id:c.provider,document_id:b.document_id,locator:artifact.locator,revision_id:b.revision_id,source_sha256:artifact.sha256,selector_id:'sha256:'+financialBridgeDigest(c.selector),semantic_binding_verified:true,data_kind:c.origin}};
 return freeze({contract:'moai.financial.report-fact-handoff.v1' as const,status:c.origin==='synthetic'?'synthetic_fact_ready':'fact_ready_under_external_trusted_verifier',fact,
  verification:{input_sha256,adapter_id:adapterId,mode,verified_at,assurance:'trusted_adapter_attestation_not_independent_host_authentication' as const,confirmed:decision.confirmed},
  lineage:{numeric_lexeme,raw_value,candidate_sha256:financialBridgeDigest(c),financial_snapshot_sha256:c.snapshots.financial.sha256,filings_snapshot_sha256:c.snapshots.filings.sha256,artifacts:b.artifacts},
  rights:b.rights,inputs:{candidate:c,binding:b},report_runtime:{version:roles.runtime_version,sha256:roles.runtime_sha256},warnings:['No verifier is configured by this library; host trust must be established separately.','Candidate/DTO hashes alone do not authenticate sources or grant rights.','The consumer must apply the pinned report runtime and cross-fact metric guards.','No rescaling, sign reversal, component aggregation, latest selection or actual API call occurs.']});
}

const VerificationReceipt=z.object({input_sha256:SHA,adapter_id:Id,mode:z.enum(['synthetic_test_only','external_trusted_verification']),verified_at:ExactInstantSchema,
 assurance:z.literal('trusted_adapter_attestation_not_independent_host_authentication'),confirmed:EvidenceRefs}).strict();
export const FinancialFactHandoffEnvelopeSchema=z.object({contract:z.literal('moai.financial.report-fact-handoff.v1'),status:z.enum(['synthetic_fact_ready','fact_ready_under_external_trusted_verifier']),
 fact:z.unknown(),verification:VerificationReceipt,lineage:z.unknown(),rights:z.unknown(),inputs:z.object({candidate:z.unknown(),binding:z.unknown()}).strict(),report_runtime:z.unknown(),warnings:z.unknown()}).strict();
/** Serialized flags never establish trust. Reconstruct and compare every deterministic field,
 * and require a fresh separately trusted verifier/clock before returning a replacement receipt.
 * This can invoke the verifier before discovering a tampered deterministic output field.
 */
export async function reverifyFinancialFactHandoff(value:unknown,verifier?:TrustedFinancialVerifier,clock:()=>string=()=>new Date().toISOString()){
 const parsed=FinancialFactHandoffEnvelopeSchema.safeParse(snapshot(value,{nodes:300000,depth:20,bytes:16000000,array:20000}));must(parsed.success,'invalid_handoff');const old=parsed.data;
 const fresh=await assembleFinancialFact(old.inputs.candidate,old.inputs.binding,verifier,clock);
 for(const key of ['contract','status','fact','lineage','rights','inputs','report_runtime','warnings'] as const)must(stable(old[key])===stable(fresh[key]),'handoff_mismatch');
 must(old.verification.input_sha256===fresh.verification.input_sha256,'handoff_mismatch');
 if(fresh.fact.data_kind==='actual')must(old.verification.mode==='external_trusted_verification','handoff_mismatch');
 for(const axis of FINANCIAL_BRIDGE_AXES)must(stable([...old.verification.confirmed[axis]].sort())===stable([...fresh.verification.confirmed[axis]].sort()),'handoff_mismatch');
 must(compareInstants(fresh.inputs.candidate.cutoff,old.verification.verified_at)<=0&&compareInstants(old.verification.verified_at,fresh.verification.verified_at)<=0&&compareInstants(fresh.rights.valid_from,old.verification.verified_at)<=0&&compareInstants(old.verification.verified_at,fresh.rights.valid_until)<=0,'handoff_mismatch');
 return fresh;
}

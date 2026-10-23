import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {z} from 'zod';
import {validateFinancialEvidenceCandidate} from './financial-evidence-selection.js';
import {expandFinancialDecimal} from './financial-fact-bridge.js';
import {ExactInstantSchema,compareInstants} from './exact-instant.js';

/** Finite raw arithmetic plans, NOT canonical financial mappings or completeness claims. */
const policies={
 'us-gaap.ppe-plus-intangibles.v1':{role:'reported.capex',taxonomy:'us-gaap',period:'duration',components:{ppe:'PaymentsToAcquirePropertyPlantAndEquipment',intangibles:'PaymentsToAcquireIntangibleAssets'}},
 'ifrs-full.ppe-plus-intangibles.v1':{role:'reported.capex',taxonomy:'ifrs-full',period:'duration',components:{ppe:'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',intangibles:'PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities'}},
 'us-gaap.short-plus-long-debt.v1':{role:'reported.debt',taxonomy:'us-gaap',period:'instant',components:{short_term:'ShortTermBorrowings',long_all_maturities:'LongTermDebt'}},
 'us-gaap.short-plus-current-plus-noncurrent-debt.v1':{role:'reported.debt',taxonomy:'us-gaap',period:'instant',components:{short_term:'ShortTermBorrowings',long_current:'LongTermDebtCurrent',long_noncurrent:'LongTermDebtNoncurrent'}},
 'ifrs-full.current-plus-noncurrent-borrowings.v1':{role:'reported.debt',taxonomy:'ifrs-full',period:'instant',components:{current_combined:'CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings',noncurrent:'LongtermBorrowings'}},
} as const;
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
export const FINANCIAL_COMPONENT_POLICIES=freeze(policies);
const Policy=z.enum(Object.keys(policies) as [keyof typeof policies,...(keyof typeof policies)[]]);
const Component=z.string().regex(/^[a-z][a-z_]{0,63}$/);
const Request=z.object({policy_id:Policy,destination_role:z.enum(['reported.capex','reported.debt']),cutoff:ExactInstantSchema}).strict();
export const FinancialComponentDerivationInputSchema=z.object({contract:z.literal('moai.financial.component-derivation-input.v1'),request:Request,
 leaves:z.array(z.object({component_id:Component,candidate:z.unknown()}).strict()).min(2).max(3)}).strict();
export type FinancialDerivationErrorCode='invalid_input'|'invalid_plain_json'|'input_too_large'|'policy_mismatch'|'unsupported_provider'|'component_set_mismatch'|'duplicate_evidence'|'source_context_mismatch'|'source_unit_mismatch'|'negative_component'|'arithmetic_limit'|'invalid_candidate'|'candidate_mismatch';
export class FinancialDerivationError extends Error{constructor(readonly code:FinancialDerivationErrorCode){super(code);this.name='FinancialDerivationError';}}
function fail(code:FinancialDerivationErrorCode):never{throw new FinancialDerivationError(code);}
function must(v:unknown,c:FinancialDerivationErrorCode):asserts v{if(!v)fail(c);}
function snapshot(value:unknown):unknown{
 let nodes=0,bytes=0;const active=new Set<object>();
 function walk(v:unknown,depth:number):unknown{
  if(++nodes>300000||depth>24||(bytes+=16)>24000000)fail('input_too_large');
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'){must(Number.isFinite(v),'invalid_plain_json');return v;}
  if(typeof v==='string'){if(v.length>100000)fail('input_too_large');must(Buffer.from(v,'utf8').toString('utf8')===v&&!/[\u202a-\u202e\u2066-\u2069]/.test(v),'invalid_plain_json');bytes+=Buffer.byteLength(JSON.stringify(v));if(bytes>24000000)fail('input_too_large');return v;}
  must(typeof v==='object'&&!types.isProxy(v)&&!active.has(v),'invalid_plain_json');const array=Array.isArray(v),proto=Object.getPrototypeOf(v);must(array?proto===Array.prototype||proto===null:proto===Object.prototype||proto===null,'invalid_plain_json');
  const len=array?Object.getOwnPropertyDescriptor(v,'length')?.value:0;must(!array||Number.isSafeInteger(len)&&len>=0,'invalid_plain_json');if(array&&len>20000)fail('input_too_large');const keys=Reflect.ownKeys(v);if(keys.length>20001)fail('input_too_large');must(!array||keys.length===len+1,'invalid_plain_json');active.add(v);const out:any=array?[]:Object.create(null);
  for(const key of keys){must(typeof key==='string','invalid_plain_json');must(Buffer.from(key,'utf8').toString('utf8')===key&&!/[\u202a-\u202e\u2066-\u2069]/.test(key),'invalid_plain_json');const d=Object.getOwnPropertyDescriptor(v,key);must(d&&'value'in d,'invalid_plain_json');if(array&&key==='length')continue;must(d.enumerable&&(!array||/^(?:0|[1-9]\d*)$/.test(key)&&Number(key)<len),'invalid_plain_json');if(key.length>100000)fail('input_too_large');bytes+=Buffer.byteLength(JSON.stringify(key));if(bytes>24000000)fail('input_too_large');Object.defineProperty(out,key,{value:walk(d.value,depth+1),enumerable:true,writable:true,configurable:true});}
  active.delete(v);return out;
 }return walk(value,0);
}
function stable(v:any):string{return v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';}
function hash(v:unknown):string{return createHash('sha256').update(stable(v)).digest('hex');}
function exactNonnegativeSum(values:string[]){
 const decimals=values.map(v=>{let x:string;try{x=expandFinancialDecimal(v);}catch{fail('arithmetic_limit');}must(!x.startsWith('-')||/^-0(?:\.0+)?$/.test(x),'negative_component');const [whole,fraction='']=x.replace(/^-/,'').split('.');return {whole:whole!,fraction};});
 const places=Math.max(...decimals.map(d=>d.fraction.length));let total=0n;
 for(const d of decimals)total+=BigInt(d.whole+d.fraction.padEnd(places,'0'));
 const digits=total.toString().padStart(places+1,'0');const decimal=places?digits.slice(0,-places)+'.'+digits.slice(-places):digits;must(decimal.length<=512,'arithmetic_limit');
 return {decimal,unscaled_integer:total.toString(),fractional_digits:places};
}
export function createFinancialDerivationCandidate(value:unknown){
 const parsed=FinancialComponentDerivationInputSchema.safeParse(snapshot(value));must(parsed.success,'invalid_input');const q=parsed.data,p=policies[q.request.policy_id];must(q.request.destination_role===p.role,'policy_mismatch');
 const expected=Object.keys(p.components);must(q.leaves.length===expected.length&&new Set(q.leaves.map(x=>x.component_id)).size===q.leaves.length&&q.leaves.every(x=>expected.includes(x.component_id)),'component_set_mismatch');
 const leaves=expected.map(component_id=>{const candidate=validateFinancialEvidenceCandidate(q.leaves.find(x=>x.component_id===component_id)!.candidate);must(candidate.provider==='SEC','unsupported_provider');
  must(candidate.requested_role===p.role&&candidate.selector.taxonomy===p.taxonomy&&candidate.selector.concept===(p.components as Record<string,string>)[component_id]&&candidate.selector.period_kind===p.period,'policy_mismatch');
  must(compareInstants(candidate.cutoff,q.request.cutoff)===0,'source_context_mismatch');must(/^[A-Z]{3}$/.test(candidate.selector.unit_raw),'source_unit_mismatch');
  return {component_id,candidate,candidate_sha256:hash(candidate)};
 });
 must(new Set(leaves.map(x=>x.candidate_sha256)).size===leaves.length,'duplicate_evidence');const first=leaves[0]!.candidate;
 for(const {candidate:c} of leaves){
  must(c.origin===first.origin&&c.issuer.cik===first.issuer.cik&&stable(c.calendar_guard)===stable(first.calendar_guard)&&c.snapshots.filings.sha256===first.snapshots.filings.sha256,'source_context_mismatch');
  for(const key of ['accession_number','start','end','period_kind','filed','fiscal_year','fiscal_period','form','frame'] as const)must(c.selector[key]===first.selector[key],'source_context_mismatch');
  must(c.selector.unit_raw===first.selector.unit_raw,'source_unit_mismatch');
 }
 const arithmetic=exactNonnegativeSum(leaves.map(x=>x.candidate.selected.numeric_lexeme));
 const request=freeze(q.request);const input_sha256=hash({request,leaves});
 return freeze({contract:'moai.financial.component-derivation-candidate.v1' as const,status:'raw_arithmetic_candidate_only' as const,request,origin:first.origin,input_sha256,leaves,
  operation:{kind:'sum' as const,component_order:expected,sign_policy:'require_nonnegative_no_abs_or_sign_flip' as const,missing_policy:'reject_no_implicit_zero' as const,rounding:'none' as const},
  raw_arithmetic:{...arithmetic,source_unit_label:first.selector.unit_raw,unit_status:'source_label_equal_not_verified_canonical_unit' as const,scale_policy:'source_numeric_lexemes_only_no_rescaling' as const,representation:'max_input_fractional_digits_not_measurement_precision' as const},
  source_context:{provider:'SEC' as const,cik:first.issuer.cik,accession_number:first.selector.accession_number,period_start:first.selector.start,period_end:first.selector.end,period_kind:first.selector.period_kind,filings_snapshot_sha256:first.snapshots.filings.sha256,
   constituent_receipt_latest:leaves.flatMap(x=>[x.candidate.snapshots.financial.received_at,x.candidate.snapshots.filings.received_at]).reduce((a,b)=>compareInstants(a,b)>=0?a:b)},
  canonical_fact:null,metric_ready:false as const,semantic_binding_verified:false as const,unit_scale:null,accounting_basis:null,published_at:null,available_at:null,rights_status:'pending' as const,coverage_complete:false as const,component_disjointness_verified:false as const,
  unresolved:['source_authenticity_and_original_bytes_linkage','issuer_security_and_common_scope','unit_scale_and_currency_semantics','period_and_accounting_basis','component_disjointness_and_complete_coverage','publication_availability_and_finality','revision_and_split_basis','current_use_rights','reviewed_derivation_to_report_fact_contract'],
  warnings:['Exact arithmetic over supplied source lexemes is not a canonical financial amount or a metric-ready reported fact.','Finite tag compatibility does not prove issuer applicability, accounting scope, complete components or non-overlap.','No zero-fill, aggregation across filings/issuers/currencies, sign reversal, FX conversion, canonical scaling or live request occurs.','PPE plus intangibles is not verified full capex; borrowing sums are not verified complete interest-bearing debt.','A scalar and primary-document citation alone cannot encode this derivation. Preserve all leaves and recompute before any future reviewed promotion.']});
}
export type FinancialDerivationCandidate=ReturnType<typeof createFinancialDerivationCandidate>;
const SHA=z.string().regex(/^[a-f0-9]{64}$/),Day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Structural only. Must use validateFinancialDerivationCandidate for complete reconstruction. */
export const FinancialComponentDerivationEnvelopeSchema=z.object({
 contract:z.literal('moai.financial.component-derivation-candidate.v1'),status:z.literal('raw_arithmetic_candidate_only'),request:Request,origin:z.enum(['actual','synthetic']),input_sha256:SHA,
 leaves:z.array(z.object({component_id:Component,candidate:z.unknown(),candidate_sha256:SHA}).strict()).min(2).max(3),
 operation:z.object({kind:z.literal('sum'),component_order:z.array(Component).min(2).max(3),sign_policy:z.literal('require_nonnegative_no_abs_or_sign_flip'),missing_policy:z.literal('reject_no_implicit_zero'),rounding:z.literal('none')}).strict(),
 raw_arithmetic:z.object({decimal:z.string().max(512).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),unscaled_integer:z.string().max(512).regex(/^(?:0|[1-9]\d*)$/),fractional_digits:z.number().int().min(0).max(254),source_unit_label:z.string().regex(/^[A-Z]{3}$/),unit_status:z.literal('source_label_equal_not_verified_canonical_unit'),scale_policy:z.literal('source_numeric_lexemes_only_no_rescaling'),representation:z.literal('max_input_fractional_digits_not_measurement_precision')}).strict(),
 source_context:z.object({provider:z.literal('SEC'),cik:z.string().regex(/^\d{10}$/),accession_number:z.string().regex(/^\d{10}-\d{2}-\d{6}$/),period_start:Day.nullable(),period_end:Day,period_kind:z.enum(['instant','duration']),filings_snapshot_sha256:SHA,constituent_receipt_latest:ExactInstantSchema}).strict(),
 canonical_fact:z.null(),metric_ready:z.literal(false),semantic_binding_verified:z.literal(false),unit_scale:z.null(),accounting_basis:z.null(),published_at:z.null(),available_at:z.null(),rights_status:z.literal('pending'),coverage_complete:z.literal(false),component_disjointness_verified:z.literal(false),
 unresolved:z.array(z.string().max(200)).length(9),warnings:z.array(z.string().max(1000)).length(5),
}).strict();
export function validateFinancialDerivationCandidate(value:unknown):FinancialDerivationCandidate{
 const bounded=snapshot(value),parsed=FinancialComponentDerivationEnvelopeSchema.safeParse(bounded);must(parsed.success,'invalid_candidate');const q=parsed.data;
 const expected=createFinancialDerivationCandidate({contract:'moai.financial.component-derivation-input.v1',request:q.request,leaves:q.leaves.map(x=>({component_id:x.component_id,candidate:x.candidate}))});
 must(stable(bounded)===stable(expected),'candidate_mismatch');return expected;
}

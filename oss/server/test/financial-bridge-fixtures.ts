import {selectSecFinancialEvidence,selectDartFinancialEvidence,type FinancialEvidenceCandidate} from '../src/financial-evidence-selection.js';
import {FINANCIAL_BRIDGE_AXES,type FinancialFactBinding,type TrustedFinancialVerifier} from '../src/financial-fact-bridge.js';
import {secFixture,dartFixture} from './financial-selection-fixtures.js';
export const VERIFIED='2026-10-22T01:00:00.000000001Z';
export function bindingFixture(c:FinancialEvidenceCandidate):FinancialFactBinding {
 const sec=c.provider==='SEC';
 const evidence=Object.fromEntries(FINANCIAL_BRIDGE_AXES.map(axis=>[axis,axis==='source_authenticity'?['financial-source','filing-source']:['synthetic-review']])) as FinancialFactBinding['evidence'];
 const artifacts:FinancialFactBinding['artifacts']=(['financial','filings'] as const).map((name,i)=>({id:i?'filing-source':'financial-source',data_kind:'synthetic',digest_kind:'synthetic_fixture',sha256:(i?'b':'a').repeat(64),locator:'synthetic://fixture/'+name,snapshot:{name,sha256:c.snapshots[name].sha256,received_at:c.snapshots[name].received_at}}));
 artifacts.push({id:'synthetic-review',data_kind:'synthetic',digest_kind:'synthetic_fixture',sha256:'c'.repeat(64),locator:'synthetic://fixture/review',snapshot:null});
 return {contract:'moai.financial.fact-binding.v1',role:c.requested_role,provider_issuer_id:sec?c.issuer.cik:c.issuer.corp_code,
 identity:{issuer_id:'synthetic:issuer:1',security_id:'synthetic:security:1',share_class:'ordinary-common',venue:'SYNTHETIC',population:'same-issuer-common-shares'},
 unit:{currency:'USD',scale:'1',source_currency_interpretation:'quantity_currency'},basis:{scope:'consolidated',standard:sec?'US-GAAP':'K-IFRS',revision_basis:'synthetic-original',split_basis:'synthetic-unadjusted',methodology_id:'synthetic-policy-1'},
 period:sec?{kind:'FY',start:'2025-01-01',end:'2025-12-31',label:'SYNTHETIC FY2025'}:{kind:'quarter',start:'2025-04-01',end:'2025-06-30',label:'SYNTHETIC Q2'},date_timezone:'UTC',
 published_at:sec?'2026-02-10T15:30:01.000000001Z':'2025-08-14T12:00:00Z',available_at:sec?'2026-02-10T15:30:02Z':'2025-08-14T12:01:00Z',publication_basis:'explicit_publication_evidence_not_receipt_or_acceptance_substitution',
 finality:'final',coverage:'complete_selected_fact_not_complete_api_collection',document_id:sec?c.selector.accession_number:c.selector.rcept_no,revision_id:'synthetic-revision-1',value_source_artifact_id:'financial-source',
 rights:{purpose:'private_owner_research_report',valid_from:'2026-10-22T00:00:00Z',valid_until:'2026-10-23T00:00:00Z'},evidence,artifacts};
}
export const syntheticVerifier:TrustedFinancialVerifier={adapter_id:'synthetic-test-verifier',mode:'synthetic_test_only',async verify(q){return {contract:'moai.financial.verifier-decision.v1',input_sha256:q.input_sha256,adapter_id:'synthetic-test-verifier',data_kind:q.candidate.origin,confirmed:q.binding.evidence};}};
export async function bridgeFixture(kind:'SEC'|'opendart'='SEC'){const c=kind==='SEC'?selectSecFinancialEvidence(await secFixture()):selectDartFinancialEvidence(dartFixture());return {c,b:bindingFixture(c)};}
export const SEC_DIRECT_FIXTURE_ROLES={
 'reported.revenue':'Revenues','reported.operating_profit':'OperatingIncomeLoss','reported.net_income_total':'ProfitLoss',
 'reported.net_income_common':'NetIncomeLossAvailableToCommonStockholdersBasic','reported.cfo':'NetCashProvidedByUsedInOperatingActivities',
 'reported.cash':'CashAndCashEquivalentsAtCarryingValue','reported.equity':'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
 'reported.liabilities':'Liabilities','reported.shares_weighted':'WeightedAverageNumberOfSharesOutstandingBasic',
} as const;
export async function secRoleFixture(role:keyof typeof SEC_DIRECT_FIXTURE_ROLES,value='1000'){
 const q=await secFixture(),concept=SEC_DIRECT_FIXTURE_ROLES[role];q.requested_role=role;q.selector.concept=concept;q.concept_result.request.concept=concept;q.concept_result.concept=concept;q.concept_result.source_url=q.concept_result.source_url.replace('/Revenues.json','/'+concept+'.json');
 q.concept_result.facts[0]!.numeric_lexeme=value;
 const instant=['reported.cash','reported.equity','reported.liabilities'].includes(role);
 if(instant){q.selector.start=null;q.selector.period_kind='instant';q.concept_result.facts[0]!.start=null;q.concept_result.facts[0]!.period_kind='instant';}
 if(role==='reported.shares_weighted'){q.selector.unit_raw='shares';q.concept_result.facts[0]!.unit_raw='shares';}
 const c=selectSecFinancialEvidence(q),b=bindingFixture(c);
 if(instant)b.period={kind:'instant',start:'2025-12-31',end:'2025-12-31',label:'SYNTHETIC balance'};
 if(role==='reported.shares_weighted')b.unit.currency='not_applicable';
 return {c,b};
}
import {parseOpenDartFullStatement} from '../src/opendart.js';
import {REPORTED_FINANCIAL_ROLES} from '../src/financial-evidence-selection.js';
export function dartRoleFixture(role:typeof REPORTED_FINANCIAL_ROLES[number],amount='+0001000.2500'){
 const q=dartFixture();q.requested_role=role;const raw=q.statement_result.rows[0]!.raw;
 const instant=['reported.debt','reported.cash','reported.equity','reported.liabilities','reported.equity_common_open','reported.equity_common_close'].includes(role);
 raw.account_id='-';raw.account_nm='SYNTHETIC issuer-specific '+role;raw.account_detail='SYNTHETIC exact semantic review required';raw.sj_div=instant?'BS':['reported.cfo','reported.capex'].includes(role)?'CF':'IS';raw.thstrm_amount=amount;
 q.selector.account_id=raw.account_id;q.selector.account_nm=raw.account_nm;q.selector.account_detail=raw.account_detail;q.selector.sj_div=raw.sj_div;
 q.statement_result=parseOpenDartFullStatement(q.statement_result.request,{status:'000',message:'SYNTHETIC ONLY',list:[raw]},q.statement_result.provenance);
 const c=selectDartFinancialEvidence(q),b=bindingFixture(c);
 if(instant)b.period={kind:'instant',start:'2025-06-30',end:'2025-06-30',label:'SYNTHETIC balance'};
 if(raw.sj_div==='CF')b.period={kind:'YTD',start:'2025-01-01',end:'2025-06-30',label:'SYNTHETIC cumulative cash flows'};
 if(role==='reported.shares_weighted'){b.unit.currency='not_applicable';b.unit.source_currency_interpretation='statement_currency_not_quantity_unit';}
 if(role==='reported.capex'){b.basis.cash_sign='positive_outflow';b.basis.lease_cash_payments='excluded';b.basis.acquisition_cash_payments='excluded';}
 if(role==='reported.debt')b.basis.lease_liabilities='included';
 return {c,b};
}

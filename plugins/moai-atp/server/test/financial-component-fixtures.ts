import {FINANCIAL_COMPONENT_POLICIES} from '../src/financial-component-derivation.js';
import {selectSecFinancialEvidence,type SecFinancialSelectionInput} from '../src/financial-evidence-selection.js';
import {secFixture,CUTOFF} from './financial-selection-fixtures.js';
export async function componentFixture(policy_id:keyof typeof FINANCIAL_COMPONENT_POLICIES='us-gaap.ppe-plus-intangibles.v1',values:string[]=['100.00','20.000','3'],edit?:(q:SecFinancialSelectionInput,index:number)=>void){
 const p=FINANCIAL_COMPONENT_POLICIES[policy_id];let index=0;const leaves=[];
 for(const [component_id,concept] of Object.entries(p.components)){
  const q=await secFixture();q.requested_role=p.role;q.selector.taxonomy=p.taxonomy;q.selector.concept=concept;
  q.concept_result.request.taxonomy=p.taxonomy;q.concept_result.request.concept=concept;q.concept_result.taxonomy=p.taxonomy;q.concept_result.concept=concept;
  q.concept_result.source_url=`https://data.sec.gov/api/xbrl/companyconcept/CIK0000000001/${p.taxonomy}/${concept}.json`;
  q.concept_result.facts[0]!.numeric_lexeme=values[index]!;
  if(p.period==='instant'){q.selector.start=null;q.selector.period_kind='instant';q.concept_result.facts[0]!.start=null;q.concept_result.facts[0]!.period_kind='instant';}
  edit?.(q,index);index++;leaves.push({component_id,candidate:selectSecFinancialEvidence(q)});
 }
 return {contract:'moai.financial.component-derivation-input.v1' as const,request:{policy_id,destination_role:p.role,cutoff:CUTOFF},leaves};
}

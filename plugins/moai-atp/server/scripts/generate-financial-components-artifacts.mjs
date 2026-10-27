import {writeFile,mkdir} from 'node:fs/promises';
import {z} from 'zod';
import {FinancialComponentDerivationInputSchema,FinancialComponentDerivationEnvelopeSchema,FINANCIAL_COMPONENT_POLICIES,createFinancialDerivationCandidate} from '../dist/src/financial-component-derivation.js';
import {componentFixture} from '../dist/test/financial-component-fixtures.js';
await mkdir('contracts/financial-components',{recursive:true});await mkdir('fixtures/financial-components',{recursive:true});
const write=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n');
await write('contracts/financial-components/input-v1.schema.json',z.toJSONSchema(FinancialComponentDerivationInputSchema));
await write('contracts/financial-components/candidate-envelope-v1.schema.json',z.toJSONSchema(FinancialComponentDerivationEnvelopeSchema));
await write('contracts/financial-components/policies-v1.json',FINANCIAL_COMPONENT_POLICIES);
for(const policy_id of Object.keys(FINANCIAL_COMPONENT_POLICIES)){const q=await componentFixture(policy_id);await write(`fixtures/financial-components/${policy_id}.input.json`,q);await write(`fixtures/financial-components/${policy_id}.candidate.json`,createFinancialDerivationCandidate(q));}

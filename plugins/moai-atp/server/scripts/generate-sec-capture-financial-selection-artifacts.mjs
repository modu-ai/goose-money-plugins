/** Deterministic synthetic fixtures and structural schemas. No network, transport, clock or credentials. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { SecCaptureFinancialSelectionInputSchema, SecCaptureFinancialEvidenceCandidateSchema, selectSecCaptureFinancialEvidence } from '../dist/src/sec-capture-financial-selection.js';
import { captureFinancialFixture } from '../dist/test/sec-capture-financial-selection-fixtures.js';
for(const [name,schema] of [['sec-capture-financial-selection-input-v1',SecCaptureFinancialSelectionInputSchema],['sec-capture-financial-evidence-candidate-v1',SecCaptureFinancialEvidenceCandidateSchema]]){
 const document=z.toJSONSchema(schema,{target:'draft-2020-12'});
 document.$comment='STRUCTURE ONLY. This schema cannot establish source authentication, captured-body/independent-input reconstruction, exact chronology, local uniqueness, ordinal/filing joins, hostile-input bounds, or persisted equality. Always call selectSecCaptureFinancialEvidence or verifySecCaptureFinancialEvidenceCandidate with independent inputs and original text. The candidate is NOT a canonical financial fact and metric_eligible must remain false.';
 writeFileSync(`contracts/${name}.schema.json`,JSON.stringify(document,null,2)+'\n');
}
const dir='fixtures/sec-capture-financial-selection';mkdirSync(dir,{recursive:true});
const {body,input}=await captureFinancialFixture(),candidate=selectSecCaptureFinancialEvidence(input,body);
writeFileSync(`${dir}/synthetic-original-response.json`,body);
for(const[name,value]of[['synthetic-input',input],['synthetic-candidate',candidate]])writeFileSync(`${dir}/${name}.json`,JSON.stringify(value,null,2)+'\n');
writeFileSync(`${dir}/synthetic-invalid-candidate-numeric-tamper.json`,JSON.stringify({...candidate,selected:{...candidate.selected,numeric_lexeme:'1'}},null,2)+'\n');
writeFileSync(`${dir}/README.md`,'# Synthetic-only capture financial evidence fixtures\n\nAll entities, values and filing metadata are artificial. Original numeric text is generated directly, never through parsed-number reserialization. The capture contains 126 rows across 3 units; independent slice selection [100,110,124,125] is preserved and exact source row 110 is selected. The input retains null fiscal year/period. The candidate is noncanonical, metric-ineligible and rights-pending. The tampered candidate is intentionally structurally valid but must fail runtime reconstruction. No actual source text is packaged here.\n');

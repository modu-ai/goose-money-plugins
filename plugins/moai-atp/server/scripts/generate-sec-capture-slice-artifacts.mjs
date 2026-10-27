/** Deterministic synthetic-only artifacts; no transport, credentials or wall clock. Run after build. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { z } from 'zod';
import { SecCaptureSliceInputSchema, SecCaptureSliceResultSchema, sliceSecCompanyConceptCapture } from '../dist/src/sec-capture-slices.js';
import { syntheticCapture, captureInput } from '../dist/test/sec-capture-slices-fixtures.js';
for(const [name,schema]of [['sec-company-concept-capture-slice-input-v1',SecCaptureSliceInputSchema],['sec-company-concept-capture-slice-v1',SecCaptureSliceResultSchema]]){
 const document=z.toJSONSchema(schema,{target:'draft-2020-12'});
 document.$comment='STRUCTURE ONLY. JSON Schema omits runtime refinements, calendar/identity/cutoff checks, finite hostile-input limits, exact source-body hash, duplicate-key rejection, absolute source ordinal/count/omission reconstruction, and full persisted equality. Use sliceSecCompanyConceptCapture and verifySecCompanyConceptCaptureSlice with independent expectations and separately supplied original source text. No authentication or financial eligibility is established.';
 writeFileSync(`contracts/${name}.schema.json`,JSON.stringify(document,null,2)+'\n');
}
mkdirSync('fixtures/sec-capture-slices',{recursive:true});
const body=syntheticCapture(),input=captureInput(body),result=sliceSecCompanyConceptCapture(input,body);
writeFileSync('fixtures/sec-capture-slices/synthetic-original-response.json',body);
for(const [name,value]of [['synthetic-input',input],['synthetic-result',result]])writeFileSync(`fixtures/sec-capture-slices/${name}.json`,JSON.stringify(value,null,2)+'\n');
writeFileSync('fixtures/sec-capture-slices/synthetic-invalid-duplicate-key.json',body.replace('"cik":1','"cik":1,"\\u0063ik":1'));
writeFileSync('fixtures/sec-capture-slices/synthetic-invalid-fiscal-null-type.json',body.replace('"fy":null','"fy":"null"'));
writeFileSync('fixtures/sec-capture-slices/README.md','# Synthetic-only SEC capture fixtures\n\nAll entities, values and filings here are artificial. The raw numeric JSON is deliberately written as original fixture text, not parsed and reserialized. The valid capture contains 126 facts across 3 source units. Selection [100,110,124,125] crosses the frozen first-N boundary without rewriting it. Negative files are intentionally invalid and are not inputs to a live transport. No retained actual SEC capture is packaged in this directory.\n');

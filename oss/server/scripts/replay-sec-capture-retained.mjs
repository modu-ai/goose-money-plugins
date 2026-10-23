/** OPTIONAL LOCAL ACTUAL REPLAY. No fetch, no credentials; original texts stay at caller paths. Not a synthetic fixture. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { sliceSecCompanyConceptCapture, verifySecCompanyConceptCaptureSlice } from '../dist/src/sec-capture-slices.js';
import { requestSecCompanyConcept, requestSecSubmissions } from '../dist/src/sec-public-data.js';
import { compareInstants, ExactInstantSchema } from '../dist/src/exact-instant.js';
import { syntheticCapture, captureInput } from '../dist/test/sec-capture-slices-fixtures.js';
const [conceptPath,submissionsPath,frozenServerPath,outPath]=process.argv.slice(2);
assert.ok(conceptPath&&submissionsPath&&frozenServerPath&&outPath,'four explicit local paths required');
const conceptBody=readFileSync(conceptPath,'utf8'),submissionsBody=readFileSync(submissionsPath,'utf8');
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
assert.equal(digest(conceptBody),'4378cc0249e20299870f7471471e05367f5c0faafdcc6addf739cd9f17648145');
assert.equal(digest(submissionsBody),'c24afa8dfdd359593f193c737a5af2d49f172f81fe83b7019d7d7e2e3fc2cb5f');
const conceptReceipt='2026-10-22T05:57:37.266Z',submissionsReceipt='2026-10-22T06:18:26.640Z',cutoff='2026-10-22T06:18:26.666Z';
const input={request:{cik:'0000320193',taxonomy:'us-gaap',concept:'Assets'},selection:{kind:'source_indices',indices:[135,139,140,141,142,143,144,145]},capture:{origin:'actual',received_at:conceptReceipt,source_url:'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Assets.json',expected_body_sha256:digest(conceptBody)},cutoff,calendar_guard:{timezone:'UTC',cutoff_local_date:'2026-10-22'}};
const slice=sliceSecCompanyConceptCapture(input,conceptBody);verifySecCompanyConceptCaptureSlice(JSON.parse(JSON.stringify(slice)),input,conceptBody);
const frozen=await import(pathToFileURL(resolve(frozenServerPath,'dist/src/sec-public-data.js')).href);
const transport=(body,origin='actual')=>({origin,async send(){return {status:200,body_text:body};}});
const cq={...input.request,max_facts:100},sq={cik:input.request.cik,max_filings:100};
const legacy=await requestSecCompanyConcept(cq,transport(conceptBody),()=>conceptReceipt),oldLegacy=await frozen.requestSecCompanyConcept(cq,transport(conceptBody),()=>conceptReceipt);
const submissions=await requestSecSubmissions(sq,transport(submissionsBody),()=>submissionsReceipt),oldSubmissions=await frozen.requestSecSubmissions(sq,transport(submissionsBody),()=>submissionsReceipt);
assert.deepEqual(legacy,oldLegacy);assert.deepEqual(submissions,oldSubmissions);
const sb=syntheticCapture(),si=captureInput(sb);assert.deepEqual(await requestSecCompanyConcept({...si.request,max_facts:100},transport(sb,'synthetic'),()=>si.capture.received_at),await frozen.requestSecCompanyConcept({...si.request,max_facts:100},transport(sb,'synthetic'),()=>si.capture.received_at));
// Source parsing here is evidence-only. Adapter input always receives the unmodified original text.
const raw=JSON.parse(conceptBody,(key,value,context)=>key==='val'?{lexeme:context.source}:value),rawSub=JSON.parse(submissionsBody);
const original=Object.entries(raw.units).flatMap(([unit,rows],ui)=>rows.map((row,ri)=>({unit,ui,ri,row})));
const recent=rawSub.filings.recent;
for(const [i,f]of submissions.filings.entries())assert.deepEqual(f,{accession_number:recent.accessionNumber[i],filing_date:recent.filingDate[i],report_date:recent.reportDate[i]||null,acceptance_datetime:recent.acceptanceDateTime[i]||null,form:recent.form[i],primary_document:recent.primaryDocument[i],primary_doc_description:recent.primaryDocDescription[i]});
const matches=[];
for(const f of slice.facts){
 const source=original[f.source_index];assert.ok(source);const r=source.row;
 assert.deepEqual(f,{source_index:f.source_index,source_unit_index:source.ui,source_row_index:source.ri,unit_raw:source.unit,numeric_lexeme:r.val.lexeme,start:r.start??null,end:r.end,accession_number:r.accn,filed:r.filed,fiscal_year:r.fy??null,fiscal_period:r.fp??null,form:r.form,frame:r.frame??null,period_kind:r.start?'duration':'instant',accounting_basis:null,canonical_metric:null});
 const candidates=submissions.filings.map((row,index)=>({row,index})).filter(x=>x.row.accession_number===f.accession_number);assert.equal(candidates.length,1);const {row:filing,index}=candidates[0];
 assert.equal(filing.form,f.form);assert.equal(filing.filing_date,f.filed);assert.ok(f.end<=f.filed);if(filing.report_date!==null)assert.ok(f.end<=filing.report_date&&filing.report_date<=filing.filing_date);
 if(filing.acceptance_datetime!==null){assert.ok(ExactInstantSchema.safeParse(filing.acceptance_datetime).success);for(const instant of [conceptReceipt,submissionsReceipt,cutoff])assert.ok(compareInstants(filing.acceptance_datetime,instant)<=0);}
 assert.ok(f.filed<=conceptReceipt.slice(0,10)&&filing.filing_date<=submissionsReceipt.slice(0,10));
 matches.push({source_index:f.source_index,source_unit_index:f.source_unit_index,source_row_index:f.source_row_index,submissions_retained_index:index,accession_number:f.accession_number,unit_raw:f.unit_raw,numeric_lexeme:f.numeric_lexeme,end:f.end,filed:f.filed,form:f.form,acceptance_datetime:filing.acceptance_datetime});
}
assert.equal(matches.length,8);assert.equal(new Set(matches.map(r=>r.accession_number)).size,4);assert.equal(legacy.facts.filter(f=>submissions.filings.some(s=>s.accession_number===f.accession_number)).length,0);
const output={evidence_kind:'actual_retained_public_capture_offline_replay_not_synthetic_fixture',status:'capture_slice_and_original_metadata_cross_reference_passed',network_requests:0,concept_capture_sha256:digest(conceptBody),submissions_capture_sha256:digest(submissionsBody),concept_received_at:conceptReceipt,submissions_received_at:submissionsReceipt,cutoff,concept_total_fact_count:slice.total_fact_count,slice_selected_count:8,concept_omitted_count:slice.omitted_fact_count,distinct_matched_accessions:4,submissions_recent_count:submissions.recent_filing_count,submissions_retained_count:submissions.filings.length,submissions_omitted_recent_count:submissions.omitted_recent_count,submissions_historical_file_count:submissions.historical_file_count,legacy_first100_matched_count:0,frozen_v1_actual_concept_parity:'exact',frozen_v1_actual_submissions_parity:'exact',frozen_v1_synthetic_concept_parity:'exact',matches,source_authentication:'not_established',rights:'pending',formal_financial_candidate:'not_produced',canonical_metric:null,metric_eligibility:'not_established',limitations:['Local integrity/reconstruction only; receipt/origin/URL remain supplied capture assertions.','No source reacquisition, historical files or primary filing documents fetched.','The eight cross-references are source metadata joins, not formal financial evidence candidates.','Date labels and acceptance timestamps are not proof of publication availability.','No latest/restatement choice, completeness, accounting basis or security identity is inferred.']};
mkdirSync(outPath,{recursive:true});for(const [name,v]of [['actual-slice-input',input],['actual-slice-result',slice],['actual-replay-evidence',output]])writeFileSync(resolve(outPath,`${name}.json`),JSON.stringify(v,null,2)+'\n');
console.log(JSON.stringify(output,null,2));

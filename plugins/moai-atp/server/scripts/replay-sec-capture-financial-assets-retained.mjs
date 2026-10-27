/** Retained-public Assets replay: eight raw cross-references succeed, unsupported role remains rejected. No fetch/clock. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifySecCompanyConceptCaptureSlice } from '../dist/src/sec-capture-slices.js';
import { SecSubmissionsResultSchema } from '../dist/src/sec-public-data.js';
import { compareInstants } from '../dist/src/exact-instant.js';
import { selectSecCaptureFinancialEvidence, SecCaptureFinancialError } from '../dist/src/sec-capture-financial-selection.js';
const [bodyPath,inputPath,slicePath,submissionsPath,outputDir]=process.argv.slice(2);
assert.ok(bodyPath&&inputPath&&slicePath&&submissionsPath&&outputDir,'Five explicit local paths required: original concept text, independent slice input, persisted slice, submissions DTO, output directory');
const hash=s=>createHash('sha256').update(s).digest('hex');
const pinned={concept:'4378cc0249e20299870f7471471e05367f5c0faafdcc6addf739cd9f17648145',input:'faaa16bfaeaa85b4dbf0a066da774eaf65bfb4c8ba310da1145ed33add48f4f8',
 slice:'1933256dd4ef6c96200ab1386d1916cd08dc8e8beac8066ca54b055df997d514',submissions_dto:'67a1b30a9e36c109f7275ed939210311e17107049da5cc06196e8b90410634e7'};
function pinnedText(path,expected,max){const bytes=readFileSync(path);assert.ok(bytes.length<=max);assert.equal(hash(bytes),expected);return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
const body=pinnedText(bodyPath,pinned.concept,3_000_000),independentInput=JSON.parse(pinnedText(inputPath,pinned.input,100_000));
const c=verifySecCompanyConceptCaptureSlice(JSON.parse(pinnedText(slicePath,pinned.slice,3_000_000)),independentInput,body);
const f=SecSubmissionsResultSchema.parse(JSON.parse(pinnedText(submissionsPath,pinned.submissions_dto,3_000_000)));
assert.equal(c.concept,'Assets');assert.equal(c.request.cik,f.request.cik);assert.equal(c.capture.origin,'actual');assert.equal(f.origin,'actual');
assert.equal(c.selected_fact_count,8);assert.ok(compareInstants(f.received_at,c.cutoff)<=0);
const matches=[];
for(const row of c.facts){
 const filings=f.filings.filter(x=>x.accession_number===row.accession_number);assert.equal(filings.length,1);const filing=filings[0];
 assert.equal(filing.form,row.form);assert.equal(filing.filing_date,row.filed);assert.ok(row.end<=row.filed);
 if(filing.report_date!==null)assert.ok(row.end<=filing.report_date&&filing.report_date<=filing.filing_date);
 if(filing.acceptance_datetime!==null)for(const latest of[c.capture.received_at,f.received_at,c.cutoff])assert.ok(compareInstants(filing.acceptance_datetime,latest)<=0);
 const {source_index,source_unit_index,source_row_index,numeric_lexeme,accounting_basis,canonical_metric,...labels}=row;
 const candidateInput={requested_role:'reported.assets',cutoff:c.cutoff,calendar_guard:c.calendar_guard,
  selector:{cik:c.request.cik,taxonomy:c.taxonomy,concept:c.concept,...labels,filing:{filing_date:filing.filing_date,report_date:filing.report_date,acceptance_datetime:filing.acceptance_datetime,primary_document:filing.primary_document}},
  source_locator:{source_index,source_unit_index,source_row_index},capture_slice_input:independentInput,capture_slice_result:c,submissions_result:f};
 assert.throws(()=>selectSecCaptureFinancialEvidence(candidateInput,body),e=>e instanceof SecCaptureFinancialError&&e.code==='invalid_input');
 matches.push({source_index,source_unit_index,source_row_index,accession_number:row.accession_number,form:row.form,unit_raw:row.unit_raw,
  numeric_lexeme:row.numeric_lexeme,start:row.start,end:row.end,filed:row.filed,acceptance_datetime:filing.acceptance_datetime,
  raw_cross_reference:'passed',requested_role:'reported.assets',candidate_result:'rejected_unsupported_requested_role'});
}
const result={evidence_kind:'actual_retained_public_capture_offline_replay_not_synthetic_fixture',network_requests:0,
 status:'eight_raw_cross_references_passed_unsupported_financial_role_rejected',source_hashes:pinned,
 source_hash_scope:{concept:'decoded_response_text_utf8',input:'retained_independent_input_file_bytes',slice:'retained_slice_file_bytes',submissions_dto:'retained_dto_file_bytes_not_original_submissions_response'},
 concept_received_at:c.capture.received_at,submissions_received_at:f.received_at,cutoff:c.cutoff,selected_row_count:matches.length,
 distinct_accession_count:new Set(matches.map(x=>x.accession_number)).size,submissions_retained_count:f.filings.length,
 candidate_created:false,canonical_fact:null,metric_eligible:false,source_authentication:'not_established',rights_status:'pending',
 limitation:'Assets has no reported.assets role in the frozen 13-role vocabulary. No debt, equity, cash or other role mapping was inferred. Raw cross-reference success is not candidate or metric eligibility.',matches};
mkdirSync(outputDir,{recursive:true});writeFileSync(join(outputDir,'actual-assets-unsupported-role-replay.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({raw_rows_verified:matches.length,unsupported_role_rejections:matches.length,candidate_created:false,metric_eligible:false,network_requests:0}));

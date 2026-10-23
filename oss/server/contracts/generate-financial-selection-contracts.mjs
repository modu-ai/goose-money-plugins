/** Run from the TypeScript package root after build. No network or credentials. */
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { SecFinancialSelectionInputSchema, DartFinancialSelectionInputSchema, SecFinancialSelectorSchema, DartFinancialSelectorSchema, FinancialCalendarGuardSchema, REPORTED_FINANCIAL_ROLES, selectSecFinancialEvidence, selectDartFinancialEvidence } from '../dist/src/financial-evidence-selection.js';
import { SecConceptResultSchema, SecSubmissionsResultSchema } from '../dist/src/sec-public-data.js';
import { openDartResultSchema } from '../dist/src/opendart.js';
import { openDartFilingsResultSchema } from '../dist/src/opendart-filings.js';
import { ExactInstantSchema } from '../dist/src/exact-instant.js';
import { secFixture, dartFixture } from '../dist/test/financial-selection-fixtures.js';
const literal=z.literal;
const common={
 contract:literal('moai.financial.selected-evidence-candidate.v1'),status:literal('selected_evidence_candidate_only'),origin:z.enum(['actual','synthetic']),cutoff:ExactInstantSchema,
 calendar_guard:FinancialCalendarGuardSchema.extend({status:literal('caller_selected_timezone_not_source_verified')}),requested_role:z.enum(REPORTED_FINANCIAL_ROLES),
 role_association_status:literal('unverified_caller_request'),semantic_binding_verified:literal(false),canonical_fact:z.null(),published_at:z.null(),available_at:z.null(),rights_status:literal('pending'),
 unit_scale:z.null(),accounting_basis:z.null(),finality:literal('unknown'),coverage_complete:literal(false),selection_policy:literal('exact_caller_selector_no_latest_or_restatement_inference'),
 constituent_receipt_latest:ExactInstantSchema,receipt_status:literal('constituent_dto_receipts_checked_not_publication_times'),mapping_blockers:z.array(z.string()).min(1),warnings:z.array(z.string()).min(1),
};
const lineage=(dto)=>z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),hash_scope:literal('validated_provider_dto_snapshot'),hash_algorithm:literal('sha256'),serialization:literal('sorted_object_keys_json_utf8_v1'),original_http_body_hash:z.null(),received_at:ExactInstantSchema,value:dto}).strict();
const count=z.number().int().nonnegative();
const sec=z.object({...common,provider:literal('SEC'),selector:SecFinancialSelectorSchema,
 issuer:z.object({cik:z.string().regex(/^\d{10}$/),status:literal('supplied_dto_cik_join_only_not_security_identity')}).strict(),
 selected:z.object({row:SecConceptResultSchema.shape.facts.element,filing:SecSubmissionsResultSchema.shape.filings.element,numeric_lexeme:SecConceptResultSchema.shape.facts.element.shape.numeric_lexeme,unit_raw:SecConceptResultSchema.shape.facts.element.shape.unit_raw,acceptance_datetime:ExactInstantSchema.nullable(),acceptance_status:literal('source_acceptance_metadata_not_publication_availability')}).strict(),
 coverage:z.object({concept_total_fact_count:count,concept_truncated:z.boolean(),concept_selection:literal('provider_unit_and_row_order_first_n'),filings_recent_count:count,filings_omitted_recent_count:count,historical_file_count:count,filings_completeness:literal('recent_subset_historical_files_not_fetched'),complete:literal(false)}).strict(),
 snapshots:z.object({financial:lineage(SecConceptResultSchema),filings:lineage(SecSubmissionsResultSchema)}).strict(),
}).strict();
const dart=z.object({...common,provider:literal('opendart'),selector:DartFinancialSelectorSchema,
 issuer:z.object({corp_code:z.string().regex(/^\d{8}$/),status:literal('supplied_dto_corp_code_join_only_not_security_identity')}).strict(),
 selected:z.object({row:openDartResultSchema.shape.rows.element,filing:openDartFilingsResultSchema.shape.rows.element,amount_kind:DartFinancialSelectorSchema.shape.amount_kind,
 amount_field:z.enum(['thstrm_amount','thstrm_add_amount','frmtrm_amount','frmtrm_q_amount','frmtrm_add_amount','bfefrmtrm_amount']),amount:openDartResultSchema.shape.rows.element.shape.amounts.shape.current,
 period_label_field:z.enum(['thstrm_nm','frmtrm_nm','frmtrm_q_nm','bfefrmtrm_nm']),period_label:z.string().max(2048).nullable(),period_start:z.null(),period_end:z.null(),period_status:literal('provider_label_only_no_calendar_endpoints_inferred'),provider_current_period_kind:z.enum(['three_months','unspecified']),current_period_kind_applies_to:literal('current_amount_only_not_cumulative')}).strict(),
 coverage:z.object({statement_rows_supplied:count,statement_completeness:literal('not_established'),page_no:count,page_count:count,total_count:count.nullable(),total_page:count.nullable(),has_more:z.boolean(),next_page_no:count.nullable(),last_reprt_at:z.enum(['Y','N']),previous_pages_status:literal('not_supplied_or_verified'),complete:literal(false)}).strict(),
 snapshots:z.object({financial:lineage(openDartResultSchema),filings:lineage(openDartFilingsResultSchema)}).strict(),
}).strict();
for(const [name,schema] of [['sec-financial-selection-input-v1',SecFinancialSelectionInputSchema],['dart-financial-selection-input-v1',DartFinancialSelectionInputSchema],['sec-financial-evidence-candidate-v1',sec],['dart-financial-evidence-candidate-v1',dart]]) {
 const data=z.toJSONSchema(schema, {target:'draft-2020-12'});
 data.$comment='Structure only. JSON Schema omits runtime refinements, hostile-object guards, exact joins/calendar/receipt checks, DART reconstruction and snapshot hashes. Use selectSecFinancialEvidence/selectDartFinancialEvidence; persisted candidates MUST pass validateFinancialEvidenceCandidate.';
 writeFileSync(`contracts/${name}.schema.json`,JSON.stringify(data,null,2)+'\n');
}
const si=await secFixture(),di=dartFixture();
const so=selectSecFinancialEvidence(si),dout=selectDartFinancialEvidence(di);
sec.parse(so);dart.parse(dout);
for(const [name,body] of [['sec-financial-selection.synthetic.input',si],['sec-financial-selection.synthetic.candidate',so],['dart-financial-selection.synthetic.input',di],['dart-financial-selection.synthetic.candidate',dout]])writeFileSync(`fixtures/${name}.json`,JSON.stringify(body,null,2)+'\n');

// R09 thesis baseline input schema (issue #117; user decision 2026-11-11 in #22: choice C —
// structured 4 fields + free memo, 1:1 with the four-way wording at report-pipeline.ts:812).
// Style precedent: manual-consultation.ts — zod strict, unknown-field rejection, control-character refine.
// #13: the schema never fabricates a value; empty optional sections stay empty (missing → not_run is
// decided by the pipeline hookup in report-pipeline.ts, #127; empty families keep their section not_run).
// Limits are undecided (see issue): every bound is injected via ThesisBaselineInputLimits; no number
// is pinned in code and no default limit is adopted.
import {z} from 'zod';

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===v;},'invalid_calendar_date');

export const ThesisBaselineInputLimitsSchema=z.object({
 claim_max_length:z.number().int().min(1),
 evidence_text_max_length:z.number().int().min(1),
 memo_max_length:z.number().int().min(1),
 evidence_array_max_items:z.number().int().min(0),
}).strict();
export type ThesisBaselineInputLimits=z.infer<typeof ThesisBaselineInputLimitsSchema>;

export function buildThesisBaselineInputSchema(limits:ThesisBaselineInputLimits){
 const bound=ThesisBaselineInputLimitsSchema.parse(limits);
 const thesisText=z.string().trim().min(1).max(bound.evidence_text_max_length).refine(v=>!/[\x00-\x1f\x7f]/.test(v),'control_character');
 return z.object({
  as_of:date,
  claim:z.string().trim().max(bound.claim_max_length).refine(v=>!/[\x00-\x1f\x7f]/.test(v),'control_character'),
  supporting_evidence:z.array(thesisText).max(bound.evidence_array_max_items).default([]),
  counter_evidence:z.array(thesisText).max(bound.evidence_array_max_items).default([]),
  verification_conditions:z.array(thesisText).max(bound.evidence_array_max_items).default([]),
  memo:z.string().max(bound.memo_max_length).refine(v=>!/[\x00-\x1f\x7f]/.test(v),'control_character').optional(),
 }).strict().superRefine((v,c)=>{
  if(v.claim.length===0)c.addIssue({code:'custom',message:'thesis_claim_blank'});
 });
}
export type ThesisBaselineInputSchema=ReturnType<typeof buildThesisBaselineInputSchema>;
export type ThesisBaselineInput=z.infer<ThesisBaselineInputSchema>;

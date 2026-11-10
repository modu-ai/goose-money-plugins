// R09 thesis baseline input schema tests (issue #117; user decision 2026-11-11 in #22: choice C).
// Choice C = four structured fields (claim / supporting_evidence / counter_evidence /
// verification_conditions — 1:1 with the four-way wording at report-pipeline.ts:812) + a free memo.
// Style precedent: manual-consultation.ts (zod strict, unknown-field rejection, control-character refine).
// Limits are undecided (see issue): every bound is injected, so no number is pinned in code. The
// fixture bounds below are arbitrary small values used only to exercise rejection and boundaries —
// adopting them anywhere else would be a decision this issue does not make.
// Pipeline hookup stays out of scope: this schema parses user text only, never fabricates a value
// (#13) and leaves empty optional sections empty.
import assert from 'node:assert/strict';
import test from 'node:test';
import {buildThesisBaselineInputSchema,ThesisBaselineInputLimitsSchema} from '../src/thesis-baseline-input.js';

const limits={claim_max_length:12,evidence_text_max_length:8,memo_max_length:6,evidence_array_max_items:2};
const Schema=buildThesisBaselineInputSchema(limits);
const valid={as_of:'2026-02-28',claim:'실적 유지 주장'};
const issues=(error:unknown)=>(error as import('zod').ZodError).issues.map(i=>i.message);

test('complete choice-C input parses; claim is trimmed, empty arrays default to [] and memo passes through untrimmed',()=>{
 const parsed=Schema.parse({...valid,claim:'  실적 유지 주장  ',supporting_evidence:[' 매출 지속 '],memo:' 참고 '});
 assert.equal(parsed.claim,'실적 유지 주장');
 assert.deepEqual(parsed.supporting_evidence,['매출 지속']);
 assert.deepEqual(parsed.counter_evidence,[]);
 assert.deepEqual(parsed.verification_conditions,[]);
 assert.equal(parsed.memo,' 참고 ');
});

test('unknown fields are rejected and the same input without them passes (strict)',()=>{
 assert.throws(()=>Schema.parse({...valid,extra:'x'}),(error:unknown)=>issues(error).some(m=>m.includes('extra')));
 assert.equal(Schema.parse(valid).claim,valid.claim);
});

test('blank-only claim is rejected as thesis_claim_blank; a whitespace-trimmed claim passes',()=>{
 const blank=Schema.safeParse({as_of:'2026-02-28',claim:'   '});
 assert.equal(blank.success,false);
 assert.ok(issues(blank.error).includes('thesis_claim_blank'));
 assert.equal(Schema.parse({...valid,claim:' 주장 '}).claim,'주장');
});

test('the claim bound is injected: 13 chars rejected, the 12-char boundary passes',()=>{
 assert.throws(()=>Schema.parse({as_of:'2026-02-28',claim:'가'.repeat(13)}));
 assert.equal(Schema.parse({as_of:'2026-02-28',claim:'가'.repeat(12)}).claim,'가'.repeat(12));
});

test('evidence items must be non-blank and within the injected text bound; the array item-count bound is injected',()=>{
 assert.throws(()=>Schema.parse({...valid,supporting_evidence:['  ']})); // blank item rejected
 assert.throws(()=>Schema.parse({...valid,supporting_evidence:['가'.repeat(9)]})); // 9 > injected text bound 8
 const at=Schema.parse({...valid,supporting_evidence:['가'.repeat(8),'확인'],counter_evidence:['b','c'],verification_conditions:['d','e']}); // boundary 8 and item-count 2 pass
 assert.deepEqual([at.supporting_evidence.length,at.counter_evidence.length,at.verification_conditions.length],[2,2,2]);
 assert.throws(()=>Schema.parse({...valid,supporting_evidence:['1','2','3']})); // 3 items exceed the injected item-count bound 2
});

test('the memo bound is injected: 7 chars rejected, 6 passes, and an absent memo stays absent',()=>{
 assert.throws(()=>Schema.parse({...valid,memo:'가'.repeat(7)}));
 assert.equal(Schema.parse({...valid,memo:'가'.repeat(6)}).memo,'가'.repeat(6));
 assert.ok(!('memo' in Schema.parse(valid)),'no memo key is fabricated');
});

test('control characters are rejected in claim, evidence items and memo',()=>{
 assert.throws(()=>Schema.parse({as_of:'2026-02-28',claim:'a\u0000b'}));
 assert.throws(()=>Schema.parse({...valid,supporting_evidence:['a\u0000b']}));
 assert.throws(()=>Schema.parse({...valid,memo:'a\u0000b'}));
});

test('as_of must be a real calendar date written as YYYY-MM-DD',()=>{
 assert.throws(()=>Schema.parse({...valid,as_of:'2026-02-30'})); // not a real date
 assert.throws(()=>Schema.parse({...valid,as_of:'2026-2-8'})); // wrong format
 assert.equal(Schema.parse({...valid,as_of:'2026-02-28'}).as_of,'2026-02-28');
});

test('the limits object itself is strict-validated: missing, extra, non-integer and negative bounds are rejected',()=>{
 assert.throws(()=>ThesisBaselineInputLimitsSchema.parse({claim_max_length:12,evidence_text_max_length:8,memo_max_length:6})); // missing key
 assert.throws(()=>ThesisBaselineInputLimitsSchema.parse({...limits,unknown:1})); // extra key
 assert.throws(()=>ThesisBaselineInputLimitsSchema.parse({...limits,evidence_array_max_items:-1})); // negative
 assert.throws(()=>ThesisBaselineInputLimitsSchema.parse({...limits,claim_max_length:1.5})); // non-integer
 assert.deepEqual(ThesisBaselineInputLimitsSchema.parse(limits),limits);
});

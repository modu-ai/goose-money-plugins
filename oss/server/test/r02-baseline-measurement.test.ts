// SPEC-ATP-R02-001 M0 (card t5-A), baseline commit B. Observation only: this file freezes what the
// <T17> tree (b855fa1) answers for single-subject inputs, so that REQ-SUB-003 ("no subjects list ->
// the same ReportInput, contract atp.template/1.1") has a recorded baseline. It holds NO comparison
// input, so it stays green after a correct M1 and turns red only if M1 changes a path outside the
// comparison. The golden file was generated once from the <T17> build and is never regenerated.
// Synthetic data only; the pipeline functions called here cannot reach a provider.
import assert from 'node:assert/strict';
import test from 'node:test';
import {buildReportInput,ReportInputSchema} from '../src/report-pipeline.js';
import golden from './fixtures/r02-single-subject-golden.json' with {type:'json'};

const EXPECTED_IDS=[
  'r01-synthetic-quote',
  'r01-report-observations',
  'r02-fcf-etf-premium-observations',
  'r02-capex-period-mismatch-observations',
  'r02-untrusted-actual-quote-claim',
  'r02-e2e-synthetic-quote-rights-on',
  'r02-e2e-quote-rights-off',
];

test('golden holds the planned single-subject entries and none of them names a subjects list',()=>{
  assert.equal(golden.generated_from,'b855fa141e7e28300e86ef3e497e596a551503ae');
  assert.deepEqual(golden.entries.map(entry=>entry.id),EXPECTED_IDS);
  for(const entry of golden.entries){
    assert.ok(!('subjects' in entry.input),`${entry.id}: input must not carry subjects`);
    assert.ok('subject' in entry.input,`${entry.id}: input carries the single subject`);
    assert.equal(entry.expected.contract_version,'atp.template/1.1',`${entry.id}: recorded contract`);
  }
});

for(const entry of golden.entries){
  test(`single-subject baseline recomputes identically: ${entry.id}`,()=>{
    const recomputed=buildReportInput(structuredClone(entry.input) as unknown as Parameters<typeof buildReportInput>[0]);
    assert.equal(recomputed.contract_version,'atp.template/1.1');
    assert.doesNotThrow(()=>ReportInputSchema.parse(recomputed));
    assert.deepStrictEqual(recomputed,entry.expected);
  });
}

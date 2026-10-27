import test from 'node:test';
import assert from 'node:assert/strict';
import { secFixture } from './financial-selection-fixtures.js';
import { selectSecFinancialEvidence, SecFinancialSelectionInputSchema } from '../src/financial-evidence-selection.js';
import type { SecConceptName, SecTaxonomy } from '../src/sec-concept-catalog.js';

// Synthetic DTO edits only. No issuer data, network transport or report-role definitions.
async function candidateInput(taxonomy: SecTaxonomy, concept: SecConceptName) {
  const q = await secFixture();
  q.concept_result.request.taxonomy = taxonomy;
  q.concept_result.request.concept = concept;
  q.concept_result.taxonomy = taxonomy;
  q.concept_result.concept = concept;
  q.concept_result.source_url = `https://data.sec.gov/api/xbrl/companyconcept/CIK0000000001/${taxonomy}/${concept}.json`;
  q.selector.taxonomy = taxonomy;
  q.selector.concept = concept;
  return q;
}

test('new operating/basic concepts pass exact financial selectors without granting role verification',async()=>{
  for (const [taxonomy,concept] of [
    ['us-gaap','OperatingIncomeLoss'],['us-gaap','WeightedAverageNumberOfSharesOutstandingBasic'],
    ['us-gaap','NetIncomeLossAvailableToCommonStockholdersBasic'],['us-gaap','ProfitLoss'],
    ['ifrs-full','WeightedAverageShares'],['ifrs-full','OperatingProfitLossOperating'],
  ] as const) {
    const q = await candidateInput(taxonomy,concept);
    assert.equal(SecFinancialSelectionInputSchema.safeParse(q).success,true);
    const result = selectSecFinancialEvidence(q);
    assert.equal(result.selector.concept,concept);
    assert.equal(result.semantic_binding_verified,false);
    assert.equal(result.role_association_status,'unverified_caller_request');
    assert.equal(result.canonical_fact,null);
    assert.ok(result.mapping_blockers.includes('semantic_role_binding_not_verified'));
    assert.equal(result.rights_status,'pending');
  }
});

test('a caller asking for basic shares cannot turn diluted raw data into a verified basic fact',async()=>{
  for (const [taxonomy,diluted] of [
    ['us-gaap','WeightedAverageNumberOfDilutedSharesOutstanding'],['ifrs-full','AdjustedWeightedAverageShares'],
  ] as const) {
    const q = await candidateInput(taxonomy,diluted);
    q.requested_role = 'reported.shares_weighted';
    const result = selectSecFinancialEvidence(q);
    assert.equal(result.requested_role,'reported.shares_weighted');
    assert.equal(result.selector.concept,diluted);
    assert.equal(result.semantic_binding_verified,false);
    assert.equal(result.role_association_status,'unverified_caller_request');
    assert.equal(result.canonical_fact,null);
    assert.ok(result.mapping_blockers.includes('semantic_role_binding_not_verified'));
  }
});

test('new concepts retain duplicate-evidence rejection and cross-taxonomy rejection in selectors',async()=>{
  const q = await candidateInput('us-gaap','WeightedAverageNumberOfSharesOutstandingBasic');
  q.concept_result.facts.push(structuredClone(q.concept_result.facts[0]!));
  q.concept_result.total_fact_count = 2;
  assert.throws(()=>selectSecFinancialEvidence(q),/selection_ambiguous/);
  const wrong = await candidateInput('ifrs-full','OperatingIncomeLoss');
  assert.equal(SecFinancialSelectionInputSchema.safeParse(wrong).success,false);
});

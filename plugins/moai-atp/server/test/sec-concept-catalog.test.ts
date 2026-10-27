import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEC_US_GAAP_CONCEPTS, SEC_IFRS_FULL_CONCEPTS, SEC_CONCEPT_DISTINCTIONS, isSecConceptAllowed } from '../src/sec-concept-catalog.js';
import { SecConceptInputSchema, SecConceptResultSchema, requestSecCompanyConcept, type SecPublicTransport, type SecRequest } from '../src/sec-public-data.js';

const at = '2026-10-22T00:00:00Z';
const cik = '0000000001';
const legacyUs = ['Revenues','RevenueFromContractWithCustomerExcludingAssessedTax','NetIncomeLoss','Assets','Liabilities','StockholdersEquity','CashAndCashEquivalentsAtCarryingValue','NetCashProvidedByUsedInOperatingActivities','PaymentsToAcquirePropertyPlantAndEquipment','EarningsPerShareDiluted','WeightedAverageNumberOfDilutedSharesOutstanding','CommonStockSharesOutstanding'];
const legacyIfrs = ['Revenue','ProfitLoss','Assets','Liabilities','Equity','CashAndCashEquivalents'];
const catalogs = [['us-gaap',SEC_US_GAAP_CONCEPTS], ['ifrs-full',SEC_IFRS_FULL_CONCEPTS]] as const;
function mock(taxonomy: string, concept: string, lexeme = '900719925474099312345678.1234500', status = 200) {
  const requests: SecRequest[] = [];
  const body = JSON.stringify({cik:1,entityName:'Synthetic only',taxonomy,tag:concept,label:'Not used for concept selection',units:{'USD/shares':[
    {start:'2025-01-01',end:'2025-12-31',val:123,accn:'0000000001-26-000001',filed:'2026-02-01',fy:2025,fp:'FY',form:'10-K'},
  ]}}).replace('"val":123','"val":'+lexeme);
  const transport: SecPublicTransport = {origin:'synthetic',async send(request) {requests.push(request);return {status,body_text:body};}};
  return {transport,requests};
}

test('catalog is immutable and unique within each namespace; legacy concepts are preserved', () => {
  for (const [, names] of catalogs) {
    assert.equal(new Set(names).size,names.length);
    assert.equal(Object.isFrozen(names),true);
    assert.throws(() => (names as unknown as string[]).push('Invented'));
  }
  assert.equal(Object.isFrozen(SEC_CONCEPT_DISTINCTIONS),true);
  assert.deepEqual(SEC_US_GAAP_CONCEPTS.slice(0,legacyUs.length),legacyUs);
  assert.deepEqual(SEC_IFRS_FULL_CONCEPTS.slice(0,legacyIfrs.length),legacyIfrs);
  // Shared local names are distinct taxonomy-qualified concepts, not aliases.
  for (const taxonomy of ['us-gaap','ifrs-full']) assert.equal(isSecConceptAllowed(taxonomy,'ProfitLoss'),true);
});

test('every addition has pinned primary schema evidence, with no abstract or guessed concepts', () => {
  const evidence = JSON.parse(readFileSync(new URL('../../fixtures/source-contracts/primary-source-evidence.json',import.meta.url),'utf8')) as {
    entries: {taxonomy:string;concept:string;introduced_by_this_change:boolean;verified_schema_declarations:{release:string;abstract:boolean;declared_item_type:string;declared_period_type:string}[]}[];
  };
  const keys = evidence.entries.map(e => e.taxonomy+':'+e.concept);
  assert.equal(new Set(keys).size,keys.length);
  assert.equal(keys.length,47);
  assert.equal(evidence.entries.filter(e=>e.introduced_by_this_change).length,29);
  for (const [taxonomy,names] of catalogs) for (const concept of names) {
    const e = evidence.entries.find(e=>e.taxonomy===taxonomy&&e.concept===concept);
    assert.ok(e);
    assert.equal(e.verified_schema_declarations.length,taxonomy==='us-gaap'?2:1);
    for (const declaration of e.verified_schema_declarations) {
      assert.equal(declaration.abstract,false);
      assert.ok(['duration','instant'].includes(declaration.declared_period_type));
    }
  }
});

for (const [taxonomy,concepts] of catalogs) for (const concept of concepts) {
  test(`raw fixed-route acceptance: ${taxonomy}:${concept}`,async()=>{
    const m = mock(taxonomy,concept);
    const q = {cik,taxonomy,concept};
    assert.equal(SecConceptInputSchema.safeParse(q).success,true);
    const r = await requestSecCompanyConcept(q,m.transport,()=>at);
    assert.equal(m.requests.length,1);
    assert.equal(m.requests[0]?.url,`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${concept}.json`);
    assert.equal(r.concept,concept);
    assert.equal(r.facts[0]?.numeric_lexeme,'900719925474099312345678.1234500');
    // Taxonomy type metadata is not used to infer or replace the source units or periods.
    assert.equal(r.facts[0]?.unit_raw,'USD/shares');
    assert.equal(r.facts[0]?.period_kind,'duration');
    assert.equal(r.facts[0]?.canonical_metric,null);
    assert.equal(r.facts[0]?.accounting_basis,null);
    assert.equal(r.rights,'pending');
    assert.equal(SecConceptResultSchema.safeParse(r).success,true);
    assert.equal('role' in r,false);
    assert.equal('concept_documentation' in r,false);
  });
}

test('cross-taxonomy misuse and arbitrary tags, paths, duplicate-list requests and extra controls fail before transport',async()=>{
  const m = mock('us-gaap','Assets');
  for (const [taxonomy,concepts] of catalogs) for (const concept of concepts) {
    const other = taxonomy==='us-gaap'?'ifrs-full':'us-gaap';
    if (!isSecConceptAllowed(other,concept)) await assert.rejects(requestSecCompanyConcept({cik,taxonomy:other,concept},m.transport),/invalid_input/);
  }
  const concepts: unknown[] = ['CommonStockholdersEquity','WeightedAverageNumberOfOrdinarySharesOutstandingBasic','BorrowingsNoncurrent','OperatingProfitLoss',
    '../OperatingIncomeLoss','us-gaap:OperatingIncomeLoss','OperatingIncomeLoss.json','OperatingIncomeLoss?token=x','%2e%2e%2fAssets','assets',' Assets','Assets\n','__proto__','constructor',
    ['OperatingIncomeLoss','OperatingIncomeLoss'],null,{toString(){throw new Error('must_not_coerce');}}];
  for (const concept of concepts) {
    assert.equal(isSecConceptAllowed('us-gaap',concept),false);
    assert.equal(isSecConceptAllowed('ifrs-full',concept),false);
    await assert.rejects(requestSecCompanyConcept({cik,taxonomy:'us-gaap',concept},m.transport),/invalid_input/);
  }
  for (const extra of [{concepts:['Assets','Assets']},{role:'reported.shares_weighted'},{taxonomy_version:'2026'},{url:'https://invalid.example/'}])
    await assert.rejects(requestSecCompanyConcept({cik,taxonomy:'us-gaap',concept:'Assets',...extra},m.transport),/invalid_input/);
  assert.equal(m.requests.length,0);
});

test('basic and diluted tags stay separate and never trigger a fallback',async()=>{
  for (const [taxonomy,basic,diluted] of [
    ['us-gaap','WeightedAverageNumberOfSharesOutstandingBasic','WeightedAverageNumberOfDilutedSharesOutstanding'],
    ['ifrs-full','WeightedAverageShares','AdjustedWeightedAverageShares'],
  ]) {
    const m = mock(taxonomy!,diluted!,'200');
    await assert.rejects(requestSecCompanyConcept({cik,taxonomy,concept:basic},m.transport,()=>at),/instrument_mismatch/);
    assert.equal(m.requests.length,1);
    const missing = mock(taxonomy!,basic!,'100',404);
    await assert.rejects(requestSecCompanyConcept({cik,taxonomy,concept:basic},missing.transport,()=>at),/upstream_rejected/);
    assert.equal(missing.requests.length,1);
    const b = await requestSecCompanyConcept({cik,taxonomy,concept:basic},mock(taxonomy!,basic!,'100').transport,()=>at);
    const d = await requestSecCompanyConcept({cik,taxonomy,concept:diluted},mock(taxonomy!,diluted!,'200').transport,()=>at);
    assert.notEqual(b.concept,d.concept);
    assert.notEqual(b.facts[0]?.numeric_lexeme,d.facts[0]?.numeric_lexeme);
    assert.equal(b.facts[0]?.canonical_metric,null);
    assert.equal(d.facts[0]?.canonical_metric,null);
  }
});

test('notes explicitly preserve consequential net-income, equity, basic-share and debt differences',()=>{
  assert.match(SEC_CONCEPT_DISTINCTIONS['us-gaap:NetIncomeLoss'],/not consolidated total/);
  assert.match(SEC_CONCEPT_DISTINCTIONS['us-gaap:StockholdersEquity'],/not automatically common-only/);
  assert.match(SEC_CONCEPT_DISTINCTIONS['us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding'],/never silently substitute/);
  assert.match(SEC_CONCEPT_DISTINCTIONS['ifrs-full:AdjustedWeightedAverageShares'],/never silently substitute/);
  assert.match(SEC_CONCEPT_DISTINCTIONS['ifrs-full:EquityAttributableToOwnersOfParent'],/not automatically common-only/);
  assert.match(SEC_CONCEPT_DISTINCTIONS['us-gaap:LongTermDebtAndCapitalLeaseObligations'],/NONCURRENT/);
  assert.match(SEC_CONCEPT_DISTINCTIONS['ifrs-full:OperatingProfitLossOperating'],/IFRS 18 early-application/);
});

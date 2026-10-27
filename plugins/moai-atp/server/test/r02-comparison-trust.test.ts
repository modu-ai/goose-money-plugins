// SPEC-ATP-R02-001 T1 (card t5-A): trust-boundary tests for the comparison path over the MCP harness.
// Cells: AC-006b (process_receipt + retained snapshot), AC-007a-g, AC-007h (MCP half), AC-010a.
// The fetch recorder is the first import so that no server module is loaded before it is installed.
// Synthetic data only. Every request uses the comparison request form, so on the <T17> tree + commit B
// these cells fail first on "the comparison request is not accepted"; AC-007a-g and AC-010a are
// regression guards whose T1 result is an observation, the rest are release-blocking.
import {readFetchRecords,resetFetchRecords} from './fetch-recorder.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test,{mock} from 'node:test';
import {
  CLAUSE_OF,CUTOFF,LIVE_PHRASES,SUBJECT_A,SUBJECT_B,SUBJECT_OTHER,SUBJECTS_AB,
  actualServer,acquisitionOf,allCalls,bindingMap,buildDoc,comparisonArgs,forge,hasResourceLink,isRenderRefusal,mcpBuild,mcpRender,
  mappingOf,openMcp,outcomeOf,receiptArgs,receiptFor,receiptsFor,rowFor,sourceIdsOf,withDefaultSession,
} from './r02-fixtures.js';

const synthetic=()=>comparisonArgs(SUBJECTS_AB,allCalls(SUBJECTS_AB,'synthetic'));
const OK={ok:true,code:'OK'};

// ------------------------------------------------------------------ AC-006b
test('AC-006b process_receipt: a retained snapshot served through a receipt is labelled process_receipt, B quote is a missing value',async()=>{
  const {server}=actualServer({retained:SUBJECT_A});const session=await openMcp(server);
  try{
    const aq=await receiptFor(session.rpc,'quote',SUBJECT_A);
    const rest=[await receiptFor(session.rpc,'funds',SUBJECT_A),await receiptFor(session.rpc,'filings',SUBJECT_A),await receiptFor(session.rpc,'funds',SUBJECT_B),await receiptFor(session.rpc,'filings',SUBJECT_B)];
    const reply=await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,[aq,...rest]));
    assert.deepStrictEqual(outcomeOf(reply),OK);
    const doc=reply.result.structuredContent;
    const quoteA=sourceIdsOf(doc,SUBJECT_A.id,'get_market_snapshot');
    assert.equal(quoteA.length,1);
    assert.equal(acquisitionOf(doc,quoteA[0]!),'process_receipt');
    const row=rowFor(doc,'quote.last');
    assert.equal(row.comparable,false);
    assert.ok(row.reasons.includes('value_missing'),JSON.stringify(row.reasons));
  }finally{await session.close();}
});
test('AC-006b phrase cell (ReportInput part): no live-query phrase anywhere in the built comparison document',async()=>{
  const {server}=actualServer({retained:SUBJECT_A});const session=await openMcp(server);
  try{
    const aq=await receiptFor(session.rpc,'quote',SUBJECT_A);
    const rest=[await receiptFor(session.rpc,'funds',SUBJECT_A),await receiptFor(session.rpc,'filings',SUBJECT_A),await receiptFor(session.rpc,'funds',SUBJECT_B),await receiptFor(session.rpc,'filings',SUBJECT_B)];
    const reply=await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,[aq,...rest]));
    assert.deepStrictEqual(outcomeOf(reply),OK);
    const text=JSON.stringify(reply.result.structuredContent);
    for(const phrase of LIVE_PHRASES)assert.ok(!text.includes(phrase),`phrase ${phrase}`);
  }finally{await session.close();}
});

// ------------------------------------------------------------------ AC-007a-g
test('AC-007a caller-supplied actual results stay rights pending with hidden values',async()=>{
  await withDefaultSession(async rpc=>{
    const reply=await mcpBuild(rpc,comparisonArgs(SUBJECTS_AB,allCalls(SUBJECTS_AB,'actual')));
    assert.deepStrictEqual(outcomeOf(reply),OK);
    const doc=reply.result.structuredContent;
    assert.ok(doc.sources.length>0);
    for(const source of doc.sources)assert.equal(source.rights,'pending',source.id);
    assert.ok(doc.metrics.length>0);
    for(const metric of doc.metrics)assert.equal(metric.value,null,`${metric.source_id} ${metric.field_id}`);
  });
});
test('AC-007b receipts with the local report view switched off -> invalid_provenance',async()=>{
  const {server}=actualServer({localView:false});const session=await openMcp(server);
  try{assert.deepStrictEqual(outcomeOf(await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,[randomUUID()]))),{ok:false,code:'invalid_provenance'});}
  finally{await session.close();}
});
test('AC-007c the same receipt id twice -> invalid_provenance',async()=>{
  const {server}=actualServer();const session=await openMcp(server);
  try{
    const [aq,af,ap,bq,bf,bp]=await receiptsFor(session.rpc,SUBJECTS_AB);
    assert.deepStrictEqual(outcomeOf(await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,[aq!,aq!,af!,ap!,bq!,bf!,bp!]))),{ok:false,code:'invalid_provenance'});
  }finally{await session.close();}
});
test('AC-007d a receipt older than 300,000 ms -> invalid_provenance (mocked Date)',async()=>{
  mock.timers.enable({apis:['Date'],now:Date.parse(CUTOFF)});
  try{
    const {server}=actualServer();const session=await openMcp(server);
    try{
      const receipts=await receiptsFor(session.rpc,SUBJECTS_AB);
      mock.timers.tick(300_001);
      assert.deepStrictEqual(outcomeOf(await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,receipts))),{ok:false,code:'invalid_provenance'});
    }finally{await session.close();}
  }finally{mock.timers.reset();}
});
test('AC-007e a receipt-based actual comparison document cannot be altered and rendered (row value, or one binding)',async()=>{
  const {server}=actualServer();const session=await openMcp(server);
  try{
    const reply=await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,await receiptsFor(session.rpc,SUBJECTS_AB)));
    assert.deepStrictEqual(outcomeOf(reply),OK);
    const doc=reply.result.structuredContent;
    assert.deepStrictEqual(outcomeOf(await mcpRender(session.rpc,doc)),OK,'the untouched document renders');
    // SPEC-ATP-DEBT-F3F4-001 (t29): an edit that breaks the comparison table's lineage against its own document is
    // refused at the input schema before the content hash is reached, so these two edits are refusals of either kind.
    const rowEdited=structuredClone(doc);rowEdited.comparison.rows[0].cells[0].value='999999';
    assert.ok(isRenderRefusal(await mcpRender(session.rpc,rowEdited)),'edited row value');
    const rebound=structuredClone(doc);
    rebound.comparison.source_bindings[0].subject_id=rebound.comparison.source_bindings[0].subject_id===SUBJECT_A.id?SUBJECT_B.id:SUBJECT_A.id;
    assert.ok(isRenderRefusal(await mcpRender(session.rpc,rebound)),'edited binding');
    // Edits that stay consistent with the document's own ledger still meet the content hash.
    const lineage=structuredClone(doc);
    const row=lineage.comparison.rows.find((candidate:any)=>candidate.cells[0].value!==null);const cell=row.cells[0];
    lineage.metrics.find((metric:any)=>metric.source_id===cell.source_id&&metric.field_id===row.field_id).value='999999';cell.value='999999';
    assert.deepStrictEqual(outcomeOf(await mcpRender(session.rpc,lineage)),{ok:false,code:'invalid_provenance'},'row value edited together with its metric');
    const filings=sourceIdsOf(doc,SUBJECT_A.id,'get_public_filings')[0]!;
    assert.equal(doc.comparison.rows.flatMap((candidate:any)=>candidate.cells).filter((candidate:any)=>candidate.source_id===filings).length,0,'no cell references the filing source');
    const filingsRebound=structuredClone(doc);
    filingsRebound.comparison.source_bindings.find((binding:any)=>binding.source_id===filings).subject_id=SUBJECT_B.id;
    assert.deepStrictEqual(outcomeOf(await mcpRender(session.rpc,filingsRebound)),{ok:false,code:'invalid_provenance'},'edited binding of a source no cell references');
  }finally{await session.close();}
});
test('AC-007f a refusal consumes no receipt: the same receipts serve the corrected request',async()=>{
  const {server}=actualServer();const session=await openMcp(server);
  try{
    const receipts=await receiptsFor(session.rpc,SUBJECTS_AB);
    // B's corp_code candidate names no issuer of the receipts, so B's DART sources match no subject.
    const wrongSubjects=[SUBJECT_A,{...SUBJECT_B,corp_code_candidate:SUBJECT_OTHER.corp_code_candidate}];
    assert.deepStrictEqual(outcomeOf(await mcpBuild(session.rpc,receiptArgs(wrongSubjects,receipts))),{ok:false,code:'comparison_source_subject_mismatch'});
    assert.deepStrictEqual(outcomeOf(await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,receipts))),OK);
  }finally{await session.close();}
});
test('AC-007g thirteen receipts issued -> the first is gone (store keeps twelve) -> invalid_provenance',async()=>{
  const {server}=actualServer();const session=await openMcp(server);
  try{
    const first=await receiptFor(session.rpc,'quote',SUBJECT_A);
    for(let i=0;i<12;i++)await receiptFor(session.rpc,'quote',SUBJECT_B);
    assert.deepStrictEqual(outcomeOf(await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,[first]))),{ok:false,code:'invalid_provenance'});
  }finally{await session.close();}
});

// ------------------------------------------------------------------ AC-007h (MCP half)
const MCP_FORGERIES=['v','vi','vii','viii','ix','x','xi','xii','xiii'] as const;
test('AC-007h control: the unforged synthetic comparison document renders over MCP',async()=>{
  await withDefaultSession(async rpc=>{
    const reply=await mcpRender(rpc,buildDoc(synthetic()));
    assert.deepStrictEqual(outcomeOf(reply),OK);
    assert.ok(hasResourceLink(reply));
  });
});
for(const key of MCP_FORGERIES){
  test(`AC-007h (${key}) ${CLAUSE_OF[key]}: render_report_html refuses, no resource (schema_drift, invalid_provenance or the input-schema refusal)`,async()=>{
    const forged=forge(buildDoc(synthetic()),key);
    await withDefaultSession(async rpc=>{
      const reply=await mcpRender(rpc,forged);
      assert.ok(isRenderRefusal(reply),JSON.stringify(outcomeOf(reply)));
    });
  });
}
for(const key of ['aux-i','aux-ii','aux-iii'] as const){
  test(`AC-007h auxiliary ${key} (regression guard, over-determined): render_report_html refuses`,async()=>{
    const forged=forge(buildDoc(synthetic()),key);
    await withDefaultSession(async rpc=>{
      const reply=await mcpRender(rpc,forged);
      assert.ok(isRenderRefusal(reply),JSON.stringify(outcomeOf(reply)));
    });
  });
}
test('AC-007h auxiliary (iv) (regression guard): a provider-kind local_view source not produced by this process -> invalid_provenance',async()=>{
  const forged=forge(buildDoc(synthetic()),'aux-iv');
  await withDefaultSession(async rpc=>{
    const reply=await mcpRender(rpc,forged);
    assert.deepStrictEqual(outcomeOf(reply),{ok:false,code:'invalid_provenance'});
    assert.ok(!hasResourceLink(reply));
  });
});

// ------------------------------------------------------------------ AC-010a
test('AC-010a building and rendering a comparison issues zero provider requests',async()=>{
  const {server,counters}=actualServer();const session=await openMcp(server);
  try{
    const receipts=await receiptsFor(session.rpc,SUBJECTS_AB);
    const before={...counters};
    resetFetchRecords();
    const built=await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,receipts));
    assert.deepStrictEqual(outcomeOf(built),OK);
    const rendered=await mcpRender(session.rpc,built.result.structuredContent);
    assert.deepStrictEqual(outcomeOf(rendered),OK);
    assert.deepStrictEqual(counters,before,'synthetic transports were not called');
    assert.deepStrictEqual(readFetchRecords(),[],'no global fetch request');
    assert.ok(mappingOf(built.result.structuredContent,SUBJECT_A.id).status.length>0&&bindingMap(built.result.structuredContent).size>0);
  }finally{await session.close();}
});

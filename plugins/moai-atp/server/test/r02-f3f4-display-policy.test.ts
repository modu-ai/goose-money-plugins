// SPEC-ATP-DEBT-F3F4-001 (card t29): display policy of the R02 comparison for synthetic and unverified data.
// Cells: AC-F3-1..19 (comparison table versus its own document) and AC-F4-1..6 (identity text of an
// unaccepted issuer on the build path). Written before any source change: on the baseline source the RED cells
// of acceptance.md D.1 fail and the controls pass. Synthetic data only (r02-fixtures.ts); no provider is reachable.
// "Refused" means two things together: the issues of ReportInputSchema.safeParse include the named message and
// renderReportInputHtml produces no HTML.
import {readFetchRecords,resetFetchRecords} from './fetch-recorder.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {ReportInputSchema,renderReportInputHtml} from '../src/report-pipeline.js';
import {
  CUTOFF,SUBJECT_A,SUBJECT_B,SUBJECTS_AB,
  actualServer,allCalls,buildDoc,callsOf,comparisonArgs,dartPayload,filingsPayload,hasResourceLink,isRenderRefusal,mcpBuild,mcpRender,
  metricsOf,openMcp,outcomeOf,quoteRaw,receiptArgs,receiptsFor,reversedCalls,sourceIdsOf,withDefaultSession,
} from './r02-fixtures.js';
import {createStockMcpServer} from './synthetic-member-access.js';

const LINEAGE='comparison_cell_missing_metric_lineage',VERDICT='comparison_row_verdict_mismatch',DISPLAY='comparison_cell_not_displayable',ROWSET='comparison_row_set_mismatch';
const A_RCEPT='20260310000001',B_RCEPT='20260311000002',B_TERM='제 72 기',B_REVENUE='2234567890';

const issuesOf=(doc:any):string[]=>{const parsed=ReportInputSchema.safeParse(doc);return parsed.success?[]:[...new Set(parsed.error.issues.map(issue=>issue.message))];};
const renders=(doc:any):boolean=>{try{renderReportInputHtml(doc);return true;}catch{return false;}};
const rowOf=(doc:any,fieldId:string):any=>doc.comparison.rows.find((row:any)=>row.field_id===fieldId);
const assertRefused=(doc:any,message:string)=>{const issues=issuesOf(doc);assert.ok(issues.includes(message),`expected ${message}, got ${JSON.stringify(issues)}`);assert.equal(renders(doc),false,'the refused document must not render');};

// S-AB: both subjects synthetic_fixture_match; S-BU: B's filings carry no stock code, so B is unverified.
const synthetic=()=>buildDoc(comparisonArgs(SUBJECTS_AB,allCalls(SUBJECTS_AB,'synthetic')));
const syntheticBU=()=>buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,'synthetic'),callsOf(SUBJECT_B,'synthetic',{},{filings:{stockCode:''}})])));
const tablesOf=(doc:any,sourceIds:readonly string[])=>(doc.source_tables??[]).filter((table:any)=>sourceIds.includes(table.source_id));
const mappingStatuses=(doc:any):string[]=>doc.comparison.mappings.map((mapping:any)=>mapping.status);

// R-AB / R-BU: receipts of an in-process server labelled actual; with bUnverified, B's filings carry no stock code.
async function receiptSession(bUnverified:boolean){
  const known=[SUBJECT_A,SUBJECT_B];const subjectOf=(corp:string)=>known.find(subject=>subject.corp_code_candidate===corp)!;
  const server=bUnverified?createStockMcpServer({
    rightsEnabled:true,localReportViewEnabled:true,openDartEnabled:true,origin:'actual',clock:()=>CUTOFF,
    transport:{async getMarketSnapshot(symbol){return quoteRaw(symbol);}},
    openDartTransport:{origin:'actual',async send(request){const subject=subjectOf(request.params.corp_code);return dartPayload(subject,{corpCode:request.params.corp_code});}},
    filingsTransport:{origin:'actual',async send(request){const subject=subjectOf(request.params.corp_code);return filingsPayload(subject,{corpCode:request.params.corp_code,...(subject===SUBJECT_B?{stockCode:''}:{})});}},
  }):actualServer().server;
  const session=await openMcp(server);
  const built=await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,await receiptsFor(session.rpc,SUBJECTS_AB)));
  return {session,built,doc:built.result?.structuredContent};
}
const readHtml=async(rpc:(method:string,params:Record<string,unknown>)=>Promise<any>,reply:any):Promise<string>=>{
  const uri=reply.result?.content?.find((item:any)=>item.type==='resource_link')?.uri;
  const res=uri?await rpc('resources/read',{uri}):null;
  return res?.result?.contents?.[0]?.text??'';
};

// ------------------------------------------------------------------ F3: comparison table versus its own document
test('AC-F3-1 control: the built synthetic comparison document has no issue and renders',()=>{
  const doc=synthetic();
  assert.deepStrictEqual(issuesOf(doc),[]);
  assert.ok(renders(doc));
});
test('AC-F3-2 a forged cell value (no metric carries it) is refused with comparison_cell_missing_metric_lineage',()=>{
  const doc=synthetic();rowOf(doc,'quote.last').cells[0].value='999999';
  assertRefused(doc,LINEAGE);
});
test('AC-F3-3 a cell that takes another subject\'s source and value is refused',()=>{
  const doc=synthetic();const row=rowOf(doc,'quote.last');row.cells[0].source_id=row.cells[1].source_id;row.cells[0].value=row.cells[1].value;
  assertRefused(doc,LINEAGE);
});
test('AC-F3-4 a cell with no source but a value is refused',()=>{
  const doc=synthetic();const row=rowOf(doc,'quote.last');row.cells[0].source_id=null;row.cells[0].value='123';
  assertRefused(doc,LINEAGE);
});
test('AC-F3-5 a non-comparable row set to comparable with no reasons is refused with comparison_row_verdict_mismatch',()=>{
  const doc=synthetic();const row=doc.comparison.rows.find((candidate:any)=>!candidate.comparable);row.comparable=true;row.reasons=[];
  assertRefused(doc,VERDICT);
});
test('AC-F3-6 a reason appended to a row (flag unchanged) is refused',()=>{
  const doc=synthetic();const row=doc.comparison.rows.find((candidate:any)=>!candidate.comparable&&!candidate.reasons.includes('unit_mismatch'));
  row.reasons=[...row.reasons,'unit_mismatch'];
  assertRefused(doc,VERDICT);
});
test('AC-F3-7 the forged cell document is refused over MCP with no resource link',async()=>{
  const doc=synthetic();rowOf(doc,'quote.last').cells[0].value='999999';
  await withDefaultSession(async rpc=>{
    const reply=await mcpRender(rpc,doc);
    assert.ok(isRenderRefusal(reply),JSON.stringify(outcomeOf(reply)));
    assert.equal(hasResourceLink(reply),false);
  });
});
test('AC-F3-8 control: a receipt-based comparison document builds with no issue and renders over MCP',async()=>{
  const {session,built,doc}=await receiptSession(false);
  try{
    assert.deepStrictEqual(outcomeOf(built),{ok:true,code:'OK'});
    assert.deepStrictEqual(issuesOf(doc),[]);
    assert.deepStrictEqual(outcomeOf(await mcpRender(session.rpc,doc)),{ok:true,code:'OK'});
  }finally{await session.close();}
});
test('AC-F3-9 the invariant also applies to a mode actual document: a forged cell is a lineage issue',async()=>{
  const {session,doc}=await receiptSession(false);
  try{
    assert.equal(doc.mode,'actual');
    const edited=structuredClone(doc);rowOf(edited,'quote.last').cells[0].value='999999';
    assert.ok(issuesOf(edited).includes(LINEAGE),JSON.stringify(issuesOf(edited)));
  }finally{await session.close();}
});
test('AC-F3-10 control: documents built over undated quotes (pair and mixed) have no issue, render, and the pair is period_unconfirmed',()=>{
  const undated=(subject:typeof SUBJECT_A)=>callsOf(subject,'synthetic',{},{quote:{omit:['stck_bsop_date']}});
  const pair=buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([undated(SUBJECT_A),undated(SUBJECT_B)])));
  const mixed=buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([undated(SUBJECT_A),callsOf(SUBJECT_B,'synthetic')])));
  for(const doc of [pair,mixed]){assert.deepStrictEqual(issuesOf(doc),[]);assert.ok(renders(doc));}
  assert.ok(rowOf(pair,'quote.last').reasons.includes('period_unconfirmed'));
});
for(const [key,status] of [['a','missing'],['b','rights_pending'],['c','error'],['d','not_run']] as const){
  test(`AC-F3-11${key} a shown cell over a lineage metric with status ${status} is refused with comparison_cell_not_displayable`,()=>{
    const doc=synthetic();const cell=rowOf(doc,'quote.last').cells[1];
    doc.metrics.find((metric:any)=>metric.source_id===cell.source_id&&metric.field_id==='quote.last').status=status;
    assertRefused(doc,DISPLAY);
  });
}
test('AC-F3-12 regression guard: a pending-rights source is already shown as a dash in the table row and in the ledger',()=>{
  const doc=synthetic();const sourceId=rowOf(doc,'quote.last').cells[1].source_id;
  doc.sources.find((source:any)=>source.id===sourceId).rights='pending';
  doc.source_tables=(doc.source_tables??[]).filter((table:any)=>table.source_id!==sourceId);
  doc.visuals=(doc.visuals??[]).filter((visual:any)=>visual.source_id!==sourceId);
  const html=renderReportInputHtml(doc);const start=html.indexOf('data-r02-comparison');const section=html.slice(start,html.indexOf('</section>',start));
  const tableRow=(section.match(/<tr><td>[^<]*\(quote\.last\)<\/td>(?:<td[^>]*>[^<]*<\/td>)+<\/tr>/)??[''])[0];
  const ledger=html.match(/<tr><td>합성하이닉스 · 최근가<\/td><td>[^<]*<\/td>/g)??[];
  assert.ok(tableRow.includes('>100<')&&!tableRow.includes('>200<'),tableRow);
  assert.ok(ledger.length>0&&ledger.every(row=>row.endsWith('<td>—</td>')),JSON.stringify(ledger));
});
test('AC-F3-13 control: caller-supplied actual results build with no issue, render, and carry a source id over a null value',()=>{
  const doc=buildDoc(comparisonArgs(SUBJECTS_AB,allCalls(SUBJECTS_AB,'actual')));
  assert.deepStrictEqual(issuesOf(doc),[]);
  assert.ok(renders(doc));
  assert.ok(doc.comparison.rows.flatMap((row:any)=>row.cells).some((cell:any)=>cell.source_id!==null&&cell.value===null));
});
test('AC-F3-14 a nulled cell (source and value) over an existing metric is refused, even with a consistent verdict',()=>{
  const doc=synthetic();const row=rowOf(doc,'quote.last');
  row.cells[1]={subject_id:row.cells[1].subject_id,value:null,source_id:null};row.comparable=false;row.reasons=['value_missing'];
  assertRefused(doc,LINEAGE);
});
test('AC-F3-15 a deleted row is refused with comparison_row_set_mismatch',()=>{
  const doc=synthetic();doc.comparison.rows=doc.comparison.rows.filter((row:any)=>row.field_id!=='quote.last');
  assertRefused(doc,ROWSET);
});
test('AC-F3-16 a duplicated row is refused',()=>{
  const doc=synthetic();doc.comparison.rows.push(structuredClone(rowOf(doc,'quote.last')));
  assertRefused(doc,ROWSET);
});
test('AC-F3-17 reversed rows are refused',()=>{
  const doc=synthetic();doc.comparison.rows.reverse();
  assertRefused(doc,ROWSET);
});
test('AC-F3-18 an invented all-null row is refused',()=>{
  const doc=synthetic();
  doc.comparison.rows.push({field_id:'reported.revenue_invented',cells:doc.comparison.subjects.map((subject:any)=>({subject_id:subject.id,value:null,source_id:null})),comparable:false,reasons:['value_missing']});
  assertRefused(doc,ROWSET);
});
test('AC-F3-19 a second source of one subject declaring the same field is refused',()=>{
  const doc=synthetic();const cell=rowOf(doc,'quote.last').cells[1];
  const secondSource=sourceIdsOf(doc,SUBJECT_B.id,'get_fundamentals')[0];assert.ok(secondSource,'B has a fundamentals source');
  const metric=doc.metrics.find((candidate:any)=>candidate.source_id===cell.source_id&&candidate.field_id==='quote.last');
  doc.metrics.push({...metric,source_id:secondSource,value:'777'});
  assertRefused(doc,LINEAGE);
});

// ------------------------------------------------------------------ F4: identity text of an unaccepted issuer (build path)
test('AC-F4-1 a built document carries no source table of the unverified subject\'s filing source and no receipt number of it',()=>{
  const doc=syntheticBU();const html=renderReportInputHtml(doc);
  assert.deepStrictEqual(mappingStatuses(doc),['synthetic_fixture_match','unverified']);
  assert.equal(tablesOf(doc,sourceIdsOf(doc,SUBJECT_B.id,'get_public_filings')).length,0,'B filing tables');
  assert.ok(!html.includes(B_RCEPT),'B receipt number in the HTML');
});
test('AC-F4-2 control: the accepted subject keeps exactly one filing table and its receipt number',()=>{
  const doc=syntheticBU();const html=renderReportInputHtml(doc);
  assert.equal(tablesOf(doc,sourceIdsOf(doc,SUBJECT_A.id,'get_public_filings')).length,1,'A filing tables');
  assert.ok(html.includes(A_RCEPT));
});
test('AC-F4-3 control: the unverified subject\'s amount appears nowhere',()=>{
  const doc=syntheticBU();
  assert.ok(!JSON.stringify(doc).includes(B_REVENUE));
  assert.ok(!renderReportInputHtml(doc).includes(B_REVENUE));
});
test('AC-F4-4 receipt path: no B filing table, one A filing table, no B receipt number or term label in the document or the HTML',async()=>{
  resetFetchRecords();
  const {session,built,doc}=await receiptSession(true);
  try{
    assert.deepStrictEqual(outcomeOf(built),{ok:true,code:'OK'});
    assert.deepStrictEqual(mappingStatuses(doc),['verified_by_dart_filing','unverified']);
    const reply=await mcpRender(session.rpc,doc);const html=await readHtml(session.rpc,reply);const json=JSON.stringify(doc);
    assert.deepStrictEqual(outcomeOf(reply),{ok:true,code:'OK'});
    assert.equal(tablesOf(doc,sourceIdsOf(doc,SUBJECT_B.id,'get_public_filings')).length,0,'B filing tables');
    assert.equal(tablesOf(doc,sourceIdsOf(doc,SUBJECT_A.id,'get_public_filings')).length,1,'A filing tables');
    assert.ok(html.includes(A_RCEPT));
    for(const [where,text] of [['json',json],['html',html]] as const)for(const leak of [B_RCEPT,B_TERM])assert.ok(!text.includes(leak),`${leak} in the ${where}`);
    assert.deepStrictEqual(readFetchRecords(),[],'no network request');
  }finally{await session.close();}
});
test('AC-F4-5 every withheld metric of the unverified subject has the period issuer_mapping_unverified; neither text appears',()=>{
  const doc=syntheticBU();const html=renderReportInputHtml(doc);const json=JSON.stringify(doc);
  const withheld=metricsOf(doc,SUBJECT_B.id).filter((metric:any)=>metric.missing_reason==='issuer_mapping_unverified');
  assert.ok(withheld.length>0,'B has withheld metrics');
  assert.deepStrictEqual([...new Set(withheld.map((metric:any)=>metric.period))],['issuer_mapping_unverified']);
  assert.ok(!json.includes(B_RCEPT)&&!json.includes(B_TERM)&&!html.includes(B_TERM));
});
test('AC-F4-6 control: the accepted subject\'s DART metric periods keep the filing receipt number',()=>{
  const metrics=metricsOf(syntheticBU(),SUBJECT_A.id,'get_fundamentals');
  assert.ok(metrics.length>0);
  for(const metric of metrics)assert.ok(metric.period.endsWith(`:${A_RCEPT}`),metric.period);
});

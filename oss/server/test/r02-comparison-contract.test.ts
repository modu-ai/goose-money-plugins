// SPEC-ATP-R02-001 T1 (card t5-A): RED tests for the explicit-subjects comparison contract.
// Cells: AC-002, AC-003, AC-004, AC-005, AC-006a/006c, AC-007h (function half), AC-008a, AC-008c.
// Written before any source change: on the <T17> tree + commit B every cell below that needs the
// comparison path fails because `subjects`, the 1.2 contract and the new refusal codes do not exist.
// Synthetic data only (r02-fixtures.ts); no provider is reachable from here.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {buildReportInput,ReportInputSchema,renderReportInputHtml} from '../src/report-pipeline.js';
import {attributeComparison,type ComparisonAnalysis} from '../src/report-comparison.js';
import golden from './fixtures/r02-single-subject-golden.json' with {type:'json'};
import {
  ACQUISITION_KINDS,CLAUSE_OF,SENTINEL_AMOUNT,
  SUBJECT_A,SUBJECT_B,SUBJECT_C,SUBJECT_D,SUBJECT_E,SUBJECT_OTHER,SUBJECTS_AB,
  actualServer,acquisitionOf,allCalls,bindingMap,buildDoc,callsOf,clauseMessages,comparisonArgs,errorResult,filingsPayload,filingsResult,
  forge,fundamentalsResult,mappingOf,mcpBuild,metricsOf,openMcp,outcomeOf,priceHistoryCall,quoteResult,receiptArgs,receiptsFor,refusalOf,
  mcpRender,reasonSet,reversedCalls,rowFor,sourceIdsOf,sourceTool,subjectName,toolResult,unidentifiedFundamentalsResult,withDefaultSession,
  type Call,type Subject,
} from './r02-fixtures.js';
import {COMPARISON_REASONS} from '../src/report-comparison.js';
import {REASONS} from './r02-fixtures.js';

const QUOTE_FIELDS=['quote.last','quote.open','quote.high','quote.low','quote.change','quote.change_percent','quote.volume'];
const [FOUR_A,FOUR_B,FOUR_C,FOUR_D]=[SUBJECT_A,SUBJECT_B,SUBJECT_C,SUBJECT_D];

async function mcpOutcome(args:Record<string,unknown>){return withDefaultSession(async rpc=>outcomeOf(await mcpBuild(rpc,args)));}
async function mcpDoc(args:Record<string,unknown>):Promise<any>{
  return withDefaultSession(async rpc=>{
    const reply=await mcpBuild(rpc,args);
    assert.deepStrictEqual(outcomeOf(reply),{ok:true,code:'OK'},'build_report_input over MCP');
    return reply.result.structuredContent;
  });
}
const synthetic=(subjects:readonly Subject[])=>comparisonArgs(subjects,allCalls(subjects,'synthetic'));

// ------------------------------------------------------------------ AC-002
for(const n of [2,3,4]){
  test(`AC-002a ${n} subjects: contract 1.2, comparison block, every source bound by its content, shuffled call order`,()=>{
    const subjects=[FOUR_A,FOUR_B,FOUR_C,FOUR_D].slice(0,n);
    const owned=subjects.flatMap(subject=>callsOf(subject,'synthetic').map(call=>({call,owner:subject}))).reverse();
    const doc=buildDoc(comparisonArgs(subjects,owned.map(o=>o.call)));
    assert.equal(doc.isError,undefined);
    assert.equal(doc.contract_version,'atp.template/1.2');
    assert.equal(doc.comparison.subjects.length,n);
    assert.deepEqual(doc.comparison.subjects.map((s:any)=>s.id),subjects.map(s=>s.id),'subjects in input order');
    assert.equal(doc.subject.id,'compare:'+subjects.map(s=>s.id).join('+'));
    const bindings=bindingMap(doc);
    assert.equal(bindings.size,doc.sources.length,'one binding per source');
    for(const source of doc.sources)assert.ok(bindings.has(source.id),`binding for ${source.id}`);
    owned.forEach((o,i)=>assert.equal(bindings.get(`src-${i+1}-${o.call.tool_name}`),o.owner.id,`call ${i} (${o.call.tool_name}) binds by content`));
    assert.equal(ReportInputSchema.safeParse(doc).success,true,'a built 1.2 document parses');
  });
}
const FIVE=[SUBJECT_A,SUBJECT_B,SUBJECT_C,SUBJECT_D,SUBJECT_E];
const callsAB=allCalls(SUBJECTS_AB,'synthetic');
const invalidSubjectCases:[string,Record<string,unknown>][]=[
  ['(i) one subject',comparisonArgs([SUBJECT_A],callsOf(SUBJECT_A,'synthetic'))],
  ['(ii) five subjects',comparisonArgs(FIVE,allCalls(FIVE,'synthetic'))],
  ['(iii) duplicate subject id',comparisonArgs([SUBJECT_A,{...SUBJECT_B,id:SUBJECT_A.id}],callsAB)],
  ['(iv) duplicate kis_symbol',comparisonArgs([SUBJECT_A,{...SUBJECT_B,kis_symbol:SUBJECT_A.kis_symbol}],callsAB)],
  ['(v) duplicate corp_code_candidate',comparisonArgs([SUBJECT_A,{...SUBJECT_B,corp_code_candidate:SUBJECT_A.corp_code_candidate}],callsAB)],
  ['(vi) subject together with subjects',comparisonArgs(SUBJECTS_AB,callsAB,{subject:{id:'KRX:005930',name:'합성전자',venue:'KRX',currency:'KRW'}})],
  ['(vii) subjects on report R01',comparisonArgs(SUBJECTS_AB,callsAB,{report_id:'R01'})],
];
for(const [name,args] of invalidSubjectCases){
  test(`AC-002b ${name} -> comparison_subjects_invalid (function throw)`,()=>{assert.equal(refusalOf(args),'comparison_subjects_invalid');});
  test(`AC-002b ${name} -> comparison_subjects_invalid (MCP isError, not schema_drift)`,async()=>{
    assert.deepStrictEqual(await mcpOutcome(args),{ok:false,code:'comparison_subjects_invalid'});
  });
}
test('AC-002c regression guard: single-subject inputs without subjects equal the M0 golden and stay contract 1.1',()=>{
  for(const entry of golden.entries){
    const out=buildReportInput(structuredClone(entry.input) as unknown as Parameters<typeof buildReportInput>[0]);
    assert.equal(out.contract_version,'atp.template/1.1',entry.id);
    assert.deepStrictEqual(out,entry.expected,entry.id);
  }
});

// ------------------------------------------------------------------ AC-003
type Groups=Call[][];
const groupsAB=():Groups=>[callsOf(SUBJECT_A,'synthetic'),callsOf(SUBJECT_B,'synthetic')];
const mismatchCases:[string,string,()=>Record<string,unknown>][]=[
  ['003a B quote of another symbol','comparison_source_subject_mismatch',()=>{const g=groupsAB();g[1]![0]={tool_name:'get_market_snapshot',result:quoteResult(SUBJECT_B,{symbol:'035720'})};return comparisonArgs(SUBJECTS_AB,reversedCalls(g));}],
  ['003b A fundamentals for a corp_code outside the candidates','comparison_source_subject_mismatch',()=>{const g=groupsAB();g[0]![1]={tool_name:'get_fundamentals',result:fundamentalsResult(SUBJECT_A,{corpCode:'00999999'})};return comparisonArgs(SUBJECTS_AB,reversedCalls(g));}],
  ['003c A fundamentals without any identifier','comparison_source_unidentifiable',()=>{const g=groupsAB();g[0]![1]={tool_name:'get_fundamentals',result:unidentifiedFundamentalsResult()};return comparisonArgs(SUBJECTS_AB,reversedCalls(g));}],
  ['003d A gets a get_price_history result','comparison_tool_not_supported',()=>{const g=groupsAB();g[0]!.push(priceHistoryCall());return comparisonArgs(SUBJECTS_AB,reversedCalls(g));}],
  ['003e B currency USD','comparison_scope_unsupported',()=>comparisonArgs([SUBJECT_A,{...SUBJECT_B,currency:'USD'}],reversedCalls(groupsAB()))],
  ['003e-ii B quote describes an ETF','comparison_scope_unsupported',()=>{const g=groupsAB();g[1]![0]={tool_name:'get_market_snapshot',result:quoteResult(SUBJECT_B,{assetType:'etf'})};return comparisonArgs(SUBJECTS_AB,reversedCalls(g));}],
  ['003f A all synthetic, B all actual','comparison_origin_mixed',()=>comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,'synthetic'),callsOf(SUBJECT_B,'actual')]))],
];
for(const [name,code,make] of mismatchCases){
  test(`AC-${name} -> ${code} (function throw)`,()=>{assert.equal(refusalOf(make()),code);});
  test(`AC-${name} -> ${code} (MCP isError, not schema_drift)`,async()=>{assert.deepStrictEqual(await mcpOutcome(make()),{ok:false,code});});
}
test('AC-003f-ii mixed origin inside one subject (synthetic filings, actual receipts) is refused and consumes no receipt',async()=>{
  const {server}=actualServer();const session=await openMcp(server);
  try{
    const [aq,af,ap,bq,bf,bp]=await receiptsFor(session.rpc,SUBJECTS_AB);
    const mixed=receiptArgs(SUBJECTS_AB,[aq!,af!,bq!,bf!,bp!],{calls:[{tool_name:'get_public_filings',result:filingsResult(SUBJECT_A,{origin:'synthetic'})}]});
    assert.deepStrictEqual(outcomeOf(await mcpBuild(session.rpc,mixed)),{ok:false,code:'comparison_origin_mixed'});
    const retry=await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,[aq!,af!,ap!,bq!,bf!,bp!]));
    assert.deepStrictEqual(outcomeOf(retry),{ok:true,code:'OK'},'the same receipts still work after the refusal');
  }finally{await session.close();}
});
test('AC-003g regression guard: an error result for one source is a missing value, not a refusal',async()=>{
  const g=groupsAB();g[1]![0]={tool_name:'get_market_snapshot',result:errorResult('rights_pending')};
  const args=comparisonArgs(SUBJECTS_AB,reversedCalls(g));
  for(const doc of [buildDoc(args),await mcpDoc(args)]){
    assert.equal(doc.contract_version,'atp.template/1.2');
    const row=rowFor(doc,'quote.last');
    assert.equal(row.comparable,false);
    assert.ok(row.reasons.includes('value_missing'),`reasons ${JSON.stringify(row.reasons)}`);
  }
});

// Audit F5 / F6: two refusals of the binding step that no cell above pinned (mutation survivors M10, M24).
// A result whose request names A's candidate while its own rows name B's issuer is attributable to neither.
const rowsNamingOtherIssuer=(result:{structuredContent:unknown},corpCode:string)=>{
  const payload=structuredClone(result.structuredContent) as any;
  for(const row of payload.rows)row.raw.corp_code=corpCode;
  return toolResult(payload);
};
const reuseCases:[string,()=>Record<string,unknown>][]=[
  ['F5 get_fundamentals: request corp_code is A\'s candidate, the rows carry B\'s',()=>{const g=groupsAB();g[0]![1]={tool_name:'get_fundamentals',result:rowsNamingOtherIssuer(fundamentalsResult(SUBJECT_A),SUBJECT_B.corp_code_candidate)};return comparisonArgs(SUBJECTS_AB,reversedCalls(g));}],
  ['F5 get_public_filings: request corp_code is A\'s candidate, the rows carry B\'s',()=>{const g=groupsAB();g[0]![2]={tool_name:'get_public_filings',result:rowsNamingOtherIssuer(filingsResult(SUBJECT_A),SUBJECT_B.corp_code_candidate)};return comparisonArgs(SUBJECTS_AB,reversedCalls(g));}],
  ['F6 two get_market_snapshot sources for subject A',()=>{const g=groupsAB();g[0]!.push({tool_name:'get_market_snapshot',result:quoteResult(SUBJECT_A)});return comparisonArgs(SUBJECTS_AB,reversedCalls(g));}],
  ['F6 two get_public_filings sources for subject A',()=>{const g=groupsAB();g[0]!.push({tool_name:'get_public_filings',result:filingsResult(SUBJECT_A)});return comparisonArgs(SUBJECTS_AB,reversedCalls(g));}],
];
for(const [name,make] of reuseCases){
  test(`${name} -> comparison_source_subject_mismatch (function throw)`,()=>{assert.equal(refusalOf(make()),'comparison_source_subject_mismatch');});
  test(`${name} -> comparison_source_subject_mismatch (MCP isError, not schema_drift)`,async()=>{assert.deepStrictEqual(await mcpOutcome(make()),{ok:false,code:'comparison_source_subject_mismatch'});});
}

// ------------------------------------------------------------------ AC-004
function assertHidden(doc:any,subject:Subject){
  const mapping=mappingOf(doc,subject.id);
  assert.equal(mapping.status,'unverified');
  const dart=metricsOf(doc,subject.id,'get_fundamentals');
  assert.ok(dart.length>0,'the unverified subject still carries DART-derived metrics, hidden');
  for(const metric of dart){assert.equal(metric.value,null,metric.field_id);assert.equal(metric.missing_reason,'issuer_mapping_unverified',metric.field_id);}
  const row=rowFor(doc,'reported.revenue');
  const index=doc.comparison.subjects.findIndex((s:any)=>s.id===subject.id);
  assert.equal(row.cells[index].value,null);
  assert.ok(row.reasons.includes('issuer_mapping_unverified'));
}
test('AC-004a synthetic filings rows matching the KIS symbols -> synthetic_fixture_match and DART values shown',()=>{
  const doc=buildDoc(synthetic(SUBJECTS_AB));
  for(const subject of SUBJECTS_AB)assert.equal(mappingOf(doc,subject.id).status,'synthetic_fixture_match',subject.id);
  const revenue=metricsOf(doc,SUBJECT_A.id,'get_fundamentals').find(m=>m.field_id==='reported.revenue');
  assert.equal(revenue?.value,'1234567890');
});
test('AC-004b receipts of actual-labelled synthetic responses -> verified_by_dart_filing with evidence record',async()=>{
  const {server}=actualServer();const session=await openMcp(server);
  try{
    const receipts=await receiptsFor(session.rpc,SUBJECTS_AB);
    const reply=await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,receipts));
    assert.deepStrictEqual(outcomeOf(reply),{ok:true,code:'OK'});
    const doc=reply.result.structuredContent;
    for(const subject of SUBJECTS_AB){
      const mapping=mappingOf(doc,subject.id);
      assert.equal(mapping.status,'verified_by_dart_filing',subject.id);
      assert.equal(mapping.kis_symbol,subject.kis_symbol);
      assert.equal(mapping.corp_code,subject.corp_code_candidate);
      assert.equal(mapping.evidence_source_id,sourceIdsOf(doc,subject.id,'get_public_filings')[0]);
      assert.deepEqual([...mapping.matched_rcept_nos].sort(),filingsPayload(subject).list!.map((r:any)=>r.rcept_no as string).sort());
      assert.equal(mapping.acquisition,'process_receipt');
    }
  }finally{await session.close();}
});
test('AC-004c a filing row naming another KIS symbol -> issuer_mapping_conflict (function and MCP)',async()=>{
  const g=groupsAB();g[0]![2]={tool_name:'get_public_filings',result:filingsResult(SUBJECT_A,{stockCode:SUBJECT_B.kis_symbol})};
  const args=comparisonArgs(SUBJECTS_AB,reversedCalls(g));
  assert.equal(refusalOf(args),'issuer_mapping_conflict');
  assert.deepStrictEqual(await mcpOutcome(args),{ok:false,code:'issuer_mapping_conflict'});
});
test('AC-004d caller-supplied actual filings for A (not a receipt) -> A unverified, DART values hidden',async()=>{
  const {server}=actualServer();const session=await openMcp(server);
  try{
    const [aq,af,,bq,bf,bp]=await receiptsFor(session.rpc,SUBJECTS_AB);
    const reply=await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,[aq!,af!,bq!,bf!,bp!],{calls:[{tool_name:'get_public_filings',result:filingsResult(SUBJECT_A,{origin:'actual'})}]}));
    assert.deepStrictEqual(outcomeOf(reply),{ok:true,code:'OK'});
    assertHidden(reply.result.structuredContent,SUBJECT_A);
    assert.equal(mappingOf(reply.result.structuredContent,SUBJECT_B.id).status,'verified_by_dart_filing');
  }finally{await session.close();}
});
test('AC-004e no filings result for A -> A unverified, DART values hidden',()=>{
  const doc=buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,'synthetic',{filings:null}),callsOf(SUBJECT_B,'synthetic')])));
  assertHidden(doc,SUBJECT_A);
});
for(const [name,opts] of [['(i) status no_data, zero rows',{noData:true}],['(ii) every row with an empty stock_code',{stockCode:''}]] as const){
  test(`AC-004f ${name} -> A unverified, DART values hidden`,()=>{
    const g=groupsAB();g[0]![2]={tool_name:'get_public_filings',result:filingsResult(SUBJECT_A,opts)};
    assertHidden(buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls(g))),SUBJECT_A);
  });
}
test('AC-004g a filing row whose corp_name equals the subject name but whose stock_code is empty is not evidence',()=>{
  const g=groupsAB();g[0]![2]={tool_name:'get_public_filings',result:filingsResult(SUBJECT_A,{corpName:SUBJECT_A.name,stockCode:''})};
  assertHidden(buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls(g))),SUBJECT_A);
});

// Audit F2 (REQ-MAP-002): the hiding of an unverified subject's DART values must not depend on the tool name
// the caller attaches to a result. Each cell shows A's sentinel amount submitted under a tool name that is not
// the one the payload belongs to, with no genuine filings result for A (so A stays `unverified`).
const swapped=(tool:string,result:unknown,own:{funds?:Call|null;filings?:Call|null}={})=>{
  const g=groupsAB();const a=callsOf(SUBJECT_A,'synthetic',{funds:null,filings:null,...own});a.push({tool_name:tool,result});g[0]=a;
  return comparisonArgs(SUBJECTS_AB,reversedCalls(g));
};
const sentinelFunds=()=>fundamentalsResult(SUBJECT_A,{revenue:SENTINEL_AMOUNT});
const anywhere=(doc:any)=>JSON.stringify(doc).includes(SENTINEL_AMOUNT)||renderReportInputHtml(doc).includes(SENTINEL_AMOUNT);
test('F2 (a) A\'s financial statement under the name get_public_filings -> comparison_source_unidentifiable (function and MCP)',async()=>{
  const args=swapped('get_public_filings',sentinelFunds());
  assert.equal(refusalOf(args),'comparison_source_unidentifiable');
  assert.deepStrictEqual(await mcpOutcome(args),{ok:false,code:'comparison_source_unidentifiable'});
});
test('F2 (b) a filings list under the name get_fundamentals -> comparison_source_unidentifiable (function and MCP)',async()=>{
  const args=swapped('get_fundamentals',filingsResult(SUBJECT_A));
  assert.equal(refusalOf(args),'comparison_source_unidentifiable');
  assert.deepStrictEqual(await mcpOutcome(args),{ok:false,code:'comparison_source_unidentifiable'});
});
test('F2 (c) metrics a filings-named OpenDART source carries for an unverified subject never reach the ReportInput or the HTML',()=>{
  // Superseded premise (audit N2): this used to be built with the observation metric hidden. A filings result accepts
  // only the filings shape, so the observation carrier under that name is refused: no document, hence no sentinel.
  const observation={field_id:'reported.revenue',label:'매출',value:SENTINEL_AMOUNT,unit:'KRW',currency:'KRW',period:'2025-FY',scale:'1',period_kind:'FY',scope:'consolidated'};
  const payload={...(filingsResult(SUBJECT_A,{stockCode:''}).structuredContent as object),contract:'moai.stock.report-observations.v1',observations:[observation]};
  assert.equal(refusalOf(swapped('get_public_filings',toolResult(payload))),'comparison_source_unidentifiable');
});
test('F2 (d) A\'s financial statement under the name get_market_snapshot (instrument_ref added) never reaches the ReportInput or the HTML',()=>{
  // Superseded premise (audit N1): this used to be built with the DART-derived metric hidden. The quote slot now
  // accepts only a quote snapshot, so the stronger outcome is the coded refusal: no document, hence no sentinel.
  const payload={...(sentinelFunds().structuredContent as object),instrument_ref:{symbol:SUBJECT_A.kis_symbol,market:'KR',asset_type:'equity'}};
  const g=groupsAB();g[0]=[{tool_name:'get_market_snapshot',result:toolResult(payload)}];
  assert.equal(refusalOf(comparisonArgs(SUBJECTS_AB,reversedCalls(g))),'comparison_source_unidentifiable');
});
test('F2 control (regression guard): the same sentinel under its own tool names with matching filings evidence is still shown',()=>{
  const doc=buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,'synthetic',{funds:{tool_name:'get_fundamentals',result:sentinelFunds()}}),callsOf(SUBJECT_B,'synthetic')])));
  assert.equal(mappingOf(doc,SUBJECT_A.id).status,'synthetic_fixture_match');
  assert.ok(JSON.stringify(doc).includes(SENTINEL_AMOUNT));
});

// Audit N1 (REQ-SUB-004, REQ-MAP-002): the per-tool payload contract is uniform. The quote tool accepts only a quote
// snapshot; a result of another shape under its name (another issuer's financial statement, observation metrics)
// identifies nothing, even for a subject whose issuer mapping is verified. The DART tools accept only their own
// request shapes and none of the other metric-bearing contracts.
const asA=(payload:object)=>({...payload,instrument_ref:{symbol:SUBJECT_A.kis_symbol,market:'KR',asset_type:'equity'}});
const aWithQuoteSlot=(call:Call,over:{funds?:Call|null;filings?:Call|null}={})=>{
  const g=groupsAB();g[0]=callsOf(SUBJECT_A,'synthetic',{quote:call,funds:null,...over});
  return comparisonArgs(SUBJECTS_AB,reversedCalls(g));
};
test('N1 S7 another issuer\'s financial statement in A\'s quote slot (A\'s mapping verified) -> comparison_source_unidentifiable (function and MCP)',async()=>{
  const foreign=fundamentalsResult(SUBJECT_OTHER,{revenue:SENTINEL_AMOUNT}).structuredContent as {request:{corp_code:string}};
  assert.equal(foreign.request.corp_code,SUBJECT_OTHER.corp_code_candidate);
  const args=aWithQuoteSlot({tool_name:'get_market_snapshot',result:toolResult(asA(foreign))});
  assert.equal(refusalOf(args),'comparison_source_unidentifiable');
  assert.deepStrictEqual(await mcpOutcome(args),{ok:false,code:'comparison_source_unidentifiable'});
});
test('N1 S8 observation-contract metrics under the snapshot name (A unverified) -> comparison_source_unidentifiable (function and MCP)',async()=>{
  const observation={field_id:'reported.revenue',label:'매출',value:SENTINEL_AMOUNT,unit:'KRW',currency:'KRW',period:'2025-FY',scale:'1',period_kind:'FY',scope:'consolidated'};
  const payload={...(quoteResult(SUBJECT_A).structuredContent as object),contract:'moai.stock.report-observations.v1',observations:[observation]};
  const args=aWithQuoteSlot({tool_name:'get_market_snapshot',result:toolResult(payload)},{filings:null});
  assert.equal(refusalOf(args),'comparison_source_unidentifiable');
  assert.deepStrictEqual(await mcpOutcome(args),{ok:false,code:'comparison_source_unidentifiable'});
});
test('N1 a quote snapshot that also carries a DART request or OpenDART source -> comparison_source_unidentifiable',()=>{
  const quote=quoteResult(SUBJECT_A).structuredContent as object;
  const withRequest=aWithQuoteSlot({tool_name:'get_market_snapshot',result:toolResult({...quote,request:{corp_code:SUBJECT_A.corp_code_candidate}})});
  assert.equal(refusalOf(withRequest),'comparison_source_unidentifiable');
  const withSource=aWithQuoteSlot({tool_name:'get_market_snapshot',result:toolResult({...quote,source:'opendart'})});
  assert.equal(refusalOf(withSource),'comparison_source_unidentifiable');
});
test('N1 a quote snapshot carried by a DART tool, or a price history under a filings name -> comparison_source_unidentifiable',()=>{
  const quoteShape={...(fundamentalsResult(SUBJECT_A).structuredContent as object),operation_id:'kis.kr.quote.snapshot.v1',data:{last:SENTINEL_AMOUNT}};
  const underFunds=aWithQuoteSlot({tool_name:'get_market_snapshot',result:quoteResult(SUBJECT_A)},{funds:{tool_name:'get_fundamentals',result:toolResult(quoteShape)}});
  assert.equal(refusalOf(underFunds),'comparison_source_unidentifiable');
  const history={...(filingsResult(SUBJECT_A).structuredContent as object),...((priceHistoryCall().result as {structuredContent:object}).structuredContent)};
  const underFilings=aWithQuoteSlot({tool_name:'get_market_snapshot',result:quoteResult(SUBJECT_A)},{filings:{tool_name:'get_public_filings',result:toolResult(history)}});
  assert.equal(refusalOf(underFilings),'comparison_source_unidentifiable');
});
test('N1 control (S9, regression guard): the genuine filings + fundamentals pair builds, sentinel shown with scale_unconfirmed',()=>{
  const doc=buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,'synthetic',{funds:{tool_name:'get_fundamentals',result:sentinelFunds()}}),callsOf(SUBJECT_B,'synthetic')])));
  assert.equal(mappingOf(doc,SUBJECT_A.id).status,'synthetic_fixture_match');
  const row=rowFor(doc,'reported.revenue');
  assert.equal(row.cells.find((cell:any)=>cell.subject_id===SUBJECT_A.id).value,SENTINEL_AMOUNT);
  assert.ok(row.reasons.includes('scale_unconfirmed'),JSON.stringify(row.reasons));
});
test('N1 control: a legitimate quote snapshot of a verified subject still builds with its quote values attributed to it',()=>{
  const doc=buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,'synthetic'),callsOf(SUBJECT_B,'synthetic')])));
  assert.equal(mappingOf(doc,SUBJECT_A.id).status,'synthetic_fixture_match');
  assert.equal(rowFor(doc,'quote.last').cells.find((cell:any)=>cell.subject_id===SUBJECT_A.id).value,'100');
});

// ------------------------------------------------------------------ AC-005
function variant(a:{quote?:any;funds?:any;filings?:any},b:{quote?:any;funds?:any;filings?:any}={},origin:'synthetic'|'actual'='synthetic'){
  return buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,origin,{},a),callsOf(SUBJECT_B,origin,{},b)])));
}
test('AC-005a same-date quotes -> quote field rows comparable with no reasons',()=>{
  const doc=buildDoc(synthetic(SUBJECTS_AB));
  for(const field of QUOTE_FIELDS){const row=rowFor(doc,field);assert.equal(row.comparable,true,field);assert.deepEqual(reasonSet(row),[],field);}
});
test('AC-005b same business year/report/scope, different receipt number and term label -> only scale_unconfirmed',()=>{
  const doc=buildDoc(synthetic(SUBJECTS_AB));
  for(const field of ['reported.revenue','reported.operating_profit']){const row=rowFor(doc,field);assert.equal(row.comparable,false,field);assert.deepEqual(reasonSet(row),['scale_unconfirmed'],field);}
});
test('AC-005c different business year -> period_mismatch and scale_unconfirmed',()=>{
  const reasons=reasonSet(rowFor(variant({},{funds:{year:'2024'}}),'reported.revenue'));
  assert.ok(reasons.includes('period_mismatch')&&reasons.includes('scale_unconfirmed'),JSON.stringify(reasons));
});
test('AC-005d consolidated against separate -> scope_mismatch',()=>{
  const reasons=reasonSet(rowFor(variant({},{funds:{fsDiv:'OFS'}}),'reported.revenue'));
  assert.ok(reasons.includes('scope_mismatch'),JSON.stringify(reasons));
});
test('AC-005e different quote date only -> exactly period_mismatch',()=>{
  const row=rowFor(variant({},{quote:{date:'20261021'}}),'quote.last');
  assert.equal(row.comparable,false);assert.deepEqual(reasonSet(row),['period_mismatch']);
});
test('AC-005f different currency -> currency_mismatch and the input values unchanged (no conversion)',()=>{
  const row=rowFor(variant({},{funds:{currency:'USD'}}),'reported.revenue');
  assert.ok(row.reasons.includes('currency_mismatch'),JSON.stringify(row.reasons));
  assert.deepEqual(row.cells.map((c:any)=>c.value),['1234567890','2234567890']);
});
test('AC-005g a missing quote field of one subject -> value_missing for that row',()=>{
  const row=rowFor(variant({},{quote:{omit:['stck_hgpr']}}),'quote.high');
  assert.equal(row.comparable,false);assert.ok(row.reasons.includes('value_missing'),JSON.stringify(row.reasons));
});
test('AC-005h all sources actual via calls -> built (not mixed); rights_not_confirmed and issuer_mapping_unverified',()=>{
  const doc=buildDoc(comparisonArgs(SUBJECTS_AB,allCalls(SUBJECTS_AB,'actual')));
  assert.ok(rowFor(doc,'quote.last').reasons.includes('rights_not_confirmed'));
  assert.ok(rowFor(doc,'reported.revenue').reasons.includes('issuer_mapping_unverified'));
});
test('AC-005i the judgment function names unit_mismatch and scale_mismatch for metrics that differ only in unit or scale',async()=>{
  const specifier='../src/report-comparison.js';
  let judge:any;
  try{judge=(await import(specifier)).judgeFieldComparability;}catch(error){assert.fail(`report-comparison module is not present: ${String(error).slice(0,120)}`);}
  assert.equal(typeof judge,'function','report-comparison exports judgeFieldComparability(metrics)');
  const metric=(source_id:string,over:Record<string,unknown>)=>({field_id:'quote.last',label:'최근가',value:'100',unit:'KRW/share',currency:'KRW',status:'synthetic',source_id,period:'2026-10-22',scale:'1',period_kind:'observation',scope:'not_applicable',...over});
  const unit=judge([metric('s1',{}),metric('s2',{unit:'USD/share'})]);
  assert.equal(unit.comparable,false);assert.deepEqual([...unit.reasons].sort(),['unit_mismatch']);
  const scale=judge([metric('s1',{}),metric('s2',{scale:'1000'})]);
  assert.equal(scale.comparable,false);assert.deepEqual([...scale.reasons].sort(),['scale_mismatch']);
});
test('AC-005j no rank/order/winner/difference keys, exact row keys, cells in input order (value order is reversed)',()=>{
  const docs=[
    buildDoc(synthetic(SUBJECTS_AB)),variant({},{funds:{year:'2024'}}),variant({},{funds:{fsDiv:'OFS'}}),variant({},{quote:{date:'20261021'}}),
    variant({},{funds:{currency:'USD'}}),variant({},{quote:{omit:['stck_hgpr']}}),buildDoc(comparisonArgs(SUBJECTS_AB,allCalls(SUBJECTS_AB,'actual'))),
  ];
  const banned=['rank','order','winner','prefer','diff','delta','better'];
  const keys=(value:unknown,out:string[]=[]):string[]=>{if(Array.isArray(value))value.forEach(v=>keys(v,out));else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){out.push(k);keys(v,out);}return out;};
  for(const doc of docs){
    const bad=keys(doc.comparison).filter(k=>banned.some(word=>k.toLowerCase().includes(word)));
    assert.deepEqual(bad,[],'no ranking-like keys');
    assert.ok(doc.comparison.rows.length>0);
    for(const row of doc.comparison.rows){
      assert.deepEqual(Object.keys(row).sort(),['cells','comparable','field_id','reasons']);
      assert.deepEqual(row.cells.map((c:any)=>c.subject_id),SUBJECTS_AB.map(s=>s.id),`${row.field_id} cell order`);
    }
  }
  const last=rowFor(docs[0],'quote.last');
  assert.deepEqual(last.cells.map((c:any)=>c.value),['100','200'],'values are in input order even though B > A');
});

// ------------------------------------------------------------------ AC-006 (a, c)
function collectEnums(value:unknown,out:unknown[][]=[]):unknown[][]{
  if(Array.isArray(value))value.forEach(v=>collectEnums(v,out));
  else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){if(k==='enum'&&Array.isArray(v))out.push(v);else collectEnums(v,out);}
  return out;
}
test('AC-006a the 1.2 contract file lists exactly the three acquisition kinds',()=>{
  let schema:unknown;
  try{schema=JSON.parse(readFileSync(new URL('../../contracts/report-input-v1.2.schema.json',import.meta.url),'utf8'));}
  catch(error){assert.fail(`contracts/report-input-v1.2.schema.json is not readable: ${String(error).slice(0,120)}`);}
  const enums=collectEnums(schema).filter(list=>list.some(item=>ACQUISITION_KINDS.includes(item as never)));
  assert.equal(enums.length,1,'one acquisition-kind enum');
  assert.deepEqual(enums[0],[...ACQUISITION_KINDS]);
  assert.ok(!JSON.stringify(schema).includes('live_query'));
});
test('AC-006a the runtime schema rejects an acquisition kind outside the closed set',()=>{
  const doc=structuredClone(buildDoc(synthetic(SUBJECTS_AB)));
  assert.equal(ReportInputSchema.safeParse(doc).success,true,'control document parses');
  doc.comparison.acquisitions[0].kind='live_query';
  assert.equal(ReportInputSchema.safeParse(doc).success,false);
});
test('AC-006c synthetic sources are synthetic_fixture; one label per source',()=>{
  const doc=buildDoc(synthetic(SUBJECTS_AB));
  assert.equal(doc.comparison.acquisitions.length,doc.sources.length);
  for(const source of doc.sources)assert.equal(acquisitionOf(doc,source.id),'synthetic_fixture',source.id);
});
test('AC-006c receipt sources are process_receipt and a caller-supplied actual source is caller_supplied_unverified',async()=>{
  const {server}=actualServer();const session=await openMcp(server);
  try{
    const [aq,af,,bq,bf,bp]=await receiptsFor(session.rpc,SUBJECTS_AB);
    const reply=await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,[aq!,af!,bq!,bf!,bp!],{calls:[{tool_name:'get_public_filings',result:filingsResult(SUBJECT_A,{origin:'actual'})}]}));
    assert.deepStrictEqual(outcomeOf(reply),{ok:true,code:'OK'});
    const doc=reply.result.structuredContent;
    const callerFilings=sourceIdsOf(doc,SUBJECT_A.id,'get_public_filings');
    assert.equal(callerFilings.length,1);
    assert.equal(acquisitionOf(doc,callerFilings[0]!),'caller_supplied_unverified');
    for(const source of doc.sources)if(source.id!==callerFilings[0])assert.equal(acquisitionOf(doc,source.id),'process_receipt',source.id);
    for(const source of doc.sources)assert.ok((ACQUISITION_KINDS as readonly string[]).includes(acquisitionOf(doc,source.id)??''));
  }finally{await session.close();}
});

// ------------------------------------------------------------------ AC-007h (function half)
const FORGERIES:[string,'v'|'vi'|'vii'|'viii'|'ix'|'x'|'xi'|'xii'|'xiii'][]=[
  ['(v) clause existence, receipt label','v'],['(vi) clause kind, receipt label','vi'],['(vii) clause kind, verified label','vii'],
  ['(viii) clause validation status, receipt label','viii'],['(ix) clause user_supplied ban','ix'],['(x) clause rights, receipt label','x'],
  ['(xi) clause existence, verified label','xi'],['(xii) clause rights, verified label','xii'],['(xiii) clause validation status, verified label','xiii'],
];
test('AC-007h control: the unforged synthetic comparison document parses and emits no clause message',()=>{
  const parsed=ReportInputSchema.safeParse(buildDoc(synthetic(SUBJECTS_AB)));
  assert.equal(parsed.success,true);
});
for(const [name,key] of FORGERIES){
  test(`AC-007h ${name}: invalid, and exactly its own clause message is emitted`,()=>{
    const forged=forge(buildDoc(synthetic(SUBJECTS_AB)),key);
    const parsed=ReportInputSchema.safeParse(forged);
    assert.equal(parsed.success,false,'the forged document is invalid');
    assert.deepEqual(clauseMessages(parsed),[CLAUSE_OF[key]]);
  });
}
test('AC-007h (xii) on the second subject: the verified-mark clause is not limited to the first subject (audit N5-2)',()=>{
  const forged=forge(buildDoc(synthetic(SUBJECTS_AB)),'xii',SUBJECT_B);
  const parsed=ReportInputSchema.safeParse(forged);
  assert.equal(parsed.success,false);
  assert.deepEqual(clauseMessages(parsed),[CLAUSE_OF.xii]);
});
for(const key of ['aux-i','aux-ii','aux-iii'] as const){
  test(`AC-007h auxiliary ${key} (regression guard, over-determined): invalid`,()=>{
    assert.equal(ReportInputSchema.safeParse(forge(buildDoc(synthetic(SUBJECTS_AB)),key)).success,false);
  });
}
test('AC-007h auxiliary (iv) (regression guard): a provider-kind local_view receipt-labelled source passes the five clauses',()=>{
  const parsed=ReportInputSchema.safeParse(forge(buildDoc(synthetic(SUBJECTS_AB)),'aux-iv'));
  assert.equal(parsed.success,true,JSON.stringify(parsed.success?[]:parsed.error.issues.map(i=>i.message)));
});

// ------------------------------------------------------------------ AC-008 (a, c)
test('AC-008a metrics, source titles and source tables carry the bound subject name; no chart or time series; visuals bound',()=>{
  const doc=buildDoc(synthetic(SUBJECTS_AB));
  const bindings=bindingMap(doc);
  assert.ok(doc.metrics.length>0);
  for(const metric of doc.metrics)assert.ok(metric.label.startsWith(`${subjectName(doc,bindings.get(metric.source_id)!)} · `),`${metric.source_id} ${metric.label}`);
  for(const source of doc.sources)assert.ok(source.title.startsWith(`${subjectName(doc,bindings.get(source.id)!)} · `),`${source.id} ${source.title}`);
  assert.ok((doc.source_tables??[]).length>0);
  for(const table of doc.source_tables??[])assert.ok(table.title.startsWith(`${subjectName(doc,bindings.get(table.source_id)!)} · `),`${table.source_id} ${table.title}`);
  assert.equal(doc.chart,null);assert.equal(doc.time_series,null);
  for(const visual of doc.visuals??[])assert.ok(bindings.has(visual.source_id));
});
test('AC-008c an unverified subject\'s DART amount never reaches the ReportInput or the rendered HTML',()=>{
  const doc=buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,'synthetic',{filings:null},{funds:{revenue:SENTINEL_AMOUNT}}),callsOf(SUBJECT_B,'synthetic')])));
  assert.ok(!JSON.stringify(doc).includes(SENTINEL_AMOUNT),'ReportInput JSON (metrics and source_tables raw rows)');
  assert.ok(!renderReportInputHtml(doc).includes(SENTINEL_AMOUNT),'rendered HTML');
});
test('AC-008c control: with matching filings evidence the same amount is shown',()=>{
  const doc=buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,'synthetic',{},{funds:{revenue:SENTINEL_AMOUNT}}),callsOf(SUBJECT_B,'synthetic')])));
  assert.ok(JSON.stringify(doc).includes(SENTINEL_AMOUNT));
});

// ------------------------------------------------------------------ Audit N2 (REQ-BAS-001, plan D3)
// Each pilot tool owns exactly its one real output shape. The observation-contract carrier (a shape that can declare
// any field) is not the output of any pilot tool, so it identifies nothing under any of the three tool names; and no
// two sources of one subject may declare the same field, whatever their shape. The verdict never depends on call order.
const OBSERVATION_CONTRACT='moai.stock.report-observations.v1';
const observation=(field_id:string,value:string,extra:Record<string,unknown>={})=>({field_id,label:'관측',value,unit:'KRW',currency:'KRW',period:'2025-FY',scale:'1',period_kind:'FY',scope:'consolidated',...extra});
const asObservationCarrier=(base:{structuredContent:unknown},observations:object[])=>toolResult({...(base.structuredContent as object),contract:OBSERVATION_CONTRACT,observations});
const aOver=(over:{funds?:Call|null;filings?:Call|null})=>[...callsOf(SUBJECT_A,'synthetic',over),...callsOf(SUBJECT_B,'synthetic')];
const orders=(calls:readonly Call[],subjects:readonly Subject[]=SUBJECTS_AB)=>[[...calls],[...calls].reverse(),[...calls.slice(2),...calls.slice(0,2)]].map(order=>comparisonArgs(subjects,order));
const rowSignature=(args:Record<string,unknown>)=>{
  try{
    const doc=buildReportInput(args as unknown as Parameters<typeof buildReportInput>[0]) as any;
    return JSON.stringify(doc.comparison.rows.map((row:any)=>({...row,cells:row.cells.map((cell:any)=>({...cell,source_id:cell.source_id===null?null:sourceTool(cell.source_id)}))})));
  }catch(error){return error instanceof Error?error.message:String(error);}
};
const O4_CARRIER_UNDER_FILINGS=()=>aOver({filings:{tool_name:'get_public_filings',result:asObservationCarrier(filingsResult(SUBJECT_A),[observation('reported.revenue',SENTINEL_AMOUNT)])}});
const O1_CARRIER_UNDER_FUNDAMENTALS=()=>aOver({funds:{tool_name:'get_fundamentals',result:asObservationCarrier(fundamentalsResult(SUBJECT_A),[observation('quote.last',SENTINEL_AMOUNT,{unit:'KRW/share',period:'2026-10-22',period_kind:'observation',scope:'not_applicable'}),observation('reported.revenue','123')])}});
for(const [name,make] of [['O4 an observation carrier declaring reported.revenue under get_public_filings (A\'s genuine fundamentals present)',O4_CARRIER_UNDER_FILINGS],['O1 an observation carrier declaring quote.last under get_fundamentals',O1_CARRIER_UNDER_FUNDAMENTALS]] as const){
  test(`N2 ${name} -> comparison_source_unidentifiable in every call order (function and MCP)`,async()=>{
    for(const args of orders(make())){
      assert.equal(refusalOf(args),'comparison_source_unidentifiable');
      assert.deepStrictEqual(await mcpOutcome(args),{ok:false,code:'comparison_source_unidentifiable'});
    }
  });
  test(`N2 ${name}: the verdict is the same in every call order`,()=>{
    const [forward,...others]=orders(make()).map(rowSignature);
    assert.equal(forward,'comparison_source_unidentifiable');
    for(const other of others)assert.equal(other,forward);
  });
}
test('N2 determinism: every accepted document yields identical comparison rows whatever the call order',()=>{
  const four=[SUBJECT_A,SUBJECT_B,SUBJECT_C,SUBJECT_D];
  const documents:[string,readonly Call[],readonly Subject[]][]=[
    ['both subjects synthetic',[...callsOf(SUBJECT_A,'synthetic'),...callsOf(SUBJECT_B,'synthetic')],SUBJECTS_AB],
    ['A without filings (unverified)',[...callsOf(SUBJECT_A,'synthetic',{filings:null}),...callsOf(SUBJECT_B,'synthetic')],SUBJECTS_AB],
    ['both subjects caller-supplied actual',[...callsOf(SUBJECT_A,'actual'),...callsOf(SUBJECT_B,'actual')],SUBJECTS_AB],
    ['four subjects synthetic',four.flatMap(subject=>callsOf(subject,'synthetic')),four],
  ];
  for(const [name,calls,subjects] of documents){
    const [forward,...others]=orders(calls,subjects).map(rowSignature);
    assert.ok(forward!.startsWith('[{'),`${name}: built (${forward!.slice(0,80)})`);
    for(const other of others)assert.equal(other,forward,name);
  }
});
test('N2 duplicate-field guard: two sources of one subject declaring the same field -> comparison_source_subject_mismatch; other pairs are untouched',()=>{
  const metric=(source_id:string,field_id:string,value:string)=>({source_id,field_id,label:field_id,value,unit:'KRW',currency:'KRW',scale:'1',period:'2025-FY',period_kind:'FY',scope:'consolidated',status:'ok'});
  const analysis=():ComparisonAnalysis=>({bindings:new Map([['s1',SUBJECT_A],['s2',SUBJECT_A],['b1',SUBJECT_B]]),acquisitions:new Map(),mappings:[],hidden:new Set(),hiddenTables:new Set()});
  const parts=(metrics:object[])=>({sources:[],metrics,source_tables:[],visuals:[]}) as never;
  const run=(metrics:object[])=>attributeComparison(SUBJECTS_AB,analysis(),parts(metrics));
  assert.throws(()=>run([metric('s1','reported.revenue','1'),metric('s2','reported.revenue','2'),metric('b1','reported.revenue','3')]),/comparison_source_subject_mismatch/);
  assert.throws(()=>run([metric('s2','reported.revenue','2'),metric('s1','reported.revenue','1')]),/comparison_source_subject_mismatch/,'the reverse metric order');
  assert.equal(run([metric('s1','reported.revenue','1'),metric('s2','quote.last','2'),metric('b1','reported.revenue','3')]).comparison.rows.length,2,'different fields of one subject, same field of two subjects');
});

// Regression guards for the real-data paths (green before and after the allowlist): the genuine shapes of the three
// pilot tools are still accepted, both as receipts (process_receipt, local_view) and as caller-supplied actual results.
test('N2 control (receipts): a receipt-based document built from the server-issued outputs of the three pilot tools is built and rendered',async()=>{
  const {server}=actualServer();const session=await openMcp(server);
  try{
    const reply=await mcpBuild(session.rpc,receiptArgs(SUBJECTS_AB,await receiptsFor(session.rpc,SUBJECTS_AB)));
    assert.deepStrictEqual(outcomeOf(reply),{ok:true,code:'OK'});
    const doc=reply.result.structuredContent;
    for(const subject of SUBJECTS_AB){
      for(const tool of ['get_market_snapshot','get_fundamentals','get_public_filings'])assert.equal(sourceIdsOf(doc,subject.id,tool).length,1,`${subject.id} ${tool}`);
      assert.equal(mappingOf(doc,subject.id).status,'verified_by_dart_filing',subject.id);
    }
    for(const source of doc.sources)assert.equal(acquisitionOf(doc,source.id),'process_receipt',source.id);
    for(const field of ['quote.last','reported.revenue']){const row=rowFor(doc,field);for(const cell of row.cells)assert.notEqual(cell.value,null,`${field} ${cell.subject_id}`);}
    assert.deepStrictEqual(reasonSet(rowFor(doc,'reported.revenue')),['scale_unconfirmed']);
    assert.deepStrictEqual(outcomeOf(await mcpRender(session.rpc,doc)),{ok:true,code:'OK'},'rendered over MCP');
    const html=renderReportInputHtml(doc);
    for(const subject of SUBJECTS_AB)assert.ok(html.includes(subject.name),subject.name);
  }finally{await session.close();}
});
for(const tool of ['get_market_snapshot','get_fundamentals','get_public_filings'] as const){
  test(`N2 control (caller-supplied actual): the genuine ${tool} shape is accepted, labelled caller_supplied_unverified, and its values stay hidden or pending`,()=>{
    const doc=buildDoc(comparisonArgs(SUBJECTS_AB,[...callsOf(SUBJECT_A,'actual'),...callsOf(SUBJECT_B,'actual')]));
    for(const subject of SUBJECTS_AB){
      const ids=sourceIdsOf(doc,subject.id,tool);
      assert.equal(ids.length,1,`${subject.id} has a ${tool} source`);
      assert.equal(acquisitionOf(doc,ids[0]!),'caller_supplied_unverified',`${subject.id} ${tool}`);
      assert.equal(mappingOf(doc,subject.id).status,'unverified',subject.id);
      for(const metric of metricsOf(doc,subject.id,tool)){
        assert.equal(metric.value,null,`${subject.id} ${metric.field_id} shows no value`);
        assert.ok(metric.status==='rights_pending'||metric.missing_reason==='issuer_mapping_unverified',`${subject.id} ${metric.field_id} ${metric.status}/${metric.missing_reason}`);
      }
    }
    assert.ok(!JSON.stringify(doc).includes(SENTINEL_AMOUNT));
  });
}

// ------------------------------------------------------------------ AC-005k..q: quotes without a business date (card t5, leader verdict HOLD-RETURN-TO-RUN)
// A quote result without `stck_bsop_date` has no real `source_as_of`, so the pipeline substitutes the run's single
// `received_at` as the metric period. Two such quotes carry EQUAL substituted periods, which is not evidence of one shared
// market date: the dates are unknown, not equal. The comparison must call that period unconfirmed, and must not claim a
// mismatch it did not observe. Cells below only add; no existing assertion is edited.
const UNDATED={omit:['stck_bsop_date']};
const DATED_PERIOD='2026-10-22';
/** Rows in which every cell shows a value taken from a quote source (a missing value is judged value_missing, not by its period). */
const shownQuoteRows=(doc:any):any[]=>doc.comparison.rows.filter((row:any)=>row.cells.every((cell:any)=>cell.value!==null&&cell.source_id!==null&&sourceTool(cell.source_id)==='get_market_snapshot'));
const quoteSourceOf=(doc:any,subject:Subject):any=>doc.sources.find((source:any)=>source.id===sourceIdsOf(doc,subject.id,'get_market_snapshot')[0]);
const quotePeriodsOf=(doc:any,subject:Subject):string[]=>[...new Set<string>(metricsOf(doc,subject.id,'get_market_snapshot').map((metric:any)=>metric.period))];
/** Premise guard: the subject's quote carries no business date and its metrics took the receipt time as their period. */
function assertSubstituted(doc:any,subject:Subject){
  const source=quoteSourceOf(doc,subject);
  assert.ok(source.source_as_of==null,`${subject.id} quote has no source_as_of: ${String(source.source_as_of)}`);
  assert.deepStrictEqual(quotePeriodsOf(doc,subject),[source.received_at],`${subject.id} quote period is the substituted receipt time`);
}
function assertDated(doc:any,subject:Subject){assert.deepStrictEqual(quotePeriodsOf(doc,subject),[DATED_PERIOD],`${subject.id} quote period is its business date`);}
function assertPeriodUnconfirmed(doc:any,label:string){
  const rows=shownQuoteRows(doc);
  for(const field of QUOTE_FIELDS)assert.ok(rows.some(row=>row.field_id===field),`${label}: shown row ${field} exists`);
  for(const row of rows){
    assert.equal(row.comparable,false,`${label}: ${row.field_id} must not be comparable (reasons ${JSON.stringify(row.reasons)})`);
    assert.ok(row.reasons.includes('period_unconfirmed'),`${label}: ${row.field_id} names the unconfirmed period: ${JSON.stringify(row.reasons)}`);
    assert.ok(!row.reasons.includes('period_mismatch'),`${label}: ${row.field_id} claims no mismatch that was not observed: ${JSON.stringify(row.reasons)}`);
  }
}
test('AC-005k two quotes without a business date -> the equal substituted receipt time is not a shared date: every quote row is not comparable (period_unconfirmed)',()=>{
  const doc=variant({quote:UNDATED},{quote:UNDATED});
  for(const subject of SUBJECTS_AB)assertSubstituted(doc,subject);
  assertPeriodUnconfirmed(doc,'undated pair');
  assert.equal(ReportInputSchema.safeParse(doc).success,true,'the document still parses');
});
test('AC-005l control (green before and after): two dated quotes stay comparable with no reasons',()=>{
  const doc=buildDoc(synthetic(SUBJECTS_AB));
  for(const subject of SUBJECTS_AB)assertDated(doc,subject);
  const rows=shownQuoteRows(doc);
  for(const field of QUOTE_FIELDS)assert.ok(rows.some(row=>row.field_id===field),`shown row ${field} exists`);
  for(const row of rows){assert.equal(row.comparable,true,row.field_id);assert.deepStrictEqual(row.reasons,[],row.field_id);}
});
test('AC-005m one dated quote and one without a business date -> not comparable, period_unconfirmed and no claimed mismatch (either order)',()=>{
  for(const [label,a,b] of [['B undated',{},{quote:UNDATED}],['A undated',{quote:UNDATED},{}]] as const){
    const doc=variant(a,b);
    assertSubstituted(doc,label==='B undated'?SUBJECT_B:SUBJECT_A);assertDated(doc,label==='B undated'?SUBJECT_A:SUBJECT_B);
    assertPeriodUnconfirmed(doc,label);
  }
});
test('AC-005n observed date differences stay named: two dated quotes on different dates plus one without a date -> period_mismatch and period_unconfirmed',()=>{
  const three=[SUBJECT_A,SUBJECT_B,SUBJECT_C];
  const doc=buildDoc(comparisonArgs(three,reversedCalls([callsOf(SUBJECT_A,'synthetic'),callsOf(SUBJECT_B,'synthetic',{},{quote:{date:'20261021'}}),callsOf(SUBJECT_C,'synthetic',{},{quote:UNDATED})])));
  assert.equal(rowFor(doc,'quote.last').comparable,false);
  assert.deepStrictEqual(reasonSet(rowFor(doc,'quote.last')),['period_mismatch','period_unconfirmed']);
});
test('AC-005o the verdict does not depend on call order: forward and reversed calls give identical rows for the undated pair',()=>{
  const groups=[callsOf(SUBJECT_A,'synthetic',{},{quote:UNDATED}),callsOf(SUBJECT_B,'synthetic',{},{quote:UNDATED})];
  const forward=buildDoc(comparisonArgs(SUBJECTS_AB,groups.flat()));
  const reversed=buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls(groups)));
  assertPeriodUnconfirmed(forward,'forward');assertPeriodUnconfirmed(reversed,'reversed');
  // Source ids carry the position of their call (`src-<n>-<tool>`), so the rows are compared by verdict and value, not by those ids.
  const verdicts=(doc:any)=>doc.comparison.rows.map((row:any)=>({field_id:row.field_id,comparable:row.comparable,reasons:row.reasons,cells:row.cells.map((cell:any)=>({subject_id:cell.subject_id,value:cell.value}))}));
  assert.deepStrictEqual(verdicts(forward),verdicts(reversed));
});
test('AC-005p over MCP (the real handler path): the undated pair and the mixed pair are not comparable, the dated pair is',async()=>{
  const undated=await mcpDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,'synthetic',{},{quote:UNDATED}),callsOf(SUBJECT_B,'synthetic',{},{quote:UNDATED})])));
  for(const subject of SUBJECTS_AB)assertSubstituted(undated,subject);
  assertPeriodUnconfirmed(undated,'MCP undated pair');
  const mixed=await mcpDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,'synthetic'),callsOf(SUBJECT_B,'synthetic',{},{quote:UNDATED})])));
  assertSubstituted(mixed,SUBJECT_B);assertDated(mixed,SUBJECT_A);
  assertPeriodUnconfirmed(mixed,'MCP mixed pair');
  const dated=await mcpDoc(synthetic(SUBJECTS_AB));
  for(const subject of SUBJECTS_AB)assertDated(dated,subject);
  for(const row of shownQuoteRows(dated)){assert.equal(row.comparable,true,row.field_id);assert.deepStrictEqual(row.reasons,[],row.field_id);}
});
test('AC-005q the closed reason set names period_unconfirmed in the 1.2 contract file, the runtime set and the fixture list alike',()=>{
  const schema=JSON.parse(readFileSync(new URL('../../contracts/report-input-v1.2.schema.json',import.meta.url),'utf8'));
  const enums=collectEnums(schema).filter(list=>list.includes('period_mismatch'));
  assert.equal(enums.length,1,'one reason enum');
  assert.deepStrictEqual([...(enums[0] as string[])].sort(),[...COMPARISON_REASONS].sort(),'contract file and runtime set agree');
  assert.deepStrictEqual([...REASONS].sort(),[...COMPARISON_REASONS].sort(),'fixture list and runtime set agree');
  assert.ok((COMPARISON_REASONS as readonly string[]).includes('period_unconfirmed'),'the runtime set names period_unconfirmed');
});

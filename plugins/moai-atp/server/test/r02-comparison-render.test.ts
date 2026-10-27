// SPEC-ATP-R02-001 T4 (card t5-A): RED tests for the comparison rendering side.
// Cells: AC-008b (comparison table in subject input order), AC-008d (narrative refusal for contract 1.2),
// AC-006b HTML phrase cells (acquisition wording, no live-query phrase), plus two regression guards
// (AC-008c over the rendered HTML, single-subject documents carry no comparison element).
// AC-008a and AC-008c proper live in the T1 files. Synthetic data only; no provider is reachable from here.
//
// Rendered structure under test (chosen by T4, read ONLY through the helpers and HEADER names below; a rename
// in M4 is a one-place edit and must be reported, never made silently):
//   exactly one element carrying the attribute `data-r02-comparison`; inside it
//   - a comparison table: one `<th>` column header per subject name (input order), one row per
//     doc.comparison.rows entry in document order, the raw cell value at the subject's column, a verdict
//     cell (`비교 가능` or `비교 불가`) and the reason codes;
//   - a mapping table (header `대응 상태`): one row per subject, input order, status code first in its cell;
//   - an acquisition table (headers `출처`, `취득 종류`): one row per doc.comparison.acquisitions entry.
import assert from 'node:assert/strict';
import test from 'node:test';
import {renderReportInputHtml} from '../src/report-pipeline.js';
import {
  CUTOFF,LIVE_PHRASES,RECEIVED,SENTINEL_AMOUNT,SUBJECT_A,SUBJECT_B,SUBJECTS_AB,
  actualServer,allCalls,buildDoc,callsOf,comparisonArgs,errorResult,hasResourceLink,mcpBuild,mcpRender,openMcp,outcomeOf,
  receiptArgs,receiptFor,reversedCalls,withDefaultSession,
  type Rpc,type Subject,
} from './r02-fixtures.js';

const OK={ok:true,code:'OK'};
const HEADER={field:'지표',verdict:'비교 여부',reasons:'사유 코드',mapping:'대응 상태',source:'출처',acquisition:'취득 종류',description:'설명'} as const;
const RECEIPT_PHRASE='이 프로세스가 발급한 출처 영수증 · 조회 시점은 보증하지 않음';

// ---------------------------------------------------------------- HTML helpers
const text=(html:string)=>html.replace(/<[^>]*>/g,'').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&amp;','&').replace(/\s+/g,' ').trim();
/** Inner HTML of the single element carrying `attr`; fails when there are zero or several. */
function elementWith(html:string,attr:string):string{
  const open=new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\s${attr}(?=[\\s=>/])[^>]*>`,'g');
  const found=[...html.matchAll(open)];
  assert.equal(found.length,1,`exactly one element with ${attr}, found ${found.length}`);
  const tag=found[0]![1]!;const start=found[0]!.index!+found[0]![0].length;
  const walk=new RegExp(`<(/?)${tag}\\b[^>]*>`,'gi');walk.lastIndex=start;
  let depth=1;
  for(let m=walk.exec(html);m;m=walk.exec(html)){depth+=m[1]?-1:1;if(depth===0)return html.slice(start,m.index);}
  return assert.fail(`element with ${attr} is not closed`);
}
type Table={headers:string[];rows:string[][]};
function tablesOf(inner:string):Table[]{
  return [...inner.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].map(table=>{
    const body=table[1]!;
    const headers=[...body.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(m=>text(m[1]!));
    const tbody=/<tbody>([\s\S]*?)<\/tbody>/.exec(body)?.[1]??'';
    const rows=[...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row=>[...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell=>text(cell[1]!)));
    return {headers,rows};
  });
}
const escapeRe=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** `token` occurs in `cell` delimited by anything but identifier characters. */
const hasToken=(cell:string,token:string)=>new RegExp(`(^|[^A-Za-z0-9_.-])${escapeRe(token)}($|[^A-Za-z0-9_.-])`).test(cell);
const tableWithHeader=(tables:Table[],header:string)=>{
  const found=tables.filter(table=>table.headers.some(h=>h===header));
  assert.equal(found.length,1,`exactly one table with header ${header}, found ${found.length}`);
  return found[0]!;
};

// ---------------------------------------------------------------- MCP helpers
async function renderHtml(rpc:Rpc,reportInput:unknown,extra:Record<string,unknown>={}):Promise<string>{
  const reply=await mcpRender(rpc,reportInput,extra);
  assert.deepStrictEqual(outcomeOf(reply),OK,'render_report_html');
  const link=reply.result.content.find((item:any)=>item.type==='resource_link');
  assert.ok(link,'resource link');
  const read=await rpc('resources/read',{uri:link.uri});
  const html=read?.result?.contents?.[0]?.text;
  assert.equal(typeof html,'string','resources/read returns the html text');
  return html as string;
}
const syntheticDoc=(subjects:readonly Subject[])=>buildDoc(comparisonArgs(subjects,allCalls(subjects,'synthetic')));
/** A contract 1.1 single-subject R02 document (no `subjects` in the request). */
const singleDoc=()=>buildDoc({report_id:'R02',subject:{id:SUBJECT_A.id,name:SUBJECT_A.name,venue:SUBJECT_A.venue,currency:SUBJECT_A.currency},cutoff:CUTOFF,display_timezone:'Asia/Seoul',received_at:RECEIVED,calls:callsOf(SUBJECT_A,'synthetic',{filings:null})});
/** The retained-snapshot receipt document of AC-006b: every source is a receipt of this process. */
async function receiptDocument(rpc:Rpc):Promise<any>{
  const quoteA=await receiptFor(rpc,'quote',SUBJECT_A);
  const rest=[await receiptFor(rpc,'funds',SUBJECT_A),await receiptFor(rpc,'filings',SUBJECT_A),await receiptFor(rpc,'funds',SUBJECT_B),await receiptFor(rpc,'filings',SUBJECT_B)];
  const reply=await mcpBuild(rpc,receiptArgs(SUBJECTS_AB,[quoteA,...rest]));
  assert.deepStrictEqual(outcomeOf(reply),OK,'build_report_input over receipts');
  return reply.result.structuredContent;
}

// ------------------------------------------------------------------ AC-008b
for(const subjects of [[SUBJECT_A,SUBJECT_B],[SUBJECT_B,SUBJECT_A]]){
  const order=subjects.map(s=>s.name).join(', ');
  test(`AC-008b comparison element: one per document, column headers in input order (${order}), no ranking words`,async()=>{
    const doc=syntheticDoc(subjects);
    await withDefaultSession(async rpc=>{
      const html=await renderHtml(rpc,doc);
      const inner=elementWith(html,'data-r02-comparison');
      const tables=tablesOf(inner);
      const headers=tables.flatMap(table=>table.headers);
      const positions=subjects.map(subject=>{
        const hits=headers.filter(header=>header.includes(subject.name));
        assert.equal(hits.length,1,`one column header for ${subject.name}, found ${hits.length}`);
        return headers.findIndex(header=>header.includes(subject.name));
      });
      assert.deepStrictEqual([...positions].sort((a,b)=>a-b),positions,'column headers follow the subject input order, not value order');
      assert.ok(!/순위|우위|승자/.test(text(inner)),'no ranking word inside the comparison element');
      assert.ok(!headers.some(header=>/순위|우위|승자|차이|격차|증감/.test(header)),'no ranking or difference column');
    });
  });
}
test('AC-008b rows: document order, raw cell value under the right subject, verdict and reason codes per row',async()=>{
  const doc=syntheticDoc(SUBJECTS_AB);
  assert.ok(doc.comparison.rows.some((row:any)=>row.comparable)&&doc.comparison.rows.some((row:any)=>!row.comparable),'fixture holds comparable and non-comparable rows');
  await withDefaultSession(async rpc=>{
    const table=tablesOf(elementWith(await renderHtml(rpc,doc),'data-r02-comparison')).find(candidate=>SUBJECTS_AB.every(s=>candidate.headers.some(h=>h.includes(s.name))));
    assert.ok(table,'the comparison table with one column per subject');
    const column=SUBJECTS_AB.map(s=>table.headers.findIndex(h=>h.includes(s.name)));
    const verdictAt=table.headers.indexOf(HEADER.verdict);const reasonsAt=table.headers.indexOf(HEADER.reasons);
    assert.ok(verdictAt>=0&&reasonsAt>=0,`headers ${HEADER.verdict} and ${HEADER.reasons}: ${JSON.stringify(table.headers)}`);
    const rendered:{row:any;cells:string[];index:number}[]=doc.comparison.rows.map((row:any)=>{
      const matches=table.rows.filter(cells=>hasToken(cells[0]??'',row.field_id));
      assert.equal(matches.length,1,`one table row for ${row.field_id}, found ${matches.length}`);
      return {row,cells:matches[0]!,index:table.rows.indexOf(matches[0]!)};
    });
    assert.deepStrictEqual(rendered.map(r=>r.index),[...rendered.map(r=>r.index)].sort((a:number,b:number)=>a-b),'rows keep the document order');
    for(const {row,cells} of rendered){
      row.cells.forEach((cell:any,i:number)=>{
        assert.equal(cells[column[i]!],cell.value??'—',`${row.field_id} / ${SUBJECTS_AB[i]!.name}`);
      });
      assert.equal(cells[verdictAt],row.comparable?'비교 가능':'비교 불가',`${row.field_id} verdict`);
      for(const reason of row.reasons)assert.ok(hasToken(cells[reasonsAt]??'',reason),`${row.field_id} reason ${reason}`);
      if(row.comparable)assert.equal((cells[reasonsAt]??'').trim().replace('—',''),'',`${row.field_id} comparable row names no reason`);
    }
  });
});
test('AC-008b mapping state per subject in input order, and an acquisition label per source',async()=>{
  // A keeps its filings evidence (synthetic_fixture_match), B has none (unverified).
  const doc=buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,'synthetic'),callsOf(SUBJECT_B,'synthetic',{filings:null})])));
  assert.deepStrictEqual(doc.comparison.mappings.map((m:any)=>m.status),['synthetic_fixture_match','unverified']);
  await withDefaultSession(async rpc=>{
    const tables=tablesOf(elementWith(await renderHtml(rpc,doc),'data-r02-comparison'));
    const mapping=tableWithHeader(tables,HEADER.mapping);
    const statusAt=mapping.headers.indexOf(HEADER.mapping);
    assert.equal(mapping.rows.length,SUBJECTS_AB.length,'one mapping row per subject');
    SUBJECTS_AB.forEach((subject,i)=>{
      assert.ok(mapping.rows[i]!.some(cell=>cell.includes(subject.name)),`mapping row ${i} names ${subject.name}`);
      assert.ok((mapping.rows[i]![statusAt]??'').startsWith(doc.comparison.mappings[i].status),`mapping row ${i} status`);
    });
    const acquisition=tableWithHeader(tables,HEADER.acquisition);
    const sourceAt=acquisition.headers.indexOf(HEADER.source);const kindAt=acquisition.headers.indexOf(HEADER.acquisition);const phraseAt=acquisition.headers.indexOf(HEADER.description);
    assert.ok(sourceAt>=0&&kindAt>=0&&phraseAt>=0,JSON.stringify(acquisition.headers));
    assert.equal(acquisition.rows.length,doc.comparison.acquisitions.length,'one acquisition row per labelled source');
    for(const label of doc.comparison.acquisitions){
      const matches=acquisition.rows.filter(cells=>cells[sourceAt]===label.source_id);
      assert.equal(matches.length,1,`one acquisition row for ${label.source_id}`);
      assert.ok(hasToken(matches[0]![kindAt]??'',label.kind),`${label.source_id} kind ${label.kind}`);
      assert.ok((matches[0]![phraseAt]??'').length>0,`${label.source_id} carries a wording`);
    }
  });
});
test('AC-008b header: the report heading names every subject in input order',async()=>{
  const doc=syntheticDoc(SUBJECTS_AB);
  await withDefaultSession(async rpc=>{
    const heading=/<h1>([\s\S]*?)<\/h1>/.exec(await renderHtml(rpc,doc));
    assert.ok(heading,'h1 exists');
    const names=text(heading[1]!);
    assert.ok(names.includes(SUBJECT_A.name)&&names.includes(SUBJECT_B.name),names);
    assert.ok(names.indexOf(SUBJECT_A.name)<names.indexOf(SUBJECT_B.name),names);
  });
});

// ------------------------------------------------------------------ AC-006b HTML cells
test('AC-006b process_receipt wording: every receipt-labelled source carries the receipt phrase in the comparison element',async()=>{
  const {server}=actualServer({retained:SUBJECT_A});const session=await openMcp(server);
  try{
    const doc=await receiptDocument(session.rpc);
    const labels=doc.comparison.acquisitions.filter((label:any)=>label.kind==='process_receipt');
    assert.ok(labels.length>0,'the receipt document has receipt-labelled sources');
    const acquisition=tableWithHeader(tablesOf(elementWith(await renderHtml(session.rpc,doc),'data-r02-comparison')),HEADER.acquisition);
    const sourceAt=acquisition.headers.indexOf(HEADER.source);const phraseAt=acquisition.headers.indexOf(HEADER.description);
    for(const label of labels){
      const row=acquisition.rows.find(cells=>cells[sourceAt]===label.source_id);
      assert.ok(row,`acquisition row for ${label.source_id}`);
      assert.ok((row[phraseAt]??'').includes(RECEIPT_PHRASE),`${label.source_id}: ${row[phraseAt]}`);
    }
  }finally{await session.close();}
});
test('AC-006b phrase cell (HTML part, regression guard): no live-query phrase in the rendered receipt comparison',async()=>{
  const {server}=actualServer({retained:SUBJECT_A});const session=await openMcp(server);
  try{
    const html=await renderHtml(session.rpc,await receiptDocument(session.rpc));
    for(const phrase of LIVE_PHRASES)assert.ok(!html.includes(phrase),`phrase ${phrase}`);
    const textNodes=html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ');
    assert.ok(!/\blive\b/i.test(textNodes),'English "live" in a text node');
  }finally{await session.close();}
});

// ------------------------------------------------------------------ AC-008c regression guard over MCP render
test('AC-008c regression guard: an unverified subject\'s amount never reaches the HTML rendered through render_report_html',async()=>{
  const doc=buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,'synthetic',{filings:null},{funds:{revenue:SENTINEL_AMOUNT}}),callsOf(SUBJECT_B,'synthetic')])));
  assert.ok(!JSON.stringify(doc).includes(SENTINEL_AMOUNT),'ReportInput');
  await withDefaultSession(async rpc=>{assert.ok(!(await renderHtml(rpc,doc)).includes(SENTINEL_AMOUNT),'rendered HTML');});
});
test('regression guard: a single-subject (contract 1.1) document renders without a comparison element',()=>{
  const doc=singleDoc();
  assert.equal(doc.contract_version,'atp.template/1.1');
  assert.ok(!/data-r02-comparison/.test(renderReportInputHtml(doc)));
});

// ------------------------------------------------------------------ REQ-DSP-001 hero cards (audit F1)
// A hero KPI card is one value with a fixed label and no subject name. In a comparison document the
// table carries the data, so the hero shows no card: a card could only ever show one subject's value
// (or, with fields from different subjects, a mixture) under a label that names nobody.
const kpiCount=(html:string)=>(html.match(/class="kpi"/g)??[]).length;
const kpiCards=(html:string)=>[...html.matchAll(/<div class="kpi"><span>([^<]*)<\/span><strong>([^<]*)<small>/g)].map(m=>`${m[1]}=${m[2]}`);
test('F1 AC-003g shape (B quote is an error result): the comparison HTML has no KPI card',()=>{
  const groups=[callsOf(SUBJECT_A,'synthetic'),callsOf(SUBJECT_B,'synthetic')];
  groups[1]![0]={tool_name:'get_market_snapshot',result:errorResult('rights_pending')};
  const doc=buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls(groups)));
  assert.equal(doc.contract_version,'atp.template/1.2');
  const html=renderReportInputHtml(doc);
  assert.equal(kpiCount(html),0,`unattributed hero cards: ${JSON.stringify(kpiCards(html))}`);
  assert.ok(/data-r02-comparison/.test(html),'the comparison element still carries the data');
});
test('F1 mixed document (A has no last price, B has no change percent or volume): no card mixes the two subjects',()=>{
  const doc=buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,'synthetic',{},{quote:{omit:['stck_prpr']}}),callsOf(SUBJECT_B,'synthetic',{},{quote:{omit:['prdy_ctrt','acml_vol']}})])));
  const html=renderReportInputHtml(doc);
  assert.equal(kpiCount(html),0,`unattributed hero cards: ${JSON.stringify(kpiCards(html))}`);
});
test('F1 B has no filings (B unverified, only A\'s operating margin remains): no card carries A\'s margin without a name',()=>{
  const doc=buildDoc(comparisonArgs(SUBJECTS_AB,reversedCalls([callsOf(SUBJECT_A,'synthetic'),callsOf(SUBJECT_B,'synthetic',{filings:null})])));
  assert.deepStrictEqual(doc.comparison.mappings.map((m:any)=>m.status),['synthetic_fixture_match','unverified']);
  const html=renderReportInputHtml(doc);
  assert.equal(kpiCount(html),0,`unattributed hero cards: ${JSON.stringify(kpiCards(html))}`);
});
test('F1 control (regression guard): a contract 1.1 single-subject document keeps exactly its four hero cards',()=>{
  const doc=singleDoc();
  assert.equal(doc.contract_version,'atp.template/1.1');
  assert.deepStrictEqual(kpiCards(renderReportInputHtml(doc)),['수신 스냅샷 가격=100','스냅샷 전일 대비율=10.5','스냅샷 누적 거래량=1,000','공시 연간 영업이익률=19']);
});

// ------------------------------------------------------------------ AC-008d
const para=(kind:'uncertainty'|'condition',body:string)=>({kind,text:body,source_ids:[] as string[],metric_ids:[] as string[]});
/** A draft in the existing format that applyNarrativeDraft accepts for `doc`: no figures, no citations needed. */
const draftFor=(doc:any,reportId='R02')=>({
  contract:'moai.report.narrative-draft.v1',report_id:reportId,bindings:[],
  sections:[{section_id:doc.sections[0].id,paragraphs:[para('uncertainty','관측 자료만으로 판단을 확정할 수 없습니다.')]}],
  goose_opinion:{conclusion:para('uncertainty','자료가 부족하여 판단을 보류합니다.'),rationale:[para('uncertainty','출처별 확인 범위가 다릅니다.')],risks:[para('uncertainty','미확인 자료가 포함될 수 있습니다.')],next_checks:[para('condition','원천 자료를 다시 확인합니다.')]},
});
const withClaim=(doc:any,id:string)=>{
  const out=structuredClone(doc);
  out.analysis_claims.push({id,kind:'method',text:'호스트가 작성한 분석 초안입니다.',status:'partial',confidence:'unrated',source_ids:[],metric_ids:[]});
  return out;
};
const REFUSED={ok:false,code:'comparison_narrative_not_supported'};
test('AC-008d (i) a narrative draft with a comparison document -> comparison_narrative_not_supported, no resource',async()=>{
  const doc=syntheticDoc(SUBJECTS_AB);
  await withDefaultSession(async rpc=>{
    const reply=await mcpRender(rpc,doc,{narrative_draft:draftFor(doc)});
    assert.deepStrictEqual(outcomeOf(reply),REFUSED);
    assert.ok(!hasResourceLink(reply));
  });
});
for(const id of ['R02.NARRATIVE.method','R02.GOOSE_OPINION.conclusion.0']){
  test(`AC-008d (ii) no draft, but the comparison document carries claim ${id} -> comparison_narrative_not_supported`,async()=>{
    const doc=withClaim(syntheticDoc(SUBJECTS_AB),id);
    await withDefaultSession(async rpc=>{
      const reply=await mcpRender(rpc,doc);
      assert.deepStrictEqual(outcomeOf(reply),REFUSED);
      assert.ok(!hasResourceLink(reply));
    });
  });
  test(`AC-008d renderReportInputHtml itself refuses a contract 1.2 document carrying claim ${id}; contract 1.1 and claim-free 1.2 do not`,()=>{
    const comparison=syntheticDoc(SUBJECTS_AB);
    assert.throws(()=>renderReportInputHtml(withClaim(comparison,id)),(error:unknown)=>error instanceof Error&&error.message==='comparison_narrative_not_supported');
    assert.ok(renderReportInputHtml(comparison).length>0,'a claim-free comparison document renders');
    assert.ok(renderReportInputHtml(withClaim(singleDoc(),id)).length>0,'a contract 1.1 document with the same claim keeps rendering');
  });
}
test('AC-008d (iii) regression guard: a draft that does not fit the document (report R01) is refused by the existing narrative check first',async()=>{
  const doc=syntheticDoc(SUBJECTS_AB);
  await withDefaultSession(async rpc=>{
    const reply=await mcpRender(rpc,doc,{narrative_draft:draftFor(doc,'R01')});
    const outcome=outcomeOf(reply);
    assert.equal(outcome.ok,false);
    assert.ok(outcome.code.startsWith('narrative_'),outcome.code);
    assert.ok(!hasResourceLink(reply));
  });
});
test('AC-008d control (regression guard): a single-subject R02 document still renders with the same draft',async()=>{
  const single=singleDoc();
  await withDefaultSession(async rpc=>{
    const reply=await mcpRender(rpc,single,{narrative_draft:draftFor(single)});
    assert.deepStrictEqual(outcomeOf(reply),OK);
    assert.equal(reply.result.structuredContent.narrative_status,'host_draft_applied_unverified');
  });
});

// SPEC-ATP-R02-002 (card t37): the comparison table shows, for every shown cell that has a designated metric,
// `<value> (기준 <n>)` and carries one basis table (기준, 단위, 기간 기준, 기간 종류, 범위, 통화, 배율) taken from
// that metric. Cells that cannot show a value read `— (<words>)`; a cell with a value but no designated metric
// reads `<value> (기준 —)`. Documents come only from the r02-fixtures helpers (synthetic data, no provider call).
//
// The expected text is computed from the document alone (expectedFor), in the total order of spec §3.3:
// C7/C5/C6 words, then C8 value_missing, then C9 absent metric, then the basis rows (C1..C4). It never reads
// the renderer. Test names start with the acceptance criterion they cover (AC-001 ... AC-011).
// This base is post-t29: a document whose designated metric was removed is refused before rendering with
// `comparison_cell_missing_metric_lineage` (AC-008 b, d).
import assert from 'node:assert/strict';
import test from 'node:test';
import {renderReportInputHtml} from '../src/report-pipeline.js';
import {
  RECEIVED,SUBJECT_A,SUBJECT_B,
  buildDoc,callsOf,comparisonArgs,hasResourceLink,isRenderRefusal,mcpRender,outcomeOf,withDefaultSession,
  type Call,type Rpc,type Subject,
} from './r02-fixtures.js';

const LEGEND_HEADERS=['기준','단위','기간 기준','기간 종류','범위','통화','배율'];
const EMPTY_LEGEND=[['확인 가능한 입력이 없습니다.']];
const REASON_ORDER=['period_mismatch','period_unconfirmed','scope_mismatch','currency_mismatch','unit_mismatch','scale_mismatch','scale_unconfirmed','value_missing','rights_not_confirmed','issuer_mapping_unverified'];
const DART_PERIOD=/^(\d{4}):FY:(?:CFS|OFS):(?:IS|BS|CF):.*:\d{14}$/;
const LINEAGE='comparison_cell_missing_metric_lineage';
const AB=[SUBJECT_A,SUBJECT_B];
const BA=[SUBJECT_B,SUBJECT_A];

// ---------------------------------------------------------------- HTML helpers
const text=(html:string)=>html.replace(/<[^>]*>/g,'').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&amp;','&').replace(/\s+/g,' ').trim();
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
type Table={headers:string[];rows:string[][];raw:string};
function tablesOf(inner:string):Table[]{
  return [...inner.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].map(table=>{
    const body=table[1]!;
    const headers=[...body.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(m=>text(m[1]!));
    const tbody=/<tbody>([\s\S]*?)<\/tbody>/.exec(body)?.[1]??'';
    const rows=[...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row=>[...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell=>text(cell[1]!)));
    return {headers,rows,raw:body};
  });
}
type View={inner:string;table:Table;legend:Table;legendCount:number;column:number[]};
/** The comparison element, its comparison table (one column per subject) and its single basis table. */
function viewOf(html:string,subjects:readonly Subject[]):View{
  const inner=elementWith(html,'data-r02-comparison');
  const tables=tablesOf(inner);
  const table=tables.find(candidate=>subjects.every(s=>candidate.headers.some(h=>h.includes(s.name))));
  assert.ok(table,'the comparison table with one column per subject');
  const legends=tables.filter(candidate=>JSON.stringify(candidate.headers)===JSON.stringify(LEGEND_HEADERS));
  return {inner,table,legend:legends[0]??{headers:[],rows:[],raw:''},legendCount:legends.length,column:subjects.map(s=>table.headers.findIndex(h=>h.includes(s.name)))};
}
const cellAt=(view:View,row:number,subject:number):string=>view.table.rows[row]?.[view.column[subject]!]??'<none>';
const render=(doc:any)=>renderReportInputHtml(doc);

// ---------------------------------------------------------------- the expected text, from the document only
function mayDisplay(doc:any,sourceId:string):boolean{
  const s=doc.sources.find((x:any)=>x.id===sourceId);if(!s)return false;
  if(doc.mode==='synthetic')return s.kind==='synthetic'&&s.rights==='synthetic_only'&&s.validation_status==='synthetic_fixture';
  if(s.kind==='user_supplied')return (doc.mode==='supplied'||doc.mode==='mixed')&&s.rights==='local_view'&&s.validation_status==='unverified';
  return s.rights==='local_view'&&['provider_shape_checked','independently_reconciled'].includes(s.validation_status??'');
}
function undated(doc:any,m:any):boolean{const s=doc.sources.find((x:any)=>x.id===m.source_id);return s!==undefined&&(s.source_as_of===null||s.source_as_of===undefined)&&m.period===(s.received_at??s.observed_at);}
function basisOf(doc:any,m:any):string[]{
  const d=DART_PERIOD.exec(m.period);
  const period=undated(doc,m)?'period_unconfirmed':d?`사업연도 ${d[1]} · 보고서 코드 11011`:m.period;
  return [m.unit,period,m.period_kind,m.scope,m.currency??'—',m.unit.includes('배율 미확인')?'scale_unconfirmed':m.scale];
}
/** The designated metric: the FIRST metric of the document with the row's field_id and the cell's source_id. */
const designated=(doc:any,row:any,cell:any):any=>cell&&cell.source_id!==null?doc.metrics.find((x:any)=>x.field_id===row.field_id&&x.source_id===cell.source_id):undefined;
function expectedFor(doc:any,subjects:readonly Subject[]):{cells:string[][];legend:string[][]}{
  const keys:string[]=[];const cells:string[][]=[];
  for(const row of doc.comparison.rows){
    const line:string[]=[];
    for(const subject of subjects){
      const c=row.cells.find((x:any)=>x.subject_id===subject.id);const m=designated(doc,row,c);
      const words=new Set<string>();
      if(m&&m.status==='rights_pending')words.add('rights_not_confirmed');
      if(c&&c.value!==null&&c.source_id!==null&&!mayDisplay(doc,c.source_id))words.add('rights_not_confirmed');
      if(m&&m.missing_reason==='issuer_mapping_unverified')words.add('issuer_mapping_unverified');
      if(words.size>0)line.push(`— (${REASON_ORDER.filter(r=>words.has(r)).join(', ')})`);
      else if(!c||c.value===null||c.source_id===null)line.push('— (value_missing)');
      else if(!m)line.push(`${c.value} (기준 —)`);
      else{
        const key=JSON.stringify(basisOf(doc,m));let n=keys.indexOf(key);if(n<0){keys.push(key);n=keys.length-1;}
        line.push(`${c.value} (기준 ${n+1})`);
      }
    }
    cells.push(line);
  }
  return {cells,legend:keys.map((k,i)=>[`기준 ${i+1}`,...(JSON.parse(k) as string[])])};
}
/** Every cell, the headers and the whole basis table of the rendered comparison element equal the expectation. */
function assertMatchesExpectation(doc:any,subjects:readonly Subject[],html:string):View{
  const view=viewOf(html,subjects);const want=expectedFor(doc,subjects);
  assert.deepStrictEqual(view.table.headers,['지표',...subjects.map(s=>s.name),'비교 여부','사유 코드'],'comparison table headers are kept');
  assert.equal(view.table.rows.length,doc.comparison.rows.length,'one table row per comparison row');
  doc.comparison.rows.forEach((row:any,r:number)=>subjects.forEach((s,i)=>{
    assert.equal(cellAt(view,r,i),want.cells[r]![i],`${row.field_id} / ${s.name}`);
  }));
  assert.equal(view.legendCount,1,`exactly one basis table inside the comparison element, found ${view.legendCount}`);
  assert.deepStrictEqual(view.legend.rows,want.legend.length?want.legend:EMPTY_LEGEND,'basis table rows, in order of first appearance');
  return view;
}
const rowOf=(doc:any,fieldId:string):number=>{const r=doc.comparison.rows.findIndex((x:any)=>x.field_id===fieldId);assert.ok(r>=0,`row ${fieldId} exists`);return r;};
const referenceOf=(cell:string):string|null=>/ \(기준 (\d+)\)$/.exec(cell)?.[1]??null;

// ---------------------------------------------------------------- documents (r02-fixtures helpers only)
const build=(subjects:readonly Subject[],groups:readonly Call[][])=>buildDoc(comparisonArgs(subjects,groups.flat()));
const dated=()=>build(AB,[callsOf(SUBJECT_A,'synthetic'),callsOf(SUBJECT_B,'synthetic')]);
const undatedB=()=>build(AB,[callsOf(SUBJECT_A,'synthetic'),callsOf(SUBJECT_B,'synthetic',{},{quote:{omit:['stck_bsop_date']}})]);
const separateB=()=>build(AB,[callsOf(SUBJECT_A,'synthetic'),callsOf(SUBJECT_B,'synthetic',{},{funds:{fsDiv:'OFS'}})]);
const missingBFunds=()=>build(AB,[callsOf(SUBJECT_A,'synthetic'),callsOf(SUBJECT_B,'synthetic',{funds:null})]);
const unverifiedB=()=>build(AB,[callsOf(SUBJECT_A,'synthetic'),callsOf(SUBJECT_B,'synthetic',{filings:null})]);
const callerActual=()=>build(AB,[callsOf(SUBJECT_A,'actual'),callsOf(SUBJECT_B,'actual')]);
const reversedBA=()=>build(BA,[callsOf(SUBJECT_B,'synthetic'),callsOf(SUBJECT_A,'synthetic')]);
const firstMetric=(doc:any,rowIndex:number,subjectIndex:number)=>{const row=doc.comparison.rows[rowIndex];return designated(doc,row,row.cells[subjectIndex]);};
const hideQuoteA=(doc:any)=>{const id=doc.comparison.rows[0].cells[0].source_id;doc.sources.find((x:any)=>x.id===id).rights='pending';};

/** The five basis rows of the dated document (spec E-17). */
const DATED_LEGEND=[
  ['기준 1','KRW/share','2026-10-22','observation','not_applicable','KRW','1'],
  ['기준 2','%','2026-10-22','observation','not_applicable','—','1'],
  ['기준 3','shares','2026-10-22','observation','not_applicable','—','1'],
  ['기준 4','원문 금액(배율 미확인)','사업연도 2025 · 보고서 코드 11011','FY','consolidated','KRW','scale_unconfirmed'],
  ['기준 5','%','사업연도 2025 · 보고서 코드 11011','FY','consolidated','—','1'],
];

async function renderHtml(rpc:Rpc,reportInput:unknown):Promise<string>{
  const reply=await mcpRender(rpc,reportInput);
  assert.deepStrictEqual(outcomeOf(reply),{ok:true,code:'OK'},'render_report_html');
  const link=reply.result.content.find((item:any)=>item.type==='resource_link');
  assert.ok(link,'resource link');
  const read=await rpc('resources/read',{uri:link.uri});
  const html=read?.result?.contents?.[0]?.text;
  assert.equal(typeof html,'string','resources/read returns the html text');
  return html as string;
}
function checkDated(doc:any,html:string):void{
  const view=assertMatchesExpectation(doc,AB,html);
  const last=rowOf(doc,'quote.last');
  assert.equal(cellAt(view,last,0),'100 (기준 1)');
  assert.equal(cellAt(view,last,1),'200 (기준 1)');
  assert.deepStrictEqual(view.legend.rows,DATED_LEGEND);
  doc.comparison.rows.forEach((row:any,r:number)=>{
    const shown=[0,1].map(i=>cellAt(view,r,i)).filter(cell=>!cell.startsWith('—'));
    shown.forEach(cell=>assert.match(cell,/^[^ ]+ \(기준 [1-9]\d*\)$/,`${row.field_id} shown cell carries a numbered basis reference`));
    if(row.comparable)assert.equal(new Set(shown.map(referenceOf)).size,1,`${row.field_id} comparable row uses one basis number`);
  });
}

// ------------------------------------------------------------------ AC-001
test('AC-001 function render: shown cells carry (기준 n) and one basis table lists the five dated bases',()=>{
  const doc=dated();checkDated(doc,render(doc));
});
test('AC-001 MCP render_report_html: the same cells and the same basis table',async()=>{
  const doc=dated();
  await withDefaultSession(async rpc=>checkDated(doc,await renderHtml(rpc,doc)));
});

// ------------------------------------------------------------------ AC-002
test('AC-002 undated source: the cell gets its own number and the basis period reads period_unconfirmed',()=>{
  const doc=undatedB();const view=assertMatchesExpectation(doc,AB,render(doc));
  const last=rowOf(doc,'quote.last');
  assert.equal(cellAt(view,last,0),'100 (기준 1)');
  assert.equal(cellAt(view,last,1),'200 (기준 2)');
  assert.deepStrictEqual(view.legend.rows[1],['기준 2','KRW/share','period_unconfirmed','observation','not_applicable','KRW','1']);
  assert.ok(doc.comparison.rows[last].reasons.includes('period_unconfirmed'),'the row names period_unconfirmed');
});
test('AC-002 undated source: the receipt time is not presented as a period anywhere in the basis table',()=>{
  const doc=undatedB();const view=assertMatchesExpectation(doc,AB,render(doc));
  assert.ok(!view.legend.raw.includes(RECEIVED),'no receipt time inside the basis table');
  assert.ok(!view.legend.rows.some(row=>row.some(cell=>cell.includes('2026-10-23'))),'no receipt date inside the basis table');
});

// ------------------------------------------------------------------ AC-003
test('AC-003 DART amounts and the derived ratio: business year and report code only, scale unconfirmed for the amounts',()=>{
  const doc=dated();const view=assertMatchesExpectation(doc,AB,render(doc));
  const revenue=rowOf(doc,'reported.revenue');
  assert.equal(cellAt(view,revenue,0),'1234567890 (기준 4)');
  assert.equal(cellAt(view,revenue,1),'2234567890 (기준 4)');
  assert.deepStrictEqual(view.legend.rows[3],['기준 4','원문 금액(배율 미확인)','사업연도 2025 · 보고서 코드 11011','FY','consolidated','KRW','scale_unconfirmed']);
  assert.deepStrictEqual(view.legend.rows[4],['기준 5','%','사업연도 2025 · 보고서 코드 11011','FY','consolidated','—','1']);
  const margin=rowOf(doc,'metric.operating_margin');
  assert.equal(referenceOf(cellAt(view,margin,0)),'5');
  assert.equal(referenceOf(cellAt(view,margin,1)),'5');
});
test('AC-003 DART basis rows show no filing receipt number, term label, month, or calendar date',()=>{
  const doc=dated();const view=assertMatchesExpectation(doc,AB,render(doc));
  const dart=view.legend.rows.filter(row=>row[2]!.startsWith('사업연도'));
  assert.equal(dart.length,2,'two DART basis rows');
  for(const row of dart){
    const line=row.join(' | ');
    assert.ok(!/\d{14}/.test(line),`no 14-digit receipt number in ${line}`);
    assert.ok(!/제 ?\d+ ?기/.test(line),`no term label in ${line}`);
    assert.ok(!/월/.test(line),`no month in ${line}`);
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(line),`no calendar date in ${line}`);
  }
});

// ------------------------------------------------------------------ AC-004
test('AC-004 consolidated against separate: the separate subject gets its own numbers and the scope reads standalone',()=>{
  const doc=separateB();const view=assertMatchesExpectation(doc,AB,render(doc));
  const revenue=rowOf(doc,'reported.revenue');
  assert.equal(cellAt(view,revenue,0),'1234567890 (기준 4)');
  assert.equal(cellAt(view,revenue,1),'2234567890 (기준 5)');
  assert.deepStrictEqual(view.legend.rows[4],['기준 5','원문 금액(배율 미확인)','사업연도 2025 · 보고서 코드 11011','FY','standalone','KRW','scale_unconfirmed']);
  assert.deepStrictEqual(view.legend.rows[6],['기준 7','%','사업연도 2025 · 보고서 코드 11011','FY','standalone','—','1']);
  doc.comparison.rows.filter((row:any)=>row.reasons.includes('scope_mismatch')).forEach((row:any)=>{
    const r=rowOf(doc,row.field_id);
    const numbers=new Set([0,1].map(i=>referenceOf(cellAt(view,r,i))).filter(n=>n!==null));
    assert.ok(numbers.size>=2,`${row.field_id} scope_mismatch row shows two or more basis numbers`);
  });
});

// ------------------------------------------------------------------ AC-005
test('AC-005 rights not confirmed: hidden cells name their words, carry no basis reference, and the basis table stays empty',()=>{
  const doc=callerActual();const view=assertMatchesExpectation(doc,AB,render(doc));
  const quote=rowOf(doc,'quote.last');
  for(const i of [0,1])assert.equal(cellAt(view,quote,i),'— (rights_not_confirmed)');
  for(const field of ['reported.revenue','metric.operating_margin'])for(const i of [0,1]){
    assert.equal(cellAt(view,rowOf(doc,field),i),'— (rights_not_confirmed, issuer_mapping_unverified)');
  }
  doc.comparison.rows.forEach((_row:any,r:number)=>[0,1].forEach(i=>assert.ok(!cellAt(view,r,i).includes('(기준'),'no basis reference on a hidden cell')));
  assert.deepStrictEqual(view.legend.rows,EMPTY_LEGEND);
});

// ------------------------------------------------------------------ AC-006
test('AC-006 value missing: the subject without a statement reads — (value_missing) and adds no basis row',()=>{
  const base=dated();const doc=missingBFunds();const view=assertMatchesExpectation(doc,AB,render(doc));
  assert.equal(cellAt(view,rowOf(doc,'reported.revenue'),0),'1234567890 (기준 4)');
  assert.equal(cellAt(view,rowOf(doc,'reported.revenue'),1),'— (value_missing)');
  assert.equal(cellAt(view,rowOf(doc,'metric.operating_margin'),1),'— (value_missing)');
  for(const i of [0,1])assert.equal(cellAt(view,rowOf(doc,'quote.previous_close'),i),'— (value_missing)');
  assert.deepStrictEqual(view.legend.rows,viewOf(render(base),AB).legend.rows,'no basis row is added for the missing subject');
});

// ------------------------------------------------------------------ AC-007
test('AC-007 issuer mapping unverified: the unverified subject reads its word, and its value, unit and period are not shown as a basis',()=>{
  const base=dated();const doc=unverifiedB();const view=assertMatchesExpectation(doc,AB,render(doc));
  assert.equal(cellAt(view,rowOf(doc,'reported.revenue'),1),'— (issuer_mapping_unverified)');
  assert.equal(cellAt(view,rowOf(doc,'metric.operating_margin'),1),'— (issuer_mapping_unverified)');
  assert.ok(!view.inner.includes('2234567890'),'the hidden amount is not in the comparison element');
  assert.deepStrictEqual(view.legend.rows,viewOf(render(base),AB).legend.rows,'no basis row for the unverified subject');
});

// ------------------------------------------------------------------ AC-008
test('AC-008 (a) duplicate designated metric: the first metric wins and the later unit never appears',()=>{
  const doc=dated();
  const copy={...firstMetric(doc,1,1),unit:'합성중복단위'};
  doc.metrics.push(copy);
  const html=render(doc);const view=assertMatchesExpectation(doc,AB,html);
  assert.equal(cellAt(view,1,1),'190 (기준 1)');
  assert.ok(!view.inner.includes('합성중복단위'),'the duplicate unit is not shown');
});
test('AC-008 (b) designated metric removed: the document is refused before rendering with the lineage code (post-t29 base)',async()=>{
  const doc=dated();doc.metrics=doc.metrics.filter((x:any)=>x!==firstMetric(doc,0,0));
  assert.throws(()=>render(doc),(error:unknown)=>String((error as Error)?.message??error).includes(LINEAGE),'renderReportInputHtml refuses with the lineage code');
  await withDefaultSession(async rpc=>{
    const reply=await mcpRender(rpc,doc);
    assert.ok(isRenderRefusal(reply),`render_report_html refuses: ${JSON.stringify(outcomeOf(reply))}`);
    assert.ok(!hasResourceLink(reply),'no resource link for a refusal');
  });
});
test('AC-008 (c) rights come before the basis: the hidden subject reads its word, the other keeps its reference',()=>{
  const doc=dated();hideQuoteA(doc);
  const view=assertMatchesExpectation(doc,AB,render(doc));
  assert.equal(cellAt(view,0,0),'— (rights_not_confirmed)');
  assert.equal(cellAt(view,0,1),'200 (기준 1)');
});
test('AC-008 (d) rights come before an absent metric: the cell would be refused before rendering on a post-t29 base',()=>{
  const doc=dated();hideQuoteA(doc);doc.metrics=doc.metrics.filter((x:any)=>x!==firstMetric(doc,0,0));
  assert.throws(()=>render(doc),(error:unknown)=>String((error as Error)?.message??error).includes(LINEAGE),'refused with the lineage code');
});

// ------------------------------------------------------------------ AC-009
test('AC-009 input order B, A: columns follow the request, numbers are assigned in order of first appearance, nothing is ranked',()=>{
  const doc=reversedBA();const view=assertMatchesExpectation(doc,BA,render(doc));
  const last=rowOf(doc,'quote.last');
  assert.equal(cellAt(view,last,0),'200 (기준 1)');
  assert.equal(cellAt(view,last,1),'100 (기준 1)');
  assert.deepStrictEqual(view.legend.rows[0],['기준 1','KRW/share','2026-10-22','observation','not_applicable','KRW','1']);
  assert.ok(view.column[0]!<view.column[1]!,'subject columns keep the input order');
  assert.ok(!/순위|우위|승자/.test(text(view.inner)),'no ranking word');
  assert.ok(!view.table.headers.some(h=>/순위|우위|승자|차이|격차|증감/.test(h)),'no ranking or difference column');
});

// ------------------------------------------------------------------ AC-010
/** First row, both subjects: the three free-string fields of the designated metric carry markup. */
function escapeDoc():any{
  const doc=dated();const row=doc.comparison.rows[0];
  for(const cell of row.cells){const m=designated(doc,row,cell);m.unit='<i>합성단위</i>';m.period='<b>합성기간</b>';m.currency='<s>합성통화</s>';}
  return doc;
}
for(const [field,raw,escaped] of [['unit','<i>합성단위</i>','&lt;i&gt;합성단위&lt;/i&gt;'],['period','<b>합성기간</b>','&lt;b&gt;합성기간&lt;/b&gt;'],['currency','<s>합성통화</s>','&lt;s&gt;합성통화&lt;/s&gt;']] as const){
  test(`AC-010 escape ${field}: no raw markup in the comparison element, the escaped text is in the basis table`,()=>{
    const doc=escapeDoc();const html=render(doc);
    const inner=elementWith(html,'data-r02-comparison');
    assert.ok(!inner.includes(raw),`raw ${field} markup is absent from the comparison element`);
    const view=assertMatchesExpectation(doc,AB,html);
    assert.ok(view.legend.raw.includes(escaped),`escaped ${field} is in the basis table`);
  });
}

// ------------------------------------------------------------------ AC-011
/** (i) comparable rows use one number, (ii) basis-mismatch rows use two or more, (iii) cell words are row reasons,
 * (iv) the row has period_unconfirmed exactly when a shown cell's basis period is period_unconfirmed. */
function checkConsistency(doc:any,subjects:readonly Subject[]):void{
  const view=assertMatchesExpectation(doc,subjects,render(doc));
  const periodOf=new Map(view.legend.rows.map(row=>[row[0]!,row[2]!]));
  doc.comparison.rows.forEach((row:any,r:number)=>{
    const cells=subjects.map((_s,i)=>cellAt(view,r,i));
    const numbers=cells.map(referenceOf).filter((n):n is string=>n!==null);
    if(row.comparable)assert.equal(new Set(numbers).size,1,`(i) ${row.field_id}`);
    if(row.reasons.some((x:string)=>['period_mismatch','scope_mismatch','currency_mismatch','unit_mismatch','scale_mismatch'].includes(x)))assert.ok(new Set(numbers).size>=2,`(ii) ${row.field_id}`);
    for(const cell of cells.filter(c=>c.startsWith('—')))for(const word of /^— \((.*)\)$/.exec(cell)![1]!.split(', '))assert.ok(row.reasons.includes(word),`(iii) ${row.field_id} word ${word}`);
    const undatedShown=numbers.some(n=>periodOf.get(`기준 ${n}`)==='period_unconfirmed');
    assert.equal(undatedShown,row.reasons.includes('period_unconfirmed'),`(iv) ${row.field_id}`);
  });
}
test('AC-011 dated document is consistent with the build judgment',()=>checkConsistency(dated(),AB));
test('AC-011 undated subject is consistent with the build judgment',()=>checkConsistency(undatedB(),AB));
test('AC-011 separate scope is consistent with the build judgment',()=>checkConsistency(separateB(),AB));
test('AC-011 missing statement is consistent with the build judgment',()=>checkConsistency(missingBFunds(),AB));
test('AC-011 unverified issuer mapping is consistent with the build judgment',()=>checkConsistency(unverifiedB(),AB));
test('AC-011 caller-supplied actual results are consistent with the build judgment',()=>checkConsistency(callerActual(),AB));
test('AC-011 reversed input order is consistent with the build judgment',()=>checkConsistency(reversedBA(),BA));

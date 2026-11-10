import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildReportInput, getReportPlan, ACTIVE_REPORT_ROUTE_IDS, renderReportInputHtml } from '../src/report-pipeline.js';
import { withDefaultSession, mcpRender } from './r02-fixtures.js';
import { ARTBOARD_REPORT_MAP } from '../src/report-artboard.js';
const received='2026-11-07T12:00:00.000Z';
const subject={id:'fixture',name:'미연결 검토 종목',venue:'KRX',currency:'KRW'};
const input=(report_id:typeof ACTIVE_REPORT_ROUTE_IDS[number]='R01')=>buildReportInput({report_id,subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received});
test('opt-in template preserves the section and source contract for every active route',()=>{
 for(const id of ACTIVE_REPORT_ROUTE_IDS){
  const doc=input(id), html=renderReportInputHtml(doc,'artboard-v2');
  assert.match(html,/<body class="rs atp-artboard">/);assert.match(html,/data:image\/webp;base64,/);
  const ids=[...html.matchAll(/<section class="panel" id="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(ids.slice(0,doc.sections.length),getReportPlan(id).sections.map(s=>s.id));
  assert.ok(html.includes(received));assert.match(html,/미실행/);assert.match(html,/source_as_of/);
  assert.doesNotMatch(html,/<(?:img|script|link)\b[^>]*(?:src|href)=["']https?:/);
  assert.match(html,/connect-src 'none'/);assert.doesNotMatch(html,/echarts\.init|LightweightCharts\.createChart/);
 }
});
test('existing output remains default, and invalid template fails closed',()=>{
 const doc=input();assert.equal(renderReportInputHtml(doc),renderReportInputHtml(doc,'existing'));
 assert.doesNotMatch(renderReportInputHtml(doc),/<body class="rs atp-artboard">/);
 assert.throws(()=>renderReportInputHtml(doc,'unknown' as never),/invalid_report_template/);
});
test('reference UI portfolio is manual-only and internal QA stays nonpublic',()=>{
 assert.deepEqual(ARTBOARD_REPORT_MAP.find(x=>x.ui_id==='R3')?.report_ids,['R07']);
 assert.equal(ARTBOARD_REPORT_MAP.find(x=>x.ui_id==='R5')?.status,'manual_input_only');
 assert.equal(ARTBOARD_REPORT_MAP.find(x=>x.ui_id==='R6')?.status,'internal_qa');
 const doc=buildReportInput({report_id:'R04',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received});
 assert.equal(doc.consultation?.origin,'missing');assert.equal(doc.sources.length,0);assert.match(renderReportInputHtml(doc,'artboard-v2'),/비공개/);
});
test('HTML-like subject and section text is escaped; private fields are not accepted',()=>{
 const doc=input();doc.subject.name='<img src=x onerror=alert(1)>';
 doc.sections[0]!.body='<script>untrusted()</script>';
 const html=renderReportInputHtml(doc,'artboard-v2');assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(html,/<script>untrusted|<img src=x/);
 assert.throws(()=>renderReportInputHtml({...doc,account_ledger:{private:'PRIVATE_LEDGER_SENTINEL'}},'artboard-v2'));
});
test('provider rights-pending sentinel remains hidden in the new template',()=>{
 // Use the pipeline's supported provider response shape rather than promoting a caller source.
 const q=buildReportInput({report_id:'R01',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_market_snapshot',result:{structuredContent:{contract:'moai.stock.quote-snapshot.v1',provider:'kis',operation_id:'kis.kr.quote.snapshot.v1',origin:'actual',provenance:{source_as_of:'2026-11-07',available_at:received,origin:'actual',validation_status:'provider_shape_checked',provider_api_version:'fixture-v1'},data:{last:'987654321',open:'1',high:'2',low:'1',change:'1',change_percent:'1',volume:'1'}}}}]});
 assert.equal(q.mode,'actual');assert.ok(q.sources.length>0);assert.equal(q.chart,null);
 const html=renderReportInputHtml(q,'artboard-v2');assert.doesNotMatch(html,/987,?654,?321/);assert.match(html,/권리/);
});
test('adapter has narrow-screen containment and an explicit print layout',()=>{
 const css=readFileSync(new URL('../../src/report-artboard.ts',import.meta.url),'utf8');
 assert.match(css,/@media\(max-width:800px\)/);assert.match(css,/overflow-x:auto/);
 assert.match(css,/@media print/);assert.match(css,/@page\{size:A4/);assert.match(css,/table-header-group/);
});

test('MCP template option returns the same validated report through a memory resource',async()=>{
 await withDefaultSession(async rpc=>{
  const reply=await mcpRender(rpc,input(),{template:'artboard-v2'});
  const metadata=reply.result.structuredContent;assert.equal(metadata.host_rendering,'not_observed');
  const read=await rpc('resources/read',{uri:metadata.resource_uri});
  assert.match(read.result.contents[0].text,/<body class="rs atp-artboard">/);
  const rejected=await mcpRender(rpc,input(),{template:'unknown'});assert.equal(rejected.result.isError,true);
 });
});

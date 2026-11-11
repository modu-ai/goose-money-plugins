import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVE_REPORT_ROUTE_IDS, buildReportInput, getReportPlan, renderReportInputHtml } from '../src/report-pipeline.js';
import { RenderReportHtmlInputSchema } from '../src/report-html-mcp.js';
import { renderReportTemplate } from '../src/report-template-renderer.js';
import { mcpRender, withDefaultSession } from './r02-fixtures.js';

// Cast lets the same runtime regression run before the optional argument is implemented.
const render = renderReportInputHtml as (value: unknown, template?: string) => string;
const received='2026-11-07T12:00:00.000Z';
const input=(report_id:string='R01')=>buildReportInput({report_id,subject:{id:'TEST',name:'합성 검수 종목',venue:'KRX',currency:'KRW'},cutoff:received,display_timezone:'Asia/Seoul',received_at:received});

test('opt-in artboard preserves report sections and immutable input for every active route',()=>{
  for(const id of ACTIVE_REPORT_ROUTE_IDS){
    const doc=input(id), before=JSON.stringify(doc), html=render(doc,'artboard-v2');
    assert.match(html,/<body class="rs atp-artboard">/);
    assert.match(html,/data:image\/png;base64,/);
    assert.doesNotMatch(html,/data:image\/webp|artboard-wordmark\.webp/);
    const ids=[...html.matchAll(/<section class="panel" id="([^"]+)"/g)].map(m=>m[1]);
    assert.deepEqual(ids.slice(0,doc.sections.length),getReportPlan(id).sections.map(s=>s.id));
    assert.equal(JSON.stringify(doc),before);
  }
});

test('existing remains default; unknown template fails closed at renderer and MCP schema',()=>{
  const doc=input();assert.equal(render(doc),render(doc,'existing'));
  assert.doesNotMatch(render(doc),/<body class="rs atp-artboard">/);
  assert.throws(()=>render(doc,'unknown'),/invalid_report_template/);
  assert.equal(RenderReportHtmlInputSchema.safeParse({report_input:doc,template:'artboard-v2'}).success,true);
  assert.equal(RenderReportHtmlInputSchema.safeParse({report_input:doc,template:'unknown'}).success,false);
});

test('artboard keeps the CSP identical and does not add external scripts or images',()=>{
  const doc=input(), html=render(doc,'artboard-v2');
  const csp=(s:string)=>/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(s)?.[1];
  assert.equal(csp(html),csp(render(doc)));
  assert.match(html,/connect-src 'none'/);
  assert.doesNotMatch(html,/<(?:img|script|link)\b[^>]*(?:src|href)=["']https?:/);
});

test('artboard escapes hostile text and never promotes pending provider values',()=>{
  const doc=input();doc.subject.name='<img src=x onerror=evil()>';doc.sections[0]!.body='<script>evil()</script>';
  const html=render(doc,'artboard-v2');assert.match(html,/&lt;script&gt;evil/);assert.doesNotMatch(html,/<script>evil|<img src=x/);
  const denied=buildReportInput({report_id:'R01',subject:doc.subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_market_snapshot',result:{structuredContent:{contract:'moai.stock.quote-snapshot.v1',provider:'kis',origin:'actual',provenance:{origin:'actual',source_as_of:'2026-11-07',available_at:received,validation_status:'provider_shape_checked'},data:{last:'987654321',open:'1',high:'2',low:'1'}}}}]});
  assert.ok(denied.sources.length>0);assert.doesNotMatch(render(denied,'artboard-v2'),/987,?654,?321/);
});

test('artboard includes narrow-screen containment and print rules from the candidate',()=>{
  const html=render(input(),'artboard-v2');
  assert.match(html,/\.rs \.table-wrap\{max-width:100%;overflow-x:auto\}/);
  assert.match(html,/@media\(max-width:800px\)/);
  assert.match(html,/@page\{size:A4/);
  assert.match(html,/\.rs thead\{display:table-header-group\}/);
});

test('artboard keeps numeric cells on one line while other cells still wrap',()=>{
  const html=render(input(),'artboard-v2');
  assert.match(html,/\.rs \.table-wrap th,\.rs \.table-wrap td\{white-space:normal/);
  assert.match(html,/\.rs \.table-wrap td\.numeric\{[^}]*white-space:nowrap/);
});

test('merged manual consultation remains private in both templates',()=>{
  for(const id of ['R04','R05']){
    const doc=input(id);assert.ok(doc.consultation);
    for(const template of ['existing','artboard-v2'])assert.match(render(doc,template),/개인 수동 입력 · 비공개/);
  }
});

test('both templates retain the manual-consultation guard for R04 and R05',()=>{
  for(const id of ['R04','R05']){
    const doc=input(id);delete doc.consultation;
    for(const template of ['existing','artboard-v2'] as const){
      assert.throws(()=>renderReportTemplate(doc,getReportPlan(id),template),/manual_consultation_only/);
    }
  }
});

test('MCP template option produces readable HTML through the existing memory resource',async()=>{
  await withDefaultSession(async rpc=>{
    const result=await mcpRender(rpc,input(),{template:'artboard-v2'});
    assert.equal(result.result.isError,undefined);
    assert.equal(result.result.structuredContent.host_rendering,'not_observed');
    const resource=await rpc('resources/read',{uri:result.result.structuredContent.resource_uri});
    assert.match(resource.result.contents[0].text,/<body class="rs atp-artboard">/);
    const rejected=await mcpRender(rpc,input(),{template:'unknown'});assert.equal(rejected.result.isError,true);
  });
});

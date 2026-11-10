import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {buildReportInput,renderReportInputHtml,type ReportInput} from '../src/report-pipeline.js';
import * as renderer from '../src/report-template-renderer.js';
import * as htmlMcp from '../src/report-html-mcp.js';
import {mcpRender,withDefaultSession} from './r02-fixtures.js';

const received='2026-11-08T02:35:10.562Z';
function quote(origin:'synthetic'|'actual'='synthetic'){return buildReportInput({report_id:'R01',subject:{id:'TEST',name:'합성 표시 검수',venue:'KRX',currency:'KRW'},cutoff:received,received_at:received,display_timezone:'Asia/Seoul',calls:[{tool_name:'get_market_snapshot',result:{structuredContent:{contract:'moai.stock.quote-snapshot.v1',provider:'kis',origin,provenance:{origin,source_as_of:null,available_at:received,validation_status:origin==='synthetic'?'synthetic_fixture':'provider_shape_checked'},data:{last:'193500.1250',open:'180000',high:'196500',low:'179200',change_percent:'13.0696',volume:'35516270'}}}}]});}
const rows=(doc:ReportInput)=>{const fn=(renderer as unknown as {reportMetricDisplayRows?:(d:ReportInput)=>string[][]}).reportMetricDisplayRows;assert.equal(typeof fn,'function');return fn!(doc);};
const preview=(doc:ReportInput)=>{const fn=(htmlMcp as unknown as {reportReadablePreview?:(d:ReportInput)=>string}).reportReadablePreview;assert.equal(typeof fn,'function');return fn!(doc);};

test('readable preview shares exact decimal display, Korean units and unknown period without mutating input',()=>{
  const doc=quote(),before=JSON.stringify(doc),text=preview(doc);
  assert.match(text,/193,500\.1250/);assert.match(text,/원\/주/);assert.match(text,/기준일 미확인/);
  assert.match(text,/2026-11-08 11:35 KST/);assert.match(text,/합성/);assert.equal(JSON.stringify(doc),before);
});

test('preview and HTML keep pending values hidden while retaining raw input',()=>{
  const doc=quote('actual');assert.ok(doc.sources.every(source=>source.rights==='pending'));
  const before=JSON.stringify(doc);assert.doesNotMatch(preview(doc),/193,?500\.1250/);assert.match(preview(doc),/권리 확인 대기/);
  assert.doesNotMatch(renderReportInputHtml(doc,'artboard-v2'),/193,?500\.1250/);assert.equal(JSON.stringify(doc),before);
});

test('preview escapes HTML, Markdown links, table delimiters and embedded newlines',()=>{
  const doc=quote();doc.subject.name='<img src=x> | [외부](https://invalid.example)\n새 행';
  const text=preview(doc);assert.doesNotMatch(text,/<img/);assert.ok(text.includes('&lt;img src=x&gt; \\| \\[외부\\]'));
  assert.ok(!text.includes('\n새 행'));
});

test('private manual consultation preview remains explicitly private',()=>{
  for(const report_id of ['R04','R05']){
    const doc=buildReportInput({report_id,subject:{id:'TEST',name:'합성 상담',venue:'KRX',currency:'KRW'},cutoff:received,received_at:received,display_timezone:'Asia/Seoul'});
    assert.match(preview(doc),/개인 수동 입력 · 비공개/);
  }
});

test('identical finance aliases collapse only for display; the raw ledger and report input retain both',()=>{
  const doc=quote(),originalCount=doc.metrics.length,metric={...doc.metrics[0]!,field_id:'reported.revenue',label:'매출 · 원문 금액',unit:'KRW',value:'333605938000000'};
  doc.metrics.push(metric,{...metric,field_id:'provider_finance.revenue'});
  const before=JSON.stringify(doc);assert.equal(rows(doc).length,originalCount+1);assert.equal(JSON.stringify(doc),before);
  const ledger=/<summary>출처·시각·검증 장부<\/summary>([\s\S]*?)<\/details>/.exec(renderReportInputHtml(doc,'artboard-v2'))?.[1]??'';
  assert.equal((ledger.match(/333,605,938,000,000/g)??[]).length,2);
});

for(const [name,changed] of Object.entries({value:{value:'2'},period:{period:'different'},source:{source_id:'other'},unit:{unit:'different'},scope:{scope:'standalone'},scale:{scale:'millions'},currency:{currency:'USD'},label:{label:'다른 정의'},status:{status:'missing'},reason:{missing_reason:'different'}})){
  test(`finance alias differing in ${name} remains separate`,()=>{
    const doc=quote(),metric={...doc.metrics[0]!,field_id:'reported.revenue',label:'매출'};
    doc.metrics=[metric,{...metric,field_id:'provider_finance.revenue',...changed} as typeof metric];assert.equal(rows(doc).length,2);
  });
}

test('MCP returns readable text plus the unchanged HTML resource contract',async()=>{
  await withDefaultSession(async rpc=>{
    const result=await mcpRender(rpc,quote(),{template:'artboard-v2'});
    assert.equal(result.result.isError,undefined);assert.match(result.result.content[0].text,/193,500\.1250/);
    assert.equal(result.result.structuredContent.host_rendering,'not_observed');
    const resource=result.result.content.find((x:{type:string})=>x.type==='resource_link');assert.ok(resource);
    const read=await rpc('resources/read',{uri:resource.uri});assert.match(read.result.contents[0].text,/atp-artboard/);
  });
});

test('chart inputs show pending state before runtime executes and keep source tables',()=>{
  const html=renderReportInputHtml(quote(),'artboard-v2');assert.match(html,/class="chart-runtime-status" role="status"/);
  assert.match(html,/화면 생성은 아직 확인되지 않았습니다/);assert.match(html,/원수치/);
});

test('LWC time series also has a pending message and retained raw table',()=>{
  const base=quote();const history={contract:'moai.stock.price-history.v1',provider:'kis',operation_id:'KIS-039',origin:'synthetic',received_at:received,source_as_of:null,rights_status:'pending',bars:['2026-11-05','2026-11-06'].map((date,index)=>({date,open:'1000',high:'1100',low:'900',close:String(1000+index),volume:'100',turnover:'100000',currency:'KRW',price_unit:'KRW/share',volume_unit:'shares',turnover_unit:'KRW',adjusted:false,source_ref:`fixture:${date}`,mapping_status:'verified',blockers:[]}))};
  const doc=buildReportInput({report_id:'R01',subject:base.subject,cutoff:received,received_at:received,display_timezone:'Asia/Seoul',calls:[{tool_name:'get_price_history',result:{structuredContent:history}}]});
  assert.ok(doc.time_series);const html=renderReportInputHtml(doc,'artboard-v2');
  assert.match(html,/id="chart-lwc"[\s\S]*?class="chart-runtime-status" role="status"/);assert.match(html,/원수치/);
});

test('preview truncates its table explicitly while HTML retains all metrics',()=>{
  const doc=quote();doc.metrics=Array.from({length:15},(_,i)=>({...doc.metrics[0]!,field_id:`fixture.metric.${i}`,label:`합성 지표 ${i}`}));
  const text=preview(doc);assert.match(text,/전체 15개 지표 중 12개/);assert.ok(!text.includes('합성 지표 14'));
  assert.equal(doc.metrics.length,15);
});

for(const engine of ['echart','lwc'])for(const state of ['engine_missing','init_failed','setup_failed','ready']){
  test(`${engine} ${state}: state is visible and one failed chart cannot prevent the next`,()=>{
    const html=renderReportInputHtml(quote(),'artboard-v2');
    const runtime=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]!).find(s=>s.startsWith('(()=>{')&&s.includes("document.getElementById('chart-specs')"));assert.ok(runtime);
    const notes=[{textContent:''},{textContent:''}];
    const elements=notes.map(note=>({dataset:{} as Record<string,string>,clientWidth:400,closest:()=>({querySelector:(selector:string)=>selector==='.chart-runtime-status'?note:null})}));
    let attempts=0;
    const makeChart=()=>{
      const index=attempts++;if(index===0&&state==='init_failed')throw Error('synthetic failure');
      const setup=()=>{if(index===0&&state==='setup_failed')throw Error('synthetic setup failure');};
      return {setOption:setup,resize(){},addSeries:()=>({setData:setup}),timeScale:()=>({fitContent(){}})};
    };
    const engines=state==='engine_missing'?{}:{echarts:{init:makeChart},LightweightCharts:{createChart:makeChart,LineSeries:{},LineStyle:{Dashed:1,Solid:0}}};
    const spec=(id:number)=>({id:String(id),kind:'bar',title:'합성',labels:['표본'],values:[1],dates:['2026-11-08'],series:[{name:'종가',values:['1']}]});
    const specs={echart:engine==='echart'?[spec(0),spec(1)]:[],lwc:engine==='lwc'?[spec(0),spec(1)]:[]};
    const document={body:{},documentElement:{},getElementById:(id:string)=>id==='chart-specs'?{textContent:JSON.stringify(specs)}:elements[Number(id)]};
    const context={window:engines,...engines,document,getComputedStyle:()=>({getPropertyValue:()=> '#902531'}),ResizeObserver:class{observe(){}}};
    assert.doesNotThrow(()=>runInNewContext(runtime!,context,{timeout:1000}));
    assert.equal(elements[0]!.dataset.renderStatus,state==='init_failed'||state==='setup_failed'?'failed':state);
    assert.equal(elements[1]!.dataset.renderStatus,state==='engine_missing'?'engine_missing':'ready');
    for(const note of notes)assert.match(note.textContent,/원수치/);
  });
}

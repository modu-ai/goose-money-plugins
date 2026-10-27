import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReportInput, getReportPlan, REPORT_ROUTE_IDS, ReportInputSchema, renderReportInputHtml } from '../src/report-pipeline.js';

const received='2026-10-23T04:00:00.000Z';
const subject={id:'000660',name:'검토용 종목',venue:'KRX',currency:'KRW'};
const wrap=(structuredContent:unknown)=>({structuredContent,content:[{type:'text',text:JSON.stringify(structuredContent)}]});
const syntheticQuote={
  contract:'moai.stock.quote-snapshot.v1',provider:'kis',operation_id:'kis.kr.quote.snapshot.v1',origin:'synthetic',
  provenance:{source_as_of:'2026-10-22',available_at:received,origin:'synthetic',validation_status:'synthetic_fixture',provider_api_version:'fixture-v1'},
  data:{last:'12345',open:'12000',high:'12500',low:'11900',change:'345',change_percent:'2.87',volume:'1000'},
};
function syntheticHistory(){
  const dates:string[]=[];let date=new Date('2026-08-03T00:00:00.000Z');
  while(dates.length<65){const weekday=date.getUTCDay();if(weekday!==0&&weekday!==6)dates.push(date.toISOString().slice(0,10));date=new Date(date.getTime()+86_400_000);}
  return {
    contract:'moai.stock.price-history.v1',provider:'kis',operation_id:'KIS-039',origin:'synthetic',received_at:received,source_as_of:null,rights_status:'pending',
    bars:dates.map((day,index)=>({date:day,open:String(1000+index),high:String(1010+index),low:String(990+index),close:String(1000+index),volume:'10000',turnover:String((1000+index)*10000),currency:'KRW',price_unit:'KRW/share',volume_unit:'shares',turnover_unit:'KRW',adjusted:false,source_ref:`fixture:${day}`,mapping_status:'verified',blockers:[]})),
  };
}

test('15 templates render exact consumer section IDs with honest not-run status',()=>{
  assert.equal(REPORT_ROUTE_IDS.length,15);
  let totalSections=0;
  for(const report_id of REPORT_ROUTE_IDS){
    const plan=getReportPlan(report_id);
    const input=buildReportInput({report_id,subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received});
    const parsed=ReportInputSchema.parse(input);
    assert.deepEqual(parsed.sections.map(section=>section.id),plan.sections.map(section=>section.id),report_id);
    totalSections+=parsed.sections.length;
    const html=renderReportInputHtml(parsed);
    assert.ok(html.includes(`<h1>검토용 종목</h1>`)&&html.includes(`<h2>${plan.title}</h2>`),report_id);
    for(const section of plan.sections)assert.ok(html.includes(`id="${section.id}"`),`${report_id}/${section.id}`);
    assert.match(html,/미실행/);
    assert.match(html,/source_as_of/);
    if(report_id==='R01'){
      assert.match(html,/자료 처리 단계 설명/);
      assert.match(html,/Pele 1\.7\.0/);
    }else{
      assert.match(html,/차트와 표는 해당 보고서 섹션의 선언된 블록 순서/);
      assert.doesNotMatch(html,/Pele 1\.7\.0/);
    }
    assert.doesNotMatch(html,/<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:/i);
    assert.match(html,/connect-src 'none'/);
    assert.doesNotMatch(html,/LightweightCharts\.createChart|echarts\.init/);
  }
  assert.equal(totalSections,84);
});

test('synthetic MCP-shaped quote and KIS-039 history reach ECharts, LWC, SMA and Pele output',()=>{
  const input=buildReportInput({report_id:'R01',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[
    {tool_name:'get_market_snapshot',result:wrap(syntheticQuote)},
    {tool_name:'get_price_history',result:wrap(syntheticHistory())},
  ]});
  assert.equal(input.mode,'synthetic');
  assert.equal(input.chart?.kind,'bar');
  assert.deepEqual(input.chart?.values,['12000','12500','11900','12345']);
  assert.equal(input.time_series?.renderer,'lightweight-charts');
  assert.equal(input.time_series?.dates.length,65);
  assert.deepEqual(input.time_series?.series.map(series=>series.label),['종가','SMA 5','SMA 20','SMA 60']);
  assert.equal(input.time_series?.series[1]?.values[4],'1002');
  assert.equal(input.time_series?.series[1]?.values.at(-1),'1062');
  assert.equal(input.time_series?.series[2]?.values.at(-1),'1054.5');
  assert.equal(input.time_series?.series[3]?.values.at(-1),'1034.5');
  const html=renderReportInputHtml(input);
  assert.match(html,/합성 fixture · 실제 자료 아님/);
  assert.match(html,/Apache ECharts 6\.1\.0/);
  assert.match(html,/Lightweight Charts 5\.2\.1/);
  assert.match(html,/applyOptions\(\{visible\}\)/);
  assert.match(html,/button\.setAttribute\('aria-pressed','true'\)/);
  assert.match(html,/SMA 60/);
  assert.match(html,/pele-flowchart/);
  assert.match(html,/자료 처리 단계 설명 · 수치·기업 관계·분석 근거가 아닌 일반 흐름도/);
  assert.match(html,/received_at 2026-10-23T04:00:00\.000Z/);
  assert.match(html,/--color-chart-1:#D71920/);
  assert.match(html,/--color-chart-2:#3E6AE1/);
  assert.match(html,/--color-chart-3:#16836B/);
  assert.match(html,/--color-chart-4:#7955B8/);
  assert.match(html,/--color-chart-5:#C86B15/);
  assert.match(html,/color:palette/);
  assert.match(html,/const colors=palette/);
  assert.match(html,/table\{font-size:18px/);
  assert.match(html,/th\{[^}]*font-size:17px/);
  assert.match(html,/font-weight:650/);
  assert.match(html,/padding:14px 18px/);
  assert.match(html,/overflow-x:auto/);
  assert.doesNotMatch(html,/margin-right:-2px/);
  assert.doesNotMatch(html,/<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:/i);
  assert.match(html,/connect-src 'none'/);
});

test('actual-looking provider data stays hidden behind pending rights and never renders charts',()=>{
  const actualQuote={...syntheticQuote,origin:'actual',provenance:{...syntheticQuote.provenance,origin:'actual',validation_status:'provider_shape_checked'}};
  const input=buildReportInput({report_id:'R01',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_market_snapshot',result:wrap(actualQuote)}]});
  assert.equal(input.mode,'actual');
  assert.equal(input.chart,null);
  assert.equal(input.time_series,null);
  assert.ok(input.metrics.every(metric=>metric.value===null||metric.status==='provided_unverified'));
  const html=renderReportInputHtml(input);
  assert.match(html,/실제 입력 · 검증 상태 표시/);
  assert.doesNotMatch(html,/echarts\.init|LightweightCharts\.createChart/);
  assert.match(html,/권리 확인 대기|rights_pending/);
});

import {UsQuoteRawSchema} from '../src/global-market-data.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {buildReportInput,getReportPlan,normalizeMcpToolResult,renderReportInputHtml,REPORT_ROUTE_IDS,ReportInputSchema} from '../src/report-pipeline.js';
import { InMemoryTransport, type McpServer } from '@modelcontextprotocol/server';
import { createStockMcpServer } from './synthetic-member-access.js';

const received='2026-10-23T03:00:00.000Z';
const subject={id:'000660',name:'시험 종목',venue:'KRX',currency:'KRW'};
const syntheticQuote={
  ok:true,provider:'kis',operation_id:'kis.kr.quote.snapshot.v1',market:'KR',
  provenance:{source_as_of:null,received_at:received,available_at:received,rights_status:'pending',origin:'synthetic',validation_status:'synthetic_fixture',provider_api_version:'fixture-v1'},
  data:{last:'12345',open:'12000',high:'12500',low:'11900',previous_close:'12000',change:'345',change_percent:'2.87',volume:'1000'}
};
const result=(structuredContent:unknown)=>({structuredContent,content:[{type:'text',text:JSON.stringify(structuredContent)}]});

test('route bindings cover 15 retained routes including restored ETF/futures and held account template',()=>{
  assert.equal(REPORT_ROUTE_IDS.length,15);
  assert.deepEqual(REPORT_ROUTE_IDS,['R01','R02','R03','R04','R05','R06','R07','R08','R09','R10','R11','R12','R13','R14','U01']);
  assert.equal(getReportPlan('R12').report_id,'R12');assert.equal(getReportPlan('R13').report_id,'R13');
  assert.throws(()=>getReportPlan('U02'),/unsupported_report_route/);
  for(const id of REPORT_ROUTE_IDS)assert.ok(getReportPlan(id).sections.length>0,id);
});

test('route binding exposes known blockers instead of treating all registered tools as usable',()=>{
  const plan=getReportPlan('R01');
  assert.ok(plan.groups.some(g=>g.tools.some(t=>t.name==='get_price_history'&&t.readiness==='registered_default_rights_blocked')));
  assert.ok(plan.groups.some(g=>g.tools.some(t=>t.name==='get_market_flows'&&t.readiness==='registered_partial'&&t.note.includes('inquire-investor'))));
  const account=getReportPlan('R04').groups.find(g=>g.id==='account_ledger');
  assert.equal(account?.tools.length,0);
});

test('MCP success normalizes synthetic quote with explicit synthetic lineage and exact decimal strings',()=>{
  const normalized=normalizeMcpToolResult('get_market_snapshot',result(syntheticQuote),received,0);
  assert.equal(normalized.outcome,'success');
  assert.equal(normalized.source?.kind,'synthetic');
  assert.equal(normalized.source?.rights,'synthetic_only');
  assert.equal(normalized.source?.received_at,received);
  assert.equal(normalized.metrics.find(m=>m.field_id==='quote.last')?.value,'12345');
  assert.equal(normalized.metrics.find(m=>m.field_id==='quote.last')?.status,'synthetic');
});

test('provider metadata cannot grant display rights or rewrite the MCP receipt time',()=>{
  const actual={...syntheticQuote,display_rights:'local_view',provenance:{...syntheticQuote.provenance,received_at:'2026-10-22T02:00:00.000Z',origin:'actual',validation_status:'provider_shape_checked'}};
  const normalized=normalizeMcpToolResult('get_market_snapshot',result(actual),received,0);
  assert.equal(normalized.source?.kind,'kis');
  assert.equal(normalized.source?.rights,'pending');
  assert.equal(normalized.source?.received_at,received);
  assert.equal(normalized.metrics.find(m=>m.field_id==='quote.last')?.value,null);
  assert.equal(normalized.metrics.find(m=>m.field_id==='quote.last')?.status,'rights_pending');
  const report=buildReportInput({report_id:'R01',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_market_snapshot',result:result(actual)}]});
  assert.ok(report.sections.some(section=>section.status==='rights_pending'));
});

test('rights_pending MCP errors carry only a safe code and never create a provider source',()=>{
  const call={isError:true,content:[{type:'text',text:'error_code=rights_pending'}]};
  const normalized=normalizeMcpToolResult('get_price_history',call,received,0);
  assert.equal(normalized.outcome,'error');
  assert.equal(normalized.error_code,'rights_pending');
  assert.equal(normalized.source,null);
});

test('unrecognized MCP error text is reduced to a safe generic code',()=>{
  const call={isError:true,content:[{type:'text',text:'token=secret-looking provider stack trace'}]};
  const normalized=normalizeMcpToolResult('get_public_filings',call,received,0);
  assert.equal(normalized.error_code,'upstream_unavailable');
  assert.equal(JSON.stringify(normalized).includes('secret-looking'),false);
});

test('KIS-039 blocked bars produce missing metrics, not fabricated chart values',()=>{
  const payload={contract:'moai.stock.price-history.v1',provider:'kis',operation_id:'KIS-039',origin:'synthetic',received_at:received,source_as_of:null,rights_status:'pending',bars:[{date:'2026-10-22',open:null,high:null,low:null,close:null,volume:null,turnover:null,currency:null,price_unit:null,volume_unit:null,turnover_unit:null,adjusted:null,source_ref:'fixture',mapping_status:'blocked',blockers:['unit_unresolved']}]};
  const input=buildReportInput({report_id:'R01',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_price_history',result:result(payload)}]});
  assert.equal(input.mode,'synthetic');
  assert.equal(input.chart,null);
  assert.equal(input.metrics.find(m=>m.field_id==='history.close')?.value,null);
  assert.equal(input.metrics.find(m=>m.field_id==='history.close')?.missing_reason,'provider_field_mapping_blocked_or_unverified');
});

test('all 15 retained report routes map MCP results to schema-valid partial input and escaped standalone HTML',()=>{
  const routeNarratives:string[]=[];
  for(const report_id of REPORT_ROUTE_IDS){
    const input=buildReportInput({report_id,subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received});
    assert.equal(ReportInputSchema.parse(input).report_id,report_id);
    const plan=getReportPlan(report_id);
    assert.ok(plan.presentation,`${report_id} has an explicit report layout`);
    assert.deepEqual(input.sections.map(section=>section.id),plan.sections.map(section=>section.id));
    routeNarratives.push(input.sections[0]!.body??'');
    const html=renderReportInputHtml(input);
    assert.match(html,/Content-Security-Policy/);
    assert.equal(html.includes('자료 처리 단계 설명'),report_id==='R01'); assert.equal(html.includes('Pele 1.7.0'),report_id==='R01'); if(report_id!=='R01')assert.match(html,/차트와 표는 해당 보고서 섹션의 선언된 블록 순서/);
    assert.match(html,/connect-src 'none'/);
    assert.doesNotMatch(html,/<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:/i);
  }
  assert.equal(new Set(routeNarratives).size,REPORT_ROUTE_IDS.length,'each report route has a route-specific reading boundary');
});

test('R01 layout preserves the source template nine-section order and visual slots',()=>{
  const layout=getReportPlan('R01').presentation;
  assert.ok(layout);
  assert.deepEqual(layout.sections.map(section=>[section.id,section.blocks]),[
    ['R01.S01',['table']],
    ['R01.S02',['donut','pele','table']],
    ['R01.S03',['line','bar','table']],
    ['R01.S04',['bar','matrix','table']],
    ['R01.S05',['line','bar','table']],
    ['R01.S06',['table']],
    ['R01.X01',['line','bar','line','line','table']],
    ['R01.X02',['bar','line','table']],
    ['R01.X03',['timeline','table']],
  ]);
});

test('route calculations derive price change, earnings margin and EPS with exact matching bases',()=>{
  const quote=buildReportInput({report_id:'U01',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_market_snapshot',result:result(syntheticQuote)}]});
  assert.equal(quote.metrics.find(metric=>metric.field_id==='metric.change_pct')?.value,'2.875');
  assert.equal(quote.metrics.find(metric=>metric.field_id==='metric.change_pct')?.unit,'%');

  const observations=[
    {field_id:'provider_finance.operating_profit',label:'영업이익',value:'200',unit:'KRW',currency:'KRW',period:'2025-FY',scale:'1',period_kind:'FY',scope:'consolidated'},
    {field_id:'provider_finance.revenue',label:'매출',value:'1000',unit:'KRW',currency:'KRW',period:'2025-FY',scale:'1',period_kind:'FY',scope:'consolidated'},
    {field_id:'reported.net_income_common',label:'보통주 귀속 순이익',value:'2',unit:'KRW',currency:'KRW',period:'2025-FY',scale:'1000000',period_kind:'FY',scope:'consolidated'},
    {field_id:'reported.shares_weighted',label:'가중평균 보통주식수',value:'1000000',unit:'shares',currency:'KRW',period:'2025-FY',scale:'1',period_kind:'FY',scope:'consolidated'},
  ];
  const payload={contract:'moai.stock.report-observations.v1',origin:'synthetic',operation_id:'synthetic-report-fixture-v1',provenance:{origin:'synthetic',source_as_of:'2025-12-31',validation_status:'synthetic_fixture',provider_api_version:'fixture-only'},observations};
  const report=buildReportInput({report_id:'R01',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_fundamentals',result:result(payload)}]});
  assert.equal(report.metrics.find(metric=>metric.field_id==='metric.operating_margin')?.value,'20');
  const eps=report.metrics.find(metric=>metric.field_id==='metric.eps');
  assert.equal(eps?.value,'2');
  assert.equal(eps?.unit,'KRW/share');
  assert.equal(eps?.scale,'1');
});

test('R02 and R08 derive only basis-aligned cash-flow, ETF premium and macro surprise metrics',()=>{
  const rows=[
    ['reported.cfo','영업현금흐름','300','KRW','KRW'],
    ['reported.capex','투자지출','100','KRW','KRW'],
    ['etf.nav','ETF NAV','100','KRW/share','KRW'],
    ['quote.last','ETF 종가','120','KRW/share','KRW'],
  ].map(([field_id,label,value,unit,currency])=>({field_id,label,value,unit,currency,period:'2026-10-22',scale:'1',period_kind:'FY',scope:'consolidated'}));
  const fundamentals={contract:'moai.stock.report-observations.v1',origin:'synthetic',operation_id:'r02-finance-fixture',provenance:{origin:'synthetic',source_as_of:'2026-10-22',validation_status:'synthetic_fixture',provider_api_version:'fixture-only'},observations:rows};
  const r02=buildReportInput({report_id:'R02',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_fundamentals',result:result(fundamentals)}]});
  assert.equal(r02.metrics.find(metric=>metric.field_id==='metric.fcf')?.value,'200');
  assert.equal(r02.metrics.find(metric=>metric.field_id==='metric.etf_premium')?.value,'20');
  const mismatched={...fundamentals,observations:rows.map(row=>row.field_id==='reported.capex'?{...row,period:'2025-12-31'}:row)};
  const noFcf=buildReportInput({report_id:'R02',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_fundamentals',result:result(mismatched)}]});
  assert.equal(noFcf.metrics.find(metric=>metric.field_id==='metric.fcf')?.value,null);

  const macro={contract:'moai.stock.report-observations.v1',origin:'synthetic',operation_id:'r08-macro-fixture',provenance:{origin:'synthetic',source_as_of:'2026-10-22',validation_status:'synthetic_fixture',provider_api_version:'fixture-only'},observations:[
    {field_id:'macro.actual',label:'발표값',value:'110',unit:'index points',currency:null,period:'2026-Q3',scale:'1',period_kind:'quarter',scope:'not_applicable'},
    {field_id:'macro.expected',label:'예상값',value:'100',unit:'index points',currency:null,period:'2026-Q3',scale:'1',period_kind:'quarter',scope:'not_applicable'},
    {field_id:'macro.previous',label:'이전값',value:'90',unit:'index points',currency:null,period:'2026-Q2',scale:'1',period_kind:'quarter',scope:'not_applicable'},
  ]};
  const r08=buildReportInput({report_id:'R08',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_global_index_history',result:result(macro)}]});
  assert.equal(r08.metrics.find(metric=>metric.field_id==='metric.surprise')?.value,'10');
  assert.match(r08.metrics.find(metric=>metric.field_id==='metric.surprise')?.label??'',/거시 발표값/);
});

test('U01 quote chart is placed only in its declared product-search section',()=>{
  const report=buildReportInput({report_id:'U01',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_market_snapshot',result:result(syntheticQuote)}]});
  assert.equal(report.chart?.section_id,'U01.S01');
  const html=renderReportInputHtml(report);
  const start=html.indexOf('id="U01.S01"');const end=html.indexOf('</section>',start);
  assert.ok(start>=0&&end>start);
  assert.match(html.slice(start,end),/chart-echarts-legacy/);
});

test('R03 derives the investor-flow bar from aligned normalized observations and blocks pending live values',()=>{
  const observations=['foreign','individual','institution'].map((investor,index)=>({
    field_id:`flow.${investor}.net_value`,label:`${investor} 순매수`,value:String((index-1)*100),unit:'KRW',currency:'KRW',period:'2026-10-22',scale:'1',period_kind:'observation',scope:'not_applicable'
  }));
  const payload={contract:'moai.stock.report-observations.v1',provider:'fixture-only',operation_id:'synthetic-flow-v1',origin:'synthetic',provenance:{source_as_of:'2026-10-22',origin:'synthetic',validation_status:'synthetic_fixture',provider_api_version:'fixture-only'},observations};
  const report=buildReportInput({report_id:'R03',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_market_flows',result:result(payload)}]});
  assert.deepEqual(report.visuals?.map(visual=>visual.section_id),['R03.S02']);
  assert.equal(report.visuals?.[0]?.kind,'bar');
  assert.deepEqual(report.visuals?.[0]?.values,['-100','0','100']);
  assert.equal(ReportInputSchema.parse(report).mode,'synthetic');
  const html=renderReportInputHtml(report);const start=html.indexOf('id="R03.S02"');const end=html.indexOf('</section>',start);
  assert.match(html.slice(start,end),/chart-echarts-1/);
  const live={...payload,origin:'actual',provenance:{...payload.provenance,origin:'actual',validation_status:'provider_shape_checked'}};
  const blocked=buildReportInput({report_id:'R03',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_market_flows',result:result(live)}]});
  assert.equal(blocked.visuals?.length??0,0);
  assert.ok(blocked.metrics.every(metric=>metric.value===null&&metric.status==='rights_pending'));
  assert.doesNotMatch(renderReportInputHtml(blocked),/<td[^>]*>100<\/td>/);
});

test('historical routes calculate SMA20 and rebased price from ordered mapped bars',()=>{
  const bars=Array.from({length:20},(_,index)=>({date:`2026-10-${String(index+1).padStart(2,'0')}`,open:String(100+index),high:String(100+index),low:String(100+index),close:String(100+index),volume:'1000',turnover:'100000',currency:'KRW',price_unit:'KRW/share',volume_unit:'shares',turnover_unit:'KRW',adjusted:false,source_ref:'fixture-only',mapping_status:'verified',blockers:[]}));
  const payload={contract:'moai.stock.price-history.v1',provider:'kis',operation_id:'KIS-039-fixture-only',origin:'synthetic',source_as_of:'2026-10-20',received_at:received,rights_status:'pending',bars};
  const report=buildReportInput({report_id:'R10',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_price_history',result:result(payload)}]});
  assert.equal(report.metrics.find(metric=>metric.field_id==='metric.ma20')?.value,'109.5');
  assert.equal(report.metrics.find(metric=>metric.field_id==='metric.price_rebased')?.value,'119');
  assert.equal(report.time_series?.adjustment,'unadjusted');
  assert.equal(report.mode,'synthetic');
});

test('R04 calculates local user-supplied NAV and concentration without account calls',()=>{
  const report=buildReportInput({report_id:'R04',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,user_supplied:{account_ledger:{as_of:'2026-10-22',currency:'KRW',cash:'20',liabilities:'5',positions:[{label:'포지션 A',market_value:'60'},{label:'포지션 B',market_value:'40'}]}}});
  assert.equal(report.mode,'supplied');
  assert.equal(report.execution_status,'provided_unverified');
  assert.equal(report.sources[0]?.kind,'user_supplied');
  assert.equal(report.sources[0]?.validation_status,'unverified');
  assert.equal(report.metrics.find(metric=>metric.field_id==='metric.NAV')?.value,'115');
  assert.equal(report.metrics.find(metric=>metric.field_id==='metric.HHI')?.value,'0.52');
  assert.equal(report.visuals?.[0]?.section_id,'R04.S01');
  assert.ok(report.sections.find(section=>section.id==='R04.S01')?.source_ids?.includes(report.sources[0]!.id));
  const html=renderReportInputHtml(report);
  assert.match(html,/사용자 제공 입력 · 외부 대사 전/);
  assert.match(html,/외부 원장·가격·체결과 대사하지 않았으므로/);
  assert.match(html,/115/);
  assert.equal(report.sources.length,1,'local user input is the only source');
  assert.equal(report.sections.find(section=>section.id==='R04.S01')?.status,'partial');
});

test('R14 computes drawdown from a user-supplied equity curve and refuses mixed MCP calls',()=>{
  const user_supplied={backtest_curve:{currency:'KRW',points:[{date:'2026-10-20',equity:'100'},{date:'2026-10-21',equity:'110'},{date:'2026-10-22',equity:'88'},{date:'2026-10-23',equity:'105'}]}};
  const report=buildReportInput({report_id:'R14',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,user_supplied});
  assert.equal(report.mode,'supplied');
  assert.equal(report.metrics.find(metric=>metric.field_id==='metric.max_drawdown')?.value,'20');
  assert.equal(report.visuals?.[0]?.section_id,'R14.S06');
  assert.equal(report.visuals?.[0]?.kind,'line');
  const html=renderReportInputHtml(report);
  assert.match(html,/사용자 제공 자산곡선/);
  assert.match(html,/chart-echarts-1/);
  assert.throws(()=>buildReportInput({report_id:'R14',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,user_supplied,calls:[{tool_name:'get_price_history',result:result({})}]}),/user_supplied_local_input_cannot_be_mixed_with_mcp_results/);
  assert.throws(()=>buildReportInput({report_id:'R14',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,user_supplied:{backtest_curve:{currency:'KRW',points:[{date:'2026-10-22',equity:'110'},{date:'2026-10-21',equity:'100'}]}}}),/backtest_curve_dates_not_strictly_increasing/);
});

test('R01 quote result creates provenance-linked report metrics and safe HTML without external loads',()=>{
  const input=buildReportInput({report_id:'R01',subject:{...subject,name:'<script>alert(1)</script>'},cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_market_snapshot',result:result(syntheticQuote)}]});
  assert.equal(input.mode,'synthetic');
  assert.equal(input.sources.length,1);
  assert.equal(input.metrics.find(m=>m.field_id==='quote.last')?.source_id,input.sources[0]?.id);
  const html=renderReportInputHtml(input);
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>alert/);
  assert.match(html,/합성 fixture · 실제 자료 아님/);
  assert.match(html,/Apache ECharts 6.1.0/);
  assert.doesNotMatch(html,/<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:/i);
});

test('unrequired tools cannot be silently imported into a report route',()=>{
  assert.throws(()=>buildReportInput({report_id:'U01',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_fundamentals',result:result({})}]}),/tool_not_required_by_report_route/);
});


const VISUAL_KINDS=new Set(['bar','line','donut','scatter']);
function perReportFixture(reportId:string,origin:'synthetic'|'actual'){
  const plan=getReportPlan(reportId);
  let selected:{section:{id:string;blocks:string[]};kind:'bar'|'line'|'donut'|'scatter';tool:string;fields:string[]}|undefined;
  for(const section of plan.presentation?.sections??[]){
    for(const block of section.blocks){
      if(!VISUAL_KINDS.has(block))continue;
      for(const group of plan.groups){
        if(!group.tools.length)continue;
        const routeSection=plan.sections.find(item=>item.id===section.id)!;
        const fields=group.required_fields.filter(field=>routeSection.field_ids.includes(field));
        if(fields.length>=2){
          selected={section,kind:block as 'bar'|'line'|'donut'|'scatter',tool:group.tools[0]!.name,fields};
          break;
        }
      }
      if(selected)break;
    }
    if(selected)break;
  }
  assert.ok(selected,reportId+' fixture path');
  const fieldX=selected.fields[0]!,fieldY=selected.fields[1]!;
  const observations=[
    {field_id:fieldX,label:'합성 X 지표',value:'11',unit:'fixture-unit',currency:null,period:'2026-10-22',scale:'1',period_kind:'observation',scope:'not_applicable'},
    {field_id:fieldY,label:'합성 Y 지표',value:'23',unit:'fixture-unit',currency:null,period:'2026-10-22',scale:'1',period_kind:'observation',scope:'not_applicable'}
  ];
  const visual=selected.kind==='scatter'
    ?{section_id:selected.section.id,kind:'scatter',title:'테스트 fixture 산점도',labels:['합성 대상 A','합성 대상 B'],x_values:['11','11'],y_values:['23','23'],x_unit:'fixture-unit',y_unit:'fixture-unit',metric_ids:[fieldX,fieldY,fieldX,fieldY]}
    :{section_id:selected.section.id,kind:selected.kind,title:'테스트 fixture '+selected.kind,labels:['합성 A','합성 B'],values:['11','23'],unit:'fixture-unit',metric_ids:[fieldX,fieldY]};
  const payload={
    contract:'moai.stock.report-observations.v1',
    provider:'fixture-only',
    operation_id:'synthetic-report-fixture-v1',
    origin,
    provenance:{source_as_of:'2026-10-22',origin,validation_status:origin==='synthetic'?'synthetic_fixture':'provider_shape_checked',provider_api_version:'fixture-only'},
    observations:origin==='actual'?observations.map(item=>({...item,value:'987654321012345678.123'})):observations,
    report_visuals:[visual]
  };
  return {plan:selected,call:{tool_name:selected.tool,result:result(payload)},payload};
}

async function reportProtocolConnection(server:McpServer) {
  const [client,peer]=InMemoryTransport.createLinkedPair();let id=0;
  const waiting=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  client.onmessage=message=>{const msg=message as any;const pending=waiting.get(msg.id);if(pending){clearTimeout(pending.timer);waiting.delete(msg.id);pending.resolve(msg);}};
  await client.start();await server.connect(peer);
  async function rpc(method:string,params:any) {const requestId=++id;const response=new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(requestId);reject(new Error('report_protocol_timeout'));},5000);waiting.set(requestId,{resolve,reject,timer});});await client.send({jsonrpc:'2.0',id:requestId,method,params} as any);return response;}
  const initialize=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'report-fixture-client',version:'1'}});
  await client.send({jsonrpc:'2.0',method:'notifications/initialized'});
  return {initialize,rpc,close:async()=>{for(const item of waiting.values()){clearTimeout(item.timer);item.reject(new Error('closed'));}await server.close();await client.close();}};
}

test('MCP assembles the eleven non-R01 active routes and refuses R04/R12-without-ETF-evidence/R13/R14 without deleting their templates',async()=>{
  const session=await reportProtocolConnection(createStockMcpServer());
  try{
    assert.ok(session.initialize.result.protocolVersion);
    const listed=await session.rpc('tools/list',{});
    assert.equal(listed.result.tools.length,36);
    const tool=listed.result.tools.find((item:any)=>item.name==='build_report_input');
    assert.ok(tool);assert.equal(tool.inputSchema.additionalProperties,false);assert.ok(tool.outputSchema);
    for(const report_id of REPORT_ROUTE_IDS){
      const fixture=report_id==='R01'?undefined:perReportFixture(report_id,'synthetic');
      const calls=report_id==='R01'?[{tool_name:'get_market_snapshot',result:result(syntheticQuote)}]:[fixture!.call];
      const response=await session.rpc('tools/call',{name:'build_report_input',arguments:{report_id,subject,cutoff:received,display_timezone:'Asia/Seoul',calls}});
      if(report_id==='R04'){assert.equal(response.result?.isError,true);continue;}
      // Issue #2 (revision 6): the route fixture for R12 carries no ETF structure call, R13 is held, R14 is out of scope.
      const refusal:Record<string,string>={R12:'report_not_applicable',R13:'report_release_hold',R14:'report_out_of_scope'};
      if(refusal[report_id]){assert.equal(response.result?.isError,true,report_id);assert.match(String(response.result?.content?.[0]?.text),new RegExp('error_code='+refusal[report_id]),report_id);continue;}
      assert.equal(response.result?.isError,undefined,report_id+' MCP call');
      const input=ReportInputSchema.parse(response.result.structuredContent);
      assert.equal(input.report_id,report_id);assert.equal(input.mode,'synthetic');
      const html=renderReportInputHtml(input);
      assert.match(html,/합성 fixture · 실제 자료 아님/,report_id+' provenance notice');
      assert.ok(html.includes(`<h1>${subject.name}</h1>`)&&html.includes(`<h2>${getReportPlan(report_id).title}</h2>`),report_id+' route template');
    }
    const actualQuote={...syntheticQuote,origin:'actual',provenance:{...syntheticQuote.provenance,origin:'actual',validation_status:'provider_shape_checked'}};
    const blocked=await session.rpc('tools/call',{name:'build_report_input',arguments:{report_id:'R01',subject,cutoff:received,display_timezone:'Asia/Seoul',calls:[{tool_name:'get_market_snapshot',result:result(actualQuote)}]}});
    const blockedInput=ReportInputSchema.parse(blocked.result.structuredContent);
    assert.equal(blockedInput.mode,'actual');assert.ok(blockedInput.metrics.every(metric=>metric.value===null&&metric.status==='rights_pending'));
  }finally{await session.close();}
});

test('matrix, timeline and evidence-linked Pele blocks render their declared layouts with synthetic provenance',()=>{
  const cases=[['matrix','R02'],['timeline','R03'],['pele','R08']] as const;
  for(const [kind,report_id] of cases){
    const plan=getReportPlan(report_id);
    const layout=plan.presentation!.sections.find(section=>section.blocks.includes(kind))!;
    const routeSection=plan.sections.find(section=>section.id===layout.id)!;
    const group=plan.groups.find(item=>item.tools.length&&item.required_fields.some(field=>routeSection.field_ids.includes(field)||routeSection.metric_ids.includes(field)))!;
    const fields=group.required_fields.filter(field=>routeSection.field_ids.includes(field)||routeSection.metric_ids.includes(field)).slice(0,2);
    assert.equal(fields.length,2,`${kind} fixture fields`);
    const observations=fields.map((field,index)=>({field_id:field,label:`합성 지표 ${index+1}`,value:index===0?'11':'23',unit:'fixture-unit',currency:null,period:'2026-10-22',scale:'1',period_kind:'observation',scope:'not_applicable'}));
    const visual=kind==='matrix'
      ?{section_id:layout.id,kind,title:'합성 비교 행렬',rows:['합성 A','합성 B'],columns:['지표 X','지표 Y'],values:['11','23','11','23'],unit:'fixture-unit',metric_ids:[fields[0],fields[1],fields[0],fields[1]]}
      :kind==='timeline'
        ?{section_id:layout.id,kind,title:'합성 사건 시간선',events:[{when:'2026-10-21',time_kind:'occurred',title:'합성 사건 A',detail:'발생시점 fixture'},{when:'2026-10-22',time_kind:'published',title:'합성 공개 B'}]}
        :{section_id:layout.id,kind,title:'합성 근거 관계도',nodes:[{id:'n1',label:'합성 출처',role:'evidence'},{id:'n2',label:'합성 결론',role:'outcome'}],edges:[{from:'n1',to:'n2',label:'지지 근거',metric_ids:[fields[0]]}]};
    const payload={contract:'moai.stock.report-observations.v1',provider:'fixture-only',operation_id:'synthetic-visual-fixture-v1',origin:'synthetic',provenance:{source_as_of:'2026-10-22',origin:'synthetic',validation_status:'synthetic_fixture',provider_api_version:'fixture-only'},observations,report_visuals:[visual]};
    const input=buildReportInput({report_id,subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:group.tools[0]!.name,result:result(payload)}]});
    ReportInputSchema.parse(input);
    const html=renderReportInputHtml(input);
    assert.match(html,kind==='matrix'?/class="matrix-figure"/:kind==='timeline'?/class="event-timeline"/:/class="pele-graph"/,`${report_id} ${kind} renderer`);
    assert.match(html,/source_as_of 2026-10-22/,`${kind} source as-of`);
    assert.match(html,/합성 fixture · 실제 자료 아님/,`${kind} synthetic label`);
    assert.doesNotMatch(html,/<(?:script|iframe)\b[^>]*src=/i,`${kind} no injected external executable`);
    const images=[...html.matchAll(/<img\b[^>]*src="([^"]+)"[^>]*>/gi)];assert.equal(images.length,1);assert.match(images[0]![1]!,/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    assert.doesNotMatch(html,/<img\b[^>]*on\w+=/i);
  }
});

test('each of the 14 non-R01 retained report routes runs normalize-to-chart success, rights-block and missing-input paths',()=>{
  const routes=REPORT_ROUTE_IDS.filter(id=>id!=='R01');
  assert.equal(routes.length,14);
  for(const report_id of routes){
    const fixture=perReportFixture(report_id,'synthetic');
    const input=buildReportInput({report_id,subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[fixture.call]});
    assert.equal(ReportInputSchema.parse(input).mode,'synthetic',report_id);
    assert.ok(input.metrics.some(metric=>metric.status==='synthetic'),report_id+' normalized metrics');
    assert.equal(input.visuals?.[0]?.section_id,fixture.plan.section.id,report_id+' visual section');
    const html=renderReportInputHtml(input);
    const sectionStart=html.indexOf('id="'+fixture.plan.section.id+'"');
    const sectionEnd=html.indexOf('</section>',sectionStart);
    const reportSection=html.slice(sectionStart,sectionEnd);
    assert.ok(sectionStart>=0&&sectionEnd>sectionStart,report_id+' section html');
    assert.match(reportSection,/chart-echarts-1/,report_id+' chart placed in its section');
    assert.match(reportSection,/Apache ECharts 6\.1\.0/,report_id+' chart family rendered');
    assert.match(reportSection,/11|23/,report_id+' raw fixture values accompany chart');
    assert.match(html,/합성 fixture · 실제 자료 아님/,report_id+' synthetic label');

    const blocked=perReportFixture(report_id,'actual');
    const blockedInput=buildReportInput({report_id,subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[blocked.call]});
    assert.equal(blockedInput.mode,'actual',report_id+' actual-mode fixture');
    assert.equal(blockedInput.visuals?.length??0,0,report_id+' no chart under pending rights');
    assert.ok(blockedInput.metrics.every(metric=>metric.value===null&&metric.status==='rights_pending'),report_id+' no actual value leaks');
    const blockedHtml=renderReportInputHtml(blockedInput);
    assert.doesNotMatch(blockedHtml,/987654321012345678\.123/,report_id+' hidden actual value');

    const missing=buildReportInput({report_id,subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received});
    assert.ok(missing.sections.some(section=>section.status==='not_run'),report_id+' not-run preserved');
    const missingHtml=renderReportInputHtml(missing);
    assert.match(missingHtml,/block-missing/,report_id+' layout-specific missing block');
    assert.doesNotMatch(missingHtml,/echarts\.init/,report_id+' no empty chart runtime');
  }
});


test('reported percentage survives a missing previous-close metric without inventing prior price',()=>{
  const payload={contract:'moai.stock.quote-snapshot.v1',provider:'kis',operation_id:'kis.kr.quote.snapshot.v1',origin:'synthetic',provenance:{source_as_of:'2026-10-22',origin:'synthetic',validation_status:'synthetic_fixture'},data:{last:'120',open:'110',high:'125',low:'108',change:'10',change_percent:'9.09',volume:'1000'}};
  const doc=buildReportInput({report_id:'R01',subject:{id:'SYNTHETIC',name:'합성 퍼센트 회귀',venue:'KRX',currency:'KRW'},cutoff:'2026-10-23T00:00:00Z',received_at:'2026-10-23T00:00:00Z',display_timezone:'Asia/Seoul',calls:[{tool_name:'get_market_snapshot',result:{structuredContent:payload}}]});
  assert.equal(doc.metrics.find(m=>m.field_id==='quote.previous_close')?.value,null);
  assert.equal(doc.metrics.find(m=>m.field_id==='metric.change_pct')?.value,'9.09');
  assert.equal(doc.metrics.find(m=>m.field_id==='metric.change_pct')?.label,'공급자 보고 가격 변동률');
  assert.equal(doc.metrics.find(m=>m.field_id==='metric.change_pct')?.source_id,doc.metrics.find(m=>m.field_id==='quote.change_percent')?.source_id);
});

test('validated quote projection keeps only route fields without weakening source rights',()=>{
 for(const report_id of ['R01','R02','R03','R05','R06','R07','R08','R09','R10','R11','R12','R13','R14','U01']){
  const plan=getReportPlan(report_id);if(!plan.groups.some(g=>g.tools.some(t=>t.name==='get_market_snapshot')))continue;
  const doc=buildReportInput({report_id,subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_market_snapshot',result:result(syntheticQuote)}]});
  const fields=new Set([...plan.groups.flatMap(g=>g.required_fields),...plan.sections.flatMap(s=>s.metric_ids)]);
  assert.ok(doc.metrics.every(m=>fields.has(m.field_id)),report_id);assert.equal(doc.mode,'synthetic');
 }
 const untrusted={...syntheticQuote,provenance:{...syntheticQuote.provenance,origin:'actual',validation_status:'caller_claim'}};
 const doc=buildReportInput({report_id:'R02',subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_market_snapshot',result:result(untrusted)}]});
 assert.ok(doc.metrics.every(m=>m.value===null));assert.ok(doc.sources.every(s=>s.rights==='pending'));
});


test('restored ETF route displays source raw NAV without inventing holdings or canonical premium (synthetic)',()=>{
 const payload={contract:'moai.stock.domestic-etf-quote.v1',provider:'kis',origin:'synthetic',received_at:received,rights_status:'pending',validation_status:'provider_shape_checked_not_live_reconciled',raw:{stck_prpr:'101',nav:'100',prdy_last_nav:'99',etf_ntas_ttam:'2000'},canonical:{nav:null,last_price:null}};
 const doc=buildReportInput({report_id:'R12',subject:{...subject,name:'합성 ETF'},cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_domestic_etf_snapshot',result:result(payload)}]});
 assert.equal(doc.mode,'synthetic');assert.ok(doc.source_tables?.some(table=>table.rows.some(row=>row.includes('100'))));assert.ok(!doc.metrics.some(m=>m.field_id==='metric.etf_premium'&&m.value!==null));
 const html=renderReportInputHtml(doc);assert.match(html,/순자산가치/);assert.match(html,/추정하지|검증/);
});
test('restored futures route reads nested domestic and signed overseas raw quotes without notional calculation (synthetic)',()=>{
 for(const [tool_name,contract,raw,expected]of [
 ['get_index_futures_snapshot','moai.stock.index-futures-quote.v1',{output1:{futs_prpr:'300.50',hts_otst_stpl_qty:'123'},output2:{},output3:{}},'300.50'],
 ['get_overseas_futures_snapshot','moai.stock.overseas-futures-quote.v1',{last_price:'-12.50',open_price:'-13.00'},'-12.50']
 ] as const){const payload={contract,provider:'kis',origin:'synthetic',received_at:received,rights_status:'pending',validation_status:'provider_shape_checked_not_live_reconciled',raw};
 const doc=buildReportInput({report_id:'R13',subject:{...subject,name:'합성 선물'},cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name,result:result(payload)}]});
 assert.ok(doc.source_tables?.some(table=>table.rows.some(row=>row.includes(expected))),tool_name);assert.ok(!doc.metrics.some(m=>m.field_id==='metric.future_notional'&&m.value!==null));const html=renderReportInputHtml(doc);assert.ok(html.includes(expected));assert.match(html,/승수/);
 }
});

test('US ETF shared quote retains raw values without invented currency, holdings or NAV calculation (synthetic)',()=>{
 const payload={contract:'moai.stock.us-quote.v1',provider:'kis',origin:'synthetic',received_at:received,rights_status:'pending',raw:{rsym:'DQQQ',last:'123.45',base:'122.00',tvol:'1000',tamt:''},canonical:{last_price:null,currency:null}};
 UsQuoteRawSchema.parse(payload.raw);
 const doc=buildReportInput({report_id:'R12',subject:{...subject,name:'합성 미국 ETF',venue:'NAS',currency:'USD'},cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls:[{tool_name:'get_us_market_snapshot',result:result(payload)}]});
 assert.ok(doc.source_tables?.some(t=>t.rows.some(row=>row.includes('123.45'))));assert.ok(doc.metrics.every(m=>m.value===null));assert.ok(doc.source_tables?.every(t=>!t.rows.some(row=>['시가','고가','저가'].includes(row[0]!))));assert.ok(doc.source_tables?.some(t=>t.rows.some(row=>row[0]==='거래대금'&&row[1]==='미제공')));const html=renderReportInputHtml(doc);assert.match(html,/123\.45/);assert.match(html,/구성 종목·비용률·분배금 자료가 아닙니다/);
});

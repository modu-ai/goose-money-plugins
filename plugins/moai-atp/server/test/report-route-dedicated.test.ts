// Dedicated route tests for R05, R07, R09 and R11 (issue #28).
// The enumeration loop in report-pipeline.test.ts proves every route renders; these tests pin the
// route-specific rules each readout promises. Synthetic fixtures only: no provider call, no account data.
// Every negative assertion is anchored by a positive one proving the fixture actually landed, so a
// schema-rejected fixture (zero metrics, error sections) cannot make a negative check pass vacuously.
import assert from 'node:assert/strict';
import test from 'node:test';
import {buildReportInput,getReportPlan,renderReportInputHtml,ReportInputSchema} from '../src/report-pipeline.js';

const received='2026-10-23T03:00:00.000Z';
const subject={id:'SYNTHETIC',name:'합성 경로 시험',venue:'KRX',currency:'KRW'};
const result=(structuredContent:unknown)=>({structuredContent,content:[{type:'text',text:JSON.stringify(structuredContent)}]});
type Obs={field_id:string;value:string;period?:string;period_kind?:'observation'|'quarter'|'FY'|'YTD';scope?:'consolidated'|'standalone'|'not_applicable';unit?:string;currency?:string|null};
function observationCall(tool_name:string,observations:Obs[]){
  const payload={
    contract:'moai.stock.report-observations.v1',provider:'fixture-only',operation_id:'synthetic-route-dedicated-v1',origin:'synthetic',
    provenance:{source_as_of:'2026-10-22',origin:'synthetic',validation_status:'synthetic_fixture',provider_api_version:'fixture-only'},
    observations:observations.map(o=>({field_id:o.field_id,label:'합성 '+o.field_id,value:o.value,unit:o.unit??'KRW',currency:o.currency===undefined?'KRW':o.currency,period:o.period??'2025-FY',scale:'1',period_kind:o.period_kind??'FY',scope:o.scope??'consolidated'})),
  };
  return {tool_name,result:result(payload)};
}
const build=(report_id:string,calls:ReturnType<typeof observationCall>[])=>ReportInputSchema.parse(buildReportInput({report_id,subject,cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls}));
type Doc=ReturnType<typeof build>;
const metric=(doc:Doc,id:string)=>doc.metrics.find(m=>m.field_id===id);
const landed=(doc:Doc,id:string,value:string,label:string)=>assert.equal(metric(doc,id)?.value,value,`${label}: fixture ${id} landed`);
const point=(field_id:string,value:string):Obs=>({field_id,value,period:'2026-10-22',period_kind:'observation',scope:'not_applicable'});

for(const [report_id,sectionId] of [['R07','R07.S03'],['R11','R11.S04']] as const){
  test(`${report_id} compares actual and consensus only on the same basis (synthetic)`,()=>{
    const same=build(report_id,[observationCall('get_fundamentals',[{field_id:'provider_finance.operating_profit',value:'110'},{field_id:'estimates.consensus',value:'100'}])]);
    landed(same,'provider_finance.operating_profit','110',report_id);landed(same,'estimates.consensus','100',report_id);
    assert.equal(metric(same,'metric.surprise')?.value,'10',`${report_id} same-basis surprise`);
    const html=renderReportInputHtml(same);
    const start=html.indexOf('id="'+sectionId+'"');assert.ok(start>=0,`${report_id} section present`);
    assert.match(html.slice(start,html.indexOf('</section>',start)),/chart-echarts-/,`${report_id} actual-vs-consensus bar in ${sectionId}`);

    for(const [label,estimate] of [['period',{period:'2026-FY'}],['scope',{scope:'standalone'}],['currency',{unit:'USD',currency:'USD'}]] as const){
      const mismatched=build(report_id,[observationCall('get_fundamentals',[{field_id:'provider_finance.operating_profit',value:'110'},{field_id:'estimates.consensus',value:'100',...estimate}])]);
      landed(mismatched,'provider_finance.operating_profit','110',`${report_id} ${label}`);landed(mismatched,'estimates.consensus','100',`${report_id} ${label}`);
      const surprise=metric(mismatched,'metric.surprise');
      assert.ok(surprise,`${report_id} ${label}: surprise row is kept to show why it is blank`);
      assert.equal(surprise.value,null,`${report_id} ${label} mismatch must not produce a surprise value`);
    }

    // #58 user decision: compare matching normalized bases and retain both sources.
    const split=build(report_id,[observationCall('get_fundamentals',[{field_id:'provider_finance.operating_profit',value:'110'}]),observationCall('get_kis_house_estimates',[{field_id:'estimates.consensus',value:'100'}])]);
    landed(split,'provider_finance.operating_profit','110',`${report_id} split`);landed(split,'estimates.consensus','100',`${report_id} split`);
    assert.equal(metric(split,'metric.surprise')?.value,'10',`${report_id} cross-source surprise`);
    assert.ok((split.visuals??[]).some(v=>v.section_id===sectionId),`${report_id} cross-source bar`);
  });
}

test('R05 keeps performance and cost sections incomplete without a user ledger and never invents a return (synthetic)',()=>{
  const plan=getReportPlan('R05');
  assert.deepEqual(plan.groups.find(g=>g.id==='account_ledger')?.tools,[],'R05 has no account-query tool');
  const doc=build('R05',[observationCall('get_market_snapshot',[point('quote.last','12345')])]);
  landed(doc,'quote.last','12345','R05');
  assert.equal(doc.sections.length,6);
  for(const section of doc.sections){
    assert.equal(section.status,'partial',section.id+' a quote alone never completes a performance section');
    assert.ok(section.missing_reason.length>0,section.id+' states what is missing');
    assert.ok(section.required_fields.some(f=>f.startsWith('account.')),section.id+' still requires the user ledger');
  }
  assert.ok(doc.metrics.every(m=>!m.field_id.startsWith('account.')),'no account metric is fabricated from a quote');
  assert.ok(doc.metrics.every(m=>!/return|twr|mwr|수익률/i.test(m.field_id+m.label)),'no return metric without cash flows');
  assert.match(renderReportInputHtml(doc),/빠진 현금흐름이나 체결 정보로 순수익률을 추정하지 않습니다/);
  const empty=build('R05',[]);
  for(const section of empty.sections)assert.equal(section.status,'not_run',section.id+' stays unrun with no input');
});

test('R09 leaves user-claim sections unrun and never turns evidence into a buy or sell instruction (synthetic)',()=>{
  const doc=build('R09',[observationCall('get_market_flows',[point('flow.foreign.net_value','500'),point('flow.individual.net_value','-500')])]);
  landed(doc,'flow.foreign.net_value','500','R09');landed(doc,'flow.individual.net_value','-500','R09');
  assert.notEqual(doc.sections.find(s=>s.id==='R09.S04')?.status,'not_run','R09.S04 receives the flow evidence');
  for(const id of ['R09.S01','R09.S02','R09.S05','R09.S06']){
    assert.equal(doc.sections.find(s=>s.id===id)?.status,'not_run',id+' needs the user thesis, not market data');
  }
  const html=renderReportInputHtml(doc);
  assert.match(html,/종목을 매수·매도하라는 문장으로 바꾸지 않습니다/);
  assert.doesNotMatch(html,/매수하세요|매도하세요|매수 추천|매도 추천|사야 합니다|팔아야 합니다/);
});

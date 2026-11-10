// Dedicated route tests for R05, R07, R09 and R11 (issue #28).
// The enumeration loop in report-pipeline.test.ts proves every route renders; these tests pin the
// route-specific rules each readout promises. Synthetic fixtures only: no provider call, no account data.
// Every negative assertion is anchored by a positive one proving the fixture actually landed, so a
// schema-rejected fixture (zero metrics, error sections) cannot make a negative check pass vacuously.
import assert from 'node:assert/strict';
import test from 'node:test';
import {buildReportInput,getReportPlan,renderReportInputHtml,ReportInputSchema} from '../src/report-pipeline.js';
import {costsFixture} from './manual-consultation-fixtures.js';

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

test('R05 requires private manual cost assumptions, rejects provider/ledger inputs and never invents a return (synthetic)',()=>{
  const plan=getReportPlan('R05');
  assert.deepEqual(plan.groups.map(g=>g.id),['holdings_snapshot','cost_assumptions']);
  assert.ok(plan.groups.every(g=>g.tools.length===0),'R05 has no provider or account-query tools');
  const quote=observationCall('get_market_snapshot',[point('quote.last','12345')]);
  assert.throws(()=>build('R05',[quote]),/manual_consultation_input_only/,'a quote is not manual cost input');
  assert.throws(()=>buildReportInput({report_id:'R05',subject,cutoff:received,display_timezone:'Asia/Seoul',user_supplied:{account_ledger:{as_of:'2026-10-22',currency:'KRW',cash:'100',liabilities:'0',positions:[{label:'합성 보유',market_value:'100'}]}}}),/manual_consultation_input_only/,'a ledger is not manual cost input');
  const input={...structuredClone(costsFixture),origin:'synthetic_fixture' as const};input.snapshot.as_of='2026-10-22';
  const assemble=(manual_consultation:typeof input)=>buildReportInput({report_id:'R05',cutoff:received,received_at:received,display_timezone:'Asia/Seoul',manual_consultation});
  const complete=assemble(input);
  landed(complete,'manual.cost.base.annual_total','17','R05 manual annual cost');
  landed(complete,'manual.cost.other.difference','7','R05 comparable annual cost difference');
  assert.equal(complete.consultation?.privacy,'private');
  const incomplete={...input,costs:input.costs.map(c=>({...c,annual_fixed_cost:null}))};
  const doc=buildReportInput({report_id:'R05',cutoff:received,received_at:received,display_timezone:'Asia/Seoul',manual_consultation:incomplete});
  assert.equal(doc.sections.length,6);
  for(const section of doc.sections){
    assert.equal(section.status,'partial',section.id+' incomplete assumptions never complete a consultation section');
    assert.ok(section.missing_reason.length>0,section.id+' states what is missing');
    assert.ok(section.required_fields.every(f=>f.startsWith('manual.')),section.id+' requires manual inputs only');
  }
  assert.equal(metric(doc,'manual.cost.base.annual_total')?.value,null,'missing fixed cost is not zero');
  assert.equal(metric(doc,'manual.cost.other.difference')?.value,null,'incomplete costs are not compared');
  assert.deepEqual(doc.visuals,[],'incomplete costs never produce a cost chart');
  for(const checked of [complete,doc]){
    assert.ok(checked.metrics.every(m=>!m.field_id.startsWith('account.')),'no account metric is fabricated');
    assert.ok(checked.metrics.every(m=>!/return|twr|mwr|수익률/i.test(m.field_id+m.label)),'no performance metric is invented');
    assert.equal(checked.chart,null);assert.equal(checked.time_series,null);
  }
  assert.match(renderReportInputHtml(doc),/미입력 비용을 0으로 대체하지 않습니다/);
  const empty=build('R05',[]);
  for(const section of empty.sections)assert.equal(section.status,'not_run',section.id+' stays unrun with no input');
  assert.equal(empty.metrics.length,0,'no input never fabricates a metric');
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

import assert from 'node:assert/strict';
import test from 'node:test';
import {ACTIVE_REPORT_ROUTE_IDS,ReportPipelineToolInputSchema,buildReportInput,getReportPlan} from '../src/report-pipeline.js';
import {planGooseRequest} from '../src/goose-routing.js';
import {withDefaultSession} from './r02-fixtures.js';

const args={report_id:'R14',subject:{id:'scope-fixture',name:'범위 검수',venue:'KRX',currency:'KRW'},cutoff:'2026-11-08T04:00:00.000Z',display_timezone:'Asia/Seoul'};
test('current public HTML assembly excludes archived R14 without deleting its historical plan',()=>{
 assert.equal((ACTIVE_REPORT_ROUTE_IDS as readonly string[]).includes('R14'),false);
 assert.equal(ReportPipelineToolInputSchema.safeParse(args).success,false);
 assert.equal(getReportPlan('R14').sections.length,6);
});
test('MCP build and HTML render reject archived R14 even when a caller supplies a valid old document',async()=>{
 const archived=buildReportInput({...args,display_timezone:'Asia/Seoul'});
 await withDefaultSession(async rpc=>{
  for(const [name,input] of [['build_report_input',args],['render_report_html',{report_input:archived,template:'artboard-v2'}]] as const){
   const response=await rpc('tools/call',{name,arguments:input});
   assert.ok(response.error||response.result?.isError,name);
  }
 });
});
for(const request of ['백테스트 해줘','/goose backtest','/goose-backtest 과거 성과 검증','백테스트하고 HTML 보고서'])test(`excluded backtest has no runnable steps: ${request}`,()=>{
 const plan=planGooseRequest(request);
 assert.equal(plan.status,'unsupported');assert.ok(plan.unsupported_actions.includes('backtest_out_of_product_scope'));
 assert.deepEqual(plan.steps,[]);assert.equal(plan.provider_dispatches,0);
});
for(const request of ['백테스트는 하지 말고 삼성전자 종목 분석','백테스트를 제외하고 삼성전자 실적 분석'])test(`explicitly excluding backtest preserves research: ${request}`,()=>{
 const plan=planGooseRequest(request);assert.equal(plan.status,'ready');assert.equal(plan.report_id,'R01');
 assert.deepEqual(plan.steps.map(s=>s.id),['analyze']);assert.deepEqual(plan.unsupported_actions,[]);assert.equal(plan.provider_dispatches,0);
});
test('scope restriction preserves research, account and trade boundaries',()=>{
 assert.equal(planGooseRequest('삼성전자 종목 분석').report_id,'R01');
 assert.equal(planGooseRequest('두 종목 비교 분석').report_id,'R02');
 for(const request of ['삼성전자 매수해','계좌 잔고 조회해','백테스트는 하지 말고 삼성전자 매수해','백테스트를 제외하고 계좌 잔고 조회해']){
  const plan=planGooseRequest(request);assert.equal(plan.status,'blocked');assert.deepEqual(plan.steps,[]);assert.equal(plan.provider_dispatches,0);
 }
});

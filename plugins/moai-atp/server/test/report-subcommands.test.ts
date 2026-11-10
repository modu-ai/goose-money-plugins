import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {planGooseRequest} from '../src/goose-routing.js';
import {dispatchGooseCommand} from '../src/cli.js';
import {getReportWorkflow,REPORT_WORKFLOW_IDS} from '../src/report-workflows.js';
import {getReportPlan} from '../src/report-pipeline.js';
import {openSession,createStockMcpServer} from './default-server-harness.js';

const plugin=fileURLToPath(new URL('../../../',import.meta.url));
for(let i=1;i<=13;i++){
 const id=`R${String(i).padStart(2,'0')}`;
 for(const command of [`/goose report ${id}`,`/goose ${id.toLowerCase()}`])test(`explicit report workflow: ${command}`,()=>{
  const plan=planGooseRequest(command);
  assert.equal(plan.report_id,id);
  assert.equal(plan.status,id==='R13'?'unsupported':'ready');
  assert.equal(plan.provider_dispatches,0);
  assert.equal(plan.execution_authority,'plan_only');
  const workflow=(plan as any).report_workflow;
  assert.equal(workflow.command,`/goose report ${id}`);
  assert.equal(workflow.skill,`goose-report-${id.toLowerCase()}`);
  assert.ok(existsSync(`${plugin}skills/goose/${workflow.workflow_ref}`));
  if(id==='R13')assert.equal(plan.steps.length,0);
 });
}
test('explicit report ID outranks asset inference, without retaining raw text',()=>{
 const plan=planGooseRequest('/goose report R02 ETF 비교 private-sentinel');
 assert.equal(plan.report_id,'R02');assert.ok(!JSON.stringify(plan).includes('private-sentinel'));
});
for(const id of ['R00','R1','R14','R99','U01','U02','U03'])test(`unsupported report identifier fails closed: ${id}`,()=>{
 const plan=planGooseRequest(`/goose report ${id}`);
 assert.equal(plan.status,'unsupported');assert.equal(plan.report_id,null);assert.equal(plan.steps.length,0);
});
for(const request of ['/goose report R04 계좌 조회','/goose report R05 송금 실행해','/goose r01 삼성전자 매수해줘'])test(`report command preserves financial block: ${request}`,()=>{
 const plan=planGooseRequest(request);assert.equal(plan.status,'blocked');assert.equal(plan.steps.length,0);assert.equal(plan.provider_dispatches,0);
});
test('manual report command has no provider tools and uses private snapshot requirements',()=>{
 for(const id of ['R04','R05']){
  const plan=planGooseRequest(`/goose report ${id}`);
  assert.deepEqual((plan as any).report_workflow.provider_tools,[]);
  assert.ok(plan.steps.every(s=>s.requirements.includes('no_provider_calls')));
 }
});
test('standard CLI resolves report ID without setup or credential actions',async()=>{
 const output:string[]=[];let unexpected=0;
 const code=await dispatchGooseCommand(['/goose','report','R03'],async()=>{unexpected++;return 0;},{write:()=>{}},async()=>{unexpected++;return 0;},{write:s=>output.push(s)});
 assert.equal(code,0);assert.equal(JSON.parse(output[0]!).report_id,'R03');assert.equal(unexpected,0);
});
test('all internal skill sources and packaged workflows exist, preserving one public skill',()=>{
 for(let i=1;i<=13;i++){
  const id=`R${String(i).padStart(2,'0')}`;
  const source=`${plugin}skill-sources/goose-report-${id.toLowerCase()}/SKILL.md`;
  assert.ok(existsSync(source));
  assert.ok(readFileSync(source,'utf8').includes(`/goose report ${id}`));
 }
 assert.deepEqual(readdirSync(`${plugin}skills`).filter(n=>existsSync(`${plugin}skills/${n}/SKILL.md`)),['goose']);
});
test('packaged workflow IDs, section mappings and MCP names match the current server',async()=>{
 const session=await openSession(createStockMcpServer());
 try{
  const reply=await session.rpc('tools/list',{});
  const names=new Set<string>(reply.result.tools.map((t:any)=>t.name));
  assert.equal(names.size,36);
  const forbidden=['get_domestic_index_history','get_domestic_index_period_history','get_kis_house_estimates','get_global_index_history','get_global_index_period_history','get_market_industry_investor_aggregates','get_overseas_ice_actions','get_sec_company_concept','get_sec_submissions'];
  for(const id of REPORT_WORKFLOW_IDS){
   const workflow=getReportWorkflow(id)!;
   assert.deepEqual(workflow.sections,getReportPlan(id).sections.map(s=>s.id));
   for(const tool of [...workflow.provider_tools,...workflow.local_tools])assert.ok(names.has(tool),`${id}:${tool}`);
   assert.ok(workflow.provider_tools.every(tool=>!forbidden.includes(tool)));
   const doc=readFileSync(`${plugin}skills/goose/${workflow.workflow_ref}`,'utf8');
   for(const tool of workflow.provider_tools)assert.ok(doc.includes('`'+tool+'`'));
   for(const section of workflow.sections)assert.ok(doc.includes('`'+section+'`'));
   assert.ok(doc.includes('관측 사실·계산 결과·해석/추론·결측'));
   assert.ok(doc.includes('공급자 기준시각과 수집시각'));
  }
 }finally{await session.close();}
});
test('returned workflow arrays cannot change subsequent plans',()=>{
 getReportWorkflow('R01')!.provider_tools.length=0;
 assert.ok(getReportWorkflow('R01')!.provider_tools.length>0);
 assert.equal(getReportWorkflow('R14'),undefined);
});

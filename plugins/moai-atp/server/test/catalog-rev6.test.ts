// Issue #2: align the report catalogue with function definition revision 6.
// R14 (backtest) is outside the product scope, R13 (futures) is held for the initial release,
// and R12 (ETF) applies only when ETF structure evidence is supplied. U02/U03 stay catalogue definitions.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as pipeline from '../src/report-pipeline.js';
const {ACTIVE_REPORT_ROUTE_IDS,getReportPlan}=pipeline;
const REPORT_CATALOG_IDS=((pipeline as Record<string,unknown>).REPORT_CATALOG_IDS??[]) as readonly string[];
import {planGooseRequest} from '../src/goose-routing.js';
import {createStockMcpServer} from './synthetic-member-access.js';
import {openSession,outcome} from './default-server-harness.js';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const received='2026-10-23T03:00:00.000Z';
const subject={id:'KRX:069500',name:'합성 대상',venue:'KRX',currency:'KRW'};
const args=(report_id:string,calls:unknown[]=[])=>({report_id,subject,cutoff:received,display_timezone:'Asia/Seoul',calls});
const wrap=(structuredContent:unknown)=>({structuredContent,content:[{type:'text',text:JSON.stringify(structuredContent)}]});
const syntheticQuote={ok:true,provider:'kis',operation_id:'kis.kr.quote.snapshot.v1',market:'KR',
  provenance:{source_as_of:null,received_at:received,available_at:received,rights_status:'pending',origin:'synthetic',validation_status:'synthetic_fixture',provider_api_version:'fixture-v1'},
  data:{last:'12345',open:'12000',high:'12500',low:'11900',previous_close:'12000',change:'345',change_percent:'2.87',volume:'1000'}};
const syntheticEtf={contract:'moai.stock.domestic-etf-quote.v1',provider:'kis',origin:'synthetic',received_at:received,rights_status:'pending',validation_status:'provider_shape_checked_not_live_reconciled',raw:{stck_prpr:'101',nav:'100',prdy_last_nav:'99',etf_ntas_ttam:'2000'},canonical:{nav:null,last_price:null}};

async function build(report_id:string,calls:unknown[]=[]){
  const session=await openSession(createStockMcpServer());
  try{return await session.rpc('tools/call',{name:'build_report_input',arguments:args(report_id,calls)});}
  finally{await session.close();}
}

test('catalogue holds the 16 revision-6 entries in code, catalog.json and CAPABILITIES.json',()=>{
  const expected=['R01','R02','R03','R04','R05','R06','R07','R08','R09','R10','R11','R12','R13','U01','U02','U03'];
  assert.deepEqual([...REPORT_CATALOG_IDS],expected);
  const catalog=JSON.parse(readFileSync(root+'skills/goose/references/catalog.json','utf8')).entries as {id:string;availability?:string;active?:boolean}[];
  assert.deepEqual(catalog.map(e=>e.id),expected);
  assert.equal(catalog.find(e=>e.id==='R12')?.availability,'conditional');
  assert.equal(catalog.find(e=>e.id==='R13')?.availability,'release_hold');
  assert.equal(catalog.find(e=>e.id==='R13')?.active,false);
  const caps=JSON.parse(readFileSync(root+'CAPABILITIES.json','utf8'));
  assert.deepEqual(caps.report_catalog.ids,expected);
  assert.deepEqual(caps.report_catalog.conditional,['R12']);
  assert.deepEqual(caps.report_catalog.release_hold,['R13']);
  assert.deepEqual(caps.report_catalog.excluded,['R14']);
  assert.deepEqual(caps.active_report_routes,[...ACTIVE_REPORT_ROUTE_IDS]);
  assert.equal(caps.local_report_input_builder.routes.includes('R14'),false);
});

test('R14 backtest is out of scope: not active and refused by build_report_input; its historical plan is kept',async()=>{
  assert.equal((ACTIVE_REPORT_ROUTE_IDS as readonly string[]).includes('R14'),false);
  assert.equal(getReportPlan('R14').report_id,'R14');
  assert.equal(outcome(await build('R14')),'report_out_of_scope');
});

test('R13 futures is on release hold: not active and refused by build_report_input',async()=>{
  assert.equal((ACTIVE_REPORT_ROUTE_IDS as readonly string[]).includes('R13'),false);
  assert.equal(outcome(await build('R13')),'report_release_hold');
});

test('R13 hold reaches the planner: a futures report request has no runnable steps',()=>{
  for(const request of ['해외 선물 분석 보고서','/goose 선물 점검']){
    const plan=planGooseRequest(request);
    assert.equal(plan.report_id,'R13',request);
    assert.equal(plan.status,'unsupported',request);
    assert.ok(plan.unsupported_actions.includes('report_release_hold'),request);
    assert.equal(plan.steps.length,0,request);
    assert.equal(plan.provider_dispatches,0,request);
  }
});

test('excluding futures in the request keeps the stock research route',()=>{
  const plan=planGooseRequest('선물은 빼고 삼성전자 종목 분석');
  assert.equal(plan.report_id,'R01');
  assert.equal(plan.status,'ready');
  assert.deepEqual(plan.unsupported_actions,[]);
});

test('R12 is not applicable without ETF structure evidence',async()=>{
  assert.equal(outcome(await build('R12')),'report_not_applicable');
  assert.equal(outcome(await build('R12',[{tool_name:'get_market_snapshot',result:wrap(syntheticQuote)}])),'report_not_applicable');
});

test('R12 still assembles when ETF structure evidence is supplied (synthetic)',async()=>{
  const reply=await build('R12',[{tool_name:'get_domestic_etf_snapshot',result:wrap(syntheticEtf)}]);
  assert.equal(outcome(reply),'OK');
  assert.equal(reply.result.structuredContent.report_id,'R12');
});

test('R04 requires explicit manual input after issue #13 acceptance',async()=>{
  assert.ok((ACTIVE_REPORT_ROUTE_IDS as readonly string[]).includes('R04'));
  assert.match(outcome(await build('R04')),/manual_consultation_input_only/);
});

test('U02 stays a catalogue definition without a report route',()=>{
  assert.throws(()=>getReportPlan('U02'),/unsupported_report_route/);
});

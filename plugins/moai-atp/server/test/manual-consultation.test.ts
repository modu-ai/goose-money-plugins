import assert from 'node:assert/strict';
import test from 'node:test';
import {buildReportInput,renderReportInputHtml,ActiveReportInputSchema} from '../src/report-pipeline.js';
import {snapshotFixture,costsFixture} from './manual-consultation-fixtures.js';
import {planGooseRequest} from '../src/goose-routing.js';
import {reportReadablePreview} from '../src/report-html-mcp.js';
import {openSession,createStockMcpServer} from './default-server-harness.js';
const cutoff='2026-11-08T04:00:00.000Z';
const args=(report_id:string,input:unknown=snapshotFixture)=>({report_id,cutoff,received_at:cutoff,display_timezone:'Asia/Seoul',manual_consultation:input} as any);
const metric=(doc:ReturnType<typeof buildReportInput>,id:string)=>doc.metrics.find(m=>m.field_id===id)?.value;
test('explicit manual consultation plans never enable account, provider or trade access',()=>{
 for(const [request,id]of [['수동 입력 보유 상담','R04'],['수동 입력 비용 영향 상담','R05']] as const){const p=planGooseRequest(request);assert.equal(p.status,'ready');assert.equal(p.report_id,id);assert.equal(p.provider_dispatches,0);assert.ok(p.steps.every(s=>s.requirements.includes('no_provider_calls')));}
 for(const request of ['수동 입력 보유 상담하고 삼성전자 매수해','수동 입력 보유 상담 계좌 조회','수동 입력 보유 상담 잔고 조회']){const p=planGooseRequest(request);assert.equal(p.status,'blocked');assert.deepEqual(p.steps,[]);}
});
test('R04 manual snapshot computes only point-in-time weights and target differences',()=>{
 const doc=buildReportInput(args('R04'));
 assert.equal(metric(doc,'manual.total_value'),'500');assert.equal(metric(doc,'manual.position.A.weight'),'60');assert.equal(metric(doc,'manual.position.A.target_gap'),'-10');
 assert.equal((doc as any).consultation.privacy,'private');assert.equal(doc.mode,'synthetic');
 for(const template of ['existing','artboard-v2'] as const)assert.match(renderReportInputHtml(doc,template),/비공개/);
 assert.ok(!doc.metrics.some(m=>/TWR|MWR|NAV|backtest/.test(m.field_id)));
});
test('R05 cost impact uses explicit annual amount/rate/fixed assumptions, without performance',()=>{
 const input={...snapshotFixture,costs:[{id:'base',label:'합성 비용 가정 A',currency:'KRW',basis_amount:'3000',annual_fee_percent:'0.5',annual_fixed_cost:'2'},{id:'other',label:'합성 비용 가정 B',currency:'KRW',basis_amount:'3000',annual_fee_percent:'0.8',annual_fixed_cost:'0'}]};
 const doc=buildReportInput(args('R05',input));
 assert.equal(metric(doc,'manual.cost.base.annual_total'),'17');assert.equal(metric(doc,'manual.cost.other.annual_total'),'24');assert.equal(metric(doc,'manual.cost.other.difference'),'7');
 assert.ok(!JSON.stringify(doc.sections).includes('시간가중'));assert.equal(doc.execution_status,'synthetic_fixture_rendered');
});
test('missing values and mixed currencies never become zero or an implicit FX conversion',()=>{
 const input=structuredClone(snapshotFixture) as any;input.snapshot.cash=null;input.snapshot.positions[1].currency='USD';
 const doc=buildReportInput(args('R04',input));assert.equal(metric(doc,'manual.total_value'),null);assert.equal(metric(doc,'manual.position.A.weight'),null);assert.equal(doc.visuals?.length,0);
});
test('default MCP manual snapshot -> both HTML templates -> resources/read; no account path',async()=>{
 const session=await openSession(createStockMcpServer({clock:()=>cutoff}));
 try{
  for(const report_id of ['R04','R05']){
   const {received_at,...input}=args(report_id);
   const built=await session.rpc('tools/call',{name:'build_report_input',arguments:input});assert.ok(!built.result?.isError&&built.result?.structuredContent,JSON.stringify(built));
   for(const template of ['existing','artboard-v2']){
    const rendered=await session.rpc('tools/call',{name:'render_report_html',arguments:{report_input:built.result.structuredContent,template}});assert.ok(!rendered.result?.isError,JSON.stringify(rendered));
    const read=await session.rpc('resources/read',{uri:rendered.result.structuredContent.resource_uri});assert.match(read.result.contents[0].text,/비공개/);
   }
  }
 }finally{await session.close();}
});
test('zero totals preserve zero money, and withhold ratios and charts',()=>{
 const input=structuredClone(snapshotFixture);input.snapshot.cash='0';for(const p of input.snapshot.positions)p.market_value='0';
 const doc=buildReportInput(args('R04',input));assert.equal(metric(doc,'manual.total_value'),'0');assert.equal(metric(doc,'manual.position.A.weight'),null);assert.deepEqual(doc.visuals,[]);
});
test('manual data is never promoted to a provider-confirmed actual report',()=>{
 const input={...snapshotFixture,origin:'manual'};const doc=buildReportInput(args('R04',input));
 assert.equal(doc.mode,'supplied');assert.equal(doc.execution_status,'provided_unverified');assert.equal(doc.sources[0]?.kind,'user_supplied');
 assert.equal(doc.sources[0]?.source_as_of,'2026-11-07');assert.ok(doc.metrics.filter(m=>m.value!==null).every(m=>m.status==='provided_unverified'));
 assert.equal(ActiveReportInputSchema.safeParse({...doc,mode:'actual',execution_status:'actual_data_partial'}).success,false);
});
test('goals are not inferred, supplied liquidity is static arithmetic only',()=>{
 const absent=buildReportInput(args('R04'));assert.ok(absent.consultation?.missing_inputs.includes('context.goal'));
 const doc=buildReportInput(args('R04',{...snapshotFixture,context:{goal:'합성 목표',horizon_months:12,liquidity_need:'150',constraints:'합성 제약'}}));
 assert.equal(metric(doc,'manual.liquidity_gap'),'-50');assert.ok(!doc.consultation?.missing_inputs.some(v=>v.startsWith('context.')));
});
test('fractional costs stay exact in the table rather than rounded into a money chart',()=>{
 const input=structuredClone(costsFixture);input.costs[0]!.basis_amount='0.1';input.costs[0]!.annual_fee_percent='0.2';input.costs[0]!.annual_fixed_cost='0';
 const doc=buildReportInput(args('R05',input));assert.equal(metric(doc,'manual.cost.base.annual_total'),'0.0002');assert.equal(metric(doc,'manual.cost.other.difference'),null);assert.deepEqual(doc.visuals,[]);
});
test('a missing annual fixed charge is not silently zero',()=>{
 const input=structuredClone(costsFixture) as any;input.costs[0].annual_fixed_cost=null;
 assert.equal(metric(buildReportInput(args('R05',input)),'manual.cost.base.annual_total'),null);
});
test('cost comparison requires the same currency and application amount',()=>{
 const input=structuredClone(costsFixture);input.costs[1]!.currency='USD';const doc=buildReportInput(args('R05',input));
 assert.equal(metric(doc,'manual.cost.other.annual_total'),'24');assert.equal(metric(doc,'manual.cost.other.difference'),null);assert.deepEqual(doc.visuals,[]);
});
test('snapshot graphs have bound metric lineage and never include provider history',()=>{
 const doc=buildReportInput(args('R04'));assert.deepEqual(doc.visuals?.map(v=>v.kind),['donut','bar']);assert.equal(doc.time_series,null);assert.equal(doc.chart,null);
 const costs=buildReportInput(args('R05',costsFixture));assert.equal(costs.visuals?.[0]?.kind,'bar');assert.ok(ActiveReportInputSchema.safeParse(costs).success);
});
test('money beyond Number safe integers stays exact without a misleading cost chart',()=>{
 const input=structuredClone(costsFixture);for(const c of input.costs){c.basis_amount='9007199254740993';c.annual_fee_percent='100';c.annual_fixed_cost='0';}
 const doc=buildReportInput(args('R05',input));assert.equal(metric(doc,'manual.cost.base.annual_total'),'9007199254740993');assert.deepEqual(doc.visuals,[]);
});
test('snapshot date uses the display timezone at a UTC midnight boundary',()=>{
 const input=structuredClone(snapshotFixture);input.snapshot.as_of='2026-11-08';assert.doesNotThrow(()=>buildReportInput({...args('R04',input),cutoff:'2026-11-07T23:30:00.000Z'}));
});
test('maximum admitted snapshot remains a bounded complete MCP result',async()=>{
 const input=structuredClone(snapshotFixture) as any;delete input.snapshot.target_cash_weight_percent;
 input.snapshot.positions=Array.from({length:50},(_,i)=>({id:'ID'+i,label:'합성'.repeat(50),currency:'KRW',market_value:null}));
 const session=await openSession(createStockMcpServer({clock:()=>cutoff}));
 try{const {received_at,...request}=args('R04',input);const reply=await session.rpc('tools/call',{name:'build_report_input',arguments:request});assert.ok(!reply.result?.isError,JSON.stringify(reply));assert.equal(reply.result.structuredContent.source_tables[0].rows.length,50);assert.match(reportReadablePreview(reply.result.structuredContent),/전체 205개 지표 중 12개/);assert.ok(Buffer.byteLength(JSON.stringify(reply))<300000);}
 finally{await session.close();}
});
for(const [label,change]of [
 ['duplicate ID',(v:any)=>{v.snapshot.positions[1].id='A';}],
 ['negative value',(v:any)=>{v.snapshot.positions[0].market_value='-1';}],
 ['bad calendar',(v:any)=>{v.snapshot.as_of='2026-02-30';}],
 ['future date',(v:any)=>{v.snapshot.as_of='2026-11-09';}],
 ['target sum',(v:any)=>{v.snapshot.target_cash_weight_percent='21';}],
 ['account field',(v:any)=>{v.snapshot.account_number='SYNTHETIC_PRIVATE_SENTINEL';}],
 ['secret field',(v:any)=>{v.access_token='SYNTHETIC_PRIVATE_SENTINEL';}],
 ['unsupported origin',(v:any)=>{v.origin='actual';}],
] as const)test('strict manual input refuses '+label,()=>{const input=structuredClone(snapshotFixture);change(input);assert.throws(()=>buildReportInput(args('R04',input)));});
test('HTML escapes user labels and keeps the private/source warning',()=>{
 const input=structuredClone(snapshotFixture);input.snapshot.positions[0]!.label='<script>alert(1)</script>';
 const html=renderReportInputHtml(buildReportInput(args('R04',input)),'artboard-v2');assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));assert.ok(!html.includes('<script>alert(1)</script>'));assert.match(html,/비공개/);
});
test('manual routes reject provider calls, receipts, legacy account ledgers and wrong report IDs',async()=>{
 assert.throws(()=>buildReportInput({...args('R04'),calls:[{tool_name:'get_market_snapshot',result:{}}]}));
 assert.throws(()=>buildReportInput({...args('R04'),user_supplied:{account_ledger:{}}}));
 assert.throws(()=>buildReportInput(args('R01')));
 const session=await openSession(createStockMcpServer({clock:()=>cutoff}));
 try{for(const extra of [{calls:[{tool_name:'get_market_snapshot',result:{}}]},{source_receipts:['00000000-0000-4000-8000-000000000000']},{account_number:'SYNTHETIC_PRIVATE_SENTINEL'}]){
  const {received_at,...input}=args('R04');const reply=await session.rpc('tools/call',{name:'build_report_input',arguments:{...input,...extra}});assert.ok(reply.error||reply.result?.isError);
 }}finally{await session.close();}
});

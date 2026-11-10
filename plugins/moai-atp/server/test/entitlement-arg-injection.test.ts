// Issue #109 (design #6 §3 principal rule, §5 N12): identity fields injected into MCP tool
// arguments must never change an entitlement verdict. Measured mechanism (first run, all four
// red before pinning): every tool input schema is strict, so injected keys are rejected by the
// input validation layer with "Unrecognized keys" BEFORE the entitlement gate runs — a forged
// call can never reach a verdict at all. A spoofed resource URI is likewise refused as
// unsupported by the wiring's trusted-cache lookup, never authorized by its text. These tests
// freeze both layers: schema rejection in front, gate fed by host state() only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStockMcpServer, type ServerOptions } from '../src/server.js';
import { openSession, outcome } from './default-server-harness.js';

const now = 1794268800;
const cutoff = '2026-11-10T05:20:00.000Z';
const member = (paid = false) => ({identity:{verified:true}, membership:{service_id:'stock',state:'joined'}, subscription:paid?{state:'active'}:null, learner_grant:null});
const reportArgs = (report_id = 'R01', extra: Record<string, unknown> = {}) => ({report_id, subject:{id:'KRX:000660',name:'합성 종목',venue:'KRX',currency:'KRW'},cutoff,display_timezone:'Asia/Seoul',calls:[],...extra});
// Everything a hostile client might stuff into arguments to look paid or logged in.
// The marker value must never appear in any response.
const forged = {user_id:'victim-user-42', tier:'paid', identity:{verified:true}, membership:{service_id:'stock',state:'joined'}, subscription:{state:'active'}, decision:'allow', scope:'atp.holdings.read'};
const policy = (state:()=>unknown = ()=>member()): NonNullable<ServerOptions['entitlement']> => ({enabled:true,serviceId:'stock',state,now:()=>now,toolFeatures:{get_market_snapshot:'R01',get_fundamentals:'R02',get_sec_submissions:'R07'}});
async function session(options:ServerOptions, work:(s:Awaited<ReturnType<typeof openSession>>)=>Promise<void>) {
 const s=await openSession(createStockMcpServer({clock:()=>cutoff,...options}));
 try { await work(s); } finally { await s.close(); }
}

test('paid-looking fields injected into tool arguments cannot reach a paid verdict', async()=>{
 await session({entitlement:policy()},async s=>{
  const base=await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs('R02')});
  const injected=await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs('R02',forged)});
  assert.equal(outcome(base),'entitlement_required');
  assert.match(outcome(injected),/^isError:Input validation error: Invalid arguments for tool build_report_input: Unrecognized keys: "user_id", "tier"/);
 });
});

test('free feature verdict is unchanged: clean call passes, injected call is rejected with no echo', async()=>{
 await session({entitlement:policy()},async s=>{
  const base=await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs('R01')});
  const injected=await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs('R01',forged)});
  assert.equal(outcome(base),'OK');
  assert.match(outcome(injected),/^isError:Input validation error: Invalid arguments for tool build_report_input: Unrecognized keys/);
  const text=JSON.stringify(injected);
  assert.ok(!text.includes('victim-user-42'),'injected user_id echoed back');
  assert.ok(!text.includes('atp.holdings.read'),'injected scope echoed back');
 });
});

test('unmapped tool with injected identity fields is rejected before any verdict', async()=>{
 await session({entitlement:policy()},async s=>{
  const injected=await s.rpc('tools/call',{name:'get_price_history',arguments:{symbol:'000660',board:'J',start_date:'2026-11-01',end_date:'2026-11-09',adjustment_code:'1',...forged}});
  assert.match(outcome(injected),/^isError:Input validation error: Invalid arguments for tool get_price_history: Unrecognized keys/);
 });
});

test('a resource URI carrying injected user identity is never authorized by its text', async()=>{
 let state=member();
 await session({entitlement:policy(()=>state)},async s=>{
  const built=await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs('R01')});assert.equal(outcome(built),'OK');
  const rendered=await s.rpc('tools/call',{name:'render_report_html',arguments:{report_input:built.result.structuredContent}});assert.equal(outcome(rendered),'OK');
  const uri=rendered.result.structuredContent.resource_uri as string;
  const spoofed=await s.rpc('resources/read',{uri:`${uri}?user_id=victim-user-42&tier=paid`});
  assert.equal(outcome(spoofed),'protocol_error:-32603:error_code=unsupported');
  assert.equal(outcome(await s.rpc('resources/read',{uri})),'OK','clean URI still works');
 });
});

// Design #6 §5 N17 (Refs #31, docs/design/identity-auth-contract.md): once the entitlement gate
// is wired, every tool call and resources/read must pass Identity first — discovery (listing)
// is the only exception. These tests freeze the contrast inside one unauthenticated session:
// tools/list and resources/list keep answering with the catalogue while every call and read
// denies, and the same call passes again after sign-in.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStockMcpServer, type ServerOptions } from '../src/server.js';
import { openSession, outcome } from './default-server-harness.js';

const now = 1794268800;
const cutoff = '2026-11-10T05:20:00.000Z';
const member = () => ({identity:{verified:true}, membership:{service_id:'stock',state:'joined'}, subscription:null, learner_grant:null});
const reportArgs = (report_id = 'R01') => ({report_id, subject:{id:'KRX:000660',name:'합성 종목',venue:'KRX',currency:'KRW'},cutoff,display_timezone:'Asia/Seoul',calls:[]});
const policy = (state:()=>unknown): NonNullable<ServerOptions['entitlement']> => ({enabled:true,serviceId:'stock',state,now:()=>now,toolFeatures:{get_market_snapshot:'R01',get_fundamentals:'R02',get_sec_submissions:'R07'}});
async function session(options:ServerOptions, work:(s:Awaited<ReturnType<typeof openSession>>)=>Promise<void>) {
 const s=await openSession(createStockMcpServer({clock:()=>cutoff,...options}));
 try { await work(s); } finally { await s.close(); }
}

test('discovery stays open while the gate denies every tool call and resource read (N17)',async()=>{
 let state:unknown=member();
 await session({entitlement:policy(()=>state)},async s=>{
  state={...member(),identity:{verified:false}};
  // gated surface: a free-feature report call, a data tool and a resource read all deny first
  assert.equal(outcome(await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs()})),'auth_required');
  assert.equal(outcome(await s.rpc('tools/call',{name:'get_market_snapshot',arguments:{symbol:'000660',board:'J'}})),'auth_required');
  assert.match(outcome(await s.rpc('resources/read',{uri:'moai-atp://reports/R01'})),/unsupported|unavailable/);
  // discovery exception: both list methods answer with the catalogue, not an entitlement error
  const tools=await s.rpc('tools/list',{});
  assert.ok(!tools.error,`tools/list errored: ${JSON.stringify(tools.error)}`);
  const names=(tools.result?.tools ?? []).map((t: {name?: unknown})=>t.name);
  assert.ok(names.length>=30,`tools/list returned only ${names.length} tools`);
  assert.ok(names.includes('build_report_input')&&names.includes('get_market_snapshot'),'catalogue misses expected tools');
  const resources=await s.rpc('resources/list',{});
  assert.ok(!resources.error,`resources/list errored: ${JSON.stringify(resources.error)}`);
  assert.ok(Array.isArray(resources.result?.resources),'resources/list did not answer a list');
  // the exception is discovery only: the identical call passes once identity returns
  state=member();
  assert.equal(outcome(await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs()})),'OK');
 });
});

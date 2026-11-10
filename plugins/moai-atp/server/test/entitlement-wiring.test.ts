import assert from 'node:assert/strict';
import test from 'node:test';
import { createStockMcpServer, type ServerOptions } from '../src/server.js';
import { openSession, outcome } from './default-server-harness.js';

const now = 1794268800;
const cutoff = '2026-11-10T05:20:00.000Z';
const member = (paid = false) => ({identity:{verified:true}, membership:{service_id:'stock',state:'joined'}, subscription:paid?{state:'active'}:null, learner_grant:null});
const reportArgs = (report_id = 'R01') => ({report_id, subject:{id:'KRX:000660',name:'합성 종목',venue:'KRX',currency:'KRW'},cutoff,display_timezone:'Asia/Seoul',calls:[]});
const policy = (state:()=>unknown = ()=>member()): NonNullable<ServerOptions['entitlement']> => ({enabled:true,serviceId:'stock',state,now:()=>now,toolFeatures:{get_market_snapshot:'R01',get_fundamentals:'R02',get_sec_submissions:'R07'}});
async function session(options:ServerOptions, work:(s:Awaited<ReturnType<typeof openSession>>)=>Promise<void>) {
 const s=await openSession(createStockMcpServer({clock:()=>cutoff,...options}));
 try { await work(s); } finally { await s.close(); }
}

test('opt-in disabled preserves the existing provider guard without resolving identity', async()=>{
 await session({entitlement:{...policy(()=>{throw new Error('must not run');}),enabled:false}},async s=>{
  assert.equal(outcome(await s.rpc('tools/call',{name:'get_fundamentals',arguments:{corp_code:'00126380',bsns_year:'2025',reprt_code:'11011',fs_div:'CFS'}})),'source_not_enabled');
 });
});

test('free member directly calling a paid tool is denied before any transport', async()=>{
 let calls=0;
 await session({entitlement:policy(),openDartEnabled:true,openDartTransport:{origin:'synthetic',send:async()=>{calls++;throw new Error('must not run');}}},async s=>{
  const reply=await s.rpc('tools/call',{name:'get_fundamentals',arguments:{corp_code:'00126380',bsns_year:'2025',reprt_code:'11011',fs_div:'CFS'}});
  assert.equal(outcome(reply),'entitlement_required');assert.equal(calls,0);
 });
});

test('missing KIS affects that call only; public/local report remains usable', async()=>{
 await session({entitlement:policy(),rightsEnabled:true},async s=>{
  assert.equal(outcome(await s.rpc('tools/call',{name:'get_market_snapshot',arguments:{symbol:'000660',board:'J'}})),'credential_missing');
  assert.equal(outcome(await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs()})),'OK');
 });
});

test('each invocation observes identity revocation, ignores caller identity, and denies unmapped tools',async()=>{
 let state:unknown=member();
 await session({entitlement:policy(()=>state)},async s=>{
  assert.equal(outcome(await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs()})),'OK');
  state={...member(),identity:{verified:false}};
  assert.equal(outcome(await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs()})),'auth_required');
  state=member();
  assert.equal(outcome(await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs('R02')})),'entitlement_required');
  assert.equal(outcome(await s.rpc('tools/call',{name:'get_price_history',arguments:{symbol:'000660',board:'J',start_date:'2026-11-01',end_date:'2026-11-09',adjustment_code:'1'}})),'unsupported');
 });
});

test('paid rendered resource is rechecked after downgrade and free resources still work',async()=>{
 let state=member(true);
 await session({entitlement:policy(()=>state)},async s=>{
  async function render(id:string){
   const built=await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs(id)});assert.equal(outcome(built),'OK');
   const rendered=await s.rpc('tools/call',{name:'render_report_html',arguments:{report_input:built.result.structuredContent}});assert.equal(outcome(rendered),'OK');
   return rendered.result.structuredContent.resource_uri as string;
  }
  const paid=await render('R02'), free=await render('R01');
  assert.equal(outcome(await s.rpc('resources/read',{uri:paid})),'OK');
  state=member();
  const denied=await s.rpc('resources/read',{uri:paid});assert.match(JSON.stringify(denied),/entitlement_required/);assert.doesNotMatch(JSON.stringify(denied),/<!doctype/i);
  assert.equal(outcome(await s.rpc('resources/read',{uri:free})),'OK');
  state={...member(),identity:{verified:false}};
  assert.match(JSON.stringify(await s.rpc('resources/read',{uri:free})),/auth_required/);
 });
});

test('state resolver failure is sanitized and missing configuration fails closed',async()=>{
 await session({entitlement:policy(()=>{throw new Error('synthetic-private-marker');})},async s=>{
  const reply=await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs()});
  assert.match(JSON.stringify(reply),/entitlement_unavailable/);assert.doesNotMatch(JSON.stringify(reply),/synthetic-private-marker/);
 });
 await session({entitlement:{...policy(),serviceId:''}},async s=>{
  assert.equal(outcome(await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs()})),'not_configured');
 });
});

test('unavailable capability is local to that tool and learner grant independently allows paid features',async()=>{
 let state:unknown={...member(),learner_grant:{start:now-1,end:now+1}};
 await session({entitlement:{...policy(()=>state),unavailableTools:['get_market_snapshot']}},async s=>{
  assert.equal(outcome(await s.rpc('tools/call',{name:'get_market_snapshot',arguments:{symbol:'000660',board:'J'}})),'unavailable');
  assert.equal(outcome(await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs('R02')})),'OK');
  state={...member(),learner_grant:{start:now-1,end:now}};
  assert.equal(outcome(await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs('R02')})),'entitlement_required');
 });
});

test('all data tools including helper registrations enforce the host mapping',async()=>{
 const {toolArguments}=await import('./default-server-harness.js');
 const tools=Object.entries(toolArguments).filter(([name])=>!['build_report_input','render_report_html'].includes(name));
 assert.equal(tools.length,34);
 await session({entitlement:{...policy(),toolFeatures:Object.fromEntries(tools.map(([name])=>[name,'R02']))}},async s=>{
  for(const [name,args] of tools)assert.equal(outcome(await s.rpc('tools/call',{name,arguments:args})),'entitlement_required',name);
 });
});

test('SEC public data needs no KIS/DART setup; revocation during callback withholds the result',async()=>{
 let state:unknown=member();let calls=0;let revoke=false;
 const body={cik:'320193',name:'Synthetic Company',tickers:['SYN'],exchanges:['Nasdaq'],filings:{recent:{accessionNumber:['0000320193-26-000001'],filingDate:['2026-10-20'],reportDate:['2026-09-30'],acceptanceDateTime:['2026-10-20T16:00:00Z'],form:['10-K'],primaryDocument:['synthetic.htm'],primaryDocDescription:['Synthetic annual report']},files:[]}};
 await session({entitlement:policy(()=>state),secEnabled:true,secTransport:{origin:'synthetic',send:async()=>{
  calls++;if(revoke)state={...member(),identity:{verified:false}};
  return {status:200,body_text:JSON.stringify(body)};
 }}},async s=>{
  assert.equal(outcome(await s.rpc('tools/call',{name:'get_sec_submissions',arguments:{cik:'0000320193'}})),'OK');
  revoke=true;
  const reply=await s.rpc('tools/call',{name:'get_sec_submissions',arguments:{cik:'0000320193'}});
  assert.equal(outcome(reply),'auth_required');assert.doesNotMatch(JSON.stringify(reply),/Synthetic Company/);assert.equal(calls,2);
 });
});

test('a delayed post-render check cannot evict authorization for HTML still in the renderer cache',async()=>{
 let checks=0, pause=false;
 let release!:()=>void, entered!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;});
 const waiting=new Promise<void>(resolve=>{entered=resolve;});
 await session({entitlement:policy(async()=>{
  if(pause&&++checks===2){entered();await held;}
  return member();
 })},async s=>{
  const built=await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs()});assert.equal(outcome(built),'OK');
  const render=()=>s.rpc('tools/call',{name:'render_report_html',arguments:{report_input:built.result.structuredContent}});
  pause=true;
  const delayed=render();
  try{
   await waiting;
   const retained=[];
   for(let i=0;i<3;i++){
    const reply=await render();assert.equal(outcome(reply),'OK');
    retained.push(reply.result.structuredContent.resource_uri as string);
   }
   assert.equal(outcome(await s.rpc('resources/read',{uri:retained[0]})),'OK','B is readable before A completes');
   release();
   const first=await delayed;assert.equal(outcome(first),'OK');
   for(const uri of retained)assert.equal(outcome(await s.rpc('resources/read',{uri})),'OK','B/C/D HTML remains cached after A completes');
   assert.notEqual(outcome(await s.rpc('resources/read',{uri:first.result.structuredContent.resource_uri})),'OK','A HTML was evicted by the renderer');
  }finally{release();await delayed;}
 });
});

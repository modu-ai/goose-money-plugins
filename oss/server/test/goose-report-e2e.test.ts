import test from 'node:test';import assert from 'node:assert/strict';
import {InMemoryTransport} from '@modelcontextprotocol/server';
import {createStockMcpServer} from './synthetic-member-access.js';
import {executeGoosePlan} from '../src/goose-orchestrator.js';
const cutoff='2026-10-23T03:00:00.000Z';
const held=['get_account_snapshot','place_order','transfer_funds'];
for(const scenario of [{route:'R01',enabled:true},{route:'R02',enabled:true},{route:'R01',enabled:false}])test(`Goose callback -> MCP quote -> ${scenario.route} build/render/read enabled=${scenario.enabled} (synthetic local E2E)`,async()=>{
 let providerCalls=0,active=0,maxActive=0;const order:string[]=[];
 const server=createStockMcpServer({studentReleaseScope:true,origin:'synthetic',rightsEnabled:scenario.enabled,clock:()=>cutoff,transport:{async getMarketSnapshot(){providerCalls++;return {stck_prpr:'70000',stck_oprc:'69000',stck_hgpr:'70500',stck_lwpr:'68800',prdy_vrss:'1000',prdy_vrss_sign:'1',prdy_ctrt:'1.45',acml_vol:'123456',stck_bsop_date:'20261022'};}}});
 const [client,peer]=InMemoryTransport.createLinkedPair();let id=0;const pending=new Map<number,(r:any)=>void>();
 client.onmessage=(m:any)=>{const done=pending.get(m.id);if(done){pending.delete(m.id);done(m);}};
 async function rpc(method:string,params:Record<string,unknown>){const n=++id;let timer:ReturnType<typeof setTimeout>;const answer=new Promise<any>((resolve,reject)=>{timer=setTimeout(()=>{pending.delete(n);reject(Error('mcp_timeout'));},5000);pending.set(n,resolve);});try{await client.send({jsonrpc:'2.0',id:n,method,params} as any);return await answer;}finally{clearTimeout(timer!);}}
 await client.start();await server.connect(peer);
 try{
  assert.ok((await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'synthetic-goose-callback',version:'1'}})).result.protocolVersion);await client.send({jsonrpc:'2.0',method:'notifications/initialized'} as any);
  const names=(await rpc('tools/list',{})).result.tools.map((t:any)=>t.name);assert.equal(names.length,36);assert.ok(held.every(x=>!names.includes(x)));
  let observed:any;
  const execution=await executeGoosePlan({run_id:'synthetic-e2e',requested_scope:'Synthetic callback protocol test only',roles:['market-behavior','fact-check-report-qa'],cutoff_at:cutoff,evidence:[],timeout_ms:5000},{async run(task){
   active++;maxActive=Math.max(maxActive,active);order.push(task.role_id);assert.ok(held.every(x=>!task.allowed_tool_operation_ids.includes(x)));
   if(task.role_id==='market-behavior')observed=(await rpc('tools/call',{name:'get_market_snapshot',arguments:{symbol:'005930',board:'J'}})).result;
   else assert.ok(observed,'same callback context retains the full preceding MCP result');
   active--;return {run_id:task.run_id,role_id:task.role_id,findings:[],tool_operation_ids:task.role_id==='market-behavior'?['get_market_snapshot']:[],counterevidence:[],unresolved:['Synthetic local callback; no model or host execution verified']};
  }},{studentReleaseScope:true,clock:()=>cutoff});
  assert.equal(execution.host_execution_verified,false);assert.equal(execution.report_rendered,false);assert.equal(maxActive,1);assert.deepEqual(order,['market-behavior','fact-check-report-qa']);assert.equal(providerCalls,scenario.enabled?1:0);
  if(!scenario.enabled){assert.equal(observed.isError,true);assert.match(observed.content[0].text,/rights_pending/);}
  const built=(await rpc('tools/call',{name:'build_report_input',arguments:{report_id:scenario.route,subject:{id:'KRX:005930',name:'합성 종목',venue:'KRX',currency:'KRW'},cutoff,display_timezone:'Asia/Seoul',calls:[{tool_name:'get_market_snapshot',result:observed}]}})).result;assert.ok(!built.isError,JSON.stringify(built));assert.equal(built.structuredContent.mode,scenario.enabled?'synthetic':'supplied');
  if(!scenario.enabled)assert.ok(!JSON.stringify(built.structuredContent.metrics).includes('70000'));
  const rendered=(await rpc('tools/call',{name:'render_report_html',arguments:{report_input:built.structuredContent}})).result;assert.ok(!rendered.isError,JSON.stringify(rendered));assert.equal(rendered.structuredContent.host_rendering,'not_observed');
  const link=rendered.content.find((x:any)=>x.type==='resource_link');const html=(await rpc('resources/read',{uri:link.uri})).result.contents[0].text;if(scenario.enabled)assert.match(html,/합성/);else{assert.match(html,/권리|rights_pending/);assert.ok(!html.includes('70000'));}assert.ok(html.includes(scenario.route));
 }finally{await server.close();await client.close();}
});
test('public role validation rejects held tool claims instead of trusting runner declarations (synthetic)',async()=>{
 const plan={run_id:'synthetic-held',requested_scope:'scope test',roles:['market-behavior'],cutoff_at:cutoff,evidence:[]};
 for(const tool of held){const r=await executeGoosePlan(plan,{async run(task){assert.ok(!task.allowed_tool_operation_ids.includes(tool));return {run_id:task.run_id,role_id:task.role_id,findings:[],tool_operation_ids:[tool],counterevidence:[],unresolved:[]};}},{studentReleaseScope:true,clock:()=>cutoff});assert.equal(r.records[0]?.failure,'role_result_invalid');}
});

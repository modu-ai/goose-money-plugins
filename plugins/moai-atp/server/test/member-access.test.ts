import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {InMemoryTransport,McpServer,ResourceNotFoundError,ResourceTemplate} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {installMemberAccess,type MemberAccess} from '../src/member-access.js';
import {createMemberOnboarding} from '../src/member-onboarding.js';
// SPEC-ATP-AUTH-001 M1: the member modules are preserved but the default server no longer installs them.
// The server premise is therefore a bare McpServer with installMemberAccess installed FIRST (the module's own
// contract: "apply before any registration") and synthetic tools/resources registered afterwards.
const SYNTHETIC_TOOL_COUNT=36;
function memberGuardedServer(access?:MemberAccess,onProviderCall:()=>void=()=>{}){
 const server=new McpServer({name:'synthetic-member-gate-target',version:'1'});
 if(access)installMemberAccess(server,access);else installMemberAccess(server);
 const retained=new Map<string,string>();const open=z.object({}).passthrough();
 const names=['get_market_snapshot','build_report_input','render_report_html',...Array.from({length:SYNTHETIC_TOOL_COUNT-3},(_,i)=>`synthetic_tool_${String(i+1).padStart(2,'0')}`)];
 for(const name of names)server.registerTool(name,{inputSchema:open},async(args:Record<string,unknown>)=>{
  if(name==='get_market_snapshot'){onProviderCall();throw Error('must_not_dispatch');}
  if(name==='build_report_input')return {content:[{type:'text' as const,text:'built'}],structuredContent:args};
  if(name==='render_report_html'){const id=randomUUID();retained.set(id,JSON.stringify(args.report_input));return {content:[{type:'text' as const,text:'rendered'}],structuredContent:{resource_uri:`moai-atp://reports/${id}`}};}
  return {content:[{type:'text' as const,text:name}],structuredContent:{name}};
 });
 server.registerResource('synthetic-retained-report',new ResourceTemplate('moai-atp://reports/{reportId}',{list:undefined}),{mimeType:'text/html'},async(uri,variables)=>{
  const text=retained.get(String(variables.reportId));if(text===undefined)throw new ResourceNotFoundError(uri.href);
  return {contents:[{uri:uri.href,mimeType:'text/html',text}]};
 });
 return {server};
}
async function session(server:McpServer){
 const [client,peer]=InMemoryTransport.createLinkedPair();let id=0;const pending=new Map<number,(x:any)=>void>();
 client.onmessage=(m:any)=>{pending.get(m.id)?.(m);pending.delete(m.id);};
 async function rpc(method:string,params:Record<string,unknown>){const n=++id;let timer:ReturnType<typeof setTimeout>;const promise=new Promise<any>((resolve,reject)=>{timer=setTimeout(()=>{pending.delete(n);reject(Error('timeout'));},5000);pending.set(n,resolve);});try{await client.send({jsonrpc:'2.0',id:n,method,params} as any);return await promise;}finally{clearTimeout(timer!);}}
 await client.start();await server.connect(peer);await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'synthetic-member-gate',version:'1'}});await client.send({jsonrpc:'2.0',method:'notifications/initialized'} as any);
 return {rpc,close:async()=>{await server.close();await client.close();}};
}
const report={report_id:'R01',subject:{id:'KRX:000660',name:'합성 자료',venue:'KRX',currency:'KRW'},cutoff:'2026-10-23T03:00:00.000Z',display_timezone:'Asia/Seoul',calls:[]};
test('production default all discovered tools reject direct MCP calls; valid quote never reaches provider',async()=>{
 let calls=0;const {server}=memberGuardedServer(undefined,()=>{calls++;});const s=await session(server);
 try{const tools=(await s.rpc('tools/list',{})).result.tools;assert.equal(tools.length,36);for(const t of tools){const args=t.name==='get_market_snapshot'?{symbol:'000660',board:'J'}:t.name==='build_report_input'?report:{};const reply=await s.rpc('tools/call',{name:t.name,arguments:args});assert.ok(reply.error||reply.result?.isError,t.name);if(['get_market_snapshot','build_report_input'].includes(t.name))assert.match(JSON.stringify(reply),/member_login_required/);}assert.equal(calls,0);
 const read=await s.rpc('resources/read',{uri:'moai-atp://reports/00000000-0000-4000-8000-000000000000'});assert.match(JSON.stringify(read),/member_login_required/);
 }finally{await s.close();}
});
test('login alone or a single provider cannot invoke analysis; logout blocks an existing report URI',async()=>{
 let login=true;let checks=0;const onboarding=createMemberOnboarding({verifyMembership:async()=>login?{verified:true,session_binding:"synthetic-session",expires_at:2000}:undefined,now:()=>1000,checkProvider:async()=>{checks++;return 'connected';}});
 const s=await session(memberGuardedServer(onboarding).server);
 try{let result=await s.rpc('tools/call',{name:'build_report_input',arguments:report});assert.match(JSON.stringify(result),/provider_checks_required/);assert.equal(checks,0);
 await onboarding.check('kis');result=await s.rpc('tools/call',{name:'build_report_input',arguments:report});assert.match(JSON.stringify(result),/provider_checks_required/);
 await onboarding.check('opendart');const doc=(await s.rpc('tools/call',{name:'build_report_input',arguments:report})).result.structuredContent;
 const rendered=await s.rpc('tools/call',{name:'render_report_html',arguments:{report_input:doc}});assert.ok(!rendered.result.isError);const uri=rendered.result.structuredContent.resource_uri;
 assert.ok((await s.rpc('resources/read',{uri})).result.contents[0].text.includes('R01'));
 login=false;assert.match(JSON.stringify(await s.rpc('resources/read',{uri})),/member_login_required/);assert.match(JSON.stringify(await s.rpc('tools/call',{name:'render_report_html',arguments:{report_input:doc}})),/member_login_required/);
 }finally{await s.close();}
});
test('client flags cannot grant auth; verifier failure exposes no private reason',async()=>{
 const s=await session(memberGuardedServer({status:async()=>{throw Error('synthetic-private-verifier-reason');}}).server);
 try{const r=await s.rpc('tools/call',{name:'get_market_snapshot',arguments:{symbol:'000660',board:'J',member_verified:true}});assert.ok(r.error||r.result?.isError);assert.ok(!JSON.stringify(r).includes('synthetic-private-verifier-reason'));}finally{await s.close();}
});

test('a new verified session cannot read reports retained by an earlier session after fresh provider checks',async()=>{
 let binding='synthetic-first-session';const onboarding=createMemberOnboarding({verifyMembership:async()=>({verified:true,session_binding:binding,expires_at:2000}),now:()=>1000,checkProvider:async()=> 'connected'});await onboarding.check('kis');await onboarding.check('opendart');const s=await session(memberGuardedServer(onboarding).server);try{const doc=(await s.rpc('tools/call',{name:'build_report_input',arguments:report})).result.structuredContent;const rendered=await s.rpc('tools/call',{name:'render_report_html',arguments:{report_input:doc}});const uri=rendered.result.structuredContent.resource_uri;binding='synthetic-next-session';await onboarding.check('kis');await onboarding.check('opendart');assert.match(JSON.stringify(await s.rpc('resources/read',{uri})),/member_session_changed/);assert.match(JSON.stringify(await s.rpc('tools/call',{name:'build_report_input',arguments:report})),/member_session_changed/);}finally{await s.close();}
});

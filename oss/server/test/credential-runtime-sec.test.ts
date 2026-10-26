import test from 'node:test';import assert from 'node:assert/strict';
import {InMemoryTransport} from '@modelcontextprotocol/server';
import {createCredentialBackedServer} from './synthetic-member-access.js';
import {createSecPublicHttpTransport} from '../src/sec-http.js';
import {RequestPacer} from '../src/kis-http.js';
const concept={cik:320193,entityName:'Synthetic Company',taxonomy:'us-gaap',tag:'Assets',label:'Assets',units:{USD:[{end:'2026-09-30',val:123,accn:'0000320193-26-000001',filed:'2026-10-20',fy:2026,fp:'FY',form:'10-K'}]}};
const submission={cik:'320193',name:'Synthetic Company',tickers:['SYN'],exchanges:['Nasdaq'],filings:{recent:{accessionNumber:[],filingDate:[],reportDate:[],acceptanceDateTime:[],form:[],primaryDocument:[],primaryDocDescription:[]},files:[]}};
for(const enabled of [false,true])test(`SEC runtime MCP initialize/list/call explicit enable=${enabled} (synthetic)`,async()=>{
 let fetches=0;const secTransport=createSecPublicHttpTransport({userAgent:'Synthetic ATP test test@example.invalid',origin:'synthetic',pacer:new RequestPacer(0),fetchImpl:async(url)=>{fetches++;return new Response(String(url).includes('/submissions/')?JSON.stringify(submission):JSON.stringify(concept).replace('"val":123','"val":900719925474099312345678'));}});
 const server=createCredentialBackedServer({studentReleaseScope:true,env:{},secEnabled:enabled,secTransport});
 const [client,peer]=InMemoryTransport.createLinkedPair();let id=0;const pending=new Map<number,(r:any)=>void>();
 client.onmessage=(m:any)=>{const resolve=pending.get(m.id);if(resolve){pending.delete(m.id);resolve(m);}};
 async function rpc(method:string,params:Record<string,unknown>){const requestId=++id;let timer:ReturnType<typeof setTimeout>;const result=new Promise<any>((resolve,reject)=>{timer=setTimeout(()=>{pending.delete(requestId);reject(Error('mcp_timeout'));},5000);pending.set(requestId,resolve);});try{await client.send({jsonrpc:'2.0',id:requestId,method,params} as any);return await result;}finally{clearTimeout(timer!);}}
 await client.start();await server.connect(peer);
 try{
  assert.ok((await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'synthetic-sec-test',version:'1'}})).result.protocolVersion);
  await client.send({jsonrpc:'2.0',method:'notifications/initialized'} as any);
  const tools=(await rpc('tools/list',{})).result.tools.map((t:any)=>t.name);assert.equal(tools.length,36);
  for(const name of ['get_sec_submissions','get_sec_company_concept']){
   assert.ok(tools.includes(name));const args=name==='get_sec_submissions'?{cik:'0000320193'}:{cik:'0000320193',taxonomy:'us-gaap',concept:'Assets'};
   const result=(await rpc('tools/call',{name,arguments:args})).result;
   if(!enabled){assert.equal(result.isError,true);assert.match(result.content[0].text,/source_not_enabled/);}
   else{assert.ok(!result.isError,JSON.stringify(result));assert.equal(result.structuredContent.origin,'synthetic');assert.equal(result.structuredContent.rights,'pending');if(name==='get_sec_company_concept')assert.equal(result.structuredContent.facts[0].numeric_lexeme,'900719925474099312345678');}
  }
  assert.equal(fetches,enabled?2:0);
 }finally{await server.close();await client.close();}
});

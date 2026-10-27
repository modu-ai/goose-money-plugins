import test from 'node:test';
import assert from 'node:assert/strict';
import {ReportEvidenceStore} from '../src/report-evidence-store.js';
import {safeResult} from '../src/mcp-result.js';
import {createStockMcpServer} from './synthetic-member-access.js';
import {InMemoryTransport} from '@modelcontextprotocol/server';

test('local evidence receipts reject forgery/duplicate/expired and keep immutable scoped payloads',()=>{
 let now=0;const s=new ReportEvidenceStore(()=>now),value={origin:'actual',data:{x:'10'}};const id=s.issue('get_market_snapshot',value,'2026-10-24T00:00:00Z');value.data.x='20';assert.equal((s.resolve([id])[0]!.result.structuredContent.data as any).x,'10');assert.throws(()=>s.resolve([id,id]),/invalid_provenance/);assert.throws(()=>s.resolve(['forged']),/invalid_provenance/);now=300000;assert.throws(()=>s.resolve([id]),/invalid_provenance/);
});
test('large financial result preserves every structured row while removing duplicate text JSON only when opted in',async()=>{
 const value={rows:Array.from({length:229},(_,i)=>({id:i,raw:'x'.repeat(850)}))};const result=await safeResult(async()=>value,{compactStructuredText:true});assert.deepEqual(result.structuredContent,value);assert.ok(Buffer.byteLength(JSON.stringify(result))<300000);assert.match(result.content[0]!.text,/structuredContent/);await assert.rejects(safeResult(async()=>value),/response_too_large/);
});
test('MCP provider receipt to actual local report and HTML is scoped; caller forgery and R04 are blocked',async()=>{
 const server=createStockMcpServer({rightsEnabled:true,localReportViewEnabled:true,origin:'actual',clock:()=> '2026-10-24T00:00:00Z',transport:{getMarketSnapshot:async()=>({stck_prpr:'120',stck_oprc:'110',stck_hgpr:'130',stck_lwpr:'100',prdy_vrss:'10',prdy_vrss_sign:'2',prdy_ctrt:'9.09',acml_vol:'1000'})}});
 const [client,peer]=InMemoryTransport.createLinkedPair();let id=0;const pending=new Map<number,(v:any)=>void>();client.onmessage=(m:any)=>{const resolve=pending.get(m.id);if(resolve){pending.delete(m.id);resolve(m);}};await client.start();await server.connect(peer);
 const rpc=async(method:string,params:Record<string,unknown>)=>{const n=++id;const p=new Promise<any>(resolve=>pending.set(n,resolve));await client.send({jsonrpc:'2.0',id:n,method,params} as any);return p;};
 try{
  await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'synthetic-host-attestation-fixture',version:'1'}});await client.send({jsonrpc:'2.0',method:'notifications/initialized'} as any);
  const quote=await rpc('tools/call',{name:'get_market_snapshot',arguments:{symbol:'005930',board:'J'}});assert.equal(quote.result.isError,undefined);const receipt=quote.result._meta['moai-atp.local-evidence'];assert.ok(receipt);
  const args={report_id:'R01',subject:{id:'KRX:005930',name:'합성 계약 시험',venue:'KRX',currency:'KRW'},cutoff:'2026-10-24T00:00:00Z',display_timezone:'Asia/Seoul'};
  const forged=await rpc('tools/call',{name:'build_report_input',arguments:{...args,calls:[{tool_name:'get_market_snapshot',result:quote.result}]}});assert.equal(forged.result.structuredContent.sources[0].rights,'pending');
  const built=await rpc('tools/call',{name:'build_report_input',arguments:{...args,source_receipts:[receipt]}});assert.equal(built.result.isError,undefined);const doc=built.result.structuredContent;assert.equal(doc.mode,'actual');assert.equal(doc.sources[0].rights,'local_view');assert.equal(doc.sources[0].validation_status,'provider_shape_checked');assert.ok(doc.metrics.some((m:any)=>m.value==='120'&&m.status==='provided_unverified'));assert.ok(doc.chart);
  const rendered=await rpc('tools/call',{name:'render_report_html',arguments:{report_input:doc}});assert.equal(rendered.result.isError,undefined);
  const link=rendered.result.content.find((c:any)=>c.type==='resource_link');const html=await rpc('resources/read',{uri:link.uri});assert.match(html.result.contents[0].text,/120/);
  const tampered=structuredClone(doc);tampered.subject.name='forged';const denied=await rpc('tools/call',{name:'render_report_html',arguments:{report_input:tampered}});assert.equal(denied.result.isError,true);assert.match(denied.result.content[0].text,/invalid_provenance/);
  const reused=await rpc('tools/call',{name:'build_report_input',arguments:{...args,source_receipts:[receipt]}});assert.equal(reused.result.isError,true);
  const held=await rpc('tools/call',{name:'build_report_input',arguments:{...args,report_id:'R04'}});assert.equal(held.result.isError,true);
 }finally{await server.close();await client.close();}
});

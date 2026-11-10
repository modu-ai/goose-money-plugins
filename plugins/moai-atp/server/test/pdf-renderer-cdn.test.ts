import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Writable,PassThrough} from 'node:stream';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const css=readFileSync(new URL('../../assets/report-runtime/report-fonts-cdn.css',import.meta.url),'utf8');
const pinned=[...css.matchAll(/url\((https:[^)]+)\)/g)][0]![1]!;
type Command={id:number;method:string;params:Record<string,any>;sessionId?:string};
function transport(requests:Record<string,any>[],wireHeaders:Record<string,string>={Origin:'null'},lateWireHeaders?:Record<string,string>){
 const commands:Command[]=[],out=new PassThrough();let killed=false;
 const send=(reply:unknown)=>queueMicrotask(()=>out.emit('data',Buffer.from(JSON.stringify(reply)+'\0')));
 const child=Object.assign(new EventEmitter(),{stdio:[null,null,null,new Writable({write(chunk,_encoding,done){
  for(const raw of chunk.toString().split('\0').filter(Boolean)){
   const command=JSON.parse(raw) as Command;commands.push(command);let result:unknown={};
   if(command.method==='Target.createTarget')result={targetId:'target'};
   if(command.method==='Target.attachToTarget')result={sessionId:'session'};
   if(command.method==='Page.getFrameTree')result={frameTree:{frame:{id:'frame'}}};
   if(command.method==='Page.setDocumentContent')for(const request of requests)send({method:'Fetch.requestPaused',sessionId:'session',params:request});
   if(command.method==='Fetch.continueRequest'){
    send({method:'Network.requestWillBeSentExtraInfo',params:{requestId:'font-network',headers:wireHeaders}});
    send({method:'Network.requestWillBeSent',params:{requestId:'font-network',type:'Font',request:{url:pinned,method:'GET',headers:{Origin:'null'}}}});
   }
   if(command.method==='Runtime.evaluate')result={result:{value:command.params.awaitPromise?true:{images:1,decoded_images:1,fonts_loaded:1,fonts_failed:0}}};
   if(command.method==='Page.printToPDF'){
    if(lateWireHeaders)send({method:'Network.requestWillBeSentExtraInfo',params:{requestId:'font-network',headers:lateWireHeaders}});
    result={data:Buffer.from('%PDF-1.7\nsynthetic\n%%EOF').toString('base64')};
   }
   send({id:command.id,result});
  }
  done();
 }}),out],kill(){if(!killed){killed=true;queueMicrotask(()=>child.emit('close',0));}return true;}});
 return {commands,spawn:()=>child};
}
const request=(id:string,url=pinned,extra:Record<string,unknown>={})=>({requestId:id,resourceType:'Font',request:{url,method:'GET',headers:{Referer:'https://private.invalid/report-marker',Cookie:'private-marker',Authorization:'synthetic-header-marker','X-Report-ID':'private-marker'}},...extra});
const renderRequest=()=>({html:'<meta name="referrer" content="no-referrer"><p>synthetic-marker</p>',network:'fonts_cdn_only',page:'A4',font_policy:'cdn_load_then_pdf',signal:new AbortController().signal});

test('CDN renderer continues only exact trusted font GETs and removes report-bearing headers',async()=>{
 const fake=transport([request('font'),request('query',pinned+'?report=private-marker'),request('external','https://outside.invalid/private-marker'),request('image',pinned,{resourceType:'Image'}),request('redirect',pinned,{redirectedRequestId:'previous'}),{...request('post'),request:{url:pinned,method:'POST',headers:{}}}]);
 const {chromeRenderer}=await import(new URL('../../scripts/export-synthetic-pdf.mjs',import.meta.url).href);
 let inspection:Record<string,any>|undefined;
 const bytes=await chromeRenderer('synthetic-browser',renderRequest(),fake.spawn,{onInspection:(value:Record<string,any>)=>{inspection=value;}});
 assert.match(Buffer.from(bytes).toString(),/^%PDF-/);
 const allowed=fake.commands.filter(c=>c.method==='Fetch.continueRequest');assert.equal(allowed.length,1);assert.equal(allowed[0]!.params.requestId,'font');
 assert.deepEqual(allowed[0]!.params.headers,[{name:'Origin',value:'null'}]);
 assert.deepEqual(fake.commands.filter(c=>c.method==='Fetch.failRequest').map(c=>c.params.requestId).sort(),['external','image','post','query','redirect']);
 assert.ok(fake.commands.findIndex(c=>c.method==='Fetch.enable')<fake.commands.findIndex(c=>c.method==='Page.setDocumentContent'));
 assert.ok(fake.commands.findIndex(c=>c.method==='Runtime.evaluate'&&c.params.awaitPromise)<fake.commands.findIndex(c=>c.method==='Page.printToPDF'));
 assert.equal(inspection?.network.wire_requests_observed,1);assert.equal(inspection?.network.sensitive_header_count,0);assert.equal(inspection?.network.unpinned_url_count,0);
});

test('blocked font network still waits for fallback layout and prints without permitting a font request',async()=>{
 const fake=transport([request('font')]);
 const {chromeRenderer}=await import(new URL('../../scripts/export-synthetic-pdf.mjs',import.meta.url).href);
 const bytes=await chromeRenderer('synthetic-browser',renderRequest(),fake.spawn,{blockFontNetwork:true});
 assert.ok(bytes.length>0);assert.equal(fake.commands.filter(c=>c.method==='Fetch.continueRequest').length,0);
 assert.equal(fake.commands.filter(c=>c.method==='Fetch.failRequest').length,1);
 assert.ok(fake.commands.some(c=>c.method==='Runtime.evaluate'&&c.params.awaitPromise));
});

test('wire-header diagnostics reject a privacy breach even if the request interceptor removed sensitive headers',async()=>{
 const fake=transport([request('font')],{Referer:'https://private.invalid/private-marker'});
 const {chromeRenderer}=await import(new URL('../../scripts/export-synthetic-pdf.mjs',import.meta.url).href);
 await assert.rejects(chromeRenderer('synthetic-browser',renderRequest(),fake.spawn),/renderer_network_policy/);
 assert.equal(fake.commands.filter(c=>c.method==='Page.printToPDF').length,0);
});

test('a late wire-header breach during print is rejected before PDF bytes leave the renderer',async()=>{
 const fake=transport([request('font')],{Origin:'null'},{Cookie:'private-marker'});
 const {chromeRenderer}=await import(new URL('../../scripts/export-synthetic-pdf.mjs',import.meta.url).href);
 await assert.rejects(chromeRenderer('synthetic-browser',renderRequest(),fake.spawn),/renderer_network_policy/);
 assert.equal(fake.commands.filter(c=>c.method==='Page.printToPDF').length,1);
});

for(const blockFontNetwork of [false,true])test(`PDF font faces use CDN sources instead of installed local() fonts (blocked=${blockFontNetwork})`,async()=>{
 const fake=transport([]),fallback='.paragraph{font-family:MaruBuri,Georgia,serif}';
 const html=`<style>${css}</style><style>${fallback}</style><p>local('report-text-marker')</p>`;
 const {chromeRenderer}=await import(new URL('../../scripts/export-synthetic-pdf.mjs',import.meta.url).href);
 await chromeRenderer('synthetic-browser',{...renderRequest(),html},fake.spawn,{blockFontNetwork});
 const injected=fake.commands.find(c=>c.method==='Page.setDocumentContent')!.params.html as string;
 const fontStyle=/<style>([\s\S]*?)<\/style>/.exec(injected)![1]!;
 assert.equal(/local\(/.test(fontStyle),false,'PDF must fetch the chosen web font instead of silently selecting an installed face');
 assert.deepEqual([...fontStyle.matchAll(/url\(([^)]+)\)/g)].map(match=>match[1]),[...css.matchAll(/url\(([^)]+)\)/g)].map(match=>match[1]));
 assert.ok(injected.includes(`<style>${fallback}</style>`),'generic fallback stacks must survive a blocked CDN');
 assert.ok(injected.includes("<p>local('report-text-marker')</p>"),'only the exact trusted font CSS is changed');
 assert.equal(readFileSync(new URL('../../assets/report-runtime/report-fonts-cdn.css',import.meta.url),'utf8'),css,'shared HTML font asset stays unchanged');
});

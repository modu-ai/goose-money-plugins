// #24: 합성 원형의 수동 검증 도구. 사용자 프로필·로컬 보고서 입력·공급자 키를 읽지 않는다.
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {exportSyntheticReportPdf} from '../dist/src/report-pdf-export.js';
import {buildReportInput} from '../dist/src/report-pipeline.js';

const fontPaths=['https://cdn.jsdelivr.net/npm/pretendard@1.3.9/','https://cdn.jsdelivr.net/npm/@kfonts/maruburi@0.1.0/','https://cdn.jsdelivr.net/npm/@fontsource/gowun-batang@5.3.0/'];
const fontCss=readFileSync(new URL('../assets/report-runtime/report-fonts-cdn.css',import.meta.url),'utf8');
// PDF's chosen CDN policy must not silently resolve a local face; HTML and generic fallback stacks stay unchanged.
const pdfFontCss=fontCss.replace(/local\([^)]*\)\s*,\s*/g,'');
const fontUrls=new Set([...fontCss.matchAll(/url\(([^)]+)\)/g)].map(match=>match[1]));
if(!fontUrls.size||[...fontUrls].some(url=>!fontPaths.some(path=>url.startsWith(path))||!url.endsWith('.woff2')||/[?#]/.test(url)))throw Error('renderer_font_asset');
const sensitiveHeaders=headers=>Object.keys(headers??{}).filter(name=>/^(referer|cookie|authorization|proxy-authorization)$/i.test(name)).length;
let inspection=null;
export async function chromeRenderer(executable,request,spawnProcess=spawn,settings={}){
 if(request.network!=='fonts_cdn_only'||request.font_policy!=='cdn_load_then_pdf'||request.signal.aborted)throw Error('renderer_policy');
 const profile=await mkdtemp(join(tmpdir(),'atp-pdf-chrome-'));
 const child=spawnProcess(executable,['--headless','--remote-debugging-pipe',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--disable-crash-reporter','--metrics-recording-only','--no-proxy-server',`--host-resolver-rules=${settings.blockFontNetwork?'':'EXCLUDE cdn.jsdelivr.net, '}MAP * ~NOTFOUND`],{stdio:['ignore','ignore','ignore','pipe','pipe']});
 const closed=new Promise(resolve=>child.once('close',resolve));
 let sequence=0,buffer=Buffer.alloc(0),dead=false,remoteResponses=0,allowedRequests=0,blockedRequests=0;
 const networkRequests=new Map();
 const pending=new Map();
 function fail(){dead=true;for(const entry of pending.values())entry.reject(Error('renderer_transport'));pending.clear();}
 child.once('error',fail);child.once('close',fail);
 let hardStop;
 const stop=()=>{
  fail();child.kill('SIGTERM');
  hardStop??=setTimeout(()=>child.kill('SIGKILL'),1000);
 };
 request.signal.addEventListener('abort',stop,{once:true});
 if(request.signal.aborted)stop();
 child.stdio[4].on('error',fail);child.stdio[3].on('error',fail);
 child.stdio[4].on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);if(buffer.length>48*1024*1024){fail();stop();return;}
  let end;
  while((end=buffer.indexOf(0))>=0){
   const item=buffer.subarray(0,end);buffer=buffer.subarray(end+1);
   let reply;try{reply=JSON.parse(item.toString('utf8'));}catch{fail();stop();return;}
   if(reply.method==='Network.responseReceived'&&/^https?:/.test(reply.params?.response?.url??''))remoteResponses++;
   if(reply.method==='Network.requestWillBeSent'||reply.method==='Network.requestWillBeSentExtraInfo'){
    const params=reply.params,entry=networkRequests.get(params.requestId)??{};
    if(reply.method==='Network.requestWillBeSent')Object.assign(entry,{request:params.request,type:params.type});else entry.wireHeaders=params.headers;
    networkRequests.set(params.requestId,entry);if(networkRequests.size>1024){stop();return;}
   }
   if(reply.method==='Fetch.requestPaused'){
    const params=reply.params,resource=params.request;
    const allowed=!settings.blockFontNetwork&&params.resourceType==='Font'&&resource?.method==='GET'&&fontUrls.has(resource.url)&&!params.redirectedRequestId;
    if(allowed)allowedRequests++;else blockedRequests++;
    // Override the complete header list on every permitted request: no document URL, credentials or report-selected headers.
    command(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:params.requestId,headers:[{name:'Origin',value:'null'}]}:{requestId:params.requestId,errorReason:'BlockedByClient'},reply.sessionId).catch(stop);
   }
   if(!pending.has(reply.id))continue;
   const entry=pending.get(reply.id);pending.delete(reply.id);
   if(reply.error)entry.reject(Error('renderer_protocol'));else entry.resolve(reply.result);
  }
 });
 const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  if(dead||request.signal.aborted){reject(Error('renderer_closed'));return;}
  const id=++sequence;pending.set(id,{resolve,reject});
  child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0',error=>{if(error)fail();});
 });
 let output,inspect;
 try{
  const target=await command('Target.createTarget',{url:'about:blank'});
  const attached=await command('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const session=attached.sessionId;
  await command('Page.enable',{},session);await command('Network.enable',{},session);
  await command('Network.setCacheDisabled',{cacheDisabled:true},session);
  await command('Network.setBypassServiceWorker',{bypass:true},session);
  await command('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},session);
  await command('Network.setBlockedURLs',{urls:['file://*','ftp://*','ws://*','wss://*']},session);
  await command('Network.emulateNetworkConditions',{offline:settings.blockFontNetwork===true,latency:0,downloadThroughput:-1,uploadThroughput:-1},session);
  await command('Emulation.setEmulatedMedia',{media:'print'},session);
  const frame=await command('Page.getFrameTree',{},session);
  await command('Page.setDocumentContent',{frameId:frame.frameTree.frame.id,html:request.html.replaceAll(fontCss,pdfFontCss)},session);
  const ready=await command('Runtime.evaluate',{expression:'document.fonts.ready.then(()=>Promise.all(Array.from(document.images,image=>image.decode()))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))))',awaitPromise:true,returnByValue:true},session);
  if(ready.exceptionDetails||ready.result?.value!==true)throw Error('renderer_not_ready');
  const measured=await command('Runtime.evaluate',{expression:'({images:Array.from(document.images).length,decoded_images:Array.from(document.images).filter(image=>image.complete&&image.naturalWidth>0).length,chart_count:document.querySelectorAll(".echart").length,hidden_chart_count:Array.from(document.querySelectorAll(".chart-scroll")).filter(el=>getComputedStyle(el).display==="none").length,fonts_loaded:Array.from(document.fonts).filter(font=>font.status==="loaded").length,fonts_failed:Array.from(document.fonts).filter(font=>font.status==="error").length,font_families_loaded:Array.from(new Set(Array.from(document.fonts).filter(font=>font.status==="loaded").map(font=>font.family)))})',returnByValue:true},session);
  if(measured.exceptionDetails)throw Error('renderer_inspection');
  inspect=()=>{
   const http=[...networkRequests.values()].filter(entry=>/^https?:/.test(entry.request?.url??''));
   const wire=[...networkRequests.values()].filter(entry=>entry.wireHeaders);
   const network={allowed_font_requests:allowedRequests,blocked_requests:blockedRequests,http_request_events:http.length,wire_requests_observed:wire.length,requests_without_extra_info:http.filter(entry=>!entry.wireHeaders).length,unpaired_extra_info:wire.filter(entry=>!entry.request).length,sensitive_header_count:wire.reduce((sum,entry)=>sum+sensitiveHeaders(entry.wireHeaders),0),request_event_sensitive_header_count:http.reduce((sum,entry)=>sum+sensitiveHeaders(entry.request.headers),0),unpinned_url_count:wire.filter(entry=>entry.request&&(!fontUrls.has(entry.request.url)||entry.type!=='Font'||entry.request.method!=='GET')).length,font_urls:[...new Set(http.filter(entry=>fontUrls.has(entry.request.url)).map(entry=>entry.request.url))].sort()};
   inspection={...measured.result.value,http_responses:remoteResponses,network};settings.onInspection?.(inspection);
   if(network.sensitive_header_count||network.unpinned_url_count)throw Error('renderer_network_policy');
  };
  inspect();
  const pdf=await command('Page.printToPDF',{printBackground:true,displayHeaderFooter:false,paperWidth:8.2677,paperHeight:11.6929,preferCSSPageSize:true,transferMode:'ReturnAsBase64'},session);
  if(typeof pdf.data!=='string'||pdf.data.length>44*1024*1024)throw Error('renderer_output');
  output=Buffer.from(pdf.data,'base64');
 }finally{
  request.signal.removeEventListener('abort',stop);stop();
  try{await closed;}finally{clearTimeout(hardStop);await rm(profile,{recursive:true,force:true});}
 }
 // Print/layout can emit more request events. Audit once more after transport closure, before returning any bytes.
 inspect();return output;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)try{
 const args=process.argv.slice(2);
 if(![4,5].includes(args.length)||(args.length===5&&args[4]!=='--block-font-network')||args[0]!=='--chrome'||args[2]!=='--output-dir'||!isAbsolute(args[1])||!isAbsolute(args[3])||!(await stat(args[1])).isFile())throw Error('arguments');
 const at='2026-11-10T03:00:00Z';
 const quote={contract:'moai.stock.quote-snapshot.v1',provider:'kis',operation_id:'kis.kr.quote.snapshot.v1',origin:'synthetic',provenance:{origin:'synthetic',source_as_of:'2026-11-10',received_at:at,validation_status:'synthetic_fixture'},data:{last:'12345',open:'12000',high:'12500',low:'11900',previous_close:'12000',change:'345',change_percent:'2.875',volume:'1000'}};
 const report=buildReportInput({report_id:'R01',subject:{id:'SYNTHETIC',name:'합성 PDF 검증',venue:'KRX',currency:'KRW'},cutoff:at,received_at:at,display_timezone:'Asia/Seoul',calls:[{tool_name:'get_market_snapshot',result:{structuredContent:quote}}]});
 const result=await exportSyntheticReportPdf(report,{confirmed:true,directory:args[3],renderer:request=>chromeRenderer(args[1],request,spawn,{blockFontNetwork:args[4]==='--block-font-network'}),timeoutMs:60000});
 console.log(JSON.stringify({...result,inspection}));
}catch{console.error('합성 PDF 변환 실패: 입력·권한·브라우저·출력 경로를 확인하세요. 원문 오류는 출력하지 않습니다.');process.exitCode=1;}

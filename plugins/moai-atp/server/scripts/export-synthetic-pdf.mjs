// #24: 합성 원형의 수동 검증 도구. 사용자 프로필·로컬 보고서 입력·공급자 키를 읽지 않는다.
import {spawn} from 'node:child_process';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {exportSyntheticReportPdf} from '../dist/src/report-pdf-export.js';
import {buildReportInput} from '../dist/src/report-pipeline.js';

let inspection=null;
async function chromeRenderer(executable,request){
 if(request.network!=='deny_all'||request.signal.aborted)throw Error('renderer_policy');
 const profile=await mkdtemp(join(tmpdir(),'atp-pdf-chrome-'));
 const child=spawn(executable,['--headless','--remote-debugging-pipe',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--disable-crash-reporter','--metrics-recording-only','--no-proxy-server','--host-resolver-rules=MAP * ~NOTFOUND'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
 const closed=new Promise(resolve=>child.once('close',resolve));
 let sequence=0,buffer=Buffer.alloc(0),dead=false,remoteResponses=0;
 const pending=new Map();
 function fail(){dead=true;for(const entry of pending.values())entry.reject(Error('renderer_transport'));pending.clear();}
 child.once('error',fail);child.once('close',fail);
 const stop=()=>child.kill('SIGTERM');request.signal.addEventListener('abort',stop,{once:true});
 child.stdio[4].on('error',fail);child.stdio[3].on('error',fail);
 child.stdio[4].on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);if(buffer.length>48*1024*1024){fail();stop();return;}
  let end;
  while((end=buffer.indexOf(0))>=0){
   const item=buffer.subarray(0,end);buffer=buffer.subarray(end+1);
   let reply;try{reply=JSON.parse(item.toString('utf8'));}catch{fail();stop();return;}
   if(reply.method==='Network.responseReceived'&&/^https?:/.test(reply.params?.response?.url??''))remoteResponses++;
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
 try{
  const target=await command('Target.createTarget',{url:'about:blank'});
  const attached=await command('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const session=attached.sessionId;
  await command('Page.enable',{},session);await command('Network.enable',{},session);
  await command('Network.setBlockedURLs',{urls:['http://*','https://*','file://*','ftp://*','ws://*','wss://*']},session);
  await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},session);
  await command('Emulation.setEmulatedMedia',{media:'print'},session);
  const frame=await command('Page.getFrameTree',{},session);
  await command('Page.setDocumentContent',{frameId:frame.frameTree.frame.id,html:request.html},session);
  const ready=await command('Runtime.evaluate',{expression:'document.fonts.ready.then(()=>Promise.all(Array.from(document.images,image=>image.decode()))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))))',awaitPromise:true,returnByValue:true},session);
  if(ready.exceptionDetails||ready.result?.value!==true)throw Error('renderer_not_ready');
  const measured=await command('Runtime.evaluate',{expression:'({images:Array.from(document.images).length,decoded_images:Array.from(document.images).filter(image=>image.complete&&image.naturalWidth>0).length,chart_count:document.querySelectorAll(".echart").length,hidden_chart_count:Array.from(document.querySelectorAll(".chart-scroll")).filter(el=>getComputedStyle(el).display==="none").length})',returnByValue:true},session);
  if(measured.exceptionDetails)throw Error('renderer_inspection');
  inspection={...measured.result.value,http_responses:remoteResponses};
  const pdf=await command('Page.printToPDF',{printBackground:true,displayHeaderFooter:false,paperWidth:8.2677,paperHeight:11.6929,preferCSSPageSize:true,transferMode:'ReturnAsBase64'},session);
  if(typeof pdf.data!=='string'||pdf.data.length>44*1024*1024)throw Error('renderer_output');
  return Buffer.from(pdf.data,'base64');
 }finally{
  request.signal.removeEventListener('abort',stop);stop();
  const hardStop=setTimeout(()=>child.kill('SIGKILL'),1000);
  try{await closed;}finally{clearTimeout(hardStop);await rm(profile,{recursive:true,force:true});}
 }
}

try{
 const args=process.argv.slice(2);
 if(args.length!==4||args[0]!=='--chrome'||args[2]!=='--output-dir'||!isAbsolute(args[1])||!isAbsolute(args[3])||!(await stat(args[1])).isFile())throw Error('arguments');
 const at='2026-11-10T03:00:00Z';
 const quote={contract:'moai.stock.quote-snapshot.v1',provider:'kis',operation_id:'kis.kr.quote.snapshot.v1',origin:'synthetic',provenance:{origin:'synthetic',source_as_of:'2026-11-10',received_at:at,validation_status:'synthetic_fixture'},data:{last:'12345',open:'12000',high:'12500',low:'11900',previous_close:'12000',change:'345',change_percent:'2.875',volume:'1000'}};
 const report=buildReportInput({report_id:'R01',subject:{id:'SYNTHETIC',name:'합성 PDF 검증',venue:'KRX',currency:'KRW'},cutoff:at,received_at:at,display_timezone:'Asia/Seoul',calls:[{tool_name:'get_market_snapshot',result:{structuredContent:quote}}]});
 const result=await exportSyntheticReportPdf(report,{confirmed:true,directory:args[3],renderer:request=>chromeRenderer(args[1],request),timeoutMs:30000});
 console.log(JSON.stringify({...result,inspection}));
}catch{console.error('합성 PDF 변환 실패: 입력·권한·브라우저·출력 경로를 확인하세요. 원문 오류는 출력하지 않습니다.');process.exitCode=1;}

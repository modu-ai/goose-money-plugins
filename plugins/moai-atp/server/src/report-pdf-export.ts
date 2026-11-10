import {randomUUID} from 'node:crypto';
import {lstat,open,link,unlink} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {ActiveReportInputSchema,renderReportInputHtml} from './report-pipeline.js';

export type PdfRenderer=(request:{html:string;network:'deny_all';page:'A4';font_policy:'decision_required';signal:AbortSignal})=>Promise<Uint8Array>;
type Options={confirmed:boolean;directory:string;renderer:PdfRenderer;timeoutMs?:number};
const MAX_HTML=6*1024*1024,MAX_PDF=32*1024*1024;
const fail=(code:string):never=>{throw new Error(code);};

/** #24 독립 단계의 합성 전용 원형. 실제·사용자 보유·혼합 입력과 MCP 등록은 범위 밖이다.
 * renderer는 신뢰한 호스트 어댑터이며 네트워크 차단과 abort 시 프로세스 종료를 직접 보장해야 한다.
 * 출력 성공은 PDF 구조·페이지 검수·글꼴 포함·원본 HTML QA 통과를 뜻하지 않는다.
 */
export async function exportSyntheticReportPdf(value:unknown,options:Options){
 if(options.confirmed!==true)fail('pdf_confirmation_required');
 if(value!==null&&typeof value==='object'&&'mode' in value&&value.mode!=='synthetic')fail('pdf_synthetic_only');
 const parsed=ActiveReportInputSchema.safeParse(value);
 const doc=parsed.success?parsed.data:fail('pdf_invalid_report');
 if(doc.mode!=='synthetic'||doc.sources.some(s=>s.kind!=='synthetic'||s.rights!=='synthetic_only'))fail('pdf_synthetic_only');
 // POSIX mode bits alone cannot attest Windows ACL privacy; no persistence claim there yet.
 if(process.platform==='win32')fail('pdf_private_storage_unverified');
 if(!isAbsolute(options.directory))fail('pdf_unsafe_directory');
 let info;
 try{info=await lstat(options.directory);}catch{fail('pdf_unsafe_directory');}
 if(!info!.isDirectory()||info!.isSymbolicLink()||(info!.mode&0o077)!==0||info!.uid!==process.getuid?.())fail('pdf_unsafe_directory');
 const timeout=options.timeoutMs??15000;
 if(!Number.isInteger(timeout)||timeout<1||timeout>60000)fail('pdf_invalid_timeout');
 const html=renderReportInputHtml(doc);
 if(Buffer.byteLength(html)>MAX_HTML)fail('pdf_input_too_large');
 const controller=new AbortController();
 const expired=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('pdf_timeout')),{once:true}));
 const timer=setTimeout(()=>controller.abort(),timeout);
 let output:Uint8Array;
 try{
  output=await Promise.race([expired,Promise.resolve().then(()=>options.renderer({html,network:'deny_all',page:'A4',font_policy:'decision_required',signal:controller.signal}))]);
  if(controller.signal.aborted)fail('pdf_timeout');
 }catch{fail(controller.signal.aborted?'pdf_timeout':'pdf_renderer_failed');}
 finally{clearTimeout(timer);}
 if(!(output! instanceof Uint8Array)||output!.byteLength<16||output!.byteLength>MAX_PDF)fail('pdf_invalid_output');
 const bytes=Buffer.from(output!);
 if(!bytes.subarray(0,8).toString('ascii').startsWith('%PDF-')||!bytes.subarray(-1024).toString('ascii').trimEnd().endsWith('%%EOF'))fail('pdf_invalid_output');
 const filename=`${doc.report_id}-synthetic.pdf`,destination=join(options.directory,filename),temp=join(options.directory,`.pdf-${randomUUID()}.tmp`);
 let handle;
 try{handle=await open(temp,'wx',0o600);}catch{fail('pdf_write_failed');}
 try{
  await handle!.writeFile(bytes);await handle!.sync();await handle!.close();
  // Hard-link commit is atomic and exclusive: never replace an existing report or symlink.
  try{await link(temp,destination);}catch(error){
   if(error!==null&&typeof error==='object'&&'code' in error&&error.code==='EEXIST')fail('pdf_output_exists');
   fail('pdf_write_failed');
  }
 }catch(error){
  if(error instanceof Error&&['pdf_output_exists','pdf_write_failed'].includes(error.message))throw error;
  fail('pdf_write_failed');
 }finally{await handle!.close().catch(()=>{});await unlink(temp).catch(()=>{});}
 return {contract:'moai.stock.synthetic-pdf-export.v1' as const,report_id:doc.report_id,filename,size_bytes:bytes.length,font_policy:'decision_required' as const,page_review:'not_verified' as const,font_embedding:'not_verified' as const};
}

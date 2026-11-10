import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,chmod,symlink,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {buildReportInput} from '../src/report-pipeline.js';
import {exportSyntheticReportPdf,type PdfRenderer} from '../src/report-pdf-export.js';

const at='2026-11-10T03:00:00Z';
const doc=()=>buildReportInput({report_id:'R01',subject:{id:'SYNTHETIC',name:'합성 PDF 시험',venue:'KRX',currency:'KRW'},cutoff:at,received_at:at,display_timezone:'Asia/Seoul',calls:[]});
// Minimal bytes exercise the adapter boundary only. A real PDF is separately rendered/inspected.
const pdf=Buffer.from('%PDF-1.7\nsynthetic-boundary-fixture\n%%EOF\n');
async function directory(t:import('node:test').TestContext){const dir=await mkdtemp(join(tmpdir(),'atp-pdf-'));await chmod(dir,0o700);t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
const code=(value:string)=>(e:unknown)=>e instanceof Error&&e.message===value;

test('explicit synthetic export passes offline print contract and saves privately without HTML files',async t=>{
 const dir=await directory(t);let calls=0;
 const renderer:PdfRenderer=async request=>{calls++;assert.match(request.html,/합성 PDF 시험/);assert.equal(request.network,'deny_all');assert.equal(request.page,'A4');assert.equal(request.font_policy,'decision_required');assert.equal(request.signal.aborted,false);return pdf;};
 if(process.platform==='win32'){
  await assert.rejects(exportSyntheticReportPdf(doc(),{confirmed:true,directory:dir,renderer}),code('pdf_private_storage_unverified'));assert.equal(calls,0);return;
 }
 const result=await exportSyntheticReportPdf(doc(),{confirmed:true,directory:dir,renderer});
 assert.equal(calls,1);assert.equal(result.filename,'R01-synthetic.pdf');assert.equal(result.page_review,'not_verified');assert.equal(result.font_embedding,'not_verified');
 assert.deepEqual(await readdir(dir),['R01-synthetic.pdf']);assert.deepEqual(await readFile(join(dir,result.filename)),pdf);assert.equal((await stat(join(dir,result.filename))).mode&0o777,0o600);
});

test('confirmation, malformed input and non-synthetic modes are rejected before rendering',async t=>{
 const dir=await directory(t);let calls=0;const renderer:PdfRenderer=async()=>{calls++;return pdf;};
 await assert.rejects(exportSyntheticReportPdf(doc(),{confirmed:false,directory:dir,renderer}),code('pdf_confirmation_required'));
 await assert.rejects(exportSyntheticReportPdf({html:'<script>bad()</script>'},{confirmed:true,directory:dir,renderer}),code('pdf_invalid_report'));
 for(const mode of ['actual','mixed','supplied'])await assert.rejects(exportSyntheticReportPdf({...doc(),mode},{confirmed:true,directory:dir,renderer}),code('pdf_synthetic_only'));
 assert.equal(calls,0);assert.deepEqual(await readdir(dir),[]);
});

test('existing output cannot be replaced and a symlink directory is rejected',async t=>{
 const dir=await directory(t),other=await directory(t);let calls=0;const renderer:PdfRenderer=async()=>{calls++;return pdf;};
 if(process.platform==='win32'){await assert.rejects(exportSyntheticReportPdf(doc(),{confirmed:true,directory:dir,renderer}),code('pdf_private_storage_unverified'));return;}
 await writeFile(join(dir,'R01-synthetic.pdf'),'preserve',{mode:0o600});
 await assert.rejects(exportSyntheticReportPdf(doc(),{confirmed:true,directory:dir,renderer}),code('pdf_output_exists'));
 assert.equal(await readFile(join(dir,'R01-synthetic.pdf'),'utf8'),'preserve');assert.deepEqual(await readdir(dir),['R01-synthetic.pdf']);
 const alias=join(other,'alias');await symlink(dir,alias);
 await assert.rejects(exportSyntheticReportPdf(doc(),{confirmed:true,directory:alias,renderer}),code('pdf_unsafe_directory'));
 assert.equal(calls,1);
});

test('renderer failure and invalid PDF bytes are sanitized and never create an output',async t=>{
 const dir=await directory(t);
 if(process.platform==='win32'){await assert.rejects(exportSyntheticReportPdf(doc(),{confirmed:true,directory:dir,renderer:async()=>pdf}),code('pdf_private_storage_unverified'));return;}
 await assert.rejects(exportSyntheticReportPdf(doc(),{confirmed:true,directory:dir,renderer:async()=>{throw Error('synthetic-private-marker');}}),code('pdf_renderer_failed'));
 await assert.rejects(exportSyntheticReportPdf(doc(),{confirmed:true,directory:dir,renderer:async()=>Buffer.from('not a pdf')}),code('pdf_invalid_output'));
 assert.deepEqual(await readdir(dir),[]);
});

test('deadline aborts renderer and late completion cannot save a file',async t=>{
 const dir=await directory(t);let aborted=false;
 if(process.platform==='win32'){await assert.rejects(exportSyntheticReportPdf(doc(),{confirmed:true,directory:dir,renderer:async()=>pdf}),code('pdf_private_storage_unverified'));return;}
 const renderer:PdfRenderer=request=>new Promise(resolve=>{request.signal.addEventListener('abort',()=>{aborted=true;resolve(pdf);},{once:true});});
 await assert.rejects(exportSyntheticReportPdf(doc(),{confirmed:true,directory:dir,renderer,timeoutMs:20}),code('pdf_timeout'));assert.equal(aborted,true);assert.deepEqual(await readdir(dir),[]);
});

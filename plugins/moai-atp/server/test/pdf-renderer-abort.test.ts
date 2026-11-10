import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtemp,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';

test('PDF renderer abort force-kills an unresponsive SIGTERM-ignoring child and removes its profile',{timeout:8000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'atp-pdf-abort-'));
 let child:ChildProcess|undefined,rendering:Promise<void>|undefined,profile:string|undefined;
 t.after(async()=>{child?.kill('SIGKILL');await rendering;await rm(dir,{recursive:true,force:true});});
 const fixture=join(dir,'stubborn.cjs');
 await writeFile(fixture,"process.on('SIGTERM',()=>{});process.stdout.write('fixture ready\\n');setInterval(()=>{},1000);\n");
 const moduleUrl=new URL('../../scripts/export-synthetic-pdf.mjs',import.meta.url).href;
 const {chromeRenderer}=await import(moduleUrl);
 let ready!:()=>void;const started=new Promise<void>(resolve=>{ready=resolve;});
 let closed=false,settled=false;
 const controller=new AbortController();
 rendering=chromeRenderer(process.execPath,{html:'<html></html>',network:'fonts_cdn_only',page:'A4',font_policy:'cdn_load_then_pdf',signal:controller.signal},(_executable:string,args:string[],options:Parameters<typeof spawn>[2])=>{
  profile=args.find(arg=>arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
  child=spawn(process.execPath,[fixture],{...options,stdio:['ignore','pipe','ignore','pipe','pipe']});
  child.once('close',()=>{closed=true;});
  child.stdout!.once('data',()=>ready());
  return child;
 }).then(()=>{settled=true;},()=>{settled=true;});
 await started;controller.abort();await delay(1600);
 assert.equal(settled,true,'renderer must settle after abort even when SIGTERM is ignored');
 assert.equal(closed,true,'the stubborn child must be reaped');
 assert.ok(profile);await assert.rejects(stat(profile),{code:'ENOENT'});
});

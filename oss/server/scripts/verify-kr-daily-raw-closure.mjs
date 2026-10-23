import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await readFile(new URL('evidence/kr-daily-raw/runtime-closure.json',root),'utf8'));
assert.equal(process.version,manifest.node.version);assert.equal(manifest.contract,'moai.kis.kr-daily-raw-evidence.v1');
for(const group of ['runtime','artifact']){const entries=manifest[`${group}_files`];assert.equal(sha(JSON.stringify(entries)),manifest[`${group}_digest_sha256`]);
  for(const e of entries){assert.ok(!e.path.startsWith('/')&&!e.path.split('/').includes('..'));const b=await readFile(new URL(e.path,root));assert.equal(b.length,e.bytes,e.path);assert.equal(sha(b),e.sha256,e.path);}}
console.log(JSON.stringify({status:'closure_verified',runtime_files:manifest.runtime_files.length,artifact_files:manifest.artifact_files.length}));

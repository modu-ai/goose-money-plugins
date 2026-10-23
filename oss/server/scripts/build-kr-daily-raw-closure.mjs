import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
if(process.version!=='v24.22.1')throw Error('pinned_node_required');
const sha=b=>createHash('sha256').update(b).digest('hex');
async function entry(path){const b=await readFile(resolve(root,path));return{path,sha256:sha(b),bytes:b.length};}
async function tree(path){const stat=await lstat(resolve(root,path));if(stat.isSymbolicLink())throw Error('symlink_not_allowed_in_closure');if(stat.isFile())return[path];
  const names=(await readdir(resolve(root,path))).sort();return(await Promise.all(names.map(n=>tree(`${path}/${n}`)))).flat();}
const pins=JSON.parse(await readFile(resolve(root,'evidence/kr-daily-raw/baseline-pins.json'),'utf8'));
for(const pin of pins.files){if(pin.enforce_unchanged===false)continue;const current=await entry(pin.path);if(current.sha256!==pin.sha256||current.bytes!==pin.bytes)throw Error('baseline_pin_changed');}
const runtimePaths=['package.json','dist/src/kr-daily-raw-evidence.js','dist/src/r01-kis-field-parsers.js','dist/src/exact-instant.js',...await tree('node_modules/zod')];
const artifactPaths=[
  'src/kr-daily-raw-evidence.ts','src/r01-kis-field-parsers.ts','src/exact-instant.ts','src/history-contract.ts','test/kr-daily-raw-evidence.test.ts','dist/test/kr-daily-raw-evidence.test.js','dist/src/history-contract.js',
  'dist/src/kr-daily-raw-evidence.d.ts','dist/src/kr-daily-raw-evidence.js.map','package-lock.json','tsconfig.json','docs/kr-daily-raw-evidence.md',
  'scripts/build-kr-daily-raw-evidence.sh','scripts/generate-kr-daily-raw-artifacts.mjs','scripts/replay-kr-daily-raw-evidence.mjs','scripts/verify-kr-daily-raw-regression.sh',
  'scripts/verify-kr-daily-raw-schemas.py','scripts/build-kr-daily-raw-closure.mjs','scripts/verify-kr-daily-raw-closure.mjs',
  'evidence/kr-daily-raw/baseline-pins.json','evidence/kr-daily-raw/fixture-verification.json',
  'contracts/kr-daily-raw-evidence-request-v1.schema.json','contracts/kr-daily-raw-evidence-input-v1.schema.json','contracts/kr-daily-raw-evidence-result-v1.schema.json',
  ...await tree('fixtures/kr-daily-raw')];
const runtime=await Promise.all([...new Set(runtimePaths)].sort().map(entry));const artifacts=await Promise.all([...new Set(artifactPaths)].sort().map(entry));
const manifest={contract:'moai.kis.kr-daily-raw-evidence.v1',node:{version:process.version,external_runtime:true,builtins:['node:crypto','node:util'],observed_binary_sha256:sha(await readFile(process.execPath))},
  module_system:'ESM',entrypoint:'dist/src/kr-daily-raw-evidence.js',apis:['buildKrDailyRawEvidence','verifyKrDailyRawEvidence'],
  dependency_versions:{zod:JSON.parse(await readFile(resolve(root,'node_modules/zod/package.json'),'utf8')).version},
  new_external_dependencies:[],network_required:false,credentials_required:false,new_mcp_routes:0,canonical_promotions:0,
  runtime_files:runtime,artifact_files:artifacts,runtime_digest_sha256:sha(JSON.stringify(runtime)),artifact_digest_sha256:sha(JSON.stringify(artifacts)),
  exclusions:['Manifest itself to avoid recursive hashing','Test logs with variable durations','Host Node binary is external; version pinned and observed digest recorded','Original private provider captures are separate; only deterministic synthetic fixtures bundled'],
  assurance:'Local byte-integrity and reproducible closure only; not provider source authentication, rights clearance or production approval'};
await writeFile(resolve(root,'evidence/kr-daily-raw/runtime-closure.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:'closure_built',runtime_files:runtime.length,artifact_files:artifacts.length,runtime_digest_sha256:manifest.runtime_digest_sha256,artifact_digest_sha256:manifest.artifact_digest_sha256}));

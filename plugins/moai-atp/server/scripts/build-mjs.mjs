import { build, version as esbuildVersion } from 'esbuild';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, cp, readdir, rm, rename, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { bundleOptions, runtimeDeclaration } from './build-mjs-options.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(root, 'runtime');
// The build still needs exactly the declared build pin; the manifest also records the declared runtime range.
const declaration = runtimeDeclaration(root);
if (process.versions.node !== declaration.node_build_pin || esbuildVersion !== '0.28.2') throw Error('build_runtime_version_mismatch');
const marker = 'moai-atp-generated-mjs-v1';
try {
  const info = await lstat(destination);
  if (!info.isDirectory() || info.isSymbolicLink() || await readFile(join(destination,'.generated'),'utf8') !== marker) throw Error('unsafe_existing_runtime');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const stage = await mkdtemp(join(root, '.bundle-'));
let completed = false;
let previous;
let installed = false;
try {
  const result = await build({ ...bundleOptions, absWorkingDir: root, outdir: join(stage,'src') });
  const builtins = new Set(builtinModules.flatMap(name => [name, 'node:'+name]));
  const external = [...new Set(Object.values(result.metafile.outputs).flatMap(output => output.imports.filter(i=>i.external).map(i=>i.path)))].sort();
  if (external.some(name=>!builtins.has(name))) throw Error('unbundled_runtime_dependency');
  await mkdir(join(stage,'contracts'));
  // Packaged CLI report plans need the fixed workflow contract without provider calls.
  await cp(join(root,'contracts','report-workflows.v1.json'),join(stage,'contracts','report-workflows.v1.json'));
  const manualBindings=JSON.parse(await readFile(join(root,'contracts','report-route-bindings.v1.json'),'utf8'));
  if(!manualBindings.routes.R04?.field_groups.holdings_snapshot||manualBindings.routes.R04.field_groups.account_ledger||manualBindings.routes.R04.sections.some(section=>section.field_ids.some(id=>!id.startsWith('manual.'))))throw Error('manual_R04_contract_required');
  for (const name of ['report-route-bindings.v1.json','report-layout-profiles.v1.json']) {
    const contract=JSON.parse(await readFile(join(root,'contracts',name),'utf8'));
    const strip = value => Array.isArray(value) ? value.filter(v=>typeof v!=='string'||(v!=='account_ledger'&&!/^(account|holding|portfolio)\./.test(v))).map(strip) : value&&typeof value==='object' ? Object.fromEntries(Object.entries(value).filter(([key])=>key!=='account_ledger').map(([key,v])=>[key,strip(v)])) : value;
    await writeFile(join(stage,'contracts',name),JSON.stringify(strip(contract),null,2)+'\n');
  }
  const dependencies = [];
  const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
  for (const name of ['@modelcontextprotocol/core','@modelcontextprotocol/server','zod']) {
    const base=join(root,'node_modules',name), metadata=JSON.parse(await readFile(join(base,'package.json'),'utf8'));
    const record=lock.packages['node_modules/'+name];
    if (record.version!==metadata.version || !record.integrity?.startsWith('sha512-')) throw Error('dependency_lock_mismatch');
    const notices=(await readdir(base)).filter(name=>/^(LICENSE|NOTICE)/i.test(name));
    if (!notices.length) throw Error('dependency_notice_missing');
    const target=join(stage,'licenses',name.replaceAll('/','-')); await mkdir(target,{recursive:true});
    for(const notice of notices) await cp(join(base,notice),join(target,notice));
    dependencies.push({name,version:metadata.version,license:metadata.license,integrity:record.integrity});
  }
  const files={};
  async function visit(base, rel='') {
    for(const entry of await readdir(base,{withFileTypes:true})) {
      const name=rel?rel+'/'+entry.name:entry.name;
      if(entry.isSymbolicLink())throw Error('symlink_in_runtime');
      if(entry.isDirectory())await visit(join(base,entry.name),name);
      else files[name]=createHash('sha256').update(await readFile(join(base,entry.name))).digest('hex');
    }
  }
  await visit(stage);
  await writeFile(join(stage,'runtime-manifest.json'),JSON.stringify({format:marker,node_required:declaration.node_required,node_runtime_range:declaration.node_runtime_range,node_build_pin:declaration.node_build_pin,esbuild:esbuildVersion,external_modules:external,dependencies,files},null,2)+'\n');
  await writeFile(join(stage,'.generated'),marker);
  // Only a previously marked generated directory may be replaced.
  try {
    await lstat(destination);
    previous = await mkdtemp(join(root,'.bundle-backup-'));
    await rename(destination,join(previous,'runtime'));
  } catch(error) { if(error.code!=='ENOENT')throw error; }
  try { await rename(stage,destination); installed=true; }
  catch(error) { if(previous)await rename(join(previous,'runtime'),destination); throw error; }
  completed=true;
  if(previous)await rm(previous,{recursive:true});
  console.log(JSON.stringify({runtime:'server/runtime',format:'esm-mjs',external_modules:external,dependencies_bundled:true,node_required:declaration.node_required,node_runtime_range:declaration.node_runtime_range,node_build_pin:declaration.node_build_pin}));
} finally { if(!completed&&!installed) await rm(stage,{recursive:true,force:true}); }

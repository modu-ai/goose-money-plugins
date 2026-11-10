#!/usr/bin/env python3
"""Create a credential-free MJS runtime ZIP. Requires developer build:mjs first.

Installation needs the Node range stated in plugins/moai-atp/README.md, but no npm install or TypeScript build.
No host installation, credential configuration, or API request is performed.
"""
import argparse, hashlib, json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from check_secrets import findings_for

FORBIDDEN={'.git','.goose','keystore','node_modules','.runtime','test','tests','__tests__','__pycache__','evidence'}
def declared_runtime(root):
 # Single declaration source: server/package.json engines.node (run range) and devEngines.runtime.version (build pin).
 manifest=json.loads((root/'server/package.json').read_text())
 declared_range=(manifest.get('engines') or {}).get('node');pin=((manifest.get('devEngines') or {}).get('runtime') or {}).get('version')
 if not isinstance(declared_range,str) or not isinstance(pin,str):raise ValueError('runtime_manifest_invalid')
 return {'range':declared_range,'pin':pin}
def validate_runtime_manifest(manifest,declared):
 if not isinstance(manifest,dict) or manifest.get('format')!='moai-atp-generated-mjs-v1':raise ValueError('runtime_manifest_invalid')
 if manifest.get('node_runtime_range')!=declared['range'] or manifest.get('node_build_pin')!=declared['pin']:raise ValueError('runtime_manifest_invalid')
 if manifest.get('node_required')!=manifest.get('node_build_pin'):raise ValueError('runtime_manifest_invalid')
def build(root, output):
 root,output=root.resolve(),output.resolve()
 if not output.is_relative_to(root.parent.parent/'project-docs') or output.exists():raise ValueError('output_must_be_new_project_document_artifact')
 files={}
 def add_bytes(name,data):
  relative=Path(name)
  if relative.is_absolute() or '..' in relative.parts or any(part in FORBIDDEN for part in relative.parts) or relative.name.startswith('.env') or relative.name in {'credentials.json','secrets.json'}:raise ValueError('private_path_in_bundle')
  approved_icon=({
   'assets/modu-stock-plugin-icon-square.png':'f8b6e1fd48b693643232a46be6969ad585ef5dc8f34a2f06c417868b2a206166',
   'server/assets/report-runtime/stock-sample-logo.png':'5c4f5d9ca5e04e3bf42bd686602de399b997aa8e5020710f547bc9520511036b',
  }.get(name)==hashlib.sha256(data).hexdigest() and data.startswith(b'\x89PNG\r\n\x1a\n'))
  # Exact exported wordmark only; global binary/secret rejection stays unchanged.
  approved_icon = approved_icon or (name=='server/assets/report-runtime/artboard-wordmark.webp'
   and hashlib.sha256(data).hexdigest()=='ee87fa6caf33113f11f2a4fbfa2d10d44b8f9565dbc99e6f75dec5adf27413c5'
   and data[:4]==b'RIFF' and data[8:12]==b'WEBP' and int.from_bytes(data[4:8],'little')==len(data)-8)
  issues=[f for f in findings_for(name,data) if f['rule']!='excluded_path' and not(approved_icon and f['rule']=='unexpected_binary')]
  if approved_icon:issues += [f for f in findings_for(name,data.replace(b'\0',b'')) if f['rule']!='excluded_path']
  if issues:raise ValueError('bundle_content_scan_failed:'+name+':'+','.join(sorted({f['rule'] for f in issues})))
  files[name]=data
 def public_overlay(name,data):
  if name=='skills/goose/references/catalog.json':
   catalog=json.loads(data);catalog['entries']=[entry for entry in catalog['entries'] if entry['id'] in {'R01','R02','R03','R04','R05','R06','R07','R08','R09','R10','R11','R12','R13','U01'}]
   for entry in catalog['entries']:entry['required_groups']=[g for g in entry.get('required_groups',[]) if g not in {'account_ledger'}]
   return (json.dumps(catalog,ensure_ascii=False,indent=2)+'\n').encode()
  if name=='README.md':
   data += '\n\nR04/R05는 수동 snapshot·연간 비용 가정의 비공개 상담 전용입니다. 계좌 연결·거래/성과 원장·주문·이체·R14 백테스트는 제외합니다. ETF는 조건부 확장, 선물은 초기 범위 밖이며 원천 계약의 존재를 지원 완료로 보지 않습니다.\n'.encode()
  if name=='CAPABILITIES.json':
   excluded={'get_account_snapshot'}
   def clean(v):
    if isinstance(v,list):return [clean(x) for x in v if not isinstance(x,str) or x not in excluded]
    if isinstance(v,dict):return {k:clean(x) for k,x in v.items() if k not in excluded}
    return v
   return (json.dumps(clean(json.loads(data)),ensure_ascii=False,indent=2)+'\n').encode()
  if name.startswith('skills/') and name.endswith(('.md','.yaml')):
   text=data.decode()
   text+='\n수동 입력 R04/R05 상담은 비공개이며 계좌 연결·거래/성과 원장·주문·이체·백테스트를 제공하지 않습니다. ETF는 조건부, 선물은 초기 범위 밖입니다.\n' if name.endswith('SKILL.md') else ''
   return text.encode()
  if name=='skills/goose/SKILL.md':
   return data.decode().replace('R01–R11/R14/U01','R01–R03/R05–R11/R14/U01').encode()
  return data
 def add(path):
  if path.is_symlink() or not path.resolve().is_relative_to(root):raise ValueError('unsafe_bundle_source')
  name=path.relative_to(root).as_posix()
  add_bytes(name,public_overlay(name,path.read_bytes()))
 runtime=root/'server/runtime'
 declared=declared_runtime(root)
 manifest=json.loads((runtime/'runtime-manifest.json').read_text())
 validate_runtime_manifest(manifest,declared)
 for name,digest in manifest['files'].items():
  path=runtime/name
  if path.is_symlink() or not path.resolve().is_relative_to(runtime) or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise ValueError('runtime_hash_mismatch')
 if not {'src/main.mjs','src/cli.mjs'}<=manifest['files'].keys():raise ValueError('mjs_entrypoint_missing')
 for name in ['CAPABILITIES.json','plugin.json','README.md','THIRD_PARTY_NOTICES.md','LICENSE','COPYING','COPYING.LESSER']:add(root/name)
 mcp=json.loads((root/'mcp.json').read_text());mcp['mcpServers']['moai-kis-readonly']['args']=['${PLUGIN_ROOT}/server/runtime/src/main.mjs']
 add_bytes('mcp.json',(json.dumps(mcp,indent=2)+'\n').encode())
 package=json.loads((root/'package.json').read_text());package.pop('devEngines',None);package['scripts']={'setup':'node server/runtime/src/cli.mjs setup','start':'node server/runtime/src/main.mjs'}
 add_bytes('package.json',(json.dumps(package,ensure_ascii=False,indent=2)+'\n').encode())
 server=json.loads((root/'server/package.json').read_text());server.pop('devDependencies',None);server.pop('dependencies',None);server.pop('devEngines',None);server['scripts']={'start':'node runtime/src/main.mjs','setup':'node runtime/src/cli.mjs setup'};server['bin']={'moai-atp':'runtime/src/cli.mjs'}
 add_bytes('server/package.json',(json.dumps(server,ensure_ascii=False,indent=2)+'\n').encode())
 for tree in ['skills','assets','server/assets','server/runtime']:
  for path in sorted((root/tree).rglob('*')):
   if path.is_file() and path.name!='.generated' and 'portfolio-risk' not in path.parts:add(path)
 receipt={'format':'moai-atp-mjs-runtime-v2','node_required':declared['pin'],'node_runtime_range':declared['range'],'node_build_pin':declared['pin'],'dependencies':manifest['dependencies'],'files':{name:hashlib.sha256(data).hexdigest() for name,data in sorted(files.items())},'secret_findings':0,'limitations':'Declared Node run range '+declared['range']+'; the entry refuses older Node. Heuristic secret scan. macOS subprocess validation only; Windows and host UI unverified; provider HTTP evidence is tracked separately, not included in this ZIP. No Node binary or user credentials.'}
 files['runtime-bundle-manifest.json']=(json.dumps(receipt,indent=2)+'\n').encode()
 output.parent.mkdir(parents=True,exist_ok=True)
 with ZipFile(output,'x',compression=ZIP_DEFLATED) as archive:
  for name,data in sorted(files.items()):
   info=ZipInfo(name,date_time=(2026,10,24,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16;archive.writestr(info,data)
 return {'artifact':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'files':len(files),'bytes':output.stat().st_size,'secret_findings':0,'format':receipt['format']}
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--output',required=True,type=Path);args=parser.parse_args();print(json.dumps(build(Path(__file__).resolve().parents[1],args.output),indent=2))

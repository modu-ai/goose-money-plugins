#!/usr/bin/env python3
"""Local component checks from Plugin Creator packaging guidance; no upload."""
import json
import re
import argparse
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--source-only', action='store_true')
parser.add_argument('--runtime', action='store_true')
args = parser.parse_args()
root = args.root.resolve()
manifest = json.loads((root/'plugin.json').read_text(encoding='utf-8'))
assert manifest['$schema'] == 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
assert manifest['name'] == 'moai-atp'
assert re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?', manifest['version'])
# Source and runtime layouts retain different metadata files; every present version must agree.
for relative in ['package.json', 'server/package.json', 'CAPABILITIES.json', 'server/package-lock.json']:
    candidate = root/relative
    if candidate.is_file():
        record = json.loads(candidate.read_text(encoding='utf-8'))
        assert record['version'] == manifest['version'], f'version mismatch: {relative}'
        if relative.endswith('package-lock.json'):
            assert record['packages']['']['version'] == manifest['version'], 'lock root version mismatch'

interface = manifest['extensions']['com.openai']['interface']
assert interface['displayName'] == '모두의 주식 · MoAI ATP'
assert 0 < len(interface['shortDescription']) <= 30
assert isinstance(interface.get('longDescription'), str) and interface['longDescription'].strip()
assert isinstance(interface['capabilities'], list)
mcp = json.loads((root/'mcp.json').read_text(encoding='utf-8'))
assert mcp['$schema'] == 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'
server = mcp['mcpServers']['moai-kis-readonly']
entry = 'runtime/src/main.mjs' if args.runtime else 'dist/src/main.js'
assert server == {'type':'stdio','command':'node','args':['${PLUGIN_ROOT}/server/'+entry],'cwd':'${PLUGIN_ROOT}/server','env':{'GOOSE_KIS_READ_ENABLED':'1','GOOSE_OPENDART_READ_ENABLED':'1','GOOSE_LOCAL_REPORT_VIEW_ENABLED':'1'}}
if args.source_only:
    assert (root/'server/src/main.ts').is_file(), 'source entrypoint missing'
    assert (root/'server/src/cli.ts').is_file(), 'source CLI missing'
    assert not (root/'server/dist').exists(), 'source package contains build output'
elif args.runtime:
    assert (root/'server/runtime/src/main.mjs').is_file()
    assert (root/'server/runtime/src/cli.mjs').is_file()
    assert not (root/'server/node_modules').exists(), 'runtime must bundle dependencies'
    assert not (root/'server/src').exists(), 'runtime contains developer source'
else:
    assert (root/'server/dist/src/main.js').is_file(), 'build entrypoint missing'
    assert (root/'server/dist/src/cli.js').is_file(), 'build CLI missing'
for name in ['logo','composerIcon']:
    icon=(root/interface[name]).resolve();assert icon.is_relative_to(root) and icon.is_file(),'missing icon'
assert (root/'README.md').is_file(), 'source package/setup guide missing'
assert sorted(p.parent.name for p in (root/'skills').glob('*/SKILL.md')) == ['goose'], 'public skill discovery must contain Goose only'
for path in (root/'skills').glob('*/SKILL.md'):
    text = path.read_text(encoding='utf-8')
    assert text.startswith('---\n') and len(text.encode()) <= 1024*1024
    assert '[TODO' not in text
    for target in re.findall(r'\]\(([^)]+)\)', text):
        if '://' in target or target.startswith('#'):
            continue
        resolved = (path.parent/target.split('#')[0]).resolve()
        assert resolved.is_relative_to(root) and resolved.is_file(), f'bad skill reference: {path.name}'
catalog = json.loads((root/'skills/goose/references/catalog.json').read_text(encoding='utf-8'))['entries']
if args.runtime:
    assert [x['id'] for x in catalog] == [f'R{i:02}' for i in range(1,14) if i != 4] + ['U01']
    assert all(x['public'] for x in catalog)
else:
    assert [x['id'] for x in catalog] == [f'R{i:02}' for i in range(1,14)] + ['U01','U02','U03']
    assert sum(x['public'] for x in catalog) == 15
    assert catalog[-1]['kind'] == 'internal_qa' and not catalog[-1]['public']
assert all(x['actual_data_complete'] is False for x in catalog)
route_path = root/('server/runtime/contracts/report-route-bindings.v1.json' if args.runtime else 'server/contracts/report-route-bindings.v1.json')
if route_path.is_file():
    routes = json.loads(route_path.read_text(encoding='utf-8'))['routes']
    for entry in catalog:
        if entry['id'] in ['R12', 'R13']:
            assert set(entry['required_groups']) == set(routes[entry['id']]['field_groups']), 'route group mismatch: '+entry['id']

print('Local package component checks passed; account upload/host installation not performed.')

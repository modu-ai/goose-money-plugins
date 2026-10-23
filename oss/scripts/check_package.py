#!/usr/bin/env python3
"""Local component checks from Plugin Creator packaging guidance; no upload."""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root/'plugin.json').read_text())
assert manifest['$schema'] == 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
assert manifest['name'] == 'moai-atp'
assert re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?', manifest['version'])
interface = manifest['extensions']['com.openai']['interface']
assert 0 < len(interface['shortDescription']) <= 30
assert isinstance(interface['capabilities'], list)
mcp = json.loads((root/'mcp.json').read_text())
assert mcp['$schema'] == 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'
server = mcp['mcpServers']['moai-kis-readonly']
assert server == {'type':'stdio','command':'node','args':['${PLUGIN_ROOT}/server/dist/src/main.js'],'cwd':'${PLUGIN_ROOT}/server'}
assert (root/'server/dist/src/main.js').is_file(), 'build entrypoint missing'
assert (root/'server/dist/src/cli.js').is_file(), 'build CLI missing'
for path in (root/'skills').glob('*/SKILL.md'):
    text = path.read_text()
    assert text.startswith('---\n') and len(text.encode()) <= 1024*1024
    assert '[TODO' not in text
    for target in re.findall(r'\]\(([^)]+)\)', text):
        if '://' in target or target.startswith('#'):
            continue
        resolved = (path.parent/target.split('#')[0]).resolve()
        assert resolved.is_relative_to(root) and resolved.is_file(), f'bad skill reference: {path.name}'
catalog = json.loads((root/'skills/goose/references/catalog.json').read_text())['entries']
assert [x['id'] for x in catalog] == [f'R{i:02}' for i in range(1,15)] + ['U01','U02','U03']
assert sum(x['public'] for x in catalog) == 16
assert all(x['actual_data_complete'] is False for x in catalog)
assert catalog[-1]['kind'] == 'internal_qa' and not catalog[-1]['public']
print('Local package component checks passed; account upload/host installation not performed.')

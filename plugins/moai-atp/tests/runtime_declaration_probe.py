#!/usr/bin/env python3
"""Synthetic probe for SPEC-ATP-RUNTIME-001: what build_runtime_bundle reads and writes.

usage: python3 -I runtime_declaration_probe.py <plugin root>
Builds a throwaway tree from synthetic files only (no credentials, no network, no real runtime output),
runs the bundle builder from <plugin root>/scripts on it, and prints one JSON line with the declared runtime
and the values the receipt and the ZIP package copies carry. Also imported by the unit tests.
"""
import hashlib
import json
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile

MARKER = 'moai-atp-generated-mjs-v1'


def synthetic_root(parent, root_package, server_package, manifest_fields=None):
    """Create <parent>/plugins/moai-atp with the files build() reads; manifest_fields override (None removes) manifest keys."""
    root = Path(parent) / 'plugins' / 'moai-atp'
    (root / 'server/runtime/src').mkdir(parents=True)
    files = {}
    for name in ('src/main.mjs', 'src/cli.mjs'):
        body = 'export {};\n'
        (root / 'server/runtime' / name).write_text(body)
        files[name] = hashlib.sha256(body.encode()).hexdigest()
    engines = (server_package.get('engines') or {}).get('node')
    pin = ((server_package.get('devEngines') or {}).get('runtime') or {}).get('version')
    manifest = {'format': MARKER, 'node_required': pin, 'node_runtime_range': engines, 'node_build_pin': pin,
                'esbuild': '0.0.0-synthetic', 'external_modules': [], 'dependencies': [], 'files': files}
    for key, value in (manifest_fields or {}).items():
        if value is None:
            manifest.pop(key, None)
        else:
            manifest[key] = value
    (root / 'server/runtime/runtime-manifest.json').write_text(json.dumps(manifest) + '\n')
    for name in ('README.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'COPYING', 'COPYING.LESSER'):
        (root / name).write_text('synthetic placeholder text\n')
    (root / 'CAPABILITIES.json').write_text('{"synthetic": true}\n')
    (root / 'plugin.json').write_text('{"synthetic": true}\n')
    (root / 'mcp.json').write_text(json.dumps({'mcpServers': {'moai-kis-readonly': {'args': []}}}) + '\n')
    (root / 'package.json').write_text(json.dumps(root_package) + '\n')
    (root / 'server/package.json').write_text(json.dumps(server_package) + '\n')
    return root


def read_zip(path):
    with ZipFile(path) as archive:
        return {name: archive.read(name) for name in ('runtime-bundle-manifest.json', 'package.json', 'server/package.json')}


def main(argv):
    tree = Path(argv[1]).resolve()
    sys.path.insert(0, str(tree / 'scripts'))
    import build_runtime_bundle as bundle
    out = {key: None for key in ('validator_range', 'validator_pin', 'receipt_range', 'receipt_node_required',
                                 'receipt_build_pin', 'zip_root_engines', 'zip_server_engines')}
    try:
        declared = bundle.declared_runtime(tree)
        out['validator_range'], out['validator_pin'] = declared['range'], declared['pin']
    except Exception as error:  # noqa: BLE001
        out['declared_error'] = str(error)[:80]
    try:
        root_package = json.loads((tree / 'package.json').read_text())
        server_package = json.loads((tree / 'server/package.json').read_text())
        with tempfile.TemporaryDirectory() as scratch:
            root = synthetic_root(scratch, root_package, server_package)
            bundle.build(root, Path(scratch).resolve() / 'project-docs' / 'probe.zip')
            contents = read_zip(Path(scratch).resolve() / 'project-docs' / 'probe.zip')
        receipt = json.loads(contents['runtime-bundle-manifest.json'])
        out['receipt_range'] = receipt.get('node_runtime_range')
        out['receipt_node_required'] = receipt.get('node_required')
        out['receipt_build_pin'] = receipt.get('node_build_pin')
        out['zip_root_engines'] = (json.loads(contents['package.json']).get('engines') or {}).get('node')
        out['zip_server_engines'] = (json.loads(contents['server/package.json']).get('engines') or {}).get('node')
    except Exception as error:  # noqa: BLE001
        out['build_error'] = str(error)[:80]
    print(json.dumps(out))


if __name__ == '__main__':
    main(sys.argv)

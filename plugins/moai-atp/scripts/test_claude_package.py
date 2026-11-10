"""Claude packaging regressions; fixtures contain no credentials and run no server."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from build_runtime_bundle import build

PLUGIN = Path(__file__).resolve().parents[1]
REPO = PLUGIN.parents[1]


class ClaudePackageTests(unittest.TestCase):
    def test_local_catalog_resolves_the_versioned_claude_plugin(self):
        catalog = json.loads((REPO/'.claude-plugin/marketplace.json').read_text())
        self.assertEqual(catalog['owner']['name'], 'modu-ai')
        self.assertTrue(catalog['description'].strip())
        self.assertEqual(len(catalog['plugins']), 1)
        entry = catalog['plugins'][0]
        self.assertEqual(entry['name'], 'moai-atp')
        plugin = (REPO/entry['source']).resolve()
        self.assertEqual(plugin, PLUGIN)
        manifest = json.loads((plugin/'.claude-plugin/plugin.json').read_text())
        self.assertEqual(manifest['version'], json.loads((plugin/'plugin.json').read_text())['version'])
        self.assertEqual(manifest['name'], entry['name'])
        self.assertEqual(manifest['author']['name'], 'modu-ai')
        self.assertTrue((plugin/manifest['icon']).is_file())
        self.assertEqual(set(manifest['mcpServers']), {'moai-kis-readonly'})
        server = manifest['mcpServers']['moai-kis-readonly']
        self.assertEqual(server['command'], 'node')
        self.assertEqual(server['args'], ['${CLAUDE_PLUGIN_ROOT}/server/dist/src/main.js'])
        self.assertEqual(server['env'], json.loads((plugin/'mcp.json').read_text())['mcpServers']['moai-kis-readonly']['env'])
        self.assertNotIn('hooks', manifest)

    def test_runtime_zip_carries_claude_manifest_with_an_existing_mjs_entry(self):
        with tempfile.TemporaryDirectory(prefix='claude-package-synthetic-') as directory:
            base = Path(directory)
            plugin = base/'plugins/moai-atp'
            shutil.copytree(PLUGIN, plugin, ignore=shutil.ignore_patterns('node_modules', 'dist', 'runtime', '__pycache__'))
            runtime = plugin/'server/runtime'
            (runtime/'src').mkdir(parents=True)
            for name in ('main.mjs', 'cli.mjs'):
                (runtime/'src'/name).write_text('// synthetic fixture; not a running server\n')
            (runtime/'contracts').mkdir()
            for name in ('report-workflows.v1.json', 'report-route-bindings.v1.json'):
                shutil.copyfile(plugin/'server/contracts'/name, runtime/'contracts'/name)
            package = json.loads((plugin/'server/package.json').read_text())
            pin = package['devEngines']['runtime']['version']
            files = {path.relative_to(runtime).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                     for path in runtime.rglob('*') if path.is_file()}
            (runtime/'runtime-manifest.json').write_text(json.dumps({
                'format': 'moai-atp-generated-mjs-v1', 'node_required': pin,
                'node_build_pin': pin, 'node_runtime_range': package['engines']['node'],
                'dependencies': [], 'files': files,
            }))
            output = base/'project-docs/synthetic-claude.zip'
            build(plugin, output)
            with ZipFile(output) as archive:
                manifest_path = '.claude-plugin/plugin.json'
                manifest = json.loads(archive.read(manifest_path))
                self.assertEqual(manifest['version'], package['version'])
                server = manifest['mcpServers']['moai-kis-readonly']
                self.assertEqual(server['args'], ['${CLAUDE_PLUGIN_ROOT}/server/runtime/src/main.mjs'])
                entry = server['args'][0].removeprefix('${CLAUDE_PLUGIN_ROOT}/')
                self.assertIn(entry, archive.namelist())
                self.assertEqual(server['env'], json.loads(archive.read('mcp.json'))['mcpServers']['moai-kis-readonly']['env'])
                receipt = json.loads(archive.read('runtime-bundle-manifest.json'))
                self.assertEqual(receipt['files'][manifest_path], hashlib.sha256(archive.read(manifest_path)).hexdigest())
                extracted = base/'installed'
                archive.extractall(extracted)
            check = subprocess.run([sys.executable, str(PLUGIN/'scripts/check_package.py'), '--root', str(extracted), '--runtime'], capture_output=True, text=True)
            self.assertEqual(check.returncode, 0, check.stderr)
            manifest_file = extracted/manifest_path
            manifest['mcpServers']['moai-kis-readonly']['args'] = ['${CLAUDE_PLUGIN_ROOT}/server/dist/src/main.js']
            manifest_file.write_text(json.dumps(manifest))
            rejected = subprocess.run([sys.executable, str(PLUGIN/'scripts/check_package.py'), '--root', str(extracted), '--runtime'], capture_output=True, text=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn('Claude MCP entry mismatch', rejected.stderr)

            with self.subTest('external Claude metadata directory must not be read'):
                metadata = plugin/'.claude-plugin'
                outside = base/'external-claude-metadata'
                metadata.rename(outside)
                if sys.platform == 'win32':
                    subprocess.run(['cmd', '/c', 'mklink', '/J', str(metadata), str(outside)], check=True, capture_output=True)
                else:
                    metadata.symlink_to(outside, target_is_directory=True)
                reads = []
                original_open = Path.open

                def record_external_open(path, *args, **kwargs):
                    if path.resolve() == outside/'plugin.json':
                        reads.append(path)
                    return original_open(path, *args, **kwargs)

                refused_output = base/'project-docs/refused-claude.zip'
                with patch.object(Path, 'open', record_external_open):
                    with self.assertRaisesRegex(ValueError, 'unsafe_bundle_source'):
                        build(plugin, refused_output)
                self.assertEqual(reads, [], 'outside metadata must be rejected before reading')
                self.assertFalse(refused_output.exists())


if __name__ == '__main__':
    unittest.main()

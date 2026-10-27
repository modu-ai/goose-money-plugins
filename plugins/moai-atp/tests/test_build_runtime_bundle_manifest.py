"""SPEC-ATP-RUNTIME-001 AC-RT-12 / AC-RT-13 (REQ-RT-008, 011, 012): bundle manifest validation and receipt.

Synthetic trees only; no credentials, no network. Run: python3 -m unittest plugins/moai-atp/tests/test_build_runtime_bundle_manifest.py
"""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'scripts'))
sys.path.insert(0, str(HERE))
import build_runtime_bundle as bundle  # noqa: E402
from runtime_declaration_probe import read_zip, synthetic_root  # noqa: E402

PIN = {'name': 'node', 'version': '24.22.1', 'onFail': 'warn'}
ROOT_PACKAGE = {'name': 'synthetic-root', 'engines': {'node': '>=22.2.0'}, 'devEngines': {'runtime': PIN}}
SERVER_PACKAGE = {'name': 'synthetic-server', 'engines': {'node': '>=22.2.0'}, 'devEngines': {'runtime': PIN},
                  'dependencies': {'synthetic': '1.0.0'}, 'devDependencies': {'synthetic-dev': '1.0.0'}}


class ManifestValidation(unittest.TestCase):
    def build_with(self, manifest_fields=None, server_package=None):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        root = synthetic_root(scratch.name, ROOT_PACKAGE, server_package or SERVER_PACKAGE, manifest_fields)
        output = Path(scratch.name).resolve() / 'project-docs' / 'out.zip'
        return root, output

    def assert_rejected(self, manifest_fields=None, server_package=None):
        root, output = self.build_with(manifest_fields, server_package)
        with self.assertRaisesRegex(ValueError, 'runtime_manifest_invalid'):
            bundle.build(root, output)
        self.assertFalse(output.exists(), 'no ZIP may be written')

    def test_valid_split_manifest_passes_and_writes_a_zip(self):
        root, output = self.build_with()
        result = bundle.build(root, output)
        self.assertTrue(output.exists())
        self.assertEqual(result['format'], 'moai-atp-mjs-runtime-v2')

    def test_declared_runtime_reads_range_and_pin_from_the_declaration_source(self):
        root, _ = self.build_with()
        self.assertEqual(bundle.declared_runtime(root.resolve()), {'range': '>=22.2.0', 'pin': '24.22.1'})

    def test_old_format_manifest_without_split_fields_is_rejected(self):
        self.assert_rejected({'node_runtime_range': None, 'node_build_pin': None})

    def test_range_different_from_the_declaration_source_is_rejected(self):
        self.assert_rejected({'node_runtime_range': '>=22'})

    def test_build_pin_different_from_the_declaration_source_is_rejected(self):
        self.assert_rejected({'node_build_pin': '24.22.0'})

    def test_node_required_different_from_the_build_pin_is_rejected(self):
        self.assert_rejected({'node_required': '24.22.0'})

    def test_declaration_source_without_dev_engines_is_rejected(self):
        server = copy.deepcopy(SERVER_PACKAGE)
        del server['devEngines']
        self.assert_rejected({'node_runtime_range': '>=22.2.0', 'node_build_pin': '24.22.1', 'node_required': '24.22.1'}, server)

    def test_validate_runtime_manifest_is_callable_on_its_own(self):
        declared = {'range': '>=22.2.0', 'pin': '24.22.1'}
        good = {'format': 'moai-atp-generated-mjs-v1', 'node_required': '24.22.1', 'node_runtime_range': '>=22.2.0', 'node_build_pin': '24.22.1'}
        bundle.validate_runtime_manifest(good, declared)
        for broken in ({**good, 'format': 'other'}, {k: v for k, v in good.items() if k != 'node_build_pin'}):
            with self.assertRaisesRegex(ValueError, 'runtime_manifest_invalid'):
                bundle.validate_runtime_manifest(broken, declared)


class ReceiptAndPackages(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        root = synthetic_root(scratch.name, ROOT_PACKAGE, SERVER_PACKAGE)
        output = Path(scratch.name).resolve() / 'project-docs' / 'out.zip'
        bundle.build(root, output)
        self.contents = read_zip(output)
        self.receipt = json.loads(self.contents['runtime-bundle-manifest.json'])

    def test_receipt_keeps_the_v2_format_and_node_required_and_adds_the_split_fields(self):
        self.assertEqual(self.receipt['format'], 'moai-atp-mjs-runtime-v2')
        self.assertEqual(self.receipt['node_required'], '24.22.1')
        self.assertEqual(self.receipt['node_runtime_range'], '>=22.2.0')
        self.assertEqual(self.receipt['node_build_pin'], '24.22.1')

    def test_limitations_state_the_range_and_keep_windows_unverified(self):
        self.assertIn('>=22.2.0', self.receipt['limitations'])
        self.assertIn('Windows and host UI unverified', self.receipt['limitations'])

    def test_zip_package_copies_carry_the_range_without_dev_engines(self):
        for name in ('package.json', 'server/package.json'):
            package = json.loads(self.contents[name])
            self.assertEqual(package['engines'], {'node': '>=22.2.0'}, name)
            self.assertNotIn('devEngines', package, name)


if __name__ == '__main__':
    unittest.main()

"""R04/R05 stay in the distributable catalogue without admitting account ledgers."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'scripts'))
sys.path.insert(0, str(HERE))
import build_runtime_bundle as bundle
from runtime_declaration_probe import synthetic_root


class ManualConsultationBundle(unittest.TestCase):
    def test_manual_routes_and_private_guidance_survive_packaging(self):
        package = {'engines': {'node': '>=22.2.0'}, 'devEngines': {'runtime': {'version': '24.22.1'}}}
        with tempfile.TemporaryDirectory() as scratch:
            root = synthetic_root(scratch, package, package)
            refs = root / 'skills/goose/references'
            refs.mkdir(parents=True)
            entries = [{'id': rid, 'required_groups': ['holdings_snapshot'], 'availability': 'manual_input_only'} for rid in ['R04', 'R05']]
            (refs / 'catalog.json').write_text(json.dumps({'entries': entries}), encoding='utf-8')
            output = Path(scratch).resolve() / 'project-docs/manual.zip'
            bundle.build(root, output)
            with ZipFile(output) as archive:
                actual = json.loads(archive.read('skills/goose/references/catalog.json'))['entries']
                self.assertEqual(actual, entries)
                self.assertIn('수동 입력 R04/R05 상담은 비공개', archive.read('README.md').decode('utf-8'))

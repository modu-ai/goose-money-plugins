"""Structural checks only. Runtime reconstruction and fresh verifier tests remain mandatory."""
from copy import deepcopy
from pathlib import Path
import hashlib, json, unittest
from jsonschema import Draft202012Validator
ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / 'examples/kr-history-bridge-synthetic'
def load(path): return json.loads(Path(path).read_text())
class SyntheticKrSchemaTests(unittest.TestCase):
    def test_schema_and_fixture_pairs(self):
        for kind, fixture in [('binding', 'binding'), ('input', 'input'), ('handoff-envelope', 'handoff')]:
            schema = load(ROOT / f'server/contracts/kr-daily-synthetic-only-history-{kind}.schema.json')
            Draft202012Validator.check_schema(schema)
            self.assertGreater(len(schema['x-runtime-refinements']), 5)
            Draft202012Validator(schema).validate(load(EXAMPLES / f'SYNTHETIC-{fixture}.json'))
    def test_reverified_fixture(self):
        schema = load(ROOT / 'server/contracts/kr-daily-synthetic-only-history-handoff-envelope.schema.json')
        Draft202012Validator(schema).validate(load(EXAMPLES / 'SYNTHETIC-reverified-handoff.json'))
    def test_missing_units_actions_and_events_fail_structurally(self):
        validator = Draft202012Validator(load(ROOT / 'server/contracts/kr-daily-synthetic-only-history-binding.schema.json'))
        base = load(EXAMPLES / 'SYNTHETIC-binding.json')
        for mutate in [lambda b: b['context'].pop('units'), lambda b: b.pop('no_actions'), lambda b: b['no_actions']['events'].append({'type':'split'}), lambda b: b['no_actions'].update(coverage_complete=False), lambda b: b.update(scope='actual')]:
            b = deepcopy(base); mutate(b); self.assertTrue(list(validator.iter_errors(b)))
    def test_fixture_hashes_and_zero_actual_claims(self):
        manifest = load(EXAMPLES / 'manifest.json')
        self.assertFalse(manifest['actual_origin_supported']); self.assertEqual(manifest['canonical_actual_bindings'], 0)
        for entry in manifest['output_files']: self.assertEqual(hashlib.sha256((EXAMPLES / entry['name']).read_bytes()).hexdigest(), entry['sha256'])
        source = load(EXAMPLES / 'SYNTHETIC-source.json'); handoff = load(EXAMPLES / 'SYNTHETIC-handoff.json')
        self.assertEqual(source['canonical_projection_status'], 'blocked'); self.assertEqual(handoff['lineage']['raw_blockers'], source['blockers'])
        self.assertEqual(source['adjustment_code_interpretation'], 'blocked_portal_sample_conflict')
    def test_original_text_linkage(self):
        source = load(EXAMPLES / 'SYNTHETIC-source.json'); binding = load(EXAMPLES / 'SYNTHETIC-binding.json'); original = (EXAMPLES / 'SYNTHETIC-original-body.json').read_bytes()
        self.assertEqual(hashlib.sha256(original).hexdigest(), source['capture']['body_sha256']); self.assertEqual(source['capture']['body_sha256'], binding['source_link']['original_body_sha256'])
if __name__ == '__main__': unittest.main()

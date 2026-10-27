"""Offline public request-schema regression against additive synthetic fixtures."""
import json
from pathlib import Path
import unittest
from jsonschema import Draft202012Validator
ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return json.loads((ROOT / path).read_text())

class SourceInputMcpSchemaTests(unittest.TestCase):
    def test_five_strict_public_request_schemas(self):
        catalog = read('contracts/source-input-mcp-tools-v1.json')
        fixtures = read('fixtures/source-input-mcp.synthetic.json')['fixtures']
        self.assertEqual(catalog['total_registered_names'], 34)
        self.assertEqual(len(catalog['tools']), 5)
        for entry, fixture in zip(catalog['tools'], fixtures):
            self.assertEqual(entry['name'], fixture['name'])
            schema = read(entry['input_schema'])
            Draft202012Validator.check_schema(schema)
            validator = Draft202012Validator(schema)
            validator.validate(fixture['input'])
            for key in ['origin', 'rightsEnabled', 'received_at', 'endpoint', 'transport', 'capture']:
                self.assertFalse(validator.is_valid(dict(fixture['input'], **{key: 'forbidden'})))
            self.assertFalse(validator.is_valid({}))

    def test_blocked_sources_have_no_result_or_grants(self):
        catalog = read('contracts/source-input-mcp-tools-v1.json')
        fixtures = read('fixtures/source-input-mcp.synthetic.json')['fixtures']
        for entry, fixture in zip(catalog['tools'], fixtures):
            if entry['operation_ref'] in ('KIS-072', 'KIS-109'):
                self.assertEqual(entry['role_grants'], [])
                self.assertEqual(fixture['error_code'], 'request_contract_conflict')
                self.assertIsNone(fixture['result'])
            else:
                self.assertIsNone(fixture['error_code'])
                self.assertEqual(fixture['result']['capture']['origin'], 'synthetic')
                self.assertEqual(fixture['result']['canonical_projection_status'], 'blocked')
                self.assertEqual(fixture['result']['rights_status'], 'pending')

    def test_current_receipt_references_real_bounded_procedures(self):
        execution = read('fixtures/goose-execution-current.synthetic.json')
        self.assertEqual(len(execution['records']), 5)
        for record in execution['records']:
            expected = f"references/roles/{record['role_id']}/PROCEDURE.md"
            self.assertEqual(record['skill'], expected)
            path = ROOT.parent / 'skills/goose' / expected
            self.assertTrue(path.is_file())
            self.assertLessEqual(path.stat().st_size, 65536)

if __name__ == '__main__':
    unittest.main()

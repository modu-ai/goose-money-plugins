"""Offline structure-only schema checks; runtime reconstruction remains mandatory."""
import json
from pathlib import Path
import unittest
from jsonschema import Draft202012Validator
ROOT=Path(__file__).resolve().parents[1]
def read(path):return json.loads((ROOT/path).read_text())
class CaptureFinancialSchemaTests(unittest.TestCase):
 def test_input_fixture(self):
  schema=read('contracts/sec-capture-financial-selection-input-v1.schema.json');Draft202012Validator.check_schema(schema)
  Draft202012Validator(schema).validate(read('fixtures/sec-capture-financial-selection/synthetic-input.json'))
 def test_candidate_fixture(self):
  schema=read('contracts/sec-capture-financial-evidence-candidate-v1.schema.json');Draft202012Validator.check_schema(schema)
  Draft202012Validator(schema).validate(read('fixtures/sec-capture-financial-selection/synthetic-candidate.json'))
 def test_schema_not_reconstruction(self):
  schema=read('contracts/sec-capture-financial-evidence-candidate-v1.schema.json')
  Draft202012Validator(schema).validate(read('fixtures/sec-capture-financial-selection/synthetic-invalid-candidate-numeric-tamper.json'))
 def test_promotion_rejects(self):
  schema=read('contracts/sec-capture-financial-evidence-candidate-v1.schema.json')
  for key,value in [('metric_eligible',True),('source_authentication','verified'),('canonical_fact',{'value':'1'})]:
   candidate=read('fixtures/sec-capture-financial-selection/synthetic-candidate.json');candidate[key]=value
   self.assertTrue(list(Draft202012Validator(schema).iter_errors(candidate)))
if __name__=='__main__':unittest.main()

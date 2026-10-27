"""Offline structural schema checks; these do not replace TypeScript reconstructive verification."""
import copy
import json
from pathlib import Path
import unittest
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]

class RemainingSourceStructuralSchemas(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validators = {}
        for kind in ("request", "input", "result"):
            schema = json.loads((ROOT / f"contracts/remaining-source-{kind}-v1.schema.json").read_text())
            Draft202012Validator.check_schema(schema)
            cls.validators[kind] = Draft202012Validator(schema)
        cls.fixtures = json.loads((ROOT / "fixtures/remaining-source-fixtures-v1.json").read_text())["cases"]

    def test_all_synthetic_inputs_and_results(self):
        for case in self.fixtures:
            for kind in ("input", "result"):
                with self.subTest(case=case["name"], kind=kind):
                    self.validators[kind].validate(json.loads((ROOT / case[kind]).read_text()))
                    if kind == "input":
                        self.validators["request"].validate(json.loads((ROOT / case[kind]).read_text())["request"])

    def test_no_canonical_promotion_or_truth_flags(self):
        for case in self.fixtures:
            original = json.loads((ROOT / case["result"]).read_text())
            for key, value in (("metric_ready", True), ("first_page_origin", "verified"),
                               ("request_execution_status", "actual_request_verified"),
                               ("publication_at", "2026-10-22T08:00:00Z")):
                with self.subTest(case=case["name"], key=key):
                    changed = copy.deepcopy(original)
                    changed[key] = value
                    self.assertFalse(self.validators["result"].is_valid(changed))

    def test_strict_shapes_and_raw_state(self):
        for case in self.fixtures:
            original = json.loads((ROOT / case["result"]).read_text())
            changed = copy.deepcopy(original)
            changed["private_key"] = "PRIVATE_MARKER"
            self.assertFalse(self.validators["result"].is_valid(changed))
            for group in original["groups"]:
                if group["rows"]:
                    for key, cell in group["rows"][0]["raw_fields"].items():
                        changed = copy.deepcopy(original)
                        changed["groups"][original["groups"].index(group)]["rows"][0]["raw_fields"][key] = {"state": "missing", "value": "fabricated"}
                        self.assertFalse(self.validators["result"].is_valid(changed))

    def test_structural_checks_do_not_authenticate_hash(self):
        # This intentional example documents why original-text reconstruction is mandatory.
        original = json.loads((ROOT / self.fixtures[0]["result"]).read_text())
        original["capture"]["body_sha256"] = "0" * 64
        self.assertTrue(self.validators["result"].is_valid(original))

if __name__ == "__main__":
    unittest.main()

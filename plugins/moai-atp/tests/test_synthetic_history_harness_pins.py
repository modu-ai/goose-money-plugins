"""Guards for run-synthetic-kr-history.py.

Its duplicated pins must equal the contract JSON, and it must fail closed
under python -O.
"""
import ast
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests/run-synthetic-kr-history.py"
CONTRACT = ROOT / "server/contracts/kr-daily-synthetic-history-dependencies.json"
REPORT_DIR = "server/contracts/report-history-reference/"
R01 = "src/r01-kis-field-parsers.ts"
ZERO = "0" * 64


def harness_literals(path):
    tree = ast.parse(Path(path).read_text())
    tables, versions, node_versions = {}, {}, set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id in ("pins", "rpins")
        ):
            tables[node.targets[0].id] = ast.literal_eval(node.value)
        if (
            isinstance(node, ast.For)
            and isinstance(node.iter, ast.List)
            and all(isinstance(e, ast.Tuple) for e in node.iter.elts)
        ):
            versions.update(dict(ast.literal_eval(node.iter)))
        if (
            isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and re.fullmatch(r"v\d+\.\d+\.\d+", node.value)
        ):
            node_versions.add(node.value)
    return tables, versions, node_versions


def pin_mismatches(harness, contract):
    """Name every pin or version where harness and contract JSON disagree.

    A table the harness lacks reads as a mismatch, never as a pass.
    """
    tables, versions, node_versions = harness_literals(harness)
    data = json.loads(Path(contract).read_text())
    mine = {"server/" + k: v for k, v in tables.get("pins", {}).items()}
    mine.update({REPORT_DIR + k: v for k, v in tables.get("rpins", {}).items()})
    theirs = {d["integration_path"]: d["sha256"] for d in data["dependencies"]}
    out = [p for p in sorted(set(mine) | set(theirs)) if mine.get(p) != theirs.get(p)]
    for name, key in [("zod", "schema_zod"), ("typescript", "build_typescript")]:
        if versions.get(name) != data[key]:
            out.append(name)
    if node_versions != {"v" + data["runtime_node"]}:
        out.append("node")
    return out


class HarnessPinTests(unittest.TestCase):
    def test_harness_pins_match_contract(self):
        self.assertEqual(pin_mismatches(HARNESS, CONTRACT), [])

    def test_crosscheck_sees_drift_in_either_place(self):
        data = json.loads(CONTRACT.read_text())
        entry = next(d for d in data["dependencies"] if d["integration_path"] == "server/" + R01)
        r01_hash = entry["sha256"]
        with tempfile.TemporaryDirectory() as temp:
            bad_harness = Path(temp) / "harness.py"
            bad_harness.write_text(HARNESS.read_text().replace(r01_hash, ZERO))
            self.assertEqual(pin_mismatches(bad_harness, CONTRACT), ["server/" + R01])
            entry["sha256"] = ZERO
            bad_contract = Path(temp) / "contract.json"
            bad_contract.write_text(json.dumps(data))
            self.assertEqual(pin_mismatches(HARNESS, bad_contract), ["server/" + R01])
            data["dependencies"].pop()
            bad_contract.write_text(json.dumps(data))
            self.assertEqual(len(pin_mismatches(HARNESS, bad_contract)), 2)

    def test_harness_has_no_bare_assert(self):
        tree = ast.parse(HARNESS.read_text())
        self.assertEqual([n.lineno for n in ast.walk(tree) if isinstance(n, ast.Assert)], [])

    def test_pin_mismatch_fails_closed_with_and_without_python_O(self):
        with tempfile.TemporaryDirectory() as temp:
            (Path(temp) / "src").mkdir()
            for name in ["kr-daily-raw-evidence.ts", "exact-instant.ts", "r01-kis-field-parsers.ts"]:
                shutil.copy2(ROOT / "server/src" / name, Path(temp) / "src" / name)
            with (Path(temp) / R01).open("a") as handle:
                handle.write("// tampered\n")
            for flags in ([], ["-O"]):
                done = subprocess.run(
                    [sys.executable, *flags, str(HARNESS), "--baseline", temp, "--node", sys.executable],
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                self.assertNotEqual(done.returncode, 0, flags)
                self.assertIn(R01, done.stderr, flags)


if __name__ == "__main__":
    unittest.main()

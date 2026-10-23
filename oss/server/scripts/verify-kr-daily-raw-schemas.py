"""Offline JSON Schema fixture verification. Runtime semantic verification remains mandatory."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
root = Path(__file__).resolve().parent.parent
schemas = {name: json.loads((root / f'contracts/kr-daily-raw-evidence-{name}-v1.schema.json').read_text()) for name in ('request', 'input', 'result')}
for schema in schemas.values():
    Draft202012Validator.check_schema(schema)
count = 0
for name in ('mixed-order', 'empty-success'):
    q = json.loads((root / f'fixtures/kr-daily-raw/{name}.input.json').read_text())
    dto = json.loads((root / f'fixtures/kr-daily-raw/{name}.evidence.json').read_text())
    for kind, value in (('request', q['request']), ('input', q), ('result', dto)):
        Draft202012Validator(schemas[kind], format_checker=FormatChecker()).validate(value)
        count += 1
print(json.dumps({'status': 'passed', 'schema_fixture_validations': count, 'runtime_reconstruction_still_required': True}))

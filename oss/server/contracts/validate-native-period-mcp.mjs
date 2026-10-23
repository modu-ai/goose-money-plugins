import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
const validator = new AjvJsonSchemaValidator(); let assertions = 0;
for (const [op, name] of [['072', 'domestic'], ['264', 'global']]) {
 const schema = JSON.parse(readFileSync(new URL(`mcp-get-${name}-index-period-history.input.schema.json`, import.meta.url), 'utf8'));
 const validate = validator.getValidator(schema);
 for (const period of ['W', 'M', 'Y']) {
  const f = JSON.parse(readFileSync(new URL(`../fixtures/benchmark-period/kis${op}-${period}-synthetic.json`, import.meta.url), 'utf8'));
  const input = { request: f.input.request, cutoff: f.input.cutoff };
  assert.equal(validate(input).valid, true); assertions++;
  assert.equal(validate({ ...input, origin: 'actual' }).valid, false); assertions++;
  assert.equal(validate({ ...input, request: { ...input.request, period_code: 'D' } }).valid, false); assertions++;
 }
}
console.log(JSON.stringify({ status: 'passed', schema_period_combinations: 6, assertions, source_authenticated: false, actual_calls: 0 }));

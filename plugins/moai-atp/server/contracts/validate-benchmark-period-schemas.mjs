import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
const validator = new AjvJsonSchemaValidator();
for (const op of ['072', '264']) for (const period of ['W', 'M', 'Y']) {
 const f = JSON.parse(readFileSync(new URL(`../fixtures/benchmark-period/kis${op}-${period}-synthetic.json`, import.meta.url), 'utf8'));
 for (const kind of ['request', 'input', 'result']) {
  const schema = JSON.parse(readFileSync(new URL(`./kis${op}-period-${kind}-v1.schema.json`, import.meta.url), 'utf8'));
  const validate = validator.getValidator(schema), value = kind === 'input' ? f.input : kind === 'request' ? f.input.request : f.expected;
  assert.equal(validate(value).valid, true); assert.equal(validate({ ...value, undeclared: true }).valid, false);
  const wrong = structuredClone(value); (kind === 'request' ? wrong : wrong.request).period_code = 'D'; assert.equal(validate(wrong).valid, false);
  console.log(`KIS-${op} ${period} ${kind}: positive / extra-key / D rejection passed`);
 }
}

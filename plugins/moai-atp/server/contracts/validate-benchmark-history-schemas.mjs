import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
const validator = new AjvJsonSchemaValidator();
for (const op of ['072', '264']) {
  const fixture = JSON.parse(readFileSync(new URL(`../fixtures/benchmark-history/kis${op}-synthetic.json`, import.meta.url), 'utf8'));
  for (const kind of ['input', 'result']) {
    const schema = JSON.parse(readFileSync(new URL(`./kis${op}-history-${kind}-v1.schema.json`, import.meta.url), 'utf8'));
    const validate = validator.getValidator(schema), value = kind === 'input' ? fixture.input : fixture.expected;
    const good = validate(value); assert.equal(good.valid, true, JSON.stringify(good));
    const bad = validate({ ...value, undeclared: true }); assert.equal(bad.valid, false);
    console.log(`KIS-${op} ${kind} positive and strict-extra negative: pass`);
  }
}

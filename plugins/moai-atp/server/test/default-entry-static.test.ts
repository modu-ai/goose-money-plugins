// SPEC-ATP-AUTH-001 AC-009 "And (static)" (card t13, M3): every test source that launches the default
// entry point passes an explicit hermetic env, and none inherits the parent env or sets a read switch.
//
// The acceptance form is a pair of grep counts per file; this test computes the same two counts on
// the files that name the default entry point (acceptance.md AC-009 static). Search tokens are
// assembled from pieces so this file does not itself match the patterns it looks for.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// dist/test/<this file>.js -> plugins/moai-atp/server/test/ (the TypeScript sources)
const testSourceDir = fileURLToPath(new URL('../../test/', import.meta.url));
const ENTRY_TOKEN = 'src/' + 'main.js';
const SPAWN_TOKEN = 'spawn(' + 'process.execPath';
const SPAWN_WITH_ENV = new RegExp('spawn\\(process\\.execPath, \\[[^\\]]*\\], \\{[^}]*env:');
const READ_SWITCH = new RegExp('GOOSE_[A-Z_]*_READ_' + 'ENABLED');
const INHERITED_ENV = new RegExp('env:\\s*process\\.env|\\.\\.\\.process\\.env|env:\\s*undefined');

function testSources(): Array<{ name: string; lines: string[] }> {
  const names = readdirSync(testSourceDir, { recursive: true }).map(String).filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts')).sort();
  assert.ok(names.length > 50, 'the TypeScript test sources were not found next to dist');
  return names.map((name) => ({ name, lines: readFileSync(new URL(name, new URL('../../test/', import.meta.url)), 'utf8').split('\n') }));
}

const launchers = () => testSources().filter(({ lines }) => lines.some((line) => line.includes(ENTRY_TOKEN)));

test('AC-009 static: every spawn in a default-entry test names an explicit env built by hermeticChildEnv', () => {
  const files = launchers();
  const names = files.map((file) => file.name);
  assert.ok(names.includes('stdio.integration.test.ts'), 'stdio.integration.test.ts must be among the default-entry tests');
  assert.ok(names.includes('default-entry-ac009.test.ts'), 'default-entry-ac009.test.ts must be among the default-entry tests');
  let spawns = 0;
  for (const { name, lines } of files) {
    const all = lines.filter((line) => line.includes(SPAWN_TOKEN));
    const withEnv = all.filter((line) => SPAWN_WITH_ENV.test(line));
    assert.equal(withEnv.length, all.length, `${name}: ${all.length} spawn calls but ${withEnv.length} name an env`);
    for (const line of all) assert.match(line, /env: hermeticChildEnv\(/, `${name}: a spawn does not take its env from hermeticChildEnv: ${line.trim()}`);
    spawns += all.length;
  }
  assert.ok(spawns >= 4, `expected at least 4 spawn calls across the default-entry tests, found ${spawns} (an empty scan would pass vacuously)`);
});

test('AC-009 static: no spawn in a default-entry test inherits the parent env or sets a read switch', () => {
  for (const { name, lines } of launchers()) {
    lines.forEach((line, index) => {
      const where = `${name}:${index + 1}`;
      if (line.includes(SPAWN_TOKEN)) {
        assert.doesNotMatch(line, INHERITED_ENV, `${where}: spawn inherits the parent env`);
        assert.doesNotMatch(line, READ_SWITCH, `${where}: spawn sets a read switch for the child`);
      }
      assert.doesNotMatch(line, INHERITED_ENV, `${where}: the parent env is passed along`);
    });
  }
});

test('AC-009 static: the helper code names no read switch or provider key variable and takes only PATH from the parent by name', () => {
  const helper = testSources().find((file) => file.name === 'default-entry-env.ts');
  assert.ok(helper, 'default-entry-env.ts is missing');
  // Code only: comment lines may name the variables the helper drops.
  const text = helper.lines.filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line)).join('\n');
  assert.doesNotMatch(text, READ_SWITCH);
  assert.doesNotMatch(text, /KIS_APP_|OPENDART_API_KEY/);
  assert.doesNotMatch(text, /\.\.\.\s*(parent|process\.env|options\.parentEnv)/, 'the helper must not spread the parent env into the child env');
  // Parent env is read for PATH and SystemRoot only.
  const reads = [...text.matchAll(/\bparent\.(\w+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(reads)].sort(), ['PATH']);
});

// Issue #10: disposition of the three member modules after the #1 product decision (MoAI-AI sign-in is required
// for every tier, not implemented in this build). The modules are kept for reuse, stay unwired, and each one says
// so in a status header that points at the design contract and at what must change before it is wired again.
// The tests only read files under plugins/moai-atp/; nothing is executed and no network, HOME or key is touched.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// dist/test/<this file>.js -> plugins/moai-atp/ is three levels up.
const ossDir = fileURLToPath(new URL('../../../', import.meta.url));
const srcDir = join(ossDir, 'server', 'src');
const MEMBER_MODULES = ['member-access', 'member-onboarding', 'member-token-verifier'] as const;
const STATUS_HEADER = 'Status (issue #10)';
const CONTRACT = 'docs/design/identity-auth-contract.md';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).sort().flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : name.endsWith('.ts') ? [path] : [];
  });
}
const relative = (path: string): string => path.slice(srcDir.length + 1).split('\\').join('/');
const memberImport = new RegExp(`from\\s+['"][^'"]*(${MEMBER_MODULES.join('|')})\\.js['"]`);

test('#10: no source file outside the member modules imports one (kept, not wired)', () => {
  const files = sourceFiles(srcDir);
  assert.ok(files.some((path) => relative(path) === 'server.ts'), 'the scan reaches server.ts, so an empty result is not vacuous');
  const importers = files
    .filter((path) => !MEMBER_MODULES.some((name) => relative(path) === `${name}.ts`))
    .filter((path) => memberImport.test(readFileSync(path, 'utf8')))
    .map(relative);
  assert.deepEqual(importers, [], 'wiring a member module is a separate change (#6/#7); update this test and CAPABILITIES with it');
});

test('#10: each member module opens with a status header that names the design contract', () => {
  for (const name of MEMBER_MODULES) {
    const head = readFileSync(join(srcDir, `${name}.ts`), 'utf8').split(/\r?\n/).slice(0, 8).join('\n');
    assert.ok(head.includes(STATUS_HEADER), `${name}.ts carries "${STATUS_HEADER}" in its first lines`);
    assert.ok(head.includes(CONTRACT), `${name}.ts points at ${CONTRACT}`);
  }
});

test('#10: member-access.ts records that its both-providers readiness gate must be split before reuse', () => {
  const head = readFileSync(join(srcDir, 'member-access.ts'), 'utf8').split(/\r?\n/).slice(0, 8).join('\n');
  assert.match(head, /not reusable as-is/);
  assert.match(head, /both KIS and OpenDART/);
});

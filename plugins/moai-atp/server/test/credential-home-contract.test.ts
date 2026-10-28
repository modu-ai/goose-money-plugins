// SPEC-ATP-WINTEST-001 (card t30) contract of ./credential-home.ts, checked through explicit platform arguments only.
//
// Every test name carries the label `explicit-platform-arg`. These checks run on whatever host executes them and
// pass `win32` as an argument to the helper's branch decision and preparation functions. That is a check of the
// helper's own logic and is not Windows evidence: the host platform is never redefined, no store function is
// called here, and no other test file is imported. Every helper call hands in an output function that only
// collects the `[t30-branch]` line, so this file writes no such line to standard output.
import assert from 'node:assert/strict';
import { access, readdir, rm } from 'node:fs/promises';
import { basename } from 'node:path';
import test, { after } from 'node:test';

const recorder = await import('./fetch-recorder.js');
const helper = await import('./credential-home.js');
after(() => recorder.restoreOriginalFetch());

type Kind = import('./credential-home.js').Kind;
type Branch = import('./credential-home.js').Branch;
type PreparedHome = import('./credential-home.js').PreparedHome;
const { BRANCH, ALL_KINDS, branchFor, branchLine, prepareHome } = helper;

const EXPECTED: Record<'darwin' | 'win32', Record<Kind, Branch>> = {
  darwin: { both: BRANCH.fileStore, kis: BRANCH.fileStore, dart: BRANCH.fileStore, synthetic: BRANCH.fileStore, none: BRANCH.fileStore, corrupt: BRANCH.fileStore, unsafe: BRANCH.fileStore, 'key-store': BRANCH.fileStore, 'profile-store': BRANCH.fileStore },
  win32: { both: BRANCH.envCredential, kis: BRANCH.envCredential, dart: BRANCH.envCredential, synthetic: BRANCH.envCredential, none: BRANCH.failClosed, corrupt: BRANCH.failClosed, unsafe: BRANCH.failClosed, 'key-store': BRANCH.failClosed, 'profile-store': BRANCH.failClosed },
};
const KIS_NAMES = ['KIS_APP_KEY', 'KIS_APP_SECRET'] as const;
const DART_NAME = 'OPENDART_API_KEY';

const collector = () => { const lines: string[] = []; return { lines, output: (line: string) => { lines.push(line); } }; };
const values = (env: NodeJS.ProcessEnv): string[] => Object.values(env).filter((v): v is string => typeof v === 'string');

/** Prepares, runs `check`, then removes the home and shows it is gone. */
async function withPrepared(kind: Parameters<typeof prepareHome>[0], options: Omit<NonNullable<Parameters<typeof prepareHome>[1]>, 'output'>, check: (prepared: PreparedHome, lines: string[]) => Promise<void>): Promise<void> {
  const { lines, output } = collector();
  const prepared = await prepareHome(kind, { ...options, output });
  try { await check(prepared, lines); }
  finally { await rm(prepared.home, { recursive: true, force: true }); }
  await assert.rejects(access(prepared.home), { code: 'ENOENT' });
}

test('explicit-platform-arg the nine kinds are exactly the rows of the 18-cell table (not Windows evidence)', () => {
  assert.deepEqual([...ALL_KINDS].sort(), Object.keys(EXPECTED.darwin).sort());
  assert.deepEqual(Object.keys(EXPECTED.win32).sort(), Object.keys(EXPECTED.darwin).sort());
});

for (const platform of ['darwin', 'win32'] as const) {
  test(`explicit-platform-arg branchFor gives each of the 9 kinds exactly the specified branch on ${platform} (not Windows evidence)`, () => {
    for (const kind of ALL_KINDS) assert.equal(branchFor(kind, { platform }), EXPECTED[platform][kind], `${platform} ${kind}`);
  });
}

test('explicit-platform-arg branchLine has the exact branch-line shape (not Windows evidence)', () => {
  assert.equal(branchLine(BRANCH.envCredential, 'both'), '[t30-branch] env-credential kind=both');
  assert.equal(branchLine(BRANCH.failClosed, 'key-store'), '[t30-branch] fail-closed-assertion kind=key-store');
});

for (const kind of ['both', 'kis', 'dart', 'synthetic'] as const) {
  test(`explicit-platform-arg win32 ${kind}: env-credential branch, empty home, synthetic env only for its providers, one line (not Windows evidence)`, () => withPrepared(kind, { platform: 'win32' }, async (prepared, lines) => {
    assert.equal(prepared.branch, BRANCH.envCredential);
    assert.equal(prepared.kind, kind);
    assert.equal(typeof prepared.env, 'object');
    assert.notEqual(prepared.env, null);
    const wantsKis = kind !== 'dart', wantsDart = kind !== 'kis';
    for (const name of KIS_NAMES) {
      assert.equal(Object.hasOwn(prepared.env, name), wantsKis, `${kind} ${name}`);
      if (wantsKis) assert.ok(String(prepared.env[name]).length > 0, `${name} is a non-empty synthetic value`);
    }
    assert.equal(Object.hasOwn(prepared.env, DART_NAME), wantsDart, `${kind} ${DART_NAME}`);
    if (wantsDart) assert.equal(String(prepared.env[DART_NAME]).length, 40, 'the OpenDART key schema requires 40 characters');
    assert.deepEqual(await readdir(prepared.home), [], 'the env-credential home holds zero entries');
    assert.deepEqual(lines, [`[t30-branch] env-credential kind=${kind}`]);
    const line = lines[0] ?? '';
    for (const value of values(prepared.env)) assert.ok(!line.includes(value), 'the line carries no credential value');
    assert.ok(!line.includes(prepared.home) && !line.includes(basename(prepared.home)), 'the line carries no path and no home name');
  }));
}

test('explicit-platform-arg win32 both with a case-supplied KIS_APP_KEY: the case value wins, no KIS_APP_SECRET is added, OpenDART stays synthetic (not Windows evidence)', () => withPrepared('both', { platform: 'win32', env: { KIS_APP_KEY: 'case-supplied-key' } }, async (prepared) => {
  assert.equal(prepared.branch, BRANCH.envCredential);
  assert.equal(prepared.env.KIS_APP_KEY, 'case-supplied-key');
  assert.equal(Object.hasOwn(prepared.env, 'KIS_APP_SECRET'), false);
  assert.equal(String(prepared.env[DART_NAME]).length, 40);
}));

test('explicit-platform-arg win32 both with a case-supplied OPENDART_API_KEY: the case value wins and the KIS pair stays synthetic (not Windows evidence)', () => withPrepared('both', { platform: 'win32', env: { OPENDART_API_KEY: 'case-supplied-dart' } }, async (prepared) => {
  assert.equal(prepared.env[DART_NAME], 'case-supplied-dart');
  for (const name of KIS_NAMES) assert.ok(String(prepared.env[name]).length > 0, name);
}));

test('explicit-platform-arg win32 both with an empty-string case variable still counts as supplied (not Windows evidence)', () => withPrepared('both', { platform: 'win32', env: { KIS_APP_KEY: '', KIS_APP_SECRET: '' } }, async (prepared) => {
  assert.equal(prepared.env.KIS_APP_KEY, '');
  assert.equal(prepared.env.KIS_APP_SECRET, '');
}));

for (const kind of ['none', 'corrupt', 'unsafe'] as const) {
  test(`explicit-platform-arg win32 ${kind}: fail-closed-assertion branch, the baseline home, one line (not Windows evidence)`, () => withPrepared(kind, { platform: 'win32', env: { SOME_CASE_VARIABLE: 'x' } }, async (prepared, lines) => {
    assert.equal(prepared.branch, BRANCH.failClosed);
    assert.deepEqual(prepared.env, { SOME_CASE_VARIABLE: 'x' }, 'a fail-closed case keeps exactly the environment it supplied');
    const entries = await readdir(prepared.home);
    assert.deepEqual(entries, kind === 'none' ? [] : ['.goose'], 'none is empty; corrupt and unsafe are the hand-built baseline keystore');
    assert.deepEqual(lines, [`[t30-branch] fail-closed-assertion kind=${kind}`]);
  }));
}

test('explicit-platform-arg darwin none: file-store branch, empty home, the case environment kept, no line at all (not Windows evidence)', () => withPrepared('none', { platform: 'darwin', env: { SOME_CASE_VARIABLE: 'x' } }, async (prepared, lines) => {
  assert.equal(prepared.branch, BRANCH.fileStore);
  assert.deepEqual(prepared.env, { SOME_CASE_VARIABLE: 'x' });
  assert.deepEqual(await readdir(prepared.home), []);
  assert.deepEqual(lines, []);
}));

test('explicit-platform-arg a prepared env is a copy: changing it does not change the case environment (not Windows evidence)', async () => {
  const caseEnv: NodeJS.ProcessEnv = { SOME_CASE_VARIABLE: 'x' };
  await withPrepared('none', { platform: 'darwin', env: caseEnv }, async (prepared) => {
    prepared.env.ANOTHER = 'y';
    assert.deepEqual(caseEnv, { SOME_CASE_VARIABLE: 'x' });
  });
});

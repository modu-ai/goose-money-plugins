// SPEC-ATP-WINTEST-001 (card t30, REQ-WIN-006 and REQ-WIN-007): run-time characterization of the two Windows
// fail-closed guards, src/local-credentials.ts (secure_file_storage_unsupported) and src/user-context.ts
// (context_unsafe_path).
//
// Characterization, not RED: the guards already exist, so these tests pass the moment they are written.
//
// What each test observes depends on the HOST platform, decided by the shared helper (never read here):
//   on a Windows host   each of the eight functions rejects with the exact platform code, never reaches its input
//                       function, and leaves no .goose entry in the mkdtemp home. This is observable only on a real
//                       Windows host and has not been observed (Gap, see WINDOWS-TEST-STATUS.md).
//   on macOS            the same declaration asserts the symmetric non-platform result on an empty mkdtemp home, so
//                       the test ends in an assertion on both platforms. That result says nothing about Windows.
//
// Every call passes an explicit mkdtemp `project` and `home` (and, where the function reads an environment, an
// explicit empty one), so no call can fall back to the working directory, the user's home or the ambient
// environment and a real Windows host's real keys or home can never be read. This file prepares its own
// directories and writes no branch line.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadLocalCredentials, resolveProviderCredentials, saveLocalCredentials, SafeCredentialError } from '../src/local-credentials.js';
import { runCredentialSetupFlow } from '../src/credential-setup.js';
import { deleteInvestorContext, readInvestorContext, saveInvestorContext, UserContextError, type InvestorContextAnswers } from '../src/user-context.js';
import { runSetupFlow } from '../src/setup-cli.js';
import { BRANCH, branchFor } from './credential-home.js';

const keyStoreBlocksHost = branchFor('key-store') === BRANCH.failClosed;
const profileStoreBlocksHost = branchFor('profile-store') === BRANCH.failClosed;

const SYNTHETIC_PATCH = { kis: { appKey: 'synthetic-key', appSecret: 'synthetic-secret' } };
const SYNTHETIC_ANSWERS: InvestorContextAnswers = { objectives: ['learning'], timeHorizon: 'unspecified', experience: 'new', riskTolerance: 'unspecified', riskCapacity: 'unspecified', liquidityNeed: 'unspecified', assetScope: ['domestic_equity'] };

const platformKeyError = (error: unknown): boolean => error instanceof SafeCredentialError && error.code === 'secure_file_storage_unsupported';
const platformProfileError = (error: unknown): boolean => error instanceof UserContextError && error.code === 'context_unsafe_path';
const sink = { write(value: string): void { void value; } };

/** Fresh mkdtemp project and home (separate directories, home never inside project), removed afterwards. */
async function inDirectories(run: (project: string, home: string) => Promise<void>): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), 'atp-t30-failclosed-'));
  const home = join(base, 'home'), project = join(base, 'project');
  await mkdir(home, { mode: 0o700 }); await mkdir(project, { mode: 0o700 });
  try { await run(project, home); } finally { await rm(base, { recursive: true, force: true }); }
}
const assertNoGoose = async (home: string): Promise<void> => assert.equal((await readdir(home)).includes('.goose'), false, 'the rejected home gained no .goose entry');

test('key store: loadLocalCredentials rejects with secure_file_storage_unsupported on a blocked host and returns no document elsewhere', () => inDirectories(async (project, home) => {
  if (keyStoreBlocksHost) { await assert.rejects(loadLocalCredentials(project, home), platformKeyError); await assertNoGoose(home); }
  else assert.equal(await loadLocalCredentials(project, home), undefined);
}));

test('key store: saveLocalCredentials with confirmed true and a valid synthetic patch rejects with secure_file_storage_unsupported on a blocked host and saves elsewhere', () => inDirectories(async (project, home) => {
  if (keyStoreBlocksHost) { await assert.rejects(saveLocalCredentials(SYNTHETIC_PATCH, project, { confirmed: true, homeDir: home }), platformKeyError); await assertNoGoose(home); }
  else await assert.doesNotReject(saveLocalCredentials(SYNTHETIC_PATCH, project, { confirmed: true, homeDir: home }));
}));

test('key store: resolveProviderCredentials with an explicit empty env rejects with secure_file_storage_unsupported on a blocked host and with credential_missing elsewhere', () => inDirectories(async (project, home) => {
  if (keyStoreBlocksHost) { await assert.rejects(resolveProviderCredentials('kis', { projectRoot: project, homeDir: home, env: {} }), platformKeyError); await assertNoGoose(home); }
  else await assert.rejects(resolveProviderCredentials('kis', { projectRoot: project, homeDir: home, env: {} }), (error: unknown) => error instanceof SafeCredentialError && error.code === 'credential_missing');
}));

test('key store: runCredentialSetupFlow after a YES start answer rejects with secure_file_storage_unsupported before any hidden input on a blocked host and reaches the first hidden prompt elsewhere', () => inDirectories(async (project, home) => {
  let hiddenCalls = 0;
  const hidden = async (): Promise<string> => { hiddenCalls += 1; throw new Error('setup_cancelled'); };
  if (keyStoreBlocksHost) {
    await assert.rejects(runCredentialSetupFlow(project, async () => 'YES', hidden, sink, home), platformKeyError);
    assert.equal(hiddenCalls, 0, 'the hidden-input function was never called');
    await assertNoGoose(home);
  } else {
    await assert.rejects(runCredentialSetupFlow(project, async () => 'YES', hidden, sink, home), /setup_cancelled/);
    assert.equal(hiddenCalls, 1, 'the flow reached its first hidden prompt');
  }
}));

test('profile store: readInvestorContext rejects with context_unsafe_path on a blocked host and returns no profile elsewhere', () => inDirectories(async (project, home) => {
  if (profileStoreBlocksHost) { await assert.rejects(readInvestorContext(project, home), platformProfileError); await assertNoGoose(home); }
  else assert.equal(await readInvestorContext(project, home), undefined);
}));

test('profile store: saveInvestorContext with confirmed true and valid synthetic answers rejects with context_unsafe_path on a blocked host and saves revision 1 elsewhere', () => inDirectories(async (project, home) => {
  if (profileStoreBlocksHost) { await assert.rejects(saveInvestorContext(SYNTHETIC_ANSWERS, project, { confirmed: true, homeDir: home }), platformProfileError); await assertNoGoose(home); }
  else assert.equal((await saveInvestorContext(SYNTHETIC_ANSWERS, project, { confirmed: true, homeDir: home })).revision, 1);
}));

test('profile store: deleteInvestorContext with confirmed true rejects with context_unsafe_path on a blocked host and reports nothing to delete elsewhere', () => inDirectories(async (project, home) => {
  if (profileStoreBlocksHost) { await assert.rejects(deleteInvestorContext(project, { confirmed: true, homeDir: home }), platformProfileError); await assertNoGoose(home); }
  else assert.equal(await deleteInvestorContext(project, { confirmed: true, homeDir: home }), false);
}));

test('profile store: runSetupFlow rejects with context_unsafe_path at its first profile read, before any question, on a blocked host and asks its one question elsewhere', () => inDirectories(async (project, home) => {
  let questions = 0;
  const ask = async (): Promise<string> => { questions += 1; return 'NO'; };
  if (profileStoreBlocksHost) {
    await assert.rejects(runSetupFlow(project, ask, sink, home), platformProfileError);
    assert.equal(questions, 0, 'the question function was never called');
    await assertNoGoose(home);
  } else {
    assert.equal(await runSetupFlow(project, ask, sink, home), 0);
    assert.equal(questions, 1, 'the declined interview start was the one question');
  }
}));

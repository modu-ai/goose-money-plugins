// SPEC-ATP-WINTEST-001 (card t30): the one shared test helper that decides which credential branch a case runs on.
//
// Three branches, and every (platform, kind) pair maps to exactly one of them:
//   file-store            darwin, every kind. The baseline helpers run unchanged (REQ-WIN-002); nothing is written.
//   env-credential        win32, kinds both / kis / dart / synthetic. An empty mkdtemp home plus complete synthetic
//                         provider values in an explicit env object that is handed to the server under test; the
//                         values are fake, are never copied into the process environment and are never printed.
//   fail-closed-assertion win32, kinds none / corrupt / unsafe / key-store / profile-store. The home is the baseline
//                         one (hand-built files, no store call) and the case ends in an assertion that the store
//                         rejects it with the platform code.
// Test files never read the platform: they call this module and, where they need a verdict, the assert function.
//
// Honesty: the branch decision and the preparation accept an explicit platform argument so the contract test can
// check them on any host. That is a check of this module's logic and is not Windows evidence. The verdict function
// and the direct-store entry point decide by the host platform only, so the store's own rejection is observable
// only on a real Windows host (Gap, test/WINDOWS-TEST-STATUS.md). Nothing here redefines the host platform.
//
// Store calls in this file always pass an explicit mkdtemp `project` and `home`; no call can fall back to the
// working directory, the user's home directory or the ambient environment.
//
// This module is a helper, not a test (its name has no `.test.`). The baseline scenario and harness modules are
// loaded lazily, so importing this file does not load them before a test has installed the fetch recorder. It does
// import two store modules statically (../src/local-credentials.js and ../src/user-context.js); neither file mentions fetch
// (checked with a text search), so loading them ahead of the recorder does not bypass it. The direct file-store test groups use storeTestFor and
// registerBlockedHostRejectionTest (end of file): skipped with a reason on a blocked host, unchanged elsewhere.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLocalCredentials, SafeCredentialError } from '../src/local-credentials.js';
import { readInvestorContext, UserContextError } from '../src/user-context.js';
import type { HomeKind } from './auth002-m2-scenarios.js';

export type Platform = NodeJS.Platform;

/** The three branch names. They are the same string in code, in the `[t30-branch]` line and in the status document. */
export const BRANCH = {
  fileStore: 'file-store',
  envCredential: 'env-credential',
  failClosed: 'fail-closed-assertion',
} as const;
export type Branch = (typeof BRANCH)[keyof typeof BRANCH];

/** Kinds the helper prepares a home for: the six home kinds of the m2 scenarios and the `makeSyntheticHome` cases. */
export type PreparedKind = HomeKind | 'synthetic';
/** Kinds of the direct file-store tests (REQ-WIN-013). */
export type StoreKind = 'key-store' | 'profile-store';
export type Kind = PreparedKind | StoreKind;

/** All nine kinds, in the order the 18-cell assignment table is read. */
export const ALL_KINDS: readonly Kind[] = ['both', 'kis', 'dart', 'synthetic', 'none', 'corrupt', 'unsafe', 'key-store', 'profile-store'];

/** Receives one `[t30-branch]` line (without the newline). */
export type OutputFn = (line: string) => void;

export interface ExplicitPlatform { platform?: Platform | undefined }
export interface PrepareOptions extends ExplicitPlatform {
  /** The environment the case supplies; an empty object when omitted. */
  env?: NodeJS.ProcessEnv | undefined;
  /** Where the `[t30-branch]` line goes; the default writes it to standard output. */
  output?: OutputFn | undefined;
}

export interface PreparedHome {
  readonly home: string;
  /** Always an object, never undefined. */
  readonly env: NodeJS.ProcessEnv;
  readonly branch: Branch;
  readonly kind: PreparedKind;
}

/** What a direct file-store test does after `enterStoreTest`. */
export const STORE_BODY = { run: 'run-body', notRun: 'body-not-run' } as const;
export type StoreBodyDecision = (typeof STORE_BODY)[keyof typeof STORE_BODY];

const ENV_KINDS: ReadonlySet<Kind> = new Set<Kind>(['both', 'kis', 'dart', 'synthetic']);
const KIS_VARIABLES = ['KIS_APP_KEY', 'KIS_APP_SECRET'] as const;
const DART_VARIABLES = ['OPENDART_API_KEY'] as const;

/**
 * The branch for a (platform, kind) pair; the platform defaults to the host. Only darwin and win32 are test
 * targets: any platform other than win32 takes the baseline file-store path.
 */
export function branchFor(kind: Kind, options: ExplicitPlatform = {}): Branch {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return BRANCH.fileStore;
  return ENV_KINDS.has(kind) ? BRANCH.envCredential : BRANCH.failClosed;
}

/** The exact `[t30-branch] <branch> kind=<kind>` line: no credential value, no path, no home name. */
export function branchLine(branch: Branch, kind: Kind): string {
  return `[t30-branch] ${branch} kind=${kind}`;
}

/** Default output function: one line on standard output. */
export const defaultOutput: OutputFn = (line) => { process.stdout.write(`${line}\n`); };

// The environment prepared for each home this module created, so a harness that is handed only the home path
// (createDefaultServer) can find the matching env. Entries are tiny and live as long as the process.
const preparedEnv = new Map<string, NodeJS.ProcessEnv>();

/** The environment the helper prepared for a home it created (an empty object for any other path). */
export function envForHome(home: string): NodeJS.ProcessEnv {
  return { ...(preparedEnv.get(home) ?? {}) };
}

/** The synthetic provider values for `kind`, leaving out every provider for which the case supplied a variable (REQ-WIN-004). */
function syntheticEnvironment(kind: PreparedKind, caseEnv: NodeJS.ProcessEnv, constants: { kis: { appKey: string; appSecret: string }; dartKey: string }): NodeJS.ProcessEnv {
  const supplied = (names: readonly string[]): boolean => names.some((name) => Object.hasOwn(caseEnv, name));
  const out: NodeJS.ProcessEnv = {};
  if (kind !== 'dart' && !supplied(KIS_VARIABLES)) { out.KIS_APP_KEY = constants.kis.appKey; out.KIS_APP_SECRET = constants.kis.appSecret; }
  if (kind !== 'kis' && !supplied(DART_VARIABLES)) out.OPENDART_API_KEY = constants.dartKey;
  return out;
}

/** Prepare a home and an environment for one case; writes the branch line when the branch is not `file-store`. */
export async function prepareHome(kind: PreparedKind, options: PrepareOptions = {}): Promise<PreparedHome> {
  const chosen = branchFor(kind, { platform: options.platform });
  const output = options.output ?? defaultOutput;
  const caseEnv = options.env ?? {};
  const scenarios = await import('./auth002-m2-scenarios.js');
  let home: string;
  let env: NodeJS.ProcessEnv = { ...caseEnv };
  if (chosen === BRANCH.envCredential) {
    home = await mkdtemp(join(tmpdir(), 'atp-t30-home-'));
    env = { ...syntheticEnvironment(kind, caseEnv, { kis: scenarios.SYNTHETIC_KIS, dartKey: scenarios.SYNTHETIC_DART_KEY }), ...caseEnv };
  } else if (kind === 'synthetic') {
    home = await (await import('./default-server-harness.js')).makeFileStoreSyntheticHome();
  } else {
    home = await scenarios.makeHome(kind);
  }
  if (chosen !== BRANCH.fileStore) output(branchLine(chosen, kind));
  preparedEnv.set(home, env);
  return { home, env, branch: chosen, kind };
}

const keyStoreRejection = (code: string) => (error: unknown): boolean => error instanceof SafeCredentialError && error.code === code;
const profileStoreRejection = (code: string) => (error: unknown): boolean => error instanceof UserContextError && error.code === code;

/**
 * The case's closing verdict on its prepared home, decided by the HOST platform's branch recorded at preparation.
 * Call it once, as the last step inside the case, before the harness removes the home.
 *   env-credential:        the home still holds zero entries (nothing was written to it).
 *   fail-closed-assertion: the key store rejects this home with secure_file_storage_unsupported (and, for kind none,
 *                          left no .goose entry). Observable only on a real Windows host.
 *   file-store:            for none / corrupt / unsafe, the store's own verdict (no document / credential_file_invalid /
 *                          credential_file_unsafe); no extra assertion for the key-file kinds.
 */
export async function assertStoreVerdict(prepared: PreparedHome): Promise<void> {
  const { home, kind } = prepared;
  const chosen = prepared.branch;
  if (chosen === BRANCH.envCredential) {
    assert.deepEqual(await readdir(home), [], `${kind}: the env-credential home holds zero entries`);
    return;
  }
  const project = await mkdtemp(join(tmpdir(), 'atp-t30-project-'));
  try {
    if (chosen === BRANCH.failClosed) {
      await assert.rejects(loadLocalCredentials(project, home), keyStoreRejection('secure_file_storage_unsupported'));
      if (kind === 'none') assert.equal((await readdir(home)).includes('.goose'), false, 'the rejected home gained no .goose entry');
    } else if (kind === 'none') {
      assert.equal(await loadLocalCredentials(project, home), undefined, 'an empty home holds no credential document');
    } else if (kind === 'corrupt') {
      await assert.rejects(loadLocalCredentials(project, home), keyStoreRejection('credential_file_invalid'));
    } else if (kind === 'unsafe') {
      await assert.rejects(loadLocalCredentials(project, home), keyStoreRejection('credential_file_unsafe'));
    }
  } finally { await rm(project, { recursive: true, force: true }); }
}

/**
 * Entry point of a direct file-store test (REQ-WIN-013). The host platform decides: on the file-store branch it
 * says the baseline body runs (and writes nothing); on the fail-closed branch it writes the branch line, asserts
 * that the store rejects this mkdtemp `project` and `home` with the platform code, asserts the home gained no
 * .goose entry, and says the body is not to run.
 */
export async function enterStoreTest(store: StoreKind, project: string, home: string, output: OutputFn = defaultOutput): Promise<StoreBodyDecision> {
  const chosen = branchFor(store);
  if (chosen === BRANCH.fileStore) return STORE_BODY.run;
  output(branchLine(chosen, store));
  if (store === 'key-store') await assert.rejects(loadLocalCredentials(project, home), keyStoreRejection('secure_file_storage_unsupported'));
  else await assert.rejects(readInvestorContext(project, home), profileStoreRejection('context_unsafe_path'));
  assert.equal((await readdir(home)).includes('.goose'), false, `${store}: the rejected home gained no .goose entry`);
  return STORE_BODY.notRun;
}

// ---- Gate for the direct file-store test groups (return-to-run fix) ------------------------------------------
// On a blocked host the baseline bodies of the direct file-store groups cannot run: the store rejects every call.
// Entering them and then passing on the rejection check would report their behavior as checked when it was not, so
// the gate registers each of them as skipped, with a reason, and registers ONE separately named test per group that
// checks only the store rejection. The decision takes an explicit platform argument (default: the host), so the
// contract test can check it on any host; that is a check of this logic and is not Windows evidence.

/** A test body as node:test accepts it, without the test-context parameter. */
export type TestBody = () => void | Promise<void>;
/** The part of node:test's `test` that the gate uses; the contract test hands in a recording stand-in. */
export interface RegisterTest {
  (name: string, body: TestBody): unknown;
  (name: string, options: { skip?: string | undefined }, body: TestBody): unknown;
}

const PLATFORM_CODE: Record<StoreKind, string> = { 'key-store': 'secure_file_storage_unsupported', 'profile-store': 'context_unsafe_path' };

/** The reason string a skipped direct-store test shows in the reporter. */
export function blockedHostSkipReason(store: StoreKind): string {
  return `${store} rejects every call on this host with ${PLATFORM_CODE[store]}; the original behavior of this test was not run (only the separately named fail-closed store rejection test ran)`;
}

/**
 * Returns the registration function for one direct-store test group: on a blocked host the test is registered
 * with a skip reason and its body is never run; otherwise it is registered unchanged, with the very same body.
 */
export function storeTestFor(register: RegisterTest, store: StoreKind, options: ExplicitPlatform = {}): (name: string, body: TestBody) => void {
  if (branchFor(store, options) === BRANCH.fileStore) return (name, body) => { register(name, body); };
  const reason = blockedHostSkipReason(store);
  return (name, body) => { register(name, { skip: reason }, body); };
}

/**
 * Registers the one separately named test that checks the store rejection of a skipped group, and returns whether
 * it registered (only on a blocked host). The test's body decides by the HOST platform (enterStoreTest), so its
 * result is a Windows result only when it is printed by a Windows host.
 */
export function registerBlockedHostRejectionTest(register: RegisterTest, store: StoreKind, file: string, options: ExplicitPlatform = {}): boolean {
  if (branchFor(store, options) === BRANCH.fileStore) return false;
  register(`fail-closed store rejection check, not the original behavior (${file}, ${store}): an mkdtemp project and home are rejected with ${PLATFORM_CODE[store]} and gain no .goose entry`, async () => {
    const base = await mkdtemp(join(tmpdir(), 'atp-t30-rejection-'));
    try {
      const home = join(base, 'home'), project = join(base, 'project');
      await mkdir(home, { mode: 0o700 }); await mkdir(project, { mode: 0o700 });
      assert.equal(await enterStoreTest(store, project, home), STORE_BODY.notRun, 'a blocked host does not run the baseline body');
    } finally { await rm(base, { recursive: true, force: true }); }
  });
  return true;
}

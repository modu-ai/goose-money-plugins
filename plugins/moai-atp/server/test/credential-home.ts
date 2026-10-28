// SPEC-ATP-WINTEST-001 (card t30): the one shared test helper that decides which credential branch a case runs on.
//
// RED skeleton (REQ-WIN-015, plan D8): every export of the contract is declared with its final type, and every
// body throws `not_implemented`. The contract tests in ./credential-home-contract.test.ts fail against it; the
// GREEN commit that follows implements the bodies.
//
// This module is a helper, not a test (its name has no `.test.`).
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
export const STORE_BODY = { run: 'run-body', skip: 'body-not-run' } as const;
export type StoreBodyDecision = (typeof STORE_BODY)[keyof typeof STORE_BODY];

function notImplemented(): never { throw new Error('not_implemented'); }

/** The branch for a (platform, kind) pair; the platform defaults to the host. */
export function branchFor(kind: Kind, options: ExplicitPlatform = {}): Branch { void kind; void options; return notImplemented(); }

/** The exact `[t30-branch] <branch> kind=<kind>` line. */
export function branchLine(branch: Branch, kind: Kind): string { void branch; void kind; return notImplemented(); }

/** Default output function: one line on standard output. */
export const defaultOutput: OutputFn = (line) => { void line; notImplemented(); };

/** Prepare a home and an environment for one case; writes the branch line when the branch is not `file-store`. */
export async function prepareHome(kind: PreparedKind, options: PrepareOptions = {}): Promise<PreparedHome> { void kind; void options; return notImplemented(); }

/** The environment the helper prepared for a home it created (an empty object for any other path). */
export function envForHome(home: string): NodeJS.ProcessEnv { void home; return notImplemented(); }

/** The case's closing verdict on its prepared home, decided by the host platform's branch. */
export async function assertStoreVerdict(prepared: PreparedHome): Promise<void> { void prepared; return notImplemented(); }

/** Entry point of a direct file-store test: on the fail-closed branch it asserts the rejection and says the body is not to run. */
export async function enterStoreTest(store: StoreKind, project: string, home: string, output: OutputFn = defaultOutput): Promise<StoreBodyDecision> { void store; void project; void home; void output; return notImplemented(); }

// SPEC-ATP-AUTH-001 M3 (card t13, REQ-TST-001 / AC-009): the ONE place that builds the environment
// of a child process that runs the default entry point. Every test that spawns it must take its
// env from hermeticChildEnv() and pass recorderImportArgs() so the child counts its own network
// attempts. Nothing here reads a credential, a read switch or the real profile.
//
// Allowed environment, by platform (plan.md M3, OS-neutral rule):
//   macOS   PATH, HOME=<mkdtemp dir>
//   Windows PATH, USERPROFILE=<mkdtemp dir>, HOME=<mkdtemp dir>, SystemRoot (copied; an OS location)
// Any other parent variable (GOOSE_*_READ_ENABLED, KIS_*, OPENDART_API_KEY, ...) is dropped.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Environment variable names the child may hold on the given platform; unsupported platforms fail closed. */
export function allowedEnvKeys(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'darwin') return ['PATH', 'HOME'];
  if (platform === 'win32') return ['PATH', 'USERPROFILE', 'HOME', 'SystemRoot'];
  throw new Error(`hermetic_env_unsupported_platform:${platform}`);
}

/** Variables that name the user's real profile in the parent, per platform. */
export function profileKeys(platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32' ? ['USERPROFILE', 'HOME'] : ['HOME'];
}

/**
 * Keys the runtime may add to a spawned child BEYOND hermeticChildEnv's explicit set, so the AC-009
 * child-env assertion can ignore exactly these: OS-required variables (macOS libSystem adds
 * __CF_USER_TEXT_ENCODING to every process; Windows libuv copies its required process variables,
 * src/win/process.c required_vars), and NODE_V8_COVERAGE — Node propagates that one into every child
 * when this process itself runs under V8 coverage (--experimental-test-coverage), even with an
 * explicit env (#160). NODE_V8_COVERAGE is admitted ONLY when the parent actually holds it; any
 * other key in a child env stays a leak and must fail the assertion.
 */
export function runtimeInjectedEnvKeys(platform: NodeJS.Platform = process.platform, parentEnv: NodeJS.ProcessEnv = process.env): string[] {
  const osKeys = platform === 'win32'
    ? ['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'TEMP', 'USERDOMAIN', 'USERNAME', 'WINDIR']
    : ['__CF_USER_TEXT_ENCODING'];
  return parentEnv.NODE_V8_COVERAGE === undefined ? osKeys : [...osKeys, 'NODE_V8_COVERAGE'];
}

const trimSeparator = (value: string): string => value.replace(/[\\/]+$/, '');

/**
 * Builds the explicit child environment. `profileDir` is the temporary profile directory the test
 * created with makeProfileDir(); it must not be the parent's own profile. The parent environment is
 * read only for PATH and, on Windows, SystemRoot.
 */
export function hermeticChildEnv(profileDir: string, options: { parentEnv?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {}): Record<string, string> {
  const parent = options.parentEnv ?? process.env;
  const platform = options.platform ?? process.platform;
  const keys = allowedEnvKeys(platform);
  if (profileDir.trim() === '') throw new Error('hermetic_env_profile_dir_missing');
  for (const key of profileKeys(platform)) {
    const parentValue = parent[key];
    if (parentValue !== undefined && parentValue !== '' && trimSeparator(parentValue) === trimSeparator(profileDir)) {
      throw new Error(`hermetic_env_profile_dir_is_parent_${key}`);
    }
  }
  const env: Record<string, string> = { PATH: parent.PATH ?? '' };
  if (platform === 'win32') {
    const systemRootKey = Object.keys(parent).find((key) => key.toLowerCase() === 'systemroot');
    const systemRoot = systemRootKey === undefined ? undefined : parent[systemRootKey];
    if (systemRoot === undefined || systemRoot === '') throw new Error('hermetic_env_systemroot_missing');
    env.USERPROFILE = profileDir;
    env.HOME = profileDir;
    env.SystemRoot = systemRoot;
  } else {
    env.HOME = profileDir;
  }
  assert.deepEqual(Object.keys(env).sort(), [...keys].sort(), 'the hermetic env must hold exactly the allowed key set');
  return env;
}

/** A fresh temporary profile directory (one per spawn). */
export async function makeProfileDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'atp-m3-profile-'));
}

export async function removeProfileDir(profileDir: string): Promise<void> {
  await rm(profileDir, { recursive: true, force: true });
}

// ---- fetch recorder as a child preload (the same module AC-001 uses inside the test process) ----

/** File URL of the compiled recorder module; a URL, not a path, so Windows drive letters survive `--import`. */
export const fetchRecorderModuleUrl: string = new URL('./fetch-recorder.js', import.meta.url).href;

/** Node arguments that install the recorder in the child before its entry point loads. */
export function recorderImportArgs(): string[] {
  return ['--import', fetchRecorderModuleUrl];
}

/** Every `moai_fetch_recorder_count=<n>` line the child wrote to stderr, in order. */
export function recorderCounts(stderr: string): number[] {
  return [...stderr.matchAll(/^moai_fetch_recorder_count=(\d+)\r?$/gm)].map((match) => Number(match[1]));
}

/**
 * Exactly one recorder line with the expected value. A missing line (no `--import`, or a child that
 * ended before its exit handler ran: SIGKILL, SIGTERM, abort) is a failure, never a zero.
 */
export function assertRecorderCount(stderr: string, expected: number, label = 'child'): void {
  const counts = recorderCounts(stderr);
  assert.equal(counts.length, 1, `${label}: expected exactly one moai_fetch_recorder_count line, found ${counts.length}`);
  assert.equal(counts[0], expected, `${label}: network attempts recorded by the child`);
}

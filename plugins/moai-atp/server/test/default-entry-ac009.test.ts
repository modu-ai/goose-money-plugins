// SPEC-ATP-AUTH-001 AC-009 (card t13, M3): tests that launch the default entry point are hermetic.
//
// The parent (this test process) carries synthetic read switches "1" and synthetic provider keys.
// The default entry point (dist/src/main.js) is started with the env built by default-entry-env.ts
// and the fetch recorder preloaded; the child must answer rights_pending / source_not_enabled and
// count zero network attempts. Nothing here uses a real key, the real HOME or a real API.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import readline from 'node:readline';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  allowedEnvKeys, assertRecorderCount, hermeticChildEnv, makeProfileDir, profileKeys, recorderCounts,
  recorderImportArgs, removeProfileDir,
} from './default-entry-env.js';

const entry = fileURLToPath(new URL('../src/main.js', import.meta.url));

// ---- the parent environment under test: synthetic values a leaky child could pick up ----

const nonce = randomBytes(8).toString('hex');
const PARENT_VALUES: Record<string, string> = {
  GOOSE_KIS_READ_ENABLED: '1',
  GOOSE_OPENDART_READ_ENABLED: '1',
  GOOSE_LOCAL_REPORT_VIEW_ENABLED: '1',
  KIS_APP_KEY: `synthetic-ac009-kis-key-${nonce}`,
  KIS_APP_SECRET: `synthetic-ac009-kis-secret-${nonce}`,
  OPENDART_API_KEY: `SYNTHETICAC009DART${nonce}`,
};
const SECRET_STRINGS = [PARENT_VALUES.KIS_APP_KEY!, PARENT_VALUES.KIS_APP_SECRET!, PARENT_VALUES.OPENDART_API_KEY!, nonce];
const saved: Record<string, string | undefined> = {};
before(() => {
  for (const [name, value] of Object.entries(PARENT_VALUES)) { saved[name] = process.env[name]; process.env[name] = value; }
});
after(() => {
  for (const name of Object.keys(PARENT_VALUES)) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
});

// ---- a small child driver ----

interface ChildRun {
  stdout: string;
  stderr: string;
  replies: Map<number, any>;
  profileDir: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

// SPEC-ATP-AUTH-002 M6 (load-sensitive wait, plan.md M6 bullet 2): the wait for a reply is event-based. It ends on the
// next stdout line, on the child's exit or on a child error; it no longer ends on a fixed 5 s timer, which failed with
// ac009_response_timeout when the machine was heavily loaded (the reply to `initialize` includes the child's start-up).
// STALL_GUARD_MS is only a backstop so that a child that stays alive and never answers cannot hang the whole suite; it is
// not the pass/fail criterion for a slow machine (the longest reply wait measured while the machine ran 256 extra node children at a load average of 427 was 8.4 s).
const STALL_GUARD_MS = 120_000;

function readJsonLine(reader: readline.Interface, child: ChildProcess, stallGuardMs = STALL_GUARD_MS): Promise<any> {
  return new Promise((resolve, reject) => {
    const done = (settle: () => void) => { clearTimeout(timer); reader.off('line', onLine); child.off('exit', onExit); child.off('error', onError); settle(); };
    const timer = setTimeout(() => done(() => reject(new Error('ac009_response_stalled'))), stallGuardMs);
    const onLine = (line: string) => done(() => { try { resolve(JSON.parse(line)); } catch { reject(new Error('ac009_invalid_json')); } });
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => done(() => reject(new Error(`ac009_child_exited_before_reply:${code ?? signal}`)));
    const onError = (error: Error) => done(() => reject(new Error(`ac009_child_error:${error.message}`)));
    reader.on('line', onLine);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

/** Runs node with the hermetic env; `rpc` requests (if any) are answered one at a time, then stdin is closed. */
async function runChild(argv: string[], rpc: Array<{ method: string; params: Record<string, unknown> }> = []): Promise<ChildRun> {
  const profileDir = await makeProfileDir();
  const child = spawn(process.execPath, [...argv], { env: hermeticChildEnv(profileDir), stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise<void>((resolve) => { child.once('close', () => resolve()); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => { child.once('exit', (code, signal) => resolve({ code, signal })); });
  const reader = readline.createInterface({ input: child.stdout });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const replies = new Map<number, any>();
  try {
    let id = 0;
    for (const request of rpc) {
      const n = ++id;
      const reply = readJsonLine(reader, child);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method: request.method, params: request.params })}\n`);
      replies.set(n, await reply);
      if (request.method === 'initialize') child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    }
  } finally {
    child.stdin.end();
    reader.close();
    await Promise.race([closed, new Promise<void>((resolve) => { setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5_000).unref(); })]);
    await removeProfileDir(profileDir);
  }
  const { code, signal } = await exited;
  return { stdout, stderr, replies, profileDir, exitCode: code, signal };
}

const initializeRequest = { method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ac009', version: '1' } } };
const inline = (code: string): string[] => ['--input-type=module', '-e', code];
const withRecorder = (argv: string[]): string[] => [...recorderImportArgs(), ...argv];

// ---- controls (declared first) ----

test('AC-009 control: the child-side recorder counts a direct fetch of a MoAI-AI address as 1', async () => {
  // The parent really holds the synthetic switches, so the zero below is not vacuous.
  assert.equal(process.env.GOOSE_KIS_READ_ENABLED, '1');
  assert.equal(process.env.KIS_APP_KEY, PARENT_VALUES.KIS_APP_KEY);
  const run = await runChild(withRecorder(inline("await globalThis.fetch('https://mo.ai.kr/telemetry').catch(() => {})")));
  assert.equal(run.exitCode, 0);
  assert.deepEqual(recorderCounts(run.stderr), [1]);
  assertRecorderCount(run.stderr, 1, 'control child');
});

test('AC-009 control: a child holds only the allowed variables and its profile is the mkdtemp dir, not the parent profile', async () => {
  const report = "const os = await import('node:os'); process.stdout.write(JSON.stringify({ keys: Object.keys(process.env).sort(), values: process.env, osHome: os.homedir() }))";
  const run = await runChild(inline(report));
  assert.equal(run.exitCode, 0);
  const seen = JSON.parse(run.stdout) as { keys: string[]; values: Record<string, string>; osHome: string };
  // macOS libSystem adds __CF_USER_TEXT_ENCODING to every process; it is not forwarded by the helper.
  // On Windows, Node's libuv copies its required process variables into every child env that lacks them
  // (libuv src/win/process.c required_vars); they are not forwarded by the helper either. The profile and
  // credential checks below still hold on every platform.
  const OS_INJECTED = process.platform === 'win32'
    ? ['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'TEMP', 'USERDOMAIN', 'USERNAME', 'WINDIR']
    : ['__CF_USER_TEXT_ENCODING'];
  const keys = seen.keys.filter((key) => !OS_INJECTED.includes(key));
  assert.deepEqual(keys, [...allowedEnvKeys()].sort());
  assert.deepEqual(keys.filter((key) => /^(GOOSE_|KIS_|OPENDART_)/.test(key)), []);
  for (const key of profileKeys()) {
    assert.equal(seen.values[key], run.profileDir, `${key} in the child is the temporary profile directory`);
    assert.notEqual(seen.values[key], process.env[key], `${key} in the child differs from the parent's ${key}`);
  }
  assert.equal(seen.osHome, run.profileDir, 'os.homedir() in the child resolves to the temporary profile');
  assert.notEqual(seen.osHome, homedir(), 'the child does not resolve the real profile');
});

// ---- the AC-009 behavior ----

test('AC-009: the default entry launched with the hermetic env ignores the parent read switches and keys and attempts no network request', async () => {
  const run = await runChild(withRecorder([entry]), [
    initializeRequest,
    { method: 'tools/call', params: { name: 'get_market_snapshot', arguments: { symbol: '000660', board: 'J' } } },
    { method: 'tools/call', params: { name: 'get_fundamentals', arguments: { corp_code: '00126380', bsns_year: '2025', reprt_code: '11012', fs_div: 'CFS' } } },
  ]);
  const kisOnly = run.replies.get(2);
  const dartOnly = run.replies.get(3);
  assert.equal(kisOnly?.result?.isError, true, JSON.stringify(kisOnly));
  assert.equal(kisOnly.result.content[0].text, 'error_code=rights_pending');
  assert.equal(dartOnly?.result?.isError, true, JSON.stringify(dartOnly));
  assert.equal(dartOnly.result.content[0].text, 'error_code=source_not_enabled');
  assert.equal(run.exitCode, 0, 'the child ends on its own when stdin closes');
  // Exactly one recorder line, and its value is 0. A missing line fails here instead of reading as zero.
  assertRecorderCount(run.stderr, 0, 'default entry');
  for (const secret of SECRET_STRINGS) {
    assert.equal(run.stdout.includes(secret), false, 'a synthetic key reached the child stdout');
    assert.equal(run.stderr.includes(secret), false, 'a synthetic key reached the child stderr');
  }
});

// ---- the helper itself (key sets, values, refusals) ----

test('AC-009: hermeticChildEnv drops every parent variable and builds the macOS and Windows key sets', () => {
  const parent: NodeJS.ProcessEnv = { ...PARENT_VALUES, PATH: '/parent/bin', HOME: '/Users/parent', USERPROFILE: 'C:\\Users\\parent', SYSTEMROOT: 'C:\\Windows', TOKEN_LIKE: 'x', ANTHROPIC_API_KEY: 'y' };
  const mac = hermeticChildEnv('/tmp/profile-mac', { parentEnv: parent, platform: 'darwin' });
  assert.deepEqual(mac, { PATH: '/parent/bin', HOME: '/tmp/profile-mac' });
  const win = hermeticChildEnv('C:\\Temp\\profile-win', { parentEnv: parent, platform: 'win32' });
  assert.deepEqual(win, { PATH: '/parent/bin', USERPROFILE: 'C:\\Temp\\profile-win', HOME: 'C:\\Temp\\profile-win', SystemRoot: 'C:\\Windows' });
  for (const env of [mac, win]) {
    assert.deepEqual(Object.keys(env).filter((key) => /^(GOOSE_|KIS_|OPENDART_)/.test(key) || key === 'TOKEN_LIKE' || key === 'ANTHROPIC_API_KEY'), []);
    assert.equal(Object.values(env).some((value) => SECRET_STRINGS.includes(value)), false);
  }
  assert.notEqual(mac.HOME, parent.HOME);
  assert.notEqual(win.USERPROFILE, parent.USERPROFILE);
  assert.notEqual(win.HOME, parent.HOME);
});

test('AC-009: hermeticChildEnv refuses the parent profile, a missing SystemRoot and unsupported platforms', () => {
  assert.throws(() => hermeticChildEnv('/Users/parent/', { parentEnv: { PATH: 'p', HOME: '/Users/parent' }, platform: 'darwin' }), /hermetic_env_profile_dir_is_parent_HOME/);
  assert.throws(() => hermeticChildEnv('C:\\Users\\parent', { parentEnv: { PATH: 'p', USERPROFILE: 'C:\\Users\\parent', SystemRoot: 'C:\\Windows' }, platform: 'win32' }), /hermetic_env_profile_dir_is_parent_USERPROFILE/);
  assert.throws(() => hermeticChildEnv('C:\\Temp\\p', { parentEnv: { PATH: 'p' }, platform: 'win32' }), /hermetic_env_systemroot_missing/);
  assert.throws(() => hermeticChildEnv('', { parentEnv: { PATH: 'p' }, platform: 'darwin' }), /hermetic_env_profile_dir_missing/);
  assert.throws(() => hermeticChildEnv('/tmp/p', { parentEnv: { PATH: 'p' }, platform: 'linux' }), /hermetic_env_unsupported_platform:linux/);
});

// ---- the recorder as a child preload: exactly once on every exit path that can run a handler ----

test('AC-009 recorder: exactly one line on a clean end, process.exit, an uncaught exception and an unhandled rejection', async () => {
  const cases: Array<{ label: string; code: string; exitCode: number; count: number }> = [
    { label: 'clean end, no fetch', code: '1', exitCode: 0, count: 0 },
    { label: 'clean end, one fetch', code: "await globalThis.fetch('https://mo.ai.kr/a').catch(() => {})", exitCode: 0, count: 1 },
    { label: 'process.exit(3) after two fetches', code: "await globalThis.fetch('https://a.example/').catch(() => {}); await globalThis.fetch('https://b.example/').catch(() => {}); process.exit(3)", exitCode: 3, count: 2 },
    { label: 'uncaught exception', code: "await globalThis.fetch('https://a.example/').catch(() => {}); throw new Error('boom')", exitCode: 1, count: 1 },
    { label: 'unhandled rejection', code: "Promise.reject(new Error('rejected')); setTimeout(() => {}, 500)", exitCode: 1, count: 0 },
  ];
  for (const item of cases) {
    const run = await runChild(withRecorder(inline(item.code)));
    assert.equal(run.exitCode, item.exitCode, item.label);
    assert.equal(recorderCounts(run.stderr).length, 1, `${item.label}: exactly one recorder line`);
    assertRecorderCount(run.stderr, item.count, item.label);
  }
});

test('AC-009 recorder: SIGTERM and SIGKILL leave no line, and a missing line (or a missing --import) is a failure, never a zero', async () => {
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    const profileDir = await makeProfileDir();
    const child = spawn(process.execPath, [...withRecorder(inline("process.stdout.write('ready\\n'); setInterval(() => {}, 1000)"))], { env: hermeticChildEnv(profileDir), stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const ended = new Promise<NodeJS.Signals | null>((resolve) => { child.once('close', (_code, sig) => resolve(sig)); });
    await new Promise<void>((resolve) => { child.stdout.once('data', () => resolve()); });
    child.kill(signal);
    assert.equal(await ended, signal);
    await removeProfileDir(profileDir);
    assert.deepEqual(recorderCounts(stderr), [], `${signal}: no handler can write the line`);
    assert.throws(() => assertRecorderCount(stderr, 0, signal), /expected exactly one moai_fetch_recorder_count line/);
  }
  // The same predicate rejects a child started without the --import preload.
  const run = await runChild(inline('1'));
  assert.equal(run.exitCode, 0);
  assert.throws(() => assertRecorderCount(run.stderr, 0, 'no --import'), /expected exactly one moai_fetch_recorder_count line/);
});

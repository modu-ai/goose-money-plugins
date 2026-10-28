// SPEC-ATP-AUTH-002 AC-004 (card t14, M4, test-first): the key-setup flow, measured in synthetic mkdtemp homes
// with per-run random synthetic key strings. Nothing here reads the real HOME or a real key, and no request
// leaves the process (the global fetch recorder is installed first and must stay empty).
//
//   004a  existing keys are the default selection        004b  a new-input choice replaces only that provider
//   004c  the atomic write fails at rename (existing file) or link (no file), injected through the
//         test-only `fsAdapter` option of saveLocalCredentials; bytes stay identical, no temp file stays
//   004d  cancel at any step leaves the file byte-identical  004e  anything but SAVE saves nothing
//   004f  setup output never says connected / verified    004g  the Windows block is preserved (static)
//   004h  the injection point is not open to production call sites (static)
//   plus  argv / environment / piped stdin never carry a secret into setup (REQ-SET-001, debt T14-D5)
//
// Not covered, on purpose: Windows behavior (process.platform is never faked on macOS), the arrow-key selector
// on a real terminal (needs a TTY), and the 17 t17 tools. The seam is reached through a local cast
// (`SaveOptions`) so this file compiles with and without the property in the option type.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, open, readdir, readFile, realpath, rename, rm, stat, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import type { CredentialProviders } from '../src/local-credentials.js';

const recorder = await import('./fetch-recorder.js');
const { defaultCredentialFilePath, loadLocalCredentials, saveLocalCredentials, SafeCredentialError } = await import('../src/local-credentials.js');
const { readHiddenLine, runCredentialSetupFlow } = await import('../src/credential-setup.js');
const { dispatchGooseCommand } = await import('../src/cli.js');
const { registerBlockedHostRejectionTest, storeTestFor } = await import('./credential-home.js'); // after the fetch recorder, like every src module above
// Direct key-store tests: skipped with a reason on a host whose key store rejects every call (one separately named store-rejection test stands in); unchanged elsewhere.
const storeTest = storeTestFor(test, 'key-store');
registerBlockedHostRejectionTest(test, 'key-store', 'auth002-m4-key-setup.test.ts');
after(() => recorder.restoreOriginalFetch());

// ---- synthetic keys and homes ------------------------------------------------------------------------

const hex = (bytes: number): string => randomBytes(bytes).toString('hex');
interface Secrets { kis: { appKey: string; appSecret: string }; dart: string }
/** Fresh random strings every call; `tag` is one character ('O' stored before the flow, 'N' typed during it). */
const newSecrets = (tag: string): Secrets => ({
  kis: { appKey: `SYN-${tag}-KEY-${hex(8)}`, appSecret: `SYN-${tag}-SEC-${hex(12)}` },
  dart: `D${tag}${hex(20)}`.slice(0, 40),
});
const secretList = (...all: Secrets[]): string[] => all.flatMap((s) => [s.kis.appKey, s.kis.appSecret, s.dart]);
const both = (s: Secrets): CredentialProviders => ({ kis: s.kis, opendart: { apiKey: s.dart } });

interface Ctx { home: string; project: string; file: string; keystore: string }
async function withSetup(run: (ctx: Ctx) => Promise<void>): Promise<void> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'atp-m4-setup-')));
  const home = join(base, 'home'), project = join(base, 'project');
  await mkdir(home, { mode: 0o700 }); await mkdir(project, { mode: 0o700 });
  assert.notEqual(home, homedir(), 'the synthetic home must not be the real home');
  const file = defaultCredentialFilePath(home);
  try { await run({ home, project, file, keystore: dirname(file) }); } finally { await rm(base, { force: true, recursive: true }); }
}
const seed = (ctx: Ctx, providers: CredentialProviders): Promise<void> => saveLocalCredentials(providers, ctx.project, { confirmed: true, homeDir: ctx.home });

interface Snap { bytes: Buffer; ino: number; mtimeMs: number; mode: number; names: string[] }
async function snap(ctx: Ctx): Promise<Snap> {
  const info = await stat(ctx.file);
  return { bytes: await readFile(ctx.file), ino: info.ino, mtimeMs: info.mtimeMs, mode: info.mode & 0o777, names: (await readdir(ctx.keystore)).sort() };
}
/** The credential file is the very same file: same bytes, same inode, same mtime, same mode, no sibling (no temp file). */
function assertSame(before: Snap, after: Snap, why: string): void {
  assert.deepEqual(after.bytes, before.bytes, `${why}: file bytes`);
  assert.equal(after.ino, before.ino, `${why}: file was not replaced (inode)`);
  assert.equal(after.mtimeMs, before.mtimeMs, `${why}: file was not rewritten (mtime)`);
  assert.equal(after.mode, before.mode, `${why}: file mode`);
  assert.deepEqual(after.names, ['credentials.json'], `${why}: keystore holds only credentials.json (no .credentials-*.tmp)`);
}
const absent = (path: string): Promise<void> => assert.rejects(lstat(path), { code: 'ENOENT' });

// ---- scripted setup flow -----------------------------------------------------------------------------

type Step = string | Error;
type Select = 'reuse' | 'replace' | 'cancel' | Error;
interface Sink { write(value: string): void; readonly text: string }
const sink = (): Sink => { let text = ''; return { write(v: string) { text += v; }, get text() { return text; } }; };
interface Ran { code: number | undefined; error: unknown; out: string; questions: string[]; hiddenPrompts: string[]; selectCalls: string[] }

class FakeTTY extends EventEmitter {
  isTTY = true; isRaw = false; paused = false;
  setRawMode(v: boolean) { this.isRaw = v; return this; }
  resume() { this.paused = false; return this; }
  pause() { this.paused = true; return this; }
}
/** hidden() backed by the real readHiddenLine on a fake TTY; each entry is the raw bytes typed for one prompt. */
function ttyHidden(inputs: string[], ttys: FakeTTY[]): (out: Sink) => (prompt: string) => Promise<string> {
  const queue = [...inputs];
  return (out) => (prompt) => {
    const tty = new FakeTTY(); ttys.push(tty);
    const pending = readHiddenLine(tty as unknown as NodeJS.ReadStream, out, prompt);
    const next = queue.shift();
    if (next === undefined) throw new Error('script_exhausted_tty');
    tty.emit('data', Buffer.from(next));
    return pending;
  };
}

const errorText = (e: unknown): string => e instanceof Error ? `${e.name}:${e.message}\n${e.stack ?? ''}\n${inspect(e, { depth: 6 })}` : String(e);
const codeOf = (e: unknown): string | undefined => e instanceof SafeCredentialError ? e.code : undefined;
const FORBIDDEN_WORDING = /연결됨|검증됨|연결 완료/;

/** Runs the real runCredentialSetupFlow with scripted answers; fails on any leak, wording or request violation. */
async function runFlow(ctx: Ctx, secrets: string[], script: { ask: Step[]; hidden?: Step[] | ((out: Sink) => (prompt: string) => Promise<string>); select?: Select[] }): Promise<Ran> {
  for (const answer of script.ask) if (typeof answer === 'string') assert.ok(!secrets.some((s) => answer.includes(s)), 'a secret must reach the flow only through hidden input, never through ask()');
  const questions: string[] = [], hiddenPrompts: string[] = [], selectCalls: string[] = [];
  const askQueue = [...script.ask], hiddenQueue = Array.isArray(script.hidden) ? [...script.hidden] : [], selectQueue = [...(script.select ?? [])];
  const out = sink();
  const ask = async (q: string): Promise<string> => {
    questions.push(q);
    const next = askQueue.shift();
    if (next === undefined) throw new Error('script_exhausted_ask');
    if (next instanceof Error) throw next;
    return next;
  };
  const typed = typeof script.hidden === 'function' ? script.hidden(out) : undefined;
  const hidden = async (q: string): Promise<string> => {
    hiddenPrompts.push(q);
    if (typed) return typed(q);
    const next = hiddenQueue.shift();
    if (next === undefined) throw new Error('script_exhausted_hidden');
    if (next instanceof Error) throw next;
    return next;
  };
  const select = script.select ? async (label: string) => {
    selectCalls.push(label);
    const next = selectQueue.shift();
    if (next === undefined) throw new Error('script_exhausted_select');
    if (next instanceof Error) throw next;
    return next;
  } : undefined;
  const envBefore = JSON.stringify(Object.entries(process.env).sort()), argvBefore = JSON.stringify(process.argv);
  recorder.resetFetchRecords();
  let code: number | undefined, error: unknown;
  try { code = await runCredentialSetupFlow(ctx.project, ask, hidden, out, ctx.home, select); } catch (e) { error = e; }
  const surfaces = [out.text, ...questions, ...hiddenPrompts, ...selectCalls, error === undefined ? '' : errorText(error), process.argv.join(' ')];
  for (const surface of surfaces) for (const secret of secrets) assert.ok(!surface.includes(secret), 'a synthetic secret reached an output surface');
  assert.doesNotMatch(out.text + questions.join(''), FORBIDDEN_WORDING, 'setup output must never claim a provider is connected or verified');
  assert.deepEqual(recorder.readFetchRecords(), [], 'setup makes no provider request of any kind');
  assert.equal(JSON.stringify(Object.entries(process.env).sort()), envBefore, 'setup does not touch the environment');
  assert.equal(JSON.stringify(process.argv), argvBefore, 'setup does not touch argv');
  assert.deepEqual(askQueue, [], 'every scripted answer was consumed (the flow took the scripted path)');
  assert.deepEqual(hiddenQueue, [], 'every scripted hidden input was consumed');
  assert.deepEqual(selectQueue, [], 'every scripted selection was consumed');
  return { code, error, out: out.text, questions, hiddenPrompts, selectCalls };
}

// ---- 004a: existing keys are the default selection ---------------------------------------------------

for (const answer of ['', '1', '  ']) {
  storeTest(`AC-004a reuse is the default: answering ${JSON.stringify(answer)} for both providers reuses the stored keys, asks for no secret and rewrites nothing`, () => withSetup(async (ctx) => {
    const old = newSecrets('O'); await seed(ctx, both(old));
    const before = await snap(ctx);
    const ran = await runFlow(ctx, secretList(old), { ask: ['YES', answer, answer] });
    assert.equal(ran.error, undefined); assert.equal(ran.code, 0);
    assert.deepEqual(ran.hiddenPrompts, [], 'no hidden (secret) prompt is shown when the existing keys are kept');
    assert.equal(ran.questions.length, 3);
    assert.match(ran.questions[1] ?? '', /KIS 키가 있습니다\. 1\) 기존 키 사용 \[기본\]/);
    assert.match(ran.questions[2] ?? '', /OpenDART 키가 있습니다\. 1\) 기존 키 사용 \[기본\]/);
    assert.match(ran.out, /credentials_reused=true credentials_saved=false/);
    assert.doesNotMatch(ran.out, /credentials_saved=true/);
    assertSame(before, await snap(ctx), 'reuse');
  }));
}
storeTest('AC-004a reuse through the selector hook: both providers answered "reuse" ask no secret and rewrite nothing', () => withSetup(async (ctx) => {
  const old = newSecrets('O'); await seed(ctx, both(old));
  const before = await snap(ctx);
  const ran = await runFlow(ctx, secretList(old), { ask: ['YES'], select: ['reuse', 'reuse'] });
  assert.equal(ran.error, undefined); assert.equal(ran.code, 0);
  assert.deepEqual(ran.selectCalls, ['KIS', 'OpenDART']);
  assert.deepEqual(ran.hiddenPrompts, []);
  assert.match(ran.out, /credentials_reused=true credentials_saved=false/);
  assertSame(before, await snap(ctx), 'selector reuse');
}));

// ---- 004b: a new-input choice replaces only that provider --------------------------------------------

const replaceCases: { name: string; ask: (nw: Secrets) => Step[]; hidden: (nw: Secrets) => Step[]; expect: (old: Secrets, nw: Secrets) => CredentialProviders; prompts: RegExp[] }[] = [
  { name: 'KIS only', ask: () => ['YES', '2', '', 'SAVE'], hidden: (nw) => [nw.kis.appKey, nw.kis.appSecret],
    expect: (old, nw) => ({ kis: nw.kis, opendart: { apiKey: old.dart } }), prompts: [/KIS App Key/, /KIS App Secret/] },
  { name: 'OpenDART only', ask: () => ['YES', '', '2', 'SAVE'], hidden: (nw) => [nw.dart],
    expect: (old, nw) => ({ kis: old.kis, opendart: { apiKey: nw.dart } }), prompts: [/OpenDART API/] },
  { name: 'both providers', ask: () => ['YES', '2', '2', 'SAVE'], hidden: (nw) => [nw.kis.appKey, nw.kis.appSecret, nw.dart],
    expect: (_old, nw) => both(nw), prompts: [/KIS App Key/, /KIS App Secret/, /OpenDART API/] },
];
for (const c of replaceCases) {
  storeTest(`AC-004b new input after "2" then SAVE replaces ${c.name} and preserves the other provider's stored key`, () => withSetup(async (ctx) => {
    const old = newSecrets('O'), nw = newSecrets('N'); await seed(ctx, both(old));
    const before = await snap(ctx);
    const ran = await runFlow(ctx, secretList(old, nw), { ask: c.ask(nw), hidden: c.hidden(nw) });
    assert.equal(ran.error, undefined); assert.equal(ran.code, 0);
    assert.match(ran.out, /credentials_saved=true/);
    assert.equal(ran.hiddenPrompts.length, c.prompts.length);
    c.prompts.forEach((pattern, i) => assert.match(ran.hiddenPrompts[i] ?? '', pattern));
    assert.deepEqual((await loadLocalCredentials(ctx.project, ctx.home))?.providers, c.expect(old, nw));
    const after = await snap(ctx);
    assert.notDeepEqual(after.bytes, before.bytes, 'the file changed');
    assert.equal(after.mode, 0o600); assert.deepEqual(after.names, ['credentials.json']);
  }));
}
storeTest('AC-004b new input on a first setup (no stored key) saves both providers at 0600 in a 0700 keystore', () => withSetup(async (ctx) => {
  const nw = newSecrets('N');
  const ran = await runFlow(ctx, secretList(nw), { ask: ['YES', 'SAVE'], hidden: [nw.kis.appKey, nw.kis.appSecret, nw.dart] });
  assert.equal(ran.error, undefined); assert.match(ran.out, /credentials_saved=true/);
  assert.deepEqual((await loadLocalCredentials(ctx.project, ctx.home))?.providers, both(nw));
  assert.equal((await stat(ctx.file)).mode & 0o777, 0o600);
  assert.equal((await stat(ctx.keystore)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(ctx.keystore), ['credentials.json']);
}));

// ---- 004e: SAVE absent -> nothing saved --------------------------------------------------------------

for (const confirmation of ['', 'NO', 'save', 'Save', 'SAVE ', ' SAVE', 'yes', 'Y', 'CANCEL', '1']) {
  storeTest(`AC-004e answering ${JSON.stringify(confirmation)} instead of SAVE saves nothing and leaves the existing file untouched`, () => withSetup(async (ctx) => {
    const old = newSecrets('O'), nw = newSecrets('N'); await seed(ctx, both(old));
    const before = await snap(ctx);
    const ran = await runFlow(ctx, secretList(old, nw), { ask: ['YES', '2', '', confirmation], hidden: [nw.kis.appKey, nw.kis.appSecret] });
    assert.equal(ran.error, undefined); assert.equal(ran.code, 0);
    assert.match(ran.out, /credentials_saved=false/); assert.doesNotMatch(ran.out, /credentials_saved=true/);
    assert.equal(ran.hiddenPrompts.length, 2, 'the new value was typed, then the confirmation withheld the write');
    assertSame(before, await snap(ctx), `confirmation ${JSON.stringify(confirmation)}`);
  }));
}
storeTest('AC-004e no SAVE on a first setup creates no keystore and no file at all', () => withSetup(async (ctx) => {
  const nw = newSecrets('N');
  const ran = await runFlow(ctx, secretList(nw), { ask: ['YES', 'NO'], hidden: [nw.kis.appKey, nw.kis.appSecret, nw.dart] });
  assert.equal(ran.error, undefined); assert.match(ran.out, /credentials_saved=false/);
  await absent(join(ctx.home, '.goose'));
  assert.deepEqual(await readdir(ctx.home), []);
}));
storeTest('AC-004e a start answer other than YES ends the flow before any further prompt', () => withSetup(async (ctx) => {
  const old = newSecrets('O'); await seed(ctx, both(old));
  const before = await snap(ctx);
  const ran = await runFlow(ctx, secretList(old), { ask: ['yes'] });
  assert.equal(ran.error, undefined); assert.equal(ran.questions.length, 1); assert.match(ran.out, /credentials_saved=false/);
  assertSame(before, await snap(ctx), 'start declined');
}));
storeTest('AC-004e saveLocalCredentials without confirmation rejects credential_confirmation_required and writes nothing', () => withSetup(async (ctx) => {
  const old = newSecrets('O'), nw = newSecrets('N'); await seed(ctx, both(old));
  const before = await snap(ctx);
  await assert.rejects(saveLocalCredentials({ kis: nw.kis }, ctx.project, { confirmed: false, homeDir: ctx.home }), (e: unknown) => codeOf(e) === 'credential_confirmation_required');
  assertSame(before, await snap(ctx), 'unconfirmed save');
}));

// ---- 004d: cancel at any step -> setup_cancelled, file byte-identical -------------------------------

const cancel = (): Error => new SafeCredentialError('setup_cancelled');
const CTRL_C = '\x03', CTRL_D = '\x04';
const cancelCases: { name: string; ask: (nw: Secrets) => Step[]; hidden?: (nw: Secrets) => string[]; select?: Select[] }[] = [
  { name: 'CANCEL typed at the first provider question', ask: () => ['YES', 'CANCEL'] },
  { name: 'CANCEL typed at the second provider question (first one kept)', ask: () => ['YES', '', 'CANCEL'] },
  { name: 'Ctrl+C in the KIS App Key prompt (real readHiddenLine)', ask: () => ['YES', '2'], hidden: () => [CTRL_C] },
  { name: 'Ctrl+D in the KIS App Secret prompt after the key was typed', ask: () => ['YES', '2'], hidden: (nw) => [`${nw.kis.appKey}\r`, CTRL_D] },
  { name: 'Ctrl+C in the OpenDART prompt after the KIS values were typed', ask: () => ['YES', '2', '2'], hidden: (nw) => [`${nw.kis.appKey}\r`, `${nw.kis.appSecret}\r`, CTRL_C] },
  { name: 'Ctrl+D at the SAVE prompt (the prompt rejects)', ask: () => ['YES', '2', '', cancel()], hidden: (nw) => [`${nw.kis.appKey}\r`, `${nw.kis.appSecret}\r`] },
  { name: 'the selector returns cancel for KIS', ask: () => ['YES'], select: ['cancel'] },
  { name: 'the selector keeps KIS then returns cancel for OpenDART', ask: () => ['YES'], select: ['reuse', 'cancel'] },
];
for (const c of cancelCases) {
  storeTest(`AC-004d cancel: ${c.name} -> setup_cancelled and the existing file is byte-identical`, () => withSetup(async (ctx) => {
    const old = newSecrets('O'), nw = newSecrets('N'); await seed(ctx, both(old));
    const before = await snap(ctx);
    const ttys: FakeTTY[] = [];
    const ran = await runFlow(ctx, secretList(old, nw), { ask: c.ask(nw), ...(c.hidden ? { hidden: ttyHidden(c.hidden(nw), ttys) } : {}), ...(c.select ? { select: c.select } : {}) });
    assert.equal(codeOf(ran.error), 'setup_cancelled', `the flow ended with ${errorText(ran.error).split('\n')[0]}`);
    assert.equal(ran.code, undefined);
    assert.doesNotMatch(ran.out, /credentials_saved=true/);
    for (const tty of ttys) { assert.equal(tty.isRaw, false, 'terminal restored'); assert.equal(tty.paused, true); assert.equal(tty.listenerCount('data'), 0); }
    assertSame(before, await snap(ctx), c.name);
  }));
}
storeTest('AC-004d cancel in the first hidden prompt of a first setup creates no keystore and no file', () => withSetup(async (ctx) => {
  const nw = newSecrets('N');
  const ran = await runFlow(ctx, secretList(nw), { ask: ['YES'], hidden: ttyHidden([CTRL_C], []) });
  assert.equal(codeOf(ran.error), 'setup_cancelled');
  await absent(join(ctx.home, '.goose'));
  assert.deepEqual(await readdir(ctx.home), []);
}));
storeTest('AC-004d half an entry (key without secret) is refused as credential_file_invalid and leaves the file byte-identical', () => withSetup(async (ctx) => {
  const old = newSecrets('O'), nw = newSecrets('N'); await seed(ctx, both(old));
  const before = await snap(ctx);
  const ran = await runFlow(ctx, secretList(old, nw), { ask: ['YES', '2'], hidden: [nw.kis.appKey, ''] });
  assert.equal(codeOf(ran.error), 'credential_file_invalid');
  assertSame(before, await snap(ctx), 'half entry');
}));

// ---- 004f: no "connected / verified" wording, no provider call ---------------------------------------

storeTest('AC-004f setup output in every outcome (reuse, save, decline, cancel) never says connected or verified and makes no request', () => withSetup(async (ctx) => {
  const old = newSecrets('O'), nw = newSecrets('N'); await seed(ctx, both(old));
  const everything = secretList(old, nw);
  const outs = [
    (await runFlow(ctx, everything, { ask: ['YES', '', ''] })).out,
    (await runFlow(ctx, everything, { ask: ['YES', '2', '', 'SAVE'], hidden: [nw.kis.appKey, nw.kis.appSecret] })).out,
    (await runFlow(ctx, everything, { ask: ['YES', '', '2', 'NO'], hidden: [nw.dart] })).out,
    (await runFlow(ctx, everything, { ask: ['YES', 'CANCEL'] })).out,
  ];
  for (const out of outs) {
    assert.match(out, /API 호출·토큰 발급은 수행하지 않습니다/, 'the banner states that setup makes no provider call (the observation is not vacuous)');
    assert.doesNotMatch(out, FORBIDDEN_WORDING);
  }
  assert.deepEqual(recorder.readFetchRecords(), []);
}));

// ---- argv / environment / piped stdin never carry a secret (REQ-SET-001, debt T14-D5) -----------------

const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
const readSource = (name: string): string => readFileSync(join(srcDir, name), 'utf8');
function runCli(args: string[], input: string, extraEnv: Record<string, string>, home: string): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [cliPath, ...args], { input, encoding: 'utf8', timeout: 60_000, env: { HOME: home, USERPROFILE: home, ...extraEnv } });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}
test('REQ-SET-001 the real setup CLI refuses piped stdin and environment values: exit 2, one fixed code on stderr, empty stdout, no file', async () => {
  const nw = newSecrets('N');
  const home = await realpath(await mkdtemp(join(tmpdir(), 'atp-m4-cli-')));
  try {
    const env = { KIS_APP_KEY: nw.kis.appKey, KIS_APP_SECRET: nw.kis.appSecret, OPENDART_API_KEY: nw.dart };
    const run = runCli(['setup', '--credentials'], `YES\n${nw.kis.appKey}\n${nw.kis.appSecret}\n${nw.dart}\nSAVE\n`, env, home);
    assert.equal(run.status, 2);
    assert.equal(run.stdout, '');
    assert.equal(run.stderr, 'setup_requires_interactive_terminal\n');
    for (const secret of secretList(nw)) { assert.ok(!run.stdout.includes(secret) && !run.stderr.includes(secret)); }
    assert.deepEqual(await readdir(home), [], 'nothing was written to the synthetic home');
  } finally { await rm(home, { force: true, recursive: true }); }
});
test('REQ-SET-001 a secret given on the command line is neither accepted nor echoed (real CLI, two spellings)', async () => {
  const nw = newSecrets('N');
  const home = await realpath(await mkdtemp(join(tmpdir(), 'atp-m4-cli-')));
  try {
    for (const args of [['setup', '--credentials', nw.kis.appKey], ['setup', `--credentials=${nw.kis.appSecret}`]]) {
      const run = runCli(args, '', {}, home);
      assert.equal(run.status, 64);
      assert.equal(run.stdout, '');
      assert.match(run.stderr, /^usage: moai-atp /);
      for (const secret of secretList(nw)) assert.ok(!run.stderr.includes(secret), 'argv was echoed');
    }
    assert.deepEqual(await readdir(home), []);
  } finally { await rm(home, { force: true, recursive: true }); }
});
test('REQ-SET-001 dispatchGooseCommand never calls the credential flow for a trailing argv value and never echoes it', async () => {
  const nw = newSecrets('N');
  let calls = 0; const errors = sink();
  const code = await dispatchGooseCommand(['setup', '--credentials', nw.kis.appKey], async () => { throw new Error('wrong route'); }, errors, async () => { calls++; return 0; });
  assert.equal(code, 64); assert.equal(calls, 0);
  assert.ok(!errors.text.includes(nw.kis.appKey));
});
test('REQ-SET-001 static: the credential setup module reads neither process.argv nor process.env', () => {
  assert.doesNotMatch(readSource('credential-setup.ts'), /process\.(argv|env)\b/);
});

// ---- 004c: atomic write failure, injected through the test-only fsAdapter option ---------------------

type SaveOptions = Parameters<typeof saveLocalCredentials>[2];
interface Calls { open: unknown[][]; rename: unknown[][]; link: unknown[][]; unlink: unknown[][] }
function recordingAdapter(failAt: { open?: Error; rename?: Error; link?: Error } = {}) {
  const calls: Calls = { open: [], rename: [], link: [], unlink: [] };
  const adapter = {
    open: async (...args: Parameters<typeof open>) => { calls.open.push(args); if (failAt.open) throw failAt.open; return open(...args); },
    rename: async (...args: Parameters<typeof rename>) => { calls.rename.push(args); if (failAt.rename) throw failAt.rename; return rename(...args); },
    link: async (...args: Parameters<typeof link>) => { calls.link.push(args); if (failAt.link) throw failAt.link; return link(...args); },
    unlink: async (...args: Parameters<typeof unlink>) => { calls.unlink.push(args); return unlink(...args); },
  };
  return { adapter, calls };
}
const saveWith = (patch: CredentialProviders, ctx: Ctx, adapter: object): Promise<void> =>
  saveLocalCredentials(patch, ctx.project, { confirmed: true, homeDir: ctx.home, fsAdapter: adapter } as unknown as SaveOptions);
const TEMP_NAME = /^\.credentials-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
/** The save must have rejected; returns the rejection (a pre-seam tree resolves here, which is the RED assertion). */
async function rejection(save: Promise<void>): Promise<unknown> {
  const failure = await save.then(() => undefined, (e: unknown) => e);
  assert.notEqual(failure, undefined, 'the save must reject when the injected step fails (a tree without the seam saves successfully instead)');
  return failure;
}
function assertSanitized(failure: unknown, injected: Error, secrets: string[]): void {
  assert.ok(failure instanceof SafeCredentialError, `expected a SafeCredentialError, got ${errorText(failure).split('\n')[0]}`);
  assert.equal(failure.code, 'credential_io_failed'); assert.equal(failure.message, 'credential_io_failed');
  const text = errorText(failure);
  assert.ok(!text.includes(injected.message), 'the injected error text must not surface');
  for (const secret of secrets) assert.ok(!text.includes(secret), 'a synthetic secret reached the error');
}

storeTest('AC-004c-i rename-step failure with an existing file: bytes identical, no .credentials-*.tmp, credential_io_failed only', () => withSetup(async (ctx) => {
  const old = newSecrets('O'), nw = newSecrets('N'); await seed(ctx, both(old));
  const before = await snap(ctx);
  const injected = new Error('synthetic rename failure'); assert.ok(!(injected instanceof SafeCredentialError), 'the injected error must be a plain Error');
  const { adapter, calls } = recordingAdapter({ rename: injected });
  const failure = await rejection(saveWith({ kis: nw.kis }, ctx, adapter));
  assertSanitized(failure, injected, secretList(old, nw));
  assert.equal(calls.rename.length, 1, 'rename was attempted once through the adapter');
  const [from, to] = calls.rename[0] as [string, string];
  assert.equal(dirname(from), ctx.keystore); assert.match(basename(from), TEMP_NAME); assert.equal(to, ctx.file);
  assert.deepEqual(calls.open.map((a) => [a[1], a[2]]), [['wx', 0o600]], 'the temporary file was created exclusively at 0600');
  assert.deepEqual(calls.unlink.map((a) => a[0]), [from], 'the temporary file was removed through the adapter');
  assertSame(before, await snap(ctx), 'rename failure');
  assert.deepEqual((await loadLocalCredentials(ctx.project, ctx.home))?.providers, both(old));
}));
storeTest('AC-004c-ii link-step failure with no existing file: no credentials.json, no temp file, credential_io_failed only', () => withSetup(async (ctx) => {
  const nw = newSecrets('N');
  const injected = new Error('synthetic link failure'); assert.ok(!(injected instanceof SafeCredentialError));
  const { adapter, calls } = recordingAdapter({ link: injected });
  const failure = await rejection(saveWith(both(nw), ctx, adapter));
  assertSanitized(failure, injected, secretList(nw));
  assert.equal(calls.link.length, 1, 'link was attempted once through the adapter');
  const [from, to] = calls.link[0] as [string, string];
  assert.equal(dirname(from), ctx.keystore); assert.match(basename(from), TEMP_NAME); assert.equal(to, ctx.file);
  assert.deepEqual(calls.unlink.map((a) => a[0]), [from]);
  assert.deepEqual(calls.rename, [], 'no rename on the first-save path');
  await absent(ctx.file);
  assert.deepEqual(await readdir(ctx.keystore), [], 'no temporary file is left behind');
}));
storeTest('AC-004c open-step failure (temp file cannot be created) with an existing file: bytes identical, credential_io_failed only', () => withSetup(async (ctx) => {
  const old = newSecrets('O'), nw = newSecrets('N'); await seed(ctx, both(old));
  const before = await snap(ctx);
  const injected = Object.assign(new Error('synthetic open failure'), { code: 'EACCES' });
  const { adapter, calls } = recordingAdapter({ open: injected });
  const failure = await rejection(saveWith({ opendart: { apiKey: nw.dart } }, ctx, adapter));
  assertSanitized(failure, injected, secretList(old, nw));
  assert.equal(calls.open.length, 1); assert.deepEqual(calls.rename, []); assert.deepEqual(calls.link, []);
  assertSame(before, await snap(ctx), 'open failure');
}));
storeTest('AC-004c a pass-through adapter sees open, rename, unlink (existing file) and open, link, unlink (first save) and the saves succeed', () => withSetup(async (ctx) => {
  const first = newSecrets('O'), second = newSecrets('N');
  const firstRun = recordingAdapter();
  await saveWith(both(first), ctx, firstRun.adapter);
  assert.deepEqual(Object.entries(firstRun.calls).map(([name, list]) => [name, list.length]), [['open', 1], ['rename', 0], ['link', 1], ['unlink', 1]], 'first save: open, link, unlink');
  assert.deepEqual((await loadLocalCredentials(ctx.project, ctx.home))?.providers, both(first));
  const secondRun = recordingAdapter();
  await saveWith({ kis: second.kis }, ctx, secondRun.adapter);
  assert.deepEqual(Object.entries(secondRun.calls).map(([name, list]) => [name, list.length]), [['open', 1], ['rename', 1], ['link', 0], ['unlink', 1]], 'later save: open, rename, unlink');
  assert.deepEqual((await loadLocalCredentials(ctx.project, ctx.home))?.providers, { kis: second.kis, opendart: { apiKey: first.dart } });
  assert.deepEqual(await readdir(ctx.keystore), ['credentials.json']);
}));
storeTest('AC-004c an empty fsAdapter behaves exactly like no adapter (defaults are the node:fs/promises functions)', () => withSetup(async (ctx) => {
  const first = newSecrets('O'), second = newSecrets('N');
  await saveWith(both(first), ctx, {});
  await saveWith({ opendart: { apiKey: second.dart } }, ctx, {});
  assert.deepEqual((await loadLocalCredentials(ctx.project, ctx.home))?.providers, { kis: first.kis, opendart: { apiKey: second.dart } });
  assert.equal((await stat(ctx.file)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(ctx.keystore), ['credentials.json']);
}));

// ---- 004g / 004h: static checks on local-credentials.ts and its call sites -----------------------------

test('AC-004g the Windows block is preserved: one exact line, first statement of directory(), reached by the read (false) and save (true) paths', () => {
  const lines = readSource('local-credentials.ts').split('\n');
  const WIN32 = 'if (process.platform === "win32") throw new SafeCredentialError("secure_file_storage_unsupported");';
  assert.equal(lines.filter((l) => l.includes(WIN32)).length, 1, '(1) the condition and its code stay on one line, exactly once');
  const win32 = lines.flatMap((l, i) => /process\.platform === "win32"/.test(l) ? [i] : []);
  const definition = lines.flatMap((l, i) => /^async function directory\(/.test(l) ? [i] : []);
  assert.equal(win32.length, 1); assert.equal(definition.length, 1);
  assert.equal(win32[0], (definition[0] ?? -2) + 1, '(2) the block is the first statement of directory()');
  const calls = lines.flatMap((l, i) => i !== definition[0] && /directory\(/.test(l) ? [l] : []);
  assert.ok(calls.some((l) => /directory\([^)]*,\s*false\)/.test(l)), '(2) the read path calls directory(..., false)');
  assert.ok(calls.some((l) => /directory\([^)]*,\s*true\)/.test(l)), '(2) the save path calls directory(..., true)');
  const mkdirLine = lines.findIndex((l, i) => i > (definition[0] ?? 0) && /mkdir\(/.test(l));
  assert.ok(mkdirLine > (win32[0] ?? Infinity), '(2) the first mkdir in directory() comes after the block');
});
test('AC-004h the injection point is open to no production call site: fsAdapter appears in local-credentials.ts and nowhere else under src', () => {
  const holders = readdirSync(srcDir, { recursive: true }).map(String).filter((name) => name.endsWith('.ts')).sort()
    .filter((name) => readFileSync(join(srcDir, name), 'utf8').includes('fsAdapter'));
  assert.deepEqual(holders, ['local-credentials.ts'], 'grep -rln fsAdapter plugins/moai-atp/server/src');
  const mentions = readSource('local-credentials.ts').split('\n').filter((l) => l.includes('fsAdapter'));
  assert.ok(mentions.length >= 1);
  for (const line of mentions) assert.doesNotMatch(line, /process\.(argv|env)/, 'no argv or environment path sets the adapter');
});

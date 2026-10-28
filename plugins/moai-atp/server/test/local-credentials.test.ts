import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, stat, chmod, readFile, writeFile, symlink, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defaultCredentialFilePath, loadLocalCredentials, saveLocalCredentials, resolveProviderCredentials } from "../src/local-credentials.js";
import { readHiddenLine, runCredentialSetupFlow } from "../src/credential-setup.js";
import { createCredentialProvider, createCredentialBackedServer } from './synthetic-member-access.js';
import { dispatchGooseCommand } from "../src/cli.js";
import { enterStoreTest, STORE_BODY } from "./credential-home.js";

const keys = { appKey: "synthetic-key", appSecret: "synthetic-secret" };
const dart = "s".repeat(40);
async function fixture(run: (home: string, project: string) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), "moai-credentials-synthetic-"));
  const home = join(base, "home"), project = join(base, "project");
  await Promise.all([home, project].map(p => mkdir(p, { mode: 0o700 })));
  try { if (await enterStoreTest("key-store", project, home) === STORE_BODY.run) await run(home, project); } finally { await rm(base, { force: true, recursive: true }); }
}
const sink = () => { let text = ""; return { write(v: string) { text += v; }, get text() { return text; } }; };
test("first credential setup saves only confirmed provider keys and runtime reads the same contract", () => fixture(async (home, project) => {
  const confirmation = ["YES", "SAVE"], secrets = [keys.appKey, keys.appSecret, dart], output = sink();
  await runCredentialSetupFlow(project, async () => confirmation.shift()!, async () => secrets.shift()!, output, home);
  assert.deepEqual((await loadLocalCredentials(project, home))?.providers, { kis: keys, opendart: { apiKey: dart } });
  const provider = createCredentialProvider({ projectRoot: project, homeDir: home, env: {}, obtainAccessToken: async found => { assert.deepEqual(found, keys); return "synthetic-token"; } });
  assert.deepEqual(await provider.getForMarketRead(), { ...keys, accessToken: "synthetic-token" });
  assert.doesNotMatch(output.text, /synthetic-key|synthetic-secret|ssssssss/);
  const file = defaultCredentialFilePath(home);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(dirname(file))).mode & 0o777, 0o700);
  assert.equal((await stat(dirname(dirname(file)))).mode & 0o777, 0o700);
  assert.doesNotMatch(await readFile(file, "utf8"), /synthetic-token|account|profile/);
}));
test("refusal, cancelled entry and declined SAVE create no credential file", () => fixture(async (home, project) => {
  await runCredentialSetupFlow(project, async () => "NO", async () => { throw Error("never ask"); }, sink(), home);
  await assert.rejects(runCredentialSetupFlow(project, async () => "YES", async () => { throw Error("setup_cancelled"); }, sink(), home), /setup_cancelled/);
  const confirmation = ["YES", "NO"], secrets = [keys.appKey, keys.appSecret, ""];
  await runCredentialSetupFlow(project, async () => confirmation.shift()!, async () => secrets.shift()!, sink(), home);
  assert.equal(await loadLocalCredentials(project, home), undefined);
}));
test("confirmed default reuses existing keys without asking for their value; partial replacement preserves originals", () => fixture(async (home, project) => {
  await saveLocalCredentials({ kis: keys }, project, { confirmed: true, homeDir: home });
  const before = await readFile(defaultCredentialFilePath(home), "utf8"), output = sink();
  const second = join(dirname(project), "second"); await mkdir(second);
  const reuse = ["YES", ""];
  await runCredentialSetupFlow(second, async () => reuse.shift() ?? "", async () => "", output, home);
  assert.match(output.text, /credentials_reused=true/);
  assert.equal(await readFile(defaultCredentialFilePath(home), "utf8"), before);
  const secrets = ["replacement", "", ""];
  const confirmation = ["YES", "2", "SAVE"];
  await assert.rejects(runCredentialSetupFlow(second, async () => confirmation.shift()!, async () => secrets.shift()!, sink(), home), /credential_file_invalid/);
}));
test("missing provider and missing token adapter fail closed", () => fixture(async (home, project) => {
  await assert.rejects(resolveProviderCredentials("kis", { projectRoot: project, homeDir: home, env: {} }), /credential_missing/);
  await assert.rejects(createCredentialProvider({ projectRoot: project, homeDir: home, env: {} }).getForMarketRead(), /credential_missing/);
  await assert.rejects(saveLocalCredentials({ kis: keys }, project, { confirmed: false, homeDir: home }), /credential_confirmation_required/);
}));
test("complete environment pair wins without file access; partial or empty environment fails closed", () => fixture(async (home, project) => {
  await saveLocalCredentials({ kis: keys }, project, { confirmed: true, homeDir: home });
  await chmod(defaultCredentialFilePath(home), 0o644);
  assert.deepEqual(await resolveProviderCredentials("kis", { projectRoot: project, homeDir: home, env: { KIS_APP_KEY: "synthetic-env-key", KIS_APP_SECRET: "synthetic-env-secret" } }), { appKey: "synthetic-env-key", appSecret: "synthetic-env-secret" });
  for (const env of [{ KIS_APP_KEY: "partial" }, { KIS_APP_KEY: "", KIS_APP_SECRET: "" }]) await assert.rejects(resolveProviderCredentials("kis", { projectRoot: project, homeDir: home, env }), /credential_environment_invalid/);
  assert.deepEqual(await resolveProviderCredentials("opendart", { projectRoot: project, homeDir: home, env: { OPENDART_API_KEY: dart } }), { apiKey: dart });
}));
test("broad file or directory permissions are rejected and never silently chmodded", () => fixture(async (home, project) => {
  await saveLocalCredentials({ kis: keys }, project, { confirmed: true, homeDir: home });
  const file = defaultCredentialFilePath(home);
  await chmod(file, 0o644); await assert.rejects(loadLocalCredentials(project, home), /credential_file_unsafe/);
  await assert.rejects(saveLocalCredentials({ kis: keys }, project, { confirmed: true, homeDir: home }), /credential_file_unsafe/);
  assert.equal((await stat(file)).mode & 0o777, 0o644);
  await chmod(file, 0o600); await chmod(dirname(file), 0o755);
  await assert.rejects(loadLocalCredentials(project, home), /credential_file_unsafe/);
}));
test("symlink, hardlink, malformed, unknown-field and oversized files are rejected with sanitized errors", () => fixture(async (home, project) => {
  await saveLocalCredentials({ kis: keys }, project, { confirmed: true, homeDir: home });
  const file = defaultCredentialFilePath(home), other = join(home, "other");
  await link(file, other); await assert.rejects(loadLocalCredentials(project, home), /credential_file_unsafe/); await rm(other);
  await rm(file); await writeFile(other, "{}", { mode: 0o600 }); await symlink(other, file);
  await assert.rejects(loadLocalCredentials(project, home), /credential_file_unsafe/); await rm(file);
  for (const content of ["synthetic-secret-invalid", JSON.stringify({ schemaVersion: 1, providers: { kis: keys }, accessToken: "synthetic-token" }), "x".repeat(17000)]) {
    await writeFile(file, content, { mode: 0o600 });
    await assert.rejects(loadLocalCredentials(project, home), e => e instanceof Error && /^credential_file_(invalid|unsafe)$/.test(e.message));
  }
}));
test("credential storage inside the project and symlinked parent are rejected", () => fixture(async (home, project) => {
  await assert.rejects(saveLocalCredentials({ kis: keys }, home, { confirmed: true, homeDir: home }), /credential_file_unsafe/);
  await symlink(project, join(home, ".goose"));
  await assert.rejects(saveLocalCredentials({ kis: keys }, project, { confirmed: true, homeDir: home }), /credential_file_unsafe/);
}));
class FakeTTY extends EventEmitter {
  isTTY = true; isRaw = false; paused = false;
  setRawMode(v: boolean) { this.isRaw = v; return this; }
  resume() { this.paused = false; return this; }
  pause() { this.paused = true; return this; }
}
test("hidden terminal input never echoes, handles backspace and restores terminal", async () => {
  const tty = new FakeTTY(), output = sink();
  const answer = readHiddenLine(tty as unknown as NodeJS.ReadStream, output, "hidden: ");
  tty.emit("data", Buffer.from("synthetic-secrex\x7ft\r"));
  assert.equal(await answer, keys.appSecret);
  assert.equal(output.text, "hidden: \n"); assert.equal(tty.isRaw, false); assert.equal(tty.paused, true); assert.equal(tty.listenerCount("data"), 0);
});
test("hidden terminal rejects pipes, cancellation, EOF and oversized input without leaking", async () => {
  const piped = new FakeTTY(); piped.isTTY = false;
  await assert.rejects(readHiddenLine(piped as unknown as NodeJS.ReadStream, sink(), ""), /setup_requires_interactive_terminal/);
  for (const event of ["\x03", "\x04", "x".repeat(513), "\x1b"]) {
    const tty = new FakeTTY(), output = sink();
    const result = readHiddenLine(tty as unknown as NodeJS.ReadStream, output, "hidden: ");
    tty.emit("data", event); await assert.rejects(result, /setup_cancelled/);
    assert.equal(tty.isRaw, false); assert.equal(output.text, "hidden: \n");
  }
  const tty = new FakeTTY(), result = readHiddenLine(tty as unknown as NodeJS.ReadStream, sink(), "");
  tty.emit("end"); await assert.rejects(result, /setup_cancelled/);
});
test("MCP default gate runs before credential/environment access and network", async () => {
  let reads = 0, tokens = 0, requests = 0;
  const env = new Proxy({}, { get() { reads++; throw Error("must not inspect"); } });
  const server = createCredentialBackedServer({ env, obtainAccessToken: async () => { tokens++; return "synthetic-token"; }, fetchImpl: async () => { requests++; throw Error("forbidden"); } });
  const registered = (server as any)._registeredTools;
  assert.equal(Object.keys(registered).length, 36);
  await assert.rejects(registered.get_market_snapshot.handler({ symbol: "000660", board: "J" }), /rights_pending/);
  assert.deepEqual([reads, tokens, requests], [0, 0, 0]);
});
test("CLI credentials option routes only to the credential setup flow", async () => {
  let calls = 0;
  assert.equal(await dispatchGooseCommand(["/goose", "setup", "--credentials"], async () => { throw Error("wrong route"); }, sink(), async () => { calls++; return 0; }), 0);
  assert.equal(calls, 1);
});
test("explicitly injected MCP adapter reads setup keys only after the gate; missing keys never reach transport", () => fixture(async (home, project) => {
  let tokens = 0, requests = 0;
  const options = { projectRoot: project, homeDir: home, env: {}, rightsEnabled: true,
    obtainAccessToken: async (found: typeof keys) => { tokens++; assert.deepEqual(found, keys); return "synthetic-token"; },
    fetchImpl: (async (_url: unknown, init: RequestInit | undefined) => {
      requests++; const headers = init!.headers as Record<string, string>;
      assert.equal(headers.appkey, keys.appKey); assert.equal(headers.appsecret, keys.appSecret);
      assert.equal(headers.authorization, "Bearer synthetic-token");
      // Abort this fake exchange without constructing an actual-origin quote.
      throw Error("synthetic fixture stopped");
    }) as typeof fetch };
  const call = () => (createCredentialBackedServer(options) as any)._registeredTools.get_market_snapshot.handler({ symbol: "000660", board: "J" });
  await assert.rejects(call(), /credential_missing/); assert.deepEqual([tokens, requests], [0, 0]);
  await saveLocalCredentials({ kis: keys }, project, { confirmed: true, homeDir: home });
  await assert.rejects(call(), /upstream_unavailable/); assert.deepEqual([tokens, requests], [1, 1]);
}));

test("existing providers default to reuse only after confirmation and never ask hidden input", () => fixture(async (home, project) => {
  await saveLocalCredentials({ kis: keys, opendart: { apiKey: dart } }, project, { confirmed: true, homeDir: home });
  const file = defaultCredentialFilePath(home), before = await readFile(file), info = await stat(file);
  const selections = ["YES", "", "1"], questions: string[] = [], output = sink();
  await runCredentialSetupFlow(project, async q => { questions.push(q); return selections.shift()!; }, async () => { throw Error("must not ask key value"); }, output, home);
  assert.equal(questions.length, 3);
  assert.deepEqual(await readFile(file), before);
  assert.equal((await stat(file)).mtimeMs, info.mtimeMs);
  assert.match(output.text, /credentials_reused=true credentials_saved=false/);
  assert.doesNotMatch(output.text + questions.join(""), /synthetic-key|synthetic-secret|ssssssss/);
}));
test("cancelled replacement and declined SAVE preserve both existing providers byte-for-byte", () => fixture(async (home, project) => {
  await saveLocalCredentials({ kis: keys, opendart: { apiKey: dart } }, project, { confirmed: true, homeDir: home });
  const file = defaultCredentialFilePath(home), before = await readFile(file);
  const cancel = ["YES", "CANCEL"];
  await assert.rejects(runCredentialSetupFlow(project, async () => cancel.shift()!, async () => { throw Error("not reached"); }, sink(), home), /setup_cancelled/);
  const decline = ["YES", "2", "1", "NO"], replacement = ["synthetic-new-key", "synthetic-new-secret"];
  await runCredentialSetupFlow(project, async () => decline.shift()!, async () => replacement.shift()!, sink(), home);
  assert.deepEqual(await readFile(file), before);
}));
test("editing one provider preserves the other and invalid selections do not enter secret input", () => fixture(async (home, project) => {
  await saveLocalCredentials({ kis: keys, opendart: { apiKey: dart } }, project, { confirmed: true, homeDir: home });
  const selections = ["YES", "invalid", "1", "2", "SAVE"], replacement = "n".repeat(40), output = sink();
  let hiddenCalls = 0;
  await runCredentialSetupFlow(project, async () => selections.shift()!, async () => { hiddenCalls++; return replacement; }, output, home);
  assert.equal(hiddenCalls, 1);
  assert.deepEqual((await loadLocalCredentials(project, home))?.providers, { kis: keys, opendart: { apiKey: replacement } });
  assert.doesNotMatch(output.text, /nnnnnnnn|synthetic-key|synthetic-secret/);
}));

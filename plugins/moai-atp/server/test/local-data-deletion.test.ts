import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, open, rename, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalCredentials, saveLocalCredentials } from "../src/local-credentials.js";
import { markSetupPresented, readInvestorContext, saveInvestorContext, setupWasPresented, type InvestorContextAnswers } from "../src/user-context.js";
import { holdingsFilePath, readHoldings } from "../src/user-holdings.js";
import { runSetupFlow } from "../src/setup-cli.js";
import { dispatchGooseCommand } from "../src/cli.js";
import { registerBlockedHostRejectionTest, storeTestFor } from "./credential-home.js";

// S1 combined local-data deletion (#111): one explicit DELETE confirmation removes exactly the
// three decided local stores (provider keys, investor profile, holdings snapshot) in a fixed
// order and reports each as *_deleted=true/false. The onboarding-presented marker stays out —
// P-02 (design #9 §7) is undecided; the opt-in --delete-onboarding flag remains the only path.
// Every case runs on a synthetic mkdtemp home; no case touches the real user home.
const keyStoreTest = storeTestFor(test, "key-store");
registerBlockedHostRejectionTest(test, "key-store", "local-data-deletion.test.ts");

const keys = { appKey: "synthetic-key", appSecret: "synthetic-secret" };
const dart = "s".repeat(40);
const synthetic: InvestorContextAnswers = { objectives: ["learning"], timeHorizon: "unspecified", experience: "new", riskTolerance: "unspecified", riskCapacity: "unspecified", liquidityNeed: "unspecified", assetScope: ["domestic_equity"] };
const manualSnapshot = { as_of: "2026-01-01", currency: "KRW", positions: [] };
const header = "모두의 주식 · MoAI ATP — 로컬 공통 프로필 설정\n";
const sink = () => { const messages: string[] = []; return { messages, write(value: string) { messages.push(value); } }; };
async function fixture(run: (home: string, project: string) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), "moai-local-delete-synthetic-"));
  const home = join(base, "home"), project = join(base, "project");
  await Promise.all([home, project].map(p => mkdir(p, { mode: 0o700 })));
  try { await run(home, project); } finally { await rm(base, { force: true, recursive: true }); }
}
async function seedAll(home: string, project: string): Promise<void> {
  await saveLocalCredentials({ kis: keys, opendart: { apiKey: dart } }, project, { confirmed: true, homeDir: home });
  await saveInvestorContext(synthetic, project, { confirmed: true, homeDir: home });
  await markSetupPresented(project, home);
  const temp = join(home, ".goose", "context", ".seed-holdings.tmp");
  const handle = await open(temp, "wx", 0o600);
  await handle.writeFile(JSON.stringify(manualSnapshot) + "\n");
  await handle.close();
  await rename(temp, holdingsFilePath(home));
}

keyStoreTest("one DELETE removes the three decided stores in fixed order and keeps the onboarding marker", () => fixture(async (home, project) => {
  await seedAll(home, project);
  const output = sink();
  assert.equal(await runSetupFlow(project, async () => "DELETE", output, home, "delete-local-data"), 0);
  assert.deepEqual(output.messages, [
    header,
    "credentials_deleted=true\n",
    "profile_deleted=true\n",
    "holdings_deleted=true\n",
  ]);
  assert.equal(await loadLocalCredentials(project, home), undefined);
  assert.equal(await readInvestorContext(project, home), undefined);
  assert.equal(await readHoldings(project, home), undefined);
  assert.equal(await setupWasPresented(project, home), true, "onboarding marker is P-02: untouched");
  assert.equal(await stat(join(home, ".goose", "context", "onboarding.json")).then(s => s.isFile()), true);
  assert.doesNotMatch(output.messages.join(""), /synthetic-key|synthetic-secret/);
}));

keyStoreTest("refusal reports all three as false and leaves every file untouched", () => fixture(async (home, project) => {
  await seedAll(home, project);
  const output = sink();
  assert.equal(await runSetupFlow(project, async () => "NO", output, home, "delete-local-data"), 0);
  assert.deepEqual(output.messages, [
    header,
    "credentials_deleted=false\n",
    "profile_deleted=false\n",
    "holdings_deleted=false\n",
  ]);
  assert.deepEqual((await loadLocalCredentials(project, home))?.providers.kis, keys);
  assert.deepEqual((await readInvestorContext(project, home))?.answers, synthetic);
  assert.deepEqual(await readHoldings(project, home), manualSnapshot);
  assert.equal(await setupWasPresented(project, home), true);
}));

keyStoreTest("absent stores report false without error", () => fixture(async (home, project) => {
  const output = sink();
  assert.equal(await runSetupFlow(project, async () => "DELETE", output, home, "delete-local-data"), 0);
  assert.deepEqual(output.messages, [
    header,
    "credentials_deleted=false\n",
    "profile_deleted=false\n",
    "holdings_deleted=false\n",
  ]);
}));

keyStoreTest("only the stores that exist flip to true on a partial home", () => fixture(async (home, project) => {
  await saveLocalCredentials({ kis: keys }, project, { confirmed: true, homeDir: home });
  const output = sink();
  assert.equal(await runSetupFlow(project, async () => "DELETE", output, home, "delete-local-data"), 0);
  assert.deepEqual(output.messages, [
    header,
    "credentials_deleted=true\n",
    "profile_deleted=false\n",
    "holdings_deleted=false\n",
  ]);
  assert.doesNotMatch(output.messages.join(""), /synthetic-key|synthetic-secret/);
}));

// Issue #118: a store error must not swallow the remaining result lines. The combined flow
// keeps processing the other stores, reports the failing store with an explicit fixed-code
// failure line, reports the failure at the end, and keeps the existing failure exit code.
keyStoreTest("a failing store still reports every line and fails at the end", () => fixture(async (home, project) => {
  await seedAll(home, project);
  await rm(holdingsFilePath(home));
  await symlink(join(home, "missing-target"), holdingsFilePath(home));
  const output = sink();
  assert.equal(await runSetupFlow(project, async () => "DELETE", output, home, "delete-local-data"), 2);
  assert.deepEqual(output.messages, [
    header,
    "credentials_deleted=true\n",
    "profile_deleted=true\n",
    "holdings_deleted=error:holdings_unsafe_path\n",
    "deletion_errors=holdings_unsafe_path\n",
  ]);
  assert.equal(await loadLocalCredentials(project, home), undefined);
  assert.equal(await readInvestorContext(project, home), undefined);
}));

test("cli routes --delete-local-data and lists it in usage", async () => {
  const actions: string[] = [];
  const fail = { write: () => assert.fail("unexpected usage") } as { write(value: string): unknown };
  assert.equal(await dispatchGooseCommand(["setup", "--delete-local-data"], async a => { actions.push(a); return 0; }, fail, async () => assert.fail("credentials"), { write: () => {} }, async () => assert.fail("credential-delete")), 0);
  assert.deepEqual(actions, ["delete-local-data"]);
  const usage: string[] = [];
  assert.equal(await dispatchGooseCommand(["setup", "--unknown-flag"], async () => assert.fail("action on unknown flag"), { write: (value: string) => usage.push(value) }, async () => 0, { write: () => {} }, async () => 0), 64);
  assert.match(usage.join(""), /^usage: moai-atp .*--delete-local-data/);
});

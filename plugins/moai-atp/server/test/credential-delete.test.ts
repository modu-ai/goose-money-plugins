import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCredentialFilePath, deleteLocalCredentials, loadLocalCredentials, saveLocalCredentials } from "../src/local-credentials.js";
import { deleteOnboardingMarker, investorContextFilePath, markSetupPresented, readInvestorContext, saveInvestorContext, setupWasPresented, type InvestorContextAnswers } from "../src/user-context.js";
import { runCredentialDeleteFlow } from "../src/credential-setup.js";
import { runSetupFlow } from "../src/setup-cli.js";
import { registerBlockedHostRejectionTest, storeTestFor } from "./credential-home.js";

// Deletion commands for the three local personal-data stores (#43): provider keys, the confirmed
// investor profile and the onboarding-presented marker. Every case runs on a synthetic mkdtemp home;
// no case touches the real user home. Refs #9 (user decision: local-only until the user deletes it).
const keyStoreTest = storeTestFor(test, "key-store");
registerBlockedHostRejectionTest(test, "key-store", "credential-delete.test.ts");
const profileStoreTest = storeTestFor(test, "profile-store");
registerBlockedHostRejectionTest(test, "profile-store", "credential-delete.test.ts");
const keys = { appKey: "synthetic-key", appSecret: "synthetic-secret" };
const dart = "s".repeat(40);
const synthetic: InvestorContextAnswers = { objectives: ["learning"], timeHorizon: "unspecified", experience: "new", riskTolerance: "unspecified", riskCapacity: "unspecified", liquidityNeed: "unspecified", assetScope: ["domestic_equity"] };
const sink = () => { const messages: string[] = []; return { messages, write(value: string) { messages.push(value); } }; };
async function fixture(run: (home: string, project: string) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), "moai-delete-synthetic-"));
  const home = join(base, "home"), project = join(base, "project");
  await Promise.all([home, project].map(p => mkdir(p, { mode: 0o700 })));
  try { await run(home, project); } finally { await rm(base, { force: true, recursive: true }); }
}

keyStoreTest("key deletion requires confirmation, removes only the key file and reports absence without error", () => fixture(async (home, project) => {
  await saveLocalCredentials({ kis: keys, opendart: { apiKey: dart } }, project, { confirmed: true, homeDir: home });
  await assert.rejects(deleteLocalCredentials(project, { confirmed: false, homeDir: home }), /credential_confirmation_required/);
  assert.equal((await stat(defaultCredentialFilePath(home))).mode & 0o777, 0o600);
  assert.equal(await deleteLocalCredentials(project, { confirmed: true, homeDir: home }), true);
  assert.equal(await loadLocalCredentials(project, home), undefined);
  assert.equal(await deleteLocalCredentials(project, { confirmed: true, homeDir: home }), false);
}));

keyStoreTest("credential delete flow confirms with DELETE, reports credentials_deleted and never echoes key values", () => fixture(async (home, project) => {
  await saveLocalCredentials({ kis: keys }, project, { confirmed: true, homeDir: home });
  const refusal = sink();
  assert.equal(await runCredentialDeleteFlow(project, async () => "NO", refusal, home), 0);
  assert.match(refusal.messages.join(""), /credentials_deleted=false/);
  assert.deepEqual((await loadLocalCredentials(project, home))?.providers.kis, keys);
  const confirmed = sink();
  assert.equal(await runCredentialDeleteFlow(project, async () => "DELETE", confirmed, home), 0);
  assert.match(confirmed.messages.join(""), /credentials_deleted=true/);
  assert.equal(await loadLocalCredentials(project, home), undefined);
  assert.doesNotMatch(confirmed.messages.join(""), /synthetic-key|synthetic-secret/);
}));

profileStoreTest("onboarding marker deletion requires confirmation, keeps the profile intact and reports absence", () => fixture(async (home, project) => {
  await markSetupPresented(project, home);
  await saveInvestorContext(synthetic, project, { confirmed: true, homeDir: home });
  await assert.rejects(deleteOnboardingMarker(project, { confirmed: false, homeDir: home }), /context_confirmation_required/);
  assert.equal(await deleteOnboardingMarker(project, { confirmed: true, homeDir: home }), true);
  assert.equal(await setupWasPresented(project, home), false);
  assert.deepEqual((await readInvestorContext(project, home))?.answers, synthetic);
  assert.equal(await deleteOnboardingMarker(project, { confirmed: true, homeDir: home }), false);
}));

profileStoreTest("setup --delete-onboarding confirms with DELETE and leaves the profile untouched", () => fixture(async (home, project) => {
  await markSetupPresented(project, home);
  await saveInvestorContext(synthetic, project, { confirmed: true, homeDir: home });
  const refusal = sink();
  assert.equal(await runSetupFlow(project, async () => "NO", refusal, home, "delete-onboarding"), 0);
  assert.match(refusal.messages.join(""), /onboarding_deleted=false/);
  assert.equal(await setupWasPresented(project, home), true);
  const confirmed = sink();
  assert.equal(await runSetupFlow(project, async () => "DELETE", confirmed, home, "delete-onboarding"), 0);
  assert.match(confirmed.messages.join(""), /onboarding_deleted=true/);
  assert.equal(await setupWasPresented(project, home), false);
  assert.deepEqual((await readInvestorContext(project, home))?.answers, synthetic);
  assert.equal(await stat(investorContextFilePath(home)).then(s => s.isFile()), true);
}));

keyStoreTest("after all three deletions the synthetic home keeps zero files and no derived leftovers", () => fixture(async (home, project) => {
  await saveLocalCredentials({ kis: keys, opendart: { apiKey: dart } }, project, { confirmed: true, homeDir: home });
  await saveInvestorContext(synthetic, project, { confirmed: true, homeDir: home });
  await markSetupPresented(project, home);
  assert.equal(await runSetupFlow(project, async () => "DELETE", sink(), home, "delete"), 0);
  assert.equal(await deleteLocalCredentials(project, { confirmed: true, homeDir: home }), true);
  assert.equal(await runSetupFlow(project, async () => "DELETE", sink(), home, "delete-onboarding"), 0);
  const remaining = await readdir(join(home, ".goose"), { recursive: true, withFileTypes: true });
  assert.deepEqual(remaining.filter(e => e.isFile()).map(e => join(e.parentPath, e.name)), [], "no file remains under the synthetic home after deletion");
  assert.deepEqual(remaining.filter(e => e.isSymbolicLink()), [], "no symlink remains under the synthetic home after deletion");
}));

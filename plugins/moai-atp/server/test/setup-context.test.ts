import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, symlink, chmod, stat, link, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { dispatchGooseCommand } from "../src/cli.js";
import { runSetupFlow } from "../src/setup-cli.js";
import { saveInvestorContext, readInvestorContext, investorContextFilePath, selectInvestorContext, deleteInvestorContext, type InvestorContextAnswers } from "../src/user-context.js";

const synthetic: InvestorContextAnswers = { objectives: ["learning"], timeHorizon: "unspecified", experience: "new", riskTolerance: "unspecified", riskCapacity: "unspecified", liquidityNeed: "unspecified", assetScope: ["domestic_equity"] };
async function fixture(run: (home: string, first: string, second: string) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), "moai-setup-synthetic-"));
  const home = join(base, "home"), first = join(base, "alpha"), second = join(base, "beta");
  await Promise.all([home, first, second].map(p => mkdir(p, { mode: 0o700 })));
  try { await run(home, first, second); } finally { await rm(base, { recursive: true, force: true }); }
}
const sink = () => { const messages: string[] = []; return { messages, write(value: string) { messages.push(value); } }; };
const questionnaire = () => ["YES", "4", "5", "1", "4", "4", "4", "1", "SAVE"];

test("first setup collects confirmed closed choices and a second project reuses the common profile without a question", async () => fixture(async (home, first, second) => {
  const answers = questionnaire(), output = sink();
  assert.equal(await runSetupFlow(first, async () => answers.shift() ?? "CANCEL", output, home), 0);
  assert.deepEqual(answers, []);
  assert.deepEqual((await readInvestorContext(first, home))?.answers, synthetic);
  assert.equal(await runSetupFlow(second, async () => { throw new Error("must not ask twice"); }, output, home), 0);
  assert.match(output.messages.join(""), /profile_reused=true/);
  assert.doesNotMatch(output.messages.join(""), /riskTolerance|long_term_growth|appSecret/);
  assert.equal((await stat(investorContextFilePath(home))).mode & 0o777, 0o600);
  assert.equal((await stat(dirname(investorContextFilePath(home)))).mode & 0o777, 0o700);
  await assert.rejects(stat(join(home, ".goose", "keystore")), { code: "ENOENT" });
}));

test("declining first onboarding stores no profile and is not repeated in later projects", async () => fixture(async (home, first, second) => {
  assert.equal(await runSetupFlow(first, async () => "NO", sink(), home), 0);
  assert.equal(await readInvestorContext(first, home), undefined);
  assert.deepEqual(JSON.parse(await readFile(join(home, ".goose/context/onboarding.json"), "utf8")), { schemaVersion: 1, presented: true });
  await runSetupFlow(second, async () => { throw new Error("no repeat after refusal"); }, sink(), home);
}));

test("canceling a partial interview writes no answers or inferred profile", async () => fixture(async (home, first, second) => {
  const inputs = ["YES", "4", "CANCEL"];
  await runSetupFlow(first, async () => inputs.shift() ?? "CANCEL", sink(), home);
  assert.equal(await readInvestorContext(first, home), undefined);
  await runSetupFlow(second, async () => { throw new Error("no repeat"); }, sink(), home);
}));

test("only an explicit edit starts another interview and increments the common revision", async () => fixture(async (home, first, second) => {
  await saveInvestorContext(synthetic, first, { confirmed: true, homeDir: home });
  const answers = questionnaire(); answers[1] = "1";
  await runSetupFlow(second, async () => answers.shift() ?? "CANCEL", sink(), home, "edit");
  const profile = await readInvestorContext(first, home);
  assert.equal(profile?.revision, 2);
  assert.deepEqual(profile?.answers.objectives, ["long_term_growth"]);
  assert.deepEqual(selectInvestorContext(profile, ["timeHorizon"])?.fields, { timeHorizon: "unspecified" });
}));

test("deletion requires confirmation, removes common answers and does not restore onboarding automatically", async () => fixture(async (home, first, second) => {
  const answers = questionnaire(); await runSetupFlow(first, async () => answers.shift() ?? "CANCEL", sink(), home);
  await assert.rejects(deleteInvestorContext(first, { confirmed: false, homeDir: home }), /context_confirmation_required/);
  await runSetupFlow(second, async () => "DELETE", sink(), home, "delete");
  assert.equal(await readInvestorContext(first, home), undefined);
  await runSetupFlow(second, async () => { throw new Error("no re-interview"); }, sink(), home);
}));

test("schema rejects account fields, arbitrary notes and unconfirmed writes", async () => fixture(async (home, first) => {
  await assert.rejects(saveInvestorContext({ ...synthetic, personalNote: "synthetic" } as InvestorContextAnswers, first, { confirmed: true, homeDir: home }), /context_invalid/);
  await assert.rejects(saveInvestorContext(synthetic, first, { confirmed: false, homeDir: home }), /context_confirmation_required/);
  assert.equal(await readInvestorContext(first, home), undefined);
}));

test("symlinked context directory is rejected without reading or modifying its target", async () => fixture(async (home, first, second) => {
  await mkdir(join(home, ".goose"), { mode: 0o700 });
  await symlink(second, join(home, ".goose/context"));
  await assert.rejects(readInvestorContext(first, home), /context_unsafe_path/);
  await assert.rejects(stat(join(second, "profile.json")), { code: "ENOENT" });
}));

test("symlinked or hardlinked profile and broad permissions fail closed", async () => fixture(async (home, first, second) => {
  await saveInvestorContext(synthetic, first, { confirmed: true, homeDir: home });
  const path = investorContextFilePath(home), outside = join(second, "synthetic.json");
  await link(path, outside); await assert.rejects(readInvestorContext(first, home), /context_unsafe_path/);
  await rm(outside); await chmod(path, 0o644); await assert.rejects(readInvestorContext(first, home), /context_unsafe_path/);
  await chmod(path, 0o600); await rm(path); await writeFile(outside, "{}", { mode: 0o600 }); await symlink(outside, path);
  await assert.rejects(readInvestorContext(first, home), /context_unsafe_path/);
}));

test("oversized and malformed content fails without leaking its text", async () => fixture(async (home, first) => {
  await saveInvestorContext(synthetic, first, { confirmed: true, homeDir: home });
  const path = investorContextFilePath(home);
  await writeFile(path, "SYNTHETIC_INVALID_PROFILE");
  await assert.rejects(readInvestorContext(first, home), e => e instanceof Error && e.message === "context_invalid");
  await writeFile(path, "x".repeat(9000)); await assert.rejects(readInvestorContext(first, home), /context_unsafe_path/);
}));

test("profiles cannot be stored inside the selected project repository", async () => fixture(async (home) => {
  await assert.rejects(saveInvestorContext(synthetic, home, { confirmed: true, homeDir: home }), /context_unsafe_path/);
}));

test("concurrent first writes never overwrite another confirmed profile", async () => fixture(async (home, first) => {
  const results = await Promise.allSettled([
    saveInvestorContext(synthetic, first, { confirmed: true, homeDir: home }),
    saveInvestorContext({ ...synthetic, experience: "experienced" }, first, { confirmed: true, homeDir: home }),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await readInvestorContext(first, home))?.revision, 1);
}));

test("CLI accepts only setup modes; canceled interview route and unknown arguments never execute or echo", async () => {
  const actions: string[] = [], errors = sink();
  for (const args of [["setup"], ["/goose", "setup", "--edit-profile"], ["setup", "--delete-profile"]]) {
    assert.equal(await dispatchGooseCommand(args, async mode => { actions.push(mode); return 0; }, errors, async () => 0), 0);
  }
  assert.deepEqual(actions, ["reuse", "edit", "delete"]);
  for (const args of [["interview"], ["/goose", "interview"], ["setup", "SYNTHETIC_SECRET_ARGUMENT"]]) {
    assert.equal(await dispatchGooseCommand(args, async () => { throw new Error("must not run"); }, errors), 64);
  }
  assert.doesNotMatch(errors.messages.join(""), /SYNTHETIC_SECRET_ARGUMENT/);
});

test("setup re-prompts invalid choices, stores only confirmed enums and uses the product display name", async () => fixture(async (home, first) => {
  const answers = ["YES", "0", "4,4", "SYNTHETIC_INVALID_INPUT", "4", "99", "5", "1", "4", "4", "4", "1", "SAVE"];
  let prompts = 0;
  const output = sink();
  await runSetupFlow(first, async () => { prompts++; return answers.shift() ?? "CANCEL"; }, output, home);
  assert.equal(prompts, 13);
  assert.deepEqual(answers, []);
  assert.deepEqual((await readInvestorContext(first, home))?.answers, synthetic);
  assert.match(output.messages.join(""), /모두의 주식 · MoAI ATP/);
  assert.doesNotMatch(output.messages.join(""), /SYNTHETIC_INVALID_INPUT/);
}));

test("refusing final save leaves no profile and does not repeat onboarding in another project", async () => fixture(async (home, first, second) => {
  const answers = questionnaire(); answers[answers.length - 1] = "NO";
  await runSetupFlow(first, async () => answers.shift() ?? "CANCEL", sink(), home);
  assert.equal(await readInvestorContext(first, home), undefined);
  await runSetupFlow(second, async () => { throw new Error("no repeat"); }, sink(), home);
}));

test("one question at a time uses Korean labels and supports a Korean home with spaces; canceled edit preserves profile", async () => fixture(async (home, first) => {
  const koreanHome = join(home, "사용자 이름"); await mkdir(koreanHome, { mode: 0o700 });
  const prompts: string[] = [], inputs = questionnaire();
  await runSetupFlow(first, async q => { prompts.push(q); return inputs.shift() ?? "CANCEL"; }, sink(), koreanHome);
  const file = investorContextFilePath(koreanHome), before = await readFile(file);
  assert.equal(prompts.length, 9);
  assert.match(prompts[1]!, /장기 성장.*배당 수입.*학습/);
  assert.doesNotMatch(prompts.join(""), /long_term_growth|domestic_equity|riskTolerance/);
  const cancel = ["YES", "1", "CANCEL"];
  await runSetupFlow(first, async () => cancel.shift() ?? "CANCEL", sink(), koreanHome, "edit");
  assert.deepEqual(await readFile(file), before);
}));

test("normal setup finishes context before credential setup and does not continue after failure", async () => {
  const calls: string[] = [];
  assert.equal(await dispatchGooseCommand(["setup"], async () => { calls.push("context"); return 0; }, sink(), async () => { calls.push("credentials"); return 0; }), 0);
  assert.deepEqual(calls, ["context", "credentials"]);
  assert.equal(await dispatchGooseCommand(["setup"], async () => 2, sink(), async () => { throw Error("must not run"); }), 2);
});
test("direct non-secret Korean choices map to confirmed enums without storing arbitrary text", async () => fixture(async (home, first) => {
  const actions = ["YES", "학습", "미정", "초보", "미정", "미정", "미정", "국내 주식", "SAVE"];
  await runSetupFlow(first, async () => actions.shift() ?? "CANCEL", sink(), home);
  assert.deepEqual((await readInvestorContext(first, home))?.answers, synthetic);
}));

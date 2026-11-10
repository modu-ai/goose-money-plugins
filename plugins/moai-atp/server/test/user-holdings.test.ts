import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, symlink, link, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { dispatchGooseCommand } from "../src/cli.js";
import { createHoldingsService, deleteHoldings, holdingsFilePath, parseManualHoldings, readHoldings, readHoldingsFile } from "../src/user-holdings.js";
import { runSetupFlow } from "../src/setup-cli.js";
import { createServiceEntitlementEvaluator } from "../src/entitlement.js";

const input = { as_of: "2026-11-10", currency: "KRW", positions: [{ symbol: "005930", market_value: "10000" }] };
const paid = () => ({ decision: "allow" as const, tier: "paid" as const });
async function fixture(run: (home: string, project: string, base: string) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), "atp-holdings-synthetic-"));
  const home = join(base, "home"), project = join(base, "project");
  await mkdir(home, { mode: 0o700 }); await mkdir(project, { mode: 0o700 });
  try { await run(home, project, base); } finally { await rm(base, { recursive: true, force: true }); }
}
test("manual input preserves missing optional quantities, cost, cash and liabilities", () => {
  assert.deepEqual(parseManualHoldings(input), input);
  for (const bad of [{ ...input, cash: "" }, { ...input, account_number: "9".repeat(8) }, { ...input, as_of: "2026-02-30" }, { ...input, positions: [{ symbol: "005930", quantity: "-1" }] }]) {
    assert.throws(() => parseManualHoldings(bad), /^HoldingsError: holdings_invalid$/);
  }
});
test("paid gate runs before file/credential access and rejects free, denied and thrown decisions", async () => {
  const evaluate = createServiceEntitlementEvaluator({ serviceId: "stock" });
  const free = evaluate.evaluate({ identity: { verified: true }, membership: { service_id: "stock", state: "joined" }, subscription: null, learner_grant: null, feature: "F14" });
  let reads = 0;
  for (const authorize of [() => free, () => ({ decision: "allow" as const, tier: "free" as const }), () => { throw new Error("synthetic-private"); }]) {
    const service = createHoldingsService(authorize);
    await assert.rejects(service.fromKis({ read: async () => { reads++; throw new Error("must not run"); } }), /holdings_entitlement_required/);
    await assert.rejects(service.fromFile("missing-private-file"), /holdings_entitlement_required/);
    await assert.rejects(service.manual(input), /holdings_entitlement_required/);
  }
  assert.equal(reads, 0);
  assert.deepEqual(await createHoldingsService(paid).manual(input), input);
  await assert.rejects(createHoldingsService(() => free).read("missing-project", "missing-home"), /holdings_entitlement_required/);
  await assert.rejects(createHoldingsService(() => free).save(input, "missing-project", { confirmed: true }), /holdings_entitlement_required/);
});
test("JSON import is bounded, owner-only, no symlink/hardlink/FIFO, and errors never echo content", () => fixture(async (_home, _project, base) => {
  const path = join(base, "input.json");
  await writeFile(path, JSON.stringify(input), { mode: 0o600 });
  if (process.platform === "win32") {
    await assert.rejects(readHoldingsFile(path), /holdings_unsafe_path/); return;
  }
  assert.deepEqual(await readHoldingsFile(path), input);
  const alias = join(base, "alias"); await symlink(path, alias);
  await assert.rejects(readHoldingsFile(alias), /holdings_unsafe_path/);
  await link(path, join(base, "hard"));
  await assert.rejects(readHoldingsFile(path), /holdings_unsafe_path/);
  await rm(join(base, "hard")); await chmod(path, 0o644);
  await assert.rejects(readHoldingsFile(path), /holdings_unsafe_path/);
  await chmod(path, 0o600); await writeFile(path, "synthetic-private");
  await assert.rejects(readHoldingsFile(path), /^HoldingsError: holdings_invalid$/);
  await writeFile(path, " ".repeat(300_001));
  await assert.rejects(readHoldingsFile(path), /holdings_invalid/);
  const fifo = join(base, "fifo"); execFileSync("mkfifo", [fifo]);
  await assert.rejects(readHoldingsFile(fifo), /holdings_unsafe_path/);
}));
test("CLI maps holdings deletion without printing input or calling credentials", async () => {
  const actions: string[] = [];
  const code = await dispatchGooseCommand(["setup", "--delete-holdings"], async a => { actions.push(a); return 0; }, { write: () => assert.fail("usage") }, async () => assert.fail("credentials"));
  assert.equal(code, 0); assert.deepEqual(actions, ["delete-holdings"]);
});
test("confirmed local save, explicit replacement, reload and setup deletion leave no derived files", { skip: process.platform === "win32" ? "POSIX-only storage; separate rejection test" : false }, () => fixture(async (home, project) => {
  const service = createHoldingsService(paid);
  await assert.rejects(service.save(input, project, { homeDir: home, confirmed: false }), /holdings_confirmation_required/);
  await service.save(input, project, { homeDir: home, confirmed: true });
  assert.deepEqual(await service.read(project, home), input);
  assert.deepEqual(await readHoldings(project, home), input);
  assert.equal((await stat(holdingsFilePath(home))).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(holdingsFilePath(home), "utf8")), input);
  await assert.rejects(service.save(input, project, { homeDir: home, confirmed: true }), /holdings_confirmation_required/);
  await service.save({ ...input, cash: "0" }, project, { homeDir: home, confirmed: true, replace: true });
  await assert.rejects(deleteHoldings(project, { homeDir: home, confirmed: false }), /holdings_confirmation_required/);
  const output: string[] = [];
  await runSetupFlow(project, async () => "NO", { write: s => output.push(s) }, home, "delete-holdings");
  assert.ok(await readHoldings(project, home));
  await runSetupFlow(project, async () => "DELETE", { write: s => output.push(s) }, home, "delete-holdings");
  assert.equal(await readHoldings(project, home), undefined);
  assert.equal(await deleteHoldings(project, { homeDir: home, confirmed: true }), false);
  assert.deepEqual(await readdir(join(home, ".goose", "context")), []);
  assert.doesNotMatch(output.join(""), /005930|10000/);
}));
test("a corrupt snapshot can still be deleted; a hardlink is never deleted", { skip: process.platform === "win32" ? "POSIX-only storage" : false }, () => fixture(async (home, project, base) => {
  await createHoldingsService(paid).save(input, project, { homeDir: home, confirmed: true });
  const path = holdingsFilePath(home);
  await writeFile(path, "synthetic-private");
  await assert.rejects(readHoldings(project, home), /^HoldingsError: holdings_invalid$/);
  await link(path, join(base, "alias"));
  await assert.rejects(deleteHoldings(project, { homeDir: home, confirmed: true }), /holdings_unsafe_path/);
  await rm(join(base, "alias"));
  assert.equal(await deleteHoldings(project, { homeDir: home, confirmed: true }), true);
  assert.equal(await readHoldings(project, home), undefined);
}));
test("storage rejects project-local and symlinked directories (Windows fails closed)", () => fixture(async (home, project) => {
  const service = createHoldingsService(paid);
  if (process.platform === "win32") {
    await assert.rejects(service.save(input, project, { homeDir: home, confirmed: true }), /holdings_unsafe_path/);
    assert.deepEqual(await readdir(home), []); return;
  }
  await assert.rejects(service.save(input, home, { homeDir: home, confirmed: true }), /holdings_unsafe_path/);
  await symlink(project, join(home, ".goose"));
  await assert.rejects(service.save(input, project, { homeDir: home, confirmed: true }), /holdings_unsafe_path/);
  assert.deepEqual(await readdir(project), []);
}));

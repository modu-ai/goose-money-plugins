// SPEC-ATP-RUNTIME-001 AC-RT-09, 10, 11, 14 (REQ-RT-008..013): one declaration source
// (plugins/moai-atp/server/package.json: engines.node = runtime range, devEngines.runtime.version = build pin) and every
// value-carrying site equal to it. Each site is also mutated alone in a temp copy of the tree, and the same
// check must then fail naming that site.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { SERVER_ROOT, loadOptionsModule, makeTempDir, removeDir } from "./runtime-entry-harness.js";

const OSS_ROOT = resolve(SERVER_ROOT, "..");

// Files the check reads, relative to plugins/moai-atp/. The same list is copied into a temp tree for each mutation.
const TREE_FILES = [
  "package.json", "CAPABILITIES.json", "server/package.json", "server/package-lock.json", "server/.nvmrc",
  "server/scripts/build-mjs.mjs", "server/scripts/build-mjs-options.mjs",
  "server/scripts/generate-kr-daily-raw-artifacts.mjs", "server/scripts/replay-kr-daily-raw-evidence.mjs",
  "server/scripts/build-kr-daily-raw-closure.mjs", "server/scripts/build-kr-daily-raw-evidence.sh",
  "server/scripts/build-sec-capture-slices.sh", "server/scripts/build-sec-capture-financial-selection.sh",
  "server/scripts/verify-kr-daily-raw-regression.sh", "server/test/kr-daily-raw-evidence.test.ts",
  "server/dist/src/runtime-guard.js",
  "scripts/build_runtime_bundle.py", "scripts/check_secrets.py",
  "tests/run-synthetic-kr-history.py", "tests/runtime_declaration_probe.py",
];

type Kind = "range" | "pin";
interface Source { range: string | null; pin: string | null }
interface Row {
  name: string;
  kind: Kind;
  vPrefixed?: boolean;
  /** File (relative to plugins/moai-atp/) whose text produces this site's value. */
  file: string;
  /** Returns the file text with only this site's value changed. */
  mutate(text: string): string;
}

function jsonMutator(change: (value: Record<string, any>) => void): (text: string) => string {
  return (text) => { const value = JSON.parse(text) as Record<string, any>; change(value); return JSON.stringify(value, null, 2) + "\n"; };
}
function replaceOnce(pattern: RegExp, replacement: string): (text: string) => string {
  return (text) => {
    assert.ok(pattern.test(text), `mutation anchor not found: ${String(pattern)}`);
    return text.replace(pattern, replacement);
  };
}
const MUTANT_RANGE = ">=22.2.1";
const MUTANT_PIN = "24.22.2";
const EVIDENCE_SCRIPTS: Array<[string, string]> = [
  ["ev_generate_kr_daily_raw_artifacts", "server/scripts/generate-kr-daily-raw-artifacts.mjs"],
  ["ev_replay_kr_daily_raw_evidence", "server/scripts/replay-kr-daily-raw-evidence.mjs"],
  ["ev_build_kr_daily_raw_closure", "server/scripts/build-kr-daily-raw-closure.mjs"],
  ["ev_build_kr_daily_raw_evidence_sh", "server/scripts/build-kr-daily-raw-evidence.sh"],
  ["ev_build_sec_capture_slices_sh", "server/scripts/build-sec-capture-slices.sh"],
  ["ev_build_sec_capture_financial_selection_sh", "server/scripts/build-sec-capture-financial-selection.sh"],
  ["ev_verify_kr_daily_raw_regression_sh", "server/scripts/verify-kr-daily-raw-regression.sh"],
  ["ev_run_synthetic_kr_history_py", "tests/run-synthetic-kr-history.py"],
];

// The 29 rows of acceptance.md AC-RT-14 (a), one name per row.
const ROWS: Row[] = [
  { name: "root_engines", kind: "range", file: "package.json", mutate: jsonMutator((v) => { v.engines.node = MUTANT_RANGE; }) },
  { name: "lock_root_engines", kind: "range", file: "server/package-lock.json", mutate: jsonMutator((v) => { v.packages[""].engines.node = MUTANT_RANGE; }) },
  { name: "cap_runtime_node", kind: "range", file: "CAPABILITIES.json", mutate: jsonMutator((v) => { v.runtime_node = MUTANT_RANGE; }) },
  { name: "guard_constant", kind: "range", file: "server/dist/src/runtime-guard.js", mutate: replaceOnce(/(RUNTIME_RANGE\s*=\s*)["'][^"']*["']/, `$1"${MUTANT_RANGE}"`) },
  { name: "manifest_writer_range", kind: "range", file: "server/scripts/build-mjs-options.mjs", mutate: replaceOnce(/node_runtime_range:\s*range\b/, `node_runtime_range: '${MUTANT_RANGE}'`) },
  { name: "validator_range", kind: "range", file: "scripts/build_runtime_bundle.py", mutate: replaceOnce(/return \{'range':declared_range,/, `return {'range':'${MUTANT_RANGE}',`) },
  { name: "receipt_range", kind: "range", file: "scripts/build_runtime_bundle.py", mutate: replaceOnce(/'node_runtime_range':declared\['range'\]/, `'node_runtime_range':'${MUTANT_RANGE}'`) },
  { name: "zip_root_engines", kind: "range", file: "scripts/build_runtime_bundle.py", mutate: replaceOnce(/\bpackage\.pop\('devEngines',None\)/, `package['engines']={'node':'${MUTANT_RANGE}'}`) },
  { name: "zip_server_engines", kind: "range", file: "scripts/build_runtime_bundle.py", mutate: replaceOnce(/\bserver\.pop\('devEngines',None\)/, `server['engines']={'node':'${MUTANT_RANGE}'}`) },
  { name: "root_devEngines", kind: "pin", file: "package.json", mutate: jsonMutator((v) => { v.devEngines.runtime.version = MUTANT_PIN; }) },
  { name: "lock_devEngines", kind: "pin", file: "server/package-lock.json", mutate: jsonMutator((v) => { v.packages[""].devEngines.runtime.version = MUTANT_PIN; }) },
  { name: "cap_build_node_pin", kind: "pin", file: "CAPABILITIES.json", mutate: jsonMutator((v) => { v.build_node_pin = MUTANT_PIN; }) },
  { name: "nvmrc", kind: "pin", file: "server/.nvmrc", mutate: () => `${MUTANT_PIN}\n` },
  { name: "build_guard", kind: "pin", file: "server/scripts/build-mjs.mjs", mutate: replaceOnce(/(process\.versions\.node\s*!==\s*)declaration\.node_build_pin/, "$1declaration.node_runtime_range") },
  { name: "manifest_writer_pin", kind: "pin", file: "server/scripts/build-mjs-options.mjs", mutate: replaceOnce(/node_build_pin:\s*pin\b/, `node_build_pin: '${MUTANT_PIN}'`) },
  { name: "manifest_node_required", kind: "pin", file: "server/scripts/build-mjs-options.mjs", mutate: replaceOnce(/node_required:\s*pin\b/, `node_required: '${MUTANT_PIN}'`) },
  { name: "summary_node_required", kind: "pin", file: "server/scripts/build-mjs.mjs", mutate: replaceOnce(/(dependencies_bundled:\s*true,\s*node_required:\s*)declaration\.node_required/, `$1'${MUTANT_PIN}'`) },
  { name: "validator_pin", kind: "pin", file: "scripts/build_runtime_bundle.py", mutate: replaceOnce(/'pin':pin\}/, `'pin':'${MUTANT_PIN}'}`) },
  { name: "receipt_node_required", kind: "pin", file: "scripts/build_runtime_bundle.py", mutate: replaceOnce(/'node_required':declared\['pin'\]/, `'node_required':'${MUTANT_PIN}'`) },
  { name: "receipt_build_pin", kind: "pin", file: "scripts/build_runtime_bundle.py", mutate: replaceOnce(/'node_build_pin':declared\['pin'\]/, `'node_build_pin':'${MUTANT_PIN}'`) },
  ...EVIDENCE_SCRIPTS.map(([name, file]): Row => ({ name, kind: "pin", vPrefixed: true, file, mutate: replaceOnce(/v24\.22\.1/, `v${MUTANT_PIN}`) })),
  { name: "buildpin_test_kr_daily_raw_evidence", kind: "pin", vPrefixed: true, file: "server/test/kr-daily-raw-evidence.test.ts", mutate: replaceOnce(/(process\.version,\s*')v24\.22\.1'/, `$1v${MUTANT_PIN}'`) },
];

async function readText(root: string, relative: string): Promise<string | null> {
  return readFile(join(root, relative), "utf8").catch(() => null);
}
async function readJson(root: string, relative: string): Promise<any | null> {
  const text = await readText(root, relative);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}
const firstMatch = (text: string | null, pattern: RegExp): string | null => (text === null ? null : (pattern.exec(text)?.[1] ?? null));

function runProbe(root: string): Record<string, string | null> {
  const python = process.platform === "win32" ? "python" : "python3";
  const run = spawnSync(python, ["-I", join(root, "tests", "runtime_declaration_probe.py"), root], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" }, timeout: 60_000 });
  try { return JSON.parse(run.stdout.trim().split("\n").pop() ?? "{}") as Record<string, string | null>; } catch { return {}; }
}

/** The value each row's site carries in the tree at `root` (a plugins/moai-atp/ layout), null when it cannot be read. */
async function readSites(root: string): Promise<{ source: Source; values: Record<string, string | null> }> {
  const server = await readJson(root, "server/package.json");
  const source: Source = { range: server?.engines?.node ?? null, pin: server?.devEngines?.runtime?.version ?? null };
  const lock = await readJson(root, "server/package-lock.json");
  const cap = await readJson(root, "CAPABILITIES.json");
  const rootPackage = await readJson(root, "package.json");
  const values: Record<string, string | null> = {};
  values.root_engines = rootPackage?.engines?.node ?? null;
  values.lock_root_engines = lock?.packages?.[""]?.engines?.node ?? null;
  values.cap_runtime_node = cap?.runtime_node ?? null;
  values.root_devEngines = rootPackage?.devEngines?.runtime?.version ?? null;
  values.lock_devEngines = lock?.packages?.[""]?.devEngines?.runtime?.version ?? null;
  values.cap_build_node_pin = cap?.build_node_pin ?? null;
  values.nvmrc = ((await readText(root, "server/.nvmrc")) ?? "").trim() || null;
  const guard = await import(pathToFileURL(join(root, "server/dist/src/runtime-guard.js")).href).catch(() => null) as { RUNTIME_RANGE?: unknown } | null;
  values.guard_constant = typeof guard?.RUNTIME_RANGE === "string" ? guard.RUNTIME_RANGE : null;
  const declaration = await loadOptionsModule(join(root, "server/scripts/build-mjs-options.mjs")).then((m) => m.runtimeDeclaration(join(root, "server"))).catch(() => null);
  values.manifest_writer_range = declaration?.node_runtime_range ?? null;
  values.manifest_writer_pin = declaration?.node_build_pin ?? null;
  values.manifest_node_required = declaration?.node_required ?? null;
  // build-mjs.mjs: the value is observed from the source text only (the file throws at import on any Node but the pin).
  const build = await readText(root, "server/scripts/build-mjs.mjs");
  const bound = build !== null && /const\s+declaration\s*=\s*runtimeDeclaration\(/.test(build);
  const guardExpr = firstMatch(build, /process\.versions\.node\s*!==\s*([\w.]+)/);
  values.build_guard = bound && guardExpr === "declaration.node_build_pin" ? (declaration?.node_build_pin ?? null) : guardExpr;
  const summaryExpr = firstMatch(build, /dependencies_bundled:\s*true,\s*node_required:\s*([\w.']+)/);
  values.summary_node_required = bound && summaryExpr === "declaration.node_required" ? (declaration?.node_required ?? null) : (summaryExpr?.replaceAll("'", "") ?? null);
  const probe = runProbe(root);
  values.validator_range = probe.validator_range ?? null;
  values.validator_pin = probe.validator_pin ?? null;
  values.receipt_range = probe.receipt_range ?? null;
  values.receipt_node_required = probe.receipt_node_required ?? null;
  values.receipt_build_pin = probe.receipt_build_pin ?? null;
  values.zip_root_engines = probe.zip_root_engines ?? null;
  values.zip_server_engines = probe.zip_server_engines ?? null;
  for (const [name, file] of EVIDENCE_SCRIPTS) {
    const text = await readText(root, file);
    values[name] = name.endsWith("_sh") ? firstMatch(text, /== (v\S+) \]\]/) : name === "ev_run_synthetic_kr_history_py" ? firstMatch(text, /== '(v[^']+)'/) : firstMatch(text, /process\.version!=='(v[^']+)'/);
  }
  values.buildpin_test_kr_daily_raw_evidence = firstMatch(await readText(root, "server/test/kr-daily-raw-evidence.test.ts"), /process\.version,\s*'(v[^']+)'/);
  return { source, values };
}

/** Names of the rows that disagree with the source (string identity; one leading "v" removed for v-prefixed sites). */
function disagreeing(read: { source: Source; values: Record<string, string | null> }): string[] {
  return ROWS.filter((row) => {
    if (row.name === "lock_devEngines" && read.values.lock_devEngines === null) return false; // npm wrote no devEngines (Gap G-7)
    const raw = read.values[row.name] ?? null;
    const value = raw !== null && row.vPrefixed === true ? (raw.startsWith("v") ? raw.slice(1) : null) : raw;
    const expected = read.source[row.kind];
    return value === null || expected === null || value !== expected;
  }).map((row) => row.name);
}

async function materialize(): Promise<string> {
  const dir = await makeTempDir("moai-rt-tree-");
  try {
    for (const relative of TREE_FILES) {
      const target = join(dir, "plugin", relative);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, (await readFile(join(OSS_ROOT, relative))));
    }
  } catch (error) {
    await removeDir(dir);
    throw error;
  }
  return dir;
}

test("declaration source: engines.node is a >=MAJOR.MINOR.PATCH range and devEngines.runtime names the build pin", async () => {
  const server = await readJson(OSS_ROOT, "server/package.json");
  assert.match(server?.engines?.node ?? "", /^>=\d+\.\d+\.\d+$/);
  assert.equal(server?.devEngines?.runtime?.name, "node");
  assert.match(server?.devEngines?.runtime?.version ?? "", /^\d+\.\d+\.\d+$/);
});

test("AC-RT-10: package.json files, lockfile and CAPABILITIES carry the split declaration", async () => {
  const pin = { name: "node", version: "24.22.1", onFail: "warn" };
  for (const file of ["package.json", "server/package.json"]) {
    const json = await readJson(OSS_ROOT, file);
    assert.deepEqual(json?.engines, { node: ">=22.2.0" }, `${file} engines`);
    assert.deepEqual(json?.devEngines?.runtime, pin, `${file} devEngines.runtime`);
  }
  const lock = await readJson(OSS_ROOT, "server/package-lock.json");
  assert.deepEqual(lock?.packages?.[""]?.engines, { node: ">=22.2.0" });
  const cap = await readJson(OSS_ROOT, "CAPABILITIES.json");
  assert.equal(cap?.runtime_node, ">=22.2.0");
  assert.equal(cap?.build_node_pin, "24.22.1");
  assert.equal("runtime_node_range" in (cap ?? {}), false);
});

test("REQ-RT-013 (a): every value-carrying site agrees with the declaration source", async () => {
  const read = await readSites(OSS_ROOT);
  assert.match(read.source.range ?? "", /^>=\d+\.\d+\.\d+$/);
  assert.notEqual(read.source.pin, null);
  assert.deepEqual(disagreeing(read), [], "sites that disagree with plugins/moai-atp/server/package.json");
});

test("REQ-RT-013 (a): changing any single site alone makes the same check fail and name that site", async (t) => {
  const base = await readSites(OSS_ROOT);
  const rows = ROWS.filter((row) => !(row.name === "lock_devEngines" && base.values.lock_devEngines === null));
  const failures: string[] = [];
  let mutants = 0;
  // Control: an unmodified temp copy must agree everywhere, so a mutant's report is caused by its mutation alone.
  const control = await materialize();
  try {
    assert.deepEqual(disagreeing(await readSites(join(control, "plugin"))), [], "the unmodified temp copy must agree with its source");
  } finally {
    await removeDir(control);
  }
  for (const row of rows) {
    const dir = await materialize();
    try {
      const root = join(dir, "plugin");
      const original = await readFile(join(root, row.file), "utf8");
      const changed = row.mutate(original);
      assert.notEqual(changed, original, `${row.name}: the mutation must change ${row.file}`);
      await writeFile(join(root, row.file), changed);
      mutants += 1;
      const names = disagreeing(await readSites(root));
      if (!names.includes(row.name)) failures.push(`${row.name} (reported: ${names.join(",") || "none"})`);
    } finally {
      await removeDir(dir);
    }
  }
  assert.deepEqual(failures, [], "mutations that the check did not catch");
  assert.equal(mutants, rows.length);
  assert.ok(mutants === 29 || (mutants === 28 && base.values.lock_devEngines === null), `mutant count ${mutants}`);
  t.diagnostic(`mutants caught: ${mutants} of ${ROWS.length} rows (lock_devEngines absent: ${String(base.values.lock_devEngines === null)})`);
});

test("REQ-RT-013 (b): build-mjs.mjs and build_runtime_bundle.py contain neither the build pin nor the range literal", async () => {
  for (const file of ["server/scripts/build-mjs.mjs", "scripts/build_runtime_bundle.py"]) {
    const text = await readText(OSS_ROOT, file);
    assert.notEqual(text, null, file);
    assert.equal((text ?? "").includes("24.22.1"), false, `${file} contains the build pin literal`);
    assert.equal((text ?? "").includes(">=22.2.0"), false, `${file} contains the range literal`);
  }
});

test("AC-RT-11: runtimeDeclaration() returns the declared values and the manifest writer, summary and build guard take them from it", async () => {
  const { runtimeDeclaration } = await loadOptionsModule();
  const server = await readJson(OSS_ROOT, "server/package.json");
  assert.deepEqual({ ...runtimeDeclaration() }, {
    node_runtime_range: server?.engines?.node,
    node_build_pin: server?.devEngines?.runtime?.version,
    node_required: server?.devEngines?.runtime?.version,
  });
  assert.deepEqual({ ...runtimeDeclaration() }, { node_runtime_range: ">=22.2.0", node_build_pin: "24.22.1", node_required: "24.22.1" });
  const build = (await readText(OSS_ROOT, "server/scripts/build-mjs.mjs")) ?? "";
  assert.match(build, /const\s+declaration\s*=\s*runtimeDeclaration\(/);
  assert.match(build, /process\.versions\.node\s*!==\s*declaration\.node_build_pin/);
  assert.match(build, /const\s+marker\s*=\s*'moai-atp-generated-mjs-v1'/);
  const manifest = /JSON\.stringify\(\{format:marker,([^}]*)\}/.exec(build)?.[1] ?? "";
  assert.match(manifest, /node_required:declaration\.node_required/);
  assert.match(manifest, /node_runtime_range:declaration\.node_runtime_range/);
  assert.match(manifest, /node_build_pin:declaration\.node_build_pin/);
  assert.match(build, /dependencies_bundled:true,node_required:declaration\.node_required,node_runtime_range:declaration\.node_runtime_range,node_build_pin:declaration\.node_build_pin/);
});

test("AC-RT-09: the r01 tests no longer pin the build Node; kr-daily keeps the pin only behind the build-pin judgement", async () => {
  for (const file of ["server/test/r01-chart-adapter.test.ts", "server/test/r01-kis-field-parsers.test.ts"]) {
    const text = (await readText(OSS_ROOT, file)) ?? "";
    assert.equal(text.includes("v24.22.1"), false, `${file} still pins the build Node`);
    assert.match(text, /satisfies the declared runtime range|run within the declared runtime range/);
  }
  const kr = (await readText(OSS_ROOT, "server/test/kr-daily-raw-evidence.test.ts")) ?? "";
  assert.match(kr, /const\s+buildPinSkip\s*=\s*process\.version\s*===\s*'v24\.22\.1'\s*\?\s*false\s*:/);
  assert.match(kr, /test\('KIS daily evidence uses pinned Node[^']*',\s*\{\s*skip:\s*buildPinSkip\s*\}/);
  assert.match(kr, /test\('desktop file replay rejects unsupported execution[^']*',\s*\{\s*skip:\s*buildPinSkip\s*\}/);
});

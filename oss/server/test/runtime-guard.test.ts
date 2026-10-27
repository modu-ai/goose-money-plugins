// SPEC-ATP-RUNTIME-001 AC-RT-01, 02, 03, 05 (REQ-RT-001..005, 007): the server entry checks the Node range
// before any server-graph module is resolved and fails closed with an MCP-readable error.
// The guard module is loaded by URL on purpose: the file compiles even before the module exists.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, describe, test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ABSOLUTE_PATH_PATTERN, COMPILED_ENTRY, SERVER_ROOT, TOOL_NAMES_SHA256,
  closeStdinDrive, compiledStaticClosure, disposeTempBundle, firstRequestBoundaryDrive, makeTempDir, provideTempBundle,
  removeDir, responses, runEntry, sameChunkDrive, sequentialDrive, staticImportSpecifiers, toolListDrive,
  writeResolveDenier, writeResolveRecorder, writeVersionPreload,
  type EntryResult,
} from "./runtime-entry-harness.js";
import { readFile } from "node:fs/promises";

interface GuardModule {
  RUNTIME_RANGE: string;
  isRuntimeSupported(nodeVersion: unknown, range?: unknown): boolean;
  runtimeUnsupportedMessage(processVersion: unknown): string;
  serverLoadFailedMessage(error: unknown): string;
}
const loadGuard = async (): Promise<GuardModule> => (await import(new URL("../src/runtime-guard.js", import.meta.url).href)) as GuardModule;

after(async () => { await disposeTempBundle(); });

describe("runtime guard (unit)", () => {
  test("rejects every version below 22.2.0 and accepts 22.2.0 and above", async () => {
    const guard = await loadGuard();
    for (const version of ["20.18.0", "21.7.3", "22.0.0", "22.1.0", "22.1.9"]) assert.equal(guard.isRuntimeSupported(version), false, version);
    for (const version of ["22.2.0", "22.14.0", "22.22.3", "24.22.0", "24.22.1", "25.9.0"]) assert.equal(guard.isRuntimeSupported(version), true, version);
  });
  test("rejects versions it cannot parse", async () => {
    const guard = await loadGuard();
    for (const version of ["", "abc", "22", "22.2", "v22.2.0", "22.2.0-nightly", "22.2.0 ", undefined, null, 22, {}]) assert.equal(guard.isRuntimeSupported(version), false, String(version));
  });
  test("reads only the >=MAJOR.MINOR.PATCH range grammar and judges 22.2.0 by the range it is given", async () => {
    const guard = await loadGuard();
    assert.equal(guard.RUNTIME_RANGE, ">=22.2.0");
    assert.equal(guard.isRuntimeSupported("22.2.0", ">=22.2.0"), true);
    assert.equal(guard.isRuntimeSupported("22.2.0", ">=22.3.0"), false, "a different range constant flips the verdict");
    assert.equal(guard.isRuntimeSupported("22.3.0", ">=22.3.0"), true);
    for (const range of [">=22", ">=22.2", "^22.2.0", "~22.2.0", "22.2.0", ">22.2.0", ">=22.2.0 <23", "", null, 22]) assert.equal(guard.isRuntimeSupported("24.22.1", range), false, String(range));
    assert.equal(guard.isRuntimeSupported("24.22.1"), true, "an omitted range means the exported RUNTIME_RANGE");
  });
  test("messages carry the token, the range and the observed version, and nothing else", async () => {
    const guard = await loadGuard();
    assert.equal(guard.runtimeUnsupportedMessage("v20.18.0"), "node_runtime_unsupported required=>=22.2.0 observed=v20.18.0");
    assert.equal(guard.runtimeUnsupportedMessage("v22.1.0"), "node_runtime_unsupported required=>=22.2.0 observed=v22.1.0");
    for (const observed of ["", "abc", "v1.2", "22.1.0", "v22.1.0\n{}", "/Users/someone/node", undefined, 5]) {
      assert.equal(guard.runtimeUnsupportedMessage(observed), "node_runtime_unsupported required=>=22.2.0 observed=unparsable", String(observed));
    }
    assert.equal(guard.serverLoadFailedMessage(new SyntaxError("file:///Users/someone/x.js missing")), "server_load_failed error=SyntaxError");
    assert.equal(guard.serverLoadFailedMessage(new Error("secret")), "server_load_failed error=Error");
    for (const weird of [{ name: "bad name /with/slash" }, { name: "x".repeat(41) }, { name: 5 }, "text", null, undefined, Object.create(null)]) {
      assert.equal(guard.serverLoadFailedMessage(weird), "server_load_failed error=Error");
    }
    const hostile = { get name(): string { throw new Error("getter must not break the guard"); } };
    assert.equal(guard.serverLoadFailedMessage(hostile), "server_load_failed error=Error");
  });
});

test("AC-RT-02: the compiled entry statically links only the guard module and reaches the server graph by import()", async () => {
  const text = await readFile(COMPILED_ENTRY, "utf8");
  assert.deepEqual(staticImportSpecifiers(text), ["./runtime-guard.js"]);
  assert.match(text, /\bimport\(\s*["']\.\/server-main\.js["']\s*\)/);
});

interface EntryUnderTest { name: string; entry: string; allowedUrls: Set<string>; serverGraphUrls: string[] }
async function compiledEntry(): Promise<EntryUnderTest> {
  return { name: "compiled", entry: COMPILED_ENTRY, allowedUrls: await compiledStaticClosure(COMPILED_ENTRY), serverGraphUrls: [pathToFileURL(join(SERVER_ROOT, "dist", "src", "server-main.js")).href] };
}
async function bundledEntry(): Promise<EntryUnderTest> {
  const bundle = await provideTempBundle();
  return { name: "bundle", entry: bundle.entry, allowedUrls: new Set(bundle.analysis.staticFiles.map((file) => pathToFileURL(file).href)), serverGraphUrls: bundle.analysis.serverGraphOutputs.map((file) => pathToFileURL(file).href) };
}
const entryKinds: Array<[string, () => Promise<EntryUnderTest>]> = [["compiled", compiledEntry], ["bundle", bundledEntry]];

async function withScratch<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await makeTempDir("moai-rt-entry-");
  try { return await body(dir); } finally { await removeDir(dir); }
}

function assertSingleErrorAndExit(result: EntryResult, expectedMessage: RegExp, expectedIds: unknown[]): string {
  const seen = responses(result);
  assert.equal(seen.length, expectedIds.length, `responses: ${JSON.stringify(seen)}`);
  assert.deepEqual(seen.map((r) => r.id), expectedIds);
  assert.ok(seen.every((r) => r.outcome === "error"), "no response may carry a result");
  assert.ok(result.messages.every((m) => m !== null && m.jsonrpc === "2.0" && m.result === undefined));
  const message = seen[0]?.message ?? "";
  assert.match(message, expectedMessage);
  assert.equal(result.stdoutLines.length, 1, "stdout carries exactly one JSON-RPC line");
  assert.equal(result.killedByHarness, false, "the process ends by itself");
  assert.ok(result.exitCode !== null && result.exitCode !== 0, `exit code ${String(result.exitCode)}`);
  assert.deepEqual(result.stderrLines, [message], "stderr is exactly the same single line");
  assert.equal(ABSOLUTE_PATH_PATTERN.test(result.stderrText), false, "no absolute path on stderr");
  assert.equal(ABSOLUTE_PATH_PATTERN.test(message), false, "no absolute path in the error message");
  return message;
}

function assertResolvedWithinAllowedSet(under: EntryUnderTest, result: EntryResult, preloads: string[]): void {
  const allowed = new Set([...under.allowedUrls, ...preloads.map((file) => pathToFileURL(file).href)]);
  const outside = result.resolvedUrls.filter((url) => !url.startsWith("node:") && !allowed.has(url));
  assert.deepEqual(outside, [], "no module outside the entry's static closure may be resolved");
  assert.equal(result.resolvedUrls.filter((url) => under.serverGraphUrls.includes(url)).length, 0, "no server-graph module may be resolved");
}

for (const [kindName, load] of entryKinds) {
  describe(`${kindName} entry below the floor (simulated by preload)`, () => {
    for (const version of ["20.18.0", "22.1.0"]) {
      const expected = new RegExp(`^node_runtime_unsupported required=>=22\\.2\\.0 observed=v${version.replaceAll(".", "\\.")}$`);
      test(`AC-RT-01 ${version}: the first request gets node_runtime_unsupported, nothing else is resolved or answered`, async () => {
        const under = await load();
        await withScratch(async (dir) => {
          const fake = await writeVersionPreload(dir, version);
          const recorder = await writeResolveRecorder(dir);
          const preloads = [fake, recorder.preload];
          const result = await runEntry({ entry: under.entry, preloads, resolveLog: recorder.log, drive: sequentialDrive() });
          assertSingleErrorAndExit(result, expected, [1]);
          assertResolvedWithinAllowedSet(under, result, preloads);
        });
      });
      test(`AC-RT-01 ${version}: only the first id-bearing request is answered (notification and non-JSON lines skipped)`, async () => {
        const under = await load();
        await withScratch(async (dir) => {
          const preloads = [await writeVersionPreload(dir, version)];
          const result = await runEntry({ entry: under.entry, preloads, drive: firstRequestBoundaryDrive() });
          assertSingleErrorAndExit(result, expected, [7]);
        });
      });
      test(`AC-RT-01 ${version}: two requests in one write get one answer, for the first`, async () => {
        const under = await load();
        await withScratch(async (dir) => {
          const preloads = [await writeVersionPreload(dir, version)];
          const result = await runEntry({ entry: under.entry, preloads, drive: sameChunkDrive() });
          assertSingleErrorAndExit(result, expected, [1]);
        });
      });
      test(`AC-RT-01 ${version}: stdin closing before any request writes nothing to stdout`, async () => {
        const under = await load();
        await withScratch(async (dir) => {
          const preloads = [await writeVersionPreload(dir, version)];
          const result = await runEntry({ entry: under.entry, preloads, drive: closeStdinDrive() });
          assert.deepEqual(result.stdoutLines, []);
          assert.equal(result.killedByHarness, false);
          assert.ok(result.exitCode !== null && result.exitCode !== 0);
          assert.equal(result.stderrLines.length, 1);
          assert.match(result.stderrLines[0] ?? "", expected);
          assert.equal(ABSOLUTE_PATH_PATTERN.test(result.stderrText), false);
        });
      });
    }
    for (const [label, nodeVersion, processVersion] of [["empty", "", ""], ["abc", "abc", "abc"]] as const) {
      test(`AC-RT-01 unparsable version (${label}): fails closed with observed=unparsable`, async () => {
        const under = await load();
        await withScratch(async (dir) => {
          const preloads = [await writeVersionPreload(dir, nodeVersion, processVersion)];
          const result = await runEntry({ entry: under.entry, preloads, drive: sequentialDrive() });
          assertSingleErrorAndExit(result, /^node_runtime_unsupported required=>=22\.2\.0 observed=unparsable$/, [1]);
        });
      });
    }
  });

  describe(`${kindName} entry within the range`, () => {
    for (const [label, simulated] of [["as run", undefined], ["reported as 22.2.0", "22.2.0"]] as const) {
      test(`AC-RT-05 ${label}: initialize result and the same 36 tool names, two stdout lines, silent stderr`, async () => {
        const under = await load();
        await withScratch(async (dir) => {
          const preloads = simulated === undefined ? [] : [await writeVersionPreload(dir, simulated)];
          const result = await runEntry({ entry: under.entry, preloads, drive: toolListDrive() });
          const seen = responses(result);
          assert.deepEqual(seen.map((r) => [r.id, r.outcome]), [[1, "result"], [2, "result"]]);
          const list = result.messages[1]?.result as { tools?: Array<{ name: string }> } | undefined;
          const names = (list?.tools ?? []).map((tool) => tool.name).sort();
          assert.equal(names.length, 36);
          assert.equal(createHash("sha256").update(names.join("\n")).digest("hex"), TOOL_NAMES_SHA256);
          assert.equal(result.stdoutLines.length, 2);
          assert.deepEqual(result.stderrLines, []);
        });
      });
    }
  });

  describe(`${kindName} entry when the server graph fails to load`, () => {
    const expected = /^server_load_failed error=[A-Za-z][A-Za-z0-9]{0,39}$/;
    test("AC-RT-03: the first request gets server_load_failed and the process ends non-zero", async () => {
      const under = await load();
      await withScratch(async (dir) => {
        const preloads = [await writeResolveDenier(dir, under.serverGraphUrls)];
        const result = await runEntry({ entry: under.entry, preloads, drive: sequentialDrive() });
        assertSingleErrorAndExit(result, expected, [1]);
      });
    });
    test("AC-RT-03: stdin closing before any request writes nothing to stdout", async () => {
      const under = await load();
      await withScratch(async (dir) => {
        const preloads = [await writeResolveDenier(dir, under.serverGraphUrls)];
        const result = await runEntry({ entry: under.entry, preloads, drive: closeStdinDrive() });
        assert.deepEqual(result.stdoutLines, []);
        assert.equal(result.killedByHarness, false);
        assert.ok(result.exitCode !== null && result.exitCode !== 0);
        assert.equal(result.stderrLines.length, 1);
        assert.match(result.stderrLines[0] ?? "", expected);
      });
    });
    test("AC-RT-03: only the first id-bearing request is answered", async () => {
      const under = await load();
      await withScratch(async (dir) => {
        const preloads = [await writeResolveDenier(dir, under.serverGraphUrls)];
        const result = await runEntry({ entry: under.entry, preloads, drive: firstRequestBoundaryDrive() });
        assertSingleErrorAndExit(result, expected, [7]);
      });
    });
  });
}

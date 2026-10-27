// SPEC-ATP-RUNTIME-001 AC-RT-04 (REQ-RT-006): the bundled entry's static import closure holds no builtin
// module and no server-graph module. The bundle is built in memory with the options module's object, the
// same object scripts/build-mjs.mjs spreads. A real `npm run build:mjs` needs the pinned Node (Gap G-3).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { SERVER_ROOT, bundleWithProductionOptions, loadOptionsModule } from "./runtime-entry-harness.js";

test("AC-RT-04: main.mjs reaches no builtin and no server-graph input through static imports", async () => {
  const { analysis } = await bundleWithProductionOptions(join(SERVER_ROOT, "bundle-closure-memory-only"), false);
  assert.deepEqual(analysis.staticBuiltins, []);
  assert.equal(analysis.serverGraphInStaticClosure, false);
  assert.ok(analysis.mainDynamicImports.length >= 1, "the server graph is reached by dynamic import()");
  assert.ok(analysis.serverGraphOutputs.length >= 1, "the server graph still exists as an output");
  assert.ok(analysis.serverGraphOutputs.every((file) => !analysis.staticFiles.includes(file)));
});

function deepFrozen(value: unknown, path: string, problems: string[]): void {
  if (value === null || typeof value !== "object") return;
  if (!Object.isFrozen(value)) problems.push(path);
  for (const [key, child] of Object.entries(value)) deepFrozen(child, `${path}.${key}`, problems);
}

test("AC-RT-04: the options object and every nested object or array is frozen", async () => {
  const { bundleOptions } = await loadOptionsModule();
  const problems: string[] = [];
  deepFrozen(bundleOptions, "bundleOptions", problems);
  assert.deepEqual(problems, []);
  assert.equal(Object.isFrozen(bundleOptions), true);
});

/** Text of the object literal passed to the first `build(` call, split into top-level members. */
function buildCallMembers(source: string): string[] {
  const open = source.indexOf("build({");
  assert.ok(open >= 0, "build({ ... }) call not found");
  const start = open + "build(".length;
  const members: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i] as string;
    if (quote !== "") { current += ch; if (ch === quote && source[i - 1] !== "\\") quote = ""; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; current += ch; continue; }
    if (ch === "{" || ch === "(" || ch === "[") { depth += 1; if (depth === 1) continue; }
    if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1;
      if (depth === 0) { if (current.trim() !== "") members.push(current.trim()); return members; }
    }
    if (ch === "," && depth === 1) { if (current.trim() !== "") members.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  throw new Error("unterminated build( call");
}

test("AC-RT-04: build-mjs.mjs spreads the options object and adds only outdir and absWorkingDir", async () => {
  const source = await readFile(join(SERVER_ROOT, "scripts", "build-mjs.mjs"), "utf8");
  assert.match(source, /import\s*\{[^}]*\bbundleOptions\b[^}]*\}\s*from\s*['"]\.\/build-mjs-options\.mjs['"]/);
  const members = buildCallMembers(source);
  assert.equal(members[0], "...bundleOptions");
  const added = members.slice(1).map((member) => (/^([A-Za-z]+)\s*:/.exec(member)?.[1] ?? member));
  assert.deepEqual([...added].sort(), ["absWorkingDir", "outdir"]);
  assert.equal(/\bdelete\s+bundleOptions\b/.test(source), false, "no delete on the options binding");
  assert.equal(/\bbundleOptions\s*(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|\?\?|\|\||&&)?=(?!=)/.test(source), false, "no assignment into the options binding");
  assert.equal(/\bbundleOptions\s*=(?!=)/.test(source.replace(/import\s*\{[^}]*\}\s*from[^;]*;/, "")), false, "no re-binding of the options");
});

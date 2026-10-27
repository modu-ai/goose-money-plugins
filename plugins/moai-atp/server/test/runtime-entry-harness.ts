// Test-only support for SPEC-ATP-RUNTIME-001 entry tests (not a test file: the name has no ".test").
// Everything here is synthetic: no credentials, no network, spawn env is an explicit minimal object.
// Test seams (version preload, resolve recorder, resolve denier) live only in files this module writes
// into a temp directory; production code knows nothing about them.
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type BuildOptions, type Metafile } from "esbuild";

/** oss/server, derived from this file at dist/test/. */
export const SERVER_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const COMPILED_ENTRY = join(SERVER_ROOT, "dist", "src", "main.js");
export const OPTIONS_MODULE = join(SERVER_ROOT, "scripts", "build-mjs-options.mjs");
export const EXIT_WAIT_MS = 10_000;
/** sha256 of the sorted tool-name list joined by "\n" (36 tools at 5e2b25b, research.md R2-4). */
export const TOOL_NAMES_SHA256 = "a1ab8f99498a77d7710ba4d4aa3432d0f48335096009906a2350c0ea28bd2543";
export const ABSOLUTE_PATH_PATTERN = /file:\/\/\/|(^|[\s"'(=:])(\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\)/;

export interface BundleOptionsModule {
  bundleOptions: Record<string, unknown>;
  runtimeDeclaration(serverRoot?: string): { node_runtime_range: string; node_build_pin: string; node_required: string };
}
export async function loadOptionsModule(path: string = OPTIONS_MODULE): Promise<BundleOptionsModule> {
  return (await import(pathToFileURL(path).href)) as BundleOptionsModule;
}

export type JsonRpcMessage = Record<string, unknown>;
export interface EntryResult {
  stdoutLines: string[];
  messages: Array<JsonRpcMessage | null>;
  stderrText: string;
  stderrLines: string[];
  exitCode: number | null;
  killedByHarness: boolean;
  resolvedUrls: string[];
}
export interface EntryController {
  write(text: string): void;
  endStdin(): void;
  sleep(ms: number): Promise<void>;
  /** Resolves once `count` stdout lines arrived, the process exited, or the timeout elapsed. */
  waitForLines(count: number, timeoutMs: number): Promise<void>;
  /** Resolves true when the process exited on its own within the timeout. */
  waitForExit(timeoutMs: number): Promise<boolean>;
}

function minimalEnv(): Record<string, string> {
  return process.platform === "win32"
    ? { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" }
    : { PATH: "/usr/bin:/bin" };
}

export async function runEntry(options: {
  entry: string;
  nodeBinary?: string;
  preloads?: string[];
  resolveLog?: string;
  drive: (control: EntryController) => Promise<void>;
}): Promise<EntryResult> {
  const args = [...(options.preloads ?? []).flatMap((file) => ["--import", pathToFileURL(file).href]), options.entry];
  const child = spawn(options.nodeBinary ?? process.execPath, args, { stdio: ["pipe", "pipe", "pipe"], env: minimalEnv(), cwd: SERVER_ROOT });
  let stdoutText = "";
  let stderrText = "";
  let exited = false;
  let exitCode: number | null = null;
  const waiters: Array<() => void> = [];
  const notify = (): void => { for (const wake of waiters.splice(0)) wake(); };
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdoutText += chunk; notify(); });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderrText += chunk; notify(); });
  child.stdin.on("error", () => {});
  child.on("exit", (code) => { exited = true; exitCode = code; notify(); });
  // Only newline-terminated lines count as arrived: a large response can reach us in several chunks.
  const lineCount = (): number => stdoutText.split("\n").slice(0, -1).filter((line) => line.length > 0).length;
  const waitFor = (done: () => boolean, timeoutMs: number): Promise<void> => new Promise((settle) => {
    const timer = setTimeout(settle, timeoutMs);
    const check = (): void => {
      if (done()) { clearTimeout(timer); settle(); } else waiters.push(check);
    };
    check();
  });
  const control: EntryController = {
    write: (text) => { try { child.stdin.write(text); } catch { /* the child may already be gone */ } },
    endStdin: () => { try { child.stdin.end(); } catch { /* ignore */ } },
    sleep: (ms) => new Promise((settle) => setTimeout(settle, ms)),
    waitForLines: (count, timeoutMs) => waitFor(() => lineCount() >= count || exited, timeoutMs),
    waitForExit: async (timeoutMs) => { await waitFor(() => exited, timeoutMs); return exited; },
  };
  let killedByHarness = false;
  try {
    await options.drive(control);
  } finally {
    if (!exited) {
      killedByHarness = true;
      child.kill();
      await waitFor(() => exited, 5_000);
    }
  }
  const stdoutLines = stdoutText.split("\n").filter((line) => line.length > 0);
  const messages = stdoutLines.map((line) => { try { return JSON.parse(line) as JsonRpcMessage; } catch { return null; } });
  const resolvedUrls = options.resolveLog === undefined ? [] : (await readFile(options.resolveLog, "utf8").catch(() => "")).split("\n").filter(Boolean);
  return { stdoutLines, messages, stderrText, stderrLines: stderrText.split("\n").filter((line) => line.length > 0), exitCode, killedByHarness, resolvedUrls };
}

export function request(id: number, method: string, params: unknown = {}): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}
export function notification(method: string): string {
  return JSON.stringify({ jsonrpc: "2.0", method }) + "\n";
}
export function initializeRequest(id: number): string {
  return request(id, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "probe", version: "1" } });
}

export interface ResponseSummary { id: unknown; outcome: "result" | "error" | "none"; message: string | null }
export function responses(result: EntryResult): ResponseSummary[] {
  return result.messages.filter((m): m is JsonRpcMessage => m !== null && "id" in m).map((m) => {
    const error = m.error as { message?: unknown } | undefined;
    return { id: m.id, outcome: m.result !== undefined ? "result" : error !== undefined ? "error" : "none", message: typeof error?.message === "string" ? error.message : null };
  });
}

// ---- drive scripts shared by the entry tests -------------------------------------------------------------

/** initialize (id 1) -> wait for its answer -> tools/list (id 2) -> wait for the process to end by itself. */
export function sequentialDrive(): (control: EntryController) => Promise<void> {
  return async (control) => {
    control.write(initializeRequest(1));
    await control.waitForLines(1, EXIT_WAIT_MS);
    control.write(request(2, "tools/list"));
    await control.waitForExit(EXIT_WAIT_MS);
  };
}
/** AC-RT-01 Then 6 (a): notification, non-JSON line, tools/list (id 7) in three writes, then initialize (id 8). */
export function firstRequestBoundaryDrive(): (control: EntryController) => Promise<void> {
  return async (control) => {
    control.write(notification("notifications/initialized"));
    control.write("this line is not json\n");
    control.write(request(7, "tools/list"));
    await control.waitForLines(1, 800);
    control.write(initializeRequest(8));
    await control.waitForExit(EXIT_WAIT_MS);
  };
}
/** AC-RT-01 Then 6 (b): initialize (id 1) and tools/list (id 2) arrive in one write. */
export function sameChunkDrive(): (control: EntryController) => Promise<void> {
  return async (control) => {
    control.write(initializeRequest(1) + request(2, "tools/list"));
    await control.waitForExit(EXIT_WAIT_MS);
  };
}
/** stdin closes before any request arrives. */
export function closeStdinDrive(): (control: EntryController) => Promise<void> {
  return async (control) => {
    control.endStdin();
    await control.waitForExit(EXIT_WAIT_MS);
  };
}
/** In-range server: initialize, then tools/list; resolves with the process still running (the harness kills it). */
export function toolListDrive(): (control: EntryController) => Promise<void> {
  return async (control) => {
    control.write(initializeRequest(1));
    await control.waitForLines(1, EXIT_WAIT_MS);
    control.write(notification("notifications/initialized") + request(2, "tools/list"));
    await control.waitForLines(2, EXIT_WAIT_MS);
  };
}

// ---- temp-directory test seams ------------------------------------------------------------------------------

/** Real path of a fresh temp dir: Node's ESM resolver reports realpaths (macOS /var -> /private/var). */
export async function makeTempDir(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}
export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Preload that makes the process report another Node version (Node below the floor cannot be installed here). */
export async function writeVersionPreload(dir: string, nodeVersion: string, processVersion: string = `v${nodeVersion}`): Promise<string> {
  const file = join(dir, `fake-version-${Buffer.from(nodeVersion + "|" + processVersion).toString("hex")}.mjs`);
  await writeFile(file, [
    `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(nodeVersion)}, configurable: true });`,
    `Object.defineProperty(process, "version", { value: ${JSON.stringify(processVersion)}, configurable: true });`,
    "",
  ].join("\n"));
  return file;
}
/** Preload that appends the resolved URL of every module the child resolves to `log`. Observes only. */
export async function writeResolveRecorder(dir: string): Promise<{ preload: string; log: string }> {
  const log = join(dir, "resolve-log.txt");
  const preload = join(dir, "record-resolve.mjs");
  const hooks = "import { appendFileSync } from \"node:fs\"; let file; export async function initialize(data) { file = data.file; } export async function resolve(specifier, context, next) { const result = await next(specifier, context); appendFileSync(file, result.url + \"\\n\"); return result; }";
  await writeFile(log, "");
  await writeFile(preload, `import { register } from "node:module";\nregister(${JSON.stringify("data:text/javascript," + encodeURIComponent(hooks))}, { data: { file: ${JSON.stringify(log)} } });\n`);
  return { preload, log };
}
/** Preload that makes resolving any of `denyUrls` fail, after the entry itself resolved (a server-graph load failure). */
export async function writeResolveDenier(dir: string, denyUrls: string[]): Promise<string> {
  const preload = join(dir, "deny-resolve.mjs");
  const hooks = "let deny = []; export async function initialize(data) { deny = data.deny; } export async function resolve(specifier, context, next) { const result = await next(specifier, context); if (deny.includes(result.url)) throw new Error(\"injected_load_failure\"); return result; }";
  await writeFile(preload, `import { register } from "node:module";\nregister(${JSON.stringify("data:text/javascript," + encodeURIComponent(hooks))}, { data: { deny: ${JSON.stringify(denyUrls)} } });\n`);
  return preload;
}

// ---- static closures ----------------------------------------------------------------------------------------

/** File URLs reachable from `entry` through static (top-level) import/export-from statements of compiled JS only. */
export async function compiledStaticClosure(entry: string): Promise<Set<string>> {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    const url = pathToFileURL(file).href;
    if (seen.has(url)) continue;
    seen.add(url);
    const text = await readFile(file, "utf8");
    for (const specifier of staticImportSpecifiers(text)) {
      if (specifier.startsWith(".")) pending.push(resolve(dirname(file), specifier));
    }
  }
  return seen;
}
/** Specifiers of top-level `import ... from "x"`, `import "x"` and `export ... from "x"` lines (dynamic import( is excluded). */
export function staticImportSpecifiers(text: string): string[] {
  const found: string[] = [];
  const pattern = /^(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|^import\s*["']([^"']+)["']/gm;
  for (const match of text.matchAll(pattern)) found.push((match[1] ?? match[2]) as string);
  return found;
}

export interface BundleAnalysis {
  mainKey: string;
  /** Absolute paths of every output in main.mjs's static (import-statement) closure, main.mjs included. */
  staticFiles: string[];
  staticBuiltins: string[];
  mainDynamicImports: string[];
  /** Absolute paths of every output holding a server-graph input (src/credential-runtime.ts or @modelcontextprotocol/*). */
  serverGraphOutputs: string[];
  serverGraphInStaticClosure: boolean;
}
const SERVER_GRAPH_INPUT = /(?:^|\/)src\/credential-runtime\.ts$|node_modules\/@modelcontextprotocol\//;
export function analyzeBundle(metafile: Metafile, absWorkingDir: string): BundleAnalysis {
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  const outputs = metafile.outputs;
  const mainKey = Object.keys(outputs).find((key) => outputs[key]?.entryPoint === "src/main.ts");
  if (mainKey === undefined) throw new Error("bundle_main_output_missing");
  const seen = new Set<string>();
  const reached = new Set<string>();
  const stack = [mainKey];
  while (stack.length > 0) {
    const key = stack.pop() as string;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const edge of outputs[key]?.imports ?? []) {
      if (edge.kind !== "import-statement") continue;
      if (builtins.has(edge.path)) reached.add(edge.path);
      else if (outputs[edge.path] !== undefined) stack.push(edge.path);
    }
  }
  const holdsGraph = (key: string): boolean => Object.keys(outputs[key]?.inputs ?? {}).some((input) => SERVER_GRAPH_INPUT.test(input));
  return {
    mainKey,
    staticFiles: [...seen].map((key) => resolve(absWorkingDir, key)),
    staticBuiltins: [...reached].sort(),
    mainDynamicImports: (outputs[mainKey]?.imports ?? []).filter((edge) => edge.kind === "dynamic-import").map((edge) => edge.path),
    serverGraphOutputs: Object.keys(outputs).filter(holdsGraph).map((key) => resolve(absWorkingDir, key)),
    serverGraphInStaticClosure: [...seen].some(holdsGraph),
  };
}

/** Bundle with the options module's object exactly as build-mjs.mjs uses it (only outdir/absWorkingDir/write added). */
export async function bundleWithProductionOptions(outdir: string, write: boolean): Promise<{ metafile: Metafile; analysis: BundleAnalysis }> {
  const { bundleOptions } = await loadOptionsModule();
  const result = await build({ ...(bundleOptions as BuildOptions), absWorkingDir: SERVER_ROOT, outdir, write, metafile: true });
  return { metafile: result.metafile, analysis: analyzeBundle(result.metafile, SERVER_ROOT) };
}

export interface TempBundle { dir: string; entry: string; analysis: BundleAnalysis }
let tempBundle: Promise<TempBundle> | undefined;
/**
 * One on-disk bundle per test process, built from the production options in a temp directory laid out like
 * the shipped runtime (<dir>/runtime/src/*.mjs next to <dir>/package.json: package-metadata.ts reads ../../package.json).
 */
export function provideTempBundle(): Promise<TempBundle> {
  tempBundle ??= (async () => {
    const dir = await makeTempDir("moai-rt-bundle-");
    try {
      const { analysis } = await bundleWithProductionOptions(join(dir, "runtime", "src"), true);
      await writeFile(join(dir, "package.json"), await readFile(join(SERVER_ROOT, "package.json")));
      // The bundle requires ../contracts/<name>.json next to src/ (build-mjs.mjs stages these two, public-trimmed)
      // and reads ../../assets/report-runtime/* when it starts.
      await mkdir(join(dir, "runtime", "contracts"), { recursive: true });
      for (const name of ["report-route-bindings.v1.json", "report-layout-profiles.v1.json"]) {
        await writeFile(join(dir, "runtime", "contracts", name), await readFile(join(SERVER_ROOT, "contracts", name)));
      }
      await cp(join(SERVER_ROOT, "assets"), join(dir, "assets"), { recursive: true });
      return { dir, entry: join(dir, "runtime", "src", "main.mjs"), analysis };
    } catch (error) {
      await removeDir(dir);
      throw error;
    }
  })();
  return tempBundle;
}
export async function disposeTempBundle(): Promise<void> {
  if (tempBundle === undefined) return;
  const bundle = await tempBundle.catch(() => undefined);
  tempBundle = undefined;
  if (bundle !== undefined) await removeDir(bundle.dir);
}

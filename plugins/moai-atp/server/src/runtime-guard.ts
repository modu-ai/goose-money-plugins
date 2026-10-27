// Node runtime range guard (SPEC-ATP-RUNTIME-001). main.ts links this module statically and nothing else:
// it must stay free of imports, so it is resolved and evaluated before any server-graph module. It touches
// only the `process` global and syntax that Node 18 and later parse, so a Node below the floor still reaches it.

/** Execution range the server accepts. Same string as engines.node in oss/server/package.json. */
export const RUNTIME_RANGE = ">=22.2.0";

const RANGE_GRAMMAR = /^>=(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/;
const VERSION_GRAMMAR = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/;
const OBSERVED_GRAMMAR = /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const ERROR_NAME_GRAMMAR = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const MAX_LINE_CHARS = 1_048_576;
const SERVER_ERROR_CODE = -32000;

/**
 * True when `nodeVersion` (a `process.versions.node` style MAJOR.MINOR.PATCH) satisfies `range`.
 * Only the `>=MAJOR.MINOR.PATCH` grammar is read; anything else, or an unparsable version, is not supported.
 */
export function isRuntimeSupported(nodeVersion: unknown, range: unknown = RUNTIME_RANGE): boolean {
  if (typeof nodeVersion !== "string" || typeof range !== "string") return false;
  const floor = RANGE_GRAMMAR.exec(range);
  const observed = VERSION_GRAMMAR.exec(nodeVersion);
  if (floor === null || observed === null) return false;
  for (let i = 1; i <= 3; i += 1) {
    const have = Number(observed[i]);
    const need = Number(floor[i]);
    if (have !== need) return have > need;
  }
  return true;
}

/** Message for a Node outside the range. `processVersion` is `process.version`; anything unparsable is named so. */
export function runtimeUnsupportedMessage(processVersion: unknown): string {
  const observed = typeof processVersion === "string" && OBSERVED_GRAMMAR.test(processVersion) ? processVersion : "unparsable";
  return `node_runtime_unsupported required=${RUNTIME_RANGE} observed=${observed}`;
}

/** Message for a failed server-graph load: only a plain error name, never message, stack or path. */
export function serverLoadFailedMessage(error: unknown): string {
  let name = "Error";
  try {
    const candidate = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
    if (typeof candidate === "string" && ERROR_NAME_GRAMMAR.test(candidate)) name = candidate;
  } catch {
    // A hostile name getter must not break the failure path.
  }
  return `server_load_failed error=${name}`;
}

/**
 * Fail closed over MCP stdio: answer the first request that carries an id with a JSON-RPC error, flush
 * stdout, write the same text as one stderr line, and exit non-zero without reading further input. If stdin
 * closes before such a request arrives, write only the stderr line. No MCP SDK, no credentials, no network.
 */
export function failClosed(message: string): void {
  let finished = false;
  let buffer = "";
  let skipping = false;
  const finish = (reply: string | null): void => {
    if (finished) return;
    finished = true;
    process.stdin.removeListener("data", onData);
    process.stdin.pause();
    const report = (): void => {
      try {
        process.stderr.write(`${message}\n`, () => process.exit(1));
      } catch {
        process.exit(1);
      }
    };
    if (reply === null) {
      report();
      return;
    }
    try {
      process.stdout.write(reply, report);
    } catch {
      report();
    }
  };
  const handleLine = (line: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
    const request = parsed as { id?: unknown; method?: unknown };
    if (typeof request.method !== "string") return;
    if (typeof request.id !== "string" && typeof request.id !== "number") return;
    finish(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: SERVER_ERROR_CODE, message } })}\n`);
  };
  const onData = (chunk: string): void => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0 && !finished) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (skipping) skipping = false;
      else if (line.trim() !== "") handleLine(line);
      newline = buffer.indexOf("\n");
    }
    if (!finished && buffer.length > MAX_LINE_CHARS) {
      buffer = "";
      skipping = true;
    }
  };
  process.stdout.on("error", () => {});
  process.stderr.on("error", () => process.exit(1));
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onData);
  process.stdin.on("end", () => {
    if (finished) return;
    if (!skipping && buffer.trim() !== "") handleLine(buffer);
    finish(null);
  });
  process.stdin.on("error", () => finish(null));
}

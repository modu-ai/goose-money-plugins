import { RUNTIME_RANGE, failClosed, isRuntimeSupported, runtimeUnsupportedMessage, serverLoadFailedMessage } from "./runtime-guard.js";

// The only static import above is the guard: it has no imports of its own, so a Node outside the range
// answers over MCP before any server-graph module is resolved, linked or evaluated. The server graph
// (MCP SDK, credential runtime, built-ins that newer Node adds) is reached by dynamic import after the verdict.
if (!isRuntimeSupported(process.versions.node, RUNTIME_RANGE)) {
  failClosed(runtimeUnsupportedMessage(process.version));
} else {
  try {
    await import("./server-main.js");
  } catch (error) {
    failClosed(serverLoadFailedMessage(error));
  }
}

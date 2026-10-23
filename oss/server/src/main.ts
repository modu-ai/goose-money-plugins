import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createDenyByDefaultServer } from "./server.js";

// stdout is reserved for MCP protocol frames. Operational diagnostics must use
// sanitized stderr and must never include provider bodies or credentials.
serveStdio(() => createDenyByDefaultServer(), {
  legacy: "serve",
  maxSubscriptions: 0,
  onerror: () => {
    process.stderr.write("mcp_transport_error\n");
  },
});

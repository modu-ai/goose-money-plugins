import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createCredentialBackedServer, localReadSwitches } from "./credential-runtime.js";

// stdout is reserved for MCP protocol frames. Operational diagnostics must use
// sanitized stderr and must never include provider bodies or credentials.
const local=localReadSwitches(process.env);
serveStdio(() => createCredentialBackedServer({studentReleaseScope:true,rightsEnabled:local.kis,openDartEnabled:local.opendart,localReportViewEnabled:local.local_view,...(local.opendart?{authorizeOpenDartRead:async()=>true}:{})}), {
  legacy: "serve",
  maxSubscriptions: 0,
  onerror: () => {
    process.stderr.write("mcp_transport_error\n");
  },
});

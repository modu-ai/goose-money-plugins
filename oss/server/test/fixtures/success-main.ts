import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createStockMcpServer } from '../synthetic-member-access.js';

serveStdio(() => createStockMcpServer({
  rightsEnabled: true,
  origin: "synthetic",
  clock: () => "2026-10-21T12:00:00.000Z",
  transport: {
    async getMarketSnapshot() {
      return {
        stck_prpr: "70000",
        stck_oprc: "69000",
        stck_hgpr: "70500",
        stck_lwpr: "68800",
        prdy_vrss: "1000",
        prdy_vrss_sign: "1",
        prdy_ctrt: "1.45",
        acml_vol: "123456",
        stck_bsop_date: "20261020",
      };
    },
  },
}), { legacy: "serve" });

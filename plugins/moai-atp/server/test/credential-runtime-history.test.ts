import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createCredentialBackedServer } from './synthetic-member-access.js';

const base = "https://openapi.koreainvestment.com:9443";
const input = { symbol: "000660", board: "J", start_date: "2026-07-24", end_date: "2026-10-22", adjustment_code: "0" };

test("MCP get_price_history runs one synthetic OAuth then one fixed KIS-039 GET and fails closed on response drift", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (raw, init) => {
    const url = new URL(String(raw));
    const request = init ?? {};
    calls.push({ url, init: request });
    if (url.pathname === "/oauth2/tokenP") {
      return new Response(JSON.stringify({ access_token: "synthetic-token-never-real", access_token_token_expired: "2099-01-01 00:00:00" }), { status: 200 });
    }
    return new Response("not-json", { status: 200 });
  };
  const server = createCredentialBackedServer({
    rightsEnabled: true,
    env: { KIS_APP_KEY: "synthetic-app-key-never-real", KIS_APP_SECRET: "synthetic-app-secret-never-real" },
    fetchImpl,
  });
  const [client, peer] = InMemoryTransport.createLinkedPair();
  const waiting = new Map<number, (value: any) => void>();
  let id = 0;
  client.onmessage = (message) => {
    const response = message as any;
    const resolve = waiting.get(response.id);
    if (resolve) { waiting.delete(response.id); resolve(response); }
  };
  await client.start();
  await server.connect(peer);
  const rpc = async (method: string, params: Record<string, unknown>) => {
    const requestId = ++id;
    const result = new Promise<any>((resolve) => waiting.set(requestId, resolve));
    await client.send({ jsonrpc: "2.0", id: requestId, method, params } as any);
    return result;
  };
  try {
    const initialized = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "synthetic-test", version: "1" } });
    assert.ok(initialized.result?.protocolVersion);
    await client.send({ jsonrpc: "2.0", method: "notifications/initialized" } as any);
    const response = await rpc("tools/call", { name: "get_price_history", arguments: input });
    assert.equal(response.result?.isError, true);
    assert.match(response.result?.content?.[0]?.text ?? "", /schema_drift/);
    assert.equal(calls.length, 2, "one OAuth and one market-data request; no retry");
    assert.equal(calls[0]?.url.origin, base);
    assert.equal(calls[0]?.url.pathname, "/oauth2/tokenP");
    assert.equal(calls[0]?.init.method, "POST");
    assert.equal(calls[0]?.init.redirect, "error");
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
      grant_type: "client_credentials", appkey: "synthetic-app-key-never-real", appsecret: "synthetic-app-secret-never-real",
    });
    assert.equal(calls[1]?.url.origin, base);
    assert.equal(calls[1]?.url.pathname, "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice");
    assert.equal(calls[1]?.url.searchParams.get("FID_INPUT_ISCD"), "000660");
    assert.equal(calls[1]?.url.searchParams.get("FID_INPUT_DATE_1"), "20260724");
    assert.equal(calls[1]?.url.searchParams.get("FID_INPUT_DATE_2"), "20261022");
    assert.equal(new Headers(calls[1]?.init.headers).get("tr_id"), "FHKST03010100");
    assert.equal(new Headers(calls[1]?.init.headers).get("authorization"), "Bearer synthetic-token-never-real");
    assert.doesNotMatch(JSON.stringify(response), /synthetic-(?:app-key|app-secret|token)/);
  } finally {
    await server.close();
    await client.close();
  }
});

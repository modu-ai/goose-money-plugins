import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createCredentialBackedServer } from './synthetic-member-access.js';

const key = "SYNTHETIC_OPENDART_KEY_00000000000000000";
const input = { corp_code: "00126380", bgn_de: "20261021", end_de: "20261022", page_no: 1, page_count: 1 };
const denied = { corp_code: "00126380", bgn_de: "20261021", end_de: "20261022", page_no: 1, page_count: 1 };

async function setup(options: Parameters<typeof createCredentialBackedServer>[0] = {}) {
  const server = createCredentialBackedServer(options);
  const [client, peer] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (value: any) => void>();
  let id = 0;
  client.onmessage = (message) => {
    const response = message as any;
    const resolve = pending.get(response.id);
    if (resolve) { pending.delete(response.id); resolve(response); }
  };
  await client.start();
  await server.connect(peer);
  const rpc = async (method: string, params: Record<string, unknown>) => {
    const requestId = ++id;
    const result = new Promise<any>((resolve) => pending.set(requestId, resolve));
    await client.send({ jsonrpc: "2.0", id: requestId, method, params } as any);
    return result;
  };
  const initialize = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "synthetic-test", version: "1" } });
  assert.ok(initialize.result?.protocolVersion);
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" } as any);
  return { server, client, rpc };
}

test("OpenDART runtime is disabled by default before credentials or transport", async () => {
  let fetches = 0;
  const s = await setup({ env: { OPENDART_API_KEY: key }, fetchImpl: async () => { fetches++; throw new Error("unexpected fetch"); } });
  try {
    const response = await s.rpc("tools/call", { name: "get_public_filings", arguments: input });
    assert.equal(response.result?.isError, true);
    assert.match(response.result?.content?.[0]?.text ?? "", /source_not_enabled/);
    assert.equal(fetches, 0);
  } finally { await s.server.close(); await s.client.close(); }
});

test("explicit OpenDART authorization budgets one synthetic HTTP attempt per requested tool call", async () => {
  let authorizations = 0, fetches = 0;
  const urls: URL[] = [];
  const s = await setup({
    openDartEnabled: true,
    openDartOrigin: "synthetic",
    authorizeOpenDartRead: async () => { authorizations++; return true; },
    env: { OPENDART_API_KEY: key },
    fetchImpl: async (raw) => {
      fetches++;
      const url = new URL(String(raw)); urls.push(url);
      return new Response(JSON.stringify({ status: "013", message: "합성 데이터 없음" }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  try {
    const response = await s.rpc("tools/call", { name: "get_public_filings", arguments: input });
    const text = response.result?.content?.[0]?.text ?? "";
    assert.equal(response.result?.isError, undefined);
    assert.match(text, /no_data/);
    assert.equal(fetches, 1, "one explicit provider attempt only");
    assert.equal(authorizations, 3, "authorize before key read, before request, and before audit commit");
    assert.equal(urls[0]?.origin, "https://opendart.fss.or.kr");
    assert.equal(urls[0]?.pathname, "/api/list.json");
    assert.equal(urls[0]?.searchParams.get("crtfc_key"), key);
    assert.equal(urls[0]?.searchParams.get("corp_code"), input.corp_code);
    assert.doesNotMatch(text, new RegExp(key));
    const second = await s.rpc("tools/call", { name: "get_fundamentals", arguments: { corp_code: "00126380", bsns_year: "2025", reprt_code: "11011", fs_div: "CFS" } });
    assert.equal(second.result?.isError, undefined);
    assert.match(second.result?.content?.[0]?.text ?? "", /no_data/);
    assert.equal(fetches, 2, "each explicit tool call has one attempt; no retry");
    assert.equal(authorizations, 6);
  } finally { await s.server.close(); await s.client.close(); }
});

test("OpenDART enablement without an explicit authorization callback stays disabled", async () => {
  let fetches = 0;
  const s = await setup({ openDartEnabled: true, env: { OPENDART_API_KEY: key }, fetchImpl: async () => { fetches++; throw new Error("unexpected fetch"); } });
  try {
    const response = await s.rpc("tools/call", { name: "get_public_filings", arguments: denied });
    assert.equal(response.result?.isError, true);
    assert.match(response.result?.content?.[0]?.text ?? "", /source_not_enabled/);
    assert.equal(fetches, 0);
  } finally { await s.server.close(); await s.client.close(); }
});

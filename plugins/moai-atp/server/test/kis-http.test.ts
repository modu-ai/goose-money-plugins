import assert from "node:assert/strict";
import test from "node:test";
import { AllowListedKisQuoteTransport, RequestPacer, SafeKisError } from "../src/kis-http.js";

const fakeCredentials = {
  async getForMarketRead() {
    return { appKey: "synthetic-app-key", appSecret: "synthetic-app-secret", accessToken: "synthetic-token" };
  },
};

test("KIS transport calls only fixed quote endpoint and returns a bounded validated response", async () => {
  let calls = 0;
  const mockFetch: typeof fetch = async (input, init) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.origin, "https://openapi.koreainvestment.com:9443");
    assert.equal(url.pathname, "/uapi/domestic-stock/v1/quotations/inquire-price");
    assert.equal(url.searchParams.get("FID_INPUT_ISCD"), "000660");
    assert.equal(url.searchParams.get("FID_COND_MRKT_DIV_CODE"), "J");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("tr_id"), "FHKST01010100");
    assert.equal(headers.get("custtype"), "P");
    return new Response(JSON.stringify({ rt_cd: "0", output: { stck_prpr: "70000" } }), { status: 200 });
  };
  const client = new AllowListedKisQuoteTransport("production", fakeCredentials, mockFetch, 300_000, new RequestPacer(0));
  const quote = await client.getMarketSnapshot("000660", "J");
  assert.equal(calls, 1);
  assert.deepEqual(quote, { stck_prpr: "70000" });
});

test("transport sanitizes upstream errors and does not retry redirects, auth failures, or rate limits", async () => {
  for (const [status, expected] of [[302, "upstream_unavailable"], [401, "auth_expired"], [429, "rate_limited"]] as const) {
    let calls = 0;
    const client = new AllowListedKisQuoteTransport("paper", fakeCredentials, async () => {
      calls += 1;
      return new Response("provider body with sensitive details", { status });
    }, 300_000, new RequestPacer(0));
    await assert.rejects(client.getMarketSnapshot("000660", "J"), (error: unknown) => {
      assert.ok(error instanceof SafeKisError);
      assert.equal(error.code, expected);
      assert.equal(error.message, expected);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("invalid symbols fail before credential retrieval or network access", async () => {
  let credentialReads = 0;
  const client = new AllowListedKisQuoteTransport("production", {
    async getForMarketRead() { credentialReads += 1; return { appKey: "", appSecret: "", accessToken: "" }; },
  }, async () => { throw new Error("network should not be reached"); }, 300_000, new RequestPacer(0));
  await assert.rejects(client.getMarketSnapshot("000660;anything", "J"), /invalid_input/);
  assert.equal(credentialReads, 0);
});

test("bounded response reader rejects an oversized body before parsing provider fields", async () => {
  const client = new AllowListedKisQuoteTransport("production", fakeCredentials, async () => {
    return new Response("ignored", { status: 200, headers: { "content-length": "1000" } });
  }, 10, new RequestPacer(0));
  await assert.rejects(client.getMarketSnapshot("000660", "J"), /response_too_large/);
});

test("request pacer serializes concurrent reservations", async () => {
  const pacer = new RequestPacer(25);
  const starts: number[] = [];
  const started = Date.now();
  await Promise.all([pacer.reserve(), pacer.reserve(), pacer.reserve()]);
  starts.push(Date.now() - started);
  assert.ok(starts[0]! >= 40);
});

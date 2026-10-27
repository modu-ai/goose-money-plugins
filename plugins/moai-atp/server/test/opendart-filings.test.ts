import assert from "node:assert/strict";
import test from "node:test";
import { SafeOpenDartError } from "../src/opendart.js";
import { OPENDART_FILINGS_ENDPOINT, openDartFilingsResultSchema, parseOpenDartFilings, requestOpenDartFilings } from "../src/opendart-filings.js";
const input = { corp_code: "00126380", bgn_de: "20260101", end_de: "20261022", page_count: 1 };
const provenance = { origin: "synthetic", received_at: "2026-10-22T00:00:00Z" };
const row = { corp_cls: "Y", corp_name: "Synthetic Corp", corp_code: "00126380", stock_code: "005930", report_nm: "[기재정정]사업보고서", rcept_no: "20260301000001", flr_nm: "Synthetic Filer", rcept_dt: "20260301", rm: "정" };
const payload = { status: "000", message: "ok", page_no: 1, page_count: 1, total_count: 2, total_page: 2, list: [row] };
const fails = (code: string) => (error: unknown) => error instanceof SafeOpenDartError && error.code === code;
test("Filings preserves amendment title, filing identity, provenance, and explicit next page", () => {
  const result = parseOpenDartFilings(input, payload, provenance);
  assert.deepEqual(result.rows[0]!.raw, row);
  assert.equal(result.next_page_no, 2);
  assert.equal(result.has_more, true);
  assert.equal(result.request.last_reprt_at, "N");
  assert.equal(result.rows[0]!.filing_url, "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260301000001");
  assert.equal(openDartFilingsResultSchema.safeParse(result).success, true);
  const last = parseOpenDartFilings({ ...input, page_no: 2 }, { ...payload, page_no: 2 }, provenance);
  assert.equal(last.next_page_no, null); assert.equal(last.has_more, false);
});
test("Filings safe provider errors retain status, not provider messages", () => {
  for (const [code, status] of [["013", "no_data"], ["020", "rate_limited"], ["010", "error"]]) {
    const result = parseOpenDartFilings(input, { status: code, message: "secret-token" }, provenance);
    assert.equal(result.status, status); assert.equal(result.provider_status, code);
    assert.ok(!JSON.stringify(result).includes("secret-token"));
  }
});
test("Filings validates dates, company, bounds, and unknown request fields before sending", async () => {
  let calls = 0;
  const transport = { origin: "synthetic" as const, send: async () => { calls++; return payload; } };
  for (const bad of [{ ...input, corp_code: "" }, { ...input, bgn_de: "20260230" }, { ...input, end_de: "20251231" }, { ...input, page_no: 0 }, { ...input, page_no: 100000 }, { ...input, page_count: 101 }, { ...input, endpoint: "https://evil.invalid" }, { ...input, last_reprt_at: "X" }]) {
    await assert.rejects(requestOpenDartFilings(bad, transport, provenance), fails("invalid_input"));
  }
  await assert.rejects(requestOpenDartFilings(input, transport, { ...provenance, origin: "actual" }), fails("invalid_provenance"));
  assert.equal(calls, 0);
});
test("Filings rejects page/company/date mismatches and oversized rows", () => {
  for (const bad of [{ ...payload, page_no: 2 }, { ...payload, page_count: 2 }, { ...payload, list: [{ ...row, corp_code: "00000001" }] }, { ...payload, list: [{ ...row, rcept_dt: "20251231" }] }]) {
    assert.throws(() => parseOpenDartFilings(input, bad, provenance), fails("response_mismatch"));
  }
  for (const bad of [{ ...payload, total_page: 3 }, { ...payload, list: [row, row] }, { ...payload, list: Array(101).fill(row) }, { ...payload, list: [{ ...row, report_nm: "x".repeat(2049) }] }, { status: "000", message: "ok" }]) {
    assert.throws(() => parseOpenDartFilings(input, bad, provenance), fails("invalid_response"));
  }
});
test("Filings sends one fixed injected request and redacts transport errors", async () => {
  let calls = 0;
  const result = await requestOpenDartFilings(input, { origin: "synthetic", send: async request => {
    calls++; assert.equal(request.endpoint, OPENDART_FILINGS_ENDPOINT);
    assert.equal(request.operation, "opendart.public_filings"); assert.equal(request.method, "GET");
    assert.ok(Object.isFrozen(request.params)); return payload;
  } }, provenance);
  assert.equal(calls, 1); assert.equal(result.has_more, true);
  await assert.rejects(requestOpenDartFilings(input, { origin: "synthetic", send: async () => { throw new Error("secret"); } }, provenance), fails("transport_error"));
});
test('Filings request stamps receipt after deferred transport completion',async()=>{
 let now='2026-10-22T00:00:00Z';
 const result=await requestOpenDartFilings(input,{origin:'synthetic',async send(){await Promise.resolve();now='2026-10-22T00:02:00Z';return payload;}},()=>({origin:'synthetic',received_at:now}));
 assert.equal(result.provenance.received_at,'2026-10-22T00:02:00Z');assert.ok(result.provenance.received_at>'2026-10-22T00:01:00Z');
});

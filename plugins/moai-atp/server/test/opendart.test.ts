import assert from "node:assert/strict";
import test from "node:test";
import { OPENDART_ENDPOINT, SafeOpenDartError, openDartResultSchema, parseOpenDartAmount, parseOpenDartFullStatement, requestOpenDartFullStatement } from "../src/opendart.js";
const input = { corp_code: "00126380", bsns_year: "2025", reprt_code: "11012", fs_div: "CFS" };
const provenance = { origin: "synthetic", received_at: "2026-10-22T00:00:00Z" };
const row = { rcept_no: "20250814000001", corp_code: "00126380", bsns_year: "2025", reprt_code: "11012", sj_div: "IS", sj_nm: "손익계산서", account_id: "ifrs-full_Revenue", account_nm: "매출액", ord: "1", thstrm_nm: "제 57 기 반기", thstrm_amount: "9,007,199,254,740,993.25", thstrm_add_amount: "18,000,000,000,000,000.50", frmtrm_amount: "", frmtrm_q_amount: "-100.75", frmtrm_add_amount: "0", currency: "USD" };
const payload = { status: "000", message: "정상", list: [row] };
const fails = (code: string) => (error: unknown) => error instanceof SafeOpenDartError && error.message === code;

test("OpenDART preserves exact financial strings, periods, filing, basis and provenance", () => {
  const result = parseOpenDartFullStatement(input, payload, provenance);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.provenance, provenance);
  const entry = result.rows[0]!;
  assert.deepEqual(entry.raw, row);
  assert.equal(entry.fs_div, "CFS");
  assert.equal(entry.current_period_kind, "three_months");
  assert.equal(entry.raw.currency, "USD");
  assert.equal(entry.filing_url, "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20250814000001");
  assert.deepEqual(entry.amounts.current, { state: "value", raw: row.thstrm_amount, decimal: "9007199254740993.25" });
  assert.deepEqual(entry.amounts.prior, { state: "blank", raw: "" });
  assert.deepEqual(entry.amounts.two_years_prior, { state: "missing" });
  assert.deepEqual(entry.amounts.prior_comparable, { state: "value", raw: "-100.75", decimal: "-100.75" });
  assert.notDeepEqual(entry.amounts.current, entry.amounts.current_cumulative);
  assert.equal(openDartResultSchema.safeParse(result).success, true);
});
test("OpenDART does not invent currency or period dates", () => {
  const { currency: _, ...withoutCurrency } = row;
  const result = parseOpenDartFullStatement(input, { ...payload, list: [{ ...withoutCurrency, sj_div: "BS" }] }, provenance);
  assert.equal(result.rows[0]!.raw.currency, undefined);
  assert.equal(result.rows[0]!.current_period_kind, "unspecified");
  assert.equal("period_start" in result.rows[0]!, false);
});
test("OpenDART statuses are classified and provider messages never leak", () => {
  for (const [code, status] of [["013", "no_data"], ["020", "rate_limited"], ["010", "error"], ["900", "error"]]) {
    const result = parseOpenDartFullStatement(input, { status: code, message: "secret=credential" }, provenance);
    assert.equal(result.status, status);
    assert.equal(result.provider_status, code);
    assert.deepEqual(result.rows, []);
    assert.ok(!JSON.stringify(result).includes("credential"));
  }
});
test("OpenDART validates request and provenance before transport", async () => {
  let calls = 0;
  const transport = { origin: "synthetic" as const, send: async () => { calls++; return payload; } };
  for (const bad of [{ ...input, corp_code: "123" }, { ...input, bsns_year: "2014" }, { ...input, bsns_year: 2025 }, { ...input, reprt_code: "bad" }, { ...input, fs_div: "bad" }, { ...input, endpoint: "https://evil.invalid" }, { ...input, crtfc_key: "secret" }]) {
    await assert.rejects(requestOpenDartFullStatement(bad, transport, provenance), fails("invalid_input"));
  }
  await assert.rejects(requestOpenDartFullStatement(input, transport, { ...provenance, origin: "unknown" }), fails("invalid_provenance"));
  await assert.rejects(requestOpenDartFullStatement(input, transport, { ...provenance, received_at: "yesterday" }), fails("invalid_provenance"));
  assert.equal(calls, 0);
});
test("OpenDART transport is fixed, injected and safe", async () => {
  const result = await requestOpenDartFullStatement(input, { origin: "synthetic", send: async request => {
    assert.deepEqual(request, { operation: "opendart.full_statement", method: "GET", endpoint: OPENDART_ENDPOINT, params: input });
    assert.ok(Object.isFrozen(request)); assert.ok(Object.isFrozen(request.params));
    return payload;
  } }, provenance);
  assert.equal(result.status, "ok");
  await assert.rejects(requestOpenDartFullStatement(input, { origin: "synthetic", send: async () => { throw new Error("secret=credential"); } }, provenance), fails("transport_error"));
});
test("OpenDART rejects malformed and oversized responses with safe errors", () => {
  for (const bad of [null, { status: "000", message: "ok" }, { ...payload, list: Array(10001).fill(row) }, { ...payload, message: "x".repeat(2049) }, { ...payload, list: [{ ...row, thstrm_amount: 9007199254740993 }] }, { ...payload, list: [{ ...row, account_nm: "x".repeat(2049) }] }, { ...payload, status: "013" }]) {
    assert.throws(() => parseOpenDartFullStatement(input, bad, provenance), fails("invalid_response"));
  }
  for (const key of ["corp_code", "bsns_year", "reprt_code"]) {
    const changes = { corp_code: "00000001", bsns_year: "2024", reprt_code: "11011" };
    assert.throws(() => parseOpenDartFullStatement(input, { ...payload, list: [{ ...row, [key]: changes[key as keyof typeof changes] }] }, provenance), fails("response_mismatch"));
  }
});
test("OpenDART decimal syntax preserves blanks, signs and precision without coercion", () => {
  assert.deepEqual(parseOpenDartAmount("  "), { state: "blank", raw: "  " });
  assert.deepEqual(parseOpenDartAmount("+0.00"), { state: "value", raw: "+0.00", decimal: "+0.00" });
  for (const bad of [NaN, Infinity, null, "1e8", "1,2", "1.2.3", "-", " 12", "x".repeat(129)]) assert.throws(() => parseOpenDartAmount(bad), fails("invalid_response"));
});

test("OpenDART rejects transport provenance relabeling", async () => {
  let calls = 0;
  await assert.rejects(requestOpenDartFullStatement(input, { origin: "synthetic", send: async () => { calls++; return payload; } }, { ...provenance, origin: "actual" }), fails("invalid_provenance"));
  assert.equal(calls, 0);
});
test('OpenDART request stamps receipt after deferred transport completion',async()=>{
 let now='2026-10-22T00:00:00Z';
 const result=await requestOpenDartFullStatement(input,{origin:'synthetic',async send(){await Promise.resolve();now='2026-10-22T00:02:00Z';return payload;}},()=>({origin:'synthetic',received_at:now}));
 assert.equal(result.provenance.received_at,'2026-10-22T00:02:00Z');assert.ok(result.provenance.received_at>'2026-10-22T00:01:00Z');
});

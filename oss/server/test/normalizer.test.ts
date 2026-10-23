import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateProviderQuoteJson } from "../src/domain.js";
import { normalizeKrQuote } from "../src/normalize-kr-quote.js";

const fixtureUrl = new URL("../../../tests/fixtures/kr_quote_synthetic.json", import.meta.url);
const receivedAt = "2026-10-21T12:00:00.000Z";

async function fixtureOutput(): Promise<Record<string, unknown>> {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as { output: Record<string, unknown> };
  return fixture.output;
}

test("normalizes the reviewed synthetic KIS quote fixture with sign, units, date, and lineage", async () => {
  const output = await fixtureOutput();
  const snapshot = normalizeKrQuote(output, { symbol: "000660", board: "J", receivedAt, origin: "synthetic" });
  assert.equal(snapshot.data.last, "70000");
  assert.equal(snapshot.data.change, "-1000");
  assert.equal(snapshot.data.change_percent, "-1.41");
  assert.equal(snapshot.data.volume, "123456");
  assert.equal(snapshot.data.currency, "KRW");
  assert.equal(snapshot.data.price_unit, "KRW per share");
  assert.equal(snapshot.data.volume_unit, "shares");
  assert.equal(snapshot.provenance.source_as_of, "2026-10-20");
  assert.equal(snapshot.provenance.event_time, null);
  assert.equal(snapshot.provenance.received_at, receivedAt);
  assert.equal(snapshot.provenance.rights_status, "pending");
  assert.equal(snapshot.provenance.origin, "synthetic");
  assert.deepEqual(snapshot.data.source_field_values, {});
  assert.equal(snapshot.data.field_lineage.find((field) => field.normalized_field === "change")?.mapping_status, "derived");
});

test("preserves exact decimal strings and rejects numeric JSON values to avoid IEEE-754 conversion", () => {
  const snapshot = normalizeKrQuote({
    stck_prpr: "0.0000000100",
    stck_oprc: "9007199254740993.000001",
    stck_hgpr: "1,234,567.890000",
    stck_lwpr: "0",
    prdy_vrss: "0.00000001",
    prdy_vrss_sign: "2",
    prdy_ctrt: "0.000001",
    acml_vol: "0",
    stck_bsop_date: "20261021",
  }, { symbol: "000660", board: "NX", receivedAt, origin: "actual" });
  assert.equal(snapshot.data.last, "0.0000000100");
  assert.equal(snapshot.data.open, "9007199254740993.000001");
  assert.equal(snapshot.data.high, "1234567.890000");
  assert.equal(snapshot.data.change, "0.00000001");

  const numeric = normalizeKrQuote({ stck_prpr: 9007199254740993 }, { symbol: "000660", board: "J", receivedAt, origin: "actual" });
  assert.equal(numeric.data.last, null);
  assert.equal(numeric.data.null_reasons.last, "invalid_provider_decimal");
});

test("does not infer zero from null, malformed values, or an unknown provider sign", () => {
  const snapshot = normalizeKrQuote({
    stck_prpr: "7x", prdy_vrss: "12.00", prdy_vrss_sign: "9", stck_bsop_date: "20260230",
  }, { symbol: "000660", board: "J", receivedAt, origin: "actual" });
  assert.equal(snapshot.data.last, null);
  assert.equal(snapshot.data.change, null);
  assert.equal(snapshot.provenance.source_as_of, null);
  assert.equal(snapshot.data.null_reasons.last, "invalid_provider_decimal");
  assert.equal(snapshot.data.null_reasons.change, "unrecognized_provider_sign");
  assert.equal(snapshot.data.null_reasons.source_as_of, "invalid_provider_date");
});

test("runtime validation rejects malformed provider JSON and oversized responses with safe codes", () => {
  assert.throws(() => validateProviderQuoteJson("{not-json"), /schema_drift/);
  assert.throws(() => validateProviderQuoteJson(JSON.stringify({ output: {} }), 4), /response_too_large/);
  assert.throws(() => validateProviderQuoteJson(JSON.stringify({ output: [] })), /schema_drift/);
  assert.deepEqual(validateProviderQuoteJson(JSON.stringify({ rt_cd: "0", output: { stck_prpr: "1" }, extension: true })).output,
    { stck_prpr: "1" });
});


test("negative prices, fractional shares and contradictory unchanged sign are withheld", () => {
 const snapshot=normalizeKrQuote({stck_prpr:"-1",acml_vol:"1.5",prdy_vrss:"2",prdy_vrss_sign:"3",provider_secret:"never expose"},{symbol:"000660",board:"J",receivedAt,origin:"actual"});
 assert.equal(snapshot.data.last,null); assert.equal(snapshot.data.volume,null); assert.equal(snapshot.data.change,null);
 assert.equal(snapshot.data.null_reasons.last,"invalid_provider_domain");assert.equal(snapshot.data.null_reasons.volume,"invalid_provider_domain");assert.equal(snapshot.data.null_reasons.change,"provider_sign_magnitude_conflict");
 assert.equal(snapshot.provenance.partial,true);assert.deepEqual(snapshot.data.source_field_values,{});
});

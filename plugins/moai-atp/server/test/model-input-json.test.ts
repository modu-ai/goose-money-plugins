import assert from "node:assert/strict";
import test from "node:test";
import { calculateSimpleMovingAverage } from "../src/indicators.js";
import { normalizeKrQuote } from "../src/normalize-kr-quote.js";
import { ModelInputFactsSchema, selectQuoteFacts, serializeModelInputJson } from "../src/model-input-json.js";

test("typed JSON preserves decimal strings, leading-zero symbols, null and escaped text", () => {
  const facts = ModelInputFactsSchema.parse({
    contract: "moai.stock.llm-facts.v1",
    instrument: { market: "KR", symbol: "000660", asset_type: "equity" },
    times: { source_as_of: "2026-10-20", received_at: "2026-10-21T12:00:00.000Z", timezone: "Asia/Seoul" },
    facts: [
      { fact_id: "R01.last", value: "0.0000000100", unit: "KRW/share", currency: "KRW", source_field: "stck_prpr", evidence_ref: "dto:quote:last", status: "provider_observed" },
      { fact_id: "R01.open", value: "9007199254740993.000001", unit: "KRW/share", currency: "KRW", source_field: "stck_oprc", evidence_ref: "dto:quote:open", status: "provider_observed" },
      { fact_id: "R01.change", value: null, unit: "KRW/share", currency: "KRW", source_field: "prdy_vrss+prdy_vrss_sign", evidence_ref: "dto:quote:change", status: "missing" },
      { fact_id: "R01.volume", value: "123456", unit: "shares", currency: null, source_field: "acml_vol", evidence_ref: "dto:quote:volume", status: "provider_observed" },
      { fact_id: "R01.high", value: "line one, line two\nquotes \"and\" backslash \\", unit: "provider-text", currency: null, source_field: "fixture_extension", evidence_ref: "dto:fixture:extension", status: "provider_observed" },
    ],
    evidence_note: "Fact IDs resolve to canonical DTO or deterministic calculation lineage; missing values are not zero.",
  });
  const serialized = serializeModelInputJson(facts);
  const decoded = ModelInputFactsSchema.parse(JSON.parse(serialized));
  assert.deepEqual(decoded, facts);
  assert.equal(decoded.instrument.symbol, "000660");
  assert.equal(decoded.facts[0]?.value, "0.0000000100");
  assert.equal(decoded.facts[1]?.value, "9007199254740993.000001");
  assert.equal(decoded.facts[2]?.value, null);
  assert.equal(decoded.facts[4]?.value, "line one, line two\nquotes \"and\" backslash \\");
});

test("fact selector emits only requested canonical DTO fields and excludes provider extensions", () => {
  const snapshot = normalizeKrQuote({
    stck_prpr: "70000", stck_oprc: "69000", prdy_vrss: "1000", prdy_vrss_sign: "1",
    prdy_ctrt: "1.45", acml_vol: "1234", stck_bsop_date: "20261020", sensitive_extension: "omit",
  }, { symbol: "000660", board: "J", receivedAt: "2026-10-21T12:00:00.000Z", origin: "synthetic" });
  const selected = selectQuoteFacts(snapshot, ["last", "last"]);
  assert.equal(selected.facts.length, 1);
  assert.equal(selected.facts[0]?.value, "70000");
  assert.equal(JSON.stringify(selected).includes("sensitive_extension"), false);
});

test("deterministic SMA is decimal-safe and retains observation window and lineage", () => {
  const metric = calculateSimpleMovingAverage([
    { trade_date: "2026-10-16", close: "0.00000001", currency: "KRW", adjusted: false, source_ref: "fixture:bar:1" },
    { trade_date: "2026-10-19", close: "0.00000002", currency: "KRW", adjusted: false, source_ref: "fixture:bar:2" },
    { trade_date: "2026-10-20", close: "9007199254740993.000001", currency: "KRW", adjusted: false, source_ref: "fixture:bar:3" },
  ], 3);
  assert.equal(metric.value, "3002399751580331.00000034");
  assert.equal(metric.observation_count, 3);
  assert.equal(metric.observation_start, "2026-10-16");
  assert.equal(metric.observation_end, "2026-10-20");
  assert.equal(metric.adjusted, false);
  assert.equal(metric.source_refs.length, 3);
  assert.equal(metric.lineage_id, "calc.sma_3.2026-10-16.2026-10-20");
  const snapshot = normalizeKrQuote({ stck_prpr: "70000", stck_bsop_date: "20261020" }, {
    symbol: "000660", board: "J", receivedAt: "2026-10-21T12:00:00.000Z", origin: "synthetic",
  });
  const selected = selectQuoteFacts(snapshot, ["last"], [metric]);
  assert.equal(selected.facts.length, 2);
  assert.equal(selected.facts[1]?.fact_id, "R01.sma_3");
  assert.equal(selected.facts[1]?.value, metric.value);
  assert.equal(selected.facts[1]?.evidence_ref, metric.lineage_id);
  assert.deepEqual(ModelInputFactsSchema.parse(JSON.parse(serializeModelInputJson(selected))), selected);
});

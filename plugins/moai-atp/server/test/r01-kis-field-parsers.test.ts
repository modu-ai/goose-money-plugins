import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import dailyFixture from "./fixtures/kis039_daily_rows_synthetic.json" with { type: "json" };
import flowFixture from "./fixtures/kis115_investor_flow_synthetic.json" with { type: "json" };
import {
  R01_OPERATION_DIAGNOSTICS,
  SafeKisParserError,
  getR01OperationDiagnostic,
  parseKis039DailyChartResponse,
  parseKis115InvestorFlowResponse,
} from "../src/r01-kis-field-parsers.js";
import { R01_CHART_FIELD_REGISTRY } from "../src/r01-chart-adapter.js";
import { isRuntimeSupported } from "../src/runtime-guard.js";

const receivedAt = "2026-10-21T15:04:05.000Z";
const dailyContext = {
  symbol: "000000",
  board: "J" as const,
  startDate: "20261020",
  endDate: "20261021",
  periodCode: "D" as const,
  adjustmentCode: "0" as const,
  receivedAt,
  origin: "synthetic_fixture" as const,
};

function errorCode(fn: () => unknown, expected: string): void {
  assert.throws(fn, (error: unknown) => error instanceof SafeKisParserError && error.code === expected);
}

function cloneMutableResponse(value: unknown): { [key: string]: unknown; output2: Array<Record<string, unknown>> } {
  return structuredClone(value) as { [key: string]: unknown; output2: Array<Record<string, unknown>> };
}

test("the KIS field parser tests run within the declared runtime range", () => {
  assert.equal(isRuntimeSupported(process.versions.node), true);
});

test("KIS-039 parser keeps documented daily rows as provider strings and date-only values", () => {
  const rows = parseKis039DailyChartResponse(dailyFixture.response, dailyContext);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.provider_business_date, "2026-10-20");
  assert.equal(rows[0]?.raw_fields.stck_clpr.value, "12345");
  assert.equal(rows[0]?.raw_fields.stck_clpr.state, "present");
  assert.equal(rows[0]?.raw_fields.acml_vol.value, "987654");
  assert.equal(rows[1]?.raw_fields.stck_clpr.value, null);
  assert.equal(rows[1]?.raw_fields.stck_clpr.state, "blank");
  assert.equal(rows[1]?.source_as_of, null);
  assert.equal(rows[1]?.received_at, receivedAt);
  assert.equal(rows[0]?.observed_payload_origin, "synthetic_fixture");
  assert.equal(rows[0]?.response_row_status, "provider_field_shape_checked_not_live_reconciled");
  assert.equal(rows[0]?.response_range_completeness, "unknown_pagination_not_demonstrated");
  assert.equal(rows[0]?.requested_adjustment_code, "0");
  assert.equal(rows[0]?.adjustment_code_interpretation, "blocked_portal_sample_conflict");
  assert.equal(rows[0]?.canonical_projection_status, "blocked");
  assert.ok(rows[0]?.canonical_blockers.includes("price_currency_and_scale_not_stated_in_endpoint_schema"));
  assert.ok(!("adjusted" in (rows[0] ?? {})));
});

test("KIS-039 rejects upstream failure, malformed dates/numerics, range mismatch, duplicate rows, unknown keys, and >100 rows", () => {
  errorCode(() => parseKis039DailyChartResponse({ ...dailyFixture.response, rt_cd: "1" }, dailyContext), "upstream_rejected");
  const invalidDate = cloneMutableResponse(dailyFixture.response);
  invalidDate.output2[0]!.stck_bsop_date = "20261340";
  errorCode(() => parseKis039DailyChartResponse(invalidDate, dailyContext), "invalid_provider_business_date");
  const malformedNumber = cloneMutableResponse(dailyFixture.response);
  malformedNumber.output2[0]!.stck_clpr = "12,345";
  errorCode(() => parseKis039DailyChartResponse(malformedNumber, dailyContext), "provider_numeric_format_invalid");
  const outsideRange = cloneMutableResponse(dailyFixture.response);
  outsideRange.output2[0]!.stck_bsop_date = "20261019";
  errorCode(() => parseKis039DailyChartResponse(outsideRange, dailyContext), "provider_date_outside_requested_range");
  const duplicateDate = cloneMutableResponse(dailyFixture.response);
  duplicateDate.output2[1]!.stck_bsop_date = "20261020";
  errorCode(() => parseKis039DailyChartResponse(duplicateDate, dailyContext), "duplicate_provider_business_date");
  const unknownKey = cloneMutableResponse(dailyFixture.response);
  unknownKey.output2[0]!.future_provider_field = "not reviewed";
  errorCode(() => parseKis039DailyChartResponse(unknownKey, dailyContext), "provider_response_schema_drift");
  const tooManyRows = { ...dailyFixture.response, output2: Array.from({ length: 101 }, () => dailyFixture.response.output2[0]) };
  errorCode(() => parseKis039DailyChartResponse(tooManyRows, dailyContext), "provider_response_schema_drift");
});

test("KIS-039 rejects non-daily periods and reversed or invalid query windows before parsing", () => {
  errorCode(() => parseKis039DailyChartResponse(dailyFixture.response, { ...dailyContext, periodCode: "W" }), "invalid_input");
  errorCode(() => parseKis039DailyChartResponse(dailyFixture.response, { ...dailyContext, startDate: "20261021", endDate: "20261020" }), "invalid_input");
  errorCode(() => parseKis039DailyChartResponse(dailyFixture.response, { ...dailyContext, adjustmentCode: "2" }), "invalid_input");
});

test("KIS-115 converts documented 백만원 to KRW using decimal strings, never binary floating point", () => {
  const rows = parseKis115InvestorFlowResponse(flowFixture.response, {
    requestedInputDate: "20261020",
    receivedAt,
    origin: "synthetic_fixture",
  });
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.provider_business_date, "2026-10-20");
  assert.equal(row.raw_quote_fields.traded_amount.value_krw, "12345670000");
  assert.equal(row.actor_flows.foreign.net_buy_amount.raw_value, "12.3456");
  assert.equal(row.actor_flows.foreign.net_buy_amount.value_krw, "12345600");
  assert.equal(row.actor_flows.foreign.net_buy_amount.raw_unit, "KRW_million");
  assert.equal(row.actor_flows.foreign.net_buy_amount.normalized_unit, "KRW");
  assert.equal(row.actor_flows.individual.net_buy_amount.value_krw, "-1");
  assert.equal(row.actor_flows.institution.net_buy_amount.value_krw, "0");
  assert.equal(row.actor_flows.foreign.net_buy_quantity.value_shares, "100");
  assert.equal(row.separately_reported_foreign_quantities.registered.value_shares, "40");
  assert.equal(row.source_as_of, null);
  assert.equal(row.current_day_finality, "not_inferred_from_response");
  assert.equal(row.request_status, "official_portal_request_fields_encoded_sample_differs");
  assert.equal(row.observed_payload_origin, "synthetic_fixture");
  assert.equal(row.canonical_projection_status, "blocked");
});

test("KIS-115 keeps blanks/missing values distinct and rejects bad numeric/date/schema data", () => {
  const response = cloneMutableResponse(flowFixture.response);
  response.output2[0]!.frgn_ntby_tr_pbmn = "";
  delete response.output2[0]!.prsn_ntby_tr_pbmn;
  const [row] = parseKis115InvestorFlowResponse(response, {
    requestedInputDate: "20261020",
    receivedAt,
    origin: "synthetic_fixture",
  });
  assert.equal(row?.actor_flows.foreign.net_buy_amount.state, "blank");
  assert.equal(row?.actor_flows.individual.net_buy_amount.state, "missing");
  const malformedNumber = cloneMutableResponse(flowFixture.response);
  malformedNumber.output2[0]!.frgn_ntby_tr_pbmn = "1e6";
  errorCode(() => parseKis115InvestorFlowResponse(malformedNumber, { requestedInputDate: "20261020", receivedAt, origin: "synthetic_fixture" }), "provider_numeric_format_invalid");
  const unknownKey = cloneMutableResponse(flowFixture.response);
  unknownKey.output2[0]!.unexpected = "no";
  errorCode(() => parseKis115InvestorFlowResponse(unknownKey, { requestedInputDate: "20261020", receivedAt, origin: "synthetic_fixture" }), "provider_response_schema_drift");
  const differentRowDate = cloneMutableResponse(flowFixture.response);
  differentRowDate.output2[0]!.stck_bsop_date = "20261019";
  const [rowWithDifferentDate] = parseKis115InvestorFlowResponse(differentRowDate, { requestedInputDate: "20261020", receivedAt, origin: "synthetic_fixture" });
  assert.equal(rowWithDifferentDate?.requested_input_date, "20261020");
  assert.equal(rowWithDifferentDate?.provider_business_date, "2026-10-19");
  assert.equal(rowWithDifferentDate?.request_date_semantics, "input_parameter_to_row_relationship_not_assumed");
});

test("R01 diagnostic table blocks pagination, units, time and request conflicts without guessing", async () => {
  assert.equal(R01_OPERATION_DIAGNOSTICS.length, 10);
  const blockedPagination = ["KIS-254", "KIS-072", "KIS-264", "KIS-109"];
  for (const operationRef of blockedPagination) {
    const diagnostic = getR01OperationDiagnostic(operationRef);
    assert.equal(diagnostic.live_request_status, "not_implemented_or_blocked");
    assert.ok(diagnostic.blockers.some((blocker) => blocker.includes("pagination")));
  }
  for (const operationRef of ["KIS-039", "KIS-113"]) {
    const diagnostic = getR01OperationDiagnostic(operationRef);
    assert.equal(diagnostic.canonical_status, "blocked");
    assert.ok(diagnostic.blockers.some((blocker) => blocker.includes("unit") || blocker.includes("scale")));
  }
  for (const operationRef of ["KIS-303", "KIS-280"]) {
    assert.ok(getR01OperationDiagnostic(operationRef).blockers.some((blocker) => blocker.includes("time") || blocker.includes("timezone")));
  }
  assert.throws(() => getR01OperationDiagnostic("KIS-999"), /unknown_kis_operation/);

  const fixtureRaw = await readFile(new URL("./fixtures/kis039_daily_rows_synthetic.json", import.meta.url), "utf8");
  const parsedFixture = JSON.parse(fixtureRaw) as { fixture_metadata: { not_a_kis_response: boolean } };
  assert.equal(parsedFixture.fixture_metadata.not_a_kis_response, true);
});

test("the full R01 consumer crosswalk resolves every reference against the unchanged 147-field registry", async () => {
  const [crosswalkText, registryText, mappingText] = await Promise.all([
    readFile(new URL("../../../contracts/r01-consumer-supplier-registry-crosswalk-v1.json", import.meta.url), "utf8"),
    readFile(new URL("../../../contracts/report-data-source-registry-r1.json", import.meta.url), "utf8"),
    readFile(new URL("../../../contracts/kis-api-mapping-v1.json", import.meta.url), "utf8"),
  ]);
  const crosswalk = JSON.parse(crosswalkText) as {
    counts: {
      consumer_verification_pending: number;
      consumer_derived: number;
      invalid_registry_refs: number;
      source_candidate_links: number;
      unrepresented_or_non_equivalent: number;
      same_semantics_links: number;
      calculation_input_links: number;
    };
    sources: { supplier_registry: { sha256: string }; provider_mapping: { sha256: string }; runtime_contract: { sha256: string } };
    entries: Array<{
      consumer_field_id: string;
      consumer_status: string;
      relationship: string;
      supplier_registry_fields: string[];
      calculation_input_registry_fields: string[];
      status_effect: string;
      resolution_note: string;
    }>;
  };
  const registry = JSON.parse(registryText) as { field_registry: Array<{ field_name: string }> };
  const mapping = JSON.parse(mappingText) as { r01_chart_provider_binding: { field_bindings: Array<{ field_id: string; consumer_status_unchanged: string; consumer_supplier_registry_names: string[] }> } };
  const registryNames = new Set(registry.field_registry.map((field) => field.field_name));
  const consumerById = new Map(R01_CHART_FIELD_REGISTRY.map((field) => [field.field_id, field]));
  const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

  assert.equal(registry.field_registry.length, 147);
  assert.equal(registryNames.size, 147);
  assert.equal(crosswalk.entries.length, 48);
  assert.equal(crosswalk.counts.consumer_verification_pending, 39);
  assert.equal(crosswalk.counts.consumer_derived, 9);
  assert.equal(crosswalk.counts.invalid_registry_refs, 0);
  assert.equal(crosswalk.counts.source_candidate_links, 1);
  assert.equal(crosswalk.counts.unrepresented_or_non_equivalent, 15);
  assert.equal(
    crosswalk.counts.same_semantics_links + crosswalk.counts.calculation_input_links + crosswalk.counts.source_candidate_links + crosswalk.counts.unrepresented_or_non_equivalent,
    crosswalk.entries.length,
  );

  const crosswalkIds = new Set<string>();
  for (const entry of crosswalk.entries) {
    assert.ok(!crosswalkIds.has(entry.consumer_field_id), entry.consumer_field_id);
    crosswalkIds.add(entry.consumer_field_id);
    const consumer = consumerById.get(entry.consumer_field_id);
    assert.ok(consumer, entry.consumer_field_id);
    assert.equal(entry.consumer_status, consumer.status);
    assert.equal(entry.status_effect, "no_consumer_status_change");
    assert.ok(entry.resolution_note.length > 0);
    for (const name of [...entry.supplier_registry_fields, ...entry.calculation_input_registry_fields]) {
      assert.ok(registryNames.has(name), `${entry.consumer_field_id}->${name}`);
    }
    assert.ok(["same_semantics", "calculation_inputs", "source_candidate_not_output_alias", "not_represented_or_not_equivalent"].includes(entry.relationship));
  }
  assert.deepEqual([...crosswalkIds].sort(), [...consumerById.keys()].sort());

  // Existing MCP mapping references are checked too; neither source contract is rewritten by this test.
  for (const binding of mapping.r01_chart_provider_binding.field_bindings) {
    for (const name of binding.consumer_supplier_registry_names) assert.ok(registryNames.has(name), `${binding.field_id}->${name}`);
    assert.equal(binding.consumer_status_unchanged, consumerById.get(binding.field_id)?.status);
  }
  assert.equal(crosswalk.sources.supplier_registry.sha256.length, 64);
  assert.equal(crosswalk.sources.provider_mapping.sha256.length, 64);
  assert.equal(crosswalk.sources.supplier_registry.sha256, digest(registryText));
  assert.equal(crosswalk.sources.provider_mapping.sha256, digest(mappingText));
  const runtimeText = await readFile(new URL("../../contracts/r01-chart-runtime-contract-v1.json", import.meta.url), "utf8");
  assert.equal(crosswalk.sources.runtime_contract.sha256, digest(runtimeText));
});

test("parser contract lists only documented operations and matches the code readiness diagnostics", async () => {
  const contractText = await readFile(new URL("../contracts/r01-kis-provider-parser-contract-v1.json", import.meta.url), "utf8");
  const contract = JSON.parse(contractText) as {
    run_evidence: { live_kis_requests: number; live_provider_responses_verified: number; synthetic_fixtures: number };
    provenance: { consumer_supplier_crosswalk: { sha256: string } };
    operation_diagnostics: Array<{ operation_ref: string; parser_status: string; canonical_projection_status: string; live_request_status: string; blockers: string[] }>;
    implemented_parsers: Array<{ operation_ref: string; endpoint: string; tr_id: string; raw_fields: Array<{ provider_field: string; response_path: string; provider_key_path_verified: boolean; canonical_mapping_verified: boolean }> }>;
    raw_candidate_parsers: Array<{ operation_ref: string; function: string; tool_exposure: boolean; network_calls: boolean; canonical_projection: string }>;
    unsupported_and_unexposed: { registered_mcp_tool_count: string; daily_history: string; intraday: string; other_unexposed: string[] };
  };
  assert.equal(contract.run_evidence.live_kis_requests, 0);
  assert.equal(contract.run_evidence.live_provider_responses_verified, 0);
  assert.equal(contract.run_evidence.synthetic_fixtures, 3);
  assert.equal(contract.operation_diagnostics.length, R01_OPERATION_DIAGNOSTICS.length);
  for (const expected of R01_OPERATION_DIAGNOSTICS) {
    const actual = contract.operation_diagnostics.find((item) => item.operation_ref === expected.operation_ref);
    assert.ok(actual, expected.operation_ref);
    assert.equal(actual.parser_status, expected.parser_status);
    assert.equal(actual.canonical_projection_status, expected.canonical_status);
    assert.equal(actual.live_request_status, expected.live_request_status);
    assert.deepEqual(actual.blockers, expected.blockers);
  }
  const k039 = contract.implemented_parsers.find((item) => item.operation_ref === "KIS-039");
  const k115 = contract.implemented_parsers.find((item) => item.operation_ref === "KIS-115");
  assert.equal(k039?.endpoint, "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice");
  assert.equal(k039?.tr_id, "FHKST03010100");
  assert.equal(k115?.endpoint, "/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily");
  assert.equal(k115?.tr_id, "FHPTJ04160001");
  assert.ok(contract.implemented_parsers.every((parser) => parser.raw_fields.every((field) => field.provider_key_path_verified && !field.canonical_mapping_verified)));
  assert.deepEqual(contract.raw_candidate_parsers.map((parser) => parser.operation_ref), ["KIS-134", "KIS-110", "KIS-135"]);
  assert.ok(contract.raw_candidate_parsers.every((parser) => !parser.tool_exposure && !parser.network_calls && parser.canonical_projection === "blocked"));
  assert.match(contract.unsupported_and_unexposed.daily_history, /daily period code only/i);
  assert.match(contract.unsupported_and_unexposed.intraday, /remain unimplemented/i);
  assert.ok(contract.unsupported_and_unexposed.other_unexposed.includes("KRX reported short-position API"));
  const crosswalkText = await readFile(new URL("../../../contracts/r01-consumer-supplier-registry-crosswalk-v1.json", import.meta.url), "utf8");
  assert.equal(contract.provenance.consumer_supplier_crosswalk.sha256, createHash("sha256").update(crosswalkText).digest("hex"));
});

import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/r01_flow_risk_provider_shapes_synthetic.json" with { type: "json" };
import flowContract from "../contracts/r01-flow-risk-provider-extension-v1.json" with { type: "json" };
import {
  parseKis110CreditBalanceResponse,
  parseKis134ShortSaleResponse,
  parseKis135StockLoanResponse,
  SafeKisFlowRiskParserError,
} from "../src/r01-flow-risk-parsers.js";

const context = {
  symbol: "000000",
  receivedAt: "2026-10-22T00:00:00.000Z",
  origin: "synthetic_fixture" as const,
};

function errorCode(fn: () => unknown, expected: string): void {
  assert.throws(fn, (error: unknown) => error instanceof SafeKisFlowRiskParserError && error.code === expected);
}

test("synthetic fixture is explicitly not a KIS observation", () => {
  assert.equal(fixture.fixture_metadata.not_a_kis_response, true);
  assert.equal(fixture.fixture_metadata.synthetic_only, true);
});

test("field allowlists match the exact pinned check-script key lists in the supplier contract", () => {
  const operation = new Map(flowContract.operations.map((item) => [item.operation_ref, item]));
  const checked = (ref: string): string[] => (operation.get(ref) as { checked_sample_fields: string[] }).checked_sample_fields;
  assert.deepEqual(checked("KIS-134"), [
    "stck_prpr", "prdy_vrss", "prdy_vrss_sign", "prdy_ctrt", "acml_vol", "prdy_vol",
    "stck_bsop_date", "stck_clpr", "stnd_vol_smtn", "ssts_cntg_qty", "ssts_vol_rlim",
    "acml_ssts_cntg_qty", "acml_ssts_cntg_qty_rlim", "acml_tr_pbmn", "stnd_tr_pbmn_smtn",
    "ssts_tr_pbmn", "ssts_tr_pbmn_rlim", "acml_ssts_tr_pbmn", "acml_ssts_tr_pbmn_rlim",
    "stck_oprc", "stck_hgpr", "stck_lwpr", "avrg_prc",
  ]);
  assert.equal(checked("KIS-110").length, 26);
  assert.equal(checked("KIS-135").length, 11);
});

test("KIS-134 keeps object and array roots separate and does not infer a field root", () => {
  const parsed = parseKis134ShortSaleResponse(fixture.kis134_response, context);
  assert.equal(parsed.roots.output1.response_root, "output1");
  assert.equal(parsed.roots.output1.raw_fields.ssts_cntg_qty?.raw_value, "123");
  assert.equal(parsed.roots.output1.raw_fields.ssts_tr_pbmn?.state, "missing");
  assert.equal(parsed.roots.output2[0]?.response_root, "output2");
  assert.equal(parsed.roots.output2[0]?.raw_fields.ssts_tr_pbmn?.raw_value, "456000");
  assert.equal(parsed.roots.output2[0]?.raw_fields.ssts_cntg_qty?.state, "missing");
  assert.ok(parsed.roots.output1.unmapped_field_names.includes("synthetic_root_marker"));
  assert.equal(parsed.source_as_of, null);
  assert.equal(parsed.received_at, context.receivedAt);
  assert.equal(parsed.observed_payload_origin, "synthetic_fixture");
  assert.equal(parsed.canonical_projection_status, "blocked");
});

test("KIS-110 preserves trade and settlement dates separately and keeps credit/lending families distinct", () => {
  const rows = parseKis110CreditBalanceResponse(fixture.kis110_response, {
    ...context,
    requestedSettlementDate: "20990105",
  });
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.raw_fields.deal_date?.raw_value, "20990102");
  assert.equal(row.raw_fields.stlm_date?.raw_value, "20990105");
  assert.equal(row.query_settlement_date, "20990105");
  assert.equal(row.date_basis_status, "keep_deal_date_and_settlement_date_separate");
  assert.equal(row.raw_fields.whol_loan_rmnd_stcn?.raw_value, "100");
  assert.equal(row.raw_fields.whol_stln_rmnd_stcn?.raw_value, "50");
  assert.equal(row.source_as_of, null);
  assert.equal(row.canonical_projection_status, "blocked");
});

test("KIS-135 exposes only raw output1 candidates and keeps change units/sign unresolved", () => {
  const rows = parseKis135StockLoanResponse(fixture.kis135_response, context);
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.response_root, "output1");
  assert.equal(row.row_date_candidate, "bsop_date");
  assert.equal(row.raw_fields.new_stcn?.raw_value, "11");
  assert.equal(row.raw_fields.rmnd_stcn?.raw_value, "80");
  assert.equal(row.raw_fields.prdy_rmnd_vrss?.raw_value, "7");
  assert.equal(row.balance_change_semantics_status, "unit_and_sign_unresolved");
  assert.equal(row.canonical_projection_status, "blocked");
});

test("parsers reject malformed roots and upstream errors with sanitized codes only", () => {
  errorCode(() => parseKis134ShortSaleResponse({ rt_cd: "0", output1: {} }, context), "provider_response_schema_drift");
  errorCode(() => parseKis110CreditBalanceResponse({ rt_cd: "0", output: {} }, { ...context, requestedSettlementDate: "20990105" }), "provider_response_schema_drift");
  errorCode(() => parseKis135StockLoanResponse({ rt_cd: "1", msg1: "synthetic upstream diagnostic" }, context), "upstream_rejected");
  errorCode(() => parseKis110CreditBalanceResponse(fixture.kis110_response, { ...context, requestedSettlementDate: "20991340" }), "invalid_input");
  const tooManyCreditRows = {
    rt_cd: "0",
    output: Array.from({ length: 31 }, () => fixture.kis110_response.output[0]),
  };
  errorCode(() => parseKis110CreditBalanceResponse(tooManyCreditRows, { ...context, requestedSettlementDate: "20990105" }), "provider_response_schema_drift");
  const oversized = structuredClone(fixture.kis135_response) as Record<string, any>;
  oversized.output1[0].synthetic_large_field = "x".repeat(300_001);
  errorCode(() => parseKis135StockLoanResponse(oversized, context), "response_too_large");
});

test("non-string provider candidates are withheld rather than converted through JS number precision", () => {
  const response = structuredClone(fixture.kis134_response) as Record<string, any>;
  response.output1.ssts_cntg_qty = 9007199254740993;
  const parsed = parseKis134ShortSaleResponse(response, context);
  assert.equal(parsed.roots.output1.raw_fields.ssts_cntg_qty?.raw_value, null);
  assert.equal(parsed.roots.output1.raw_fields.ssts_cntg_qty?.state, "raw_type_unverified");
});

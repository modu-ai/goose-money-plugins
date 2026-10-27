import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const providerContractUrl = new URL("../contracts/r01-kis-provider-parser-contract-v1.json", import.meta.url);
const flowContractUrl = new URL("../contracts/r01-flow-risk-provider-extension-v1.json", import.meta.url);

async function readJson(url: URL): Promise<Record<string, any>> {
  return JSON.parse(await readFile(url, "utf8")) as Record<string, any>;
}

test("v13.2 consumer reconciliation is complete as a read-only mapping and stays non-canonical", async () => {
  const provider = await readJson(providerContractUrl);
  const reconciliation = provider.consumer_v13_2_reconciliation;
  const flow = reconciliation.flow_risk_fields as Array<Record<string, any>>;
  const daily = reconciliation.daily_field_bindings as Array<Record<string, any>>;
  const investor = reconciliation.investor_field_bindings as Array<Record<string, any>>;

  assert.equal(reconciliation.consumer_manifest_id, "goose.r01.v13_2.consumer-provider-binding.kis53.v1");
  assert.equal(reconciliation.consumer_manifest_sha256, "678837533751fc1fdb7b2d4529551d3e12246ebbb782d930d576cd233d44bef3");
  assert.equal(reconciliation.consumer_files_read_only, true);
  assert.equal(reconciliation.summary.flow_risk_field_count, 37);
  assert.equal(reconciliation.summary.flow_risk_measurement_count, 34);
  assert.equal(reconciliation.summary.flow_risk_metadata_count, 3);
  assert.deepEqual(reconciliation.summary.flow_risk_binding_counts, {
    raw_key_only: 8,
    unmapped: 4,
    raw_path_candidate: 22,
    derived_dependency: 2,
    transport_metadata_only: 1,
  });
  assert.equal(reconciliation.summary.daily_field_binding_count, 11);
  assert.equal(reconciliation.summary.investor_field_binding_count, 6);
  assert.equal(reconciliation.summary.canonical_real_fields_completed, 0);
  assert.equal(reconciliation.summary.all_consumer_values_null, true);
  assert.equal(reconciliation.summary.all_consumer_canonical_mappings_unverified, true);

  assert.equal(flow.length, 37);
  assert.equal(new Set(flow.map((item) => item.consumer_id)).size, 37);
  assert.ok(flow.every((item) => item.value === null && item.canonical_mapping_verified === false));
  assert.ok(flow.every((item) => !["KIS-039", "KIS-115"].includes(item.operation_ref)));
  assert.deepEqual(
    Object.fromEntries(
      ["KIS-110", "KIS-134", "KIS-135", "KRX-MDCSTAT305"].map((operation) => [
        operation,
        flow.filter((item) => item.operation_ref === operation).length,
      ]),
    ),
    { "KIS-110": 18, "KIS-134": 8, "KIS-135": 6, "KRX-MDCSTAT305": 2 },
  );
  assert.match(reconciliation.relationship_guard, /do not supply the 37/i);

  assert.equal(daily.length, 11);
  assert.ok(daily.every((item) => item.operation_ref === "KIS-039"));
  assert.ok(daily.every((item) => item.raw_response_path.startsWith("$.output2[*].")));
  assert.ok(daily.every((item) => item.provider_type === "String"));
  assert.ok(daily.every((item) => item.unit === null && item.canonical_mapping_verified === false && item.value === null));
  assert.deepEqual(
    daily.map((item) => item.raw_response_path.split(".").at(-1)),
    ["stck_bsop_date", "stck_clpr", "stck_oprc", "stck_hgpr", "stck_lwpr", "acml_vol", "acml_tr_pbmn", "flng_cls_code", "prtt_rate", "mod_yn", "revl_issu_reas"],
  );

  assert.equal(investor.length, 6);
  assert.ok(investor.every((item) => item.operation_ref === "KIS-115"));
  assert.ok(investor.every((item) => item.source_as_of === null && item.received_at_path.endsWith(".received_at")));
  assert.ok(investor.every((item) => item.canonical_mapping_verified === false && item.value === null));
  const amounts = investor.filter((item) => item.raw_unit === "KRW_million");
  const quantities = investor.filter((item) => item.raw_unit === "shares");
  assert.equal(amounts.length, 3);
  assert.ok(amounts.every((item) => item.normalized_unit === "KRW" && item.conversion === "exact decimal string × 1000000"));
  assert.equal(quantities.length, 3);
  assert.ok(quantities.every((item) => item.normalized_unit === "shares" && item.conversion === "identity decimal string"));

  const conflict = reconciliation.request_conflicts.find((item: Record<string, any>) => item.field === "FID_ETC_CLS_CODE");
  assert.deepEqual(conflict, {
    operation_ref: "KIS-115",
    field: "FID_ETC_CLS_CODE",
    portal_value: "1",
    pinned_sample_value: "",
    status: "unresolved_live_blocker",
    mock_encoding_only: "1",
  });
  const officialEvidence = reconciliation.operation_evidence_and_unresolved;
  assert.match(officialEvidence["KIS-115"].request_parameter_conflict, /portal schema requires value 1; pinned official helper documents\/sends empty string/i);
  assert.deepEqual(officialEvidence["KIS-115"].documented_units.amount_fields, ["frgn_ntby_tr_pbmn", "prsn_ntby_tr_pbmn", "orgn_ntby_tr_pbmn"]);
  assert.match(officialEvidence["KIS-115"].documented_units.amount_raw_unit, /KRW millions/);
  assert.match(officialEvidence["KIS-115"].documented_units.quantity_unit, /shares/);
  assert.match(officialEvidence["KIS-115"].time_and_finality, /no timezone or per-row publication timestamp/i);
  assert.match(officialEvidence["KIS-115"].time_and_finality, /source_as_of=null/);
  assert.match(officialEvidence["KIS-115"].time_and_finality, /received_at separately/);
  assert.match(officialEvidence["KIS-039"].unit_status, /not stated/i);
  assert.match(officialEvidence["KIS-039"].adjustment, /pinned helper comment conflicts/i);
  assert.equal(reconciliation.handoff_validation.network_attempts, 0);
  assert.equal(reconciliation.handoff_validation.actual_kis_responses, 0);
  assert.equal(reconciliation.handoff_validation.credentials_read, false);
  assert.equal(reconciliation.handoff_validation.reported_supplier_tests_at_handoff.tests, 53);
  assert.equal(reconciliation.handoff_validation.reported_supplier_tests_at_handoff.rerun_by_consumer, false);
  assert.equal(reconciliation.source_hash_audit.all_manifest_provenance_hashes_matched_at_review, true);
  assert.equal(reconciliation.source_hash_audit.matched_files.length, 11);

  const flowContract = await readJson(flowContractUrl);
  assert.equal(flowContract.consumer_v13_2_reconciliation.summary.consumer_risk_id_count, 37);
  assert.equal(flowContract.consumer_v13_2_reconciliation.summary.measurement_ids, 34);
  assert.equal(flowContract.consumer_v13_2_reconciliation.summary.metadata_ids, 3);
  assert.equal(flowContract.consumer_v13_2_reconciliation.consumer_bindings.length, 37);
  assert.match(flowContract.consumer_v13_2_reconciliation.no_aliasing_rule, /neither is a source for these 37/i);
});

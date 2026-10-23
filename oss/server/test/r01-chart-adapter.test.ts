import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  R01_CHART_FIELD_REGISTRY,
  R01_CHART_RUNTIME_CONTRACT,
  R01_KIS_OPERATION_REGISTRY,
  R01ChartFactRecordSchema,
  inspectKisChartResponse,
  isR01ChartFieldMapped,
} from "../src/r01-chart-adapter.js";

const sourceMappingUrl = new URL("../../../contracts/kis-api-mapping-v1.json", import.meta.url);
const receivedAt = "2026-10-21T15:04:05.000Z";

test("the test process is the project-pinned Node runtime", () => {
  assert.equal(process.version, "v24.22.1");
});

function valueForShape(shape: "object" | "array" | "object_or_array"): Record<string, unknown> | unknown[] {
  return shape === "array" ? [] : shape === "object" ? {} : { sample_only: true };
}

test("R01 runtime adapter connects nine chart slots, 48 fields, and ten KIS operations", () => {
  assert.equal(R01_CHART_RUNTIME_CONTRACT.requirements.length, 9);
  assert.equal(R01_CHART_RUNTIME_CONTRACT.counts.standard_requirements, 6);
  assert.equal(R01_CHART_RUNTIME_CONTRACT.counts.supplemental_requirements, 3);
  assert.equal(R01_KIS_OPERATION_REGISTRY.length, 10);
  assert.equal(R01_CHART_FIELD_REGISTRY.length, 48);
  assert.equal(R01_CHART_FIELD_REGISTRY.filter((field) => field.status === "verification_pending").length, 39);
  assert.equal(R01_CHART_FIELD_REGISTRY.filter((field) => field.status === "derived").length, 9);
  assert.equal(R01_CHART_RUNTIME_CONTRACT.counts.official_response_field_bindings_confirmed, 0);
  assert.equal(R01_CHART_RUNTIME_CONTRACT.counts.kis_portal_endpoint_schemas_reviewed, 10);
  assert.equal(R01_CHART_RUNTIME_CONTRACT.counts.kis_portal_request_schemas_reviewed, 10);
  assert.equal(R01_CHART_RUNTIME_CONTRACT.runtime_policy.exposed_as_mcp_tools, false);
  assert.equal(R01_CHART_RUNTIME_CONTRACT.runtime_policy.arbitrary_endpoint_call, false);
  assert.ok(R01_KIS_OPERATION_REGISTRY.every((operation) => operation.method === "GET" && operation.endpoint.startsWith("/uapi/")));
  assert.ok(R01_KIS_OPERATION_REGISTRY.every((operation) => operation.request_schema_status.startsWith("official_portal_request")));
  assert.ok(R01_KIS_OPERATION_REGISTRY.every((operation) => Array.isArray(operation.request_constraints) && operation.request_constraints.length > 0));
  assert.ok(R01_KIS_OPERATION_REGISTRY.every((operation) => operation.sample_field_names_enumerated === false));
  const daily = R01_KIS_OPERATION_REGISTRY.find((operation) => operation.operation_ref === "KIS-039");
  const flow = R01_KIS_OPERATION_REGISTRY.find((operation) => operation.operation_ref === "KIS-115");
  assert.ok((daily?.request_constraints ?? []).some((item) => typeof item === "object" && item !== null && "name" in item && item.name === "FID_ORG_ADJ_PRC"));
  assert.ok(daily?.provider_unknowns?.some((note) => note.includes("FID_ORG_ADJ_PRC")));
  assert.ok(flow?.request_schema_status.includes("FID_ETC_CLS_CODE"));
});

test("generated runtime contract stays tied to the exact reviewed source mapping", async () => {
  const source = await readFile(sourceMappingUrl);
  const digest = createHash("sha256").update(source).digest("hex");
  assert.equal(digest, R01_CHART_RUNTIME_CONTRACT.provenance.source_sha256);
});

test("all 27 confirmed KIS raw candidate paths and request constraints match the reviewed portal schema", async () => {
  const evidence = JSON.parse(await readFile(new URL("../contracts/r01-kis-official-response-schemas-v1.json", import.meta.url), "utf8")) as {
    operations: Array<{
      operation_ref: string;
      request_constraints: unknown[];
      response_fields: Array<{ provider_field: string; response_path: string }>;
    }>;
  };
  const rawPathIndex = new Set(evidence.operations.flatMap((operation) =>
    operation.response_fields.map((field) => `${operation.operation_ref}|${field.provider_field}|${field.response_path}`),
  ));
  for (const operation of R01_KIS_OPERATION_REGISTRY) {
    const reviewed = evidence.operations.find((item) => item.operation_ref === operation.operation_ref);
    assert.ok(reviewed, operation.operation_ref);
    assert.deepEqual(operation.request_constraints, reviewed.request_constraints, operation.operation_ref);
  }
  const confirmedKisBindings = R01_CHART_FIELD_REGISTRY.flatMap((field) =>
    field.candidate_bindings.filter((binding) => binding.provider === "KIS" && binding.provider_key_path_verified),
  );
  assert.equal(confirmedKisBindings.length, 27);
  for (const binding of confirmedKisBindings) {
    assert.ok(binding.source_operation_id && binding.raw_field && binding.response_path);
    assert.ok(rawPathIndex.has(`${binding.source_operation_id}|${binding.raw_field}|${binding.response_path}`), `${binding.source_operation_id}:${binding.response_path}`);
    assert.equal(binding.canonical_mapping_verified, false);
  }
});

test("all ten operation adapters validate only the documented output-root shape", () => {
  for (const operation of R01_KIS_OPERATION_REGISTRY) {
    const raw: Record<string, unknown> = { rt_cd: "0", msg_cd: "00000", msg1: "sample fixture" };
    for (const root of operation.response_roots) raw[root.name] = valueForShape(root.shape);
    const inspection = inspectKisChartResponse(operation.operation_ref, raw, receivedAt);
    assert.equal(inspection.response_shape_status, "envelope_checked_only", operation.operation_ref);
    assert.deepEqual(inspection.present_output_roots, operation.response_roots.map((root) => root.name));
    assert.deepEqual(inspection.missing_output_roots, []);
    assert.equal(inspection.canonical_field_mapping_status, "verification_pending");
    assert.equal(inspection.candidate_provider_fields_emitted, false);
  }
});

test("a malformed documented output-root shape is rejected without echoing response data", () => {
  const operation = R01_KIS_OPERATION_REGISTRY.find((entry) => entry.operation_ref === "KIS-039");
  assert.ok(operation);
  assert.throws(
    () => inspectKisChartResponse("KIS-039", { rt_cd: "0", output1: [] }, receivedAt),
    /^Error: provider_response_schema_drift$/,
  );
});

test("provider source time remains absent and never borrows local received_at", () => {
  const inspection = inspectKisChartResponse("KIS-039", { rt_cd: "0", output1: {}, output2: [] }, receivedAt);
  assert.equal(inspection.source_as_of, null);
  assert.equal(inspection.source_time_status, "not_mapped");
  assert.equal(inspection.received_at, receivedAt);
});

test("candidate aliases stay unverified and pending chart fields cannot carry values", () => {
  const kisBindings = R01_CHART_FIELD_REGISTRY.flatMap((field) => field.candidate_bindings.filter((binding) => binding.provider === "KIS"));
  assert.equal(kisBindings.length, 27);
  assert.ok(kisBindings.every((binding) => binding.provider_key_path_verified));
  for (const field of R01_CHART_FIELD_REGISTRY) {
    assert.equal(isR01ChartFieldMapped(field.field_id), false, field.field_id);
    assert.equal(field.canonical_mapping_verified, false, field.field_id);
    assert.ok(field.candidate_bindings.every((binding) => binding.canonical_mapping_verified === false), field.field_id);
  }
  const knownDartKey = R01_CHART_FIELD_REGISTRY.find((field) => field.field_id === "filing.receipt");
  assert.equal(knownDartKey?.candidate_bindings[0]?.provider_key_path_verified, true);
  assert.equal(knownDartKey?.canonical_mapping_verified, false);
  const pending = R01ChartFactRecordSchema.safeParse({
    field_id: "history.close", status: "verification_pending", value: "123.45", unit: null,
    evidence_refs: [], derivation: null,
  });
  assert.equal(pending.success, false);
  const stillPending = R01ChartFactRecordSchema.safeParse({
    field_id: "history.close", status: "verification_pending", value: null, unit: null,
    evidence_refs: [], derivation: null,
  });
  assert.equal(stillPending.success, true);
});

test("non-null derived chart values require deterministic calculation lineage and evidence", () => {
  const incomplete = R01ChartFactRecordSchema.safeParse({
    field_id: "metric.ma20", status: "derived", value: "100.00", unit: "KRW/share",
    evidence_refs: [], derivation: null,
  });
  assert.equal(incomplete.success, false);
  const complete = R01ChartFactRecordSchema.safeParse({
    field_id: "metric.ma20", status: "derived", value: "100.00", unit: "KRW/share",
    evidence_refs: ["kis:daily-bars:fixture-1"],
    derivation: { method: "simple_moving_average", version: "1", input_field_ids: ["history.close"] },
  });
  assert.equal(complete.success, true);
});

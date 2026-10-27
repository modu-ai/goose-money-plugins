import { z } from "zod";
import runtimeContractJson from "../contracts/r01-chart-runtime-contract-v1.json" with { type: "json" };

const OperationSchema = z.object({
  operation_ref: z.string().regex(/^KIS-\d{3}$/),
  method: z.literal("GET"),
  endpoint: z.string().startsWith("/uapi/"),
  tr_id: z.object({ real: z.string().min(1), paper: z.string().min(1) }).strict(),
  asset_scope: z.array(z.string().min(1)).min(1),
  sample_request_field_names: z.array(z.string().min(1)),
  request_schema_status: z.string().min(1),
  request_constraints: z.array(z.unknown()).optional(),
  response_roots: z.array(z.object({
    name: z.string().min(1),
    shape: z.enum(["object", "array", "object_or_array"]),
    sample_description: z.string().min(1),
  }).strict()).min(1),
  sample_field_names_enumerated: z.literal(false),
  pagination_evidence: z.string(),
  max_rows_or_page_hint: z.number().int().positive().nullable(),
  provider_evidence_state: z.string().min(1),
  catalog_id: z.string().min(1),
  catalog_commit: z.string().regex(/^[a-f0-9]{40}$/),
  sample_url: z.string().url(),
  portal_document_title: z.string().optional(),
  portal_document_url: z.string().url().optional(),
  portal_schema_evidence_ref: z.string().optional(),
  portal_schema_review_date: z.string().optional(),
  pagination_status: z.string().optional(),
  provider_unknowns: z.array(z.string()).optional(),
  authentication: z.string(),
  rate_limit: z.record(z.string(), z.unknown()),
  cache_refresh: z.record(z.string(), z.unknown()),
  rights: z.string(),
  errors: z.record(z.string(), z.unknown()),
  notes: z.array(z.string()),
}).strict();

const CandidateBindingSchema = z.object({
  provider: z.string().min(1),
  source_operation_id: z.string().nullable(),
  asset_scope: z.array(z.string()).nullable(),
  raw_field: z.string().nullable(),
  response_path: z.string().nullable(),
  binding_status: z.string(),
  provider_key_path_verified: z.boolean(),
  canonical_mapping_verified: z.literal(false),
  evidence_url: z.string().url().nullable(),
  candidate_source: z.string().nullable(),
  portal_document_url: z.string().url().optional(),
  portal_schema_evidence_ref: z.string().optional(),
  provider_type: z.string().optional(),
  provider_max_length: z.number().int().positive().nullable().optional(),
  provider_semantics: z.string().optional(),
  provider_unit: z.string().nullable().optional(),
  provider_unit_status: z.string().optional(),
  provider_time_semantics: z.string().optional(),
  scope_note: z.string().optional(),
}).strict();

const FieldSchema = z.object({
  field_id: z.string().min(1),
  consumer_type: z.string().min(1),
  consumer_unit: z.string().nullable(),
  status: z.enum(["verification_pending", "derived"]),
  provider_classification: z.string().min(1),
  provider_resolution: z.string().min(1),
  requirements: z.array(z.string()),
  canonical_mapping_verified: z.literal(false),
  candidate_bindings: z.array(CandidateBindingSchema),
  unresolved_notes: z.array(z.string()),
}).strict();

const RequirementSchema = z.object({
  requirement_id: z.string().min(1),
  consumer_section_id: z.string().min(1),
  slot_class: z.enum(["standard", "supplemental"]),
  section_title: z.string(),
  required_field_ids: z.array(z.string()),
  expanded_field_dependencies: z.array(z.string()),
  provider_binding_status: z.unknown(),
  source_policy: z.unknown(),
}).strict();

const RuntimeContractSchema = z.object({
  contract_id: z.literal("moai.stock.r01.chart-provider-runtime.v1"),
  version: z.string(),
  generated_on: z.string(),
  status: z.literal("design_contract_only_no_live_provider_validation"),
  provenance: z.object({
    source_contract: z.string(),
    source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    source_binding_id: z.string(),
    source_binding_version: z.string(),
    provider_catalog_commit: z.string().regex(/^[a-f0-9]{40}$/),
    provider_catalog_scope: z.unknown(),
    consumer_source_refs: z.array(z.unknown()),
    scope_note: z.string(),
  provider_response_schema_evidence: z.string().optional(),
  supplier_registry_version: z.string().optional(),
  supplier_registry_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).strict(),
  counts: z.object({
    requirements: z.number().int(),
    standard_requirements: z.number().int(),
    supplemental_requirements: z.number().int(),
    unique_chart_input_fields: z.number().int(),
    verification_pending_fields: z.number().int(),
    derived_fields: z.number().int(),
    official_response_field_bindings_confirmed: z.number().int(),
    provider_operations: z.number().int(),
    kis_portal_endpoint_schemas_reviewed: z.number().int().optional(),
    kis_documented_raw_candidate_paths: z.number().int().optional(),
    consumer_statuses_promoted: z.number().int().optional(),
    live_provider_responses_verified: z.number().int().optional(),
    previous_dart_filing_raw_keys_verified: z.number().int().optional(),
    kis_portal_request_schemas_reviewed: z.number().int().optional(),
  }).strict(),
  runtime_policy: z.record(z.string(), z.unknown()),
  requirements: z.array(RequirementSchema),
  operations: z.array(OperationSchema),
  fields: z.array(FieldSchema),
  official_provider_schema_evidence: z.object({
    artifact: z.string(),
    reviewed_on: z.string(),
    operations_reviewed: z.number().int(),
    portal_response_schemas_reviewed: z.number().int(),
    portal_request_schemas_reviewed: z.number().int().optional(),
    r01_chart_contract: z.object({
      fields: z.number().int(),
      verification_pending: z.number().int(),
      derived: z.number().int(),
    }).strict(),
    consumer_statuses_promoted: z.number().int(),
    live_provider_responses_verified: z.number().int(),
    previous_dart_filing_raw_keys: z.array(z.string()),
    scope_note: z.string(),
  }).strict(),
}).strict();

const parsedContract = RuntimeContractSchema.parse(runtimeContractJson);
const fieldIndex = new Map(parsedContract.fields.map((field) => [field.field_id, field]));
const operationIndex = new Map(parsedContract.operations.map((operation) => [operation.operation_ref, operation]));

if (
  parsedContract.operations.length !== parsedContract.counts.provider_operations ||
  parsedContract.fields.length !== parsedContract.counts.unique_chart_input_fields ||
  parsedContract.requirements.length !== parsedContract.counts.requirements ||
  parsedContract.fields.filter((field) => field.status === "verification_pending").length !== parsedContract.counts.verification_pending_fields ||
  parsedContract.fields.filter((field) => field.status === "derived").length !== parsedContract.counts.derived_fields ||
  parsedContract.counts.official_response_field_bindings_confirmed !== 0 ||
  parsedContract.operations.some((operation) => operation.sample_field_names_enumerated) ||
  parsedContract.operations.some((operation) => !operation.request_constraints || operation.request_constraints.length === 0) ||
  parsedContract.counts.kis_portal_request_schemas_reviewed !== parsedContract.operations.length ||
  parsedContract.official_provider_schema_evidence.portal_request_schemas_reviewed !== parsedContract.operations.length
) {
  throw new Error("r01_runtime_contract_count_or_evidence_mismatch");
}

export const R01_CHART_RUNTIME_CONTRACT = parsedContract;
export const R01_KIS_OPERATION_REGISTRY = parsedContract.operations;
export const R01_CHART_FIELD_REGISTRY = parsedContract.fields;

export type R01KisOperationRef = (typeof R01_KIS_OPERATION_REGISTRY)[number]["operation_ref"];
export type R01ChartFieldId = (typeof R01_CHART_FIELD_REGISTRY)[number]["field_id"];

const ProviderObject = z.record(z.string(), z.unknown());
const ProviderArray = z.array(z.unknown());
const ProviderRootSchemas = {
  object: ProviderObject,
  array: ProviderArray,
  object_or_array: z.union([ProviderObject, ProviderArray]),
} as const;

const ProviderEnvelopeSchema = z.object({
  rt_cd: z.union([z.string(), z.number()]).optional(),
  msg_cd: z.union([z.string(), z.number()]).optional(),
  msg1: z.string().optional(),
}).passthrough();

const ReceivedAtSchema = z.string().datetime({ offset: true });

export const R01ChartFactRecordSchema = z.object({
  field_id: z.string().refine((value) => fieldIndex.has(value), "unknown_chart_field"),
  status: z.enum(["verification_pending", "derived"]),
  value: z.unknown(),
  unit: z.string().nullable(),
  evidence_refs: z.array(z.string()),
  derivation: z.object({
    method: z.string().min(1),
    version: z.string().min(1),
    input_field_ids: z.array(z.string().min(1)).min(1),
  }).strict().nullable(),
}).strict().superRefine((record, context) => {
  const spec = fieldIndex.get(record.field_id);
  if (!spec) return;
  if (record.status !== spec.status) {
    context.addIssue({ code: "custom", message: "consumer_field_status_mismatch", path: ["status"] });
  }
  if (record.status === "verification_pending" && record.value !== null) {
    context.addIssue({ code: "custom", message: "unverified_provider_field_cannot_have_value", path: ["value"] });
  }
  if (record.status === "derived" && record.value !== null && (!record.derivation || record.evidence_refs.length === 0)) {
    context.addIssue({ code: "custom", message: "derived_value_requires_lineage_and_evidence", path: ["derivation"] });
  }
});

export const R01ChartTimeProvenanceSchema = z.object({
  // The ten chart operations in this reviewed contract have no verified
  // provider timestamp/date mapping. Keep provider time absent until one is.
  source_as_of: z.null(),
  source_time_status: z.literal("not_mapped"),
  received_at: ReceivedAtSchema,
}).strict();

export const KisResponseInspectionSchema = z.object({
  operation_ref: z.string().regex(/^KIS-\d{3}$/),
  provider: z.literal("KIS"),
  response_shape_status: z.literal("envelope_checked_only"),
  present_output_roots: z.array(z.string()),
  missing_output_roots: z.array(z.string()),
  source_as_of: z.null(),
  source_time_status: z.literal("not_mapped"),
  received_at: ReceivedAtSchema,
  canonical_field_mapping_status: z.literal("verification_pending"),
  candidate_provider_fields_emitted: z.literal(false),
}).strict();

export type KisResponseInspection = z.infer<typeof KisResponseInspectionSchema>;

/**
 * Validate only the official sample's response envelope/root shape. This does
 * not bind raw response keys to canonical chart fields or expose an API tool.
 */
export function inspectKisChartResponse(
  operationRef: R01KisOperationRef,
  raw: unknown,
  receivedAt: string,
): KisResponseInspection {
  const operation = operationIndex.get(operationRef);
  if (!operation) throw new Error("unknown_kis_operation");

  const time = R01ChartTimeProvenanceSchema.safeParse({
    source_as_of: null,
    source_time_status: "not_mapped",
    received_at: receivedAt,
  });
  if (!time.success) throw new Error("invalid_received_at");

  const envelope = ProviderEnvelopeSchema.safeParse(raw);
  if (!envelope.success) throw new Error("provider_response_schema_drift");

  const present: string[] = [];
  const missing: string[] = [];
  for (const root of operation.response_roots) {
    if (!Object.hasOwn(envelope.data, root.name)) {
      missing.push(root.name);
      continue;
    }
    if (!ProviderRootSchemas[root.shape].safeParse(envelope.data[root.name]).success) {
      throw new Error("provider_response_schema_drift");
    }
    present.push(root.name);
  }

  return KisResponseInspectionSchema.parse({
    operation_ref: operationRef,
    provider: "KIS",
    response_shape_status: "envelope_checked_only",
    present_output_roots: present,
    missing_output_roots: missing,
    source_as_of: null,
    source_time_status: "not_mapped",
    received_at: time.data.received_at,
    canonical_field_mapping_status: "verification_pending",
    candidate_provider_fields_emitted: false,
  });
}

export function isR01ChartFieldMapped(fieldId: string): boolean {
  const field = fieldIndex.get(fieldId);
  return field?.canonical_mapping_verified ?? false;
}

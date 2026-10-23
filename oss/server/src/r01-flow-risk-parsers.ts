import { z } from "zod";

/**
 * Supplier-only raw candidate parsers for pinned KIS examples 110, 134 and 135.
 * They make no requests and deliberately do not create canonical report values:
 * official check scripts establish field labels, while exact type, unit,
 * denominator, correction/finality and rights are not fully verified.
 */

export type FlowRiskPayloadOrigin = "synthetic_fixture" | "provider_payload";

export class SafeKisFlowRiskParserError extends Error {
  constructor(readonly code: "invalid_input" | "upstream_rejected" | "provider_response_schema_drift" | "response_too_large") {
    super(code);
    this.name = "SafeKisFlowRiskParserError";
  }
}

const EnvelopeSchema = z.object({
  rt_cd: z.union([z.string(), z.number()]),
  msg_cd: z.union([z.string(), z.number()]).optional(),
  msg1: z.string().optional(),
}).passthrough();

const ContextSchema = z.object({
  symbol: z.string().regex(/^\d{6}$/),
  receivedAt: z.string().datetime({ offset: true }),
  origin: z.enum(["synthetic_fixture", "provider_payload"]),
}).strict();

const CreditContextSchema = ContextSchema.extend({
  requestedSettlementDate: z.string().refine(isCalendarDate),
}).strict();

function isCalendarDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export type CandidateFieldState = "present_unverified" | "blank" | "missing" | "provider_null" | "raw_type_unverified";

export interface RawProviderFieldCandidate {
  raw_value: string | null;
  state: CandidateFieldState;
}

interface ParsedRiskRow {
  operation_ref: "KIS-110" | "KIS-134" | "KIS-135";
  provider: "KIS";
  symbol_from_request: string;
  response_root: "output" | "output1" | "output2";
  row_index: number;
  raw_fields: Record<string, RawProviderFieldCandidate>;
  unmapped_field_names: string[];
  source_as_of: null;
  source_time_status: "provider_publication_instant_not_mapped";
  received_at: string;
  observed_payload_origin: FlowRiskPayloadOrigin;
  canonical_projection_status: "blocked";
  canonical_blockers: string[];
}

export interface ParsedKis134ShortSaleResponse {
  operation_ref: "KIS-134";
  provider: "KIS";
  symbol_from_request: string;
  roots: {
    output1: ParsedRiskRow;
    output2: ParsedRiskRow[];
  };
  source_as_of: null;
  source_time_status: "provider_publication_instant_not_mapped";
  received_at: string;
  observed_payload_origin: FlowRiskPayloadOrigin;
  canonical_projection_status: "blocked";
}

export type ParsedKis110CreditBalanceRow = ParsedRiskRow & {
  operation_ref: "KIS-110";
  response_root: "output";
  query_settlement_date: string;
  date_basis_status: "keep_deal_date_and_settlement_date_separate";
};

export type ParsedKis135StockLoanRow = ParsedRiskRow & {
  operation_ref: "KIS-135";
  response_root: "output1";
  row_date_candidate: "bsop_date";
  balance_change_semantics_status: "unit_and_sign_unresolved";
};

const KIS134_FIELDS = [
  "stck_prpr", "prdy_vrss", "prdy_vrss_sign", "prdy_ctrt", "acml_vol", "prdy_vol",
  "stck_bsop_date", "stck_clpr", "stnd_vol_smtn", "ssts_cntg_qty", "ssts_vol_rlim",
  "acml_ssts_cntg_qty", "acml_ssts_cntg_qty_rlim", "acml_tr_pbmn", "stnd_tr_pbmn_smtn",
  "ssts_tr_pbmn", "ssts_tr_pbmn_rlim", "acml_ssts_tr_pbmn", "acml_ssts_tr_pbmn_rlim",
  "stck_oprc", "stck_hgpr", "stck_lwpr", "avrg_prc",
] as const;

const KIS110_FIELDS = [
  "deal_date", "stck_prpr", "prdy_vrss_sign", "prdy_vrss", "prdy_ctrt", "acml_vol", "stlm_date",
  "whol_loan_new_stcn", "whol_loan_rdmp_stcn", "whol_loan_rmnd_stcn", "whol_loan_new_amt",
  "whol_loan_rdmp_amt", "whol_loan_rmnd_amt", "whol_loan_rmnd_rate", "whol_loan_gvrt",
  "whol_stln_new_stcn", "whol_stln_rdmp_stcn", "whol_stln_rmnd_stcn", "whol_stln_new_amt",
  "whol_stln_rdmp_amt", "whol_stln_rmnd_amt", "whol_stln_rmnd_rate", "whol_stln_gvrt",
  "stck_oprc", "stck_hgpr", "stck_lwpr",
] as const;

const KIS135_FIELDS = [
  "bsop_date", "stck_prpr", "prdy_vrss_sign", "prdy_vrss", "prdy_ctrt", "acml_vol",
  "new_stcn", "rdmp_stcn", "prdy_rmnd_vrss", "rmnd_stcn", "rmnd_amt",
] as const;

const BLOCKERS = [
  "raw_scalar_type_not_formally_verified_for_this_operation",
  "unit_scale_currency_and_ratio_denominator_not_fully_verified",
  "provider_publication_timestamp_and_correction_lineage_not_mapped",
  "provider_rights_and_model_host_egress_not_cleared",
  "synthetic_fixture_is_not_live_provider_evidence",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeRowShape(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function extractField(value: unknown): RawProviderFieldCandidate {
  if (value === undefined) return { raw_value: null, state: "missing" };
  if (value === null) return { raw_value: null, state: "provider_null" };
  if (typeof value !== "string") return { raw_value: null, state: "raw_type_unverified" };
  if (value === "") return { raw_value: null, state: "blank" };
  // Keep the lexeme as text. No numeric parsing, unit conversion or ratio calculation.
  return { raw_value: value, state: "present_unverified" };
}

function row(
  operationRef: ParsedRiskRow["operation_ref"],
  context: z.infer<typeof ContextSchema>,
  root: ParsedRiskRow["response_root"],
  rowIndex: number,
  rawRow: Record<string, unknown>,
  fields: readonly string[],
): ParsedRiskRow {
  const rawFields = Object.fromEntries(fields.map((field) => [field, extractField(rawRow[field])]));
  const known = new Set(fields);
  return {
    operation_ref: operationRef,
    provider: "KIS",
    symbol_from_request: context.symbol,
    response_root: root,
    row_index: rowIndex,
    raw_fields: rawFields,
    unmapped_field_names: Object.keys(rawRow).filter((field) => !known.has(field)).sort(),
    source_as_of: null,
    source_time_status: "provider_publication_instant_not_mapped",
    received_at: context.receivedAt,
    observed_payload_origin: context.origin,
    canonical_projection_status: "blocked",
    canonical_blockers: [...BLOCKERS],
  };
}

function checkedEnvelope(raw: unknown): Record<string, unknown> {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(raw);
  } catch {
    throw new SafeKisFlowRiskParserError("provider_response_schema_drift");
  }
  if (typeof encoded !== "string") throw new SafeKisFlowRiskParserError("provider_response_schema_drift");
  if (Buffer.byteLength(encoded, "utf8") > 300_000) throw new SafeKisFlowRiskParserError("response_too_large");
  const parsed = EnvelopeSchema.safeParse(raw);
  if (!parsed.success || !isRecord(raw)) throw new SafeKisFlowRiskParserError("provider_response_schema_drift");
  if (String(parsed.data.rt_cd) !== "0") throw new SafeKisFlowRiskParserError("upstream_rejected");
  return raw;
}

function rowsAt(source: Record<string, unknown>, root: string): Record<string, unknown>[] {
  const value = source[root];
  if (!Array.isArray(value) || !value.every(safeRowShape)) {
    throw new SafeKisFlowRiskParserError("provider_response_schema_drift");
  }
  return value;
}

/** Parse the two documented KIS-134 roots without guessing which root owns each field. */
export function parseKis134ShortSaleResponse(raw: unknown, input: unknown): ParsedKis134ShortSaleResponse {
  const context = ContextSchema.safeParse(input);
  if (!context.success) throw new SafeKisFlowRiskParserError("invalid_input");
  const source = checkedEnvelope(raw);
  if (!safeRowShape(source.output1)) throw new SafeKisFlowRiskParserError("provider_response_schema_drift");
  const output2 = rowsAt(source, "output2");
  const base = row("KIS-134", context.data, "output1", 0, source.output1, KIS134_FIELDS);
  const output2Rows = output2.map((item, index) => row("KIS-134", context.data, "output2", index, item, KIS134_FIELDS));
  return {
    operation_ref: "KIS-134",
    provider: "KIS",
    symbol_from_request: context.data.symbol,
    roots: { output1: base, output2: output2Rows },
    source_as_of: null,
    source_time_status: "provider_publication_instant_not_mapped",
    received_at: context.data.receivedAt,
    observed_payload_origin: context.data.origin,
    canonical_projection_status: "blocked",
  };
}

/** Parse a single KIS-110 response page; date fields remain separate raw candidates. */
export function parseKis110CreditBalanceResponse(raw: unknown, input: unknown): ParsedKis110CreditBalanceRow[] {
  const context = CreditContextSchema.safeParse(input);
  if (!context.success) throw new SafeKisFlowRiskParserError("invalid_input");
  const source = checkedEnvelope(raw);
  const rawRows = rowsAt(source, "output");
  // KIS sample documents at most 30 rows in a page. This parser is page-scoped;
  // the helper's pagination recursion is not treated as a verified adapter.
  if (rawRows.length > 30) throw new SafeKisFlowRiskParserError("provider_response_schema_drift");
  return rawRows.map((item, index) => ({
    ...row("KIS-110", context.data, "output", index, item, KIS110_FIELDS),
    operation_ref: "KIS-110" as const,
    response_root: "output" as const,
    query_settlement_date: context.data.requestedSettlementDate,
    date_basis_status: "keep_deal_date_and_settlement_date_separate",
  }));
}

/** Parse a single KIS-135 page; lending amounts/changes are not normalized. */
export function parseKis135StockLoanResponse(raw: unknown, input: unknown): ParsedKis135StockLoanRow[] {
  const context = ContextSchema.safeParse(input);
  if (!context.success) throw new SafeKisFlowRiskParserError("invalid_input");
  const source = checkedEnvelope(raw);
  const rawRows = rowsAt(source, "output1");
  if (rawRows.length > 100) throw new SafeKisFlowRiskParserError("provider_response_schema_drift");
  return rawRows.map((item, index) => ({
    ...row("KIS-135", context.data, "output1", index, item, KIS135_FIELDS),
    operation_ref: "KIS-135" as const,
    response_root: "output1" as const,
    row_date_candidate: "bsop_date",
    balance_change_semantics_status: "unit_and_sign_unresolved",
  }));
}

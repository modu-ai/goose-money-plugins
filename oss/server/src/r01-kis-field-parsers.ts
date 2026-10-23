import { z } from "zod";

/**
 * Parsers for provider fields whose names and response paths were checked in
 * the KIS portal schema review. These functions never make a network request.
 * Their outputs retain provider values as decimal strings and do not promote
 * R01 consumer fields to canonical/verified status.
 */

export type PayloadOrigin = "synthetic_fixture" | "provider_payload";

export class SafeKisParserError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SafeKisParserError";
  }
}

const ProviderEnvelopeSchema = z.object({
  rt_cd: z.union([z.string(), z.number()]),
  msg_cd: z.union([z.string(), z.number()]).optional(),
  msg1: z.string().optional(),
}).passthrough();

const dateOnlyPattern = /^\d{8}$/;
const decimalTextPattern = /^-?(?:\d+)(?:\.\d+)?$/;

function isCalendarDate(value: string): boolean {
  if (!dateOnlyPattern.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toIsoDate(value: string): string {
  if (!isCalendarDate(value)) throw new SafeKisParserError("invalid_provider_business_date");
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

const ReceivedAtSchema = z.string().datetime({ offset: true });

const Kis039ContextSchema = z.object({
  symbol: z.string().regex(/^\d{6}$/),
  board: z.enum(["J", "NX", "UN"]),
  startDate: z.string().refine(isCalendarDate),
  endDate: z.string().refine(isCalendarDate),
  periodCode: z.literal("D"),
  adjustmentCode: z.enum(["0", "1"]),
  receivedAt: ReceivedAtSchema,
  origin: z.enum(["synthetic_fixture", "provider_payload"]),
}).strict().superRefine((context, issue) => {
  if (context.startDate > context.endDate) {
    issue.addIssue({ code: "custom", path: ["startDate"], message: "date_range_reversed" });
  }
});

const Kis039RowSchema = z.object({
  stck_bsop_date: z.string().length(8),
  stck_clpr: z.string().max(10).optional(),
  stck_oprc: z.string().max(10).optional(),
  stck_hgpr: z.string().max(10).optional(),
  stck_lwpr: z.string().max(10).optional(),
  acml_vol: z.string().max(18).optional(),
  acml_tr_pbmn: z.string().max(18).optional(),
  flng_cls_code: z.string().max(2).optional(),
  prtt_rate: z.string().max(11).optional(),
  mod_yn: z.string().max(1).optional(),
  revl_issu_reas: z.string().max(2).optional(),
}).strict();

const KIS039_NUMERIC_FIELDS = [
  "stck_clpr", "stck_oprc", "stck_hgpr", "stck_lwpr", "acml_vol", "acml_tr_pbmn", "prtt_rate",
] as const;

type Kis039RawField = (typeof KIS039_NUMERIC_FIELDS)[number] | "stck_bsop_date" | "flng_cls_code" | "mod_yn" | "revl_issu_reas";

function rawFieldState(row: Record<string, unknown>, field: Kis039RawField): { value: string | null; state: "present" | "blank" | "missing" } {
  if (!Object.hasOwn(row, field)) return { value: null, state: "missing" };
  const value = row[field];
  if (typeof value !== "string") throw new SafeKisParserError("provider_response_schema_drift");
  if (value === "") return { value: null, state: "blank" };
  if ((KIS039_NUMERIC_FIELDS as readonly string[]).includes(field) && !decimalTextPattern.test(value)) {
    throw new SafeKisParserError("provider_numeric_format_invalid");
  }
  return { value, state: "present" };
}

export interface ParsedKis039DailyBar {
  operation_ref: "KIS-039";
  provider: "KIS";
  symbol_from_request: string;
  market_code_from_request: "J" | "NX" | "UN";
  provider_business_date: string;
  raw_fields: Record<Kis039RawField, { value: string | null; state: "present" | "blank" | "missing" }>;
  requested_adjustment_code: "0" | "1";
  adjustment_code_interpretation: "blocked_portal_sample_conflict";
  source_as_of: null;
  source_time_status: "date_only_no_provider_time_or_timezone";
  received_at: string;
  observed_payload_origin: PayloadOrigin;
  response_row_status: "provider_field_shape_checked_not_live_reconciled";
  response_range_completeness: "unknown_pagination_not_demonstrated";
  canonical_projection_status: "blocked";
  canonical_blockers: string[];
}

/** Parse only the documented KIS-039 daily row fields; no units are inferred. */
export function parseKis039DailyChartResponse(raw: unknown, input: unknown): ParsedKis039DailyBar[] {
  const context = Kis039ContextSchema.safeParse(input);
  if (!context.success) throw new SafeKisParserError("invalid_input");

  const envelope = ProviderEnvelopeSchema.safeParse(raw);
  if (!envelope.success) throw new SafeKisParserError("provider_response_schema_drift");
  if (String(envelope.data.rt_cd) !== "0") throw new SafeKisParserError("upstream_rejected");

  if (!Object.hasOwn(raw as object, "output1") || !isRecord((raw as Record<string, unknown>).output1)) {
    throw new SafeKisParserError("provider_response_schema_drift");
  }
  const rawRows = (raw as Record<string, unknown>).output2;
  if (!Array.isArray(rawRows) || rawRows.length > 100) throw new SafeKisParserError("provider_response_schema_drift");

  const seenDates = new Set<string>();
  return rawRows.map((rawRow) => {
    const parsed = Kis039RowSchema.safeParse(rawRow);
    if (!parsed.success) throw new SafeKisParserError("provider_response_schema_drift");
    const row = parsed.data;
    const isoDate = toIsoDate(row.stck_bsop_date);
    if (row.stck_bsop_date < context.data.startDate || row.stck_bsop_date > context.data.endDate) {
      throw new SafeKisParserError("provider_date_outside_requested_range");
    }
    if (seenDates.has(row.stck_bsop_date)) throw new SafeKisParserError("duplicate_provider_business_date");
    seenDates.add(row.stck_bsop_date);

    const record = rawRow as Record<string, unknown>;
    const rawFields: ParsedKis039DailyBar["raw_fields"] = {
      stck_bsop_date: rawFieldState(record, "stck_bsop_date"),
      stck_clpr: rawFieldState(record, "stck_clpr"),
      stck_oprc: rawFieldState(record, "stck_oprc"),
      stck_hgpr: rawFieldState(record, "stck_hgpr"),
      stck_lwpr: rawFieldState(record, "stck_lwpr"),
      acml_vol: rawFieldState(record, "acml_vol"),
      acml_tr_pbmn: rawFieldState(record, "acml_tr_pbmn"),
      flng_cls_code: rawFieldState(record, "flng_cls_code"),
      prtt_rate: rawFieldState(record, "prtt_rate"),
      mod_yn: rawFieldState(record, "mod_yn"),
      revl_issu_reas: rawFieldState(record, "revl_issu_reas"),
    };

    return {
      operation_ref: "KIS-039",
      provider: "KIS",
      symbol_from_request: context.data.symbol,
      market_code_from_request: context.data.board,
      provider_business_date: isoDate,
      raw_fields: rawFields,
      requested_adjustment_code: context.data.adjustmentCode,
      adjustment_code_interpretation: "blocked_portal_sample_conflict",
      source_as_of: null,
      source_time_status: "date_only_no_provider_time_or_timezone",
      received_at: context.data.receivedAt,
      observed_payload_origin: context.data.origin,
      response_row_status: "provider_field_shape_checked_not_live_reconciled",
      response_range_completeness: "unknown_pagination_not_demonstrated",
      canonical_projection_status: "blocked",
      canonical_blockers: [
        "price_currency_and_scale_not_stated_in_endpoint_schema",
        "volume_unit_not_stated_in_endpoint_schema",
        "trade_amount_currency_and_scale_not_stated_in_endpoint_schema",
        "adjustment_code_portal_sample_conflict",
        "data_rights_and_host_egress_not_approved_by_this_parser",
      ],
    } satisfies ParsedKis039DailyBar;
  });
}

const Kis115FieldLengths = {
  stck_bsop_date: 8,
  stck_clpr: 10,
  acml_vol: 18,
  acml_tr_pbmn: 18,
  frgn_ntby_qty: 12,
  prsn_ntby_qty: 12,
  orgn_ntby_qty: 18,
  frgn_ntby_tr_pbmn: 18,
  prsn_ntby_tr_pbmn: 18,
  orgn_ntby_tr_pbmn: 18,
  frgn_reg_ntby_qty: 18,
  frgn_nreg_ntby_qty: 18,
  prdy_vrss_sign: 1,
  prdy_ctrt: 82,
} as const;

const Kis115RowSchema = z.object({
  stck_bsop_date: z.string().length(Kis115FieldLengths.stck_bsop_date),
  stck_clpr: z.string().max(Kis115FieldLengths.stck_clpr).optional(),
  acml_vol: z.string().max(Kis115FieldLengths.acml_vol).optional(),
  acml_tr_pbmn: z.string().max(Kis115FieldLengths.acml_tr_pbmn).optional(),
  frgn_ntby_qty: z.string().max(Kis115FieldLengths.frgn_ntby_qty).optional(),
  prsn_ntby_qty: z.string().max(Kis115FieldLengths.prsn_ntby_qty).optional(),
  orgn_ntby_qty: z.string().max(Kis115FieldLengths.orgn_ntby_qty).optional(),
  frgn_ntby_tr_pbmn: z.string().max(Kis115FieldLengths.frgn_ntby_tr_pbmn).optional(),
  prsn_ntby_tr_pbmn: z.string().max(Kis115FieldLengths.prsn_ntby_tr_pbmn).optional(),
  orgn_ntby_tr_pbmn: z.string().max(Kis115FieldLengths.orgn_ntby_tr_pbmn).optional(),
  frgn_reg_ntby_qty: z.string().max(Kis115FieldLengths.frgn_reg_ntby_qty).optional(),
  frgn_nreg_ntby_qty: z.string().max(Kis115FieldLengths.frgn_nreg_ntby_qty).optional(),
  prdy_vrss_sign: z.string().max(Kis115FieldLengths.prdy_vrss_sign).optional(),
  prdy_ctrt: z.string().max(Kis115FieldLengths.prdy_ctrt).optional(),
}).strict();

const Kis115ContextSchema = z.object({
  requestedInputDate: z.string().refine(isCalendarDate),
  receivedAt: ReceivedAtSchema,
  origin: z.enum(["synthetic_fixture", "provider_payload"]),
}).strict();

function multiplyDecimalStringByPowerOfTen(value: string, places: number): string {
  if (!Number.isInteger(places) || places < 0 || !decimalTextPattern.test(value)) {
    throw new SafeKisParserError("provider_numeric_format_invalid");
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "", fraction = ""] = unsigned.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  const scaledPlaces = fraction.length - places;
  let scaledWhole: string;
  let scaledFraction: string;
  if (scaledPlaces <= 0) {
    scaledWhole = `${digits}${"0".repeat(-scaledPlaces)}`;
    scaledFraction = "";
  } else if (scaledPlaces >= digits.length) {
    scaledWhole = "0";
    scaledFraction = `${"0".repeat(scaledPlaces - digits.length)}${digits}`;
  } else {
    scaledWhole = digits.slice(0, digits.length - scaledPlaces);
    scaledFraction = digits.slice(digits.length - scaledPlaces);
  }
  scaledWhole = scaledWhole.replace(/^0+(?=\d)/, "");
  scaledFraction = scaledFraction.replace(/0+$/, "");
  const isZero = /^0+$/.test(scaledWhole) && scaledFraction.length === 0;
  return `${negative && !isZero ? "-" : ""}${scaledWhole}${scaledFraction ? `.${scaledFraction}` : ""}`;
}

function parseProviderPayload(raw: unknown): { output1: Record<string, unknown>; output2: unknown[] } {
  const envelope = ProviderEnvelopeSchema.safeParse(raw);
  if (!envelope.success) throw new SafeKisParserError("provider_response_schema_drift");
  if (String(envelope.data.rt_cd) !== "0") throw new SafeKisParserError("upstream_rejected");
  const source = raw as Record<string, unknown>;
  if (!Object.hasOwn(source, "output1") || !isRecord(source.output1) || !Array.isArray(source.output2)) {
    throw new SafeKisParserError("provider_response_schema_drift");
  }
  return { output1: source.output1, output2: source.output2 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactAmountField(value: string | undefined): {
  raw_value: string | null;
  raw_unit: "KRW_million";
  value_krw: string | null;
  normalized_unit: "KRW";
  state: "present" | "blank" | "missing";
} {
  if (value === undefined) return { raw_value: null, raw_unit: "KRW_million", value_krw: null, normalized_unit: "KRW", state: "missing" };
  if (value === "") return { raw_value: null, raw_unit: "KRW_million", value_krw: null, normalized_unit: "KRW", state: "blank" };
  if (!decimalTextPattern.test(value)) throw new SafeKisParserError("provider_numeric_format_invalid");
  return {
    raw_value: value,
    raw_unit: "KRW_million",
    value_krw: multiplyDecimalStringByPowerOfTen(value, 6),
    normalized_unit: "KRW",
    state: "present",
  };
}

function exactShareField(value: string | undefined): { raw_value: string | null; value_shares: string | null; unit: "shares"; state: "present" | "blank" | "missing" } {
  if (value === undefined) return { raw_value: null, value_shares: null, unit: "shares", state: "missing" };
  if (value === "") return { raw_value: null, value_shares: null, unit: "shares", state: "blank" };
  if (!/^-?\d+$/.test(value)) throw new SafeKisParserError("provider_numeric_format_invalid");
  return { raw_value: value, value_shares: value, unit: "shares", state: "present" };
}

export interface ParsedKis115InvestorFlowRow {
  operation_ref: "KIS-115";
  provider: "KIS";
  requested_input_date: string;
  request_date_semantics: "input_parameter_to_row_relationship_not_assumed";
  provider_business_date: string;
  raw_quote_fields: {
    close_price: string | null;
    traded_volume: string | null;
    traded_amount: ReturnType<typeof exactAmountField>;
  };
  actor_flows: {
    foreign: { net_buy_quantity: ReturnType<typeof exactShareField>; net_buy_amount: ReturnType<typeof exactAmountField> };
    individual: { net_buy_quantity: ReturnType<typeof exactShareField>; net_buy_amount: ReturnType<typeof exactAmountField> };
    institution: { net_buy_quantity: ReturnType<typeof exactShareField>; net_buy_amount: ReturnType<typeof exactAmountField> };
  };
  separately_reported_foreign_quantities: {
    registered: ReturnType<typeof exactShareField>;
    non_registered: ReturnType<typeof exactShareField>;
  };
  source_as_of: null;
  source_time_status: "date_only_no_provider_time_or_timezone";
  received_at: string;
  observed_payload_origin: PayloadOrigin;
  response_row_status: "provider_field_shape_checked_not_live_reconciled";
  current_day_finality: "not_inferred_from_response";
  request_status: "official_portal_request_fields_encoded_sample_differs";
  canonical_projection_status: "blocked";
  canonical_blockers: string[];
}

/**
 * Parse synthetic/provider-shaped KIS-115 rows. Amounts documented in 백만원
 * are multiplied by 1,000,000 with string arithmetic. The request date remains
 * separate from each row date because the reviewed field description does not
 * establish that every output row must equal FID_INPUT_DATE_1.
 */
export function parseKis115InvestorFlowResponse(raw: unknown, input: unknown): ParsedKis115InvestorFlowRow[] {
  const context = Kis115ContextSchema.safeParse(input);
  if (!context.success) throw new SafeKisParserError("invalid_input");
  const response = parseProviderPayload(raw);
  if (response.output2.length > 1000) throw new SafeKisParserError("response_too_large");

  return response.output2.map((rawRow) => {
    const parsed = Kis115RowSchema.safeParse(rawRow);
    if (!parsed.success) throw new SafeKisParserError("provider_response_schema_drift");
    const row = parsed.data;
    const isoDate = toIsoDate(row.stck_bsop_date);
    return {
      operation_ref: "KIS-115",
      provider: "KIS",
      requested_input_date: context.data.requestedInputDate,
      request_date_semantics: "input_parameter_to_row_relationship_not_assumed",
      provider_business_date: isoDate,
      raw_quote_fields: {
        close_price: row.stck_clpr ?? null,
        traded_volume: row.acml_vol ?? null,
        traded_amount: exactAmountField(row.acml_tr_pbmn),
      },
      actor_flows: {
        foreign: { net_buy_quantity: exactShareField(row.frgn_ntby_qty), net_buy_amount: exactAmountField(row.frgn_ntby_tr_pbmn) },
        individual: { net_buy_quantity: exactShareField(row.prsn_ntby_qty), net_buy_amount: exactAmountField(row.prsn_ntby_tr_pbmn) },
        institution: { net_buy_quantity: exactShareField(row.orgn_ntby_qty), net_buy_amount: exactAmountField(row.orgn_ntby_tr_pbmn) },
      },
      separately_reported_foreign_quantities: {
        registered: exactShareField(row.frgn_reg_ntby_qty),
        non_registered: exactShareField(row.frgn_nreg_ntby_qty),
      },
      source_as_of: null,
      source_time_status: "date_only_no_provider_time_or_timezone",
      received_at: context.data.receivedAt,
      observed_payload_origin: context.data.origin,
      response_row_status: "provider_field_shape_checked_not_live_reconciled",
      current_day_finality: "not_inferred_from_response",
      request_status: "official_portal_request_fields_encoded_sample_differs",
      canonical_projection_status: "blocked",
      canonical_blockers: [
        "pinned_sample_request_differs_from_official_portal_FID_ETC_CLS_CODE_value",
        "request_date_to_response_row_relationship_not_confirmed",
        "current_day_values_are_provisional_without_per_row_provider_time",
        "data_rights_and_host_egress_not_approved_by_this_parser",
      ],
    } satisfies ParsedKis115InvestorFlowRow;
  });
}

export interface R01OperationDiagnostic {
  operation_ref: string;
  parser_status: "implemented_shape_only" | "implemented_shape_and_documented_amount_conversion" | "not_implemented";
  canonical_status: "blocked";
  live_request_status: "not_implemented_or_blocked" | "request_adapter_implemented_not_invoked_or_tool_exposed" | "bounded_request_adapter_implemented_not_invoked_or_tool_exposed";
  blockers: string[];
}

export const R01_OPERATION_DIAGNOSTICS: R01OperationDiagnostic[] = [
  { operation_ref: "KIS-039", parser_status: "implemented_shape_only", canonical_status: "blocked", live_request_status: "request_adapter_implemented_not_invoked_or_tool_exposed", blockers: ["price_currency_scale_unknown", "volume_unit_unknown", "trade_amount_scale_unknown", "adjustment_code_portal_sample_conflict", "rights_not_cleared", "no_live_response"] },
  { operation_ref: "KIS-254", parser_status: "not_implemented", canonical_status: "blocked", live_request_status: "not_implemented_or_blocked", blockers: ["pagination_portal_sample_conflict", "price_currency_unknown", "volume_and_trade_amount_units_unknown", "no_live_response"] },
  { operation_ref: "KIS-303", parser_status: "not_implemented", canonical_status: "blocked", live_request_status: "not_implemented_or_blocked", blockers: ["contract_master_scaling_required", "currency_multiplier_and_volume_unit_unresolved", "exchange_timezone_unresolved", "no_live_response"] },
  { operation_ref: "KIS-212", parser_status: "not_implemented", canonical_status: "blocked", live_request_status: "not_implemented_or_blocked", blockers: ["pagination_contract_not_tested", "futures_contract_master_required", "price_and_volume_units_unknown", "no_live_response"] },
  { operation_ref: "KIS-072", parser_status: "not_implemented", canonical_status: "blocked", live_request_status: "not_implemented_or_blocked", blockers: ["pagination_portal_sample_conflict", "index_unit_currency_and_timezone_unknown", "portal_field_length_anomaly", "no_live_response"] },
  { operation_ref: "KIS-264", parser_status: "not_implemented", canonical_status: "blocked", live_request_status: "not_implemented_or_blocked", blockers: ["pagination_portal_sample_conflict", "index_unit_currency_and_timezone_unknown", "portal_field_length_anomaly", "no_live_response"] },
  { operation_ref: "KIS-115", parser_status: "implemented_shape_and_documented_amount_conversion", canonical_status: "blocked", live_request_status: "bounded_request_adapter_implemented_not_invoked_or_tool_exposed", blockers: ["pinned_sample_request_differs_from_official_portal_FID_ETC_CLS_CODE_value", "provider_page_count_and_total_rows_unavailable", "request_date_to_response_row_relationship_not_confirmed", "no_live_response", "rights_not_cleared"] },
  { operation_ref: "KIS-113", parser_status: "not_implemented", canonical_status: "blocked", live_request_status: "not_implemented_or_blocked", blockers: ["amount_currency_and_scale_unknown", "quantity_unit_unknown", "market_scope_not_security_scope", "no_live_response"] },
  { operation_ref: "KIS-109", parser_status: "not_implemented", canonical_status: "blocked", live_request_status: "not_implemented_or_blocked", blockers: ["pagination_portal_sample_conflict", "positional_metric_alignment_unverified", "consensus_scope_and_rights_unresolved", "no_live_response"] },
  { operation_ref: "KIS-280", parser_status: "not_implemented", canonical_status: "blocked", live_request_status: "not_implemented_or_blocked", blockers: ["event_codebook_incomplete", "domestic_KSD_not_covered", "event_time_and_timezone_unavailable", "no_live_response"] },
];

export function getR01OperationDiagnostic(operationRef: string): R01OperationDiagnostic {
  const diagnostic = R01_OPERATION_DIAGNOSTICS.find((item) => item.operation_ref === operationRef);
  if (!diagnostic) throw new SafeKisParserError("unknown_kis_operation");
  return diagnostic;
}

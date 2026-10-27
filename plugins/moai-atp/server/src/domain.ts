import { z } from "zod";

const decimalString = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const unsignedDecimalString = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const shareCountString = z.string().regex(/^(?:0|[1-9]\d*)$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoTimestamp = z.string().datetime({ offset: true });

export const QuoteInputSchema = z.object({
  symbol: z.string().regex(/^\d{6}$/),
  board: z.enum(["J", "NX", "UN"]).default("J"),
}).strict();

export const FieldLineageSchema = z.object({
  normalized_field: z.enum(["last", "open", "high", "low", "change", "change_percent", "volume"]),
  provider_field: z.string().min(1),
  raw_path: z.string().min(1),
  raw_unit: z.string().min(1),
  raw_sign: z.string().nullable(),
  transform: z.string().min(1),
  nullable_reason: z.string().nullable(),
  fixture_id: z.string().min(1),
  mapping_status: z.enum(["supported", "derived", "verification_pending"]),
}).strict();

export const QuoteDataSchema = z.object({
  last: unsignedDecimalString.nullable(),
  open: unsignedDecimalString.nullable(),
  high: unsignedDecimalString.nullable(),
  low: unsignedDecimalString.nullable(),
  change: decimalString.nullable(),
  change_percent: decimalString.nullable(),
  volume: shareCountString.nullable(),
  currency: z.literal("KRW"),
  price_unit: z.literal("KRW per share"),
  volume_unit: z.literal("shares"),
  change_percent_unit: z.literal("percent"),
  source_field_values: z.record(z.string(), z.unknown()),
  null_reasons: z.record(z.string(), z.string()),
  field_lineage: z.array(FieldLineageSchema),
}).strict();

export const QuoteSnapshotSchema = z.object({
  ok: z.literal(true),
  provider: z.literal("kis"),
  operation_id: z.literal("kis.kr.quote.snapshot.v1"),
  market: z.literal("KR"),
  instrument_ref: z.object({
    market: z.literal("KR"),
    exchange: z.string(),
    symbol: z.string().regex(/^\d{6}$/),
    asset_type: z.literal("equity"),
    source_market_division_code: z.enum(["J", "NX", "UN"]),
  }).strict(),
  provenance: z.object({
    api_reference: z.string(),
    provider_api_version: z.string(),
    source_as_of: isoDate.nullable(),
    event_time: isoTimestamp.nullable(),
    published_at: isoTimestamp.nullable(),
    received_at: isoTimestamp,
    available_at: isoTimestamp,
    effective_from: isoDate.nullable(),
    effective_to: isoDate.nullable(),
    supersedes: z.string().nullable(),
    report_cutoff: isoTimestamp.nullable(),
    retrieved_at: isoTimestamp,
    source_timezone: z.string(),
    clock_basis: z.string(),
    timezone: z.string(),
    session: z.enum(["pre", "regular", "after", "close", "unknown"]),
    currency: z.string(),
    unit: z.string(),
    delay_state: z.enum(["realtime", "delayed", "end_of_day", "unknown"]),
    adjusted: z.boolean().nullable(),
    rights_status: z.enum(["approved", "pending", "blocked"]),
    origin: z.enum(["actual", "synthetic"]),
    estimate_kind: z.enum(["reported", "guidance", "internal", "consensus", "not_applicable"]),
    finality: z.enum(["preliminary", "final", "unknown"]),
    revision_id: z.string().nullable(),
    availability: z.enum(["available", "partial", "unavailable"]),
    validation_status: z.enum(["provider_shape_checked", "synthetic_fixture", "independently_reconciled", "unverified"]),
    freshness: z.enum(["fresh", "stale", "unknown"]),
    partial: z.boolean(),
    stale: z.boolean().nullable(),
  }).strict(),
  data: QuoteDataSchema,
  warnings: z.array(z.string()),
  error: z.null(),
}).strict();

export type QuoteInput = z.infer<typeof QuoteInputSchema>;
export type QuoteData = z.infer<typeof QuoteDataSchema>;
export type QuoteSnapshot = z.infer<typeof QuoteSnapshotSchema>;

export const ProviderQuoteEnvelopeSchema = z.object({
  rt_cd: z.union([z.string(), z.number()]).optional(),
  msg_cd: z.union([z.string(), z.number()]).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export function validateProviderQuoteJson(rawText: string, maxBytes = 300_000): z.infer<typeof ProviderQuoteEnvelopeSchema> {
  if (Buffer.byteLength(rawText, "utf8") > maxBytes) throw new Error("response_too_large");
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawText) as unknown;
  } catch {
    throw new Error("schema_drift");
  }
  const parsed = ProviderQuoteEnvelopeSchema.safeParse(decoded);
  if (!parsed.success) throw new Error("schema_drift");
  return parsed.data;
}

export function assertNormalizedSnapshot(value: unknown): QuoteSnapshot {
  const parsed = QuoteSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error("normalized_schema_invalid");
  return parsed.data;
}

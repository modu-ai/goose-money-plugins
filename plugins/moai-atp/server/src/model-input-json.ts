import { z } from "zod";
import type { QuoteSnapshot } from "./domain.js";
import type { DerivedMetric } from "./indicators.js";

const SelectedFactSchema = z.object({
  fact_id: z.string().regex(/^R01\.[a-z_0-9]+$/),
  value: z.string().nullable(),
  unit: z.string(),
  currency: z.string().nullable(),
  source_field: z.string(),
  evidence_ref: z.string().min(1),
  status: z.enum(["provider_observed", "provider_derived", "missing"]),
}).strict();

export const ModelInputFactsSchema = z.object({
  contract: z.literal("moai.stock.llm-facts.v1"),
  instrument: z.object({ market: z.literal("KR"), symbol: z.string().regex(/^\d{6}$/), asset_type: z.literal("equity") }).strict(),
  times: z.object({ source_as_of: z.string().nullable(), received_at: z.string(), timezone: z.string() }).strict(),
  facts: z.array(SelectedFactSchema),
  evidence_note: z.literal("Fact IDs resolve to canonical DTO or deterministic calculation lineage; missing values are not zero."),
}).strict();

export type ModelInputFacts = z.infer<typeof ModelInputFactsSchema>;

const quoteFactMap = {
  last: { unit: "KRW/share", source: "stck_prpr" },
  open: { unit: "KRW/share", source: "stck_oprc" },
  high: { unit: "KRW/share", source: "stck_hgpr" },
  low: { unit: "KRW/share", source: "stck_lwpr" },
  change: { unit: "KRW/share", source: "prdy_vrss+prdy_vrss_sign" },
  change_percent: { unit: "percent", source: "prdy_ctrt" },
  volume: { unit: "shares", source: "acml_vol" },
} as const;

export type QuoteFactField = keyof typeof quoteFactMap;

/** Select only facts requested for a report from the canonical, already validated DTO. */
export function selectQuoteFacts(
  snapshot: QuoteSnapshot,
  requiredFields: readonly QuoteFactField[],
  requiredMetrics: readonly DerivedMetric[] = [],
): ModelInputFacts {
  const uniqueFields = [...new Set(requiredFields)];
  const base = ModelInputFactsSchema.parse({
    contract: "moai.stock.llm-facts.v1",
    instrument: { market: "KR", symbol: snapshot.instrument_ref.symbol, asset_type: "equity" },
    times: {
      source_as_of: snapshot.provenance.source_as_of,
      received_at: snapshot.provenance.received_at,
      timezone: snapshot.provenance.source_timezone,
    },
    facts: uniqueFields.map((field) => {
      const value = snapshot.data[field];
      return {
        fact_id: `R01.${field}`,
        value,
        unit: quoteFactMap[field].unit,
        currency: field === "volume" || field === "change_percent" ? null : "KRW",
        source_field: quoteFactMap[field].source,
        evidence_ref: `dto:${snapshot.operation_id}:${field}`,
        status: value === null ? "missing" : field === "change" ? "provider_derived" : "provider_observed",
      };
    }),
    evidence_note: "Fact IDs resolve to canonical DTO or deterministic calculation lineage; missing values are not zero.",
  });
  const metrics = requiredMetrics.map((metric) => ({
    fact_id: `R01.${metric.metric_id}`,
    value: metric.value,
    unit: metric.unit,
    currency: metric.currency,
    source_field: metric.formula,
    evidence_ref: metric.lineage_id,
    status: "provider_derived" as const,
  }));
  return ModelInputFactsSchema.parse({ ...base, facts: [...base.facts, ...metrics] });
}

/** Keep the model-input wire format plain JSON; financial values remain decimal strings. */
export function serializeModelInputJson(input: ModelInputFacts): string {
  return JSON.stringify(ModelInputFactsSchema.parse(input));
}

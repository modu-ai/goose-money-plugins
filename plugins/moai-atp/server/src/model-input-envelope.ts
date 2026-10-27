import { z } from "zod";
import { QuoteSnapshotSchema, type QuoteSnapshot } from "./domain.js";
import { ModelInputFactsSchema, selectQuoteFacts, type QuoteFactField } from "./model-input-json.js";

/** Additive boundary: v1 facts are retained verbatim, while provenance cannot be lost. */
export const ModelInputEnvelopeSchema = z.object({
  contract: z.literal("moai.stock.llm-envelope.v2"),
  provenance: QuoteSnapshotSchema.shape.provenance,
  input: ModelInputFactsSchema,
  usage: z.literal("research_only_not_trade_execution"),
}).strict().superRefine((value, ctx) => {
  if (value.input.times.received_at !== value.provenance.received_at ||
      value.input.times.source_as_of !== value.provenance.source_as_of ||
      value.input.times.timezone !== value.provenance.source_timezone) {
    ctx.addIssue({ code: "custom", message: "provenance_time_mismatch" });
  }
  const ids = value.input.facts.map(fact => fact.fact_id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "duplicate_fact_id" });
  for (const fact of value.input.facts) {
    if ((fact.value === null) !== (fact.status === "missing")) {
      ctx.addIssue({ code: "custom", message: "missing_status_mismatch" });
    }
  }
});

export function selectQuoteEnvelope(snapshot: QuoteSnapshot, fields: readonly QuoteFactField[]) {
  const valid = QuoteSnapshotSchema.parse(snapshot);
  return ModelInputEnvelopeSchema.parse({
    contract: "moai.stock.llm-envelope.v2",
    provenance: valid.provenance,
    input: selectQuoteFacts(valid, fields),
    usage: "research_only_not_trade_execution",
  });
}

/** This checks a claim, not publication permission or independent reconciliation. */
export function assertActualDataClaim(input: unknown): void {
  const envelope = ModelInputEnvelopeSchema.parse(input);
  if (!envelope.input.facts.some(fact => fact.value !== null && fact.status !== "missing") || envelope.provenance.origin !== "actual" ||
      !["provider_shape_checked", "independently_reconciled"].includes(envelope.provenance.validation_status)) {
    throw new Error("actual_data_claim_not_supported");
  }
}

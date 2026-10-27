import { z } from "zod";

/** Official contract verified 2026-10-22. No live API or credential access. */
export const OPENDART_DOCUMENTATION = "https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS003&apiId=2019020";
export const OPENDART_ENDPOINT = "https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json";
const yearSchema = z.string().regex(/^\d{4}$/).refine(value => Number(value) >= 2015);
const reportSchema = z.enum(["11013", "11012", "11014", "11011"]);
export const openDartInputSchema = z.object({
  corp_code: z.string().regex(/^\d{8}$/), bsns_year: yearSchema,
  reprt_code: reportSchema, fs_div: z.enum(["CFS", "OFS"]),
}).strict();
export type OpenDartInput = z.infer<typeof openDartInputSchema>;
export const openDartProvenanceSchema = z.object({
  origin: z.enum(["actual", "synthetic"]), received_at: z.iso.datetime({ offset: true }).max(40),
}).strict();
export type OpenDartProvenance = z.infer<typeof openDartProvenanceSchema>;
const text = z.string().max(2048);
// Keep empty and missing distinct, and never round financial amounts via Number.
const amountText = z.string().max(128).refine(value => value.trim() === "" || /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value));
export const openDartRowSchema = z.object({
  rcept_no: z.string().regex(/^\d{14}$/), reprt_code: reportSchema, bsns_year: yearSchema,
  corp_code: z.string().regex(/^\d{8}$/), sj_div: z.enum(["BS", "IS", "CIS", "CF", "SCE"]),
  sj_nm: text, account_id: text, account_nm: text, account_detail: text.optional(),
  thstrm_nm: text.optional(), thstrm_amount: amountText.optional(), thstrm_add_amount: amountText.optional(),
  frmtrm_nm: text.optional(), frmtrm_amount: amountText.optional(), frmtrm_q_nm: text.optional(),
  frmtrm_q_amount: amountText.optional(), frmtrm_add_amount: amountText.optional(),
  bfefrmtrm_nm: text.optional(), bfefrmtrm_amount: amountText.optional(),
  ord: z.string().max(20).regex(/^\d+$/), currency: z.string().max(32).optional(),
}).strict();
export type OpenDartRow = z.infer<typeof openDartRowSchema>;
const payloadSchema = z.object({
  status: z.string().regex(/^\d{3}$/), message: z.string().max(2048),
  list: z.array(openDartRowSchema).max(10000).optional(),
}).strict();
const amountSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("missing") }).strict(),
  z.object({ state: z.literal("blank"), raw: z.string().max(128) }).strict(),
  z.object({ state: z.literal("value"), raw: amountText, decimal: z.string().max(128).regex(/^[+-]?\d+(?:\.\d+)?$/) }).strict(),
]);
export type OpenDartAmount = z.infer<typeof amountSchema>;
export function parseOpenDartAmount(value: unknown): OpenDartAmount {
  if (value === undefined) return { state: "missing" };
  const parsed = amountText.safeParse(value);
  if (!parsed.success) throw new SafeOpenDartError("invalid_response");
  return parsed.data.trim() === "" ? { state: "blank", raw: parsed.data }
    : { state: "value", raw: parsed.data, decimal: parsed.data.replaceAll(",", "") };
}
const normalizedRowSchema = z.object({
  raw: openDartRowSchema,
  filing_url: z.string().max(100), fs_div: z.enum(["CFS", "OFS"]),
  // Duration only asserted when documented; names remain provider evidence, not guessed dates.
  current_period_kind: z.enum(["three_months", "unspecified"]),
  amounts: z.object({
    current: amountSchema, current_cumulative: amountSchema, prior: amountSchema,
    prior_comparable: amountSchema, prior_cumulative: amountSchema, two_years_prior: amountSchema,
  }).strict(),
}).strict();
export const openDartResultSchema = z.object({
  status: z.enum(["ok", "no_data", "rate_limited", "error"]),
  provider_status: z.string().regex(/^\d{3}$/),
  error_code: z.enum(["provider_error"]).optional(),
  request: openDartInputSchema, provenance: openDartProvenanceSchema,
  source: z.literal("opendart"), documentation: z.literal(OPENDART_DOCUMENTATION),
  rows: z.array(normalizedRowSchema).max(10000),
}).strict().superRefine((value, ctx) => {
  const expected = value.provider_status === "000" ? "ok" : value.provider_status === "013" ? "no_data" : value.provider_status === "020" ? "rate_limited" : "error";
  if (value.status !== expected || (value.status !== "ok" && value.rows.length > 0)
      || (value.status === "error") !== (value.error_code === "provider_error")) {
    ctx.addIssue({ code: "custom", message: "invalid_status_consistency" });
  }
});
export type OpenDartResult = z.infer<typeof openDartResultSchema>;
export class SafeOpenDartError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_provenance" | "invalid_response" | "response_mismatch" | "transport_error"
    | "credential_missing" | "credential_rejected" | "rate_limited" | "upstream_rejected" | "upstream_unavailable" | "upstream_timeout") {
    super(code); this.name = "SafeOpenDartError";
  }
}
/**
 * OpenDART HTTP-layer code (SafeOpenDartHttpError) -> the shared tool-result vocabulary (SPEC-ATP-AUTH-002 M2).
 * Codes that fit no failure class F1-F7 (redirect, oversize body, key reflection, clock, authorization, ...)
 * and any error that is not an HTTP-layer error stay transport_error (F8). Matched by name and code so this
 * module does not import opendart-http.ts, which imports it.
 */
const HTTP_LAYER_CODES = new Map<string, SafeOpenDartError["code"]>([
  ["credential_unavailable", "credential_missing"], ["credential_rejected", "credential_rejected"], ["rate_limited", "rate_limited"],
  ["http_rejected", "upstream_rejected"], ["transport_failed", "upstream_unavailable"], ["request_timeout", "upstream_timeout"],
  ["invalid_response", "invalid_response"],
]);
/** Prototype links inspected for a property; a genuine SafeOpenDartHttpError keeps both properties on the instance itself. */
const MAX_PROTOTYPE_WALK = 8;
/**
 * A string-valued DATA property of an injected error, found without running anything the error controls:
 * only Object.getOwnPropertyDescriptor (never a property read, so no getter and no Proxy `get` trap runs),
 * along at most MAX_PROTOTYPE_WALK prototype links. The first own descriptor found decides, as a read would:
 * an accessor, or a non-string value, means "not trusted" (undefined), never a call.
 */
function inspectedDataString(error: object, key: "name" | "code"): string | undefined {
  let holder: object | null = error;
  for (let depth = 0; depth < MAX_PROTOTYPE_WALK && holder !== null; depth += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(holder, key);
    if (descriptor !== undefined) return "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : undefined;
    holder = Object.getPrototypeOf(holder);
  }
  return undefined;
}
/**
 * Whatever a provider/transport throws leaves as a SafeOpenDartError, always. The inspection can run hostile
 * code (an injected Proxy's traps, `instanceof` on a Proxy) and is therefore wrapped as a whole: any failure
 * falls back to transport_error, as the unconditional catch did before the HTTP-layer mapping existed.
 */
export function openDartTransportError(error: unknown): SafeOpenDartError {
  try {
    if (error instanceof Error && inspectedDataString(error, "name") === "SafeOpenDartHttpError") {
      const code = inspectedDataString(error, "code");
      const mapped = code === undefined ? undefined : HTTP_LAYER_CODES.get(code);
      if (mapped) return new SafeOpenDartError(mapped);
    }
  } catch { /* The injected error's own failure never replaces the sanitized outcome. */ }
  return new SafeOpenDartError("transport_error");
}
function validateInput(input: unknown): OpenDartInput {
  const result = openDartInputSchema.safeParse(input);
  if (!result.success) throw new SafeOpenDartError("invalid_input");
  return result.data;
}
function validateProvenance(provenance: unknown): OpenDartProvenance {
  const result = openDartProvenanceSchema.safeParse(provenance);
  if (!result.success) throw new SafeOpenDartError("invalid_provenance");
  return result.data;
}
export function parseOpenDartFullStatement(input: unknown, payload: unknown, provenance: unknown): OpenDartResult {
  const request = validateInput(input);
  const evidence = validateProvenance(provenance);
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) throw new SafeOpenDartError("invalid_response");
  const data = parsed.data;
  if (data.status === "000" && !data.list) throw new SafeOpenDartError("invalid_response");
  if (data.status !== "000" && data.list && data.list.length > 0) throw new SafeOpenDartError("invalid_response");
  const status = data.status === "000" ? "ok" : data.status === "013" ? "no_data" : data.status === "020" ? "rate_limited" : "error";
  const rows = (data.list ?? []).map(raw => {
    if (raw.corp_code !== request.corp_code || raw.bsns_year !== request.bsns_year || raw.reprt_code !== request.reprt_code) {
      throw new SafeOpenDartError("response_mismatch");
    }
    return {
      raw, filing_url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${raw.rcept_no}`, fs_div: request.fs_div,
      current_period_kind: (request.reprt_code !== "11011" && ["IS", "CIS"].includes(raw.sj_div)) ? "three_months" as const : "unspecified" as const,
      amounts: {
        current: parseOpenDartAmount(raw.thstrm_amount), current_cumulative: parseOpenDartAmount(raw.thstrm_add_amount),
        prior: parseOpenDartAmount(raw.frmtrm_amount), prior_comparable: parseOpenDartAmount(raw.frmtrm_q_amount),
        prior_cumulative: parseOpenDartAmount(raw.frmtrm_add_amount), two_years_prior: parseOpenDartAmount(raw.bfefrmtrm_amount),
      },
    };
  });
  return openDartResultSchema.parse({ status, provider_status: data.status,
    ...(status === "error" ? { error_code: "provider_error" } : {}),
    request, provenance: evidence, source: "opendart", documentation: OPENDART_DOCUMENTATION, rows,
  });
}
export interface OpenDartTransportRequest {
  readonly operation: "opendart.full_statement";
  readonly method: "GET";
  readonly endpoint: typeof OPENDART_ENDPOINT;
  readonly params: Readonly<OpenDartInput>;
}
/** The host owns transport and credentials. This module cannot perform network I/O. */
export interface OpenDartTransport {
  readonly origin: OpenDartProvenance["origin"];
  send(request: OpenDartTransportRequest): Promise<unknown>;
}
export async function requestOpenDartFullStatement(input: unknown, transport: OpenDartTransport, provenance: unknown): Promise<OpenDartResult> {
  const request = validateInput(input);
  const provenanceFactory = typeof provenance === "function" ? provenance as () => unknown : () => provenance;
  const evidence = validateProvenance(provenanceFactory());
  if (transport.origin !== evidence.origin) throw new SafeOpenDartError("invalid_provenance");
  let payload: unknown;
  try {
    payload = await transport.send(Object.freeze({ operation: "opendart.full_statement", method: "GET", endpoint: OPENDART_ENDPOINT, params: Object.freeze({ ...request }) }));
  } catch (error) { throw openDartTransportError(error); }
  const receivedEvidence = validateProvenance(provenanceFactory());
  if (transport.origin !== receivedEvidence.origin) throw new SafeOpenDartError("invalid_provenance");
  return parseOpenDartFullStatement(request, payload, receivedEvidence);
}

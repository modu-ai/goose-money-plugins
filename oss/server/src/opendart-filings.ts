import { z } from "zod";
import { openDartProvenanceSchema, SafeOpenDartError, type OpenDartProvenance } from "./opendart.js";
export const OPENDART_FILINGS_DOCUMENTATION = "https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001";
export const OPENDART_FILINGS_ENDPOINT = "https://opendart.fss.or.kr/api/list.json";
const dateSchema = z.string().regex(/^\d{8}$/).refine(value => {
  const date = new Date(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10).replaceAll("-", "") === value;
});
// Deliberately company-scoped, with explicit dates: no implicit 'today' or market-wide query.
export const openDartFilingsInputSchema = z.object({
  corp_code: z.string().regex(/^\d{8}$/), bgn_de: dateSchema, end_de: dateSchema,
  last_reprt_at: z.enum(["Y", "N"]).default("N"),
  pblntf_ty: z.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]).optional(),
  corp_cls: z.enum(["Y", "K", "N", "E"]).optional(),
  sort: z.enum(["date", "crp", "rpt"]).default("date"), sort_mth: z.enum(["asc", "desc"]).default("desc"),
  page_no: z.number().int().min(1).max(99999).default(1), page_count: z.number().int().min(1).max(100).default(100),
}).strict().refine(value => value.bgn_de <= value.end_de, { message: "invalid_date_range" });
export type OpenDartFilingsInput = z.infer<typeof openDartFilingsInputSchema>;
export const openDartFilingRowSchema = z.object({
  corp_cls: z.enum(["Y", "K", "N", "E"]), corp_name: z.string().max(1024),
  corp_code: z.string().regex(/^\d{8}$/), stock_code: z.string().regex(/^(?:\d{6})?$/),
  report_nm: z.string().max(2048), rcept_no: z.string().regex(/^\d{14}$/),
  flr_nm: z.string().max(1024), rcept_dt: dateSchema, rm: z.string().max(128),
}).strict();
const count = z.number().int().min(0).max(99999999);
const payloadSchema = z.object({
  status: z.string().regex(/^\d{3}$/), message: z.string().max(2048),
  page_no: z.number().int().min(1).max(99999).optional(),
  page_count: z.number().int().min(1).max(100).optional(), total_count: count.optional(),
  total_page: count.optional(), list: z.array(openDartFilingRowSchema).max(100).optional(),
}).strict();
export const openDartFilingsResultSchema = z.object({
  source: z.literal("opendart"), documentation: z.literal(OPENDART_FILINGS_DOCUMENTATION),
  status: z.enum(["ok", "no_data", "rate_limited", "error"]), provider_status: z.string().regex(/^\d{3}$/),
  error_code: z.literal("provider_error").optional(), request: openDartFilingsInputSchema,
  provenance: openDartProvenanceSchema, total_count: count.optional(), total_page: count.optional(),
  next_page_no: z.number().int().min(2).max(99999).nullable(),
  has_more: z.boolean(),
  rows: z.array(z.object({ raw: openDartFilingRowSchema, filing_url: z.string().max(100) }).strict()).max(100),
}).strict();
export type OpenDartFilingsResult = z.infer<typeof openDartFilingsResultSchema>;
function validate(input: unknown, provenance: unknown) {
  const request = openDartFilingsInputSchema.safeParse(input);
  if (!request.success) throw new SafeOpenDartError("invalid_input");
  const evidence = openDartProvenanceSchema.safeParse(provenance);
  if (!evidence.success) throw new SafeOpenDartError("invalid_provenance");
  return { request: request.data, provenance: evidence.data };
}
export function parseOpenDartFilings(input: unknown, payload: unknown, provenance: unknown): OpenDartFilingsResult {
  const validated = validate(input, provenance);
  const { request } = validated;
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) throw new SafeOpenDartError("invalid_response");
  const data = parsed.data;
  const status = data.status === "000" ? "ok" : data.status === "013" ? "no_data" : data.status === "020" ? "rate_limited" : "error";
  if (status === "ok") {
    if (!data.list || data.page_no === undefined || data.page_count === undefined || data.total_count === undefined || data.total_page === undefined) throw new SafeOpenDartError("invalid_response");
    if (data.page_no !== request.page_no || data.page_count !== request.page_count) throw new SafeOpenDartError("response_mismatch");
    if (data.list.length > request.page_count || data.total_count < data.list.length || data.total_page !== Math.ceil(data.total_count / data.page_count)) throw new SafeOpenDartError("invalid_response");
    if ((data.total_count > 0 && data.page_no > data.total_page) || (data.total_count === 0 && data.list.length > 0)) throw new SafeOpenDartError("invalid_response");
  } else if (data.list?.length) throw new SafeOpenDartError("invalid_response");
  const rows = (data.list ?? []).map(raw => {
    if (raw.corp_code !== request.corp_code || raw.rcept_dt < request.bgn_de || raw.rcept_dt > request.end_de || (request.corp_cls && raw.corp_cls !== request.corp_cls)) throw new SafeOpenDartError("response_mismatch");
    return { raw, filing_url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${raw.rcept_no}` };
  });
  const has_more = status === "ok" && request.page_no < (data.total_page ?? 0);
  return openDartFilingsResultSchema.parse({
    source: "opendart", documentation: OPENDART_FILINGS_DOCUMENTATION, status, provider_status: data.status,
    ...(status === "error" ? { error_code: "provider_error" } : {}), ...validated,
    ...(data.total_count !== undefined ? { total_count: data.total_count } : {}),
    ...(data.total_page !== undefined ? { total_page: data.total_page } : {}),
    rows, has_more, next_page_no: has_more && request.page_no < 99999 ? request.page_no + 1 : null,
  });
}
export interface OpenDartFilingsTransportRequest {
  readonly operation: "opendart.public_filings";
  readonly method: "GET";
  readonly endpoint: typeof OPENDART_FILINGS_ENDPOINT;
  readonly params: Readonly<OpenDartFilingsInput>;
}
export interface OpenDartFilingsTransport {
  readonly origin: OpenDartProvenance["origin"];
  send(request: OpenDartFilingsTransportRequest): Promise<unknown>;
}
/** Exactly one page per call; caller chooses whether to follow explicit next_page_no. */
export async function requestOpenDartFilings(input: unknown, transport: OpenDartFilingsTransport, provenance: unknown): Promise<OpenDartFilingsResult> {
  const provenanceFactory = typeof provenance === "function" ? provenance as () => unknown : () => provenance;
  const validated = validate(input, provenanceFactory());
  if (transport.origin !== validated.provenance.origin) throw new SafeOpenDartError("invalid_provenance");
  let payload: unknown;
  try {
    payload = await transport.send(Object.freeze({ operation: "opendart.public_filings", method: "GET", endpoint: OPENDART_FILINGS_ENDPOINT, params: Object.freeze({ ...validated.request }) }));
  } catch { throw new SafeOpenDartError("transport_error"); }
  const receivedEvidence = validate(input, provenanceFactory()).provenance;
  if (transport.origin !== receivedEvidence.origin) throw new SafeOpenDartError("invalid_provenance");
  return parseOpenDartFilings(validated.request, payload, receivedEvidence);
}

import { z } from "zod";
import {
  KIS_BASE_URL,
  PROCESS_PACER,
  RequestPacer,
  SafeKisError,
  readBoundedResponseText,
  type InMemoryKisCredentials,
  type KisCredentialProvider,
  type KisEnvironment,
} from "./kis-http.js";
import {
  SafeKisParserError,
  parseKis039DailyChartResponse,
  parseKis115InvestorFlowResponse,
  type ParsedKis039DailyBar,
  type ParsedKis115InvestorFlowRow,
  type PayloadOrigin,
} from "./r01-kis-field-parsers.js";

const DAILY_PATH = "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice";
const DAILY_TR_ID = "FHKST03010100";
const INVESTOR_PATH = "/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily";
const INVESTOR_TR_ID = "FHPTJ04160001";
const MAX_DAILY_ROWS = 100;
const MAX_INVESTOR_ROWS_PER_PAGE = 1_000;
const MAX_INVESTOR_PAGES = 10;

type Board = "J" | "NX" | "UN";
type DailyQuery = {
  FID_COND_MRKT_DIV_CODE: Board;
  FID_INPUT_ISCD: string;
  FID_INPUT_DATE_1: string;
  FID_INPUT_DATE_2: string;
  FID_PERIOD_DIV_CODE: "D";
  FID_ORG_ADJ_PRC: "0" | "1";
};
type InvestorQuery = {
  FID_COND_MRKT_DIV_CODE: Board;
  FID_INPUT_ISCD: string;
  FID_INPUT_DATE_1: string;
  FID_ETC_CLS_CODE: "1";
};

export type KisR01HttpRequest =
  | { operation_ref: "KIS-039"; query: DailyQuery; continuation?: never }
  | { operation_ref: "KIS-115"; query: InvestorQuery; continuation?: "N" };

export interface KisR01HttpResponse {
  status: number;
  tr_cont: string | null;
  body: unknown;
}

/**
 * Injectable, operation-scoped transport. Implementations receive only two
 * fixed read-only operation identifiers and their documented query fields;
 * callers cannot supply a host, URL, method, or TR_ID.
 */
export interface KisR01Transport {
  readonly origin: PayloadOrigin;
  send(request: KisR01HttpRequest, signal?: AbortSignal): Promise<KisR01HttpResponse>;
}

const BoardSchema = z.enum(["J", "NX", "UN"]);
const DateSchema = z.string().regex(/^\d{8}$/).refine((value) => {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
});

const DailyInputSchema = z.object({
  symbol: z.string().regex(/^\d{6}$/),
  board: BoardSchema,
  startDate: DateSchema,
  endDate: DateSchema,
  adjustmentCode: z.enum(["0", "1"]),
}).strict().superRefine((input, issue) => {
  if (input.startDate > input.endDate) issue.addIssue({ code: "custom", path: ["startDate"], message: "date_range_reversed" });
});

const InvestorInputSchema = z.object({
  symbol: z.string().regex(/^\d{6}$/),
  board: BoardSchema,
  inputDate: DateSchema,
}).strict();

function keysExactly(value: Record<string, string>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function validateWireRequest(request: KisR01HttpRequest): void {
  if (request.operation_ref === "KIS-039") {
    if (request.continuation !== undefined || !keysExactly(request.query, [
      "FID_COND_MRKT_DIV_CODE", "FID_INPUT_ISCD", "FID_INPUT_DATE_1", "FID_INPUT_DATE_2", "FID_PERIOD_DIV_CODE", "FID_ORG_ADJ_PRC",
    ])) throw new SafeKisError("invalid_input");
    const parsed = DailyInputSchema.safeParse({
      symbol: request.query.FID_INPUT_ISCD,
      board: request.query.FID_COND_MRKT_DIV_CODE,
      startDate: request.query.FID_INPUT_DATE_1,
      endDate: request.query.FID_INPUT_DATE_2,
      adjustmentCode: request.query.FID_ORG_ADJ_PRC,
    });
    if (!parsed.success || request.query.FID_PERIOD_DIV_CODE !== "D") throw new SafeKisError("invalid_input");
    return;
  }

  if (!keysExactly(request.query, ["FID_COND_MRKT_DIV_CODE", "FID_INPUT_ISCD", "FID_INPUT_DATE_1", "FID_ETC_CLS_CODE"])) {
    throw new SafeKisError("invalid_input");
  }
  const parsed = InvestorInputSchema.safeParse({
    symbol: request.query.FID_INPUT_ISCD,
    board: request.query.FID_COND_MRKT_DIV_CODE,
    inputDate: request.query.FID_INPUT_DATE_1,
  });
  if (!parsed.success || request.query.FID_ETC_CLS_CODE !== "1" || (request.continuation !== undefined && request.continuation !== "N")) {
    throw new SafeKisError("invalid_input");
  }
}

function trIdFor(request: KisR01HttpRequest): string {
  return request.operation_ref === "KIS-039" ? DAILY_TR_ID : INVESTOR_TR_ID;
}

/** Real fetch-backed implementation, deliberately not wired to tools/list. */
export class FetchKisR01Transport implements KisR01Transport {
  readonly origin = "provider_payload" as const;

  constructor(
    private readonly environment: KisEnvironment,
    private readonly credentials: KisCredentialProvider,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly maxResponseBytes = 300_000,
    private readonly timeoutMs = 10_000,
    private readonly pacer: RequestPacer = PROCESS_PACER,
  ) {}

  async send(request: KisR01HttpRequest, outerSignal?: AbortSignal): Promise<KisR01HttpResponse> {
    validateWireRequest(request);
    if (request.operation_ref === "KIS-115") throw new SafeKisError("request_contract_conflict");
    const credentials = await this.getCredentials();
    await this.pacer.reserve();
    const path = request.operation_ref === "KIS-039" ? DAILY_PATH : INVESTOR_PATH;
    const url = new URL(path, KIS_BASE_URL[this.environment]);
    for (const [name, value] of Object.entries(request.query)) url.searchParams.set(name, value);
    const signal = outerSignal
      ? AbortSignal.any([outerSignal, AbortSignal.timeout(this.timeoutMs)])
      : AbortSignal.timeout(this.timeoutMs);

    let response: Response;
    try {
      const headers: Record<string, string> = {
        authorization: `Bearer ${credentials.accessToken}`,
        appkey: credentials.appKey,
        appsecret: credentials.appSecret,
        tr_id: trIdFor(request),
        custtype: "P",
        "content-type": "application/json; charset=utf-8",
      };
      // KIS-115 transport is blocked before credential access.
      response = await this.fetchImpl(url, { method: "GET", redirect: "error", signal, headers });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") throw new SafeKisError("upstream_timeout");
      if (error instanceof Error && error.name === "AbortError") throw new SafeKisError("request_cancelled");
      throw new SafeKisError("upstream_unavailable");
    }

    const trCont = response.headers.get("tr_cont");
    if (!response.ok) return { status: response.status, tr_cont: trCont, body: null };
    const text = await readBoundedResponseText(response, this.maxResponseBytes).catch((error: unknown) => {
      if (error instanceof SafeKisError) throw error;
      throw new SafeKisError("schema_drift");
    });
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new SafeKisError("schema_drift");
    }
    return { status: response.status, tr_cont: trCont, body };
  }

  private async getCredentials(): Promise<InMemoryKisCredentials> {
    const value = await this.credentials.getForMarketRead().catch(() => { throw new SafeKisError("credential_missing"); });
    if (!value.appKey || !value.appSecret || !value.accessToken) throw new SafeKisError("credential_missing");
    return value;
  }
}

export interface KisR01AdapterOptions {
  clock?: () => string;
  maxInvestorPages?: number;
}

function receivedAt(options?: KisR01AdapterOptions): string {
  const value = options?.clock?.() ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new SafeKisError("invalid_input");
  return value;
}

async function sendChecked(transport: KisR01Transport, request: KisR01HttpRequest, signal?: AbortSignal): Promise<KisR01HttpResponse> {
  let response: KisR01HttpResponse;
  try {
    response = await transport.send(request, signal);
  } catch (error) {
    if (error instanceof SafeKisError) throw error;
    if (error instanceof Error && error.name === "TimeoutError") throw new SafeKisError("upstream_timeout");
    if (error instanceof Error && error.name === "AbortError") throw new SafeKisError("request_cancelled");
    throw new SafeKisError("upstream_unavailable");
  }
  if (response.status === 401 || response.status === 403) throw new SafeKisError("auth_expired");
  if (response.status === 429) throw new SafeKisError("rate_limited");
  if (response.status === 408) throw new SafeKisError("upstream_timeout");
  if (response.status < 200 || response.status >= 300) throw new SafeKisError("upstream_unavailable");
  return response;
}

function parserError(error: unknown): never {
  if (error instanceof SafeKisParserError) {
    if (error.code === "invalid_input") throw new SafeKisError("invalid_input");
    if (error.code === "upstream_rejected") throw new SafeKisError("upstream_rejected");
    if (error.code === "duplicate_provider_business_date") throw new SafeKisError("duplicate_provider_business_date");
    throw new SafeKisError("schema_drift");
  }
  throw error;
}

function validateResponseContinuation(value: string | null): void {
  if (value !== null && !["", "D", "E", "F", "M"].includes(value)) throw new SafeKisError("schema_drift");
}

function hasRows(body: unknown): boolean {
  return typeof body === "object" && body !== null && Array.isArray((body as Record<string, unknown>).output2);
}

export async function requestKis039DailyBars(
  input: unknown,
  transport: KisR01Transport,
  options?: KisR01AdapterOptions,
  signal?: AbortSignal,
): Promise<ParsedKis039DailyBar[]> {
  const parsedInput = DailyInputSchema.safeParse(input);
  if (!parsedInput.success) throw new SafeKisError("invalid_input");
  const value = parsedInput.data;
  const response = await sendChecked(transport, {
    operation_ref: "KIS-039",
    query: {
      FID_COND_MRKT_DIV_CODE: value.board,
      FID_INPUT_ISCD: value.symbol,
      FID_INPUT_DATE_1: value.startDate,
      FID_INPUT_DATE_2: value.endDate,
      FID_PERIOD_DIV_CODE: "D",
      FID_ORG_ADJ_PRC: value.adjustmentCode,
    },
  }, signal);
  validateResponseContinuation(response.tr_cont);
  if (response.tr_cont === "F" || response.tr_cont === "M") throw new SafeKisError("pagination_not_supported");
  if (!hasRows(response.body)) throw new SafeKisError("schema_drift");
  const rows = (response.body as { output2: unknown[] }).output2;
  if (rows.length === 0) throw new SafeKisError("empty_response");
  if (rows.length > MAX_DAILY_ROWS) throw new SafeKisError("pagination_not_supported");
  try {
    return parseKis039DailyChartResponse(response.body, {
      symbol: value.symbol,
      board: value.board,
      startDate: value.startDate,
      endDate: value.endDate,
      periodCode: "D",
      adjustmentCode: value.adjustmentCode,
      receivedAt: receivedAt(options),
      origin: transport.origin,
    });
  } catch (error) {
    parserError(error);
  }
}

export interface Kis115InvestorResult {
  operation_ref: "KIS-115";
  requested_input_date: string;
  page_count: number;
  response_chain_status: "terminal_page_observed_total_count_unknown";
  source_as_of: null;
  canonical_projection_status: "blocked";
  rows: ParsedKis115InvestorFlowRow[];
}

export async function requestKis115InvestorFlow(
  input: unknown,
  transport: KisR01Transport,
  options?: KisR01AdapterOptions,
  signal?: AbortSignal,
): Promise<Kis115InvestorResult> {
  const parsedInput = InvestorInputSchema.safeParse(input);
  if (!parsedInput.success) throw new SafeKisError("invalid_input");
  const value = parsedInput.data;
  if (transport.origin !== "synthetic_fixture") throw new SafeKisError("request_contract_conflict");
  const maxPages = options?.maxInvestorPages ?? MAX_INVESTOR_PAGES;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_INVESTOR_PAGES) throw new SafeKisError("invalid_input");

  const rows: ParsedKis115InvestorFlowRow[] = [];
  const dates = new Set<string>();
  let continuation: "N" | undefined;
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await sendChecked(transport, {
      operation_ref: "KIS-115",
      query: {
        FID_COND_MRKT_DIV_CODE: value.board,
        FID_INPUT_ISCD: value.symbol,
        FID_INPUT_DATE_1: value.inputDate,
        FID_ETC_CLS_CODE: "1",
      },
      ...(continuation ? { continuation } : {}),
    }, signal);
    validateResponseContinuation(response.tr_cont);

    if (!hasRows(response.body)) throw new SafeKisError("schema_drift");
    const pageRows = (response.body as { output2: unknown[] }).output2;
    if (pageRows.length > MAX_INVESTOR_ROWS_PER_PAGE) throw new SafeKisError("response_too_large");
    if (pageRows.length === 0 && (response.tr_cont === "F" || response.tr_cont === "M")) throw new SafeKisError("empty_response");
    try {
      const parsedRows = parseKis115InvestorFlowResponse(response.body, {
        requestedInputDate: value.inputDate,
        receivedAt: receivedAt(options),
        origin: transport.origin,
      });
      for (const row of parsedRows) {
        if (dates.has(row.provider_business_date)) throw new SafeKisError("duplicate_provider_business_date");
        dates.add(row.provider_business_date);
        rows.push(row);
      }
    } catch (error) {
      if (error instanceof SafeKisError) throw error;
      parserError(error);
    }

    const hasMore = response.tr_cont === "F" || response.tr_cont === "M";
    if (!hasMore) {
      if (rows.length === 0) throw new SafeKisError("empty_response");
      return {
        operation_ref: "KIS-115",
        requested_input_date: value.inputDate,
        page_count: page,
        response_chain_status: "terminal_page_observed_total_count_unknown",
        source_as_of: null,
        canonical_projection_status: "blocked",
        rows,
      };
    }
    if (page === maxPages) throw new SafeKisError("pagination_limit_reached");
    continuation = "N";
  }
  throw new SafeKisError("pagination_limit_reached");
}

export const R01_HTTP_OPERATION_CATALOG = {
  "KIS-039": { method: "GET", path: DAILY_PATH, tr_id: DAILY_TR_ID, tool_exposed: true },
  "KIS-115": { method: "GET", path: INVESTOR_PATH, tr_id: INVESTOR_TR_ID, tool_exposed: true },
} as const;

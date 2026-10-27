import assert from "node:assert/strict";
import test from "node:test";
import dailyFixture from "./fixtures/kis039_daily_rows_synthetic.json" with { type: "json" };
import flowFixture from "./fixtures/kis115_investor_flow_synthetic.json" with { type: "json" };
import {
  FetchKisR01Transport,
  R01_HTTP_OPERATION_CATALOG,
  requestKis039DailyBars,
  requestKis115InvestorFlow,
  type KisR01HttpRequest,
  type KisR01HttpResponse,
  type KisR01Transport,
} from "../src/r01-kis-http-adapters.js";
import { KIS_BASE_URL, RequestPacer, SafeKisError } from "../src/kis-http.js";

const receivedAt = "2026-10-21T15:04:05.000Z";
const dailyInput = {
  symbol: "000660",
  board: "J",
  startDate: "20261020",
  endDate: "20261021",
  adjustmentCode: "0",
};
const flowInput = { symbol: "000660", board: "J", inputDate: "20261020" };

function failureCode(expected: string) {
  return (error: unknown): boolean => error instanceof SafeKisError && error.code === expected;
}

class QueueTransport implements KisR01Transport {
  readonly origin = "synthetic_fixture" as const;
  readonly requests: KisR01HttpRequest[] = [];
  private index = 0;

  constructor(private readonly responses: Array<KisR01HttpResponse | Error>) {}

  async send(request: KisR01HttpRequest): Promise<KisR01HttpResponse> {
    this.requests.push(structuredClone(request));
    const next = this.responses[this.index++];
    if (!next) throw new Error("unexpected_mock_request");
    if (next instanceof Error) throw next;
    return structuredClone(next);
  }
}

function response(body: unknown, tr_cont: string | null = null, status = 200): KisR01HttpResponse {
  return { status, tr_cont, body };
}

function changedBusinessDate(value: unknown, date: string): Record<string, unknown> {
  const clone = structuredClone(value) as { output2: Array<Record<string, unknown>> };
  clone.output2[0]!.stck_bsop_date = date;
  return clone;
}

test("KIS-039 request uses only its fixed official daily query fields and preserves raw units", async () => {
  const transport = new QueueTransport([response(dailyFixture.response)]);
  const bars = await requestKis039DailyBars(dailyInput, transport, { clock: () => receivedAt });

  assert.equal(transport.requests.length, 1);
  assert.deepEqual(transport.requests[0], {
    operation_ref: "KIS-039",
    query: {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: "000660",
      FID_INPUT_DATE_1: "20261020",
      FID_INPUT_DATE_2: "20261021",
      FID_PERIOD_DIV_CODE: "D",
      FID_ORG_ADJ_PRC: "0",
    },
  });
  assert.equal(bars.length, 2);
  assert.equal(bars[0]?.raw_fields.stck_clpr.value, "12345");
  assert.equal(bars[0]?.raw_fields.acml_vol.value, "987654");
  assert.equal(bars[0]?.raw_fields.acml_tr_pbmn.value, "12345678900");
  assert.equal(bars[0]?.source_as_of, null);
  assert.equal(bars[0]?.received_at, receivedAt);
  assert.equal(bars[0]?.canonical_projection_status, "blocked");
  assert.ok(bars[0]?.canonical_blockers.includes("volume_unit_not_stated_in_endpoint_schema"));
  assert.equal(bars[1]?.raw_fields.stck_clpr.state, "blank");
});

test("KIS-039 fails closed on timeout, HTTP 429, continuation, schema drift and empty results without retries", async () => {
  for (const [mock, expected] of [
    [new QueueTransport([new DOMException("synthetic timeout", "TimeoutError")]), "upstream_timeout"],
    [new QueueTransport([response(null, null, 429)]), "rate_limited"],
    [new QueueTransport([response(dailyFixture.response, "M")]), "pagination_not_supported"],
    [new QueueTransport([response(dailyFixture.response, "X")]), "schema_drift"],
    [new QueueTransport([response({ ...dailyFixture.response, output2: [{ ...dailyFixture.response.output2[0], future_key: "x" }] })]), "schema_drift"],
    [new QueueTransport([response({ ...dailyFixture.response, output2: [] })]), "empty_response"],
  ] as const) {
    await assert.rejects(requestKis039DailyBars(dailyInput, mock, { clock: () => receivedAt }), failureCode(expected));
    assert.equal(mock.requests.length, 1, `${expected} must not retry`);
  }
});

test("KIS-115 sends the portal field value only and keeps request date separate from row date", async () => {
  const body = changedBusinessDate(flowFixture.response, "20261019");
  const transport = new QueueTransport([response(body)]);
  const result = await requestKis115InvestorFlow(flowInput, transport, { clock: () => receivedAt });

  assert.deepEqual(transport.requests[0], {
    operation_ref: "KIS-115",
    query: {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: "000660",
      FID_INPUT_DATE_1: "20261020",
      FID_ETC_CLS_CODE: "1",
    },
  });
  assert.equal("FID_ORG_ADJ_PRC" in (transport.requests[0] as { query: Record<string, string> }).query, false);
  assert.equal(result.requested_input_date, "20261020");
  assert.equal(result.rows[0]?.provider_business_date, "2026-10-19");
  assert.equal(result.rows[0]?.request_date_semantics, "input_parameter_to_row_relationship_not_assumed");
  assert.equal(result.rows[0]?.source_as_of, null);
  assert.equal(result.rows[0]?.received_at, receivedAt);
  assert.equal(result.rows[0]?.raw_quote_fields.traded_volume, "1000");
  assert.equal(result.rows[0]?.actor_flows.foreign.net_buy_amount.value_krw, "12345600");
  assert.equal(result.canonical_projection_status, "blocked");
  assert.equal(result.response_chain_status, "terminal_page_observed_total_count_unknown");
});

test("KIS-115 follows the pinned sample continuation shape with a bounded chain and no partial result", async () => {
  const page1 = changedBusinessDate(flowFixture.response, "20261020");
  const page2 = changedBusinessDate(flowFixture.response, "20261019");
  const transport = new QueueTransport([response(page1, "M"), response(page2, "D")]);
  const result = await requestKis115InvestorFlow(flowInput, transport, { clock: () => receivedAt });
  assert.equal(result.page_count, 2);
  assert.deepEqual(transport.requests.map((request) => request.continuation), [undefined, "N"]);
  assert.equal(result.rows.length, 2);

  const capped = new QueueTransport([response(page1, "F")]);
  await assert.rejects(requestKis115InvestorFlow(flowInput, capped, { clock: () => receivedAt, maxInvestorPages: 1 }), failureCode("pagination_limit_reached"));
  assert.equal(capped.requests.length, 1);
});

test("KIS-115 maps timeout, 429, empty, schema, duplicate rows and missing/blank values safely", async () => {
  const malformed = structuredClone(flowFixture.response) as { output1: object; output2: Array<Record<string, unknown>>; [key: string]: unknown };
  malformed.output2[0]!.future_key = "x";
  const blankMissing = structuredClone(flowFixture.response) as { output1: object; output2: Array<Record<string, unknown>>; [key: string]: unknown };
  blankMissing.output2[0]!.frgn_ntby_tr_pbmn = "";
  delete blankMissing.output2[0]!.prsn_ntby_tr_pbmn;

  for (const [transport, expected] of [
    [new QueueTransport([new DOMException("synthetic timeout", "TimeoutError")]), "upstream_timeout"],
    [new QueueTransport([response(null, null, 429)]), "rate_limited"],
    [new QueueTransport([response({ ...flowFixture.response, output2: [] })]), "empty_response"],
    [new QueueTransport([response(malformed)]), "schema_drift"],
    [new QueueTransport([response(flowFixture.response, "X")]), "schema_drift"],
    [new QueueTransport([response(flowFixture.response, "F"), response(flowFixture.response, "D")]), "duplicate_provider_business_date"],
  ] as const) {
    await assert.rejects(requestKis115InvestorFlow(flowInput, transport, { clock: () => receivedAt }), failureCode(expected));
    assert.ok(transport.requests.length >= 1);
  }

  const blankTransport = new QueueTransport([response(blankMissing)]);
  const [row] = (await requestKis115InvestorFlow(flowInput, blankTransport, { clock: () => receivedAt })).rows;
  assert.equal(row?.actor_flows.foreign.net_buy_amount.state, "blank");
  assert.equal(row?.actor_flows.individual.net_buy_amount.state, "missing");
  assert.equal(row?.raw_quote_fields.traded_volume, "1000");
  assert.equal(row?.source_as_of, null);
});

test("fetch transport binds credentials only to fixed KIS hosts and fixed operation paths", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init: init ?? {} });
    return new Response(JSON.stringify(dailyFixture.response), { status: 200 });
  };
  const credentials = {
    async getForMarketRead() { return { appKey: "synthetic-key", appSecret: "synthetic-secret", accessToken: "synthetic-token" }; },
  };
  const transport = new FetchKisR01Transport("production", credentials, mockFetch, 300_000, 1000, new RequestPacer(0));
  await requestKis039DailyBars(dailyInput, transport, { clock: () => receivedAt });

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  const { url, init } = call;
  assert.equal(url.origin, "https://openapi.koreainvestment.com:9443");
  assert.equal(url.pathname, "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice");
  assert.deepEqual([...url.searchParams.keys()].sort(), [
    "FID_COND_MRKT_DIV_CODE", "FID_INPUT_ISCD", "FID_INPUT_DATE_1", "FID_INPUT_DATE_2", "FID_PERIOD_DIV_CODE", "FID_ORG_ADJ_PRC",
  ].sort());
  assert.equal(init.method, "GET");
  assert.equal(init.redirect, "error");
  assert.equal(new Headers(init.headers).get("tr_id"), "FHKST03010100");
  assert.equal(R01_HTTP_OPERATION_CATALOG["KIS-039"].tool_exposed, true);
  assert.equal(R01_HTTP_OPERATION_CATALOG["KIS-115"].tool_exposed, true);
  assert.equal(Object.isFrozen(KIS_BASE_URL), true);
});

test("KIS-115 fails closed before credentials and transport while request conflict remains", async () => {
  let calls = 0;
  let secrets = 0;
  const transport = new FetchKisR01Transport("production", {
    async getForMarketRead() { secrets++; throw new Error("must not read"); },
  }, async () => { calls++; throw new Error("must not call"); });
  await assert.rejects(requestKis115InvestorFlow(flowInput, transport), failureCode("request_contract_conflict"));
  await assert.rejects(transport.send({operation_ref:"KIS-115",query:{FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:"000660",FID_INPUT_DATE_1:"20261020",FID_ETC_CLS_CODE:"1"}}), failureCode("request_contract_conflict"));
  assert.equal(calls,0); assert.equal(secrets,0);
});

test("KIS-115 portal and pinned-sample request candidates stay blocked before credentials and HTTP", async () => {
  let calls = 0;
  let secrets = 0;
  const transport = new FetchKisR01Transport("production", {
    async getForMarketRead() { secrets++; throw new Error("must not read"); },
  }, async () => { calls++; throw new Error("must not call"); });
  const portalCandidate: KisR01HttpRequest = {
    operation_ref: "KIS-115",
    query: { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: "000660", FID_INPUT_DATE_1: "20261020", FID_ETC_CLS_CODE: "1" },
  };
  const sampleValueCandidate = {
    operation_ref: "KIS-115",
    query: { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: "000660", FID_INPUT_DATE_1: "20261020", FID_ETC_CLS_CODE: "" },
  } as unknown as KisR01HttpRequest;
  const sampleFullCandidate = {
    operation_ref: "KIS-115",
    query: { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: "000660", FID_INPUT_DATE_1: "20261020", FID_ORG_ADJ_PRC: "", FID_ETC_CLS_CODE: "" },
  } as unknown as KisR01HttpRequest;
  await assert.rejects(transport.send(portalCandidate), failureCode("request_contract_conflict"));
  await assert.rejects(transport.send(sampleValueCandidate), failureCode("invalid_input"));
  await assert.rejects(transport.send(sampleFullCandidate), failureCode("invalid_input"));
  assert.equal(calls, 0);
  assert.equal(secrets, 0);
});

test("fetch transport maps timeout and rate limit responses once, using no retry", async () => {
  const credentials = {
    async getForMarketRead() { return { appKey: "synthetic-key", appSecret: "synthetic-secret", accessToken: "synthetic-token" }; },
  };
  let timeoutCalls = 0;
  const timeoutTransport = new FetchKisR01Transport("paper", credentials, async () => {
    timeoutCalls += 1;
    throw new DOMException("synthetic timeout", "TimeoutError");
  }, 300_000, 1000, new RequestPacer(0));
  await assert.rejects(requestKis039DailyBars(dailyInput, timeoutTransport, { clock: () => receivedAt }), failureCode("upstream_timeout"));
  assert.equal(timeoutCalls, 1);

  let rateLimitCalls = 0;
  const rateLimitTransport = new FetchKisR01Transport("paper", credentials, async () => {
    rateLimitCalls += 1;
    return new Response("", { status: 429 });
  }, 300_000, 1000, new RequestPacer(0));
  await assert.rejects(requestKis039DailyBars(dailyInput, rateLimitTransport, { clock: () => receivedAt }), failureCode("rate_limited"));
  assert.equal(rateLimitCalls, 1);

  const responseBodyTimeout = new FetchKisR01Transport("paper", credentials, async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new DOMException("synthetic body timeout", "TimeoutError")); },
    });
    return new Response(body, { status: 200 });
  }, 300_000, 1000, new RequestPacer(0));
  await assert.rejects(requestKis039DailyBars(dailyInput, responseBodyTimeout, { clock: () => receivedAt }), failureCode("upstream_timeout"));

  let paginationErrorCalls = 0;
  const paginationErrorTransport = new FetchKisR01Transport("paper", credentials, async (_input, init) => {
    paginationErrorCalls += 1;
    const body = paginationErrorCalls === 1 ? flowFixture.response : flowFixture.response;
    const status = paginationErrorCalls === 1 ? 200 : 429;
    return new Response(JSON.stringify(body), { status, headers: { tr_cont: "M" } });
  }, 300_000, 1000, new RequestPacer(0));
  await assert.rejects(requestKis115InvestorFlow(flowInput, paginationErrorTransport, { clock: () => receivedAt }), failureCode("request_contract_conflict"));
  assert.equal(paginationErrorCalls, 0, "unresolved request semantics block network before first page");
});

test("adapter rejects invalid local inputs before the transport is called", async () => {
  const transport = new QueueTransport([]);
  await assert.rejects(requestKis039DailyBars({ ...dailyInput, symbol: "000660;other" }, transport), failureCode("invalid_input"));
  await assert.rejects(requestKis115InvestorFlow({ ...flowInput, inputDate: "2026-10-20" }, transport), failureCode("invalid_input"));
  assert.equal(transport.requests.length, 0);
});

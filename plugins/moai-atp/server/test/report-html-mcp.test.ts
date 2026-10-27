import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { buildReportInput } from "../src/report-pipeline.js";
import { createStockMcpServer } from './synthetic-member-access.js';

const subject = { id: "KRX:000660", name: "합성 종목", venue: "KRX", currency: "KRW" };
const cutoff = "2026-10-23T03:00:00.000Z";
const syntheticQuote = {
  contract: "moai.stock.quote-snapshot.v1",
  provider: "kis",
  operation_id: "kis.kr.quote.snapshot.v1",
  origin: "synthetic",
  provenance: { source_as_of: "2026-10-22", available_at: cutoff, origin: "synthetic", validation_status: "synthetic_fixture", provider_api_version: "fixture-v1" },
  data: { last: "12345", open: "12000", high: "12500", low: "11900", previous_close: "12000", change: "345", change_percent: "2.87", volume: "1000" },
};

function clientSession(server: ReturnType<typeof createStockMcpServer>) {
  const [client, peer] = InMemoryTransport.createLinkedPair();
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  client.onmessage = (message) => {
    const response = message as any;
    if (typeof response.id !== "number") return;
    const item = pending.get(response.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(response.id);
    item.resolve(response);
  };
  async function rpc(method: string, params: Record<string, unknown>) {
    const id = ++nextId;
    const answer = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("mcp_response_timeout"));
      }, 5_000);
      pending.set(id, { resolve, reject, timer });
    });
    await client.send({ jsonrpc: "2.0", id, method, params } as any);
    return answer;
  }
  return {
    async start() {
      await client.start();
      await server.connect(peer);
      const initialized = await rpc("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "report-html-test-client", version: "1" },
      });
      await client.send({ jsonrpc: "2.0", method: "notifications/initialized" } as any);
      return initialized;
    },
    rpc,
    async close() {
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error("closed"));
      }
      await server.close();
      await client.close();
    },
  };
}

test("MCP build_report_input to render_report_html returns a readable synthetic HTML resource link", async () => {
  let now = cutoff;
  const server = createStockMcpServer({ clock: () => now });
  const session = clientSession(server);
  try {
    const initialized = await session.start();
    assert.ok(initialized.result?.protocolVersion);

    const listed = await session.rpc("tools/list", {});
    const toolNames = listed.result.tools.map((tool: any) => tool.name);
    assert.ok(toolNames.includes("build_report_input"));
    assert.ok(toolNames.includes("render_report_html"));
    assert.equal(listed.result.tools.length, 36);

    const built = await session.rpc("tools/call", {
      name: "build_report_input",
      arguments: {
        report_id: "R01",
        subject,
        cutoff,
        display_timezone: "Asia/Seoul",
        calls: [{ tool_name: "get_market_snapshot", result: { structuredContent: syntheticQuote, content: [{ type: "text", text: JSON.stringify(syntheticQuote) }] } }],
      },
    });
    assert.equal(built.result.isError, undefined);
    const reportInput = built.result.structuredContent;
    assert.equal(reportInput.mode, "synthetic");
    assert.equal(reportInput.execution_status, "synthetic_fixture_rendered");

    const rendered = await session.rpc("tools/call", {
      name: "render_report_html",
      arguments: { report_input: reportInput },
    });
    assert.equal(rendered.result.isError, undefined);
    const link = rendered.result.content.find((item: any) => item.type === "resource_link");
    assert.ok(link);
    assert.equal(link.mimeType, "text/html");
    assert.match(link.name, /^R01-2026-10-23\.html$/);
    assert.equal(rendered.result.structuredContent.delivery, "mcp_resource_link");
    assert.equal(rendered.result.structuredContent.host_rendering, "not_observed");

    const templates = await session.rpc("resources/templates/list", {});
    assert.ok(templates.result.resourceTemplates.some((item: any) => item.uriTemplate === "moai-atp://reports/{reportId}"));

    const read = await session.rpc("resources/read", { uri: link.uri });
    assert.equal(read.error, undefined);
    const content = read.result.contents[0];
    assert.equal(content.mimeType, "text/html");
    assert.match(content.text, /합성 fixture · 실제 자료 아님/);
    assert.match(content.text, /R01/);
    assert.match(content.text, /source_as_of/);
  } finally {
    await session.close();
  }
});

test("HTML resources are memory-only, expire, and do not expose rights-pending actual values", async () => {
  let now = cutoff;
  const server = createStockMcpServer({ clock: () => now });
  const session = clientSession(server);
  try {
    await session.start();
    const actualQuote = {
      contract: "moai.stock.quote-snapshot.v1",
      provider: "kis",
      operation_id: "kis.kr.quote.snapshot.v1",
      origin: "actual",
      provenance: { source_as_of: "2026-10-22", available_at: cutoff, origin: "actual", validation_status: "provider_shape_checked", provider_api_version: "fixture-v1" },
      data: { last: "987654321012345678.123", open: "987654321012345000", high: "987654321012345999", low: "987654321012344999", change: "123", change_percent: "0.1", volume: "1000" },
    };
    const reportInput = buildReportInput({
      report_id: "R01",
      subject,
      cutoff,
      display_timezone: "Asia/Seoul",
      received_at: cutoff,
      calls: [{ tool_name: "get_market_snapshot", result: { structuredContent: actualQuote, content: [{ type: "text", text: JSON.stringify(actualQuote) }] } }],
    });
    assert.ok(reportInput.metrics.some((metric) => metric.status === "rights_pending"));
    const rendered = await session.rpc("tools/call", { name: "render_report_html", arguments: { report_input: reportInput } });
    const uri = rendered.result.structuredContent.resource_uri as string;
    const read = await session.rpc("resources/read", { uri });
    assert.equal(read.error, undefined);
    assert.doesNotMatch(read.result.contents[0].text, /987654321012345678\.123/);
    assert.match(read.result.contents[0].text, /rights_pending/);

    now = "2026-10-23T03:06:00.000Z";
    const expired = await session.rpc("resources/read", { uri });
    assert.equal(expired.result, undefined);
    assert.ok(expired.error);
  } finally {
    await session.close();
  }
});

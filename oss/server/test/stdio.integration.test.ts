import { nativePeriodInput } from './native-period-mcp-fixtures.js';
import { readFileSync } from "node:fs";
import { inputs as sourceInputs, active as activeSources, blocked as blockedSources } from "./source-input-fixtures.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import readline from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertRecorderCount, hermeticChildEnv, makeProfileDir, recorderImportArgs, removeProfileDir } from "./default-entry-env.js";
import { MEMBER_GUARD_CODE, expectedSwitchOffCode } from "./default-server-harness.js";

const entry = fileURLToPath(new URL("../src/main.js", import.meta.url));
const syntheticEntry = fileURLToPath(new URL("./fixtures/success-main.js", import.meta.url));

// Every child below gets an explicit hermetic environment (default-entry-env.ts): PATH and a mkdtemp
// profile directory, never the parent's read switches, provider keys or real HOME. Only the default
// entry point carries the fetch-recorder preload; fixture entries inject their own transport.
const childArgs = (target: string): string[] => target === entry ? [...recorderImportArgs(), target] : [target];

type StdioCall = { listedTools: string[]; call: { result?: { isError?: boolean; content?: Array<{ text?: string }>; structuredContent?: Record<string, unknown> }; error?: unknown }; stderr: string };

// Default policy after the member gate is gone: the local read switches are off in the hermetic env,
// so a gated tool answers with the baseline switch-off code (m0-baseline.md section 3), never a member code.
function assertSwitchBlocked(name: string, call: StdioCall["call"]): void {
  const text = call.result?.content?.[0]?.text ?? "";
  assert.equal(call.result?.isError, true, JSON.stringify(call));
  assert.doesNotMatch(text, MEMBER_GUARD_CODE);
  assert.equal(text, `error_code=${expectedSwitchOffCode(name)}`);
  assert.equal(call.result?.structuredContent, undefined);
}

function readJsonLine(reader: readline.Interface, timeoutMs = 5_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("stdio_response_timeout")); }, timeoutMs);
    const onLine = (line: string) => {
      cleanup();
      try { resolve(JSON.parse(line) as unknown); } catch { reject(new Error("stdio_invalid_json")); }
    };
    function cleanup() {
      clearTimeout(timer);
      reader.off("line", onLine);
    }
    reader.on("line", onLine);
  });
}

async function runStdioCall(targetEntry: string, tool = "get_market_snapshot", args: Record<string, unknown> = { symbol: "000660", board: "J" }): Promise<StdioCall> {
  const profileDir = await makeProfileDir();
  const child = spawn(process.execPath, [...childArgs(targetEntry)], { env: hermeticChildEnv(profileDir), stdio: ["pipe", "pipe", "pipe"] });
  const closed = new Promise<void>((resolve) => { child.once("close", () => resolve()); });
  const stdout = readline.createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  let result: StdioCall | undefined;
  try {
    const initializeResponse = readJsonLine(stdout);
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "fixture-client", version: "1" } },
    })}\n`);
    const initialized = await initializeResponse as { id?: number; result?: { protocolVersion?: string; serverInfo?: { version?: string } } };
    assert.equal(initialized.id, 1);
    assert.ok(initialized.result?.protocolVersion);
    const packageMetadata = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    assert.equal(initialized.result?.serverInfo?.version, packageMetadata.version);

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const listResponse = readJsonLine(stdout);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    const listed = await listResponse as { id?: number; result?: { tools?: Array<{ name: string }> } };
    assert.equal(listed.id, 2);
    const listedTools = listed.result?.tools?.map((tool) => tool.name) ?? [];

    const callResponse = readJsonLine(stdout);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: {
      name: tool, arguments: args,
    } })}\n`);
    const called = await callResponse as { id?: number; result?: { isError?: boolean; content?: Array<{ text?: string }>; structuredContent?: Record<string, unknown> }; error?: unknown };
    assert.equal(called.id, 3);
    assert.doesNotMatch(stderr, /key|secret|token/i);
    result = { listedTools, call: called, stderr };
  } finally {
    child.stdin.end();
    stdout.close();
    // A clean stdin close ends the server on its own; SIGKILL is only the stuck-child fallback and
    // leaves no recorder line, which the check below then reports as a failure.
    await Promise.race([closed, new Promise<void>((resolve) => {
      setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000).unref();
    })]);
    await removeProfileDir(profileDir);
  }
  if (targetEntry === entry) assertRecorderCount(stderr, 0, "default entry");
  return { ...result, stderr };
}

test("stdio success keeps JSON structuredContent and marks fixture data synthetic", async () => {
  const { listedTools, call } = await runStdioCall(syntheticEntry);
  assert.deepEqual(listedTools, ["get_market_snapshot", "get_price_history", "get_market_flows", "get_instrument_profile", "get_market_headlines", "get_fundamentals", "get_public_filings", "get_credit_balances", "get_short_sale_activity", "get_stock_lending_activity", "get_us_market_snapshot", "get_index_futures_snapshot", "get_domestic_etf_snapshot", "get_sec_company_concept", "get_sec_submissions", "search_instruments", "resolve_instrument", "get_overseas_futures_snapshot", "get_us_price_history", "get_intraday_price_history", "get_us_product_profile", "get_domestic_futures_price_history", "get_domestic_futures_intraday_history", "get_overseas_futures_price_history", "get_overseas_futures_intraday_history", "get_historical_intraday_price_history", "get_market_orderbook", "build_report_input", "render_report_html", "get_domestic_index_history", "get_global_index_history", "get_market_industry_investor_aggregates", "get_kis_house_estimates", "get_overseas_ice_actions", "get_domestic_index_period_history", "get_global_index_period_history"]);
  assert.equal(call.result?.isError, undefined);
  assert.equal(call.result?.structuredContent?.provider, "kis");
  assert.equal(call.result?.structuredContent?.provenance && (call.result.structuredContent.provenance as Record<string, unknown>).origin, "synthetic");
  assert.equal((call.result?.structuredContent?.data as Record<string, unknown>).last, "70000");
});

test("stdio authenticated synthetic fixture serves a protocol-level template-only call", async () => {
  const args = {
    report_id: "R01",
    subject: { id: "KRX:000660", name: "합성 종목", venue: "KRX", currency: "KRW" },
    cutoff: "2026-10-23T03:00:00.000Z",
    display_timezone: "Asia/Seoul",
  };
  const { listedTools, call } = await runStdioCall(syntheticEntry, "build_report_input", args);
  assert.equal(listedTools.length, 36);
  assert.ok(listedTools.includes("build_report_input"));
  assert.equal(call.result?.isError, undefined, JSON.stringify(call));
  const document = call.result?.structuredContent;
  assert.equal(document?.report_id, "R01");
  assert.equal(document?.execution_status, "template_only");
  assert.equal(document?.mode, "synthetic");
  assert.equal((document?.sources as unknown[] | undefined)?.length, 0);
  assert.doesNotMatch(JSON.stringify(document), /actual KIS data|실데이터 성공/i);
});

test("stdio MCP renders a synthetic report and reads the returned HTML resource", async () => {
  const profileDir = await makeProfileDir();
  const child = spawn(process.execPath, [...childArgs(syntheticEntry)], { env: hermeticChildEnv(profileDir), stdio: ["pipe", "pipe", "pipe"] });
  const stdout = readline.createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  async function rpc(id: number, method: string, params: Record<string, unknown>) {
    const response = readJsonLine(stdout);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return await response as any;
  }
  try {
    const initialized = await rpc(1, "initialize", {
      protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "html-resource-stdio-test", version: "1" },
    });
    assert.ok(initialized.result?.protocolVersion);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const listed = await rpc(2, "tools/list", {});
    assert.equal(listed.result.tools.length, 36);
    assert.ok(listed.result.tools.some((tool: any) => tool.name === "render_report_html"));

    const cutoff = "2026-10-23T03:00:00.000Z";
    const quote = {
      contract: "moai.stock.quote-snapshot.v1", provider: "kis", operation_id: "kis.kr.quote.snapshot.v1", origin: "synthetic",
      provenance: { source_as_of: "2026-10-22", available_at: cutoff, origin: "synthetic", validation_status: "synthetic_fixture", provider_api_version: "fixture-v1" },
      data: { last: "12345", open: "12000", high: "12500", low: "11900", previous_close: "12000", change: "345", change_percent: "2.87", volume: "1000" },
    };
    const built = await rpc(3, "tools/call", { name: "build_report_input", arguments: {
      report_id: "R01", subject: { id: "KRX:000660", name: "합성 종목", venue: "KRX", currency: "KRW" },
      cutoff, display_timezone: "Asia/Seoul", calls: [{ tool_name: "get_market_snapshot", result: { structuredContent: quote } }],
    } });
    assert.equal(built.result?.isError, undefined, JSON.stringify(built));
    assert.equal(built.result.structuredContent.mode, "synthetic");
    const rendered = await rpc(4, "tools/call", { name: "render_report_html", arguments: { report_input: built.result.structuredContent } });
    assert.equal(rendered.result?.isError, undefined, JSON.stringify(rendered));
    const link = rendered.result.content.find((item: any) => item.type === "resource_link");
    assert.ok(link); assert.equal(link.mimeType, "text/html");
    const fetched = await rpc(5, "resources/read", { uri: link.uri });
    assert.equal(fetched.error, undefined, JSON.stringify(fetched));
    assert.equal(fetched.result.contents[0].mimeType, "text/html");
    assert.match(fetched.result.contents[0].text, /합성 fixture · 실제 자료 아님/);
    assert.match(fetched.result.contents[0].text, /Content-Security-Policy/);
    assert.equal(rendered.result.structuredContent.host_rendering, "not_observed");
    assert.doesNotMatch(stderr, /key|secret|token/i);
  } finally {
    child.stdin.end(); stdout.close();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("exit", () => resolve());
      setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 1_000).unref();
    });
    await removeProfileDir(profileDir);
  }
});

test("stdio default policy runs tools without member verification and blocks a read-switch-off tool with rights_pending", async () => {
  const { listedTools, call } = await runStdioCall(entry);
  assert.deepEqual(listedTools, ["get_market_snapshot", "get_price_history", "get_market_flows", "get_instrument_profile", "get_market_headlines", "get_fundamentals", "get_public_filings", "get_credit_balances", "get_short_sale_activity", "get_stock_lending_activity", "get_us_market_snapshot", "get_index_futures_snapshot", "get_domestic_etf_snapshot", "get_sec_company_concept", "get_sec_submissions", "search_instruments", "resolve_instrument", "get_overseas_futures_snapshot", "get_us_price_history", "get_intraday_price_history", "get_us_product_profile", "get_domestic_futures_price_history", "get_domestic_futures_intraday_history", "get_overseas_futures_price_history", "get_overseas_futures_intraday_history", "get_historical_intraday_price_history", "get_market_orderbook", "build_report_input", "render_report_html", "get_domestic_index_history", "get_global_index_history", "get_market_industry_investor_aggregates", "get_kis_house_estimates", "get_overseas_ice_actions", "get_domestic_index_period_history", "get_global_index_period_history"]);
  assertSwitchBlocked("get_market_snapshot", call);
});

// New in M3: the positive half of the default policy. With no member gate and every read switch off,
// a tool that needs no switch (build_report_input) runs on the real default entry point.
test("stdio default entry runs build_report_input without member verification when every read switch is off", async () => {
  const args = {
    report_id: "R01",
    subject: { id: "KRX:000660", name: "합성 종목", venue: "KRX", currency: "KRW" },
    cutoff: "2026-10-23T03:00:00.000Z",
    display_timezone: "Asia/Seoul",
  };
  const { listedTools, call } = await runStdioCall(entry, "build_report_input", args);
  assert.equal(listedTools.length, 36);
  assert.equal(call.result?.isError, undefined, JSON.stringify(call));
  assert.doesNotMatch(JSON.stringify(call), MEMBER_GUARD_CODE);
  assert.equal(call.result?.structuredContent?.report_id, "R01");
  assert.equal(call.result?.structuredContent?.execution_status, "template_only");
});

const extendedEntry = fileURLToPath(new URL("./fixtures/extended-main.js", import.meta.url));
const operations: Array<[string, Record<string, unknown>]> = [
 ["get_market_orderbook",{symbol:"005930",board:"UN"}],
 ["get_price_history",{symbol:"000660",board:"J",start_date:"2026-10-20",end_date:"2026-10-21",adjustment_code:"0"}],
 ["get_market_flows",{symbol:"000660",board:"J",input_date:"2026-10-20"}],
 ["get_instrument_profile",{symbol:"000660"}],
 ["get_market_headlines",{symbol:"000660"}],
 ["get_fundamentals",{corp_code:"00126380",bsns_year:"2025",reprt_code:"11012",fs_div:"CFS"}],
 ["get_public_filings",{corp_code:"00126380",bgn_de:"20260101",end_de:"20261022"}],
 ["get_credit_balances",{symbol:"000660",settlement_date:"2026-10-21"}],
 ["get_short_sale_activity",{symbol:"000660",start_date:"2026-10-19",end_date:"2026-10-21"}],
 ["get_stock_lending_activity",{symbol:"000660",start_date:"2026-10-19",end_date:"2026-10-21"}],
 ["get_us_market_snapshot",{symbol:"AAPL",exchange:"NAS"}],
 ["get_index_futures_snapshot",{symbol:"101W09"}],
 ["get_domestic_etf_snapshot",{symbol:"069500"}],
 ["get_sec_company_concept",{cik:"0000320193",taxonomy:"us-gaap",concept:"Assets"}],
 ["get_sec_submissions",{cik:"0000320193"}],
 ["search_instruments",{query:"Synthetic"}],
 ["resolve_instrument",{query:"Synthetic"}],
 ["get_domestic_futures_price_history",{"symbol": "101W09", "start_date": "20250301", "end_date": "20250331", "period": "D"}],
 ["get_domestic_futures_intraday_history",{"symbol": "101T12", "anchor_date": "20230901", "anchor_time": "100000", "interval_seconds": "60", "include_past_data": "Y"}],
 ["get_overseas_futures_price_history",{"symbol": "CLM26", "exchange": "NYMEX", "end_date": "20261021", "count": "30", "period": "D"}],
 ["get_overseas_futures_intraday_history",{"symbol": "BONU25", "exchange": "EUREX", "end_date": "20250702", "count": "120", "interval_minutes": "5"}],
 ["get_historical_intraday_price_history",{symbol:"005930",board:"J",anchor_date:"20261020",anchor_time:"130000",include_past_data:"N"}],
 ["get_us_product_profile",{symbol:"AAPL",exchange:"NAS"}],
 ["get_us_price_history",{symbol:"AAPL",exchange:"NAS",basis_date:"20261021",adjustment_code:"1"}],
 ["get_intraday_price_history",{symbol:"005930",anchor_time:"113000",include_past_data:"N"}],
 ["get_overseas_futures_snapshot",{symbol:"ESZ26"}],
];
for(const [name,args] of operations){
 test(`stdio ${name} remains denied by default`,async()=>{
  const {listedTools,call}=await runStdioCall(entry,name,args);
  assertSwitchBlocked(name,call);
 });
 test(`stdio ${name} returns typed synthetic injected response`,async()=>{
  const {call}=await runStdioCall(extendedEntry,name,args);assert.equal(call.result?.isError,undefined,JSON.stringify(call));const data=call.result?.structuredContent!;
  assert.equal(data.origin??(data.provenance as Record<string,unknown>).origin,"synthetic");
  if(name==="get_price_history")assert.equal((data.bars as Array<Record<string,unknown>>)[0]?.close,null);
  if(name==="get_market_flows")assert.equal(data.canonical_projection_status,"blocked");
  if(name==="get_market_headlines")assert.equal(data.coverage,"headline_metadata_only");
  if(name==="get_fundamentals"||name==="get_public_filings")assert.equal(data.status,"no_data");
 });
}
test("stdio rejects unregistered trading/account tools",async()=>{
 for(const name of ["place_order","get_account_snapshot","transfer_money"]){const {call}=await runStdioCall(entry,name,{});assert.ok(call.error||call.result?.isError);}
});

for(const [symbol,code] of [['EMPTY','no_data'],['AMBIG','ambiguous_product_response']])test(`stdio product profile preserves safe ${code} error`,async()=>{const {call}=await runStdioCall(extendedEntry,'get_us_product_profile',{symbol,exchange:'NAS'});assert.equal(call.result?.isError,true);assert.match(call.result?.content?.[0]?.text??'',new RegExp('error_code='+code));});

const sourceInputEntry = fileURLToPath(new URL('./fixtures/source-input-main.js', import.meta.url));
for (const [name, args] of Object.entries(sourceInputs)) {
  test(`stdio source input ${name} remains denied by default`, async () => {
    const { listedTools, call } = await runStdioCall(entry, name, args);
    assert.equal(listedTools.length, 36); assertSwitchBlocked(name, call);
  });
  test(`stdio source input ${name} rejects argument provenance or rights overrides`, async () => {
    for (const patch of [{}, { origin: 'actual' }, { rightsEnabled: true }]) {
      const input = Object.keys(patch).length ? { ...args, ...patch } : {};
      const { call } = await runStdioCall(sourceInputEntry, name, input); assert.ok(call.error || call.result?.isError);
    }
  });
}
for (const name of activeSources) test(`stdio ${name} preserves injected synthetic raw evidence`, async () => {
  const { call } = await runStdioCall(sourceInputEntry, name, sourceInputs[name]);
  assert.equal(call.result?.isError, undefined, JSON.stringify(call)); const data = call.result?.structuredContent!;
  assert.equal((data.capture as Record<string, unknown>).origin, 'synthetic');
  assert.equal(data.canonical_projection_status, 'blocked'); assert.equal(data.rights_status, 'pending');
  assert.equal(data.source_as_of, null); assert.equal(data.publication_at, null);
});
for (const name of blockedSources) test(`stdio ${name} cannot bypass the hard source-contract block`, async () => {
  const { call } = await runStdioCall(sourceInputEntry, name, sourceInputs[name]);
  assert.equal(call.result?.isError, true); assert.equal(call.result?.content?.[0]?.text, 'error_code=request_contract_conflict');
});
test('stdio oversized expanded source response is rejected without truncated structuredContent', async () => {
  const args = structuredClone(sourceInputs.get_global_index_history!); (args.request as any).instrument_code = 'OVERSIZE';
  const { call } = await runStdioCall(sourceInputEntry, 'get_global_index_history', args);
  assert.equal(call.result?.isError, true); assert.equal(call.result?.content?.[0]?.text, 'error_code=response_too_large');
  assert.equal(call.result?.structuredContent, undefined);
});

const nativePeriodEntry = fileURLToPath(new URL('./fixtures/native-period-main.js', import.meta.url));
for (const period of ['W', 'M', 'Y'] as const) {
  for (const [name, op] of [['get_domestic_index_period_history', '072'], ['get_global_index_period_history', '264']] as const) test(`stdio native ${name} ${period} default-denied`, async () => {
    const { listedTools, call } = await runStdioCall(entry, name, nativePeriodInput(period, op));
    assert.equal(listedTools.length, 36); assertSwitchBlocked(name, call);
  });
  test(`stdio global native ${period} preserves synthetic raw-only state`, async () => {
    const { call } = await runStdioCall(nativePeriodEntry, 'get_global_index_period_history', nativePeriodInput(period));
    assert.equal(call.result?.isError, undefined); const data = call.result?.structuredContent!;
    assert.equal((data.request as any).period_code, period); assert.equal(data.metric_ready, false); assert.equal(data.canonical_projection_status, 'blocked');
    assert.equal((data.capture as any).origin, 'synthetic'); assert.equal(data.rights_status, 'pending');
  });
  test(`stdio domestic native ${period} remains contract-blocked`, async () => {
    const { call } = await runStdioCall(nativePeriodEntry, 'get_domestic_index_period_history', nativePeriodInput(period, '072'));
    assert.equal(call.result?.content?.[0]?.text, 'error_code=request_contract_conflict');
  });
}
test('stdio native schema rejects provenance override and D coercion', async () => {
  for (const args of [{ ...nativePeriodInput(), origin: 'actual' }, { ...nativePeriodInput(), request: { ...nativePeriodInput().request, period_code: 'D' } }]) {
    const { call } = await runStdioCall(nativePeriodEntry, 'get_global_index_period_history', args); assert.ok(call.error || call.result?.isError);
  }
});
test('stdio native response size rejection has no partial structured payload', async () => {
  const args = nativePeriodInput(); args.request.instrument_code = 'OVERSIZE';
  const { call } = await runStdioCall(nativePeriodEntry, 'get_global_index_period_history', args);
  assert.equal(call.result?.content?.[0]?.text, 'error_code=response_too_large'); assert.equal(call.result?.structuredContent, undefined);
});

for (const name of ['get_domestic_etf_snapshot','get_overseas_futures_snapshot','get_overseas_futures_price_history','get_overseas_futures_intraday_history']) test(`public stdio exposes restored read tool but rejects missing inputs for ${name}`,async()=>{
 const {listedTools,call}=await runStdioCall(entry,name,{});
 assert.equal(listedTools.length,36);assert.equal(listedTools.includes(name),true);assert.ok(call.error||call.result?.isError);
});
test('authenticated synthetic stdio accepts explicit ETF report subject as partial input',async()=>{
 const {call}=await runStdioCall(syntheticEntry,'build_report_input',{report_id:'R01',subject:{id:'ETF:TEST',name:'ETF',venue:'KRX',currency:'KRW'},cutoff:'2026-10-23T03:00:00.000Z',display_timezone:'Asia/Seoul'});
 assert.ok(!call.result?.isError);assert.equal(call.result?.structuredContent?.execution_status,'template_only');
});

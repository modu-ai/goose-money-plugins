import {ReportEvidenceStore} from './report-evidence-store.js';
import { registerNativePeriodTools, type NativePeriodServerOptions } from "./native-period-mcp.js";
import { PACKAGE_VERSION } from "./package-metadata.js";
import { safeResult } from "./mcp-result.js";
import { registerSourceInputTools, type SourceInputServerOptions } from "./source-input-mcp.js";
import {MarketOrderbookInputSchema,MarketOrderbookResultSchema,requestMarketOrderbook,type MarketOrderbookTransport} from './market-orderbook.js';
import {KrHistoricalIntradayInputSchema,KrHistoricalIntradayResultSchema,requestKrHistoricalIntraday,type KrHistoricalIntradayTransport} from './historical-stock-bars.js';
import {KrFuturesDailyHistoryInputSchema,KrFuturesDailyHistoryResultSchema,KrFuturesMinuteHistoryInputSchema,KrFuturesMinuteHistoryResultSchema,OverseasFuturesDailyHistoryInputSchema,OverseasFuturesDailyHistoryResultSchema,OverseasFuturesMinuteHistoryInputSchema,OverseasFuturesMinuteHistoryResultSchema,requestKrFuturesDailyHistory,requestKrFuturesMinuteHistory,requestOverseasFuturesDailyHistory,requestOverseasFuturesMinuteHistory,type FuturesHistoryTransport} from './futures-history.js';
import {UsProductProfileInputSchema,UsProductProfileResultSchema,requestUsProductProfile,type EtfProductTransport} from './etf-product-inputs.js';
import {UsDailyHistoryInputSchema,UsDailyHistoryResultSchema,KrIntradayHistoryInputSchema,KrIntradayHistoryResultSchema,requestUsDailyHistory,requestKrIntradayHistory,type HistoryBreadthTransport} from './history-breadth.js';
import {InstrumentSearchInputSchema,InstrumentSearchResultSchema,searchInstruments,type InstrumentDirectoryLoader} from './instrument-directory.js';
import {OverseasFuturesQuoteInputSchema,OverseasFuturesQuoteResultSchema,requestOverseasFuturesQuote,type OverseasFuturesTransport} from './overseas-futures-data.js';
import {SecConceptInputSchema,SecConceptResultSchema,SecSubmissionsInputSchema,SecSubmissionsResultSchema,requestSecCompanyConcept,requestSecSubmissions,type SecPublicTransport} from './sec-public-data.js';
import {UsQuoteInputSchema,UsQuoteResultSchema,FuturesQuoteInputSchema,FuturesQuoteResultSchema,DomesticEtfQuoteInputSchema,DomesticEtfQuoteResultSchema,requestUsQuote,requestFuturesQuote,requestDomesticEtfQuote,type GlobalMarketTransport} from './global-market-data.js';
import {CreditInputSchema,RiskRangeInputSchema,MarketRiskResultSchema,requestMarketRisk,type MarketRiskTransport} from './market-risk-data.js';
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { buildReportInput, ActiveReportInputSchema, ReportInputSchema, ReportPipelineToolInputSchema } from "./report-pipeline.js";
import { registerReportHtmlTool } from "./report-html-mcp.js";
import { QuoteInputSchema, QuoteSnapshotSchema, type QuoteSnapshot } from "./domain.js";
import { normalizeKrQuote } from "./normalize-kr-quote.js";
import type { KisQuoteTransport } from "./kis-http.js";
import {HistoryInputSchema, HistoryResultSchema, buildHistoryResult} from "./history-contract.js";
import {FlowInputSchema, FlowResultSchema, buildFlowResult} from "./flow-contract.js";
import {requestKis039DailyBars, requestKis115InvestorFlow, type KisR01Transport} from "./r01-kis-http-adapters.js";
import {ProfileInputSchema, ProfileResultSchema, HeadlinesInputSchema, HeadlinesResultSchema, requestInstrumentProfile, requestMarketHeadlines, requestInvestorRaw, InvestorRawResultSchema, type ReferenceTransport} from "./kis-reference-data.js";
import {openDartInputSchema, openDartResultSchema, requestOpenDartFullStatement, type OpenDartTransport} from "./opendart.js";
import {openDartFilingsInputSchema, openDartFilingsResultSchema, requestOpenDartFilings, type OpenDartFilingsTransport} from "./opendart-filings.js";

export interface ServerOptions extends SourceInputServerOptions, NativePeriodServerOptions {
  /** Legacy release-scope option retained for callers; ETF/futures reads are included, accounts remain unsupported. */
  studentReleaseScope?: boolean;
  marketOrderbookTransport?: MarketOrderbookTransport;
  historicalStockTransport?: KrHistoricalIntradayTransport;
  futuresHistoryTransport?: FuturesHistoryTransport;
  etfProductTransport?: EtfProductTransport;
  historyBreadthTransport?: HistoryBreadthTransport;
  instrumentDirectory?: InstrumentDirectoryLoader;
  directoryEnabled?: boolean;
  overseasFuturesTransport?: OverseasFuturesTransport;
  globalMarketTransport?: GlobalMarketTransport;
  secTransport?: SecPublicTransport;
  secEnabled?: boolean;
  marketRiskTransport?: MarketRiskTransport;
  transport?: KisQuoteTransport;
  /** Trusted host reuse of an already validated local snapshot; never tool input. */
  retainedQuoteSnapshot?: QuoteSnapshot;
  historyTransport?: KisR01Transport;
  referenceTransport?: ReferenceTransport;
  openDartTransport?: OpenDartTransport;
  filingsTransport?: OpenDartFilingsTransport;
  openDartEnabled?: boolean;
  rightsEnabled?: boolean;
  localReportViewEnabled?: boolean;
  origin?: "actual" | "synthetic";
  clock?: () => string;
}

export function createStockMcpServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "moai-atp-readonly", version: PACKAGE_VERSION });
  const clock = options.clock ?? (() => new Date().toISOString());
  const evidence=new ReportEvidenceStore();
  async function providerResult(name:string,work:()=>Promise<Record<string,unknown>>){
    const result=await safeResult(work,{compactStructuredText:name==='get_fundamentals'});
    const payload=result.structuredContent;
    const provenance=payload.provenance as Record<string,unknown>|undefined;
    if(options.localReportViewEnabled===true&&(payload.origin==='actual'||provenance?.origin==='actual')){
      const id=evidence.issue(name,payload,typeof provenance?.received_at==='string'?provenance.received_at:typeof payload.received_at==='string'?payload.received_at:clock());
      return {...result,_meta:{'moai-atp.local-evidence':id}};
    }
    return result;
  }
  server.registerTool("get_market_snapshot", {
    title: "국내 주식 시세 스냅샷",
    description: "고정된 KIS 국내주식 시세 endpoint에서 읽기 전용 스냅샷을 반환합니다. 기본값은 권리 미확인으로 차단됩니다. 계좌·주문·이체·임의 API 호출은 지원하지 않습니다.",
    inputSchema: QuoteInputSchema,
    outputSchema: QuoteSnapshotSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ symbol, board }) => providerResult("get_market_snapshot",async () => {
    if (!options.rightsEnabled) throw new Error("error_code=rights_pending");
    if(options.retainedQuoteSnapshot){
      const retained=QuoteSnapshotSchema.parse(options.retainedQuoteSnapshot);
      if(retained.instrument_ref.symbol!==symbol||retained.instrument_ref.source_market_division_code!==board)throw new Error('instrument_mismatch');
      return retained;
    }
    if (!options.transport) throw new Error("error_code=credential_missing");
    const payload = await options.transport.getMarketSnapshot(symbol, board);
    const snapshot: QuoteSnapshot = normalizeKrQuote(payload, {
      symbol,
      board,
      receivedAt: clock(),
      origin: options.origin ?? "actual",
    });
    const valid = QuoteSnapshotSchema.parse(snapshot);
    const text = JSON.stringify(valid);
    if (Buffer.byteLength(text, "utf8") > 300_000) throw new Error("error_code=response_too_large");
    return valid;
  }));
  const annotations = {readOnlyHint:true,destructiveHint:false,openWorldHint:false};
  const marketGate=()=>{if(!options.rightsEnabled)throw new Error("error_code=rights_pending");};
  const dartGate=()=>{if(!options.openDartEnabled)throw new Error("error_code=source_not_enabled");};
  server.registerTool("get_price_history", {title:"국내 일별 가격 이력",description:"일별 원천 응답을 검증합니다. 미해결 단위/수정주가 매핑은 null로 유지하며 5분/시간봉이나 실제 완전성은 주장하지 않습니다.",inputSchema:HistoryInputSchema,outputSchema:HistoryResultSchema,annotations},async(input)=>providerResult("get_price_history",async()=>{
    marketGate();if(!options.historyTransport)throw new Error("credential_missing");
    const rows=await requestKis039DailyBars({symbol:input.symbol,board:input.board,startDate:input.start_date.replaceAll("-",""),endDate:input.end_date.replaceAll("-",""),adjustmentCode:input.adjustment_code},options.historyTransport,{clock});
    return buildHistoryResult(input,rows);
  }));
  server.registerTool("get_market_flows", {title:"투자자별 수급 후보",description:"개인·외국인·기관의 종목별 수급 원문을 조회합니다. 실제 읽기는 inquire-investor의 반환 날짜 범위이며 요청 날짜 필터가 아닙니다. 단위 미확인 원문을 임의 변환하지 않습니다.",inputSchema:FlowInputSchema,outputSchema:z.union([FlowResultSchema,InvestorRawResultSchema]),annotations},async(input)=>providerResult("get_market_flows",async()=>{
    marketGate();if(options.referenceTransport?.origin==='actual'){if(input.board==='UN')throw new Error('invalid_input');return requestInvestorRaw(input,options.referenceTransport,clock);}
    if(!options.historyTransport)throw new Error("credential_missing");
    const result=await requestKis115InvestorFlow({symbol:input.symbol,board:input.board,inputDate:input.input_date.replaceAll("-","")},options.historyTransport,{clock});
    return buildFlowResult(input,result);
  }));
  server.registerTool("get_instrument_profile", {title:"국내 종목 기본정보",description:"고정된 KIS 주식기본조회 응답의 이름과 분류 코드만 반환합니다. 분류 코드 의미는 추론하지 않습니다.",inputSchema:ProfileInputSchema,outputSchema:ProfileResultSchema,annotations},async(input)=>providerResult("get_instrument_profile",async()=>{
    marketGate();if(!options.referenceTransport)throw new Error("credential_missing");return requestInstrumentProfile(input,options.referenceTransport,clock);
  }));
  server.registerTool("get_market_headlines", {title:"종목 뉴스/공시 제목",description:"고정된 KIS 제목 조회의 메타데이터만 반환합니다. 본문 요약이 아니며 자동 페이지 순회/외부 URL 방문을 하지 않습니다.",inputSchema:HeadlinesInputSchema,outputSchema:HeadlinesResultSchema,annotations},async(input)=>providerResult("get_market_headlines",async()=>{
    marketGate();if(!options.referenceTransport)throw new Error("credential_missing");return requestMarketHeadlines(input,options.referenceTransport,clock);
  }));
  server.registerTool("get_fundamentals", {title:"OpenDART 재무제표",description:"회사/연도/보고서/연결·별도 기준을 지정한 전체 재무제표. 당기와 누적값을 분리하며 인증키는 tool 인수로 받지 않습니다. 기본 실행기는 비활성입니다.",inputSchema:openDartInputSchema,outputSchema:openDartResultSchema,annotations},async(input)=>providerResult("get_fundamentals",async()=>{
    dartGate();if(!options.openDartTransport)throw new Error("credential_missing");return requestOpenDartFullStatement(input,options.openDartTransport,()=>({origin:options.openDartTransport!.origin,received_at:clock()}));
  }));
  server.registerTool("get_public_filings", {title:"OpenDART 공시 목록",description:"회사와 기간에 대한 공시 한 페이지를 조회합니다. 다음 페이지는 명시적 번호로만 요청하며 인증키는 tool 인수로 받지 않습니다.",inputSchema:openDartFilingsInputSchema,outputSchema:openDartFilingsResultSchema,annotations},async(input)=>providerResult("get_public_filings",async()=>{
    dartGate();if(!options.filingsTransport)throw new Error("credential_missing");return requestOpenDartFilings(input,options.filingsTransport,()=>({origin:options.filingsTransport!.origin,received_at:clock()}));
  }));
  for(const [name,kind,title] of [['get_credit_balances','credit','국내 신용잔고'],['get_short_sale_activity','short_sale','국내 공매도 추이'],['get_stock_lending_activity','lending','국내 대차거래 추이']] as const){
    server.registerTool(name,{title,description:'고정된 읽기 전용 KIS 한 페이지. 공식 주수 필드만 정확한 shares 후보값을 제공하고 금액/비율/기타 미확인 단위와 종목 동일성·발행시각은 미해결로 보존합니다. 권리 확인 전 기본 차단.',inputSchema:kind==='credit'?CreditInputSchema:RiskRangeInputSchema,outputSchema:MarketRiskResultSchema,annotations},async (input:unknown)=>providerResult(name,async()=>{marketGate();if(!options.marketRiskTransport)throw new Error('credential_missing');return requestMarketRisk(kind,input,options.marketRiskTransport,clock);}));
  }
  server.registerTool('get_us_market_snapshot',{title:'미국 주식/ETF 원천 시세',description:'고정 거래소·종목 코드의 읽기 전용 KIS 시세. 통화/단위/정식 종목 마스터가 미검증이라 canonical 값은 null입니다.',inputSchema:UsQuoteInputSchema,outputSchema:UsQuoteResultSchema,annotations},async input=>providerResult("get_us_market_snapshot",async()=>{marketGate();return requestUsQuote(input,options.globalMarketTransport,clock);}));
  server.registerTool('get_index_futures_snapshot',{title:'국내 지수선물 원천 시세',description:'지수선물 시세 조회만 지원합니다. 주문 없음. 계약 승수/만기/단위/식별 미검증 값은 canonical null로 보존합니다.',inputSchema:FuturesQuoteInputSchema,outputSchema:FuturesQuoteResultSchema,annotations},async input=>providerResult("get_index_futures_snapshot",async()=>{marketGate();return requestFuturesQuote(input,options.globalMarketTransport,clock);}));
  server.registerTool('get_domestic_etf_snapshot',{title:'국내 ETF/ETN 원천 NAV 시세',description:'ETF/ETN 전용 시세·NAV 조회입니다. 보유종목 구성비가 아니며 ETF 식별·NAV 단위·추적/괴리 정의가 미검증이면 canonical null로 보존합니다.',inputSchema:DomesticEtfQuoteInputSchema,outputSchema:DomesticEtfQuoteResultSchema,annotations},async input=>providerResult("get_domestic_etf_snapshot",async()=>{marketGate();return requestDomesticEtfQuote(input,options.globalMarketTransport,clock);}));
  const secGate=()=>{if(!options.secEnabled)throw new Error('source_not_enabled');if(!options.secTransport)throw new Error('transport_not_configured');};
  server.registerTool('get_sec_company_concept',{title:'SEC 회사 XBRL 개념',description:'명시된 CIK와 허용된 표준 taxonomy/tag의 공시 사실 후보. 원본 JSON 숫자 lexeme, 단위/기간/접수번호를 보존하며 최신값·누적·연결기준을 추정하지 않습니다.',inputSchema:SecConceptInputSchema,outputSchema:SecConceptResultSchema,annotations},async input=>safeResult(async()=>{secGate();return requestSecCompanyConcept(input,options.secTransport!,clock);}));
  server.registerTool('get_sec_submissions',{title:'SEC 최근 공시 메타데이터',description:'CIK별 최근 공시 제한된 부분집합. 과거 파일이나 공시 본문을 자동 요청하지 않고 누락 수를 표시합니다.',inputSchema:SecSubmissionsInputSchema,outputSchema:SecSubmissionsResultSchema,annotations},async input=>safeResult(async()=>{secGate();return requestSecSubmissions(input,options.secTransport!,clock);}));
  server.registerTool('search_instruments',{title:'종목 디렉터리 후보 검색',description:'주입된 디렉터리만 검색합니다. 시장/종류/이름/식별자 후보를 반환하며 단일 후보도 확인된 종목으로 자동 선택하지 않습니다. 디렉터리 범위와 시점을 보존합니다.',inputSchema:InstrumentSearchInputSchema,outputSchema:InstrumentSearchResultSchema,annotations},async input=>safeResult(async()=>{if(!options.directoryEnabled)throw new Error('source_not_enabled');if(!options.instrumentDirectory)throw new Error('transport_not_configured');return searchInstruments(input,options.instrumentDirectory,clock);}));
  server.registerTool('resolve_instrument',{title:'종목 식별 후보 확인',description:'기존 계획의 resolve_instrument 호환 진입점. 디렉터리 후보 검색과 동일한 보수적 계약이며 단일 후보도 검증된 종목으로 자동 확정하지 않습니다.',inputSchema:InstrumentSearchInputSchema,outputSchema:InstrumentSearchResultSchema,annotations},async input=>safeResult(async()=>{if(!options.directoryEnabled)throw new Error('source_not_enabled');if(!options.instrumentDirectory)throw new Error('transport_not_configured');return searchInstruments(input,options.instrumentDirectory,clock);}));
  server.registerTool('get_overseas_futures_snapshot',{title:'해외선물 원천 시세',description:'고정된 KIS 해외선물 읽기 전용 시세. 음수 선물 가격을 보존하며 미국 상장/계약 식별·승수·단위·시간대 미검증 canonical 값은 null입니다. 주문을 지원하지 않습니다.',inputSchema:OverseasFuturesQuoteInputSchema,outputSchema:OverseasFuturesQuoteResultSchema,annotations},async input=>providerResult("get_overseas_futures_snapshot",async()=>{marketGate();return requestOverseasFuturesQuote(input,options.overseasFuturesTransport,clock);}));
  server.registerTool('get_us_price_history',{title:'미국 일별 가격 원천 이력',description:'지정 기준일·수정주가 요청값의 원천 한 페이지. 단위/수정기준/완전성 미확인으로 canonical 시계열은 null이며 자동 연속조회나 차트 변환을 하지 않습니다.',inputSchema:UsDailyHistoryInputSchema,outputSchema:UsDailyHistoryResultSchema,annotations},async input=>providerResult("get_us_price_history",async()=>{marketGate();return requestUsDailyHistory(input,options.historyBreadthTransport,clock);}));
  server.registerTool('get_intraday_price_history',{title:'국내 당일 분봉 원천',description:'고정된 당일 분봉 endpoint의 최대30행 원천을 검증합니다. 최초 행 거래량 유의사항을 보존하며 5분/시간봉·과거일 분봉·완성봉으로 추정하지 않습니다.',inputSchema:KrIntradayHistoryInputSchema,outputSchema:KrIntradayHistoryResultSchema,annotations},async input=>providerResult("get_intraday_price_history",async()=>{marketGate();return requestKrIntradayHistory(input,options.historyBreadthTransport,clock);}));
  server.registerTool('get_us_product_profile',{title:'미국 상품 원천 정보',description:'고정된 미국 상품정보 조회. 55개 공식 원천 필드를 검증하지만 종목 식별·상품분류·통화/단위·수신시각을 확정된 canonical 정보로 추정하지 않습니다. ETF 보유종목·비용률 데이터가 아닙니다.',inputSchema:UsProductProfileInputSchema,outputSchema:UsProductProfileResultSchema,annotations},async input=>providerResult("get_us_product_profile",async()=>{marketGate();return requestUsProductProfile(input,options.etfProductTransport,clock);}));
  server.registerTool('get_domestic_futures_price_history',{title:'국내 선물 일별 원천 이력',description:'고정된 읽기 전용 첫 페이지 원천 조회입니다. 음수 가격·공백·중복·원천 순서를 보존하며 단위/승수/상장시장/시간대/봉 완성도는 추정하지 않습니다. canonical bars는 null이고 자동 연속조회·재집계는 없습니다.',inputSchema:KrFuturesDailyHistoryInputSchema,outputSchema:KrFuturesDailyHistoryResultSchema,annotations},async input=>providerResult("get_domestic_futures_price_history",async()=>{marketGate();return requestKrFuturesDailyHistory(input,options.futuresHistoryTransport,clock);}));
  server.registerTool('get_domestic_futures_intraday_history',{title:'국내 선물 분봉 원천 이력',description:'고정된 읽기 전용 첫 페이지 원천 조회입니다. 음수 가격·공백·중복·원천 순서를 보존하며 단위/승수/상장시장/시간대/봉 완성도는 추정하지 않습니다. canonical bars는 null이고 자동 연속조회·재집계는 없습니다.',inputSchema:KrFuturesMinuteHistoryInputSchema,outputSchema:KrFuturesMinuteHistoryResultSchema,annotations},async input=>providerResult("get_domestic_futures_intraday_history",async()=>{marketGate();return requestKrFuturesMinuteHistory(input,options.futuresHistoryTransport,clock);}));
  server.registerTool('get_overseas_futures_price_history',{title:'해외 선물 일별 원천 이력',description:'고정된 읽기 전용 첫 페이지 원천 조회입니다. 음수 가격·공백·중복·원천 순서를 보존하며 단위/승수/상장시장/시간대/봉 완성도는 추정하지 않습니다. canonical bars는 null이고 자동 연속조회·재집계는 없습니다.',inputSchema:OverseasFuturesDailyHistoryInputSchema,outputSchema:OverseasFuturesDailyHistoryResultSchema,annotations},async input=>providerResult("get_overseas_futures_price_history",async()=>{marketGate();return requestOverseasFuturesDailyHistory(input,options.futuresHistoryTransport,clock);}));
  server.registerTool('get_overseas_futures_intraday_history',{title:'해외 선물 분봉 원천 이력',description:'고정된 읽기 전용 첫 페이지 원천 조회입니다. 음수 가격·공백·중복·원천 순서를 보존하며 단위/승수/상장시장/시간대/봉 완성도는 추정하지 않습니다. canonical bars는 null이고 자동 연속조회·재집계는 없습니다.',inputSchema:OverseasFuturesMinuteHistoryInputSchema,outputSchema:OverseasFuturesMinuteHistoryResultSchema,annotations},async input=>providerResult("get_overseas_futures_intraday_history",async()=>{marketGate();return requestOverseasFuturesMinuteHistory(input,options.futuresHistoryTransport,clock);}));
  server.registerTool('get_historical_intraday_price_history',{title:'국내 주식 과거 일자 분봉 원천 조회',description:'명시한 일자와 시간으로 고정된 읽기 전용 첫 페이지를 조회합니다. 최대 120개 원천 행의 공백·중복·서로 다른 일자 표기를 그대로 보존합니다. 종목 확인, 시간대, 단위, 체결/가상틱 구분, 완성도와 전체 기간을 추정하지 않으며 canonical bars는 null입니다.',inputSchema:KrHistoricalIntradayInputSchema,outputSchema:KrHistoricalIntradayResultSchema,annotations},async input=>providerResult("get_historical_intraday_price_history",async()=>{marketGate();return requestKrHistoricalIntraday(input,options.historicalStockTransport,clock);}));
  server.registerTool('get_market_orderbook',{title:'국내 원천 호가 후보',description:'고정된 읽기 전용 호가 endpoint의 제한된 원천 JSON만 보존합니다. 체결가능·동시호가·단위·종목·시각 검증을 주장하지 않으며 예상체결 output2를 호가로 변환하지 않습니다. 기본 권리 미확인 차단.',inputSchema:MarketOrderbookInputSchema,outputSchema:MarketOrderbookResultSchema,annotations},async input=>providerResult("get_market_orderbook",async()=>{marketGate();return requestMarketOrderbook(input,options.marketOrderbookTransport,clock);}));
  server.registerTool("build_report_input", {
    title: "보고서 입력 조립 · 로컬 분석",
    description: "R01–R03, R05–R11, R14, U01 중 하나에 대해 앞서 받은 MCP 응답을 정규화된 보고서 입력으로 조립합니다. 이 도구 자체는 외부 데이터 요청이나 파일 저장을 하지 않습니다. 합성 자료는 합성으로 표시하고, 권리 미확인 공급자 값은 숨기며 rights_pending을 유지합니다. 계좌 원장 입력·주문·이체는 받지 않습니다.",
    inputSchema: ReportPipelineToolInputSchema,
    outputSchema: ActiveReportInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (input) => safeResult(async () => {
    const args = ReportPipelineToolInputSchema.parse(input);
    if(String(args.report_id)==='R04')throw new Error('source_not_enabled');
    const ids=args.source_receipts??[];
    if(ids.length&&options.localReportViewEnabled!==true)throw new Error('invalid_provenance');
    const resolved=evidence.resolve(ids);
    const calls=[...args.calls,...resolved.map(row=>({tool_name:row.tool_name,result:row.result}))];
    const trustedLocalReceipts=new Map(resolved.map((row,i)=>[args.calls.length+i,{receivedAt:row.receivedAt}]));
    const report=ReportInputSchema.parse(buildReportInput({...args,calls,trustedLocalReceipts,received_at:clock()}));
    evidence.consume(ids);evidence.rememberReport(report);return report;
  }));
  registerReportHtmlTool(server, clock,doc=>evidence.acceptsReport(doc));
  registerSourceInputTools(server, options, clock);
  registerNativePeriodTools(server, options, clock);
  return server;
}

export function createDenyByDefaultServer(): McpServer {
  return createStockMcpServer({ rightsEnabled: false });
}

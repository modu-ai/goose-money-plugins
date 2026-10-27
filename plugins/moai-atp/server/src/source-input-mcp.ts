import { types } from 'node:util';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { ExactInstantSchema } from './exact-instant.js';
import { Kis072HistoryRequestSchema, Kis264HistoryRequestSchema, Kis072HistoryResultSchema, Kis264HistoryResultSchema,
  requestKis072History, requestKis264History, type BenchmarkHistoryTransport } from './benchmark-history-inputs.js';
import { Kis113MarketInvestorRequestSchema, Kis109HouseEstimateRequestSchema, Kis280IceActionRequestSchema,
  RemainingSourceResultSchema, collectRemainingSourceEvidence, type RemainingSourceWireRequest } from './remaining-source-inputs.js';
import { safeResult } from './mcp-result.js';

/** Public inputs cannot set origin, receipt time, rights, transport, endpoint or continuation. */
export const DomesticIndexHistoryToolInputSchema = z.object({ request: Kis072HistoryRequestSchema, cutoff: ExactInstantSchema }).strict();
export const GlobalIndexHistoryToolInputSchema = z.object({ request: Kis264HistoryRequestSchema, cutoff: ExactInstantSchema }).strict();
export const MarketIndustryInvestorToolInputSchema = z.object({ request: Kis113MarketInvestorRequestSchema, cutoff: ExactInstantSchema }).strict();
export const KisHouseEstimatesToolInputSchema = z.object({ request: Kis109HouseEstimateRequestSchema, cutoff: ExactInstantSchema }).strict();
export const OverseasIceActionsToolInputSchema = z.object({ request: Kis280IceActionRequestSchema, cutoff: ExactInstantSchema }).strict();
export interface RemainingSourceHostTransport {
  readonly origin: 'actual' | 'synthetic';
  readonly send: (request: RemainingSourceWireRequest) => Promise<unknown>;
}
export interface SourceInputServerOptions {
  rightsEnabled?: boolean;
  benchmarkHistoryTransport?: BenchmarkHistoryTransport;
  remainingSourceTransport?: RemainingSourceHostTransport;
}
const annotations = Object.freeze({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
export const SOURCE_INPUT_MCP_NAMES = Object.freeze([
  'get_domestic_index_history', 'get_global_index_history', 'get_market_industry_investor_aggregates',
  'get_kis_house_estimates', 'get_overseas_ice_actions',
] as const);
function checked<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error('invalid_input');
  return parsed.data;
}
/** Trusted injected host option, not arbitrary tool metadata. Descriptors avoid running getters. */
function transportHooks(transport: RemainingSourceHostTransport | undefined) {
  if (transport === undefined) throw new Error('transport_not_configured');
  if (transport === null || typeof transport !== 'object' || types.isProxy(transport) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(transport))) throw new Error('invalid_input');
  const keys = Reflect.ownKeys(transport);
  const origin = Object.getOwnPropertyDescriptor(transport, 'origin'), send = Object.getOwnPropertyDescriptor(transport, 'send');
  if (keys.length !== 2 || !keys.includes('origin') || !keys.includes('send') || !origin || !('value' in origin) ||
      !['actual', 'synthetic'].includes(origin.value) || !send || !('value' in send) || typeof send.value !== 'function' || types.isProxy(send.value))
    throw new Error('invalid_input');
  return { origin: origin.value as 'actual' | 'synthetic', send: send.value as RemainingSourceHostTransport['send'] };
}
export function registerSourceInputTools(server: McpServer, options: SourceInputServerOptions, clock: () => string): void {
  const gate = () => { if (options.rightsEnabled !== true) throw new Error('rights_pending'); };
  server.registerTool('get_domestic_index_history', {
    title: 'KIS-072 국내 지수 일별 원천 이력 (차단)',
    description: '국내 지수 일별 요청의 코드 길이 계약 충돌로 모든 전송이 차단됩니다. 합성 전송을 주입해도 우회할 수 없습니다. canonical OHLCV·완전성·실시간·권리 승인을 주장하지 않습니다.',
    inputSchema: DomesticIndexHistoryToolInputSchema, outputSchema: Kis072HistoryResultSchema, annotations,
  }, async input => safeResult(async () => {
    const q = checked(DomesticIndexHistoryToolInputSchema, input); gate();
    // Do not read a transport option or receipt clock on the hard-blocked path.
    return requestKis072History(q);
  }));
  server.registerTool('get_global_index_history', {
    title: 'KIS-264 글로벌 지수 일별 원천 이력',
    description: '고정된 GET 한 번으로 받은 일별 원천 문자열·누락·중복·순서를 보존합니다. 정식 지수 식별·단위·시간대·수정기준·기간 완전성은 미확인이고 canonical 값은 null입니다. 자동 연속조회나 재집계 없음. 서버 기본값(읽기 스위치 꺼짐)에서는 차단됩니다. 출하 플러그인 설정(mcp.json)은 KIS 읽기 스위치를 켜므로 로컬 키가 있으면 호출 시 KIS로 요청이 나갑니다.',
    inputSchema: GlobalIndexHistoryToolInputSchema, outputSchema: Kis264HistoryResultSchema, annotations,
  }, async input => safeResult(async () => {
    const q = checked(GlobalIndexHistoryToolInputSchema, input); gate();
    return requestKis264History(q, options.benchmarkHistoryTransport, clock);
  }));
  server.registerTool('get_market_industry_investor_aggregates', {
    title: 'KIS-113 시장·업종 투자자 집계 원천',
    description: '고정된 시장·업종 하루 집계 한 번만 조회합니다. 개별 주식 수급 또는 KIS-115와 동일하지 않습니다. 수량·금액 단위와 통화·집계범위는 미확인으로 canonical 값은 null입니다. 자동 페이지 순회 없음. 서버 기본값(읽기 스위치 꺼짐)에서는 차단됩니다. 출하 플러그인 설정(mcp.json)은 KIS 읽기 스위치를 켜므로 로컬 키가 있으면 호출 시 KIS로 요청이 나갑니다.',
    inputSchema: MarketIndustryInvestorToolInputSchema, outputSchema: RemainingSourceResultSchema, annotations,
  }, async input => safeResult(async () => {
    const q = checked(MarketIndustryInvestorToolInputSchema, input); gate();
    const host = transportHooks(options.remainingSourceTransport);
    return collectRemainingSourceEvidence(q.request, { origin: host.origin, cutoff: q.cutoff }, { send: host.send, now: clock });
  }));
  server.registerTool('get_kis_house_estimates', {
    title: 'KIS-109 한국투자증권 자체 추정치 (차단)',
    description: '한국투자증권 자체 추정치이며 여러 증권사 컨센서스가 아닙니다. SHT_CD 코드 길이 계약 충돌로 합성 전송을 포함해 모두 차단됩니다. 행·기간·지표·단위 해석과 canonical 값은 확정하지 않습니다.',
    inputSchema: KisHouseEstimatesToolInputSchema, outputSchema: RemainingSourceResultSchema, annotations,
  }, async input => safeResult(async () => {
    checked(KisHouseEstimatesToolInputSchema, input); gate();
    // This registration has no transport or clock branch. The source collector independently blocks 109 too.
    throw new Error('request_contract_conflict');
  }));
  server.registerTool('get_overseas_ice_actions', {
    title: 'KIS-280 해외 ICE 권리·기업행사 원천',
    description: '해외 ICE A4/A5 원천 한 페이지이며 국내 KSD 권리정보가 아닙니다. ca_title 분류와 종목·일자 의미는 미확인으로 canonical event_type/date는 null입니다. 조회일 기준은 행사별로 다를 수 있고 미래 지급·효력일은 원천대로 보존합니다. 자동 페이지 순회 없음. 서버 기본값(읽기 스위치 꺼짐)에서는 차단됩니다. 출하 플러그인 설정(mcp.json)은 KIS 읽기 스위치를 켜므로 로컬 키가 있으면 호출 시 KIS로 요청이 나갑니다.',
    inputSchema: OverseasIceActionsToolInputSchema, outputSchema: RemainingSourceResultSchema, annotations,
  }, async input => safeResult(async () => {
    const q = checked(OverseasIceActionsToolInputSchema, input); gate();
    const host = transportHooks(options.remainingSourceTransport);
    return collectRemainingSourceEvidence(q.request, { origin: host.origin, cutoff: q.cutoff }, { send: host.send, now: clock });
  }));
}

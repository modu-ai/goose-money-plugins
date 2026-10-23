import { types } from 'node:util';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { ExactInstantSchema } from './exact-instant.js';
import { Kis072PeriodRequestSchema, Kis264PeriodRequestSchema, Kis072PeriodResultSchema, Kis264PeriodResultSchema,
  requestKis072Period, requestKis264Period, type BenchmarkPeriodTransport } from './benchmark-period-inputs.js';
import { safeResult } from './mcp-result.js';

export const DomesticIndexPeriodToolInputSchema = z.object({ request: Kis072PeriodRequestSchema, cutoff: ExactInstantSchema }).strict();
export const GlobalIndexPeriodToolInputSchema = z.object({ request: Kis264PeriodRequestSchema, cutoff: ExactInstantSchema }).strict();
export const NATIVE_PERIOD_MCP_NAMES = Object.freeze(['get_domestic_index_period_history', 'get_global_index_period_history'] as const);
export interface NativePeriodServerOptions {
  rightsEnabled?: boolean;
  /** Separate trusted host injection. Tool arguments never configure this option. */
  benchmarkPeriodTransport?: BenchmarkPeriodTransport;
}
const annotations = Object.freeze({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('invalid_input');
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(k => typeof k !== 'string' || !keys.includes(k))) throw new Error('invalid_input');
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !d.enumerable || !('value' in d)) throw new Error('invalid_input');
    out[key] = d.value;
  }
  return out;
}
/** Fixed-depth owned-data snapshot before schema parsing. No accessors/hooks or caller mutation. */
function checked<T>(schema: z.ZodType<T>, input: unknown): T {
  const top = fields(input, ['request', 'cutoff']);
  const request = fields(top.request, ['market_code', 'instrument_code', 'start_date', 'end_date', 'period_code']);
  for (const value of [...Object.values(request), top.cutoff]) if (typeof value !== 'string' || value.length > 256) throw new Error('invalid_input');
  const result = schema.safeParse({ request, cutoff: top.cutoff });
  if (!result.success) throw new Error('invalid_input');
  return result.data;
}
function ownOption(options: NativePeriodServerOptions, key: keyof NativePeriodServerOptions): unknown {
  if (options === null || typeof options !== 'object' || types.isProxy(options)) throw new Error('invalid_input');
  const d = Object.getOwnPropertyDescriptor(options, key);
  if (!d) return undefined;
  if (!d.enumerable || !('value' in d)) throw new Error('invalid_input');
  return d.value;
}
export function registerNativePeriodTools(server: McpServer, options: NativePeriodServerOptions, clock: () => string): void {
  const gate = () => { if (ownOption(options, 'rightsEnabled') !== true) throw new Error('rights_pending'); };
  server.registerTool(NATIVE_PERIOD_MCP_NAMES[0], {
    title: 'KIS-072 국내 지수 주·월·연 원시 이력 (차단)',
    description: '요청 주기 W/M/Y만 표현합니다. 코드 길이 계약 충돌로 전송은 항상 차단됩니다. 기존 일별 API는 변경하지 않으며 실제 구간·완전성·단위·총수익·권리를 확인하거나 정규 차트로 승격하지 않습니다.',
    inputSchema: DomesticIndexPeriodToolInputSchema, outputSchema: Kis072PeriodResultSchema, annotations,
  }, async input => safeResult(async () => {
    const q = checked(DomesticIndexPeriodToolInputSchema, input); gate();
    // No transport-option lookup or clock invocation, including synthetic host injections.
    return requestKis072Period(q);
  }));
  server.registerTool(NATIVE_PERIOD_MCP_NAMES[1], {
    title: 'KIS-264 글로벌 주·월·연 원시 이력',
    description: '기본 차단. 별도 호스트 전송이 주입되면 W/M/Y를 그대로 전달하는 고정 GET 한 번만 실행합니다. 원문 문자열·빈값·누락·중복·순서를 보존합니다. 요청 주기는 실제 주기·기간 경계·완전성·총수익을 증명하지 않습니다. 정규 값은 null이며 자동 연속조회·재집계·일별 변환이 없습니다.',
    inputSchema: GlobalIndexPeriodToolInputSchema, outputSchema: Kis264PeriodResultSchema, annotations,
  }, async input => safeResult(async () => {
    const q = checked(GlobalIndexPeriodToolInputSchema, input); gate();
    return requestKis264Period(q, ownOption(options, 'benchmarkPeriodTransport') as BenchmarkPeriodTransport | undefined, clock);
  }));
}

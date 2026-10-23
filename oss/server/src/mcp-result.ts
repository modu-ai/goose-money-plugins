import { BENCHMARK_PERIOD_ERROR_CODES } from './benchmark-period-inputs.js';
import { types } from 'node:util';
import { BENCHMARK_HISTORY_ERROR_CODES } from './benchmark-history-inputs.js';
import { REMAINING_SOURCE_ERRORS } from './remaining-source-inputs.js';
export const MCP_RESPONSE_MAX_BYTES = 300_000;
const SAFE_CODES = new Set<string>([...["no_data","ambiguous_product_response","rights_pending","source_not_enabled","credential_missing","request_contract_conflict","rate_limited","auth_expired","upstream_timeout","request_cancelled","upstream_unavailable","upstream_rejected","schema_drift","response_too_large","pagination_not_supported","pagination_limit_reached","empty_response","duplicate_provider_business_date","instrument_mismatch","invalid_input","invalid_response","invalid_provenance","response_mismatch","transport_error","transport_not_configured","history_context_mismatch","flow_context_mismatch","bar_context_mismatch","duplicate_bar"], ...BENCHMARK_HISTORY_ERROR_CODES, ...BENCHMARK_PERIOD_ERROR_CODES, ...REMAINING_SOURCE_ERRORS]);
/** Only own, bounded native-error messages from a finite vocabulary may leave the server. */
export function safeErrorCode(error: unknown): string {
  if (!types.isNativeError(error)) return 'upstream_unavailable';
  const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string' || descriptor.value.length > 128) return 'schema_drift';
  const code = descriptor.value.replace(/^error_code=/, '');
  return SAFE_CODES.has(code) ? code : 'schema_drift';
}
export async function safeResult(work: () => Promise<Record<string, unknown>>) {
  try {
    const valid = await work();
    const text = JSON.stringify(valid);
    if (Buffer.byteLength(text, 'utf8') > MCP_RESPONSE_MAX_BYTES) throw new Error('response_too_large');
    const result = { content: [{ type: 'text' as const, text }], structuredContent: valid };
    // Both representations count; reject, never truncate a result or drop raw rows.
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MCP_RESPONSE_MAX_BYTES) throw new Error('response_too_large');
    return result;
  } catch (error) { throw new Error(`error_code=${safeErrorCode(error)}`); }
}

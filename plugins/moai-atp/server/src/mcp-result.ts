import { BENCHMARK_PERIOD_ERROR_CODES } from './benchmark-period-inputs.js';
import { types } from 'node:util';
import { BENCHMARK_HISTORY_ERROR_CODES } from './benchmark-history-inputs.js';
import { REMAINING_SOURCE_ERRORS } from './remaining-source-inputs.js';
export const MCP_RESPONSE_MAX_BYTES = 300_000;
const SAFE_CODES = new Set<string>([...["report_out_of_scope","report_release_hold","report_not_applicable","narrative_invalid_reference","narrative_unbound_number","narrative_missing_citation","narrative_placeholder_mismatch","narrative_metric_unavailable","narrative_report_mismatch","no_data","ambiguous_product_response","rights_pending","source_not_enabled","credential_missing","credential_rejected","credential_environment_invalid","request_contract_conflict","rate_limited","auth_expired","upstream_timeout","request_cancelled","upstream_unavailable","upstream_rejected","schema_drift","response_too_large","pagination_not_supported","pagination_limit_reached","empty_response","duplicate_provider_business_date","instrument_mismatch","invalid_input","invalid_response","invalid_provenance","response_mismatch","transport_error","transport_not_configured","history_context_mismatch","flow_context_mismatch","bar_context_mismatch","duplicate_bar","comparison_subjects_invalid","comparison_source_subject_mismatch","comparison_source_unidentifiable","comparison_tool_not_supported","comparison_scope_unsupported","comparison_origin_mixed","issuer_mapping_conflict","comparison_narrative_not_supported"], ...BENCHMARK_HISTORY_ERROR_CODES, ...BENCHMARK_PERIOD_ERROR_CODES, ...REMAINING_SOURCE_ERRORS]);
/** Only own, bounded native-error messages from a finite vocabulary may leave the server. */
export function safeErrorCode(error: unknown): string {
  if (!types.isNativeError(error)) return 'upstream_unavailable';
  const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string' || descriptor.value.length > 128) return 'schema_drift';
  const code = descriptor.value.replace(/^error_code=/, '');
  return SAFE_CODES.has(code) ? code : 'schema_drift';
}
export async function safeResult(work: () => Promise<Record<string, unknown>>, options: {compactStructuredText?:boolean} = {}) {
  try {
    const valid = await work();
    const text = JSON.stringify(valid);
    if (Buffer.byteLength(text, 'utf8') > MCP_RESPONSE_MAX_BYTES) throw new Error('response_too_large');
    let result = { content: [{ type: 'text' as const, text }], structuredContent: valid };
    // Full structured data is retained; authorized large tools may avoid duplicate text JSON.
    if(options.compactStructuredText && Buffer.byteLength(JSON.stringify(result),'utf8')>MCP_RESPONSE_MAX_BYTES)result={content:[{type:'text' as const,text:'전체 결과는 structuredContent에 보존되어 있습니다. 원문 행을 생략하지 않았습니다.'}],structuredContent:valid};
    // Both representations count; reject, never truncate a result or drop raw rows.
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MCP_RESPONSE_MAX_BYTES) throw new Error('response_too_large');
    return result;
  } catch (error) { throw new Error(`error_code=${safeErrorCode(error)}`); }
}

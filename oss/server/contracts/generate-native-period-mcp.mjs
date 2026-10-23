import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { DomesticIndexPeriodToolInputSchema, GlobalIndexPeriodToolInputSchema, NATIVE_PERIOD_MCP_NAMES } from '../dist/src/native-period-mcp.js';
const tools = NATIVE_PERIOD_MCP_NAMES.map((name, i) => {
 const schema = z.toJSONSchema(i === 0 ? DomesticIndexPeriodToolInputSchema : GlobalIndexPeriodToolInputSchema, { target: 'draft-2020-12' });
 const file = `mcp-${name.replaceAll('_', '-')}.input.schema.json`;
 schema.$id = `https://moai.local/contracts/${file}`;
 schema.$comment = 'Structural schema only. Runtime checks exact chronology, date ordering, own-data snapshot boundaries and deny-default host gates. Requested W/M/Y is not actual-period evidence. Existing daily tool schemas remain unchanged.';
 writeFileSync(new URL(file, import.meta.url), JSON.stringify(schema, null, 2) + '\n');
 return { name, operation_ref: i === 0 ? 'KIS-072' : 'KIS-264', input_schema: `contracts/${file}`, read_only: true, default_denied: true, canonical_promotion: false,
  status: i === 0 ? 'hard_blocked_request_contract_conflict' : 'injected_host_transport_only', role_grants: i === 0 ? [] : ['market-behavior'] };
});
writeFileSync(new URL('native-period-mcp-tools-v1.json', import.meta.url), JSON.stringify({ contract: 'moai.native-period-mcp-registration.v1', total_registered_names: 34,
 default_policy: 'deny', request_periods: ['W', 'M', 'Y'], existing_daily_contracts_changed: false, source_feeds_added: 0,
 tool_result_payload_max_utf8_bytes: 300000, size_scope: 'complete_serialized_tool_result_excluding_outer_JSON_RPC_envelope',
 oversize_action: 'reject_without_truncation', production_transport_supplied: false, automatic_continuation: false, tools }, null, 2) + '\n');

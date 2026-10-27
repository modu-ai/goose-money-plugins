import {types} from 'node:util';
import {SafeKisError} from './kis-http.js';
type KisCode=SafeKisError['code'];
/** Every member of the `SafeKisError` code union (kis-http.ts); `satisfies` makes a missing or extra member a compile error. */
const KIS_CODES={request_contract_conflict:1,invalid_input:1,credential_missing:1,credential_rejected:1,credential_environment_invalid:1,auth_expired:1,rate_limited:1,upstream_timeout:1,request_cancelled:1,upstream_unavailable:1,upstream_rejected:1,schema_drift:1,response_too_large:1,pagination_not_supported:1,pagination_limit_reached:1,empty_response:1,duplicate_provider_business_date:1} satisfies Record<KisCode,1>;
/**
 * The server's own sanitized provider error caught around a KIS expanded-transport `send`, as a NEW `SafeKisError` that carries
 * only its code (SPEC-ATP-ERR-001 REQ-ERR-004), or undefined for anything else. The criterion is exactly: not a Proxy, a native
 * error, DIRECT prototype `SafeKisError.prototype`, and an own DATA property `message` that is a member of the code union.
 * It never runs an accessor or Proxy trap, never walks the prototype chain, never reads the error's other properties or text;
 * a throwing inspection means "not recognised".
 */
export function sanitizedKisError(error:unknown):SafeKisError|undefined {
 try{
  if(error===null||typeof error!=='object'||types.isProxy(error)||!types.isNativeError(error)||Object.getPrototypeOf(error)!==SafeKisError.prototype)return undefined;
  const d=Object.getOwnPropertyDescriptor(error,'message');
  return d&&'value'in d&&typeof d.value==='string'&&Object.hasOwn(KIS_CODES,d.value)?new SafeKisError(d.value as KisCode):undefined;
 }catch{return undefined;}
}

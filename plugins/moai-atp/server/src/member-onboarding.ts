export type ConnectionState = 'unchecked'|'connected'|'credential_missing'|'expired'|'permission_denied'|'network_error'|'quota_exceeded';
export type Provider = 'kis'|'opendart';
export interface Membership { readonly verified: true; readonly expires_at: number; readonly session_binding:string; }
export interface ConnectionCheck { readonly state: ConnectionState; readonly checked_at: number; }
/** Disconnected local contract. No login endpoint, tokens, persistence, telemetry or MCP registration.
 * The host must supply an actual membership verifier and separately approved provider loaders.
 * A caller's JSON flag is not a verified membership. Real server no-retention needs independent proof.
 */
export function createMemberOnboarding(options: {
 verifyMembership?: () => Promise<Membership|undefined>;
 checkProvider?: (provider: Provider) => Promise<ConnectionState>;
 now?: () => number;
 maxCheckAgeMs?: number;
} = {}) {
 const now=options.now??Date.now;
 const maxAge=options.maxCheckAgeMs??300000;
 if(!Number.isFinite(maxAge)||maxAge<=0)throw Error('invalid_check_age');
 const checks:Partial<Record<Provider,ConnectionCheck>>={};
 let epoch=0;
 let activeBinding:string|undefined;
 const states:ConnectionState[]=['unchecked','connected','credential_missing','expired','permission_denied','network_error','quota_exceeded'];
 async function authenticated(){
  try { const v=await options.verifyMembership?.();if(v?.verified!==true||!Number.isFinite(v.expires_at)||v.expires_at<=now()||typeof v.session_binding!=='string'||v.session_binding.length<1||v.session_binding.length>256)return false;
   if(activeBinding!==v.session_binding){reset();activeBinding=v.session_binding;}return true; }
  catch {return false;}
 }
 function reset(){epoch++;activeBinding=undefined;delete checks.kis;delete checks.opendart;}
 async function status(){
  if(!await authenticated()){reset();return {step:'login_required' as const,ready:false,session_binding:null,providers:{kis:'unchecked' as ConnectionState,opendart:'unchecked' as ConnectionState}};}
  const get=(p:Provider):ConnectionState=>{const c=checks[p];return c&&c.checked_at<=now()&&now()-c.checked_at<maxAge?c.state:'unchecked';};
  const providers={kis:get('kis'),opendart:get('opendart')};
  const ready=providers.kis==='connected'&&providers.opendart==='connected';
  return {step:ready?'ready' as const:'provider_checks_required' as const,ready,session_binding:activeBinding!,providers};
 }
 async function check(provider:Provider){
  if(provider!=='kis'&&provider!=='opendart')throw Error('invalid_provider');
  if(!await authenticated()){reset();throw Error('member_login_required');}
  if(!options.checkProvider)throw Error('provider_checker_not_connected');
  const started=epoch;
  let state:ConnectionState;
  try {state=await options.checkProvider(provider);if(!states.includes(state))state='network_error';}
  catch {state='network_error';}
  if(started!==epoch||!await authenticated()){reset();throw Error('member_login_required');}
  checks[provider]={state,checked_at:now()};
  return status();
 }
 async function run<T>(action:()=>Promise<T>){const s=await status();if(!s.ready)throw Error(s.step);return action();}
 return {status,check,run,reset,contract:'moai.goose.member-onboarding.v1' as const,connected:false as const,server_retention_verified:false as const};
}

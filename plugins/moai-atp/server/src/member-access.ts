// Status (issue #10): kept for reuse, not wired; sign-in is decided for every tier (#1) but not implemented.
// Design: docs/design/identity-auth-contract.md. This gate is not reusable as-is: requireReady demands both KIS and OpenDART
// connected, while the contract checks only the provider a request needs, so identity and provider checks must be split first.
import type {McpServer} from '@modelcontextprotocol/server';
import {createMemberOnboarding} from './member-onboarding.js';
export type MemberAccess = Pick<ReturnType<typeof createMemberOnboarding>,'status'>;
/** Apply before any registration: all tool callbacks and resource readers share the gate.
 * Only a trusted host can inject the verifier; request JSON/environment flags cannot authorize it.
 * Discovery remains available so a disconnected host can identify the package.
 */
export function installMemberAccess(server:McpServer,access:MemberAccess=createMemberOnboarding()):void {
 let boundSession:string|undefined;
 async function requireReady(){
  let s:Awaited<ReturnType<MemberAccess['status']>>;
  try{s=await access.status();}catch{throw Error('error_code=member_login_required');}
  if(s.step==='login_required')throw Error('error_code=member_login_required');
  if(typeof s.session_binding!=='string'||!s.session_binding)throw Error('error_code=member_login_required');
  if(s.step!=='ready'||s.ready!==true||s.providers.kis!=='connected'||s.providers.opendart!=='connected')throw Error('error_code=provider_checks_required');
  // A process holding reports belongs to one verified session. Reconnect a new server after renewal/change.
  if(boundSession!==undefined&&boundSession!==s.session_binding)throw Error('error_code=member_session_changed');
  boundSession=s.session_binding;
 }
 const tool=server.registerTool.bind(server);
 server.registerTool=((...args:unknown[])=>{
  const callback=args.at(-1);
  if(typeof callback!=='function')throw Error('invalid_tool_registration');
  args[args.length-1]=async(...values:unknown[])=>{await requireReady();return callback(...values);};
  return Reflect.apply(tool,server,args);
 }) as typeof server.registerTool;
 const resource=server.registerResource.bind(server);
 server.registerResource=((...args:unknown[])=>{
  const callback=args.at(-1);
  if(typeof callback!=='function')throw Error('invalid_resource_registration');
  args[args.length-1]=async(...values:unknown[])=>{await requireReady();return callback(...values);};
  return Reflect.apply(resource,server,args);
 }) as typeof server.registerResource;
}

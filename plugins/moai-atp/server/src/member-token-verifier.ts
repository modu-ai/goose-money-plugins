// Status (issue #10): kept for reuse, not wired; sign-in is decided for every tier (#1) but not implemented.
// Design: docs/design/identity-auth-contract.md. Header, claims, the 900 s lifetime and fail-closed revocation match the draft;
// every contract decision A-01..A-09 is still open (topology, issuer, audience, client, scopes, token format, refresh, JWKS cache time (A-08), revocation).
import {createHash,randomBytes,verify as verifySignature,type KeyObject} from 'node:crypto';
import {z} from 'zod';
import type {Membership} from './member-onboarding.js';
const headerSchema=z.object({alg:z.literal('ES256'),typ:z.literal('at+jwt'),kid:z.string().min(1).max(128)}).strict();
const claimsSchema=z.object({iss:z.string().max(2048),sub:z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),aud:z.string().max(2048),exp:z.number().int().positive(),iat:z.number().int().positive(),nbf:z.number().int().positive().optional(),jti:z.string().min(1).max(256),scope:z.string().min(1).max(2048),client_id:z.string().min(1).max(2048)}).strict();
type Options={issuer?:string;audience?:string;clientId?:string;requiredScopes?:readonly string[];resolveKey?:(kid:string)=>Promise<KeyObject|undefined>;revocationState?:(jti:string)=>Promise<'active'|'revoked'|'unknown'>;now?:()=>number};
type Denial='not_configured'|'invalid_token'|'issuer_mismatch'|'audience_mismatch'|'client_mismatch'|'scope_denied'|'expired'|'invalid_time'|'invalid_signature'|'revoked'|'revocation_unconfirmed';
type Result={state:'verified';membership:Membership}|{state:'denied';reason:Denial};
function https(value:string|undefined){try{const u=new URL(value??'');return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}}
function decode(part:string,max:number){if(!/^[A-Za-z0-9_-]+$/.test(part))throw Error('invalid_token');const bytes=Buffer.from(part,'base64url');if(bytes.length>max||bytes.toString('base64url')!==part)throw Error('invalid_token');return bytes;}
/** Source-contract skeleton: no URLs are fetched, no token/identity is persisted or logged.
 * No ATP resource/scope/client defaults exist; the existing admin registry cannot authorize ATP.
 * Trusted caller supplies MCP keys (not browser OIDC keys) and current revocation evidence.
 */
export function createLocalMemberTokenVerifier(options:Options={}){
 const salt=randomBytes(32);
 const deny=(reason:Denial):Result=>({state:'denied',reason});
 const scopes=options.requiredScopes;
 const configured=https(options.issuer)&&https(options.audience)&&new URL(options.audience!).hostname!=='mcp-admin.mo.ai.kr'&&typeof options.clientId==='string'&&options.clientId.length>0&&options.clientId.length<=2048&&scopes!==undefined&&scopes.length>0&&scopes.every(s=>/^[A-Za-z0-9:_-]+$/.test(s)&&!s.startsWith('admin:'))&&options.resolveKey!==undefined;
 return {network_connected:false as const,token_storage:'none' as const,async verify(token:unknown):Promise<Result>{
  if(!configured)return deny('not_configured');
  try{
   if(typeof token!=='string'||Buffer.byteLength(token)>16384)return deny('invalid_token');
   const parts=token.split('.');if(parts.length!==3)return deny('invalid_token');
   const head=headerSchema.parse(JSON.parse(decode(parts[0]!,1024).toString('utf8')));
   const c=claimsSchema.parse(JSON.parse(decode(parts[1]!,8192).toString('utf8')));
   const sig=decode(parts[2]!,64);if(sig.length!==64)return deny('invalid_signature');
   if(c.iss!==options.issuer)return deny('issuer_mismatch');if(c.aud!==options.audience)return deny('audience_mismatch');if(c.client_id!==options.clientId)return deny('client_mismatch');
   const actual=c.scope.split(' ');if(actual.some(s=>!s||s.startsWith('admin:')||s.includes('*'))||!scopes!.every(s=>actual.includes(s)))return deny('scope_denied');
   const now=Math.floor((options.now??Date.now)()/1000);if(!Number.isSafeInteger(now))return deny('invalid_time');
   if(c.exp<=now)return deny('expired');if(c.iat>now+30||c.exp<=c.iat||c.exp-c.iat>900||(c.nbf!==undefined&&(c.nbf>now+30||c.nbf>=c.exp)))return deny('invalid_time');
   let key=await options.resolveKey!(head.kid);if(!key)key=await options.resolveKey!(head.kid);
   if(!key||key.type!=='public'||key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1'||!verifySignature('sha256',Buffer.from(parts[0]+'.'+parts[1]),{key,dsaEncoding:'ieee-p1363'},sig))return deny('invalid_signature');
   if(!options.revocationState)return deny('revocation_unconfirmed');
   const active=await options.revocationState(c.jti);if(active==='revoked')return deny('revoked');if(active!=='active')return deny('revocation_unconfirmed');
   return {state:'verified',membership:{verified:true,expires_at:c.exp*1000,session_binding:createHash('sha256').update(salt).update(JSON.stringify([c.iss,c.sub,c.client_id,c.jti])).digest('hex')}};
  }catch{return deny('invalid_token');}
 }};
}

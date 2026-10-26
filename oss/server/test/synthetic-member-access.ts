import {createStockMcpServer as stock,type ServerOptions} from '../src/server.js';
import {createCredentialBackedServer as credential} from '../src/credential-runtime.js';
export type {ServerOptions} from '../src/server.js';
export {createCredentialProvider,localReadSwitches} from '../src/credential-runtime.js';
/** Explicit test-only host stub, never imported by production or bundled. No real login proof. */
export const syntheticMemberAccess={status:async()=>({step:'ready' as const,ready:true,session_binding:'synthetic-test-session',providers:{kis:'connected' as const,opendart:'connected' as const}})};
export const createStockMcpServer=(options:ServerOptions={})=>stock(withSyntheticAccess(options));
export const createCredentialBackedServer=(options:Parameters<typeof credential>[0]={})=>credential(withSyntheticAccess(options));

function withSyntheticAccess<T extends object>(options:T):T&{memberAccess:typeof syntheticMemberAccess}{const descriptors=Object.getOwnPropertyDescriptors(options);return Object.create(Object.getPrototypeOf(options),{...descriptors,memberAccess:{value:syntheticMemberAccess,enumerable:true,configurable:true,writable:true}});}

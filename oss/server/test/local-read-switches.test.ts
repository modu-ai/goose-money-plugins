import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {localReadSwitches,createCredentialBackedServer} from './synthetic-member-access.js';
test('local read switches are explicit, independently disabled and never redistribution authority',()=>{
 assert.deepEqual(localReadSwitches({}),{kis:false,opendart:false,local_view:false});assert.deepEqual(localReadSwitches({GOOSE_KIS_READ_ENABLED:'1',GOOSE_OPENDART_READ_ENABLED:'0'}),{kis:true,opendart:false,local_view:false});
 assert.throws(()=>localReadSwitches({GOOSE_KIS_READ_ENABLED:'true'}),/invalid_input/);
});
test('enabled local KIS without credentials reports missing rather than rights_pending and never fetches',async()=>{
 const home=await mkdtemp(join(tmpdir(),'atp-read-switch-'));
 let calls=0;const f:typeof fetch=async()=>{calls++;throw new Error('unexpected');};
 const server=createCredentialBackedServer({rightsEnabled:localReadSwitches({GOOSE_KIS_READ_ENABLED:'1'}).kis,env:{},homeDir:home,fetchImpl:f});
 const tool=(server as any)._registeredTools.get_instrument_profile;
 await assert.rejects(tool.handler({symbol:'000660'},{}),/credential_missing/);assert.equal(calls,0);await server.close();await rm(home,{recursive:true});
});

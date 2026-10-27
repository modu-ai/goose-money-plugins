// SPEC-ATP-AUTH-001 M3 (card t13): the default server no longer installs a member gate, so this
// test-only module is a plain re-export. It stays so the 17 dependent test files keep their
// imports unchanged; a test that goes through it now exercises the stub-free default server.
export {createStockMcpServer,type ServerOptions} from '../src/server.js';
export {createCredentialBackedServer,createCredentialProvider,localReadSwitches} from '../src/credential-runtime.js';

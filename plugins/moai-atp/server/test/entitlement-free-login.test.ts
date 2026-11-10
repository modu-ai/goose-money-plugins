// Design #6 §5 N19 + §1 "무료도 모두의 AI 로그인 필수(#5)" (Refs #31, docs/design/identity-auth-contract.md):
// free features R01·R07 still require sign-in. The gate must deny an unauthenticated caller
// before any provider transport runs (the SEC transport here throws if reached), the evaluator
// must deny both free features for an unauthenticated profile, and sign-in restores them.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStockMcpServer, type ServerOptions } from '../src/server.js';
import { openSession, outcome } from './default-server-harness.js';
import { createServiceEntitlementEvaluator } from '../src/entitlement.js';

const now = 1794268800;
const cutoff = '2026-11-10T05:20:00.000Z';
const member = () => ({identity:{verified:true}, membership:{service_id:'stock',state:'joined'}, subscription:null, learner_grant:null});
const reportArgs = (report_id = 'R01') => ({report_id, subject:{id:'KRX:000660',name:'합성 종목',venue:'KRX',currency:'KRW'},cutoff,display_timezone:'Asia/Seoul',calls:[]});
const policy = (state:()=>unknown): NonNullable<ServerOptions['entitlement']> => ({enabled:true,serviceId:'stock',state,now:()=>now,toolFeatures:{get_market_snapshot:'R01',get_fundamentals:'R02',get_sec_submissions:'R07'}});
async function session(options:ServerOptions, work:(s:Awaited<ReturnType<typeof openSession>>)=>Promise<void>) {
 const s=await openSession(createStockMcpServer({clock:()=>cutoff,...options}));
 try { await work(s); } finally { await s.close(); }
}

test('unauthenticated callers are denied the free features R01 and R07 before any transport (N19)',async()=>{
 let state:unknown=member();
 let calls=0;
 await session({entitlement:policy(()=>state),secEnabled:true,secTransport:{origin:'synthetic',send:async()=>{calls++;throw new Error('must not run');}}},async s=>{
  state={...member(),identity:{verified:false}};
  assert.equal(outcome(await s.rpc('tools/call',{name:'get_market_snapshot',arguments:{symbol:'000660',board:'J'}})),'auth_required');
  assert.equal(outcome(await s.rpc('tools/call',{name:'get_sec_submissions',arguments:{cik:'0000320193'}})),'auth_required');
  assert.equal(calls,0,'a provider transport ran before the gate denied');
  // free with sign-in: the identical catalogue serves R01 locally with no provider setup
  state=member();
  assert.equal(outcome(await s.rpc('tools/call',{name:'build_report_input',arguments:reportArgs('R01')})),'OK');
 });
});

test('evaluator denies R07 without sign-in exactly like R01 (N19 unit layer)',()=>{
 const v=createServiceEntitlementEvaluator({serviceId:'stock',now:()=>now});
 const unauthenticated={...member(),identity:{verified:false}};
 for(const feature of ['R01','R07'])assert.deepEqual(v.evaluate({...unauthenticated,feature}),{decision:'deny',reason:'auth_required'});
 for(const feature of ['R01','R07'])assert.deepEqual(v.evaluate({...member(),feature}),{decision:'allow',tier:'free'});
});

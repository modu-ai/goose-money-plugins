import test from 'node:test';import assert from 'node:assert/strict';
import {JOB_STATES,TERMINAL_STATES,createDurableJob,apply,checkBudget,canStartNode,acceptsNodeResults,type JobRecord} from '../src/durable-job.js';
// Durable job state machine core (Refs #106, design docs/design/durable-job-and-stock-link.md §2·4·6, Refs #29).
// Pure logic only: no persistence, job keys or retry execution (later slices). Budget limits are injected
// configuration; undecided values (J-01·J-02·J-03) are never invented. Permission recheck (#7/J-06) is a
// caller-observed argument, never a call this module makes.
const running=():JobRecord=>{let j=createDurableJob();j=apply(j,{event:'start',permission_recheck:'passed'});j=apply(j,{event:'node_completed',node_result_hash:'node-1-hash'});return j;};
const cancelled=():JobRecord=>apply(apply(running(),{event:'cancel_requested'}),{event:'worker_end_observed'});

test('seven published states exist and four are terminal (design §2.1)',()=>{
  assert.deepEqual([...JOB_STATES],['queued','running','blocked','partial','failed','cancelled','completed']);
  assert.deepEqual([...TERMINAL_STATES],['partial','failed','cancelled','completed']);
});

test('queued starts only on a passed permission recheck; failed recheck lands blocked (§2.2)',()=>{
  assert.equal(apply(createDurableJob(),{event:'start',permission_recheck:'passed'}).state,'running');
  const b=apply(createDurableJob(),{event:'start',permission_recheck:'failed'});
  assert.equal(b.state,'blocked');assert.equal(b.blocked_reason,'permission_revoked');
});

test('illegal transitions are refused with a coded error (§2.2)',()=>{
  assert.throws(()=>apply(createDurableJob(),{event:'complete'}),/error_code=illegal_transition/);
  assert.throws(()=>apply(createDurableJob(),{event:'worker_end_observed'}),/error_code=illegal_transition/);
  assert.throws(()=>apply(running(),{event:'unblock',permission_recheck:'passed'}),/error_code=illegal_transition/);
  assert.throws(()=>apply(cancelled(),{event:'cancel_requested'}),/error_code=illegal_transition/);
  assert.throws(()=>apply(running(),{event:'budget_exhausted',outcome:'nope' as never}),/error_code=invalid_input/);
  assert.throws(()=>apply(running(),{event:' 이상한이벤트'}),/error_code=invalid_input/);
});

test('node completion stays running and records the node result hash (§2.2 running+node_completed)',()=>{
  const j=running();
  assert.equal(j.state,'running');
  assert.deepEqual(j.node_result_hashes,['node-1-hash']);
});

test('blocked waits on a reason code and resumes only through a passed recheck (§2.2)',()=>{
  const b=apply(running(),{event:'blocked',reason:'provider_key_missing'});
  assert.equal(b.state,'blocked');assert.equal(b.blocked_reason,'provider_key_missing');
  assert.equal(apply(b,{event:'unblock',permission_recheck:'passed'}).state,'running');
  const still=apply(b,{event:'unblock',permission_recheck:'failed'});
  assert.equal(still.state,'blocked');
  // A failed recheck is not necessarily a revocation (the key may still be missing): the original
  // reason stays — the design is silent on recheck-failure codes, so nothing is invented and no
  // reason information is lost.
  assert.equal(still.blocked_reason,'provider_key_missing');
});

test('running closes as completed, partial (missing_data) or failed (failure_code) (§2.2)',()=>{
  assert.equal(apply(running(),{event:'complete'}).state,'completed');
  const p=apply(running(),{event:'partial',missing_data:['provider_bridge_contract']});
  assert.equal(p.state,'partial');assert.deepEqual(p.missing_data,['provider_bridge_contract']);
  const f=apply(running(),{event:'fail',failure_code:'upstream_rejected'});
  assert.equal(f.state,'failed');assert.equal(f.failure_code,'upstream_rejected');
});

test('permission revocation lands blocked from every non-terminal live state (§2.2 last row)',()=>{
  for(const j of [createDurableJob(),running(),apply(running(),{event:'blocked',reason:'provider_key_missing'})]){
    const b=apply(j,{event:'permission_revoked'});
    assert.equal(b.state,'blocked');assert.equal(b.blocked_reason,'permission_revoked');
  }
  assert.throws(()=>apply(cancelled(),{event:'permission_revoked'}),/error_code=illegal_transition/);
});

test('M1: revocation while cancelling is recorded without abandoning the cancel procedure (§2.2 "어느 상태든" + §4)',()=>{
  const c=apply(running(),{event:'cancel_requested'});
  const r=apply(c,{event:'permission_revoked'});
  assert.equal(r.state,'cancelling');assert.equal(r.permission_revoked,true);
  // The cancel procedure continues: cancelled still requires the worker end observation (§4).
  assert.equal(apply(r,{event:'worker_end_observed'}).state,'cancelled');
});

test('cancel request from queued, running or blocked turns cancelling and stops new node starts (§4)',()=>{
  for(const j of [createDurableJob(),running(),apply(running(),{event:'blocked',reason:'provider_key_missing'})]){
    assert.equal(apply(j,{event:'cancel_requested'}).state,'cancelling');
  }
  const c=apply(running(),{event:'cancel_requested'});
  assert.equal(canStartNode(c),false);assert.equal(canStartNode(running()),true);
  assert.throws(()=>apply(cancelled(),{event:'worker_end_observed'}),/error_code=illegal_transition/);
});

test('T3: cancelled only after the worker end is observed, never on the request alone',()=>{
  const c=apply(running(),{event:'cancel_requested'});
  assert.equal(c.state,'cancelling');
  assert.equal(apply(c,{event:'worker_end_observed'}).state,'cancelled');
});

test('T3b: timeout without observation stays cancelling and records cancel_unconfirmed (§4)',()=>{
  const t=apply(apply(running(),{event:'cancel_requested'}),{event:'cancel_timeout_reached'});
  assert.equal(t.state,'cancelling');
  assert.equal(t.cancel_unconfirmed,true);
  assert.equal(apply(t,{event:'worker_end_observed'}).state,'cancelled');
});

test('L1: cancel straight after intake walks queued→cancelling→cancelled (§2.2·§4)',()=>{
  const c=apply(createDurableJob(),{event:'cancel_requested'});
  assert.equal(c.state,'cancelling');
  assert.equal(apply(c,{event:'worker_end_observed'}).state,'cancelled');
});

test('T4: late results after a cancel are discarded with a record (§4 "버리고 기록만")',()=>{
  assert.equal(acceptsNodeResults(apply(running(),{event:'cancel_requested'})),false);
  assert.equal(acceptsNodeResults(cancelled()),false);
  assert.equal(acceptsNodeResults(running()),true);
  const c=apply(running(),{event:'cancel_requested'});
  const d1=apply(c,{event:'node_completed',node_result_hash:'late-1'});
  assert.equal(d1.state,'cancelling');
  assert.equal(d1.discarded_late_results,1);
  // The discarded hash never mixes into the accepted node results.
  assert.deepEqual(d1.node_result_hashes,['node-1-hash']);
  const d2=apply(apply(d1,{event:'worker_end_observed'}),{event:'node_completed',node_result_hash:'late-2'});
  assert.equal(d2.state,'cancelled');
  assert.equal(d2.discarded_late_results,2);
});

test('budget limits are injected configuration; unset budget never invents a verdict',()=>{
  const v=checkBudget({}, {elapsed_ms:10**9,provider_calls:10**9});
  assert.deepEqual(v,{ok:true,note:'no_budget_configured'});
});

test('T9: exhausted budget denies with budget_exhausted and the caller closes the job with that reason',()=>{
  const v=checkBudget({max_provider_calls:10,max_elapsed_ms:60_000},{elapsed_ms:61_000,provider_calls:10});
  assert.equal(v.ok,false);
  assert.ok(v.ok===false&&v.reason==='budget_exhausted');
  assert.ok(v.ok===false&&JSON.stringify(v.exhausted)==='["max_elapsed_ms","max_provider_calls"]');
  const within=checkBudget({max_provider_calls:10},{elapsed_ms:5,provider_calls:9});
  assert.deepEqual(within,{ok:true});
  const p=apply(running(),{event:'budget_exhausted',outcome:'partial'});
  assert.equal(p.state,'partial');assert.equal(p.budget_exhausted,true);assert.equal(p.budget_outcome,'partial');
  const f=apply(running(),{event:'budget_exhausted',outcome:'failed'});
  assert.equal(f.state,'failed');assert.equal(f.budget_outcome,'failed');
});

test('budget and spent values are validated; negatives and junk are invalid_input',()=>{
  assert.throws(()=>checkBudget({max_provider_calls:-1},{elapsed_ms:0,provider_calls:0}),/error_code=invalid_input/);
  assert.throws(()=>checkBudget({max_provider_calls:5},{elapsed_ms:-1,provider_calls:0}),/error_code=invalid_input/);
  assert.throws(()=>checkBudget({max_provider_calls:5},{elapsed_ms:1}),/error_code=invalid_input/);
});

test('L2: a zero limit is exhausted immediately (§6 reaching a limit counts as exhausted)',()=>{
  const t=checkBudget({max_elapsed_ms:0},{elapsed_ms:0,provider_calls:0});
  assert.equal(t.ok,false);assert.ok(t.ok===false&&JSON.stringify(t.exhausted)==='["max_elapsed_ms"]');
  const c=checkBudget({max_provider_calls:0},{elapsed_ms:0,provider_calls:0});
  assert.equal(c.ok,false);assert.ok(c.ok===false&&JSON.stringify(c.exhausted)==='["max_provider_calls"]');
});

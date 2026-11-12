import assert from 'node:assert/strict';
import test from 'node:test';
import fixture from './fixtures/kis115_investor_flow_synthetic.json' with {type:'json'};
import {parseKis115InvestorFlowResponse} from '../src/r01-kis-field-parsers.js';
import {FlowInputSchema,FlowResultSchema,buildFlowResult} from '../src/flow-contract.js';

const input={symbol:'000660',board:'J',input_date:'2026-10-20'};
const rows=()=>parseKis115InvestorFlowResponse(fixture.response,{requestedInputDate:'20261020',receivedAt:'2026-10-21T01:00:00Z',origin:'synthetic_fixture'});
const result=()=>({operation_ref:'KIS-115' as const,requested_input_date:'20261020',page_count:1,response_chain_status:'terminal_page_observed_total_count_unknown' as const,source_as_of:null,canonical_projection_status:'blocked' as const,rows:rows()});

test('flow projects three fixture actors per row with blocked status and exact million-KRW scaling',()=>{const r=buildFlowResult(input,result());
  assert.equal(r.contract,'moai.stock.market-flows.v1');assert.equal(r.operation_id,'KIS-115');
  assert.equal(r.origin,'synthetic');assert.equal(r.request_status,'blocked_official_parameter_conflict');
  assert.equal(r.rights_status,'pending');assert.equal(r.source_as_of,null);assert.equal(r.canonical_projection_status,'blocked');
  assert.equal(r.page_count,1);assert.equal(r.candidates.length,3);
  const byActor=Object.fromEntries(r.candidates.map(c=>[c.actor,c]));
  assert.equal(byActor.foreign!.quantity,'100');assert.equal(byActor.foreign!.amount,'12345600');
  assert.equal(byActor.individual!.quantity,'-200');assert.equal(byActor.individual!.amount,'-1');
  assert.equal(byActor.institution!.quantity,'100');assert.equal(byActor.institution!.amount,'0');
  assert.equal(byActor.foreign!.source_ref,'KIS-115:000660:2026-10-20:foreign');
  assert.ok(r.warnings.some(w=>w.includes('Synthetic fixture candidates only')));
  assert.ok(r.warnings.some(w=>w.includes('million-KRW scaling')));
  assert.equal(FlowResultSchema.safeParse(r).success,true);});

test('flow input defaults board to J, keeps NX, and rejects bad symbol/board/date/extra keys',()=>{
  assert.equal(buildFlowResult({symbol:'000660',input_date:'2026-10-20'},result()).board,'J');
  assert.equal(buildFlowResult({...input,board:'NX'},result()).board,'NX');
  for(const bad of [{...input,symbol:'00660'},{...input,board:'X'},{...input,input_date:'2026-02-30'},{...input,input_date:'2026-10-2'},{...input,input_date:'20261020'},{...input,url:'https://example.com'}])
    assert.equal(FlowInputSchema.safeParse(bad).success,false);});

test('flow refuses empty responses and mixed or mismatched fixture contexts',()=>{
  assert.throws(()=>buildFlowResult(input,{...result(),rows:[]}),/empty_response/);
  const originRows=rows();originRows[0]!.observed_payload_origin='provider_payload';
  assert.throws(()=>buildFlowResult(input,{...result(),rows:originRows}),/flow_context_mismatch/);
  const dateRows=rows();dateRows[0]!.requested_input_date='20261021';
  assert.throws(()=>buildFlowResult(input,{...result(),rows:dateRows}),/flow_context_mismatch/);
  const mixed=rows();mixed.push({...rows()[0]!,received_at:'2026-10-21T02:00:00Z'});
  assert.throws(()=>buildFlowResult(input,{...result(),rows:mixed}),/flow_context_mismatch/);});

test('flow candidates keep state/value presence coupled and page bounds enforced',()=>{
  const broken=rows();broken[0]!.actor_flows.foreign.net_buy_quantity.state='present';broken[0]!.actor_flows.foreign.net_buy_quantity.value_shares=null;
  assert.throws(()=>buildFlowResult(input,{...result(),rows:broken}),(error:unknown)=>{const issues=(error as {issues?:unknown[]}).issues;return Array.isArray(issues)&&issues.some(i=>(i as {message?:unknown}).message==='flow_presence_mismatch');});
  assert.throws(()=>buildFlowResult(input,{...result(),page_count:11}));});

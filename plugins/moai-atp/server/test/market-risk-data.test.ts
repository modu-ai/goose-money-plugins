import test from 'node:test';import assert from 'node:assert/strict';
import {MarketRiskResultSchema,requestMarketRisk,type MarketRiskTransport,type MarketRiskRequest} from '../src/market-risk-data.js';
const at='2026-10-22T00:00:00Z';const credit={symbol:'000660',settlement_date:'2026-10-21'};const range={symbol:'000660',start_date:'2026-10-19',end_date:'2026-10-21'};
function mock(body:unknown,tr_cont:string|null=null){const requests:MarketRiskRequest[]=[];const transport:MarketRiskTransport={origin:'synthetic',async send(r){requests.push(r);return {status:200,tr_cont,body};}};return {transport,requests};}
test('credit fixed one-page request maps exact documented share units only',async()=>{
 const m=mock({rt_cd:'0',output:[{deal_date:'20261019',stlm_date:'20261021',whol_loan_new_stcn:'900719925474099312345',whol_loan_rdmp_stcn:'00012',whol_loan_new_amt:'999',whol_stln_new_stcn:''}]},'M');
 const r=await requestMarketRisk('credit',credit,m.transport,()=>at);assert.equal(m.requests.length,1);assert.equal(m.requests[0]?.tr_id,'FHPST04760000');assert.equal(m.requests[0]?.query.FID_COND_SCR_DIV_CODE,'20476');
 assert.equal(r.rows[0]?.unit_verified_quantities.whol_loan_new_stcn?.value,'900719925474099312345');assert.equal(r.rows[0]?.unit_verified_quantities.whol_loan_rdmp_stcn?.value,'12');assert.equal(r.rows[0]?.unit_verified_quantities.whol_stln_new_stcn?.state,'blank');assert.equal(r.rows[0]?.raw_fields.whol_loan_new_amt?.raw_value,'999');assert.equal(r.has_more,true);assert.equal(r.source_as_of,null);assert.equal(r.rows[0]?.date_basis.trade_date,'2026-10-19');assert.equal(r.rows[0]?.date_basis.settlement_date,'2026-10-21');
});
test('lending uses symbol query class3, keeps balance change unresolved, post-response receipt',async()=>{
 let now=at;const m=mock({rt_cd:'0',output1:[{bsop_date:'20261020',new_stcn:'4',rdmp_stcn:'2',rmnd_stcn:'20',prdy_rmnd_vrss:'-2',rmnd_amt:'100'}]});const send=m.transport.send.bind(m.transport);m.transport.send=async r=>{await Promise.resolve();now='2026-10-22T00:02:00Z';return send(r);};
 const r=await requestMarketRisk('lending',range,m.transport,()=>now);assert.equal(m.requests[0]?.query.MRKT_DIV_CLS_CODE,'3');assert.equal(r.received_at,now);assert.equal(r.rows[0]?.unit_verified_quantities.rmnd_stcn?.value,'20');assert.equal(r.rows[0]?.unit_verified_quantities.prdy_rmnd_vrss,undefined);assert.equal(r.instrument_association,'request_filter_only');
});
test('short sale preserves both roots and blocks unverified quantity/amount/ratio mapping',async()=>{
 const r=await requestMarketRisk('short_sale',range,mock({rt_cd:'0',output1:{stck_bsop_date:'20261020'},output2:[{stck_bsop_date:'20261020',ssts_cntg_qty:'200',ssts_vol_rlim:'1.5'}]}).transport,()=>at);assert.equal(r.rows.length,2);assert.deepEqual(r.rows[1]?.unit_verified_quantities,{});assert.equal(r.canonical_projection_status,'blocked');
});
test('invalid quantity domains withheld rather than changed to zero',async()=>{
 const r=await requestMarketRisk('credit',credit,mock({rt_cd:'0',output:[{whol_loan_new_stcn:'-1',whol_loan_rdmp_stcn:'1.5',whol_loan_rmnd_stcn:null}]}).transport,()=>at);assert.equal(r.rows[0]?.unit_verified_quantities.whol_loan_new_stcn?.value,null);assert.equal(r.rows[0]?.unit_verified_quantities.whol_loan_new_stcn?.state,'invalid_provider_domain');assert.equal(r.rows[0]?.unit_verified_quantities.whol_loan_rmnd_stcn?.state,'provider_null');
});
test('invalid inputs, unknown arguments and inverted/impossible dates never dispatch',async()=>{
 const m=mock({});for(const input of [{...credit,settlement_date:'2026-02-30'},{...credit,api_key:'x'},{...credit,symbol:'../../x'}])await assert.rejects(requestMarketRisk('credit',input,m.transport));await assert.rejects(requestMarketRisk('lending',{...range,end_date:'2026-10-18'},m.transport));assert.equal(m.requests.length,0);
});
test('response identity mismatch, date range drift and duplicates fail closed',async()=>{
 for(const rows of [[{bsop_date:'20261020',mksc_shrn_iscd:'005930'}],[{bsop_date:'20261022'}],[{bsop_date:'20260230'}],[{bsop_date:'20261020'},{bsop_date:'20261020'}]])await assert.rejects(requestMarketRisk('lending',range,mock({rt_cd:'0',output1:rows}).transport,()=>at));
});
test('response failures and size/schema bounds do not return provider error bodies',async()=>{
 await assert.rejects(requestMarketRisk('credit',credit,mock({rt_cd:'9',msg1:'private upstream'}).transport,()=>at),/upstream_rejected/);await assert.rejects(requestMarketRisk('credit',credit,mock({rt_cd:'0',output:Array.from({length:31},()=>({}))}).transport,()=>at));await assert.rejects(requestMarketRisk('lending',range,mock({rt_cd:'0',output1:[{new_stcn:'1'.repeat(300001)}]}).transport,()=>at),/response_too_large/);
});
test('typed risk contract rejects altered units, lineage, raw state, dates and projection status',async()=>{
 const result=await requestMarketRisk('lending',range,mock({rt_cd:'0',output1:[{bsop_date:'20261020',new_stcn:'10'}]}).transport,()=>at);
 for(const mutate of [(x:any)=>x.rows[0].unit_verified_quantities.new_stcn.value='20',(x:any)=>x.rows[0].unit_verified_quantities.new_stcn.unit='KRW',(x:any)=>x.rows[0].raw_fields.new_stcn.state='missing',(x:any)=>x.rows[0].date_basis.business_date='2026-10-19',(x:any)=>x.canonical_projection_status='blocked',(x:any)=>x.rows[0].raw_fields.bsop_date.raw_value='20260230']){const x=structuredClone(result);mutate(x);assert.equal(MarketRiskResultSchema.safeParse(x).success,false);}
});
test('credit settlement chronology, query cutoff and duplicate dates are enforced',async()=>{
 for(const output of [[{deal_date:'20261022',stlm_date:'20261021'}],[{deal_date:'20261020',stlm_date:'20261022'}],[{deal_date:'20261019',stlm_date:'20261021'},{deal_date:'20261019',stlm_date:'20261021'}]])await assert.rejects(requestMarketRisk('credit',credit,mock({rt_cd:'0',output}).transport,()=>at));
});
test('risk root shape and row index cannot be relabeled post-normalization',async()=>{
 const r=await requestMarketRisk('lending',range,mock({rt_cd:'0',output1:[{bsop_date:'20261020'}]}).transport,()=>at);const index=structuredClone(r);index.rows[0]!.row_index=1;assert.equal(MarketRiskResultSchema.safeParse(index).success,false);const root=structuredClone(r);root.rows[0]!.response_root='output2';assert.equal(MarketRiskResultSchema.safeParse(root).success,false);
});
test('risk bounds raw bodies before identity traversal and never invokes accessor fields',async()=>{
 let touched=false;const body={rt_cd:'0',get output(){touched=true;return [];}};await assert.rejects(requestMarketRisk('credit',credit,mock(body).transport,()=>at),/schema_drift/);assert.equal(touched,false);
 const cyclic:any={rt_cd:'0',output:[]};cyclic.self=cyclic;await assert.rejects(requestMarketRisk('credit',credit,mock(cyclic).transport,()=>at),/schema_drift/);
});

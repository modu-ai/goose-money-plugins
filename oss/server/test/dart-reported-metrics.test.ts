import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildReportInput} from '../src/report-pipeline.js';
const row=(id:string,amount:string,currency='KRW')=>({raw:{sj_div:'IS',account_id:id,account_nm:'합성 계정',thstrm_amount:amount,frmtrm_amount:amount,thstrm_nm:'합성 당기',frmtrm_nm:'합성 전기',currency,rcept_no:'20261023000001'},amounts:{current:{state:'value',decimal:amount,raw:amount}}});
const make=(rows:unknown[],reprt_code='11011')=>buildReportInput({report_id:'R01',subject:{id:'SYNTHETIC',name:'합성',venue:'KRX',currency:'KRW'},cutoff:'2026-10-24T00:00:00Z',received_at:'2026-10-24T00:00:00Z',display_timezone:'Asia/Seoul',calls:[{tool_name:'get_fundamentals',result:{structuredContent:{source:'opendart',status:'ok',request:{bsns_year:'2025',reprt_code,fs_div:'CFS'},provenance:{origin:'synthetic'},rows}}}]});
test('annual exact IS IDs map raw financial amounts; same-scale margin is deterministic',()=>{
 for(const factor of [1n,1000000n]){const doc=make([row('ifrs-full_Revenue',String(1000n*factor)),row('dart_OperatingIncomeLoss',String(100n*factor))]);const revenue=doc.metrics.find(m=>m.field_id==='reported.revenue');assert.equal(revenue?.unit,'원문 금액(배율 미확인)');assert.equal(revenue?.scope,'consolidated');assert.equal(doc.metrics.find(m=>m.field_id==='metric.operating_margin')?.value,'10');assert.equal(revenue?.status,'synthetic');}
});
test('ambiguous account IDs, different currencies and quarterly contexts cannot produce annual margins',()=>{
 const rev=row('ifrs-full_Revenue','1000'),op=row('dart_OperatingIncomeLoss','100');
 assert.equal(make([rev,{...rev},op]).metrics.some(m=>m.field_id==='reported.revenue'),false);
 assert.equal(make([rev,row('dart_OperatingIncomeLoss','100','USD')]).metrics.find(m=>m.field_id==='metric.operating_margin')?.value,null);
 assert.equal(make([rev,op],'11014').metrics.some(m=>m.field_id.startsWith('provider_finance.')),false);
 assert.equal(make([row('-표준계정코드 미사용-','1000'),op]).metrics.some(m=>m.field_id==='reported.revenue'),false);
});
test('financial display removes internal IDs, keeps comparative values and provenance',()=>{
 const doc=make([row('ifrs-full_Revenue','1000'),row('dart_OperatingIncomeLoss','100')]);const table=doc.source_tables?.[0];assert.ok(table);assert.equal(table.columns.includes('계정 ID'),false);assert.ok(table.columns.includes('전기 금액'));assert.equal(table.rows.length,2);assert.equal(table.rows[0]?.some(value=>value==='ifrs-full_Revenue'),false);assert.ok(table.rows[0]?.some(value=>value.includes('dart.fss.or.kr')));
});

test("non-report financial IDs remain in raw source, not unsupported route metrics",()=>{const doc=make([row("ifrs-full_ProfitLoss","100"),row("ifrs-full_Revenue","1000"),row("dart_OperatingIncomeLoss","100")]);assert.equal(doc.metrics.some(m=>m.field_id==="reported.net_income_total"),false);assert.equal(doc.source_tables?.[0]?.rows.length,3);});

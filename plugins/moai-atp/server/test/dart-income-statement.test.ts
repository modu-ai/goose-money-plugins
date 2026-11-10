import assert from 'node:assert/strict';
import test from 'node:test';
import {buildReportInput,normalizeMcpToolResult} from '../src/report-pipeline.js';

const at='2026-10-24T00:00:00Z';
const income=[['ifrs-full_Revenue','1000'],['dart_OperatingIncomeLoss','100'],['ifrs-full_ProfitLoss','70']] as const;
function row(sj_div:string,account_id:string,value:string){return {raw:{sj_div,account_id,account_nm:'합성 계정',thstrm_amount:value,frmtrm_amount:'1',thstrm_nm:'합성 당기',frmtrm_nm:'합성 전기',currency:'KRW',rcept_no:'20261023000001'},amounts:{current:{state:'value',decimal:value,raw:value}}};}
function rows(statement:'IS'|'CIS'){
 return [...income.map(([id,value])=>row(statement,id,value)),row('CF','ifrs-full_CashFlowsFromUsedInOperatingActivities','50'),...([['ifrs-full_Assets','10000'],['ifrs-full_CashAndCashEquivalents','1000'],['ifrs-full_Equity','6000'],['ifrs-full_Liabilities','4000']] as const).map(([id,value])=>row('BS',id,value))];
}
function make(financialRows=rows('IS'),reprt_code='11011'){
 return buildReportInput({report_id:'R01',subject:{id:'SYNTHETIC',name:'합성 종목',venue:'KRX',currency:'KRW'},cutoff:at,received_at:at,display_timezone:'Asia/Seoul',calls:[
  {tool_name:'get_market_snapshot',result:{structuredContent:{contract:'moai.stock.quote-snapshot.v1',provider:'kis',origin:'synthetic',provenance:{origin:'synthetic',source_as_of:null,received_at:at},data:{last:'1100',open:'1000',high:'1200',low:'900',previous_close:'1000',change:'100',change_percent:'10',volume:'100'}}}},
  {tool_name:'get_fundamentals',result:{structuredContent:{source:'opendart',status:'ok',request:{corp_code:'00000001',bsns_year:'2025',reprt_code,fs_div:'CFS'},provenance:{origin:'synthetic'},rows:financialRows}}}
 ]});
}
const values=(doc:ReturnType<typeof make>)=>Object.fromEntries(doc.metrics.map(m=>[m.field_id,m.value]));
const expected={
 'quote.last':'1100','quote.open':'1000','quote.high':'1200','quote.low':'900','quote.previous_close':'1000','quote.change':'100','quote.change_percent':'10','quote.volume':'100',
 'reported.revenue':'1000','provider_finance.revenue':'1000','reported.operating_profit':'100','provider_finance.operating_profit':'100','reported.cfo':'50','reported.assets':'10000','reported.cash':'1000','reported.equity':'6000','reported.liabilities':'4000','metric.change_pct':'10','metric.operating_margin':'10',
};
test('Samsung-shaped synthetic IS baseline keeps all 19 metric IDs and values',()=>{
 const doc=make();assert.equal(doc.metrics.length,19);assert.deepEqual(values(doc),expected);assert.equal(doc.source_tables?.find(t=>t.title==='DART 재무제표 원문 금액')?.rows.length,8);
});
test('CIS-only income statement restores the five missing metrics and preserves CIS provenance/display',()=>{
 const doc=make(rows('CIS'));assert.equal(doc.metrics.length,19);assert.deepEqual(values(doc),expected);
 for(const id of ['reported.revenue','reported.operating_profit','provider_finance.revenue','provider_finance.operating_profit'])assert.match(doc.metrics.find(m=>m.field_id===id)?.period??'',/:CIS:/);
 const table=doc.source_tables?.find(t=>t.title==='DART 재무제표 원문 금액');assert.equal(table?.rows.length,8);assert.equal(table?.rows.filter(r=>r.includes('포괄손익계산서')).length,3);
});
test('IS has precedence as a whole statement; partial or ambiguous IS is not repaired with CIS',()=>{
 const baseline=make();assert.deepEqual(make([...rows('IS'),...income.map(([id])=>row('CIS',id,'999'))]).metrics,baseline.metrics);
 const partial=make([row('IS','ifrs-full_Revenue','1000'),...rows('CIS')]);assert.equal(values(partial)['reported.revenue'],'1000');assert.equal(values(partial)['reported.operating_profit'],undefined);assert.equal(values(partial)['metric.operating_margin'],undefined);
 const duplicate=make([...rows('IS'),row('IS','ifrs-full_Revenue','1000'),...rows('CIS')]);assert.equal(values(duplicate)['reported.revenue'],undefined);
});
test('CIS retains duplicate, quarter, currency and rights-pending safeguards',()=>{
 const cis=rows('CIS');assert.equal(values(make([...cis,row('CIS','ifrs-full_Revenue','1000')]))['reported.revenue'],undefined);
 assert.equal(values(make(cis,'11014'))['reported.revenue'],undefined);
 const mismatch=cis.map(r=>r.raw.account_id==='dart_OperatingIncomeLoss'?{...r,raw:{...r.raw,currency:'USD'}}:r);assert.equal(values(make(mismatch))['metric.operating_margin'],null);
 const pending=normalizeMcpToolResult('get_fundamentals',{structuredContent:{source:'opendart',status:'ok',request:{bsns_year:'2025',reprt_code:'11011',fs_div:'CFS'},provenance:{origin:'actual'},rows:cis}},at);
 assert.ok(pending.metrics.some(m=>m.field_id==='reported.revenue'));for(const m of pending.metrics){assert.equal(m.value,null);assert.equal(m.status,'rights_pending');}
});

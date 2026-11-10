import assert from 'node:assert/strict';
import test from 'node:test';
import {judgeFieldComparability,type ComparableMetric} from '../src/report-comparison.js';
import {renderReportInputHtml} from '../src/report-pipeline.js';
import {SUBJECT_A,SUBJECT_B,SUBJECTS_AB,callsOf,comparisonArgs,buildDoc,type Call} from './r02-fixtures.js';

const margin=(statement:string,receipt:string,year='2025'):ComparableMetric=>({value:'10',unit:'%',currency:null,scale:'1',period:`${year}:FY:CFS:${statement}:합성 당기:${receipt}`,period_kind:'FY',scope:'consolidated',status:'synthetic'});
const a='20260310000001',b='20260311000002';
for(const [left,right] of [['IS','IS'],['IS','CIS'],['CIS','IS'],['CIS','CIS']])test(`same-year ${left}/${right} margins ignore issuer-specific receipts while preserving provenance`,()=>{
 const metrics=[margin(left!,a),margin(right!,b)],before=structuredClone(metrics);
 assert.deepEqual(judgeFieldComparability(metrics),{comparable:true,reasons:[]});assert.deepEqual(metrics,before);
});
test('CIS normalization retains year, scope, currency and malformed-period refusals',()=>{
 const base=margin('IS',a),cis=margin('CIS',b);
 for(const [edit,reason] of [[margin('CIS',b,'2024'),'period_mismatch'],[{...cis,scope:'standalone'},'scope_mismatch'],[{...cis,currency:'USD'},'currency_mismatch'],[{...cis,period:'2025:FY:CFS:CIS:합성 당기:not-a-receipt'},'period_mismatch']] as const){
  const result=judgeFieldComparability([base,edit]);assert.equal(result.comparable,false);assert.ok(result.reasons.includes(reason));
 }
});
function statement(calls:Call[],kind:string):Call[]{
 const changed=structuredClone(calls);
 for(const call of changed){
  if(call.tool_name!=='get_fundamentals')continue;
  const payload=(call.result as {structuredContent:{rows:{raw:{sj_div:string;sj_nm:string}}[]}}).structuredContent;
  for(const row of payload.rows)if(row.raw.sj_div==='IS'){row.raw.sj_div=kind;row.raw.sj_nm=kind==='CIS'?'포괄손익계산서':'손익계산서';}
 }
 return changed;
}
for(const [left,right] of [['IS','CIS'],['CIS','CIS']])test(`R02 ${left}/${right} report and basis legend use the same annual period, retaining raw CIS`,()=>{
 const calls=[...statement(callsOf(SUBJECT_A,'synthetic'),left!),...statement(callsOf(SUBJECT_B,'synthetic'),right!)];
 const doc=buildDoc(comparisonArgs(SUBJECTS_AB,calls));
 const row=doc.comparison.rows.find((item:{field_id:string})=>item.field_id==='metric.operating_margin');assert.ok(row);assert.equal(row.comparable,true);assert.deepEqual(row.reasons,[]);
 const raw=doc.metrics.filter((item:{field_id:string;period:string})=>item.field_id==='metric.operating_margin'&&item.period.includes(':CIS:'));assert.ok(raw.length>0);assert.ok(raw.every((item:{period:string})=>/:CIS:.*:\d{14}$/.test(item.period)));
 const html=renderReportInputHtml(doc);
 const legend=[...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)].map(match=>match[0]).find(table=>table.includes('기간 기준'));
 assert.ok(legend);assert.match(legend,/사업연도 2025 · 보고서 코드 11011/);assert.doesNotMatch(legend,/:CIS:/);
});

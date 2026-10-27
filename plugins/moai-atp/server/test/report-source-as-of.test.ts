// t28 D3: a source_as_of that is not a real calendar date or RFC 3339 instant with an offset must read as undated,
// so the pipeline falls back to the receipt time and the comparison layer reports period_unconfirmed (not a silent date).
// Accepted forms (the same two the ReportInput source schema accepts, read from report-pipeline.ts `sourceAsOf`):
//   1. YYYY-MM-DD that exists on the calendar                 -> kept verbatim
//   2. RFC 3339 datetime with Z or +/-HH:MM offset (z.string().datetime({offset:true})) -> normalised to toISOString()
// Everything else (Date.parse-only forms such as "1", "2026", "yesterday", offset-less datetimes) is undated.
import assert from 'node:assert/strict';
import test from 'node:test';
import {buildReportInput} from '../src/report-pipeline.js';

const received='2026-10-23T00:00:00Z';
const subject={id:'SYNTHETIC',name:'합성 기준일 회귀',venue:'KRX',currency:'KRW'};
function quote(sourceAsOf:unknown){
  return {contract:'moai.stock.quote-snapshot.v1',provider:'kis',operation_id:'kis.kr.quote.snapshot.v1',origin:'synthetic',
    provenance:{source_as_of:sourceAsOf,origin:'synthetic',validation_status:'synthetic_fixture'},
    data:{last:'120',open:'110',high:'125',low:'108',change:'10',change_percent:'9.09',volume:'1000'}};
}
function sourceAsOf(value:unknown){
  const doc=buildReportInput({report_id:'R01',subject,cutoff:'2026-10-23T00:00:00Z',received_at:received,display_timezone:'Asia/Seoul',calls:[{tool_name:'get_market_snapshot',result:{structuredContent:quote(value)}}]});
  return doc.sources.find(s=>s.id.includes('get_market_snapshot'))?.source_as_of;
}

test('non-date source_as_of strings are undated, never read as a date',()=>{
  for(const bad of ['1','2026','yesterday','2026-13-40','2026-02-30','2026-04-31','2025-02-29','2026-10','20261022','2026-1-5','Oct 22 2026','2026-10-22T00:00:00','2026-10-22 00:00:00','','  ','0000-00-00']){
    assert.equal(sourceAsOf(bad)??null,null,`undated: ${JSON.stringify(bad)}`);
  }
});

test('accepted source_as_of forms stay accepted: calendar date verbatim, offset datetime normalised',()=>{
  assert.equal(sourceAsOf('2026-10-22'),'2026-10-22');
  assert.equal(sourceAsOf('2024-02-29'),'2024-02-29');
  assert.equal(sourceAsOf('2026-10-22T00:00:00Z'),'2026-10-22T00:00:00.000Z');
  assert.equal(sourceAsOf('2026-10-22T09:00:00+09:00'),'2026-10-22T00:00:00.000Z');
  assert.equal(sourceAsOf('2026-10-22T00:00:00.123Z'),'2026-10-22T00:00:00.123Z');
  assert.equal(sourceAsOf(null)??null,null);
  assert.equal(sourceAsOf(undefined)??null,null);
});

test('undated source_as_of falls back to the receipt time for the metric period (the period_undated shape)',()=>{
  const doc=buildReportInput({report_id:'R01',subject,cutoff:'2026-10-23T00:00:00Z',received_at:received,display_timezone:'Asia/Seoul',calls:[{tool_name:'get_market_snapshot',result:{structuredContent:quote('1')}}]});
  const source=doc.sources.find(s=>s.id.includes('get_market_snapshot'))!;
  assert.equal(source.source_as_of??null,null);
  const last=doc.metrics.find(m=>m.field_id==='quote.last')!;
  assert.equal(last.period,source.received_at??source.observed_at);
});

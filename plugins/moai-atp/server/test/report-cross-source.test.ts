// All values and provider-shaped payloads below are synthetic test fixtures; no network or user store.
import assert from 'node:assert/strict';
import test from 'node:test';
import {buildReportInput,ReportInputSchema,renderReportInputHtml} from '../src/report-pipeline.js';
const received='2026-10-23T03:00:00.000Z';
type Options={period?:string;scope?:string;currency?:string;scale?:string;origin?:string;rights?:string};
function call(tool_name:string,field_id:string,value:string,o:Options={}){
 const origin=o.origin??'synthetic';
 const payload={contract:'moai.stock.report-observations.v1',origin,provider:'fixture-only',operation_id:'synthetic-cross-source',rights_status:o.rights??'local_view',provenance:{origin,source_as_of:'2026-10-22',validation_status:'provider_shape_checked'},observations:[{field_id,label:field_id,value,unit:o.currency??'KRW',currency:o.currency??'KRW',period:o.period??'2025-FY',period_kind:'FY',scope:o.scope??'consolidated',scale:o.scale??'1'}]};
 return {tool_name,result:{structuredContent:payload}};
}
const actual=(o:Options={})=>call('get_fundamentals','provider_finance.operating_profit','110',o);
const estimate=(o:Options={})=>call('get_kis_house_estimates','estimates.consensus','100',o);
function build(report_id:string,calls:ReturnType<typeof call>[],trusted=false){return ReportInputSchema.parse(buildReportInput({report_id,subject:{id:'SYNTHETIC',name:'합성 시험',venue:'KRX',currency:'KRW'},cutoff:received,display_timezone:'Asia/Seoul',received_at:received,calls,...(trusted?{trustedLocalReceipts:new Map(calls.flatMap((c,i)=>c.result.structuredContent.rights_status==='pending'?[]:[[i,{receivedAt:received}]]))}:{})}));}
for(const [route,section] of [['R07','R07.S03'],['R11','R11.S04']]){
 test(`${route} computes cross-source surprise and normalized bar with both source ids`,()=>{
  const doc=build(route!,[actual({period:'2025:FY',scale:'1000'}),call('get_kis_house_estimates','estimates.consensus','100000')]);
  assert.equal(doc.metrics.find(m=>m.field_id==='metric.surprise')?.value,'10');
  const metric=doc.metrics.find(m=>m.field_id==='metric.surprise')!;
  assert.deepEqual('source_ids' in metric?metric.source_ids:null,doc.sources.map(s=>s.id));
  const visual=doc.visuals?.find(v=>v.section_id===section);
  assert.ok(visual&&'values' in visual);assert.deepEqual(visual.values,['110000','100000']);
  assert.deepEqual('source_ids' in visual?visual.source_ids:null,doc.sources.map(s=>s.id));
  const html=renderReportInputHtml(doc);const start=html.indexOf('id="'+section+'"');const snippet=html.slice(start,html.indexOf('</section>',start));
  for(const source of doc.sources)assert.ok(snippet.includes(source.id),'both chart sources visible');
  assert.ok(snippet.includes('환산'),'normalized amount is labelled as a conversion');
  assert.match(snippet,/OPENDART/);assert.match(snippet,/KIS/);
 });
 for(const [name,options] of [['period',{period:'2026-FY'}],['scope',{scope:'standalone'}],['currency',{currency:'USD'}],['unparsed period',{period:'원문 기간 미확인'}]] as const){
  test(`${route} refuses cross-source ${name} mismatch with reason`,()=>{
   const doc=build(route!,[actual(),estimate(options)]);const m=doc.metrics.find(m=>m.field_id==='metric.surprise');
   assert.ok(m);assert.equal(m.value,null);assert.ok(m.missing_reason);assert.ok(!doc.visuals?.some(v=>v.section_id===section));
  });
 }
 test(`${route} refuses mixed synthetic and actual origins`,()=>{
  const doc=build(route!,[actual(),estimate({origin:'actual'})],true);const m=doc.metrics.find(m=>m.field_id==='metric.surprise');
  assert.ok(m);assert.equal(m.value,null);assert.equal(m.missing_reason,'cross_source_origin_mismatch');assert.ok(!doc.visuals?.some(v=>v.section_id===section));
 });
 test(`${route} refuses pending rights`,()=>{
  const doc=build(route!,[actual({origin:'actual'}),estimate({origin:'actual',rights:'pending'})],true);const m=doc.metrics.find(m=>m.field_id==='metric.surprise');
  assert.ok(m);assert.equal(m.value,null);assert.equal(m.status,'rights_pending');assert.ok(!doc.visuals?.some(v=>v.section_id===section));
 });
 test(`${route} refuses duplicate matching estimate candidates`,()=>{
  const doc=build(route!,[actual(),estimate(),estimate()]);const m=doc.metrics.find(m=>m.field_id==='metric.surprise');
  assert.ok(m);assert.equal(m.value,null);assert.equal(m.missing_reason,'cross_source_ambiguous_inputs');assert.ok(!doc.visuals?.some(v=>v.section_id===section));
 });
}
test('cross-source actual fixtures with trusted receipts display both sources and no fabricated verification',()=>{
 const doc=build('R07',[actual({origin:'actual'}),estimate({origin:'actual'})],true);
 assert.equal(doc.metrics.find(m=>m.field_id==='metric.surprise')?.value,'10');
 assert.equal(doc.metrics.find(m=>m.field_id==='metric.surprise')?.status,'provided_unverified');
 assert.equal(doc.visuals?.find(v=>v.section_id==='R07.S03')?.kind,'bar');
});
test('cross-source zero estimate stays missing without throwing',()=>{
 const doc=build('R07',[actual(),call('get_kis_house_estimates','estimates.consensus','0')]);
 assert.equal(doc.metrics.find(m=>m.field_id==='metric.surprise')?.value,null);
 assert.ok(doc.metrics.find(m=>m.field_id==='metric.surprise')?.missing_reason);
});
test('metric lineage rejects unknown or omitted primary source and charts cannot add unused source ids',()=>{
 const doc=build('R07',[actual(),estimate()]);
 const unknown=structuredClone(doc);Object.assign(unknown.metrics.find(m=>m.field_id==='metric.surprise')!,{source_ids:['unknown']});assert.equal(ReportInputSchema.safeParse(unknown).success,false);
 const extra=structuredClone(doc);const v=extra.visuals?.find(v=>v.section_id==='R07.S03');assert.ok(v);Object.assign(v,{source_ids:[...doc.sources.map(s=>s.id),'unknown']});assert.equal(ReportInputSchema.safeParse(extra).success,false);
});
test('same-source financial bars preserve normalized scale lineage',()=>{
 const a=actual({scale:'1000'});const e=estimate({scale:'1000'});
 a.result.structuredContent.observations.push(...e.result.structuredContent.observations);
 const doc=build('R07',[a]);const v=doc.visuals?.find(v=>v.section_id==='R07.S03');assert.ok(v&&'values' in v);assert.deepEqual(v.values,['110000','100000']);
});
test('cross-source amounts beyond the visual decimal bound stay missing',()=>{
 const doc=build('R07',[call('get_fundamentals','provider_finance.operating_profit','11111111111111111111111111111111',{scale:'100000000'}),estimate()]);
 assert.equal(doc.metrics.find(m=>m.field_id==='metric.surprise')?.value,null);assert.ok(!doc.visuals?.some(v=>v.section_id==='R07.S03'));
});
test('same-source surprise uses the same normalized basis as its financial bar',()=>{
 const a=actual({scale:'1000'});a.result.structuredContent.observations.push(...call('get_kis_house_estimates','estimates.consensus','100000').result.structuredContent.observations);
 const doc=build('R07',[a]);assert.equal(doc.metrics.find(m=>m.field_id==='metric.surprise')?.value,'10');
});
test('lineage rejects an omitted primary source, duplicate sources and known but unused visual source',()=>{
 const doc=build('R07',[actual(),estimate()]);
 for(const ids of [[doc.sources[1]!.id],[doc.sources[0]!.id,doc.sources[0]!.id]]){
  const invalid=structuredClone(doc);Object.assign(invalid.metrics.find(m=>m.field_id==='metric.surprise')!,{source_ids:ids});assert.equal(ReportInputSchema.safeParse(invalid).success,false);
 }
 const extra=structuredClone(doc);extra.sources.push({...extra.sources[0]!,id:'unused-known-source'});
 Object.assign(extra.visuals!.find(v=>v.section_id==='R07.S03')!,{source_ids:[...extra.sources.map(s=>s.id)]});assert.equal(ReportInputSchema.safeParse(extra).success,false);
 const primary=structuredClone(doc);Object.assign(primary.visuals!.find(v=>v.section_id==='R07.S03')!,{source_ids:[doc.sources[1]!.id]});assert.equal(ReportInputSchema.safeParse(primary).success,false);
});
test('cross-source financial bar cannot substitute a different metric field',()=>{
 const doc=build('R07',[actual(),estimate()]);
 const invalid=structuredClone(doc);invalid.metrics.find(m=>m.field_id==='provider_finance.operating_profit')!.field_id='provider_finance.revenue';
 const v=invalid.visuals!.find(v=>v.section_id==='R07.S03')!;if('metric_ids' in v)v.metric_ids[v.metric_ids.indexOf('provider_finance.operating_profit')]='provider_finance.revenue';
 assert.equal(ReportInputSchema.safeParse(invalid).success,false);
});

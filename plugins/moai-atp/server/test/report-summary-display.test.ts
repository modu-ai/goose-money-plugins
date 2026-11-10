import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReportInput, renderReportInputHtml } from '../src/report-pipeline.js';

const instant = '2026-11-08T23:35:10.562Z';
function report(period: string, display_timezone: 'Asia/Seoul' | 'UTC' = 'Asia/Seoul', last = '193500.1250') {
  return buildReportInput({ report_id:'R01', subject:{id:'TEST',name:'합성 종목',venue:'KRX',currency:'KRW'}, cutoff:instant, received_at:instant, display_timezone,
    calls:[{tool_name:'get_market_snapshot',result:{structuredContent:{contract:'moai.stock.quote-snapshot.v1',operation_id:'kis.kr.quote.snapshot.v1',provider:'kis',origin:'synthetic',provenance:{origin:'synthetic',source_as_of:period,available_at:instant,validation_status:'synthetic_fixture'},data:{last,open:'190000',high:'194000',low:'189000'}}}}] });
}

test('generated summary groups exact decimals, uses Korean units and KST across midnight, keeping raw metrics', () => {
  const doc=report(instant), body=doc.sections[0]!.body!;
  assert.match(body,/최근가 193,500\.1250 원\/주 \(2026-11-09 08:35 KST\)/);
  assert.ok(!body.includes(instant));
  const metric=doc.metrics.find(item=>item.field_id==='quote.last')!;
  assert.equal(metric.value,'193500.1250');
  assert.equal(metric.period,instant);
  assert.equal(metric.unit,'KRW/share');
  const html=renderReportInputHtml(doc);
  assert.match(/<blockquote>([\s\S]*?)<\/blockquote>/.exec(html)?.[1]??'',/193,500\.1250 원\/주/);
  assert.ok(html.includes(instant),'source ledger retains the original instant');
});

test('date-only market period stays a date and UTC respects the declared timezone', () => {
  assert.match(report('2026-11-08').sections[0]!.body!,/\(2026-11-08\)/);
  assert.match(report(instant,'UTC').sections[0]!.body!,/2026-11-08 23:35 UTC/);
});

test('summary grouping preserves integers beyond safe Number precision', () => {
  assert.match(report(instant,'Asia/Seoul','9007199254740993').sections[0]!.body!,/9,007,199,254,740,993/);
});

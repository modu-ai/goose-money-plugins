// Issue #52 (screen QA of #18): display-only fixes in the HTML renderer.
// D7: a bar chart's value axis must start at zero; ECharts `scale:true` drops the zero baseline and exaggerates bars.
// D4: long integer amounts in metric tables are shown without digit grouping; the integer part is grouped,
//     the fractional part is never grouped (the KPI helper used to group "13.0696" into "13.0,696").
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReportInput, renderReportInputHtml } from '../src/report-pipeline.js';
import { groupIntegerDigits } from '../src/report-template-renderer.js';

const received = '2026-10-23T04:00:00.000Z';
const subject = { id: '000660', name: '검토용 종목', venue: 'KRX', currency: 'KRW' };
const wrap = (structuredContent: unknown) => ({ structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] });
const syntheticQuote = {
  contract: 'moai.stock.quote-snapshot.v1', provider: 'kis', operation_id: 'kis.kr.quote.snapshot.v1', origin: 'synthetic',
  provenance: { source_as_of: '2026-10-22', available_at: received, origin: 'synthetic', validation_status: 'synthetic_fixture', provider_api_version: 'fixture-v1' },
  data: { last: '12345', open: '12000', high: '12500', low: '11900', change: '-1345', change_percent: '2.87', volume: '3336059380000' },
};
function syntheticHtml(): string {
  const input = buildReportInput({ report_id: 'R01', subject, cutoff: received, display_timezone: 'Asia/Seoul', received_at: received, calls: [{ tool_name: 'get_market_snapshot', result: wrap(syntheticQuote) }] });
  assert.equal(input.chart?.kind, 'bar', 'the fixture produces the bar chart this test is about');
  return renderReportInputHtml(input);
}

test('D4: groupIntegerDigits groups the integer part only and leaves other text alone', () => {
  assert.equal(groupIntegerDigits('3336059380000'), '3,336,059,380,000');
  assert.equal(groupIntegerDigits('-8000'), '-8,000');
  assert.equal(groupIntegerDigits('+12345.5'), '+12,345.5');
  assert.equal(groupIntegerDigits('13.0696'), '13.0696');
  assert.equal(groupIntegerDigits('1034.5678'), '1,034.5678');
  assert.equal(groupIntegerDigits('999'), '999');
  assert.equal(groupIntegerDigits('—'), '—');
  assert.equal(groupIntegerDigits('2026-10-22'), '2026-10-22');
  assert.equal(groupIntegerDigits('KRW/share'), 'KRW/share');
});

test('D4: metric table cells show grouped integers and stay numeric cells', () => {
  const html = syntheticHtml();
  assert.match(html, /<td class="numeric">3,336,059,380,000<\/td>/);
  assert.match(html, /<td class="numeric">12,345<\/td>/);
  assert.match(html, /<td class="numeric">-1,345<\/td>/);
  assert.match(html, /<td class="numeric">2\.87<\/td>/);
  assert.ok(!html.includes('>3336059380000<'), 'the ungrouped amount is not shown in a table cell');
});

test('D7: the category bar chart keeps a zero baseline on its value axis', () => {
  const html = syntheticHtml();
  assert.ok(!/xAxis:\{type:'category'[^}]*\}\},yAxis:\{type:'value',scale:true/.test(html), 'bar value axis must not use scale:true');
  assert.match(html, /xAxis:\{type:'category'[^}]*\}\},yAxis:\{type:'value',scale:b\.kind!=='bar'/);
});

// Issue #52, after PR #53: the digit grouping that #53 gave metric tables still missed the charts the re-check found.
// (a) Bar value labels: the chart runtime printed raw numbers; they now use the same grouping on the client.
// (b) The value table under each chart now shows the same grouped numbers as its labels.
// Raw received tables ("수신 자료 확인") are NOT grouped: their note promises the original notation, so grouping
// them is an open decision. A zero-padded value ("0012345") is a received code and is never grouped.
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
const COLUMNS = ['공시일 원문', '접수번호', '당기 금액', '신용융자 잔고(주)', '매도 호가 원문', '수량 비중 원문'];
const ROW = ['20261106', '20261106000440', '566942110000000', '1234567', '0012345', '1234.5'];

function htmlWithSourceTable(): string {
  const input = buildReportInput({ report_id: 'R01', subject, cutoff: received, display_timezone: 'Asia/Seoul', received_at: received, calls: [{ tool_name: 'get_market_snapshot', result: wrap(syntheticQuote) }] });
  const source = input.sources[0];
  assert.ok(source, 'the fixture yields one source the table can point at');
  return renderReportInputHtml({ ...input, source_tables: [{ source_id: source.id, title: '합성 수신 표', coverage_note: '합성 자료', columns: COLUMNS, rows: [ROW] }] });
}
function sourceRecordCells(html: string): string[] {
  const block = /<details class="source-records"><summary>합성 수신 표[\s\S]*?<\/details>/.exec(html)?.[0];
  assert.ok(block, 'the synthetic source table is rendered');
  return [...block.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((match) => match[1]!);
}

test('#52: a zero-padded raw value is a received code and is not grouped', () => {
  assert.equal(groupIntegerDigits('0012345'), '0012345');
  assert.equal(groupIntegerDigits('-0012345'), '-0012345');
  assert.equal(groupIntegerDigits('1234567'), '1,234,567');
  assert.equal(groupIntegerDigits('0.5'), '0.5');
});

test('#52: raw received tables keep the received text exactly (the page promises to preserve original notation)', () => {
  // Grouping these cells is an open decision: the table note says "원문 금액·통화·기간 표기를 보존합니다".
  assert.deepEqual(sourceRecordCells(htmlWithSourceTable()), ROW);
});

test('#52: the value table under a chart shows the same grouped numbers as the chart labels', () => {
  const html = htmlWithSourceTable();
  const table = /<th scope="col">원수치<\/th>[\s\S]*?<\/table>/.exec(html)?.[0];
  assert.ok(table, 'the bar chart value table is rendered');
  const values = [...table.matchAll(/<td class="numeric">([^<]*)<\/td>/g)].map((match) => match[1]);
  assert.ok(values.length > 0, 'the value table has numeric cells');
  assert.ok(values.includes('12,000') && values.includes('12,345'), `grouped values: ${JSON.stringify(values)}`);
  assert.ok(values.every((value) => !/^[+-]?[1-9]\d{3,}/.test(value ?? '')), `no ungrouped value: ${JSON.stringify(values)}`);
});

test('#52: bar value labels use digit grouping on the client', () => {
  const html = htmlWithSourceTable();
  // Narrow charts (a 390 px phone width) use a smaller label so a grouped seven-digit price does not run into its neighbour.
  assert.match(html, /label:\{show:true,position:'top',fontSize:el\.clientWidth<480\?10:12,formatter:\(p\)=>groupLabel\(p\.value\)\},labelLayout:\{hideOverlap:true\}/);
  // A narrow chart gives its bars the 52 px of side padding a desktop chart keeps (measured at 390 px: 40 px per bar before).
  assert.match(html, /grid:\{left:el\.clientWidth<480\?8:60,right:el\.clientWidth<480\?8:24,top:24,bottom:54,containLabel:true\}/);
  // The client reuses the server's grouping function text, so table cells and chart labels cannot drift apart.
  assert.ok(html.includes(`const groupLabel=(v)=>(${groupIntegerDigits.toString()})(String(v));`), 'groupLabel wraps groupIntegerDigits');
  // Run the helper exactly as the page ships it.
  const source = /const groupLabel=([\s\S]*?\(String\(v\)\));const specs=/.exec(html)?.[1];
  assert.ok(source, 'the helper is extractable from the page');
  const groupLabel = new Function(`return ${source};`)() as (value: unknown) => string;
  assert.deepEqual([3336059380000, 197000, -1345, 2.87, 1234.5, 'n/a'].map(groupLabel), ['3,336,059,380,000', '197,000', '-1,345', '2.87', '1,234.5', 'n/a']);
});

// Issue #52 D8: on a 390 px phone the R01 data-pipeline diagram was held at min-width 380 px inside a 340 px content
// box, so its right-hand boxes ("결측 사유 기록") sat outside the visible area behind a horizontal scroll.
// Measured in the browser: the diagram's 13 px labels render at 10.8 px when it fits 340 px and 10.1 px at 320 px,
// so the floor is lowered to 320 px. The horizontal scroll stays as the fallback below that width.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReportInput, renderReportInputHtml } from '../src/report-pipeline.js';

const received = '2026-10-23T04:00:00.000Z';
const subject = { id: '000660', name: '검토용 종목', venue: 'KRX', currency: 'KRW' };
const wrap = (structuredContent: unknown) => ({ structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] });
const syntheticQuote = {
  contract: 'moai.stock.quote-snapshot.v1', provider: 'kis', operation_id: 'kis.kr.quote.snapshot.v1', origin: 'synthetic',
  provenance: { source_as_of: '2026-10-22', available_at: received, origin: 'synthetic', validation_status: 'synthetic_fixture', provider_api_version: 'fixture-v1' },
  data: { last: '12345', open: '12000', high: '12500', low: '11900', change: '-1345', change_percent: '2.87', volume: '3336059380000' },
};

function r01Html(): string {
  return renderReportInputHtml(buildReportInput({ report_id: 'R01', subject, cutoff: received, display_timezone: 'Asia/Seoul', received_at: received, calls: [{ tool_name: 'get_market_snapshot', result: wrap(syntheticQuote) }] }));
}

test('D8: the R01 pipeline diagram is rendered, inside a horizontally scrollable figure', () => {
  const html = r01Html();
  assert.match(html, /<figure class="diagram"><figcaption>자료 처리 단계 설명/);
  assert.match(html, /\.diagram\{max-width:720px;margin:24px auto;overflow-x:auto\}/);
});

test('D8: the diagram may shrink to 320 px, so a 390 px phone (340 px content) shows it whole', () => {
  const html = r01Html();
  assert.match(html, /\.diagram svg\{width:100%;height:auto;display:block;min-width:320px\}/);
  assert.ok(!html.includes('min-width:380px'), 'the 380 px floor that forced a scroll on phones is gone');
  // The phone rule gives every figure 16 px side padding (content 308 px at 390 px); the diagram takes 6 px so its 320 px fit.
  assert.match(html, /@media\(max-width:520px\)\{\.diagram\{padding-left:6px;padding-right:6px\}\}/);
});

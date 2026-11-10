// Issue #52 D5 (user decision 2026-11-10): body tables show Korean status words and KST times; the raw codes and ISO
// instants stay in the source ledger, the chart captions and each cell's title attribute.
// Approved words: 제공값 / 제공값(미검증) / 없음 / 미실행 / 오류 / 기준 시각 지남 / 권리 확인 대기 / 합성 자료,
// note provider_field_missing_or_invalid → 공급자 응답에 값이 없거나 형식이 맞지 않음, time "2026-11-10 10:06 KST".
// Raw received tables keep the received text (decision 2), which report-number-labels.test.ts already pins.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReportInput, renderReportInputHtml } from '../src/report-pipeline.js';
import { displayInstant, metricNoteLabel, metricStatusLabel } from '../src/report-template-renderer.js';

const received = '2026-10-23T04:00:00.000Z';
const subject = { id: '000660', name: '검토용 종목', venue: 'KRX', currency: 'KRW' };
const wrap = (structuredContent: unknown) => ({ structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] });
const syntheticQuote = {
  contract: 'moai.stock.quote-snapshot.v1', provider: 'kis', operation_id: 'kis.kr.quote.snapshot.v1', origin: 'synthetic',
  provenance: { source_as_of: '2026-10-22', available_at: received, origin: 'synthetic', validation_status: 'synthetic_fixture', provider_api_version: 'fixture-v1' },
  data: { last: '12345', open: '12000', high: '12500', low: '11900', change: '-1345', change_percent: '2.87', volume: '3336059380000' },
};
function input() {
  return buildReportInput({ report_id: 'R01', subject, cutoff: received, display_timezone: 'Asia/Seoul', received_at: received, calls: [{ tool_name: 'get_market_snapshot', result: wrap(syntheticQuote) }] });
}
const ledger = (html: string): string => /<summary>출처·시각·검증 장부<\/summary>[\s\S]*?<\/details>/.exec(html)?.[0] ?? '';
const withoutLedger = (html: string): string => html.replace(/<summary>출처·시각·검증 장부<\/summary>[\s\S]*?<\/details>/, '');

test('D5: every approved status word, and unknown codes left as they are', () => {
  assert.deepEqual(
    ['provided', 'provided_unverified', 'missing', 'not_run', 'error', 'stale', 'rights_pending', 'synthetic'].map(metricStatusLabel),
    ['제공값', '제공값(미검증)', '없음', '미실행', '오류', '기준 시각 지남', '권리 확인 대기', '합성 자료'],
  );
  assert.equal(metricStatusLabel('some_future_code'), 'some_future_code');
  assert.equal(metricNoteLabel('provider_field_missing_or_invalid'), '공급자 응답에 값이 없거나 형식이 맞지 않음');
  assert.equal(metricNoteLabel('synthetic_field_missing'), 'synthetic_field_missing');
});

test('D5: an ISO instant shows as minutes in the document time zone; other text is untouched', () => {
  assert.equal(displayInstant('2026-11-10T01:06:22.361Z', 'Asia/Seoul'), '2026-11-10 10:06 KST');
  assert.equal(displayInstant('2026-11-08T02:35:10.569072Z', 'Asia/Seoul'), '2026-11-08 11:35 KST');
  assert.equal(displayInstant('2026-12-31T15:30:00.000Z', 'Asia/Seoul'), '2027-01-01 00:30 KST');
  assert.equal(displayInstant('2026-10-22', 'Asia/Seoul'), '2026-10-22');
  assert.equal(displayInstant('FY2025', 'Asia/Seoul'), 'FY2025');
  assert.equal(displayInstant('2026-11-10T01:06:22.361Z', 'America/New_York'), '2026-11-09 20:06 America/New_York');
});

test('D5: body tables show Korean words with the raw code kept in title; the ledger keeps raw codes', () => {
  const html = renderReportInputHtml(input());
  const body = withoutLedger(html);
  assert.match(body, /<td title="synthetic">합성 자료<\/td>/);
  assert.match(body, /<td title="missing">없음<\/td>/);
  assert.ok(!/<td>synthetic<\/td>|<td>missing<\/td>/.test(body), 'no bare status code in a body cell');
  assert.match(ledger(html), /<td>synthetic<\/td>/, 'the ledger keeps the raw status code');
});

test('D5: body period cells and the report time line show KST, the ISO instant stays in title/datetime', () => {
  const doc = input();
  const iso = '2026-11-10T01:06:22.361Z';
  const metrics = doc.metrics.map((metric, index) => (index === 0 ? { ...metric, period: iso } : metric));
  const html = renderReportInputHtml({ ...doc, metrics });
  const body = withoutLedger(html);
  assert.match(body, /<td title="2026-11-10T01:06:22\.361Z">2026-11-10 10:06 KST<\/td>/);
  assert.match(html, /보고서 기준시각 <time datetime="2026-10-23T04:00:00\.000Z" title="2026-10-23T04:00:00\.000Z">2026-10-23 13:00 KST<\/time>/);
  assert.match(ledger(html), /2026-11-10T01:06:22\.361Z/, 'the ledger keeps the ISO period');
  assert.match(html, /received_at 2026-10-23T04:00:00\.000Z/, 'chart captions keep the ISO instant');
});

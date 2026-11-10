import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReportInput, renderReportInputHtml } from '../src/report-pipeline.js';
import { reportMetricDisplayRows } from '../src/report-template-renderer.js';

const received = '2026-11-10T04:00:00.000Z';
function input() {
  const quote = {
    contract: 'moai.stock.quote-snapshot.v1', provider: 'kis', operation_id: 'kis.kr.quote.snapshot.v1', origin: 'synthetic',
    provenance: { source_as_of: '2026-11-10', available_at: received, origin: 'synthetic', validation_status: 'synthetic_fixture', provider_api_version: 'fixture-v1' },
    data: { last: '12345', open: '12000', high: '12500', low: '11900', change: '-1345', change_percent: '2.87', volume: '3336059380000' },
  };
  return buildReportInput({ report_id: 'R01', subject: { id: 'TEST', name: '합성 검수 종목', venue: 'KRX', currency: 'KRW' }, cutoff: received, display_timezone: 'Asia/Seoul', received_at: received, calls: [{ tool_name: 'get_market_snapshot', result: { structuredContent: quote, content: [{ type: 'text', text: JSON.stringify(quote) }] } }] });
}

for (const template of ['existing', 'artboard-v2'] as const) {
  test(`D3: ${template} keeps display units together without changing their raw title or input`, () => {
    const doc = input(), before = JSON.stringify(doc);
    const html = renderReportInputHtml(doc, template);
    assert.match(html, /<td class="unit" title="KRW\/share">원\/주<\/td>/);
    assert.match(html, /\.table-wrap td\.unit,\.rs \.table-wrap td\.unit\{white-space:nowrap\}/);
    assert.equal(JSON.stringify(doc), before);
    assert.ok(reportMetricDisplayRows(doc).some(row => row[2] === '원/주'));
    const ledger = html.slice(html.indexOf('<summary>출처·시각·검증 장부</summary>'));
    assert.match(ledger, /KRW\/share/);
    assert.doesNotMatch(ledger, /class="unit"/);
  });
}

for (const template of ['existing', 'artboard-v2'] as const) {
  test(`D5: ${template} shows readable source times in chart captions and preserves ledger values`, () => {
    const doc = input(), before = JSON.stringify(doc);
    const html = renderReportInputHtml(doc, template);
    const captions = [...html.matchAll(/<figcaption class="chart-caption">([\s\S]*?)<\/figcaption>/g)].map(match => match[1]!);
    assert.ok(captions.length > 0);
    for (const caption of captions) {
      const visible = caption.replace(/<[^>]+>/g, '');
      assert.match(visible, /출처 기준시각 2026-11-10/);
      assert.match(visible, /수집시각 2026-11-10 13:00 KST/);
      assert.doesNotMatch(visible, /source_as_of|received_at|2026-11-10T04:00:00/);
      assert.match(caption, /title="source_as_of 2026-11-10 · received_at 2026-11-10T04:00:00.000Z"/);
    }
    assert.equal(JSON.stringify(doc), before);
    const ledger = html.slice(html.indexOf('<summary>출처·시각·검증 장부</summary>'));
    assert.match(ledger, /source_as_of/);
    assert.match(ledger, /2026-11-10T04:00:00.000Z/);
  });
}

for (const template of ['existing', 'artboard-v2'] as const) {
  test(`D10: ${template} keeps ledger source identifiers intact without changing raw input`, () => {
    const original = input();
    const doc = JSON.parse(JSON.stringify(original).replaceAll(original.sources[0]!.id, 'SYNTHETIC-FY25'));
    const before = JSON.stringify(doc), html = renderReportInputHtml(doc, template);
    const ledger = html.slice(html.indexOf('<summary>출처·시각·검증 장부</summary>'));
    const ids = [...ledger.matchAll(/<td class="source-id" title="SYNTHETIC-FY25">SYNTHETIC-FY25<\/td>/g)];
    assert.ok(ids.length >= 2, 'both the source table and metric ledger keep complete identifiers');
    assert.doesNotMatch(ledger, /<td>SYNTHETIC-FY25<\/td>/);
    assert.match(html, /\.table-wrap td\.source-id,\.rs \.table-wrap td\.source-id\{white-space:nowrap\}/);
    assert.equal(JSON.stringify(doc), before);
    assert.match(html, /class="unit" title="KRW\/share">원\/주/);
  });
}

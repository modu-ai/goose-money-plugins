import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildReportInput, renderReportInputHtml } from '../src/report-pipeline.js';
import { withDefaultSession, mcpRender } from './r02-fixtures.js';
import { reportReadablePreview } from '../src/report-html-mcp.js';
import { reportMetricDisplayRows } from '../src/report-template-renderer.js';

function quote(percent: string) {
  const received = '2026-11-08T02:35:10.562Z';
  return buildReportInput({
    report_id: 'R01', subject: { id: 'fixture', name: '합성 표시 검수', venue: 'KRX', currency: 'KRW' },
    cutoff: received, received_at: received, display_timezone: 'Asia/Seoul',
    calls: [{ tool_name: 'get_market_snapshot', result: { structuredContent: {
      contract: 'moai.stock.quote-snapshot.v1', provider: 'kis', operation_id: 'kis.kr.quote.snapshot.v1', origin: 'synthetic',
      provenance: { source_as_of: null, available_at: received, origin: 'synthetic', validation_status: 'synthetic_fixture', provider_api_version: 'fixture' },
      data: { last: '193500', open: '180000', high: '196500', low: '179200', change: '1', change_percent: percent, volume: '35516270' },
    } } }],
  });
}

for (const value of ['13.0696', '-1234.560000', '0.000123456']) {
  test(`decimal display preserves fractional digits: ${value}`, () => {
    const html = renderReportInputHtml(quote(value), 'artboard-v2');
    const [integer, fraction] = value.split('.');
    const expected = integer!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fraction;
    assert.ok(html.includes(`<strong>${expected}<small>%</small>`), expected);
  });
}

test('metric tables group integers without changing the report input', () => {
  const doc = quote('13.0696');
  const before = JSON.stringify(doc);
  const html = renderReportInputHtml(doc, 'artboard-v2');
  assert.ok(html.includes('<td class="numeric">193,500</td>'));
  assert.equal(JSON.stringify(doc), before);
});

test('chart inputs have a visible pending state before JavaScript renders them', () => {
  const html = renderReportInputHtml(quote('13.0696'), 'artboard-v2');
  assert.ok(html.includes('class="echart'));
  assert.ok(html.includes('class="chart-runtime-status" role="status"'));
});

test('an unknown quote basis is not presented as the collection date', () => {
  const html = renderReportInputHtml(quote('13.0696'), 'artboard-v2');
  assert.ok(html.includes('기준일 미확인 · 수집시각은 출처 참조'));
  assert.ok(html.includes('원/주'));
  assert.ok(html.includes('<details class="source-records" open>'));
});

for (const state of ['engine_missing', 'failed', 'ready']) {
  test(`chart status reports ${state} without hiding the source table`, () => {
    const html = renderReportInputHtml(quote('13.0696'), 'artboard-v2');
    const runtime = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map(match => match[1]!).find(script => script.startsWith('(()=>{const specs='));
    assert.ok(runtime);
    const note = { textContent: '' };
    const element = { dataset: {} as Record<string,string>, closest: () => ({ querySelector: () => note }) };
    const body = {};
    const chart = { setOption() {}, resize() {} };
    const window = state === 'engine_missing' ? {} : { echarts: { init() { if (state === 'failed') throw Error('fixture'); return chart; } } };
    runInNewContext(runtime, Object.assign({
      window,
      document: { body, getElementById: (id: string) => id === 'chart-specs'
        ? { textContent: JSON.stringify({ echart: [{ id: 'chart', kind: 'bar', labels: ['표본'], values: [1] }], lwc: [] }) } : element },
      getComputedStyle(target: unknown) { assert.equal(target, body); return { getPropertyValue: () => '#902531' }; },
    }, window), { timeout: 1000 });
    assert.equal(element.dataset.renderStatus, state);
    assert.ok(note.textContent.includes('원수치'));
  });
}

test('MCP text preview carries readable values alongside the HTML resource', async () => {
  await withDefaultSession(async rpc => {
    const result = await mcpRender(rpc, quote('13.0696'), { template: 'artboard-v2' });
    assert.ok(result.result.content[0].text.includes('193,500'));
    assert.ok(result.result.content[0].text.includes('기준일 미확인'));
    assert.equal(result.result.structuredContent.host_rendering, 'not_observed');
    assert.ok(result.result.content.some((item: {type: string}) => item.type === 'resource_link'));
  });
});

test('text preview keeps rights-pending values hidden', () => {
  const doc = quote('987654321');
  for (const source of doc.sources) { source.kind = 'kis'; source.rights = 'pending'; }
  for (const metric of doc.metrics) metric.status = 'rights_pending';
  const text = reportReadablePreview(doc);
  assert.ok(!text.includes('987654321') && !text.includes('987,654,321'));
  assert.ok(text.includes('권리 확인 대기'));
});

test('text preview escapes HTML and table delimiters in supplied labels', () => {
  const doc = quote('13.0696');
  doc.subject.name = '<img src=x> | [외부 링크]';
  const text = reportReadablePreview(doc);
  assert.ok(!text.includes('<img'));
  assert.ok(text.includes('&lt;img src=x&gt;') && text.includes('\\|'));
});

test('identical finance aliases are displayed once without changing retained metrics', () => {
  const doc = quote('13.0696');
  const revenue = { ...doc.metrics[0]!, field_id: 'reported.revenue', label: '매출 · 원문 금액', value: '333605938000000' };
  doc.metrics = [revenue, { ...revenue, field_id: 'provider_finance.revenue' }];
  const before = JSON.stringify(doc);
  assert.equal(reportMetricDisplayRows(doc).length, 1);
  assert.equal(JSON.stringify(doc), before);
});

test('finance aliases with different values, periods, sources or units remain separate', () => {
  for (const changed of [{ value: '2' }, { period: 'different' }, { source_id: 'other' }, { unit: 'different' }, { scope: 'standalone' as const }]) {
    const doc = quote('13.0696');
    const revenue = { ...doc.metrics[0]!, field_id: 'reported.revenue', label: '매출 · 원문 금액' };
    doc.metrics = [revenue, { ...revenue, field_id: 'provider_finance.revenue', ...changed }];
    assert.equal(reportMetricDisplayRows(doc).length, 2);
  }
});

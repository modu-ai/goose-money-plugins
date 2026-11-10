// Issue #52 D6 (user decision 2026-11-10): report web fonts always load from a CDN when the report is opened.
// Completion criteria (#52 comment 6758795393): fonts only; fixed version-pinned URLs that carry nothing about the
// report or the reader; CSP opens font-src to the reviewed CDN paths only and keeps connect-src 'none' and the rest;
// no Referer; fallback fonts when the CDN is blocked; docs say what actually happens.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildReportInput, renderReportInputHtml } from '../src/report-pipeline.js';

const PRETENDARD = 'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/';
const MARUBURI = 'https://cdn.jsdelivr.net/npm/@kfonts/maruburi@0.1.0/';
const GOWUN = 'https://cdn.jsdelivr.net/npm/@fontsource/gowun-batang@5.3.0/';
const PINNED = [PRETENDARD, MARUBURI, GOWUN];
const ossDir = fileURLToPath(new URL('../../../', import.meta.url));

const wrap = (structuredContent: unknown) => ({ structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] });
function html(subjectId: string, name: string, received: string): string {
  const quote = {
    contract: 'moai.stock.quote-snapshot.v1', provider: 'kis', operation_id: 'kis.kr.quote.snapshot.v1', origin: 'synthetic',
    provenance: { source_as_of: received.slice(0, 10), available_at: received, origin: 'synthetic', validation_status: 'synthetic_fixture', provider_api_version: 'fixture-v1' },
    data: { last: '12345', open: '12000', high: '12500', low: '11900', change: '-1345', change_percent: '2.87', volume: '3336059380000' },
  };
  return renderReportInputHtml(buildReportInput({ report_id: 'R01', subject: { id: subjectId, name, venue: 'KRX', currency: 'KRW' }, cutoff: received, display_timezone: 'Asia/Seoul', received_at: received, calls: [{ tool_name: 'get_market_snapshot', result: wrap(quote) }] }));
}
const first = (): string => html('000660', '검토용 종목', '2026-10-23T04:00:00.000Z');
const csp = (page: string): string => /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(page)?.[1] ?? '';
const fontUrls = (page: string): string[] => [...page.matchAll(/url\((https?:[^)]+)\)/g)].map((match) => match[1]!);

test('D6: fonts come only from the three version-pinned CDN paths (Pretendard, MaruBuri 400/700, Gowun Batang 400/700)', () => {
  const urls = fontUrls(first());
  // The report CSS uses exactly these three web fonts (body/numbers, paragraphs, headings via --serif).
  assert.deepEqual(PINNED.map((path) => urls.filter((url) => url.startsWith(path)).length), [92, 2, 190]);
  assert.equal(urls.length, 284, 'no other external url()');
  assert.ok(urls.every((url) => url.endsWith('.woff2') && !url.includes('?') && !url.includes('#')), 'plain font files, no query or fragment');
  assert.ok(urls.includes(`${MARUBURI}MaruBuri-Regular.woff2`) && urls.includes(`${MARUBURI}MaruBuri-Bold.woff2`));
});

test('D6: font URLs carry nothing about the report — two different reports request the same set', () => {
  const other = html('005930', '다른 종목', '2026-11-10T01:06:22.361Z');
  assert.deepEqual(fontUrls(other), fontUrls(first()));
});

test('D6: CSP opens font-src to the three pinned CDN paths only; every other directive stays closed', () => {
  assert.equal(
    csp(first()),
    `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src ${PINNED.join(' ')}; object-src 'none'; base-uri 'none'; form-action 'none'`,
  );
});

test('D6: every web font family named in the report CSS has a CDN @font-face', () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(first())?.[1] ?? '';
  const declared = new Set([...css.matchAll(/@font-face\{font-family:'([^']+)'/g)].map((match) => match[1]));
  assert.deepEqual([...declared].sort(), ['Gowun Batang', 'MaruBuri', 'Pretendard']);
  for (const family of ['Gowun Batang', 'MaruBuri', 'Pretendard']) assert.ok(css.replace(/@font-face\{[^}]*\}/g, '').includes(family), `${family} is used`);
});

test('D6: the page sends no Referer with font requests', () => {
  assert.match(first(), /<meta name="referrer" content="no-referrer">/);
});

test('D6: every font declaration that names a web font ends in an installed or generic fallback', () => {
  const page = first();
  const css = /<style>([\s\S]*?)<\/style>/.exec(page)?.[1] ?? '';
  // CSS declarations, minus the @font-face rules themselves (which define the family rather than use it).
  const declarations = [...css.replace(/@font-face\{[^}]*\}/g, '').matchAll(/font(?:-family)?:([^;}]*(?:Pretendard|MaruBuri)[^;}]*)/g)].map((match) => match[1]!.trim());
  assert.ok(declarations.length > 5, 'the scan sees the report font stacks');
  assert.deepEqual(declarations.filter((value) => !/(?:sans-serif|serif|system-ui)$/.test(value)), []);
  // Chart text is drawn by ECharts from its own fontFamily option.
  const chartFonts = [...page.matchAll(/fontFamily:'([^']*)'/g)].map((match) => match[1]!);
  assert.ok(chartFonts.length > 0, 'the chart runtime sets a font');
  assert.deepEqual(chartFonts.filter((value) => !/sans-serif$/.test(value)), []);
  assert.ok(css.includes('font-display:swap'), 'text shows in the fallback font while (or if never) the web font loads');
});

test('D6: README and SKILL.md say an opened report fetches fonts from the CDN, and the tools themselves still do not', () => {
  const readme = readFileSync(`${ossDir}README.md`, 'utf8');
  const skill = readFileSync(`${ossDir}skills/goose/SKILL.md`, 'utf8');
  for (const text of [readme, skill]) {
    assert.match(text, /보고서를 열면 브라우저가 글꼴[^.]*cdn\.jsdelivr\.net/);
    assert.match(text, /대체 글꼴/);
  }
  const capabilities = JSON.parse(readFileSync(`${ossDir}CAPABILITIES.json`, 'utf8')) as { local_html_report_renderer: Record<string, unknown> };
  assert.equal(capabilities.local_html_report_renderer.external_requests, false, 'rendering itself makes no request');
  assert.match(String(capabilities.local_html_report_renderer.opened_report_font_requests), /cdn\.jsdelivr\.net/);
});

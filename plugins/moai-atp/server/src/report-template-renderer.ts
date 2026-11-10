import { ARTBOARD_ADAPTER_CSS, REPORT_TYPOGRAPHY_CSS } from './report-artboard.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReportInput, ReportPlan } from './report-pipeline.js';
import { renderMissingBlockText } from './report-presentation.js';

const ASSET_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/report-runtime');
const ARTBOARD_CSS = readFileSync(resolve(ASSET_DIR, 'artboard-report-v2.css'), 'utf8');
const ECHARTS = readFileSync(resolve(ASSET_DIR, 'echarts-6.1.0.min.js'), 'utf8');
const LWC = readFileSync(resolve(ASSET_DIR, 'lightweight-charts-5.2.1.js'), 'utf8');
const ORIGINAL_TEMPLATE_CSS = readFileSync(resolve(ASSET_DIR, 'original-report-layout.css'), 'utf8');
const STOCK_SAMPLE_CSS=readFileSync(resolve(ASSET_DIR,'stock-sample-report.css'),'utf8');
const STOCK_SAMPLE_LOGO='data:image/png;base64,'+readFileSync(resolve(ASSET_DIR,'stock-sample-logo.png')).toString('base64');
const THEME = readFileSync(resolve(ASSET_DIR, 'moai-report-theme.css'), 'utf8');
// #52 D6 (user decision 2026-11-10): web fonts load from these version-pinned CDN paths when a report is opened —
// Pretendard (sans), MaruBuri (paragraph serif) and Gowun Batang (--serif headings).
// The URLs are fixed (no report or reader data), CSP font-src names only these paths, and the page sends no Referer.
const FONT_CDN_PATHS = [
  'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/',
  'https://cdn.jsdelivr.net/npm/@kfonts/maruburi@0.1.0/',
  'https://cdn.jsdelivr.net/npm/@fontsource/gowun-batang@5.3.0/',
] as const;
const FONT_CSS = readFileSync(resolve(ASSET_DIR, 'report-fonts-cdn.css'), 'utf8');
if ([...FONT_CSS.matchAll(/url\(([^)]+)\)/g)].some((match) => !FONT_CDN_PATHS.some((path) => match[1]!.startsWith(path)))) throw new Error('unpinned_font_url');
const PELE_FLOW = readFileSync(resolve(ASSET_DIR, 'data-pipeline-pele.svg'), 'utf8');
if (/<script\b|<foreignObject\b|\son[a-z]+\s*=|javascript:/i.test(PELE_FLOW)) throw new Error('unsafe_pele_asset');

const SPECIAL_VISUAL_CSS = `.matrix-figure,.timeline-figure,.pele-figure{margin:18px 0 22px}.matrix-figure figcaption,.timeline-figure figcaption,.pele-figure figcaption{font:600 13px/1.6 Pretendard,sans-serif;color:#5C5E62;margin:0 0 8px}.matrix-table th,.matrix-table td{min-width:88px}.event-timeline{list-style:none;margin:12px 0;padding:0 0 0 18px;border-left:2px solid #D4D6D8}.timeline-item{position:relative;padding:2px 0 20px 16px}.timeline-item:before{content:'';position:absolute;left:-24px;top:10px;width:10px;height:10px;border-radius:50%;background:var(--chart-1);border:2px solid #fff;box-shadow:0 0 0 1px #D4D6D8}.timeline-item time{display:block;font:600 12px/1.5 Pretendard,sans-serif;color:#5C5E62}.timeline-item strong{display:block;font:700 16px/1.5 Pretendard,sans-serif}.timeline-item p{margin:4px 0;font:15px/1.65 MaruBuri,AppleMyungjo,Batang,Georgia,serif}.pele-graph{display:block;width:100%;height:auto;max-width:760px;margin:8px auto 14px;overflow:visible}.pele-edge path{fill:none;stroke:var(--chart-1);stroke-width:2}.pele-edge marker path{fill:var(--chart-1)}.pele-edge text{font:12px Pretendard,sans-serif;fill:#393C41;text-anchor:middle;paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}.pele-node rect{fill:#F4F4F4;stroke:#D4D6D8;stroke-width:1.25}.pele-node-evidence rect{fill:#EEF1F4;stroke:var(--chart-2)}.pele-node-event rect{fill:#F1EFF5;stroke:var(--chart-4)}.pele-node-outcome rect{fill:#EEF3F0;stroke:var(--chart-3)}.pele-node text{font:600 13px Pretendard,sans-serif;fill:#171A20}.pele-figure .table-wrap{margin-top:12px}@media(max-width:760px){.pele-graph{min-width:660px}.pele-figure{overflow:hidden}.event-timeline{padding-left:14px}}`;

const STOCK_ADAPTER_CSS=`
main#report{min-width:0}.panel{border:0;padding:0;margin:0}.panel h2{font:700 30px/1.6 var(--serif);margin:64px 0 26px;padding-top:24px;border-top:1px solid var(--ink)}.panel h3{font:700 23px/1.6 var(--serif);margin:38px 0 18px}.panel p,.panel li{font:18px/1.75 var(--sans);color:var(--ink)}.section-id{display:none}.table-wrap{max-width:100%;overflow:auto}.table-wrap table{table-layout:auto;font-size:18px}.table-wrap th{font-size:17px}.table-wrap td{font-size:18px;padding:14px 18px;white-space:normal}.table-wrap td.numeric{font-weight:650;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.table-wrap td:not(.numeric){text-align:left}.kpis{gap:0;padding:0;grid-template-columns:repeat(4,minmax(0,1fr))}.kpi{background:transparent;padding:24px 22px}.kpi small{display:inline}.kpi>small{display:block;margin:8px 0 0;font-size:13px}.lead-summary p{font-size:16px}.source-records{margin:28px 0}.source-records>summary{font:700 18px/1.6 var(--sans);cursor:pointer}.stock-footer{margin:0 48px 32px;font:14px/1.6 var(--sans)}.opinion{margin:28px 0}.moai-column>p strong{font-weight:750;text-decoration:none}.report-hero blockquote{font-size:20px}.logo-window{flex-shrink:0}.reading-rail nav{display:flex;flex-direction:column}.panel summary{font-size:15px}.status{font-family:var(--sans)}
@media(max-width:800px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.kpi{border:0;border-right:1px solid var(--line);padding:18px 12px!important}.panel h2{font-size:25px;margin-top:48px}.panel h3{font-size:21px}.panel p,.panel li{font-size:18px;line-height:1.7}.reading-rail nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.stock-footer{margin:0 24px 24px}.table-wrap td{padding:12px 10px}.reading-layout{min-width:0}.report-hero blockquote{font-size:18px}}
@media print{.panel h2{font-size:18pt}.panel p,.panel li{font-size:11pt}.stock-footer{margin:16px 0}.source-records:not([open]){display:none}.chart-scroll,.table-wrap{overflow:visible}}
`;
const BASE_CSS = `
:root{color-scheme:light;--ink:#171A20;--muted:#5C5E62;--paper:#fff;--bg:#fff;--line:#D4D6D8;--soft:#F4F4F4;--accent:#B4141A;--chart-1:var(--color-chart-1);--chart-2:var(--color-chart-2);--chart-3:var(--color-chart-3);--chart-4:var(--color-chart-4);--chart-5:var(--color-chart-5)}
*{box-sizing:border-box}html{scroll-behavior:auto}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.75 MaruBuri,AppleMyungjo,Batang,Georgia,serif}.shell{max-width:1120px;margin:auto;padding:36px 32px 64px}.topline{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;border-bottom:1px solid #E8E8E8;padding:0 0 18px}.brand,.eyebrow,.badge,h1,h2,h3,nav,table,button,.meta,.section-id,.status,.ui,figcaption,footer,summary{font-family:Pretendard,-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif}.brand{font-weight:800;letter-spacing:.02em}.badge{font-size:13px;font-weight:700;background:#F4F4F4;border:1px solid #D4D6D8;border-radius:4px;padding:5px 10px}.hero{padding:34px 0 22px}.eyebrow{font-size:13px;color:#B4141A;font-weight:700;letter-spacing:.06em}.hero h1{font-size:clamp(30px,4vw,44px);line-height:1.2;letter-spacing:-.035em;margin:12px 0}.lead{font-size:18px;color:#393C41;max-width:850px}.meta{display:flex;gap:10px 22px;flex-wrap:wrap;color:#5C5E62;font-size:13px}.notice{background:#F4F4F4;border-left:3px solid #D71920;padding:14px 18px;margin:18px 0 22px;color:#393C41}.layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:32px}.rail{position:sticky;top:14px;align-self:start;border-top:1px solid #E8E8E8;padding-top:14px}.rail a{display:block;color:#393C41;padding:5px 0;text-decoration:none;font:14px Pretendard,sans-serif}.content{min-width:0}.panel{border:0;border-top:1px solid #E8E8E8;padding:24px 0;margin:0;min-width:0}.panel h2{font:800 23px/1.4 Pretendard,sans-serif;letter-spacing:-.025em;margin:0 0 12px}.panel h3{font:700 17px/1.5 Pretendard,sans-serif}.panel p,.panel li{font:18px/1.85 MaruBuri,AppleMyungjo,Batang,Georgia,serif;color:#393C41}.muted,.caption,figcaption,small{color:#5C5E62;font:13px/1.6 Pretendard,sans-serif}.section-id{font-size:13px;font-weight:700;color:#5C5E62}.status{display:inline-block;font-size:12px;font-weight:700;color:#393C41;background:#F4F4F4;border:1px solid #D4D6D8;padding:3px 7px;border-radius:3px}.table-wrap{max-width:100%;overflow:auto;border-top:1px solid #D4D6D8;margin:12px 0 20px}table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.55;font-variant-numeric:tabular-nums}th,td{padding:10px 12px;border-bottom:1px solid #E8E8E8;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#F4F4F4;color:#171A20;font-weight:700}td{color:#393C41}.numeric{text-align:right;white-space:nowrap}.chart-box{margin:18px 0 8px;min-width:0}.chart-scroll{overflow-x:auto;max-width:100%}.echart{height:340px;min-width:300px}.lwc-chart{height:360px;min-width:300px}.chart-caption{margin-top:8px}.diagram{max-width:760px;margin:16px auto}.diagram svg{display:block;width:100%;height:auto;max-width:100%}.field-list{font:13px/1.7 Pretendard,sans-serif;overflow-wrap:anywhere}.block-missing{margin:16px 0;padding:12px 16px;background:#F7F7F7;border-left:3px solid #A8ADB4;color:#5C5E62;font:14px/1.7 Pretendard,sans-serif}.block-note{margin:10px 0;color:#5C5E62;font:13px/1.6 Pretendard,sans-serif}.actions{display:flex;flex-wrap:wrap;gap:10px}.skip{position:absolute;left:-1000px}.skip:focus{left:12px;top:12px;background:white;padding:10px;z-index:2}a{color:#244BBA;text-underline-offset:3px}button{border:1px solid #737780;background:white;color:#171A20;border-radius:4px;padding:9px 12px;cursor:pointer}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #3E6AE1;outline-offset:3px}details{border-top:1px solid #D4D6D8;margin-top:12px;padding-top:10px}summary{font-weight:700;cursor:pointer}.legend{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.legend button[aria-pressed=false]{opacity:.55}footer{border-top:1px solid #E8E8E8;padding-top:18px;margin-top:24px;color:#5C5E62;font-size:12px}
${ORIGINAL_TEMPLATE_CSS}${SPECIAL_VISUAL_CSS}${THEME}
.table-wrap td.unit,.rs .table-wrap td.unit{white-space:nowrap}
.table-wrap td.source-id,.rs .table-wrap td.source-id{white-space:nowrap}
@media(max-width:760px){.shell{padding:24px 20px 44px}.layout{grid-template-columns:1fr;gap:14px}.rail{position:static;display:flex;gap:4px 14px;flex-wrap:wrap;padding:12px 0}.rail strong{width:100%}.rail a{padding:3px 0}.hero{padding:26px 0 16px}.panel{padding:20px 0}.panel p,.panel li{font-size:17px}.echart,.lwc-chart{height:300px}}
@media(max-width:420px){.shell{padding:20px 16px 36px}.topline{align-items:flex-start}.hero h1{font-size:30px}.meta{display:block}.meta span{display:block;margin:3px 0}.table-wrap{max-width:100%;margin-right:0;overflow-x:auto;overscroll-behavior-inline:contain}th,td{padding:10px 12px;font-size:inherit}table{font-size:18px}th{font-size:17px}td{font-size:18px}}
@media print{.shell{max-width:none;padding:0}.layout{display:block}.rail,.actions{display:none}.panel{break-inside:auto;padding:16px 0}.hero{padding:16px 0}.chart-box,figure,.diagram{break-inside:avoid}.echart,.lwc-chart{height:300px}.table-wrap{overflow:visible}th,td{white-space:normal;font-size:9pt}.panel p,.panel li{font-size:11pt;line-height:1.6}}
`;

const E = (value: unknown): string => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const jsonForScript = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const STATUS_LABEL: Record<string, string> = { partial:'부분 입력', error:'오류', not_run:'미실행', rights_pending:'권리 확인 대기' };

function sourceMayDisplay(doc: ReportInput, sourceId: string): boolean {
  const source = doc.sources.find((item) => item.id === sourceId);
  if (!source) return false;
  if (doc.mode === 'synthetic') return source.kind === 'synthetic' && source.rights === 'synthetic_only' && source.validation_status === 'synthetic_fixture';
  if (source.kind === 'user_supplied') return (doc.mode === 'supplied' || doc.mode === 'mixed') && source.rights === 'local_view' && source.validation_status === 'unverified';
  return source.rights === 'local_view' && ['provider_shape_checked','independently_reconciled'].includes(source.validation_status ?? '');
}
function numericSeries(values: readonly (string | null)[]): number[] | null {
  const result: number[] = [];
  for (const value of values) {
    if (value === null) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) return null;
    result.push(number);
  }
  return result;
}
/** A table cell: plain text, or display text whose raw value stays in the title attribute (#52 D5). */
type TableCell = string | { text: string; title: string; nowrap?: 'unit' | 'source-id' };
function reportTable(headers: string[], rows: Array<Array<TableCell>>): string {
  const head = headers.map((value) => `<th scope="col">${E(value)}</th>`).join('');
  const cell = (value: TableCell): string => {
    const text = typeof value === 'string' ? value : value.text;
    const title = typeof value === 'string' ? '' : ` title="${E(value.title)}"`;
    const cellClass = typeof value !== 'string' && value.nowrap ? value.nowrap : /^[+-]?[0-9][0-9,]*(?:\.[0-9]+)?(?:%|원|주)?$/.test(text) ? 'numeric' : '';
    return `<td${cellClass ? ` class="${cellClass}"` : ''}${title}>${E(text)}</td>`;
  };
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map(cell).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">확인 가능한 입력이 없습니다.</td></tr>`;
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="가로 스크롤 표"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
type RenderChart = {
  id:string;section_id:string;kind:'bar'|'line'|'donut'|'scatter';title:string;source_id:string;source_ids?:string[];unit?:string;
  labels:string[];values?:number[];metric_ids:string[];x_values?:number[];y_values?:number[];x_unit?:string;y_unit?:string;
};
function makeChartSpecs(doc: ReportInput, plan: ReportPlan) {
  const echart:RenderChart[]=[];
  for(const [index,visual] of (doc.visuals??[]).entries()){
    if(!sourceMayDisplay(doc,visual.source_id)||('source_ids' in visual&&visual.source_ids?.some(id=>!sourceMayDisplay(doc,id))))continue;
    if(visual.kind==='matrix'||visual.kind==='timeline'||visual.kind==='pele')continue;
    if(visual.kind==='scatter'){
      const x=numericSeries(visual.x_values),y=numericSeries(visual.y_values);if(!x||!y)continue;
      echart.push({id:`chart-echarts-${index+1}`,section_id:visual.section_id,kind:'scatter',title:visual.title,source_id:visual.source_id,labels:visual.labels,x_values:x,y_values:y,x_unit:visual.x_unit,y_unit:visual.y_unit,metric_ids:visual.metric_ids});
    }else{
      const values=numericSeries(visual.values);if(!values)continue;
      echart.push({id:`chart-echarts-${index+1}`,section_id:visual.section_id,kind:visual.kind,title:visual.title,source_id:visual.source_id,...(visual.source_ids?{source_ids:visual.source_ids}:{}),labels:visual.labels,values,unit:visual.unit,metric_ids:visual.metric_ids});
    }
  }
  if(doc.chart&&sourceMayDisplay(doc,doc.chart.source_id)){
    const values=numericSeries(doc.chart.values);
    if(values)echart.push({id:'chart-echarts-legacy',section_id:doc.chart.section_id??(doc.report_id==='R01'?'R01.X01':'charts'),kind:'bar',title:doc.chart.title,source_id:doc.chart.source_id,labels:doc.chart.labels,values,unit:doc.chart.unit,metric_ids:doc.chart.metric_ids});
  }
  const timeSeriesSection=doc.report_id==='R01'?'R01.X01':doc.time_series?plan.sections.find(section=>{
    const layout=plan.presentation?.sections.find(item=>item.id===section.id);
    return layout?.blocks.includes('line')&&(section.field_ids.includes(doc.time_series!.series[0]!.field_id)||section.metric_ids.includes('metric.ma20'));
  })?.id:undefined;
  const lwc=doc.time_series&&timeSeriesSection&&sourceMayDisplay(doc,doc.time_series.source_id)
    ?[{id:'chart-lwc',section_id:timeSeriesSection,title:doc.time_series.title,source_id:doc.time_series.source_id,dates:doc.time_series.dates,unit:doc.time_series.unit,adjustment:doc.time_series.adjustment,series:doc.time_series.series.map((series)=>({name:series.label,values:series.values}))}]
    :[];
  return {echart,lwc};
}
function chartFigure(spec:RenderChart,doc:ReportInput):string {
  const xUnit=spec.x_unit??spec.unit??'';const yUnit=spec.y_unit??spec.unit??'';
  const rows=spec.kind==='scatter'
    ?spec.labels.map((label,index)=>[label,groupIntegerDigits(String(spec.x_values?.[index]??'—')),xUnit,groupIntegerDigits(String(spec.y_values?.[index]??'—')),yUnit])
    :spec.labels.map((label,index)=>[label,groupIntegerDigits(String(spec.values?.[index]??'—')),spec.unit??'']);
  const table=spec.kind==='scatter'
    ?reportTable(['대상','X 원수치',xUnit,'Y 원수치',yUnit],rows)
    :reportTable(['구분','원수치',spec.unit??'단위'],rows);
  const caption=`${spec.kind==='scatter'?'Apache ECharts 6.1.0 · 산점도':'Apache ECharts 6.1.0 · '+spec.kind} · ${(spec.source_ids??[spec.source_id]).map(id=>sourceCaption(doc,id)).join(' / ')} · ${spec.source_ids?'확인된 배율로 환산한 표시값입니다.':'표의 원수치가 기준입니다.'}`;
  return `<figure class="chart-box"><div class="chart-scroll" tabindex="0" role="region" aria-label="${E(spec.title)} 차트 가로 탐색"><div id="${E(spec.id)}" class="echart ${spec.kind==='scatter'?'wide-chart':''}" role="img" aria-label="${E(spec.title)} · ${E(doc.mode)}"></div></div><p class="chart-runtime-status" role="status">차트 입력은 있으나 화면 생성은 아직 확인되지 않았습니다. 아래 원수치를 확인하세요.</p><figcaption class="chart-caption">${caption}</figcaption></figure>${table}`;
}
function sourceCaption(doc:ReportInput,sourceId:string):string {
  const source=doc.sources.find(item=>item.id===sourceId);
  const rawTime=`source_as_of ${source?.source_as_of??'미제공'} · received_at ${source?.received_at??source?.observed_at??'미제공'}`;
  return `<span title="${E(rawTime)}">${E(source?.provider?.toUpperCase()??source?.kind??'출처 없음')} · 출처 기준시각 ${E(displayInstant(source?.source_as_of??'미제공',doc.display_timezone))} · 수집시각 ${E(displayInstant(source?.received_at??source?.observed_at??'미제공',doc.display_timezone))} · ${E(source?.id??'출처 없음')}</span>`;
}
function matrixVisualHtml(visual:Extract<NonNullable<ReportInput['visuals']>[number],{kind:'matrix'}>,doc:ReportInput):string {
  const rows=visual.rows.map((label,row)=>[label,...visual.columns.map((_,column)=>visual.values[row*visual.columns.length+column]??'—')]);
  return `<figure class="matrix-figure"><figcaption>${E(visual.title)} · ${E(visual.unit)} · ${sourceCaption(doc,visual.source_id)}</figcaption><div class="matrix-table">${reportTable(['비교축',...visual.columns],rows)}</div></figure>`;
}
function timelineVisualHtml(visual:Extract<NonNullable<ReportInput['visuals']>[number],{kind:'timeline'}>,doc:ReportInput):string {
  const typeLabel={occurred:'발생',published:'공개',effective:'효력',observed:'관측'} as const;
  const events=visual.events.map(event=>`<li class="timeline-item"><time datetime="${E(event.when)}">${E(typeLabel[event.time_kind])} · ${E(event.when)}</time><strong>${E(event.title)}</strong>${event.detail?`<p>${E(event.detail)}</p>`:''}</li>`).join('');
  return `<figure class="timeline-figure"><figcaption>${E(visual.title)} · ${sourceCaption(doc,visual.source_id)}</figcaption><ol class="event-timeline">${events}</ol></figure>`;
}
function peleVisualHtml(visual:Extract<NonNullable<ReportInput['visuals']>[number],{kind:'pele'}>,doc:ReportInput):string {
  const width=730,rowHeight=112,rows=Math.ceil(visual.nodes.length/3),height=Math.max(142,rows*rowHeight+28);
  const positions=new Map(visual.nodes.map((node,index)=>[node.id,{x:24+(index%3)*238,y:22+Math.floor(index/3)*rowHeight}]));
  const markerId=`pele-arrow-${visual.section_id.replace(/[^A-Za-z0-9_-]/g,'-')}`;
  const edges=visual.edges.map(edge=>{
    const from=positions.get(edge.from)!,to=positions.get(edge.to)!;
    const x1=from.x+(to.x>=from.x?188:0),y1=from.y+30,x2=to.x+(to.x>=from.x?0:188),y2=to.y+30;
    const evidence=edge.metric_ids.join(', ');
    return `<g class="pele-edge"><path d="M ${x1} ${y1} L ${x2} ${y2}" marker-end="url(#${markerId})"/><text x="${(x1+x2)/2}" y="${(y1+y2)/2-7}">${E(edge.label)}</text><title>근거 필드 ${E(evidence)}</title></g>`;
  }).join('');
  const nodes=visual.nodes.map(node=>{const point=positions.get(node.id)!;return `<g class="pele-node pele-node-${E(node.role??'entity')}"><rect x="${point.x}" y="${point.y}" width="188" height="60" rx="5"/><text x="${point.x+94}" y="${point.y+35}" text-anchor="middle">${E(node.label)}</text></g>`;}).join('');
  const evidenceRows=visual.edges.map(edge=>[visual.nodes.find(node=>node.id===edge.from)?.label??edge.from,edge.label,visual.nodes.find(node=>node.id===edge.to)?.label??edge.to,edge.metric_ids.join(', ')]);
  const svg=`<svg class="pele-graph" viewBox="0 0 ${width} ${height}" role="img" aria-label="${E(visual.title)} 관계도"><title>${E(visual.title)}</title><desc>합성 또는 권리 확인된 근거에 연결된 관계 도식입니다.</desc><defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z"/></marker></defs>${edges}${nodes}</svg>`;
  return `<figure class="pele-figure"><figcaption>${E(visual.title)} · Pele-style inline SVG · ${sourceCaption(doc,visual.source_id)}</figcaption>${svg}${reportTable(['시작','관계','도착','근거 필드'],evidenceRows)}</figure>`;
}
// Wording per issuer-mapping status and per acquisition kind of an explicit-subjects comparison (contract 1.2).
// None of it speaks of a live or fresh query: a receipt proves this process issued the source, not when it was read.
const MAPPING_NOTE:Record<string,string>={verified_by_dart_filing:'DART 공시 목록으로 확인',synthetic_fixture_match:'합성 공시 목록과 일치 · 실제 확인 아님',unverified:'미확인'};
const ACQUISITION_NOTE:Record<string,string>={process_receipt:'이 프로세스가 발급한 출처 영수증 · 조회 시점은 보증하지 않음',synthetic_fixture:'합성 fixture · 실제 자료 아님',caller_supplied_unverified:'호출자가 제공한 입력 · 이 프로세스가 검증하지 않음'};
/** The comparison section: subjects as columns in request order, nothing ranked, converted or subtracted. */
function comparisonSectionHtml(doc:ReportInput):string {
  const block=doc.comparison;
  if(!block)return '';
  const nameOf=new Map(block.subjects.map((subject)=>[subject.id,subject.name]));
  const ownerOf=new Map(block.source_bindings.map((binding)=>[binding.source_id,binding.subject_id]));
  const fieldLabel=(row:typeof block.rows[number]):string=>{
    const cell=row.cells.find((candidate)=>candidate.source_id!==null);
    const metric=doc.metrics.find((candidate)=>candidate.field_id===row.field_id&&(cell===undefined||candidate.source_id===cell.source_id));
    if(!metric)return row.field_id;
    const prefix=`${nameOf.get(ownerOf.get(metric.source_id)??'')??''} · `;
    return `${metric.label.startsWith(prefix)?metric.label.slice(prefix.length):metric.label} (${row.field_id})`;
  };
  // Cell text and basis table (SPEC-ATP-R02-002). Every cell is decided by the first rule that applies: the
  // rights / mapping words, then value_missing, then an absent designated metric (`(기준 —)`), then the basis row.
  // The designated metric is the first metric with the row's field_id and THIS cell's source_id, not fieldLabel's pick.
  const basisKeys:string[]=[];
  const basisRows:string[][]=[];
  const basisNumber=(metric:typeof doc.metrics[number]):number=>{
    const source=doc.sources.find((item)=>item.id===metric.source_id);
    const dart=/^(\d{4}):FY:(?:CFS|OFS):(?:IS|CIS|BS|CF):.*:\d{14}$/.exec(metric.period);
    const undated=source!==undefined&&(source.source_as_of===null||source.source_as_of===undefined)&&metric.period===(source.received_at??source.observed_at);
    const entry=[metric.unit,undated?'period_unconfirmed':dart?`사업연도 ${dart[1]} · 보고서 코드 11011`:metric.period,metric.period_kind,metric.scope,metric.currency??'—',metric.unit.includes('배율 미확인')?'scale_unconfirmed':metric.scale];
    const key=JSON.stringify(entry);
    let index=basisKeys.indexOf(key);
    if(index<0){index=basisKeys.push(key)-1;basisRows.push([`기준 ${index+1}`,...entry]);}
    return index+1;
  };
  const shown=(row:typeof block.rows[number],cell:typeof block.rows[number]['cells'][number]|undefined):string=>{
    const metric=cell&&cell.source_id!==null?doc.metrics.find((candidate)=>candidate.field_id===row.field_id&&candidate.source_id===cell.source_id):undefined;
    const words=[
      ...(metric?.status==='rights_pending'||(cell&&cell.value!==null&&cell.source_id!==null&&!sourceMayDisplay(doc,cell.source_id))?['rights_not_confirmed']:[]),
      ...(metric?.missing_reason==='issuer_mapping_unverified'?['issuer_mapping_unverified']:[]),
    ];
    if(words.length>0)return `— (${words.join(', ')})`;
    if(!cell||cell.value===null||cell.source_id===null)return '— (value_missing)';
    if(!metric)return `${cell.value} (기준 —)`;
    return `${cell.value} (기준 ${basisNumber(metric)})`;
  };
  const fields=reportTable(['지표',...block.subjects.map((subject)=>subject.name),'비교 여부','사유 코드'],block.rows.map((row)=>[
    fieldLabel(row),...block.subjects.map((subject)=>shown(row,row.cells.find((cell)=>cell.subject_id===subject.id))),row.comparable?'비교 가능':'비교 불가',row.reasons.join(', ')||'—',
  ]));
  const basis=reportTable(['기준','단위','기간 기준','기간 종류','범위','통화','배율'],basisRows);
  const mappings=reportTable(['대상','종목 코드','기업 코드','대응 상태','증거 출처','일치 접수번호','공시 기업명(표시용)'],block.subjects.map((subject)=>{
    const mapping=block.mappings.find((candidate)=>candidate.subject_id===subject.id);
    return mapping?[subject.name,mapping.kis_symbol,mapping.corp_code,`${mapping.status} · ${MAPPING_NOTE[mapping.status]??''}`,mapping.evidence_source_id??'—',mapping.matched_rcept_nos.join(', ')||'—',mapping.corp_name??'—']:[subject.name,subject.kis_symbol,subject.corp_code_candidate,'—','—','—','—'];
  }));
  const acquisitions=reportTable(['출처','대상','취득 종류','설명'],block.acquisitions.map((label)=>[label.source_id,nameOf.get(ownerOf.get(label.source_id)??'')??'—',label.kind,ACQUISITION_NOTE[label.kind]??'']));
  return `<section class="panel" id="comparison" data-r02-comparison><h2>종목 비교</h2><p class="block-note">대상은 요청한 순서로 나열했습니다. 값은 받은 그대로의 원수치이며 환산하거나 계산하지 않았습니다. 기간·범위·통화·단위·배율이 하나라도 다르거나 값이 없으면 비교 불가로 표시합니다.</p><h3>지표별 비교</h3>${fields}<h3>값 기준표</h3>${basis}<h3>대상별 대응 상태</h3>${mappings}<h3>출처별 취득 종류</h3>${acquisitions}</section>`;
}
function specialVisualSections(doc:ReportInput):Map<string,Map<string,string[]>> {
  const bySection=new Map<string,Map<string,string[]>>();
  const add=(sectionId:string,kind:string,html:string)=>{let kinds=bySection.get(sectionId);if(!kinds){kinds=new Map();bySection.set(sectionId,kinds);}const items=kinds.get(kind)??[];items.push(html);kinds.set(kind,items);};
  for(const visual of doc.visuals??[]){if(!sourceMayDisplay(doc,visual.source_id))continue;if(visual.kind==='matrix')add(visual.section_id,'matrix',matrixVisualHtml(visual,doc));else if(visual.kind==='timeline')add(visual.section_id,'timeline',timelineVisualHtml(visual,doc));else if(visual.kind==='pele')add(visual.section_id,'pele',peleVisualHtml(visual,doc));}
  return bySection;
}

function chartSections(specs:ReturnType<typeof makeChartSpecs>,doc:ReportInput):{bySection:Map<string,Map<string,string[]>>;count:number} {
  const bySection=new Map<string,Map<string,string[]>>();
  const add=(sectionId:string,kind:string,html:string)=>{let kinds=bySection.get(sectionId);if(!kinds){kinds=new Map();bySection.set(sectionId,kinds);}const items=kinds.get(kind)??[];items.push(html);kinds.set(kind,items);};
  for(const spec of specs.echart)add(spec.section_id,spec.kind,chartFigure(spec,doc));
  for(const spec of specs.lwc){
    const source=doc.sources.find(item=>item.id===spec.source_id);
    const rows=spec.dates.map((date,index)=>[date,...doc.time_series!.series.map(series=>series.values[index]??'—')]);
    const html=`<figure class="chart-box"><div class="chart-scroll" tabindex="0" role="region" aria-label="Lightweight Charts 가격 시계열"><div id="${spec.id}" class="lwc-chart" role="img" aria-label="${E(spec.title)} · ${E(spec.unit)} · ${E(doc.mode)}"></div></div><p class="chart-runtime-status" role="status">차트 입력은 있으나 화면 생성은 아직 확인되지 않았습니다. 아래 원수치를 확인하세요.</p><figcaption class="chart-caption">Lightweight Charts 5.2.1 · ${E(spec.unit)} · ${E(spec.adjustment)} 가격 기준 · 거래일 기준축 · source_as_of ${E(source?.source_as_of??'미제공')} · received_at ${E(source?.received_at??source?.observed_at??'미제공')}.</figcaption><div class="legend" data-legend-for="${spec.id}"></div></figure>${reportTable(['거래일',...doc.time_series!.series.map(series=>series.label)],rows)}`;
    add(spec.section_id,'line',html);
  }
  return {bySection,count:specs.echart.length+specs.lwc.length};
}

/** Display-only digit grouping for a decimal string: the integer part is grouped, the fraction never is (#52 D4). */
export function groupIntegerDigits(value: string): string {
  const match = /^([+-]?)([1-9][0-9]{3,})(\.[0-9]+)?$/.exec(value);
  return match ? `${match[1]}${match[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${match[3] ?? ''}` : value;
}
// #52 D5 (user decision 2026-11-10): body tables use these words; the source ledger keeps the raw codes.
const METRIC_STATUS_LABELS: Record<string, string> = {
  provided: '제공값', provided_unverified: '제공값(미검증)', missing: '없음', not_run: '미실행', error: '오류',
  stale: '기준 시각 지남', rights_pending: '권리 확인 대기', synthetic: '합성 자료',
};
const METRIC_NOTE_LABELS: Record<string, string> = { cross_source_origin_mismatch:'합성 자료와 실제 자료는 함께 계산하지 않음',cross_source_basis_mismatch:'기간·회계 범위·통화·단위의 기준이 맞지 않거나 정규화되지 않음',cross_source_ambiguous_inputs:'실적 또는 추정치가 여러 개라 비교 대상을 확정할 수 없음',cross_source_provenance_missing:'계산에 필요한 출처 기록이 없음',cross_source_provenance_unverified:'출처의 표시 권한·검증 상태가 확인되지 않음',display_rights_not_confirmed:'자료 표시 권리 확인 대기', provider_field_missing_or_invalid: '공급자 응답에 값이 없거나 형식이 맞지 않음' };
export const metricStatusLabel = (code: string): string => METRIC_STATUS_LABELS[code] ?? code;
export const metricNoteLabel = (code: string): string => METRIC_NOTE_LABELS[code] ?? code;
/** An ISO instant as "YYYY-MM-DD HH:mm KST" in the document time zone; any other text is returned unchanged. */
export function displayInstant(value: string, timeZone: string): string {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  } catch { return value; }
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} ${timeZone === 'Asia/Seoul' ? 'KST' : timeZone}`;
}
/** A body-table cell that shows a readable form and keeps the raw value in title when the two differ. */
const readableCell = (raw: string, shown: string, nowrap = false): TableCell => (shown === raw && !nowrap ? raw : { text: shown, title: raw, ...(nowrap ? { nowrap: 'unit' as const } : {}) });
const sourceIdCell = (raw: string): TableCell => ({ text: raw, title: raw, nowrap: 'source-id' });
/** Collapse exact mapping aliases for display only; the raw ledger still uses doc.metrics. */
function metricBodyRows(doc: ReportInput, metrics = doc.metrics): TableCell[][] {
  const seen = new Set<string>();
  return metrics.filter(metric => {
    if (!/^(?:reported|provider_finance)\.(?:revenue|operating_profit)$/.test(metric.field_id)) return true;
    const key = JSON.stringify({ ...metric, field_id: metric.field_id.replace(/^provider_finance\./, 'reported.') });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(metric => {
    const source = doc.sources.find(item => item.id === metric.source_id);
    const visible = (metric.source_ids??[metric.source_id]).every(id=>sourceMayDisplay(doc,id)) && !['rights_pending','error','not_run','missing'].includes(metric.status);
    const status = visible ? metric.status : source?.rights === 'pending' ? 'rights_pending' : metric.status;
    const note = metric.missing_reason ?? '';
    const unit = metric.unit === 'KRW/share' ? '원/주' : metric.unit === 'shares' ? '주' : metric.unit === 'percent' ? '%' : metric.unit;
    const annual = /^(\d{4}):FY:(CFS|OFS):(IS|BS|CF):(.+):(\d{14})$/.exec(metric.period);
    const period = metric.period_kind === 'observation' && source?.source_as_of == null && metric.period === (source?.received_at ?? source?.observed_at)
      ? '기준일 미확인 · 수집시각은 출처 참조'
      : annual ? `${annual[1]}년 연간 · ${annual[2] === 'CFS' ? '연결' : '별도'} · ${annual[4]}` : displayInstant(metric.period,doc.display_timezone);
    return [metric.label,visible && metric.value !== null ? groupIntegerDigits(metric.value) : '—',readableCell(metric.unit,unit,true),readableCell(metric.period,period),readableCell(status,metricStatusLabel(status)),readableCell(note,metricNoteLabel(note))];
  });
}
/** Same rights checks and readable strings for the text fallback and body tables. */
export function reportMetricDisplayRows(doc: ReportInput, metrics = doc.metrics): string[][] {
  return metricBodyRows(doc,metrics).map(row => row.map(cell => typeof cell === 'string' ? cell : cell.text));
}
export function renderReportTemplate(doc: ReportInput, plan: ReportPlan, template: 'existing' | 'artboard-v2' = 'existing'): string {
  if (!['existing', 'artboard-v2'].includes(template)) throw new Error('invalid_report_template');
  if((doc.report_id==='R04'||doc.report_id==='R05')&&!doc.consultation)throw new Error('manual_consultation_only');
  const specs = makeChartSpecs(doc,plan);
  const sourceMap = new Map(doc.sources.map((source)=>[source.id,source]));
  const sourceRows = doc.sources.map((source)=>[
    sourceIdCell(source.id),source.provider ?? source.kind,source.operation_ref ?? '',source.source_as_of ?? '미제공',source.received_at ?? source.observed_at,source.validation_status ?? '미검증',source.rights,
  ]);
  const metricsRows = doc.metrics.map((metric)=>{
    const source = sourceMap.get(metric.source_id);
    const authorized = (metric.source_ids??[metric.source_id]).every(id=>sourceMayDisplay(doc,id)) && metric.status !== 'rights_pending' && metric.status !== 'error' && metric.status !== 'not_run' && metric.status !== 'missing';
    return [metric.label,authorized && metric.value !== null ? groupIntegerDigits(metric.value) : '—',metric.unit,metric.period,authorized ? metric.status : (source?.rights === 'pending' ? 'rights_pending' : metric.status),metric.missing_reason ?? '',metric.scale,sourceIdCell((metric.source_ids??[metric.source_id]).join(', '))];
  });
  const visualOutput = chartSections(specs,doc);
  const specialOutput = specialVisualSections(doc);
  const sectionHtml = doc.sections.map((section)=>{
    const routeSection = plan.sections.find((entry)=>entry.id===section.id);
    const layoutSection = plan.presentation?.sections.find((entry)=>entry.id===section.id);
    const linkedMetrics = doc.metrics.filter((metric)=>section.required_fields.includes(metric.field_id) || section.metric_ids?.includes(metric.field_id));
    const linkedSources = section.source_ids?.map((id)=>sourceMap.get(id)).filter((source)=>source!==undefined) ?? [];
    const sourceLabel = linkedSources.length ? '근거 '+linkedSources.map((source)=>E(source.id)).join(', ') : '연결된 응답 없음';
    const linkedTable = linkedMetrics.length
      ? reportTable(['지표','표시값','단위','기간','상태','비고'],metricBodyRows(doc,linkedMetrics))
      : '<p class="muted">이 섹션의 필수 원천 필드에 대응하는 구조화 지표가 아직 없습니다.</p>';
    let blockHtml = linkedTable;
    if(layoutSection){
      let tableUsed=false;
      blockHtml=layoutSection.blocks.map((kind)=>{
        if(kind==='table'){
          if(tableUsed)return '<p class="block-note">추가 표 슬롯입니다. 현재 계약은 섹션별 입력 행을 첫 표에 모아 표시합니다.</p>';
          tableUsed=true;return linkedTable;
        }
        if(kind==='bar'||kind==='line'||kind==='donut'||kind==='scatter'){
          const candidates=visualOutput.bySection.get(section.id)?.get(kind);
          const chart=candidates?.shift();
          return chart??`<div class="block-missing" role="note">${E(renderMissingBlockText(kind))}</div>`;
        }
        if(kind==='matrix'||kind==='timeline'||kind==='pele'){
          const candidates=specialOutput.get(section.id)?.get(kind);
          const visual=candidates?.shift();
          return visual??`<div class="block-missing" role="note">${E(renderMissingBlockText(kind))}</div>`;
        }
        return `<div class="block-missing" role="note">${E(renderMissingBlockText(kind))}</div>`;
      }).join('');
    }
    return `<section class="panel" id="${E(section.id)}"><span class="section-id">${E(section.id)} · ${E(routeSection?.title ?? '상세 섹션')}</span><h2>${E(routeSection?.title ?? section.id)}</h2><span class="status">${E(STATUS_LABEL[section.status] ?? section.status)}</span>${(section.body??section.missing_reason).split('\n\n').map((text,index)=>`<p>${index===0&&section.body?.includes('\n\n')?'<strong>'+E(text)+'</strong>':E(text)}</p>`).join('')}<p class="muted">${E(sourceLabel)} · 결측/차단: ${E(section.missing_reason)}</p>${blockHtml}<details><summary>필요 필드 보기</summary><p class="field-list">${E(section.required_fields.join(' · '))}</p></details></section>`;
  }).join('');
  const claims = doc.analysis_claims.filter(claim=>!claim.id.includes(".NARRATIVE.")&&!claim.id.includes(".GOOSE_OPINION.")).map((claim)=>`<li><strong>${E(claim.kind)} · ${E(claim.status)} · 신뢰도 ${E(claim.confidence)}</strong><p>${E(claim.text)}</p><small>출처: ${E(claim.source_ids.join(', ') || '없음')} · 필드: ${E(claim.metric_ids.join(', ') || '없음')}</small></li>`).join('');
  const nav = plan.sections.map((section)=>`<a href="#${E(section.id)}">${E(section.title)}</a>`).join('');
  const modeLabel = doc.mode==='synthetic'?'합성 fixture · 실제 자료 아님':doc.mode==='actual'?'실제 입력 · 검증 상태 표시':doc.mode==='mixed'?'혼합 입력 · 출처별 상태 표시':doc.sources.some(source=>source.kind==='user_supplied')?'사용자 제공 입력 · 외부 대사 전':'제공 입력 · 독립 검증 전';
  const notice = doc.consultation
    ? '개인 수동 입력 · 비공개. 공급자/계좌 확인값이 아니며 공개용 보고서로 재사용하지 않습니다. 실제 사용자 자료와 합성 fixture를 구분합니다.'
    : doc.mode==='synthetic'
    ? '이 문서는 합성 fixture로 생성했습니다. 실 KIS·DART 응답, 실제 시세 보고서 또는 투자 권고가 아닙니다.'
    : doc.sources.some(source=>source.kind==='user_supplied')
      ? '사용자가 이 보고서 생성에 직접 제공한 입력입니다. 외부 원장·가격·체결과 대사하지 않았으므로 제공 입력으로 표시하며, 계좌 조회나 주문은 수행하지 않습니다.'
      : '원천 권리 또는 독립 대조가 확인되지 않은 값은 숨기거나 미확인으로 표시합니다. 이 문서는 주문을 실행하지 않습니다.';
  const htmlCharts = plan.presentation
    ? `<p class="block-note">차트와 표는 해당 보고서 섹션의 선언된 블록 순서에 배치했습니다. 전체 원수치와 출처는 아래 장부에서 확인할 수 있습니다. 차트 ${visualOutput.count}개가 입력됐습니다.</p>`
    : [...visualOutput.bySection.values()].flatMap(byKind=>[...byKind.values()].flat()).join('');
  const pipelineDiagram = doc.report_id==='R01' ? `<figure class="diagram"><figcaption>자료 처리 단계 설명 · 수치·기업 관계·분석 근거가 아닌 일반 흐름도 · Pele 1.7.0 선렌더 SVG</figcaption>${PELE_FLOW}</figure>` : '';
  const chartJson = jsonForScript(specs);
  const sourceRowsHtml = reportTable(['출처 ID','공급자','작업','source_as_of','received_at','검증','권리'],sourceRows);
  const cutoffShown = displayInstant(doc.cutoff, doc.display_timezone);
  const cutoffHtml = cutoffShown === doc.cutoff ? E(doc.cutoff) : `<time datetime="${E(doc.cutoff)}" title="${E(doc.cutoff)}">${E(cutoffShown)}</time>`;
  const metricsHtml = reportTable(['지표','표시값','단위','기간','상태','비고','입력 배율','출처'],metricsRows);
  const rawSourceTables=(doc.source_tables??[]).filter(table=>sourceMayDisplay(doc,table.source_id)).map(table=>`<details class="source-records"><summary>${E(table.title)} · 수신 자료 확인</summary><p class="block-note">${E(table.coverage_note)}</p>${reportTable(table.columns,table.rows)}</details>`).join('');
  const opinionClaims=doc.analysis_claims.filter(claim=>claim.id.includes('.GOOSE_OPINION.'));
  const opinionLabels:Record<string,string>={conclusion:'종합 결론',rationale:'판단 이유',risks:'반대 신호와 한계',next_checks:'다음 확인'};
  const opinionConclusion=opinionClaims.find(claim=>claim.id.includes('.conclusion.'))?.text;
  const opinion=opinionClaims.length?`<section class="moai-column panel" id="goose-opinion"><h2>Goose 오피니언</h2><div class="opinion"><div class="opinion-label">종합 결론 <span>AI 해석 · 원천 사실과 구분</span></div><p class="decision-lead"><strong>${E(opinionConclusion??'판단에 필요한 근거를 확인하십시오.')}</strong></p></div>${['rationale','risks','next_checks'].map(group=>`<h3>${E(opinionLabels[group]??'분석 의견')}</h3>${opinionClaims.filter(claim=>claim.id.includes(`.${group}.`)).map(claim=>`<p>${E(claim.text)}</p>`).join('')}`).join('')}<p class="caption">모델이 작성한 해석은 독립 검증된 사실이 아닙니다. 자료가 부족한 부분은 전망을 확정하지 않습니다.</p></section>`:'';
  const grouped=groupIntegerDigits;
  // A hero card is one value under a fixed label; a comparison document has several subjects, so its table carries the data and the hero shows no card.
  const kpiCards=doc.comparison?[]:[['quote.last','수신 스냅샷 가격'],['quote.change_percent','스냅샷 전일 대비율'],['quote.volume','스냅샷 누적 거래량'],['metric.operating_margin','공시 연간 영업이익률']].flatMap(([field,label])=>{
    const found=doc.metrics.filter(metric=>metric.field_id===field&&metric.value!==null&&['synthetic','provided','provided_unverified'].includes(metric.status)&&sourceMayDisplay(doc,metric.source_id));if(found.length!==1)return [];const metric=found[0]!;const unit=metric.unit==='KRW/share'?'원/주':metric.unit==='shares'?'주':metric.unit;
    return [`<div class="kpi"><span>${E(label)}</span><strong>${E(grouped(metric.value!))}<small>${E(unit)}</small></strong><small>${field==='metric.operating_margin'?'동일 연간 손익 기준의 계산':'원천 기준일과 수집 시각은 출처 장부 참고'}</small></div>`];
  });
  const providers=[...new Set(doc.sources.map(source=>source.kind==='opendart'?'DART':source.kind==='kis'?'KIS':source.kind==='synthetic'?'합성 계약 자료':source.kind==='user_supplied'?'사용자 제공 자료':source.kind.toUpperCase()))].join(' · ');
  const heroSummary=opinionConclusion??doc.sections[0]?.body??'자료의 출처와 확인 범위를 먼저 살펴보십시오.';
  const body=`<a class="skip" href="#report-content">본문으로 이동</a><main id="report"${template==='artboard-v2'?' class="rs-main"':''}><header class="masthead"><div class="brand-lockup"><span class="logo-window"><img src="${STOCK_SAMPLE_LOGO}" alt="모두의 주식 — Stock for Everyone"></span><div class="brand-description"><strong>모두의 주식 · MoAI ATP</strong>근거를 확인하는 투자 자료 분석</div></div><div class="edition"><strong>${E(plan.title)}</strong><span>${E(modeLabel)}</span></div></header><section class="report-hero"><div class="eyebrow">${E(doc.subject.venue)} · ${E(doc.comparison?`비교 대상 ${doc.comparison.subjects.length}개`:doc.subject.id)}</div><h1>${E(doc.subject.name)}</h1><h2>${E(plan.title)}</h2><p>보고서 기준시각 ${cutoffHtml} · 표시 시간대 ${E(doc.display_timezone)}</p><blockquote><p>${E(heroSummary)}</p></blockquote>${kpiCards.length?`<div class="kpis">${kpiCards.join('')}</div>`:''}<p class="caption">${E(notice)}</p></section><div class="reading-layout"><aside class="reading-rail"><div class="rail-inner"><details open><summary>보고서 목차</summary><nav aria-label="보고서 목차">${doc.comparison?'<a href="#comparison">종목 비교</a>':''}${nav}<a href="#charts">차트와 계산</a><a href="#sources">수신 자료와 출처</a>${opinion?'<a href="#goose-opinion">Goose 오피니언</a>':''}</nav></details><p class="rail-note">관측한 사실, 계산과 해석을 구분해 읽으십시오. 출처별 기준일·수집시각·자료 범위가 다를 수 있습니다.</p></div></aside><article id="report-content">${comparisonSectionHtml(doc)}<section class="lead-summary"><h3>먼저 확인할 자료 범위</h3><p><strong>자료 출처</strong> ${E(providers||'아직 연결된 자료가 없습니다.')}</p><p><strong>해석의 기준</strong> 기간·단위·회계 범위가 맞는 비교만 계산하고, 미확인 자료를 확정된 값으로 바꾸지 않습니다.</p><p>원문과 상세 검증 기록은 아래의 접힌 자료표에서 확인할 수 있습니다.</p></section>${sectionHtml}<section class="panel" id="charts"><h2>차트와 계산 근거</h2>${htmlCharts}${pipelineDiagram}</section><section class="panel" id="claims"><details class="source-records"><summary>계산 방법과 남은 불확실성</summary><ul>${claims||'<li>검증 가능한 근거가 입력되지 않았습니다.</li>'}</ul></details></section><section class="panel" id="sources"><h2>수신 자료와 출처</h2>${rawSourceTables}<details class="source-records"><summary>출처·시각·검증 장부</summary>${sourceRowsHtml}<h3>연결된 전체 지표</h3>${metricsHtml}</details></section>${opinion}${template==='artboard-v2'?'<p class="print-guidance">인쇄 / PDF 저장: 브라우저 인쇄 메뉴에서 PDF로 저장을 선택하세요. 인쇄 결과는 브라우저와 서체에 따라 달라질 수 있습니다.</p>':''}</article></div><footer class="stock-footer">모두의 주식 · MoAI ATP · 근거와 해석을 구분한 보고서입니다. 제공되지 않거나 검증이 끝나지 않은 항목은 임의로 채우지 않았습니다. 주문·이체를 실행하지 않습니다.</footer></main>`;
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src ${FONT_CDN_PATHS.join(' ')}; object-src 'none'; base-uri 'none'; form-action 'none'">`;
  const chartRuntime = `(()=>{const groupLabel=(v)=>(${groupIntegerDigits.toString()})(String(v));const specs=JSON.parse(document.getElementById('chart-specs').textContent);const updateStatus=(el,state)=>{el.dataset.renderStatus=state;const note=el.closest('figure')?.querySelector('.chart-runtime-status');if(note)note.textContent=state==='ready'?'차트가 생성되었습니다. 아래 원수치와 함께 확인하세요.':state==='engine_missing'?'차트 엔진을 불러오지 못했습니다. 아래 원수치를 확인하세요.':'차트를 생성하지 못했습니다. 아래 원수치를 확인하세요.'};const palette=['--chart-1','--chart-2','--chart-3','--chart-4','--chart-5'].map((name)=>getComputedStyle(document.body).getPropertyValue(name).trim());for(const b of specs.echart){const el=document.getElementById(b.id);if(!el)continue;if(!window.echarts){updateStatus(el,'engine_missing');continue}try{const chart=echarts.init(el,null,{renderer:'svg'});let option;if(b.kind==='scatter'){option={animation:false,color:[palette[0]],aria:{enabled:true},tooltip:{trigger:'item',renderMode:'richText',confine:true},grid:{left:70,right:24,top:36,bottom:54,containLabel:true},xAxis:{type:'value',name:b.x_unit||'',scale:true},yAxis:{type:'value',name:b.y_unit||'',scale:true,splitLine:{lineStyle:{color:'#E8E8E8'}}},series:[{type:'scatter',name:b.title,data:b.x_values.map((x,i)=>[x,b.y_values[i]]),symbolSize:10}]}}else if(b.kind==='donut'){option={animation:false,color:palette,aria:{enabled:true},tooltip:{trigger:'item',renderMode:'richText',confine:true},legend:{type:'scroll',bottom:0},series:[{type:'pie',name:b.title,radius:['42%','68%'],avoidLabelOverlap:true,label:{show:true,formatter:'{b}: {d}%'},data:b.labels.map((name,i)=>({name,value:b.values[i]}))}]}}else{option={animation:false,color:palette,aria:{enabled:true},tooltip:{trigger:'axis',renderMode:'richText',confine:true},grid:{left:el.clientWidth<480?8:60,right:el.clientWidth<480?8:24,top:24,bottom:54,containLabel:true},xAxis:{type:'category',data:b.labels,axisLabel:{interval:0,hideOverlap:true}},yAxis:{type:'value',scale:b.kind!=='bar',splitLine:{lineStyle:{color:'#E8E8E8'}}},series:[{type:b.kind,name:b.title,data:b.values,itemStyle:{borderRadius:[3,3,0,0]},label:{show:true,position:'top',fontSize:el.clientWidth<480?10:12,formatter:(p)=>groupLabel(p.value)},labelLayout:{hideOverlap:true}}]}}chart.setOption(option);new ResizeObserver(()=>chart.resize()).observe(el);window.__moaiEcharts??=[];window.__moaiEcharts.push(chart);updateStatus(el,'ready')}catch{updateStatus(el,'failed')}}for(const b of specs.lwc){const el=document.getElementById(b.id);if(!el)continue;if(!window.LightweightCharts){updateStatus(el,'engine_missing');continue}try{const chart=LightweightCharts.createChart(el,{width:el.clientWidth,height:360,layout:{background:{type:'solid',color:'#FFFFFF'},textColor:'#393C41',fontFamily:'Pretendard,-apple-system,Apple SD Gothic Neo,Malgun Gothic,sans-serif',fontSize:12,attributionLogo:true},grid:{vertLines:{color:'#E8E8E8'},horzLines:{color:'#E8E8E8'}},timeScale:{borderColor:'#D4D6D8',timeVisible:false},rightPriceScale:{borderColor:'#D4D6D8'},handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{mouseWheel:false,pinch:true}});const colors=palette,lines=[];for(let i=0;i<b.series.length;i++){const s=b.series[i];const line=chart.addSeries(LightweightCharts.LineSeries,{title:s.name,color:colors[i%colors.length],lineWidth:2,lineStyle:/SMA/.test(s.name)?LightweightCharts.LineStyle.Dashed:LightweightCharts.LineStyle.Solid,priceLineVisible:false,lastValueVisible:true});line.setData(s.values.map((v,k)=>v===null?{time:b.dates[k]}:{time:b.dates[k],value:Number(v)}));lines.push({name:s.name,line})}const legend=el.closest('figure')?.querySelector('.legend');if(legend){for(const item of lines){const button=document.createElement('button');button.type='button';button.textContent=item.name;button.setAttribute('aria-pressed','true');button.addEventListener('click',()=>{const visible=button.getAttribute('aria-pressed')!=='true';item.line.applyOptions({visible});button.setAttribute('aria-pressed',String(visible))});legend.append(button)}}chart.timeScale().fitContent();new ResizeObserver(()=>chart.resize(el.clientWidth,360)).observe(el);el.dataset.rendered='lightweight-5.2.1';window.__moaiLwc??=[];window.__moaiLwc.push(chart);updateStatus(el,'ready')}catch{updateStatus(el,'failed')}}})();`;
  const chartAssets=`${specs.echart.length?`<script>${ECHARTS}</script>`:''}${specs.lwc.length?`<script>${LWC}</script>`:''}`;
  const chartScripts=specs.echart.length||specs.lwc.length?`<script id="chart-specs" type="application/json">${chartJson}</script><script>${chartRuntime}</script>`:'';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="referrer" content="no-referrer">${csp}<title>${E(plan.title)} · ${E(doc.subject.name)} · MoAI ATP</title><style>${FONT_CSS}${BASE_CSS}${STOCK_SAMPLE_CSS}${STOCK_ADAPTER_CSS}${template==='artboard-v2'?ARTBOARD_CSS+ARTBOARD_ADAPTER_CSS+REPORT_TYPOGRAPHY_CSS:''}</style></head><body${template==='artboard-v2'?' class="rs atp-artboard"':''}>${body}${chartAssets}${chartScripts}</body></html>`;
}

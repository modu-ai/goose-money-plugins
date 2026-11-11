/** Display-name crosswalk, not new provider routes or publication permissions. */
export const ARTBOARD_REPORT_MAP = Object.freeze([
  { ui_id:'R1', title:'기업 심층 분석', report_ids:['R01'], status:'supported' },
  { ui_id:'R2', title:'기업 비교 분석', report_ids:['R02'], status:'supported' },
  { ui_id:'R3', title:'실적 분석', report_ids:['R07'], status:'shared_route' },
  { ui_id:'R4', title:'주요 사건 분석', report_ids:['R07'], status:'shared_route' },
  { ui_id:'R5', title:'포트폴리오 점검', report_ids:['R04'], status:'manual_input_only' },
  { ui_id:'R6', title:'근거 검증', report_ids:['U03'], status:'internal_qa' },
  { ui_id:'R7', title:'리서치 브리핑 · 증시 마감', report_ids:['R06'], status:'partial' },
  { ui_id:'R8', title:'관심종목 재점검', report_ids:['R09'], status:'supported' },
] as const);

/** Typography for the opt-in artboard; font loading follows the report renderer policy.
 * #119 (user decision 2026-11-11, recorded in #18): the title font (h2) is Pretendard and the
 * description body prose is 조선일보명조 — the serif role re-points to the installed ChosunilboNM
 * stack with the previous installed fallback tail (no new web font: the #24 distribution and the
 * #52 D6 fallback method stay as declared), and the hero subtitle joins the sans headings so
 * every h2 in the render computes Pretendard. */
/** The #119 serif stack (installed fonts + the previous installed fallback tail, no web font):
 * reused by the default-template font decision layer so both paths declare byte-identical stacks. */
export const CHOSUN_SERIF_STACK = 'ChosunilboNM,"조선일보명조",AppleMyungjo,Batang,serif';

export const REPORT_TYPOGRAPHY_CSS = `
:root,.rs{--sans:Pretendard,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;--serif:${CHOSUN_SERIF_STACK}}
body,.panel p,.panel li,.rs .panel p,.rs .panel li,.report-hero blockquote p,.lead-summary p,.opinion p{font-family:var(--serif);font-synthesis:none}
h1,h2,h3,.rs h1,.rs h2,.rs h3,.panel h2,.panel h3,.rs .panel h2,.rs .panel h3{font-family:var(--sans);font-weight:700;font-synthesis:none;-webkit-text-stroke:0}
.rs h1+h2{font-family:var(--sans)}
.report-hero h1,.rs .report-hero h1{font-size:clamp(28px,4vw,48px);line-height:1.3;overflow-wrap:anywhere}
.report-hero p strong,.panel p strong{font-family:var(--sans);font-weight:700}
article#report-content{min-width:0;max-width:100%}
.rs .table-wrap th,.rs .table-wrap td{font-family:var(--sans);font-size:14px;line-height:1.6;padding:12px;overflow-wrap:anywhere}
.rs .kpi strong{font-family:var(--sans);font-size:clamp(24px,3vw,40px);line-height:1.3;overflow-wrap:anywhere}
.chart-runtime-status{font:13px/1.6 var(--sans);color:var(--muted)}
@media(max-width:800px){.rs .report-hero h1{font-size:30px}.rs .reading-layout{gap:24px}.rs .table-wrap th,.rs .table-wrap td{padding:10px}.rs .kpis{min-width:0}.rs .kpi{min-width:0}}
@media print{.rs .report-hero h1{font-size:24pt}.rs .table-wrap th,.rs .table-wrap td{font-size:9pt;padding:6px;white-space:normal}.rs .source-records{break-inside:auto}.rs .source-records>summary{break-after:avoid}}
`;

/** Original .rs stylesheet is kept byte-for-byte; these rules adapt ATP markup only.
 * Font loading follows the existing renderer CSP and reviewed CDN font families.
 * No chart values, evidence, report section IDs or source tables are generated here.
 */
export const ARTBOARD_ADAPTER_CSS = `
.rs{--chart-1:#902531;--chart-2:#8b8b86;--chart-3:#681c25;--chart-4:#595956;--chart-5:#c8c8c3;scroll-behavior:auto}
.rs main#report{min-width:0}.rs .rs-main{margin:32px auto 64px}
.rs .panel{border:0;padding:0;margin:0;min-width:0}
.rs .panel h2{font:700 30px/1.6 var(--serif);margin:64px 0 26px;padding-top:24px;border-top:1px solid var(--ink)}
.rs .panel p,.rs .panel li{font:17px/1.6 var(--sans);color:var(--ink)}
.rs .section-id{display:none}.rs .kpis{gap:0;padding:0}.rs .kpi{background:transparent}
.rs .kpi>small{display:block;margin:8px 0 0;font-size:13px}
.rs .table-wrap{max-width:100%;overflow-x:auto}.rs .table-wrap table{min-width:590px;table-layout:auto}
.rs .table-wrap th,.rs .table-wrap td{white-space:normal;overflow-wrap:anywhere}
.rs .table-wrap td.numeric{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.rs .table-wrap td:not(.numeric){text-align:left}
.rs .status{font:600 13px/1.6 var(--sans);border:1px solid var(--line);background:var(--surface);color:var(--ink)}
.rs .block-missing,.rs .notice{background:var(--surface);border-left:3px solid var(--brand);color:var(--muted)}
.rs .logo-window{width:215px;height:59px}.rs .logo-window img{position:static;width:215px;height:auto;max-width:100%}
.rs .stock-footer{margin:0 48px 32px;font:14px/1.6 var(--sans)}
.rs .source-records summary{font:700 16px/1.6 var(--sans)}
.rs .echart,.rs .lwc-chart{max-width:100%}
@media(max-width:800px){
 .rs .rs-main{margin:0;border-left:0;border-right:0}.rs .masthead{margin:0 24px;padding:12px 0;gap:12px;flex-wrap:wrap}
 .rs .brand-description{display:none}.rs .logo-window{width:174px;height:auto}.rs .logo-window img{width:174px}
 .rs .report-hero{padding:32px 24px}.rs h1{font-size:48px}.rs .report-hero h2{font-size:23px}
 .rs .reading-layout{display:block;padding:24px}.rs .rail-inner{position:static}.rs .reading-rail{margin-bottom:36px}
 .rs .reading-rail nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.rs .rail-note{display:none}
 .rs .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.rs .kpi{padding:18px 12px!important}
 .rs .kpi strong{font-size:32px}.rs .panel h2{font-size:25px;margin-top:48px}
 .rs figure{padding:22px 16px}.rs .stock-footer{margin:0 24px 24px}
}
@media(max-width:520px){.rs figure.diagram{padding-left:6px;padding-right:6px}}
@media print{
 @page{size:A4;margin:14mm}.rs{background:#fff;color:#242424}
 .rs .rs-main{max-width:none;margin:0;border:0}.rs .masthead{margin:0;padding:0 0 12px}
 .rs .report-hero{padding:20px 0}.rs h1{font-size:28pt}.rs .report-hero h2{font-size:18pt}
 .rs .reading-layout{display:block;padding:0}.rs .reading-rail,.rs .actions,.rs .skip{display:none}
 .rs .panel h2{font-size:18pt;break-after:avoid}.rs .panel p,.rs .panel li{font-size:11pt}
 .rs figure{break-inside:avoid;padding:12px}.rs .table-wrap{overflow:visible}.rs .table-wrap table{min-width:0;table-layout:fixed;font-size:9pt}
 .rs thead{display:table-header-group}.rs tr{break-inside:avoid}.rs .stock-footer{margin:12px 0}
 .rs details.source-records:not([open]){display:block}.rs details::details-content{display:block}
}
`;

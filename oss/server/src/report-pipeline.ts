import { createRequire } from 'node:module';
import { z } from 'zod';
import { renderReportTemplate } from './report-template-renderer.js';
import { getReportPresentation, type ReportPresentation } from './report-presentation.js';

const require = createRequire(import.meta.url);
const routeDocument = require('../contracts/report-route-bindings.v1.json') as RouteBindingDocument;

export const REPORT_ROUTE_IDS = ['R01','R02','R03','R04','R05','R06','R07','R08','R09','R10','R11','R12','R13','R14','U01'] as const;
export const ACTIVE_REPORT_ROUTE_IDS = ['R01','R02','R03','R05','R06','R07','R08','R09','R10','R11','R12','R13','R14','U01'] as const;
export type ReportRouteId = typeof REPORT_ROUTE_IDS[number];
export type DataMode = 'synthetic' | 'supplied' | 'actual' | 'mixed';
export type Provider = 'kis' | 'opendart' | 'sec' | 'public_web';
export type GroupId = 'identity_calendar' | 'price_history' | 'equity_fundamentals' | 'equity_estimates' | 'market_flow' | 'claims_events' | 'macro_industry' | 'etf_structure' | 'account_ledger' | 'futures_contract' | 'backtest_experiment' | 'analysis_narrative';

type Readiness = 'registered_default_rights_blocked' | 'registered_official_request_conflict' | 'registered_source_disabled' | 'registered_host_injected' | 'registered_partial' | 'not_implemented';
type ToolBinding = { name: string; provider: Provider; readiness: Readiness; note: string };
type GroupBinding = { tools: readonly ToolBinding[]; note: string };
type RouteSection = { id: string; title: string; field_ids: string[]; metric_ids: string[] };
type RouteSpec = { title: string; sample_path: string; fixture_path: string; sections: RouteSection[]; field_groups: Partial<Record<GroupId, string[]>> };
type RouteBindingDocument = { contract_version: string; scope: string[]; routes: Record<string, RouteSpec> };

const T = (name: string, provider: Provider, readiness: Readiness, note: string): ToolBinding => ({name,provider,readiness,note});
export const GROUP_BINDINGS: Readonly<Record<GroupId, GroupBinding>> = {
  identity_calendar: {tools:[
    T('search_instruments','kis','registered_host_injected','주입된 디렉터리 후보 검색이며 결과를 자동 확정하지 않습니다.'),
    T('resolve_instrument','kis','registered_host_injected','호환 진입점이며 독립 식별 검증은 아닙니다.'),
    T('get_instrument_profile','kis','registered_default_rights_blocked','분류 코드의 의미와 종목 동일성은 별도 검증이 필요합니다.'),
  ],note:'종목 식별과 시장 달력은 부분 지원입니다.'},
  price_history: {tools:[
    T('get_market_snapshot','kis','registered_default_rights_blocked','기본 권리 게이트가 닫혀 있습니다.'),
    T('get_price_history','kis','registered_default_rights_blocked','KIS-039 일봉 원천은 있으나 단위·수정주가 의미가 미확정입니다.'),
    T('get_intraday_price_history','kis','registered_default_rights_blocked','당일 분봉 원천만 있으며 완성봉·과거 전체성은 보장하지 않습니다.'),
    T('get_market_orderbook','kis','registered_partial','고정 호가 원문이며 단위·거래상태·체결가능성을 확정하지 않습니다.'),
    T('get_historical_intraday_price_history','kis','registered_partial','과거 날짜를 명시한 분봉 원천이며 단위·완전봉 검증은 별도입니다.'),
    T('get_us_price_history','kis','registered_default_rights_blocked','미국 이력은 canonical 단위와 수정기준이 미검증입니다.'),
  ],note:'일봉/분봉을 구분하며 미확인 값은 차트 수치로 승격하지 않습니다.'},
  equity_fundamentals: {tools:[T('get_fundamentals','opendart','registered_source_disabled','OpenDART 전송은 기본 비활성이고 당기/YTD·연결/별도 구분을 유지합니다.')],note:'DART 원문 필드와 기간 선택을 보존합니다.'},
  equity_estimates: {tools:[T('get_kis_house_estimates','kis','registered_host_injected','시장 컨센서스와 기업 가이던스가 동일하다고 보지 않습니다.')],note:'공식 요청계약과 실제 응답 검증이 필요합니다.'},
  market_flow: {tools:[
    T('get_market_flows','kis','registered_partial','inquire-investor 실제 응답의 주체별 수급 원문을 제공합니다. 날짜 범위·단위/배율 미확인 원문을 canonical 수급으로 승격하지 않습니다. 기존 일별 요청 경로는 별도 검증 대상입니다.'),
    T('get_credit_balances','kis','registered_default_rights_blocked','KIS-110; deal_date와 stlm_date를 분리하며 단위·비율은 부분 미확정입니다.'),
    T('get_short_sale_activity','kis','registered_default_rights_blocked','KIS-134; 잔고/비율 의미는 미확정입니다.'),
    T('get_stock_lending_activity','kis','registered_default_rights_blocked','KIS-135; 대차를 공매도와 동일시하지 않습니다.'),
    T('get_market_industry_investor_aggregates','kis','registered_host_injected','주입 transport가 필요하고 투자자별 종목 수급과 다른 집계입니다.'),
  ],note:'공매도·신용융자·대차를 별도 지표로 유지하고 하락/반대매매를 단정하지 않습니다.'},
  claims_events: {tools:[
    T('get_public_filings','opendart','registered_source_disabled','공시 목록 한 페이지이며 원문 본문 자동수집은 아닙니다.'),
    T('get_market_headlines','kis','registered_default_rights_blocked','뉴스/공시 제목 메타데이터만 제공하며 본문 수집이 아닙니다.'),
    T('get_sec_submissions','sec','registered_source_disabled','미국 SEC 최근 공시 메타데이터이며 과거 전체·본문은 아닙니다.'),
    T('get_overseas_ice_actions','kis','registered_host_injected','주입된 공개 공급자 transport가 필요합니다.'),
  ],note:'공시와 뉴스 원문·제목·공개시각의 범위를 구분합니다.'},
  macro_industry: {tools:[
    T('get_domestic_index_history','kis','registered_default_rights_blocked','국내 지수 원천 이력이며 거시 전체를 뜻하지 않습니다.'),
    T('get_global_index_history','kis','registered_default_rights_blocked','글로벌 지수 원천 이력이며 국가별 거시 통계는 별도입니다.'),
    T('get_domestic_index_period_history','kis','registered_official_request_conflict','KIS072 코드 길이 충돌로 전송 차단 상태입니다.'),
    T('get_global_index_period_history','kis','registered_partial','글로벌 원천 주·월·연 이력이며 시계열 단위·기간 완전성은 별도입니다.'),
  ],note:'지수 데이터만으로 경기지표 전체를 채우지 않습니다.'},
  etf_structure: {tools:[
    T('get_domestic_etf_snapshot','kis','registered_default_rights_blocked','NAV 후보 시세이며 보유종목 구성표가 아닙니다.'),
    T('get_us_product_profile','kis','registered_default_rights_blocked','미국 상품정보 원천이며 보유종목/비용률을 뜻하지 않습니다.'),
    T('get_us_market_snapshot','kis','registered_default_rights_blocked','미국 주식/ETF 원천 시세; 종목·통화·단위는 미검증입니다.'),
  ],note:'ETF 구조/구성 데이터는 부분 또는 미제공으로 표시합니다.'},
  account_ledger: {tools:[],note:'이번 버전에서 계좌 조회·계좌 분석은 사용자 요청으로 제외합니다.'},
  futures_contract: {tools:[
    T('get_index_futures_snapshot','kis','registered_default_rights_blocked','국내 지수선물 원천 시세; 계약 단위·만기 메타데이터가 미검증입니다.'),
    T('get_overseas_futures_snapshot','kis','registered_default_rights_blocked','해외선물 원천 시세; 계약식별·통화·승수가 미검증입니다.'),
    T('get_domestic_futures_price_history','kis','registered_default_rights_blocked','국내 선물 일별 원천 한 페이지입니다.'),
    T('get_domestic_futures_intraday_history','kis','registered_default_rights_blocked','국내 선물 분봉 원천 한 페이지입니다.'),
    T('get_overseas_futures_price_history','kis','registered_default_rights_blocked','해외 선물 일별 원천 한 페이지입니다.'),
    T('get_overseas_futures_intraday_history','kis','registered_default_rights_blocked','해외 선물 분봉 원천 한 페이지입니다.'),
  ],note:'음수 가격은 보존하되 승수·만기·롤·증거금 미확인 시 손익 계산을 차단합니다.'},
  backtest_experiment: {tools:[],note:'실거래 체결 재구성 가능한 백테스트 엔진 도구는 현재 구현하지 않았습니다.'},
  analysis_narrative: {tools:[],note:'해석 문장은 원천 사실과 분리하고 반대근거·불확실성·변경조건을 따로 둡니다.'},
};

const PROVIDER_URL: Record<Provider,string> = {
  kis:'https://apiportal.koreainvestment.com/',
  opendart:'https://opendart.fss.or.kr/',
  sec:'https://www.sec.gov/edgar',
  public_web:'https://www.google.com/search',
};
const TOOL_META = new Map<string,ToolBinding>();
for (const group of Object.values(GROUP_BINDINGS)) for (const tool of group.tools) TOOL_META.set(tool.name,tool);
const SAFE_ERROR_CODES = new Set([
  'no_data','rights_pending','source_not_enabled','credential_missing','request_contract_conflict','rate_limited','auth_expired',
  'upstream_timeout','request_cancelled','upstream_unavailable','upstream_rejected','schema_drift','response_too_large','pagination_not_supported',
  'pagination_limit_reached','empty_response','instrument_mismatch','invalid_input','invalid_response','invalid_provenance','response_mismatch',
  'transport_error','transport_not_configured','provider_error','unknown_error'
]);
const providerKind: Record<Provider,Provider> = {kis:'kis',opendart:'opendart',sec:'sec',public_web:'public_web'};
const timestamp = z.string().datetime({offset:true});
const sourceAsOf = z.union([timestamp,z.string().regex(/^\d{4}-\d{2}-\d{2}$/),z.null()]);
const SourceSchema = z.object({
  id:z.string(),kind:z.enum(['synthetic','user_supplied','kis','opendart','sec','public_web']),title:z.string(),url:z.union([z.string().url(),z.null()]),
  observed_at:timestamp,available_at:timestamp,rights:z.enum(['synthetic_only','local_view','pending']),revision:z.string().min(1),
  provider:z.string().min(1).optional(),operation_ref:z.string().min(1).optional(),source_as_of:sourceAsOf.optional(),received_at:timestamp.optional(),
  validation_status:z.enum(['synthetic_fixture','unverified','provider_shape_checked','independently_reconciled','rights_pending','stale']).optional(),
}).strict().superRefine((s,c)=>{if(['kis','opendart','sec','public_web'].includes(s.kind)&&(!s.provider||!s.operation_ref||s.source_as_of===undefined||!s.received_at||!s.validation_status))c.addIssue({code:'custom',message:'provider_provenance_required'});});
const MetricSchema = z.object({field_id:z.string(),label:z.string(),value:z.union([z.string().regex(/^-?(0|[1-9]\d*)(\.\d+)?$/),z.null()]),unit:z.string().min(1),currency:z.union([z.string(),z.null()]),status:z.enum(['synthetic','provided','provided_unverified','missing','stale','error','not_run','rights_pending']),source_id:z.string(),period:z.string().min(1),missing_reason:z.string().optional(),scale:z.enum(['1','100','1000','1000000','100000000']),period_kind:z.enum(['observation','quarter','FY','YTD']),scope:z.enum(['consolidated','standalone','not_applicable'])}).strict();
const SectionSchema = z.object({id:z.string().regex(/^(R\d{2}|U0[12])\.[SX]\d{2}$/),status:z.enum(['partial','error','not_run','rights_pending']),required_fields:z.array(z.string()),missing_reason:z.string().min(1),body:z.string().optional(),source_ids:z.array(z.string()).optional(),metric_ids:z.array(z.string()).optional()}).strict();
const ClaimSchema = z.object({id:z.string(),kind:z.enum(['fact','interpretation','counterevidence','uncertainty','condition','method']),text:z.string().min(1),status:z.enum(['supported','partial','missing','not_run','rights_pending','error']),confidence:z.enum(['high','medium','low','unrated']),source_ids:z.array(z.string()),metric_ids:z.array(z.string())}).strict();
const DecimalValue = z.string().regex(/^-?(0|[1-9]\d*)(\.\d+)?$/).max(32);
const PlainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const UserPositionSchema = z.object({label:z.string().trim().min(1).max(120),market_value:DecimalValue}).strict();
const UserAccountLedgerSchema = z.object({as_of:PlainDate,currency:z.string().regex(/^[A-Z]{3}$/),cash:DecimalValue,liabilities:DecimalValue,positions:z.array(UserPositionSchema).min(1).max(100)}).strict().superRefine((value,ctx)=>{
  const liabilities=parseDecimalParts(value.liabilities);
  if(!liabilities||liabilities.coefficient<0n)ctx.addIssue({code:'custom',message:'user_liabilities_must_be_nonnegative'});
  if(value.positions.some(position=>{const amount=parseDecimalParts(position.market_value);return !amount||amount.coefficient<0n;}))ctx.addIssue({code:'custom',message:'short_or_negative_position_requires_separate_exposure_model'});
});
const UserEquityCurveSchema = z.object({currency:z.string().regex(/^[A-Z]{3}$/),points:z.array(z.object({date:PlainDate,equity:DecimalValue}).strict()).min(2).max(500)}).strict().superRefine((value,ctx)=>{
  if(value.points.some((point,index)=>index>0&&value.points[index-1]!.date>=point.date))ctx.addIssue({code:'custom',message:'backtest_curve_dates_not_strictly_increasing'});
  const opening=parseDecimalParts(value.points[0]!.equity);
  if(!opening||opening.coefficient<=0n)ctx.addIssue({code:'custom',message:'backtest_curve_requires_positive_initial_equity'});
});
const UserSuppliedFinanceSchema = z.object({account_ledger:UserAccountLedgerSchema.optional(),backtest_curve:UserEquityCurveSchema.optional()}).strict().superRefine((value,ctx)=>{
  if(Number(Boolean(value.account_ledger))+Number(Boolean(value.backtest_curve))!==1)ctx.addIssue({code:'custom',message:'provide_exactly_one_user_input_family'});
});
const VisualSectionId = z.string().regex(/^(R\d{2}|U0[12])\.[SX]\d{2}$/);
const VisualLabel = z.string().min(1).max(160);
const CategoryVisualSchema = z.object({section_id:VisualSectionId,kind:z.enum(['bar','line','donut']),title:VisualLabel,labels:z.array(VisualLabel).min(2).max(50),values:z.array(DecimalValue).min(2).max(50),unit:z.string().min(1).max(80),source_id:z.string(),metric_ids:z.array(z.string().min(1)).min(2).max(50)}).strict().superRefine((v,c)=>{if(v.labels.length!==v.values.length||v.labels.length!==v.metric_ids.length)c.addIssue({code:'custom',message:'visual_dimension_mismatch'});});
const ScatterVisualSchema = z.object({section_id:VisualSectionId,kind:z.literal('scatter'),title:VisualLabel,labels:z.array(VisualLabel).min(2).max(50),x_values:z.array(DecimalValue).min(2).max(50),y_values:z.array(DecimalValue).min(2).max(50),x_unit:z.string().min(1).max(80),y_unit:z.string().min(1).max(80),source_id:z.string(),metric_ids:z.array(z.string().min(1)).min(4).max(100)}).strict().superRefine((v,c)=>{if(v.labels.length!==v.x_values.length||v.labels.length!==v.y_values.length||v.metric_ids.length!==v.labels.length*2)c.addIssue({code:'custom',message:'scatter_dimension_mismatch'});});
const MatrixCore = {
  section_id:VisualSectionId,kind:z.literal('matrix'),title:VisualLabel,
  rows:z.array(VisualLabel).min(1).max(12),columns:z.array(VisualLabel).min(1).max(12),
  values:z.array(z.union([DecimalValue,z.null()])).min(1).max(144),unit:z.string().min(1).max(80),metric_ids:z.array(z.string().min(1).max(160)).min(1).max(144),
};
function matrixDimensions(value:{rows:string[];columns:string[];values:Array<string|null>;metric_ids:string[]},ctx:z.RefinementCtx){
  const expected=value.rows.length*value.columns.length;
  if(value.values.length!==expected||value.metric_ids.length!==expected)ctx.addIssue({code:'custom',message:'matrix_dimension_mismatch'});
}
const MatrixVisualSchema=z.object({...MatrixCore,source_id:z.string().min(1)}).strict().superRefine(matrixDimensions);
const TimelineEventSchema=z.object({
  when:z.union([timestamp,PlainDate]),time_kind:z.enum(['occurred','published','effective','observed']),
  title:VisualLabel,detail:z.string().max(500).optional(),
}).strict();
const TimelineCore={section_id:VisualSectionId,kind:z.literal('timeline'),title:VisualLabel,events:z.array(TimelineEventSchema).min(1).max(40)};
const TimelineVisualSchema=z.object({...TimelineCore,source_id:z.string().min(1)}).strict();
const PeleNodeSchema=z.object({id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}$/),label:z.string().min(1).max(80),role:z.enum(['entity','event','evidence','outcome']).optional()}).strict();
const PeleEdgeSchema=z.object({from:z.string(),to:z.string(),label:z.string().min(1).max(100),metric_ids:z.array(z.string().min(1).max(160)).min(1).max(6)}).strict();
const PeleCore={section_id:VisualSectionId,kind:z.literal('pele'),title:VisualLabel,nodes:z.array(PeleNodeSchema).min(2).max(12),edges:z.array(PeleEdgeSchema).min(1).max(20)};
function peleReferences(value:{nodes:Array<{id:string}>;edges:Array<{from:string;to:string}>},ctx:z.RefinementCtx){
  const ids=value.nodes.map(node=>node.id);const unique=new Set(ids);
  if(unique.size!==ids.length)ctx.addIssue({code:'custom',message:'pele_duplicate_node'});
  for(const edge of value.edges)if(!unique.has(edge.from)||!unique.has(edge.to)||edge.from===edge.to)ctx.addIssue({code:'custom',message:'pele_edge_reference_invalid'});
}
const PeleVisualSchema=z.object({...PeleCore,source_id:z.string().min(1)}).strict().superRefine(peleReferences);
const ReportVisualSchema = z.discriminatedUnion('kind',[CategoryVisualSchema,ScatterVisualSchema,MatrixVisualSchema,TimelineVisualSchema,PeleVisualSchema]);
const MatrixPayloadSchema=z.object(MatrixCore).strict().superRefine(matrixDimensions);
const TimelinePayloadSchema=z.object(TimelineCore).strict();
const PelePayloadSchema=z.object(PeleCore).strict().superRefine(peleReferences);
const ChartSchema = z.object({title:z.string(),kind:z.literal('bar'),labels:z.array(z.string()).min(2).max(10),values:z.array(z.union([DecimalValue,z.null()])).min(2).max(10),unit:z.string().min(1),source_id:z.string(),metric_ids:z.array(z.string()).min(2).max(10),section_id:VisualSectionId.optional()}).strict().superRefine((v,c)=>{if(v.labels.length!==v.values.length||v.labels.length!==v.metric_ids.length)c.addIssue({code:'custom',message:'chart_dimension_mismatch'});});
const ObservationSchema = z.object({field_id:z.string().min(1).max(160),label:z.string().min(1).max(160),value:z.union([DecimalValue,z.null()]),unit:z.string().min(1).max(80),currency:z.union([z.string().max(12),z.null()]),period:z.string().min(1).max(80),scale:z.enum(['1','100','1000','1000000','100000000']),period_kind:z.enum(['observation','quarter','FY','YTD']),scope:z.enum(['consolidated','standalone','not_applicable'])}).strict();
const VisualPayloadSchema = z.discriminatedUnion('kind',[
  z.object({section_id:VisualSectionId,kind:z.enum(['bar','line','donut']),title:z.string().min(1).max(160),labels:z.array(z.string().min(1).max(160)).min(2).max(50),values:z.array(DecimalValue).min(2).max(50),unit:z.string().min(1).max(80),metric_ids:z.array(z.string().min(1)).min(2).max(50)}).strict(),
  z.object({section_id:VisualSectionId,kind:z.literal('scatter'),title:z.string().min(1).max(160),labels:z.array(z.string().min(1).max(160)).min(2).max(50),x_values:z.array(DecimalValue).min(2).max(50),y_values:z.array(DecimalValue).min(2).max(50),x_unit:z.string().min(1).max(80),y_unit:z.string().min(1).max(80),metric_ids:z.array(z.string().min(1)).min(4).max(100)}).strict(),
  MatrixPayloadSchema,TimelinePayloadSchema,PelePayloadSchema,
]);
const TimeSeriesSchema = z.object({title:z.string(),renderer:z.literal('lightweight-charts'),dates:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(2).max(100),unit:z.string().min(1),source_id:z.string(),adjustment:z.enum(['adjusted','unadjusted']),series:z.array(z.object({field_id:z.string(),label:z.string(),values:z.array(z.union([DecimalValue,z.null()])).min(2).max(100),derived_from:z.string().optional(),calculation_ref:z.string().optional()}).strict()).min(1).max(5)}).strict().superRefine((v,c)=>{if(v.series.some(s=>s.values.length!==v.dates.length))c.addIssue({code:'custom',message:'time_series_dimension_mismatch'});if(new Set(v.dates).size!==v.dates.length||v.dates.some((d,i)=>i>0&&v.dates[i-1]!>=d))c.addIssue({code:'custom',message:'time_series_dates_not_strictly_increasing'});});
const SourceTableSchema=z.object({source_id:z.string(),title:z.string().max(160),columns:z.array(z.string().max(160)).min(1).max(8),rows:z.array(z.array(z.string().max(2048)).max(8)).max(250),coverage_note:z.string().max(500)}).strict().superRefine((v,c)=>{if(v.rows.some(row=>row.length!==v.columns.length))c.addIssue({code:'custom',message:'source_table_dimensions'});});
export const ReportInputSchema = z.object({
  contract_version:z.literal('atp.template/1.1'),report_id:z.enum(REPORT_ROUTE_IDS),mode:z.enum(['synthetic','supplied','actual','mixed']),
  subject:z.object({id:z.string().min(1).max(200),name:z.string().min(1).max(200),venue:z.string().min(1).max(200),currency:z.string().min(1).max(200)}).strict(),
  cutoff:timestamp,display_timezone:z.enum(['Asia/Seoul','UTC','America/New_York','Europe/London','Asia/Tokyo']),
  sources:z.array(SourceSchema).max(100),source_tables:z.array(SourceTableSchema).max(12).optional(),metrics:z.array(MetricSchema).max(500),sections:z.array(SectionSchema).min(1).max(30),
  visuals:z.array(ReportVisualSchema).max(40).optional(),chart:z.union([ChartSchema,z.null()]),time_series:z.union([TimeSeriesSchema,z.null()]),execution_status:z.enum(['template_only','not_run','provided_unverified','synthetic_fixture_rendered','actual_input_unvalidated','actual_data_partial']),
  analysis_claims:z.array(ClaimSchema).max(300),
}).strict().superRefine((v,c)=>{
  if((v.mode==='actual'||v.mode==='mixed')&&!['actual_input_unvalidated','actual_data_partial'].includes(v.execution_status))c.addIssue({code:'custom',message:'actual_mode_status_mismatch'});
  const allowed=(sourceId:string)=>{const source=v.sources.find(item=>item.id===sourceId);if(!source)return false;if(v.mode==='synthetic')return source.kind==='synthetic'&&source.rights==='synthetic_only'&&source.validation_status==='synthetic_fixture';if(source.kind==='user_supplied')return (v.mode==='supplied'||v.mode==='mixed')&&source.rights==='local_view'&&source.validation_status==='unverified';return source.rights==='local_view'&&['provider_shape_checked','independently_reconciled'].includes(source.validation_status??'');};
  const displayableMetric=(m:ReportInput['metrics'][number])=>m.status==='synthetic'||m.status==='provided'||(m.status==='provided_unverified'&&v.sources.some(source=>source.id===m.source_id&&source.rights==='local_view'&&(source.kind==='user_supplied'&&source.validation_status==='unverified'||source.validation_status==='provider_shape_checked')));
  for(const table of v.source_tables??[])if(!allowed(table.source_id))c.addIssue({code:'custom',message:'source_table_not_displayable'});
  const chart=v.chart;if(chart){if(!allowed(chart.source_id))c.addIssue({code:'custom',message:'chart_source_not_displayable'});for(let i=0;i<chart.metric_ids.length;i++){const metric=v.metrics.find(m=>m.field_id===chart.metric_ids[i]&&m.source_id===chart.source_id&&m.unit===chart.unit&&m.value===chart.values[i]&&displayableMetric(m));if(!metric)c.addIssue({code:'custom',message:'chart_point_missing_metric_lineage'});}}
  const routeSectionIds=new Set(routeDocument.routes[v.report_id]?.sections.map(section=>section.id)??[]);
  for(const visual of v.visuals??[]){
    if(!allowed(visual.source_id))c.addIssue({code:'custom',message:'visual_source_not_displayable'});
    if(!routeSectionIds.has(visual.section_id))c.addIssue({code:'custom',message:'visual_section_not_in_report_route'});
    if(visual.kind==='bar'||visual.kind==='line'||visual.kind==='donut'){
      for(let i=0;i<visual.metric_ids.length;i++){const match=v.metrics.some(m=>m.field_id===visual.metric_ids[i]&&m.source_id===visual.source_id&&m.unit===visual.unit&&m.value===visual.values[i]&&displayableMetric(m));if(!match)c.addIssue({code:'custom',message:'visual_point_missing_metric_lineage'});}
    }else if(visual.kind==='scatter'){
      for(let i=0;i<visual.metric_ids.length;i++){const expectedValue=i%2===0?visual.x_values[Math.floor(i/2)]:visual.y_values[Math.floor(i/2)];const expectedUnit=i%2===0?visual.x_unit:visual.y_unit;const match=v.metrics.some(m=>m.field_id===visual.metric_ids[i]&&m.source_id===visual.source_id&&m.unit===expectedUnit&&m.value===expectedValue&&displayableMetric(m));if(!match)c.addIssue({code:'custom',message:'visual_point_missing_metric_lineage'});}
    }else if(visual.kind==='matrix'){
      for(let i=0;i<visual.metric_ids.length;i++){const value=visual.values[i];const match=v.metrics.some(m=>m.field_id===visual.metric_ids[i]&&m.source_id===visual.source_id&&m.unit===visual.unit&&m.value===value&&(value===null?m.status==='missing':displayableMetric(m)));if(!match)c.addIssue({code:'custom',message:'matrix_cell_missing_metric_lineage'});}
    }else if(visual.kind==='pele'){
      for(const edge of visual.edges)for(const metricId of edge.metric_ids){const match=v.metrics.some(m=>m.field_id===metricId&&m.source_id===visual.source_id&&m.value!==null&&displayableMetric(m));if(!match)c.addIssue({code:'custom',message:'pele_edge_missing_metric_lineage'});}
    }
  }
  const knownSources=new Set(v.sources.map(source=>source.id)),knownMetrics=new Set(v.metrics.map(metric=>metric.field_id));
  for(const claim of v.analysis_claims)if(claim.source_ids.some(id=>!knownSources.has(id))||claim.metric_ids.some(id=>!knownMetrics.has(id)))c.addIssue({code:'custom',message:'analysis_claim_reference_not_found'});
  if(v.time_series){if(!allowed(v.time_series.source_id))c.addIssue({code:'custom',message:'time_series_source_not_displayable'});const base=v.time_series.series[0];if(!base||base.field_id!=='history.close'||base.derived_from||base.calculation_ref)c.addIssue({code:'custom',message:'time_series_base_series_invalid'});for(const series of v.time_series.series.slice(1)){const match=series.field_id.match(/^history\.sma_(5|20|60|120)$/);if(!match||series.derived_from!=='history.close'||series.calculation_ref!==`sma.${match[1]}.v1`)c.addIssue({code:'custom',message:'time_series_derived_series_invalid'});}}
});
export const ActiveReportInputSchema = ReportInputSchema.safeExtend({report_id:z.enum(ACTIVE_REPORT_ROUTE_IDS)});
export type ReportInput = z.infer<typeof ReportInputSchema>;

type ToolResultLike = {isError?:boolean;structuredContent?:unknown;content?:unknown};
type NormalizedCall = {tool_name:string;provider:Provider;outcome:'success'|'error';error_code:string|null;source:ReportInput['sources'][number]|null;source_tables?:NonNullable<ReportInput['source_tables']>;metrics:ReportInput['metrics'];visuals:NonNullable<ReportInput['visuals']>;chart:ReportInput['chart'];time_series:ReportInput['time_series'];origin:'actual'|'synthetic'|'unverified'};
export type ReportPlan = {report_id:ReportRouteId;title:string;sections:RouteSection[];groups:Array<{id:GroupId;required_fields:string[];tools:ToolBinding[];note:string}>;presentation?:ReportPresentation};

function isRecord(value:unknown): value is Record<string,unknown> { return typeof value==='object'&&value!==null&&!Array.isArray(value); }
function payloadText(result:ToolResultLike): string|null {
  if(!Array.isArray(result.content))return null;
  const entry=result.content.find((item)=>isRecord(item)&&item.type==='text'&&typeof item.text==='string');
  return entry&&isRecord(entry)&&typeof entry.text==='string'?entry.text:null;
}
function safeErrorCode(result:ToolResultLike):string {
  if(isRecord(result.structuredContent)&&typeof result.structuredContent.error_code==='string'&&SAFE_ERROR_CODES.has(result.structuredContent.error_code))return result.structuredContent.error_code;
  const text=payloadText(result);
  const match=text?.trim().match(/^error_code=([a-z_]+)$/);
  return match&&SAFE_ERROR_CODES.has(match[1]!)?match[1]!:'upstream_unavailable';
}
function parseJsonText(text:string):unknown {
  if(Buffer.byteLength(text,'utf8')>300_000)throw new Error('response_too_large');
  try{return JSON.parse(text) as unknown;}catch{throw new Error('schema_drift');}
}
function cleanTimestamp(value:unknown,fallback:string):string {
  if(typeof value==='string'&&Number.isFinite(Date.parse(value)))return new Date(value).toISOString();
  return new Date(fallback).toISOString();
}
function cleanSourceAsOf(value:unknown):string|null {
  if(value===null||value===undefined)return null;
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value)))return value;
  if(typeof value==='string'&&Number.isFinite(Date.parse(value)))return new Date(value).toISOString();
  return null;
}
function decimalLexeme(value:unknown):string|null { return typeof value==='string'&&/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)?value:null; }
function operationRef(payload:Record<string,unknown>,tool:ToolBinding):string {
  const p=isRecord(payload.provenance)?payload.provenance:{};
  for(const v of [payload.operation_ref,payload.operation_id,p.operation_ref,p.operation_id])if(typeof v==='string'&&v.length<=120)return v;
  return tool.name;
}
function recognizedValidation(value:unknown,origin:'actual'|'synthetic'|'unverified'):
  'synthetic_fixture'|'unverified'|'provider_shape_checked'|'independently_reconciled'|'rights_pending'|'stale' {
  if(origin==='synthetic')return 'synthetic_fixture';
  const status=typeof value==='string'?value:'';
  if(status==='provider_shape_checked'||status==='provider_shape_checked_not_live_reconciled')return 'provider_shape_checked';
  if(status==='independently_reconciled')return 'independently_reconciled';
  if(status==='rights_pending'||status==='stale')return status;
  return 'unverified';
}
function readOrigin(payload:Record<string,unknown>):'actual'|'synthetic'|'unverified' {
  const p=isRecord(payload.provenance)?payload.provenance:{};
  const value=payload.origin??p.origin;
  if(value==='actual')return 'actual';
  if(value==='synthetic'||value==='synthetic_fixture')return 'synthetic';
  return 'unverified';
}
function metric(field_id:string,label:string,value:string|null,unit:string,currency:string|null,status:ReportInput['metrics'][number]['status'],source_id:string,period:string,missing_reason?:string):ReportInput['metrics'][number] {
  return {field_id,label,value,unit,currency,status,source_id,period,scale:'1',period_kind:'observation',scope:'not_applicable',...(missing_reason?{missing_reason}:{})};
}
function quoteMetrics(payload:Record<string,unknown>,source:ReportInput['sources'][number],origin:'actual'|'synthetic'|'unverified'):ReportInput['metrics'] {
  if(payload.contract!=='moai.stock.quote-snapshot.v1'&&payload.operation_id!=='kis.kr.quote.snapshot.v1')return [];
  const data=isRecord(payload.data)?payload.data:{};
  const rightsAllowed=source.rights==='local_view';
  const period=source.source_as_of??source.received_at??source.observed_at;
  const fields=[['last','quote.last','최근가','KRW/share'],['open','quote.open','시가','KRW/share'],['high','quote.high','고가','KRW/share'],['low','quote.low','저가','KRW/share'],['previous_close','quote.previous_close','전일 종가','KRW/share'],['change','quote.change','전일 대비','KRW/share'],['change_percent','quote.change_percent','전일 대비율','%'],['volume','quote.volume','거래량','shares']] as const;
  return fields.map(([key,id,label,unit])=>{
    const raw=decimalLexeme(data[key]);
    if(origin==='synthetic')return metric(id,label,raw,unit,key==='change_percent'||key==='volume'?null:'KRW',raw===null?'missing':'synthetic',source.id,period,raw===null?'synthetic_field_missing':undefined);
    if(!rightsAllowed)return metric(id,label,null,unit,key==='change_percent'||key==='volume'?null:'KRW','rights_pending',source.id,period,'display_rights_not_confirmed');
    const status:ReportInput['metrics'][number]['status']=raw===null?'missing':source.validation_status==='independently_reconciled'?'provided':'provided_unverified';
    return metric(id,label,raw,unit,key==='change_percent'||key==='volume'?null:'KRW',status,source.id,period,raw===null?'provider_field_missing_or_invalid':undefined);
  });
}
function dartReportedMetrics(payload:Record<string,unknown>,source:ReportInput['sources'][number],origin:'actual'|'synthetic'|'unverified'):ReportInput['metrics'] {
 if(payload.source!=='opendart'||payload.status!=='ok'||!Array.isArray(payload.rows)||!isRecord(payload.request)||payload.request.reprt_code!=='11011'||!['CFS','OFS'].includes(String(payload.request.fs_div)))return [];
 const q=payload.request;const scope=q.fs_div==='CFS'?'consolidated' as const:'standalone' as const;
 const specs=[['IS','ifrs-full_Revenue','reported.revenue','매출'],['IS','dart_OperatingIncomeLoss','reported.operating_profit','영업이익'],['IS','ifrs-full_ProfitLoss','reported.net_income_total','총당기손익'],['CF','ifrs-full_CashFlowsFromUsedInOperatingActivities','reported.cfo','영업현금흐름'],['BS','ifrs-full_Assets','reported.assets','자산'],['BS','ifrs-full_CashAndCashEquivalents','reported.cash','현금및현금성자산'],['BS','ifrs-full_Equity','reported.equity','자본'],['BS','ifrs-full_Liabilities','reported.liabilities','부채']] as const;
 const out:ReportInput['metrics']=[];
 for(const [statement,id,field,label] of specs){
  const rows=payload.rows.filter(row=>isRecord(row)&&isRecord(row.raw)&&row.raw.sj_div===statement&&row.raw.account_id===id);
  if(rows.length!==1)continue;const row=rows[0];if(!isRecord(row)||!isRecord(row.raw)||!isRecord(row.amounts)||!isRecord(row.amounts.current))continue;const raw=row.raw;
  if(typeof raw.currency!=='string'||!raw.currency||typeof raw.thstrm_nm!=='string'||!raw.thstrm_nm||typeof raw.rcept_no!=='string')continue;
  const amount=row.amounts.current;const parsed=amount.state==='value'&&typeof amount.decimal==='string'?parseDecimalParts(amount.decimal):null;
  const value=parsed?formatScaled(parsed.coefficient,parsed.scale):null;const permitted=source.rights==='local_view'||origin==='synthetic';
  const status:ReportInput['metrics'][number]['status']=!permitted?'rights_pending':value===null?'missing':origin==='synthetic'?'synthetic':'provided_unverified';
  const item:ReportInput['metrics'][number]={field_id:field,label:label+' · 원문 금액',value:permitted?value:null,unit:'원문 금액(배율 미확인)',currency:raw.currency,status,source_id:source.id,period:`${q.bsns_year}:FY:${q.fs_div}:${statement}:${raw.thstrm_nm}:${raw.rcept_no}`,scale:'1',period_kind:'FY',scope,...(!permitted?{missing_reason:'display_rights_not_confirmed'}:value===null?{missing_reason:'provider_amount_unavailable'}:{})};
  out.push(item);
  if(field==='reported.revenue'||field==='reported.operating_profit')out.push({...item,field_id:field.replace('reported.','provider_finance.')});
 }
 return out;
}
function decimalMean(values:string[]):string|null {
  const parts=values.map((value)=>value.match(/^(-?)(\d+)(?:\.(\d+))?$/));
  if(parts.some(part=>!part))return null;
  const scale=Math.max(0,...parts.map(part=>part?.[3]?.length??0));if(scale>18)return null;
  const total=parts.reduce((sum,part)=>{if(!part)return sum;const sign=part[1]==='-'?-1n:1n;return sum+sign*BigInt((part[2]??'0')+(part[3]??'').padEnd(scale,'0'));},0n);
  const precision=Math.max(scale,8);const factor=10n**BigInt(precision-scale);const denominator=BigInt(values.length);const abs=total<0n?-total:total;const numerator=abs*factor;let quotient=numerator/denominator;const remainder=numerator%denominator;if(remainder*2n>=denominator)quotient+=1n;const signed=total<0n?-quotient:quotient;const negative=signed<0n;const digits=(negative?-signed:signed).toString().padStart(precision+1,'0');const whole=precision?digits.slice(0,-precision):digits;const fraction=precision?digits.slice(-precision).replace(/0+$/,''):'';return `${negative?'-':''}${whole}${fraction?'.'+fraction:''}`;
}
function timeSeriesFromHistory(payload:Record<string,unknown>,source:ReportInput['sources'][number],origin:'actual'|'synthetic'|'unverified'):ReportInput['time_series'] {
  if(payload.contract!=='moai.stock.price-history.v1'||!Array.isArray(payload.bars))return null;
  const bars=payload.bars.filter(isRecord);if(bars.length<2||bars.length>100)return null;
  const canDisplay=(source.rights==='synthetic_only'&&origin==='synthetic'&&source.validation_status==='synthetic_fixture')||(source.rights==='local_view'&&['provider_shape_checked','independently_reconciled'].includes(source.validation_status??''));if(!canDisplay)return null;
  const dates=bars.map((bar)=>typeof bar.date==='string'?bar.date:'');if(dates.some((date,index)=>!/^\d{4}-\d{2}-\d{2}$/.test(date)||(index>0&&dates[index-1]!>=date)))return null;
  const first=bars[0]!;const adjustment=first.adjusted;const unit=first.price_unit;
  if(typeof unit!=='string'||!unit||typeof adjustment!=='boolean')return null;
  if(bars.some((bar)=>bar.mapping_status!=='verified'||!Array.isArray(bar.blockers)||bar.blockers.length>0||bar.price_unit!==unit||bar.adjusted!==adjustment||!bar.currency||!bar.volume_unit||!bar.turnover_unit))return null;
  const closes=bars.map((bar)=>decimalLexeme(bar.close));if(closes.some((value)=>value===null))return null;
  const values=closes as string[];const series:NonNullable<ReportInput['time_series']>['series']= [{field_id:'history.close',label:'종가',values}];
  for(const period of [5,20,60,120])if(values.length>=period){const sma=values.map((_,index)=>index<period-1?null:decimalMean(values.slice(index-period+1,index+1)));series.push({field_id:`history.sma_${period}`,label:`SMA ${period}`,values:sma,derived_from:'history.close',calculation_ref:`sma.${period}.v1`});}
  return {title:'종가와 이동평균선',renderer:'lightweight-charts',dates,unit,source_id:source.id,adjustment:adjustment?'adjusted':'unadjusted',series};
}
function historyMetrics(payload:Record<string,unknown>,source:ReportInput['sources'][number],origin:'actual'|'synthetic'|'unverified'):ReportInput['metrics'] {
  if(payload.contract!=='moai.stock.price-history.v1'||!Array.isArray(payload.bars))return [];
  const bars=payload.bars.filter(isRecord);const last=bars.at(-1);if(!last)return [];
  const period=typeof last.date==='string'?last.date:(source.source_as_of??source.received_at??source.observed_at);
  const verified=last.mapping_status==='verified';
  const rightsAllowed=source.rights==='local_view'||origin==='synthetic';
  const specs=[['close','history.close','종가','KRW/share','KRW'],['volume','history.volume','거래량','shares',null],['turnover','history.turnover','거래대금','KRW','KRW']] as const;
  return specs.map(([key,id,label,unit,currency])=>{
    const raw=decimalLexeme(last[key]);
    if(!verified)return metric(id,label,null,unit,currency,'missing',source.id,period,'provider_field_mapping_blocked_or_unverified');
    if(!rightsAllowed)return metric(id,label,null,unit,currency,'rights_pending',source.id,period,'display_rights_not_confirmed');
    const status=origin==='synthetic'?(raw===null?'missing':'synthetic'):raw===null?'missing':source.validation_status==='independently_reconciled'?'provided':'provided_unverified';
    return metric(id,label,raw,unit,currency,status,source.id,period,raw===null?'provider_field_missing_or_invalid':undefined);
  });
}
function reportObservationMetrics(payload:Record<string,unknown>,source:ReportInput['sources'][number],origin:'actual'|'synthetic'|'unverified'):ReportInput['metrics'] {
  if(payload.contract!=='moai.stock.report-observations.v1')return [];
  const parsed=z.array(ObservationSchema).max(500).safeParse(payload.observations);
  if(!parsed.success)throw new Error('schema_drift');
  return parsed.data.map((item)=>{
    const rightsBlocked=origin!=='synthetic'&&source.rights!=='local_view';
    const value=rightsBlocked?null:item.value;
    const status:ReportInput['metrics'][number]['status']=rightsBlocked?'rights_pending':origin==='synthetic'?(value===null?'missing':'synthetic'):value===null?'missing':'provided_unverified';
    return {field_id:item.field_id,label:item.label,value,unit:item.unit,currency:item.currency,status,source_id:source.id,period:item.period,scale:item.scale,period_kind:item.period_kind,scope:item.scope,...(rightsBlocked?{missing_reason:'display_rights_not_confirmed'}:value===null?{missing_reason:'source_field_not_observed'}:{})};
  });
}
function reportVisuals(payload:Record<string,unknown>,source:ReportInput['sources'][number],origin:'actual'|'synthetic'|'unverified'):NonNullable<ReportInput['visuals']> {
  if(payload.contract!=='moai.stock.report-observations.v1'||origin!=='synthetic'||source.rights!=='synthetic_only'||source.validation_status!=='synthetic_fixture')return [];
  const parsed=z.array(VisualPayloadSchema).max(40).safeParse(payload.report_visuals??[]);
  if(!parsed.success)throw new Error('schema_drift');
  return parsed.data.map(visual=>({...visual,source_id:source.id}) as z.infer<typeof ReportVisualSchema>);
}
const ROUTE_BAR_FIELDS:Partial<Record<ReportRouteId,Record<string,string[]>>>= {
  R02:{'R02.S04':['etf.nav','quote.last']},
  R03:{'R03.S02':['flow.foreign.net_value','flow.individual.net_value','flow.institution.net_value']},
  R06:{'R06.S03':['flow.foreign.net_value','flow.individual.net_value','flow.institution.net_value']},
  R07:{'R07.S03':['provider_finance.operating_profit','estimates.consensus']},
  R08:{'R08.S02':['macro.actual','macro.expected','macro.previous']},
  R11:{'R11.S04':['provider_finance.operating_profit','estimates.consensus']},
};
function routeBarVisuals(reportId:ReportRouteId,metrics:ReportInput['metrics'],sources:ReportInput['sources'],existing:NonNullable<ReportInput['visuals']>):NonNullable<ReportInput['visuals']> {
  const route=routeDocument.routes[reportId];const presentation=getReportPresentation(reportId);if(!route||!presentation)return [];
  const sourceById=new Map(sources.map(source=>[source.id,source]));const output:NonNullable<ReportInput['visuals']>=[];
  for(const section of route.sections){
    const layout=presentation.sections.find(item=>item.id===section.id);if(!layout?.blocks.includes('bar')||existing.some(item=>item.section_id===section.id&&item.kind==='bar'))continue;
    const allowedFields=ROUTE_BAR_FIELDS[reportId]?.[section.id];if(!allowedFields)continue;
    const candidates=metrics.filter(item=>allowedFields.includes(item.field_id)&&(section.field_ids.includes(item.field_id)||section.metric_ids.includes(item.field_id))).filter(item=>{
      if(item.value===null)return false;const source=sourceById.get(item.source_id);if(!source)return false;
      if(source.kind==='synthetic')return item.status==='synthetic'&&source.rights==='synthetic_only'&&source.validation_status==='synthetic_fixture';
      if(source.kind==='user_supplied')return item.status==='provided_unverified'&&source.rights==='local_view'&&source.validation_status==='unverified';
      return item.status==='provided'&&source.rights==='local_view'&&['provider_shape_checked','independently_reconciled'].includes(source.validation_status??'');
    });
    const groups=new Map<string,typeof candidates>();
    for(const item of candidates){const key=JSON.stringify([item.source_id,item.period,item.period_kind,item.scope,item.unit,item.currency,item.scale]);const group=groups.get(key)??[];if(!group.some(existing=>existing.field_id===item.field_id))group.push(item);groups.set(key,group);}
    const selected=[...groups.values()].filter(group=>group.length>=2).sort((a,b)=>b.length-a.length)[0];if(!selected)continue;
    const points=selected.slice(0,50);if(points.length<2)continue;
    output.push({section_id:section.id,kind:'bar',title:'동일 기준으로 관측된 원수치 비교',labels:points.map(item=>item.label),values:points.map(item=>item.value!),unit:points[0]!.unit,source_id:points[0]!.source_id,metric_ids:points.map(item=>item.field_id)});
  }
  return output;
}
function parseDecimalParts(value:string):{coefficient:bigint;scale:number}|null {
  const match=value.match(/^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/);if(!match)return null;
  const fraction=match[3]??'';return {coefficient:BigInt(`${match[1]}${match[2]}${fraction}`),scale:fraction.length};
}
function roundedRatio(numeratorValue:string,denominatorValue:string,multiplier:number,places=4):string|null {
  const numerator=parseDecimalParts(numeratorValue),denominator=parseDecimalParts(denominatorValue);
  if(!numerator||!denominator||denominator.coefficient===0n||places<0||places>8)return null;
  let top=numerator.coefficient*10n**BigInt(denominator.scale)*BigInt(multiplier)*10n**BigInt(places);
  let bottom=denominator.coefficient*10n**BigInt(numerator.scale);
  if(bottom<0n){top=-top;bottom=-bottom;}
  let quotient=top/bottom;const remainder=top%bottom;if((remainder<0n?-remainder:remainder)*2n>=bottom)quotient+=top<0n?-1n:1n;
  const negative=quotient<0n;const digits=(negative?-quotient:quotient).toString().padStart(places+1,'0');
  const whole=places?digits.slice(0,-places):digits;const fraction=places?digits.slice(-places).replace(/0+$/,''):'';
  return `${negative?'-':''}${whole}${fraction?'.'+fraction:''}`;
}
function formatScaled(value:bigint,scale:number):string {
  const negative=value<0n,digits=(negative?-value:value).toString().padStart(scale+1,'0');
  const whole=scale?digits.slice(0,-scale):digits;const fraction=scale?digits.slice(-scale).replace(/0+$/,''):'';
  return `${negative?'-':''}${whole}${fraction?'.'+fraction:''}`;
}
function combineDecimal(a:string,b:string,subtract=false):string|null {
  const left=parseDecimalParts(a),right=parseDecimalParts(b);if(!left||!right)return null;
  const scale=Math.max(left.scale,right.scale);if(scale>18)return null;
  const x=left.coefficient*10n**BigInt(scale-left.scale),y=right.coefficient*10n**BigInt(scale-right.scale);
  return formatScaled(subtract?x-y:x+y,scale);
}
function subtractDecimal(a:string,b:string):string|null { return combineDecimal(a,b,true); }
function addDecimal(a:string,b:string):string|null { return combineDecimal(a,b,false); }
function multiplyDecimal(a:string,b:string):string|null {
  const left=parseDecimalParts(a),right=parseDecimalParts(b);if(!left||!right||left.scale+right.scale>18)return null;
  return formatScaled(left.coefficient*right.coefficient,left.scale+right.scale);
}
function compareDecimal(a:string,b:string):number|null {
  const left=parseDecimalParts(a),right=parseDecimalParts(b);if(!left||!right)return null;
  const scale=Math.max(left.scale,right.scale);if(scale>18)return null;
  const x=left.coefficient*10n**BigInt(scale-left.scale),y=right.coefficient*10n**BigInt(scale-right.scale);
  return x<y?-1:x>y?1:0;
}
function absDecimal(value:string):string|null { const parsed=parseDecimalParts(value);return parsed?formatScaled(parsed.coefficient<0n?-parsed.coefficient:parsed.coefficient,parsed.scale):null; }
function canCalculate(metric:ReportInput['metrics'][number]):boolean {
  return metric.value!==null&&['synthetic','provided','provided_unverified'].includes(metric.status);
}
function derivedMetric(field_id:string,label:string,value:string|null,unit:string,currency:string|null,status:ReportInput['metrics'][number]['status'],source:ReportInput['metrics'][number],missing_reason?:string):ReportInput['metrics'][number] {
  return {field_id,label,value,unit,currency,status,source_id:source.source_id,period:source.period,scale:'1',period_kind:source.period_kind,scope:source.scope,...(missing_reason?{missing_reason}:{})};
}
function sameBasis(left:ReportInput['metrics'][number],right:ReportInput['metrics'][number]):boolean {
  return left.period===right.period&&left.period_kind===right.period_kind&&left.scope===right.scope&&left.currency===right.currency&&left.unit===right.unit&&left.scale===right.scale;
}
function scaledDecimal(value:string,scale:string):string|null {
  const parsed=parseDecimalParts(value);if(!parsed)return null;
  const multiplier=BigInt(scale);return formatScaled(parsed.coefficient*multiplier,parsed.scale);
}
function deriveReportMetrics(reportId:ReportRouteId,metrics:ReportInput['metrics']):ReportInput['metrics'] {
  const plan=routeDocument.routes[reportId]!;const needed=new Set([...plan.sections.flatMap(section=>section.metric_ids),...Object.values(plan.field_groups).flat()]);
  const output=[...metrics];
  const by=(field:string,sourceId:string)=>output.find(item=>item.field_id===field&&item.source_id===sourceId);
  const sources=[...new Set(output.map(item=>item.source_id))];
  for(const sourceId of sources){
    const add=(id:string,label:string,value:string|null,unit:string,currency:string|null,bases:ReportInput['metrics'][number][],unavailableReason?:string)=>{
      if(!needed.has(id)||output.some(item=>item.field_id===id&&item.source_id===sourceId))return;
      const blocked=bases.some(item=>item.status==='rights_pending');
      const usable=bases.length>0&&bases.every(canCalculate);
      const status:ReportInput['metrics'][number]['status']=blocked?'rights_pending':!usable||value===null?'missing':bases.every(item=>item.status==='synthetic')?'synthetic':bases.every(item=>item.status==='provided')?'provided':'provided_unverified';
      output.push(derivedMetric(id,label,blocked?null:usable?value:null,unit,currency,status,bases[0]!,blocked?'display_rights_not_confirmed':usable&&value!==null?undefined:unavailableReason??'required_calculation_inputs_missing_or_incompatible'));
    };
    const quotePercent=by('quote.change_percent',sourceId);
    const last=by('quote.last',sourceId),previousClose=by('quote.previous_close',sourceId);
    if(quotePercent&&canCalculate(quotePercent)&&(!last||!previousClose||!canCalculate(last)||!canCalculate(previousClose)||!sameBasis(last,previousClose))){
      add('metric.change_pct','공급자 보고 가격 변동률',quotePercent.value,'%',null,[quotePercent]);
    }else if(last&&previousClose){
      const compatible=sameBasis(last,previousClose);
      const delta=compatible&&canCalculate(last)&&canCalculate(previousClose)?subtractDecimal(last.value!,previousClose.value!):null;
      const value=delta!==null&&parseDecimalParts(previousClose.value!)?.coefficient!==0n?roundedRatio(delta,previousClose.value!,100):null;
      add('metric.change_pct','가격 변동률',value,'%',null,[last,previousClose]);
    }else if(quotePercent)add('metric.change_pct','가격 변동률',quotePercent.value,'%',null,[quotePercent]);
    const netIncome=by('reported.net_income_common',sourceId),weightedShares=by('reported.shares_weighted',sourceId);
    if(netIncome&&weightedShares){
      const samePeriod=netIncome.period===weightedShares.period&&netIncome.period_kind===weightedShares.period_kind&&netIncome.scope===weightedShares.scope&&netIncome.currency!==null&&(weightedShares.currency===null||netIncome.currency===weightedShares.currency);
      const supportedUnits=netIncome.unit===netIncome.currency&&weightedShares.unit==='shares';
      const amount=canCalculate(netIncome)?scaledDecimal(netIncome.value!,netIncome.scale):null;
      const shares=canCalculate(weightedShares)?scaledDecimal(weightedShares.value!,weightedShares.scale):null;
      const shareParts=shares===null?null:parseDecimalParts(shares);
      const positiveShares=shareParts!==null&&shareParts.coefficient>0n;
      const value=samePeriod&&supportedUnits&&amount!==null&&shares!==null&&positiveShares?roundedRatio(amount,shares,1,6):null;
      add('metric.eps','주당순이익(가중평균주식수 기준)',value,`${netIncome.currency}/share`,netIncome.currency,[netIncome,weightedShares]);
    }
    const operating=by('provider_finance.operating_profit',sourceId),revenue=by('provider_finance.revenue',sourceId);
    if(operating&&revenue){
      const compatible=sameBasis(operating,revenue);
      const value=compatible&&canCalculate(operating)&&canCalculate(revenue)&&parseDecimalParts(revenue.value!)?.coefficient!==0n?roundedRatio(operating.value!,revenue.value!,100):null;
      add('metric.operating_margin','영업이익률',value,'%',null,[operating,revenue]);
    }
    const cfo=by('reported.cfo',sourceId),capex=by('reported.capex',sourceId);
    if(cfo&&capex){
      const compatible=sameBasis(cfo,capex);const capexParts=capex.value===null?null:parseDecimalParts(capex.value);
      const positiveCapex=capexParts!==null&&capexParts.coefficient>=0n;
      const value=compatible&&positiveCapex&&canCalculate(cfo)&&canCalculate(capex)?subtractDecimal(cfo.value!,capex.value!):null;
      add('metric.fcf','잉여현금흐름 · 양수 투자지출 차감',value,cfo.unit,cfo.currency,[cfo,capex],compatible&&capex.value!==null&&!positiveCapex?'capex_must_be_normalized_as_nonnegative_cash_outflow':undefined);
    }
    const etfNav=by('etf.nav',sourceId),etfPrice=by('quote.last',sourceId);
    if(etfNav&&etfPrice){
      const compatible=sameBasis(etfNav,etfPrice);const nav=etfNav.value===null?null:parseDecimalParts(etfNav.value);const price=etfPrice.value===null?null:parseDecimalParts(etfPrice.value);
      const positive=nav!==null&&price!==null&&nav.coefficient>0n&&price.coefficient>0n;
      const delta=compatible&&positive&&canCalculate(etfNav)&&canCalculate(etfPrice)?subtractDecimal(etfPrice.value!,etfNav.value!):null;
      const premium=delta!==null?roundedRatio(delta,etfNav.value!,100):null;
      add('metric.etf_premium','ETF 가격·NAV 괴리율 · 동일 기준',premium,'%',null,[etfPrice,etfNav],compatible&&etfPrice.value!==null&&etfNav.value!==null&&!positive?'positive_price_and_nav_required':undefined);
    }
    const actual=by('provider_finance.operating_profit',sourceId),estimate=by('estimates.consensus',sourceId);
    const macroActual=by('macro.actual',sourceId),macroExpected=by('macro.expected',sourceId);
    if(actual&&estimate&&!(reportId==='R08'&&macroActual&&macroExpected)){
      const compatible=sameBasis(actual,estimate);
      const delta=compatible&&canCalculate(actual)&&canCalculate(estimate)?subtractDecimal(actual.value!,estimate.value!):null;
      const absoluteEstimate=absDecimal(estimate.value!);const value=delta!==null&&absoluteEstimate!==null&&parseDecimalParts(absoluteEstimate)?.coefficient!==0n?roundedRatio(delta,absoluteEstimate,100):null;
      add('metric.surprise','예상 대비 차이',value,'%',null,[actual,estimate]);
    }
    if(reportId==='R08'&&macroActual&&macroExpected){
      const compatible=sameBasis(macroActual,macroExpected);
      const delta=compatible&&canCalculate(macroActual)&&canCalculate(macroExpected)?subtractDecimal(macroActual.value!,macroExpected.value!):null;
      const absoluteExpected=macroExpected.value===null?null:absDecimal(macroExpected.value);
      const value=delta!==null&&absoluteExpected!==null&&parseDecimalParts(absoluteExpected)?.coefficient!==0n?roundedRatio(delta,absoluteExpected,100):null;
      add('metric.surprise','거시 발표값의 시장 예상 대비 차이',value,'%',null,[macroActual,macroExpected]);
    }
    const bid=by('liquidity.best_bid',sourceId),ask=by('liquidity.best_ask',sourceId);
    if(bid&&ask){
      const compatible=sameBasis(bid,ask);
      const delta=compatible&&canCalculate(bid)&&canCalculate(ask)?subtractDecimal(ask.value!,bid.value!):null;
      const sum=compatible&&canCalculate(bid)&&canCalculate(ask)?addDecimal(ask.value!,bid.value!):null;
      const deltaParts=delta===null?null:parseDecimalParts(delta);const sumParts=sum===null?null:parseDecimalParts(sum);
      const positive=deltaParts!==null&&deltaParts.coefficient>=0n;
      const value=delta!==null&&sum!==null&&sumParts!==null&&sumParts.coefficient>0n&&positive?roundedRatio(delta,sum,20000):null;
      add('metric.spread_bps','매수·매도 호가 차이',value,'bp',null,[bid,ask]);
    }
  }
  return output;
}
function deriveHistoryReportMetrics(reportId:ReportRouteId,calls:NormalizedCall[],metrics:ReportInput['metrics']):ReportInput['metrics'] {
  const plan=routeDocument.routes[reportId]!;
  const needed=new Set(plan.sections.flatMap(section=>section.metric_ids));
  const output=[...metrics];
  const add=(id:string,label:string,value:string|null,unit:string,status:ReportInput['metrics'][number]['status'],base:ReportInput['metrics'][number],reason?:string)=>{
    if(!needed.has(id)||output.some(item=>item.field_id===id&&item.source_id===base.source_id))return;
    output.push(derivedMetric(id,label,value,unit,base.currency,value===null&&status!=='rights_pending'?'missing':status,base,reason));
  };
  for(const call of calls){
    const series=call.time_series;
    if(!series)continue;
    const base=output.find(item=>item.field_id==='history.close'&&item.source_id===series.source_id);
    if(!base)continue;
    const closes=series.series.find(item=>item.field_id==='history.close');
    if(!closes)continue;
    const latest=closes.values.at(-1)??null;
    const sma20=series.series.find(item=>item.field_id==='history.sma_20');
    const average=sma20?.values.at(-1)??null;
    add('metric.ma20','20일 단순이동평균',average,series.unit,base.status,base,average===null?'20개 검증 종가가 없어 이동평균을 계산하지 않았습니다.':undefined);
    const first=closes.values[0]??null;
    const firstParts=first===null?null:parseDecimalParts(first);
    const rebased=latest!==null&&first!==null&&firstParts!==null&&firstParts.coefficient>0n?roundedRatio(latest,first,100):null;
    add('metric.price_rebased','시작 종가=100 기준 지수',rebased,'index (base 100)',base.status,base,rebased===null?'양의 시작 종가가 확인되지 않아 기준지수화를 하지 않았습니다.':undefined);
  }
  return output;
}

function quoteChart(metrics:ReportInput['metrics'],source:ReportInput['sources'][number],origin:'actual'|'synthetic'|'unverified'):ReportInput['chart'] {
  const displayable=(source.rights==='synthetic_only'&&origin==='synthetic'&&source.validation_status==='synthetic_fixture')||(source.rights==='local_view'&&['provider_shape_checked','independently_reconciled'].includes(source.validation_status??''));if(!displayable)return null;
  const ids=['quote.open','quote.high','quote.low','quote.last'];const selected=ids.map((id)=>metrics.find((item)=>item.field_id===id&&item.source_id===source.id));
  if(selected.some((item)=>!item||item.value===null||item.unit!==selected[0]?.unit||!['synthetic','provided','provided_unverified'].includes(item.status)))return null;
  const points=selected as NonNullable<(typeof selected)[number]>[];
  return {title:'시가·고가·저가·최근가',kind:'bar',labels:points.map((item)=>item.label),values:points.map((item)=>item.value!),unit:points[0]!.unit,source_id:source.id,metric_ids:points.map((item)=>item.field_id)};
}
function sourceFor(tool:ToolBinding,payload:Record<string,unknown>,origin:'actual'|'synthetic'|'unverified',receivedAt:string,index:number,trustedLocal=false):ReportInput['sources'][number] {
  const p=isRecord(payload.provenance)?payload.provenance:{};
  // The injected caller timestamp is the receipt time. Provider payload metadata
  // cannot redefine it or grant display rights.
  const observed=receivedAt;
  const available=cleanTimestamp(payload.available_at??p.available_at,receivedAt);
  const asOf=cleanSourceAsOf(payload.source_as_of??p.source_as_of);
  const validation=recognizedValidation(payload.validation_status??p.validation_status,origin);
  const id=`src-${index+1}-${tool.name}`;
  const sourceKind=origin==='synthetic'?'synthetic':providerKind[tool.provider];
  const revision=[payload.revision_id,p.provider_api_version,p.api_version].find(v=>typeof v==='string'&&v.length>0&&v.length<=120);
  return {
    id,kind:sourceKind,title:`${tool.provider.toUpperCase()} · ${tool.name}`,url:PROVIDER_URL[tool.provider],
    observed_at:observed,available_at:available,rights:origin==='synthetic'?'synthetic_only':trustedLocal&&origin==='actual'?'local_view':'pending',
    revision:typeof revision==='string'?revision:'unknown',provider:tool.provider,operation_ref:operationRef(payload,tool),source_as_of:asOf,received_at:receivedAt,validation_status:trustedLocal&&origin==='actual'?'provider_shape_checked':validation,
  };
}
function sourceTables(payload:Record<string,unknown>,source:ReportInput['sources'][number]):NonNullable<ReportInput['source_tables']>{
 if(source.rights!=='local_view'&&source.rights!=='synthetic_only')return [];
 const text=(v:unknown)=>typeof v==='string'?(v.trim()===''?'미제공':v):typeof v==='number'?String(v):'미제공';

 if(payload.contract==='moai.stock.market-risk.v1'&&Array.isArray(payload.rows)){
  const rows=payload.rows.filter(isRecord);const raw=(r:Record<string,unknown>,k:string)=>isRecord(r.raw_fields)&&isRecord(r.raw_fields[k])?text(r.raw_fields[k].raw_value):'미제공';
  const qty=(r:Record<string,unknown>,k:string)=>{const q=isRecord(r.unit_verified_quantities)?r.unit_verified_quantities[k]:null;return isRecord(q)&&q.state==='unit_verified'&&q.unit==='shares'?text(q.value):'미제공';};
  const dates=(r:Record<string,unknown>)=>isRecord(r.date_basis)?r.date_basis:{};
  if(payload.kind==='credit')return [{source_id:source.id,title:'종목 신용잔고 · 개인 계좌가 아닌 시장 통계',columns:['거래일','결제일','신용융자 잔고(주)','대주 잔고(주)'],rows:rows.map(r=>[text(dates(r).trade_date),text(dates(r).settlement_date),qty(r,'whol_loan_rmnd_stcn'),qty(r,'whol_stln_rmnd_stcn')]),coverage_note:'공식 필드에서 주 단위가 확인된 수량만 표시합니다. 거래일과 결제일은 다르며 한 페이지가 전체 기간을 보장하지 않습니다. 비율·반대매매 또는 투자자의 의도를 추정하지 않습니다.'}];
  if(payload.kind==='lending')return [{source_id:source.id,title:'종목 대차거래 · 공매도와 구분',columns:['영업일','신규 대차(주)','상환 대차(주)','대차 잔고(주)'],rows:rows.map(r=>[text(dates(r).business_date),qty(r,'new_stcn'),qty(r,'rdmp_stcn'),qty(r,'rmnd_stcn')]),coverage_note:'공식 주수 필드만 표시합니다. 신규·상환·잔고는 서로 다른 개념이며 대차잔고 증가를 공매도 실행이나 하락 확정으로 해석하지 않습니다. 전체 기간·금액 배율은 미검증입니다.'}];
  if(payload.kind==='short_sale')return [{source_id:source.id,title:'종목 공매도 일별 원문',columns:['영업일','공매도 수량 원문','수량 비중 원문','공매도 금액 원문'],rows:rows.filter(r=>r.response_root==='output2').map(r=>[text(dates(r).business_date),raw(r,'ssts_cntg_qty'),raw(r,'ssts_vol_rlim'),raw(r,'ssts_tr_pbmn')]),coverage_note:'일별 output2만 표시합니다. output1 요약을 일별 자료에 더하지 않습니다. 수량·금액 단위와 비중 분모는 정규화 미완료이므로 합산·환산·확률 해석에 쓰지 않습니다.'}];
 }
 if(payload.contract==='moai.stock.market-orderbook.v1'&&isRecord(payload.raw)&&isRecord(payload.raw.output1)){
  const raw=payload.raw.output1;return [{source_id:source.id,title:'종목 호가 원문 스냅샷',columns:['단계','매도 호가 원문','매수 호가 원문','매도 잔량 원문','매수 잔량 원문'],rows:Array.from({length:10},(_,i)=>[String(i+1),...['askp','bidp','askp_rsqn','bidp_rsqn'].map(k=>text(raw[k+(i+1)]))]),coverage_note:'요청 종목의 반환 원문이며 체결 가능 호가·동시 관측·유동성 보장을 뜻하지 않습니다. 가격·잔량 단위와 거래 상태를 확인하기 전 스프레드나 체결 비용을 계산하지 않습니다.'}];
 }
 if(payload.contract==='moai.stock.us-quote.v1'&&isRecord(payload.raw)){
  const raw=payload.raw;return [{source_id:source.id,title:'미국 주식·ETF 공유 시세 원문',columns:['항목','원문 값'],rows:[['현재 가격',text(raw.last)],['전일 기준 가격',text(raw.base)],['거래량',text(raw.tvol)],['거래대금',text(raw.tamt)]],coverage_note:'요청한 상품 종류와 실제 상품 식별은 구분합니다. 통화·가격 배율·세션·단위 검증 전 환산·수익률·ETF 괴리율을 계산하지 않습니다. 구성 종목·비용률·분배금 자료가 아닙니다.'}];
 }
 if(payload.contract==='moai.stock.domestic-etf-quote.v1'&&isRecord(payload.raw)){
  const raw=payload.raw;return [{source_id:source.id,title:'ETF·ETN 전용 시세·순자산가치 원문',columns:['항목','원문 값'],rows:[['거래 가격',text(raw.stck_prpr)],['순자산가치',text(raw.nav)],['전일 순자산가치',text(raw.prdy_last_nav)],['순자산 총액',text(raw.etf_ntas_ttam)]],coverage_note:'ETF/ETN 분류·통화/배율·NAV와 추적오차 산식을 검증하기 전 원화 환산·괴리율 계산을 하지 않습니다. 상품 구성 종목이나 보유비중 자료가 아닙니다. 만기 원문 0은 달력 날짜로 표시하지 않습니다.'}];
 }
 if(['moai.stock.index-futures-quote.v1','moai.stock.overseas-futures-quote.v1'].includes(String(payload.contract))&&isRecord(payload.raw)){
  const domestic=payload.contract==='moai.stock.index-futures-quote.v1';const raw=domestic&&isRecord(payload.raw.output1)?payload.raw.output1:payload.raw;
  const fields=domestic?[['현재 가격','futs_prpr'],['시가','futs_oprc'],['고가','futs_hgpr'],['저가','futs_lwpr'],['미결제약정','hts_otst_stpl_qty']]:[['현재 가격','last_price'],['시가','open_price'],['고가','high_price'],['저가','low_price']];
  return [{source_id:source.id,title:(domestic?'국내':'해외')+' 선물 시세 원문',columns:['항목','원문 값'],rows:fields.map(([label,key])=>[label!,text(raw[key!])]),coverage_note:'계약·통화·단위·세션·승수·만기는 별도 검증 대상입니다. 음수 가격은 그대로 보존하며 명목금액·손익·증거금·롤 성과를 계산하지 않습니다.'}];
 }
 if(payload.contract==='moai.stock.investor-raw.v1'&&Array.isArray(payload.rows)){return [{source_id:source.id,title:'개인·외국인·기관 순매수 수급',columns:['영업일','개인 순매수 수량 원문','외국인 순매수 수량 원문','기관 순매수 수량 원문','개인 순매수 금액 원문','외국인 순매수 금액 원문','기관 순매수 금액 원문'],rows:payload.rows.map(item=>{if(!isRecord(item))throw Error('schema_drift');return ['stck_bsop_date','prsn_ntby_qty','frgn_ntby_qty','orgn_ntby_qty','prsn_ntby_tr_pbmn','frgn_ntby_tr_pbmn','orgn_ntby_tr_pbmn'].map(k=>text(item[k]));}),coverage_note:'실제 반환 영업일의 순매수 원문입니다. 수량·금액 단위와 배율이 미확인이라 합산·원화 변환·기간 추세 확정은 보류합니다. 당일은 정규장 종료 후 제공되며 외국인 보유율과 다릅니다.'}];}
 if(payload.contract==='moai.stock.price-history.v1'&&Array.isArray(payload.raw_rows)&&payload.raw_rows.length<=100){return [{source_id:source.id,title:'KIS 일봉 원문 값',columns:['영업일','시가 원문','고가 원문','저가 원문','종가 원문','거래량 원문','거래대금 원문'],rows:payload.raw_rows.map(item=>{if(!isRecord(item)||!isRecord(item.fields))throw Error('schema_drift');const f=item.fields;return [item.date,...['stck_oprc','stck_hgpr','stck_lwpr','stck_clpr','acml_vol','acml_tr_pbmn'].map(k=>isRecord(f[k])?f[k].value:null)].map(text);}),coverage_note:'단위·통화·배율 미확인 원문입니다. 종가 시각이나 전체 기간 완전성을 추정하지 않으며 canonical OHLCV 계산에는 쓰지 않습니다.'}];}
 if(payload.contract==='moai.stock.instrument-profile.v1'&&isRecord(payload.profile)){return [{source_id:source.id,title:'KIS 종목 기본정보',columns:['필드','수신 원문'],rows:Object.entries(payload.profile).map(([k,v])=>[k,text(v)]),coverage_note:'상품번호는 단축 종목코드와 다를 수 있습니다. request_filter_only는 요청 필터만 확인했으며 독립 종목 식별 완료가 아닙니다.'}];}
 if(payload.source==='opendart'&&payload.status==='ok'&&Array.isArray(payload.rows)&&payload.rows.length<=250){
  const financial=isRecord(payload.request)&&'fs_div' in payload.request;
  const columns=financial?['재무 항목','당기 금액','전기 금액','당기·전기 기간','재무제표','연결·별도','통화 단위','출처']:['공시일 원문','공시명','제출인','접수번호','비고'];
  const relevantFinancial=new Set(['IS/ifrs-full_Revenue','IS/dart_OperatingIncomeLoss','IS/ifrs-full_ProfitLoss','CF/ifrs-full_CashFlowsFromUsedInOperatingActivities','BS/ifrs-full_Assets','BS/ifrs-full_CashAndCashEquivalents','BS/ifrs-full_Equity','BS/ifrs-full_Liabilities']);
  const displayRows=financial?payload.rows.filter(item=>isRecord(item)&&isRecord(item.raw)&&relevantFinancial.has(`${item.raw.sj_div}/${item.raw.account_id}`)):payload.rows;
  const rows=displayRows.map(item=>{if(!isRecord(item)||!isRecord(item.raw))throw Error('schema_drift');const r=item.raw;return (financial?[r.account_nm,r.thstrm_amount,r.frmtrm_amount,`${text(r.thstrm_nm)} / ${text(r.frmtrm_nm)}`,({BS:'재무상태표',IS:'손익계산서',CF:'현금흐름표'} as Record<string,string>)[text(r.sj_div)]??'미확인',isRecord(payload.request)&&payload.request.fs_div==='CFS'?'연결':isRecord(payload.request)&&payload.request.fs_div==='OFS'?'별도':'미확인',r.currency,typeof r.rcept_no==='string'?`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r.rcept_no}`:'미제공']:[r.rcept_dt,r.report_nm,r.flr_nm,r.rcept_no,r.rm]).map(text);});
  return [{source_id:source.id,title:financial?'DART 재무제표 원문 금액':'DART 수신 공시 목록',columns,rows,coverage_note:financial?'원문 금액·통화·기간 표기를 보존합니다. 계정 역할·배율·기간 경계 검증 전 비율이나 가치평가에 사용하지 않습니다.':payload.has_more===true?'추가 페이지가 있습니다. 현재 수신한 첫 페이지만 표시합니다.':'수신 응답 범위입니다. 공시일을 사건 발생시각으로 해석하지 않습니다.'}];
 }
 if(payload.contract==='moai.stock.headlines.v1'&&Array.isArray(payload.headlines)&&payload.headlines.length<=100){return [{source_id:source.id,title:'KIS 뉴스 제목 메타데이터',columns:['일자 원문','시각 원문','제목','제공기관','종목 연결'],rows:payload.headlines.map(item=>{if(!isRecord(item))throw Error('schema_drift');return [item.data_dt,item.data_tm,item.hts_pbnt_titl_cntt,item.dorg,item.instrument_association].map(text);}),coverage_note:'제목만 수신했습니다. 기사 본문·전체 뉴스·발행시각의 시간대는 확인되지 않았습니다.'}];}
 return [];
}
export function normalizeMcpToolResult(toolName:string,resultValue:unknown,receivedAt:string,index=0,trustedLocal=false):NormalizedCall {
  const tool=TOOL_META.get(toolName);
  if(!tool)throw new Error('unknown_report_tool');
  const receipt=timestamp.parse(receivedAt);
  const result=(isRecord(resultValue)?resultValue:{}) as ToolResultLike;
  if(result.isError===true)return {tool_name:toolName,provider:tool.provider,outcome:'error',error_code:safeErrorCode(result),source:null,metrics:[],visuals:[],chart:null,time_series:null,origin:'unverified'};
  let payload:unknown=result.structuredContent;
  if(payload===undefined||payload===null){const text=payloadText(result);if(!text)return {tool_name:toolName,provider:tool.provider,outcome:'error',error_code:'schema_drift',source:null,metrics:[],visuals:[],chart:null,time_series:null,origin:'unverified'};payload=parseJsonText(text);}
  if(!isRecord(payload))return {tool_name:toolName,provider:tool.provider,outcome:'error',error_code:'schema_drift',source:null,metrics:[],visuals:[],chart:null,time_series:null,origin:'unverified'};
  const text=JSON.stringify(payload);if(Buffer.byteLength(text,'utf8')>300_000)return {tool_name:toolName,provider:tool.provider,outcome:'error',error_code:'response_too_large',source:null,metrics:[],visuals:[],chart:null,time_series:null,origin:'unverified'};
  const origin=readOrigin(payload);const source=sourceFor(tool,payload,origin,receipt,index,trustedLocal);
  try{
    const metrics=[...quoteMetrics(payload,source,origin),...dartReportedMetrics(payload,source,origin),...historyMetrics(payload,source,origin),...reportObservationMetrics(payload,source,origin)];
    const visuals=reportVisuals(payload,source,origin);
    return {tool_name:toolName,provider:tool.provider,outcome:'success',error_code:null,source,source_tables:sourceTables(payload,source),metrics,visuals,chart:quoteChart(metrics,source,origin),time_series:timeSeriesFromHistory(payload,source,origin),origin};
  }catch(error){
    const errorCode=error instanceof Error&&SAFE_ERROR_CODES.has(error.message)?error.message:'schema_drift';
    return {tool_name:toolName,provider:tool.provider,outcome:'error',error_code:errorCode,source:null,metrics:[],visuals:[],chart:null,time_series:null,origin:'unverified'};
  }
}

export function getReportPlan(reportId:string):ReportPlan {
  if(!REPORT_ROUTE_IDS.includes(reportId as ReportRouteId))throw new Error('unsupported_report_route');
  const route=routeDocument.routes[reportId];if(!route)throw new Error('route_binding_missing');
  const groups=Object.entries(route.field_groups).map(([id,fields])=>{
    const groupId=id as GroupId;const binding=GROUP_BINDINGS[groupId];
    if(!binding)throw new Error('route_group_binding_missing');
    return {id:groupId,required_fields:[...new Set(fields??[])],tools:binding.tools.map(t=>({...t})),note:binding.note};
  });
  const presentation=getReportPresentation(reportId);
  if(presentation&&JSON.stringify(presentation.sections.map(s=>s.id))!==JSON.stringify(route.sections.map(s=>s.id)))throw new Error('layout_profile_section_mismatch');
  return {report_id:reportId as ReportRouteId,title:route.title,sections:route.sections,groups,...(presentation?{presentation}:{})};
}

export type BuildReportInputArgs = {
  report_id:string;subject:{id:string;name:string;venue:string;currency:string};cutoff:string;display_timezone:ReportInput['display_timezone'];
  calls?:readonly {tool_name:string;result:unknown}[];received_at?:string;trustedLocalReceipts?:ReadonlyMap<number,{receivedAt:string}>;user_supplied?:z.infer<typeof UserSuppliedFinanceSchema>;
};

const ReportPipelineCallSchema = z.object({
  tool_name:z.string().min(1).max(120),
  result:z.record(z.string(),z.unknown()),
}).strict();
/** Input schema for the local-only MCP report assembler. It accepts prior MCP results; it never invokes providers. */
export const ReportPipelineToolInputSchema = z.object({
  report_id:z.enum(ACTIVE_REPORT_ROUTE_IDS),
  subject:z.object({id:z.string().min(1).max(200),name:z.string().min(1).max(200),venue:z.string().min(1).max(200),currency:z.string().min(1).max(200)}).strict(),
  cutoff:timestamp,
  display_timezone:z.enum(['Asia/Seoul','UTC','America/New_York','Europe/London','Asia/Tokyo']),
  calls:z.array(ReportPipelineCallSchema).max(100).default([]),
  source_receipts:z.array(z.string().uuid()).max(12).optional(),
}).strict().superRefine((value,ctx)=>{
  const bytes=Buffer.byteLength(JSON.stringify(value.calls??[]),'utf8');
  if(bytes>220_000)ctx.addIssue({code:'custom',message:'report_input_too_large'});
});
type LocalUserData = {source:ReportInput['sources'][number];metrics:ReportInput['metrics'];visuals:NonNullable<ReportInput['visuals']>};
function userSuppliedMetric(field_id:string,label:string,value:string|null,unit:string,currency:string|null,sourceId:string,period:string,missing_reason?:string):ReportInput['metrics'][number] {
  return {field_id,label,value,unit,currency,status:value===null?'missing':'provided_unverified',source_id:sourceId,period,scale:'1',period_kind:'observation',scope:'not_applicable',...(missing_reason?{missing_reason}:{})};
}
function buildLocalUserData(reportId:ReportRouteId,value:unknown,receivedAt:string):LocalUserData|undefined {
  if(value===undefined)return undefined;
  const parsed=UserSuppliedFinanceSchema.parse(value);
  if(parsed.account_ledger&&reportId!=='R04')throw new Error('user_account_input_only_supported_by_R04');
  if(parsed.backtest_curve&&reportId!=='R14')throw new Error('user_equity_curve_only_supported_by_R14');
  const asOf=parsed.account_ledger?.as_of??parsed.backtest_curve!.points.at(-1)!.date;
  const sourceId='src-user-supplied-local';
  const source:ReportInput['sources'][number]={id:sourceId,kind:'user_supplied',title:parsed.account_ledger?'사용자 제공 자산 원장':'사용자 제공 전략 자산곡선',url:null,observed_at:receivedAt,available_at:receivedAt,rights:'local_view',revision:'user-input-v1',operation_ref:parsed.account_ledger?'local.user-input.account-ledger.v1':'local.user-input.backtest-curve.v1',source_as_of:asOf,received_at:receivedAt,validation_status:'unverified'};
  const metrics:ReportInput['metrics']=[];const visuals:NonNullable<ReportInput['visuals']>=[];
  if(parsed.account_ledger){
    const input=parsed.account_ledger;const grouped=new Map<string,string>();
    for(const position of input.positions){const current=grouped.get(position.label)??'0';const total=addDecimal(current,position.market_value);if(total===null)throw new Error('invalid_user_position_decimal');grouped.set(position.label,total);}
    const positions=[...grouped.entries()].map(([label,marketValue])=>({label,marketValue}));
    const spotValue=positions.reduce<string>((total,item)=>{const next=addDecimal(total,item.marketValue);if(next===null)throw new Error('user_position_total_overflow');return next;},'0');
    const assets=addDecimal(spotValue,input.cash);const nav=assets===null?null:subtractDecimal(assets,input.liabilities);
    const spotParts=parseDecimalParts(spotValue);const positiveSpot=spotParts!==null&&spotParts.coefficient>0n;
    const squares=positions.reduce<string|null>((total,item)=>{const square=multiplyDecimal(item.marketValue,item.marketValue);return square===null?null:total===null?square:addDecimal(total,square);},'0');
    const spotSquared=multiplyDecimal(spotValue,spotValue);const hhi=positiveSpot&&squares!==null&&spotSquared!==null?roundedRatio(squares,spotSquared,1,6):null;
    for(const position of positions)metrics.push(userSuppliedMetric('account.positions',`보유 포지션 · ${position.label}`,position.marketValue,input.currency,input.currency,sourceId,input.as_of));
    metrics.push(userSuppliedMetric('account.cash_by_currency',`현금 · ${input.currency}`,input.cash,input.currency,input.currency,sourceId,input.as_of));
    metrics.push(userSuppliedMetric('account.liabilities','부채',input.liabilities,input.currency,input.currency,sourceId,input.as_of));
    metrics.push(userSuppliedMetric('account.spot_value','주식 포지션 평가액 합계',spotValue,input.currency,input.currency,sourceId,input.as_of));
    metrics.push(userSuppliedMetric('metric.NAV','순자산 · 사용자 입력 기준',nav,input.currency,input.currency,sourceId,input.as_of,nav===null?'user_input_calculation_overflow':undefined));
    metrics.push(userSuppliedMetric('metric.HHI','포지션 비중 HHI · 포지션 평가액 기준',hhi,'index (0–1)',null,sourceId,input.as_of,hhi===null?'positive_spot_value_required':undefined));
    if(positions.length>=2&&positions.length<=50)visuals.push({section_id:'R04.S01',kind:'donut',title:'사용자 제공 포지션 평가액 구성',labels:positions.map(position=>position.label),values:positions.map(position=>position.marketValue),unit:input.currency,source_id:sourceId,metric_ids:positions.map(()=> 'account.positions')});
  }
  if(parsed.backtest_curve){
    const input=parsed.backtest_curve;let peak=input.points[0]!.equity;let maxDrawdown='0';
    for(const point of input.points){if((compareDecimal(point.equity,peak)??-1)>0)peak=point.equity;const delta=subtractDecimal(peak,point.equity);const drawdown=delta===null?null:roundedRatio(delta,peak,100,6);if(drawdown===null)throw new Error('user_equity_curve_calculation_failed');if((compareDecimal(drawdown,maxDrawdown)??-1)>0)maxDrawdown=drawdown;metrics.push(userSuppliedMetric('backtest.equity_value','사용자 제공 자산곡선 · '+point.date,point.equity,input.currency,input.currency,sourceId,point.date));}
    const period=`${input.points[0]!.date}..${input.points.at(-1)!.date}`;
    metrics.push(userSuppliedMetric('metric.max_drawdown','입력 자산곡선 최대낙폭',maxDrawdown,'%',null,sourceId,period));
    if(input.points.length<=50)visuals.push({section_id:'R14.S06',kind:'line',title:'사용자 제공 자산곡선 · 비용/체결 가정은 별도 확인',labels:input.points.map(point=>point.date),values:input.points.map(point=>point.equity),unit:input.currency,source_id:sourceId,metric_ids:input.points.map(()=> 'backtest.equity_value')});
  }
  return {source,metrics,visuals};
}
function sectionStatus(groupCalls:NormalizedCall[],hasTools:boolean):ReportInput['sections'][number]['status'] {
  if(!hasTools)return 'not_run';
  if(groupCalls.length===0)return 'not_run';
  if(groupCalls.some(c=>(c.outcome==='error'&&c.error_code==='rights_pending')||(c.source?.rights==='pending'&&c.origin!=='synthetic')))return 'rights_pending';
  if(groupCalls.every(c=>c.outcome==='error'))return 'error';
  return 'partial';
}
function missingReason(status:ReportInput['sections'][number]['status'],calls:NormalizedCall[],hasTools:boolean):string {
  if(!hasTools)return '현재 연결된 MCP 도구가 없어 이 데이터 그룹은 구현 전입니다.';
  if(calls.length===0)return '필요 도구가 아직 호출되지 않았습니다.';
  if(status==='rights_pending')return '데이터 권리 게이트가 닫혀 전송 또는 표시 가능한 값이 없습니다.';
  const failed=calls.find(c=>c.error_code);
  if(failed)return `도구 응답 오류(${failed.error_code}); 원문 오류와 민감 응답은 보고서 입력에 복사하지 않았습니다.`;
  return '부분 응답입니다. 필드·단위·기준시각·권리 검증이 끝나지 않아 완전성은 확인되지 않았습니다.';
}
const ROUTE_READOUT:Record<ReportRouteId,string>={
  R01:'종목 심층 분석은 확인된 관측·계산과 해석 가설을 분리합니다. 주가 이력·재무·수급의 시점과 단위가 다르면 한 신호로 합치지 않습니다.',
  R02:'기업·상품 비교는 대상별 기간·통화·회계 범위가 맞을 때만 나란히 읽습니다. 비교군이나 기준이 빠지면 순위와 우열을 만들지 않습니다.',
  R03:'수급 보고서는 투자자별 순매수, 거래대금 대비 강도, 공매도, 대차, 신용 자료를 별도 관측으로 다룹니다. 어느 한 항목도 가격 방향의 확정 신호로 해석하지 않습니다.',
  R04:'자산·위험 진단은 사용자가 제공한 원장만 계산 대상으로 삼습니다. 계좌 API를 조회하지 않으며 현금·평가액·부채의 통화와 기준시각이 맞지 않으면 순자산 합산을 보류합니다.',
  R05:'성과·비용 분석은 입출금, 거래비용, 세금과 환전을 분리해야 합니다. 빠진 현금흐름이나 체결 정보로 순수익률을 추정하지 않습니다.',
  R06:'시장 브리핑은 한국과 해외의 현지 거래일·세션·통화·수신시각을 나눠 보여줍니다. 지수 움직임만으로 거시 원인이나 자산 영향의 인과를 단정하지 않습니다.',
  R07:'이벤트 리뷰는 공시 접수·정정·발표·발효 시점을 구분합니다. 예상 대비 차이는 같은 지표·기간·회계 범위가 확인될 때만 계산합니다.',
  R08:'거시·자산배분 브리핑은 발표값·예상·이전값·수정 빈티지와 시장 시계열을 구분합니다. 시나리오는 조건부 설명이며 자산 가격의 예측값이 아닙니다.',
  R09:'투자논지 점검은 사용자가 적은 주장, 지지 근거, 반대 근거, 확인 조건을 분리합니다. 종목을 매수·매도하라는 문장으로 바꾸지 않습니다.',
  R10:'마감 전 후보 점검은 관측 시각, 거래 상태, 유동성, 이벤트 위험과 제외 사유를 함께 기록합니다. 자동 주문이나 체결 가능성 보장은 포함하지 않습니다.',
  R11:'산업 전망은 공개 근거의 출처·시점·대상 범위를 함께 읽습니다. 기업 사실, 산업 추정, 규제 변화와 가설을 같은 사실로 취급하지 않습니다.',
  R12:'ETF 분석은 거래 가격과 NAV의 기준시각·통화·단위를 먼저 대조합니다. 수신하지 않은 보유종목·비용률·분배금이나 벤치마크 성과를 추정하지 않습니다.',
  R13:'선물 분석은 계약 식별·거래 세션과 가격 원문을 확인합니다. 승수·틱·만기·결제 방식이 검증되기 전 명목가치·손익·증거금을 계산하지 않습니다.',
  R14:'전략 검증은 사전 규칙, 학습·검증 구간, 거래비용, 생존편향과 재현성을 따로 확인합니다. 사용자 입력 가격만으로 체결이나 실현수익을 보장하지 않습니다.',
  U01:'종목·상품 탐색은 식별 후보와 확인된 종목 정보를 구분합니다. 이름이 비슷하다는 이유만으로 상품을 자동 확정하지 않습니다.',
};
function sectionNarrative(plan:ReportPlan,section:RouteSection,status:ReportInput['sections'][number]['status'],reason:string,linkedMetrics:ReportInput['metrics'],sourceIds:string[]):string {
  const boundary=plan.presentation?.narrative_boundary??'입력 근거와 데이터 상태를 구분합니다. 투자 판단이나 주문 신호는 자동 생성하지 않습니다.';
  const usable=linkedMetrics.filter(item=>item.value!==null&&['synthetic','provided','provided_unverified'].includes(item.status));
  const missing=linkedMetrics.filter(item=>item.value===null||['missing','rights_pending','error','not_run'].includes(item.status));
  const observed=usable.slice(0,3).map(item=>`${item.label} ${item.value} ${item.unit} (${item.period})`).join('; ');
  const detail=usable.length?`${usable.length}개 지표 입력이 연결됐고 ${missing.length}개 항목은 결측 또는 검증 대기입니다. 관측 입력: ${observed}${usable.length>3?' 외 추가 항목':''}.`:'이 섹션에 표시할 검증 가능한 지표값이 없습니다.';
  const origins=sourceIds.length?`연결된 출처 ID: ${sourceIds.join(', ')}.`:'연결된 출처 응답이 없습니다.';
  return `${ROUTE_READOUT[plan.report_id]} ${boundary} ${section.title}: ${detail} ${reason} ${origins}`;
}
export function buildReportInput(args:BuildReportInputArgs):ReportInput {
  const reportId=args.report_id as ReportRouteId;const plan=getReportPlan(reportId);
  const cutoff=timestamp.parse(args.cutoff);const receivedAt=args.received_at??new Date().toISOString();timestamp.parse(receivedAt);
  const localUserData=buildLocalUserData(reportId,args.user_supplied,receivedAt);
  const allowed=new Set(plan.groups.flatMap(g=>g.tools.map(t=>t.name)));
  const normalized=(args.calls??[]).map((call,i)=>{
    if(!allowed.has(call.tool_name))throw new Error('tool_not_required_by_report_route');
    const trusted=args.trustedLocalReceipts?.get(i);
    return normalizeMcpToolResult(call.tool_name,call.result,trusted?.receivedAt??receivedAt,i,Boolean(trusted));
  });
  if(localUserData&&normalized.length)throw new Error('user_supplied_local_input_cannot_be_mixed_with_mcp_results');
  const sources=[...normalized.flatMap(c=>c.source?[c.source]:[]),...(localUserData?[localUserData.source]:[])];
  const routeFields=new Set([...plan.groups.flatMap(group=>group.required_fields),...plan.sections.flatMap(section=>section.metric_ids)]);
  // Project validated adapter metrics onto this route; client local input remains strict below.
  const normalizedMetrics=normalized.flatMap(c=>c.metrics.filter(item=>routeFields.has(item.field_id)));
  const allInputMetrics=[...normalizedMetrics,...(localUserData?.metrics??[])];
  if(allInputMetrics.some(item=>!routeFields.has(item.field_id)))throw new Error('field_not_required_by_report_route');
  const metrics=deriveHistoryReportMetrics(reportId,normalized,deriveReportMetrics(reportId,allInputMetrics));
  const allowedVisualBlocks=new Map((plan.presentation?.sections??[]).map(section=>[section.id,new Set(section.blocks)]));
  const suppliedVisuals=[...normalized.flatMap(c=>c.visuals??[]),...(localUserData?.visuals??[])];
  const visuals=[...suppliedVisuals,...routeBarVisuals(reportId,allInputMetrics,sources,suppliedVisuals)].filter(visual=>{
    const blocks=allowedVisualBlocks.get(visual.section_id);
    if(!blocks||!blocks.has(visual.kind))throw new Error('visual_not_declared_by_report_layout');
    const section=plan.sections.find(item=>item.id===visual.section_id);if(!section)throw new Error('visual_route_section_missing');
    const referencedFields=visual.kind==='pele'?visual.edges.flatMap(edge=>edge.metric_ids):'metric_ids' in visual?visual.metric_ids:[];
    if(referencedFields.some(field=>!section.field_ids.includes(field)&&!section.metric_ids.includes(field)))throw new Error('visual_field_not_required_by_report_section');
    return true;
  });
  const origins=new Set(normalized.filter(c=>c.source).map(c=>c.origin));
  const mode:DataMode=localUserData?'supplied':origins.size===1&&origins.has('synthetic')?'synthetic':origins.size===1&&origins.has('actual')?'actual':origins.has('synthetic')||origins.has('actual')?'mixed':normalized.length?'supplied':'synthetic';
  const executionStatus:ReportInput['execution_status']=localUserData?'provided_unverified':mode==='synthetic'?(normalized.length?'synthetic_fixture_rendered':'template_only'):(mode==='actual'||mode==='mixed'?'actual_data_partial':normalized.length?'provided_unverified':'not_run');
  const sections:ReportInput['sections']=[];
  const claims:ReportInput['analysis_claims']=[];
  for(const routeSection of plan.sections){
    const relevantGroups=plan.groups.filter(group=>group.required_fields.some(field=>routeSection.field_ids.includes(field)));
    const relevantToolNames=new Set(relevantGroups.flatMap(group=>group.tools.map(tool=>tool.name)));
    const relevantCalls=normalized.filter(call=>relevantToolNames.has(call.tool_name));
    const hasTools=relevantToolNames.size>0;
    const localSectionMetrics=localUserData?.metrics.filter(metric=>routeSection.field_ids.includes(metric.field_id)||routeSection.metric_ids.includes(metric.field_id))??[];
    const status=localSectionMetrics.length?'partial':sectionStatus(relevantCalls,hasTools);
    const groupSources=[...new Set([...relevantCalls.flatMap(call=>call.source?[call.source.id]:[]),...(localSectionMetrics.length&&localUserData?[localUserData.source.id]:[])])];
    const linkedMetrics=metrics.filter(item=>routeSection.field_ids.includes(item.field_id)||routeSection.metric_ids.includes(item.field_id));
    const groupMetrics=[...new Set(linkedMetrics.map(item=>item.field_id))];
    const reason=localSectionMetrics.length?'사용자 제공 수치를 기준으로 계산했습니다. 입력의 완전성·외부 대사·가격시점은 독립 확인되지 않았습니다.':missingReason(status,relevantCalls,hasTools);
    sections.push({id:routeSection.id,status,required_fields:routeSection.field_ids,missing_reason:reason,body:sectionNarrative(plan,routeSection,status,reason,linkedMetrics,groupSources),source_ids:groupSources,metric_ids:groupMetrics});
  }
  for(const group of plan.groups){
    const toolNames=new Set(group.tools.map(t=>t.name));
    const groupCalls=normalized.filter(c=>toolNames.has(c.tool_name));
    const localGroupMetrics=localUserData?.metrics.filter(metric=>group.required_fields.includes(metric.field_id))??[];
    const status=localGroupMetrics.length?'partial':sectionStatus(groupCalls,group.tools.length>0);
    const groupSources=[...new Set([...groupCalls.flatMap(c=>c.source?[c.source.id]:[]),...(localGroupMetrics.length&&localUserData?[localUserData.source.id]:[])])];
    const groupMetrics=[...new Set([...groupCalls.flatMap(c=>c.metrics.map(m=>m.field_id)).filter(id=>routeFields.has(id)),...localGroupMetrics.map(metric=>metric.field_id)])];
    const reason=localGroupMetrics.length?'사용자가 제공한 로컬 입력으로 제한 계산했습니다. 원장·자산곡선의 정확성은 검증하지 않았습니다.':missingReason(status,groupCalls,group.tools.length>0);
    claims.push({id:`${reportId}.${group.id}.uncertainty`,kind:'uncertainty',text:`${group.id}: ${reason}`,status:status==='partial'?'partial':status==='not_run'?'not_run':status,confidence:'unrated',source_ids:groupSources,metric_ids:groupMetrics});
  }
  claims.push({id:`${reportId}.M01`,kind:'method',text:plan.presentation?.narrative_boundary??'이 입력은 MCP 구조화 응답의 출처·수신시각·검증상태를 보존합니다. 본문 투자자문·주문 신호는 만들지 않았습니다.',status:sources.length?'partial':'not_run',confidence:'unrated',source_ids:sources.map(s=>s.id),metric_ids:metrics.map(m=>m.field_id)});
  claims.push({id:`${reportId}.C01`,kind:'counterevidence',text:'반대 근거와 독립 원천 대조가 수집되지 않았거나 검증되지 않았습니다.',status:'missing',confidence:'unrated',source_ids:[],metric_ids:[]});
  const rawChart=normalized.find(call=>call.chart)?.chart??null;
  const chartSection=rawChart?routeChartSectionId(reportId,rawChart.metric_ids):undefined;
  const chart=rawChart&&chartSection?{...rawChart,section_id:chartSection}:null;
  return ReportInputSchema.parse({contract_version:'atp.template/1.1',report_id:reportId,mode,subject:args.subject,cutoff,display_timezone:args.display_timezone,sources,...(normalized.some(call=>call.source_tables?.length)?{source_tables:normalized.flatMap(call=>call.source_tables??[])}:{}),metrics,sections,visuals,chart,time_series:normalized.find(call=>call.time_series)?.time_series??null,execution_status:executionStatus,analysis_claims:claims});
}

function routeChartSectionId(reportId:ReportRouteId,metricIds:string[]):string|undefined {
  if(reportId==='R01')return 'R01.X01';
  const route=routeDocument.routes[reportId];const presentation=getReportPresentation(reportId);if(!route||!presentation)return undefined;
  return route.sections.find(section=>presentation.sections.find(layout=>layout.id===section.id)?.blocks.includes('bar')&&metricIds.every(id=>section.field_ids.includes(id)||section.metric_ids.includes(id)))?.id;
}

export function renderReportInputHtml(value:unknown):string {
  const doc=ReportInputSchema.parse(value);
  return renderReportTemplate(doc,getReportPlan(doc.report_id));
}

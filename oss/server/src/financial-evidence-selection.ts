import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { z } from 'zod';
import { SecConceptInputSchema, SecConceptResultSchema, SecSubmissionsResultSchema } from './sec-public-data.js';
import { openDartInputSchema, openDartResultSchema, parseOpenDartFullStatement } from './opendart.js';
import { openDartFilingsResultSchema, parseOpenDartFilings } from './opendart-filings.js';
import { ExactInstantSchema, compareInstants } from './exact-instant.js';
import { boundedBody, GlobalMarketError } from './global-market-data.js';

/** Offline selection only. These are existing R01 reported roles, NOT new canonical definitions. */
export const REPORTED_FINANCIAL_ROLES = [
  'reported.revenue', 'reported.operating_profit', 'reported.net_income_total', 'reported.net_income_common',
  'reported.cfo', 'reported.capex', 'reported.debt', 'reported.cash', 'reported.equity', 'reported.liabilities',
  'reported.equity_common_open', 'reported.equity_common_close', 'reported.shares_weighted',
] as const;
export const FINANCIAL_SELECTION_MAX_BYTES = 6_000_000;
const MAX_NODES = 250_000, MAX_KEYS = 10_001;
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === s;
}, 'invalid_calendar_date');
const DartDay = z.string().regex(/^\d{8}$/).refine(s => Day.safeParse(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`).success);
const Accession = z.string().regex(/^\d{10}-\d{2}-\d{6}$/);
const Receipt = z.string().regex(/^\d{14}$/);
const Text = z.string().max(2048);
const OptionalTextSelector = Text.nullable(); // null means absent, never blank.
/** The caller's source-calendar choice is explicit and remains unverified. No default timezone. */
export const FinancialCalendarGuardSchema = z.object({
  timezone: z.string().min(1).max(100), cutoff_local_date: Day,
}).strict();
const Controls = {
  requested_role: z.enum(REPORTED_FINANCIAL_ROLES), cutoff: ExactInstantSchema,
  calendar_guard: FinancialCalendarGuardSchema,
};
export const SecFinancialSelectorSchema = z.object({
  cik: z.string().regex(/^\d{10}$/), taxonomy: z.enum(['us-gaap', 'ifrs-full']), concept: z.string().min(1).max(200),
  unit_raw: z.string().min(1).max(80), start: Day.nullable(), end: Day, period_kind: z.enum(['instant', 'duration']),
  accession_number: Accession, filed: Day, fiscal_year: z.number().int().min(1900).max(9999).nullable(),
  fiscal_period: z.string().max(10).nullable(), form: z.string().min(1).max(30), frame: z.string().max(60).nullable(),
  filing: z.object({ filing_date: Day, report_date: Day.nullable(), acceptance_datetime: ExactInstantSchema.nullable(),
    primary_document: z.string().max(500) }).strict(),
}).strict().superRefine((s, c) => {
  if ((s.start === null) !== (s.period_kind === 'instant') || (s.start !== null && s.start > s.end)) c.addIssue({code:'custom',message:'invalid_period'});
  if (!SecConceptInputSchema.safeParse({cik:s.cik,taxonomy:s.taxonomy,concept:s.concept}).success) c.addIssue({code:'custom',message:'unsupported_concept'});
});
export const DartFinancialSelectorSchema = z.object({
  ...openDartInputSchema.shape, rcept_no: Receipt, sj_div: z.enum(['BS','IS','CIS','CF','SCE']),
  account_id: Text, account_nm: Text, account_detail: OptionalTextSelector, ord: z.string().max(20).regex(/^\d+$/),
  currency: z.string().max(32).nullable(),
  amount_kind: z.enum(['current','current_cumulative','prior','prior_comparable','prior_cumulative','two_years_prior']),
  period_label: OptionalTextSelector,
  filing: z.object({rcept_dt:DartDay,report_nm:Text,corp_cls:z.enum(['Y','K','N','E']),stock_code:z.string().regex(/^(?:\d{6})?$/)}).strict(),
}).strict();
export const SecFinancialSelectionInputSchema = z.object({
  ...Controls, selector: SecFinancialSelectorSchema, concept_result: SecConceptResultSchema, submissions_result: SecSubmissionsResultSchema,
}).strict();
export const DartFinancialSelectionInputSchema = z.object({
  ...Controls, selector: DartFinancialSelectorSchema, statement_result: openDartResultSchema, filings_result: openDartFilingsResultSchema,
}).strict();
export type SecFinancialSelectionInput = z.infer<typeof SecFinancialSelectionInputSchema>;
export type DartFinancialSelectionInput = z.infer<typeof DartFinancialSelectionInputSchema>;
export type FinancialSelectionErrorCode = 'invalid_input' | 'invalid_source_snapshot' | 'snapshot_too_large' |
  'source_normalization_conflict' | 'source_not_ok' | 'issuer_mismatch' | 'origin_mismatch' |
  'source_context_mismatch' | 'selection_absent' | 'selection_ambiguous' | 'filing_absent' | 'filing_ambiguous' |
  'filing_metadata_mismatch' | 'invalid_calendar_guard' | 'future_receipt' | 'future_source_date' |
  'invalid_chronology' | 'candidate_mismatch';
export class FinancialSelectionError extends Error {
  constructor(readonly code: FinancialSelectionErrorCode) { super(code); this.name = 'FinancialSelectionError'; }
}
function fail(code: FinancialSelectionErrorCode): never { throw new FinancialSelectionError(code); }
function requireThat(ok: unknown, code: FinancialSelectionErrorCode): asserts ok { if (!ok) fail(code); }

/** No accessor or Proxy trap is invoked, including nested/revoked proxies. Snapshot before Zod. */
function snapshot(value: unknown, maxBytes = FINANCIAL_SELECTION_MAX_BYTES, maxNodes = MAX_NODES): unknown {
  let nodes = 0, bytes = 0;
  const seen = new Set<object>();
  function copy(v: unknown, depth: number): unknown {
    if (++nodes > maxNodes || depth > 8) fail('snapshot_too_large');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') { bytes += Buffer.byteLength(v, 'utf8'); if (bytes > maxBytes) fail('snapshot_too_large'); return v; }
    if (typeof v !== 'object' || types.isProxy(v) || seen.has(v)) fail('invalid_source_snapshot');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    requireThat(array ? proto === Array.prototype || proto === null : proto === Object.prototype || proto === null, 'invalid_source_snapshot');
    const length: unknown = array ? Object.getOwnPropertyDescriptor(v, 'length')?.value : null;
    if (array) {
      requireThat(typeof length === 'number' && Number.isSafeInteger(length) && length >= 0, 'invalid_source_snapshot');
      if (length >= MAX_KEYS) fail('snapshot_too_large');
    }
    const keys = Reflect.ownKeys(v);
    if (keys.length > MAX_KEYS) fail('snapshot_too_large');
    requireThat(!array || keys.length === (length as number) + 1, 'invalid_source_snapshot');
    const out = array ? [] : Object.create(null) as Record<string, unknown>;
    seen.add(v);
    for (const key of keys) {
      requireThat(typeof key === 'string', 'invalid_source_snapshot');
      const d = Object.getOwnPropertyDescriptor(v, key);
      requireThat(d && 'value' in d, 'invalid_source_snapshot');
      if (array && key === 'length') continue;
      requireThat(d.enumerable && (!array || /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < (length as number)), 'invalid_source_snapshot');
      bytes += Buffer.byteLength(key, 'utf8'); if (bytes > maxBytes) fail('snapshot_too_large');
      Object.defineProperty(out, key, {value:copy(d.value, depth+1),enumerable:true,writable:true,configurable:true});
    }
    seen.delete(v); return out;
  }
  try { return boundedBody(copy(value, 0), {maxBytes,maxNodes,maxKeys:MAX_KEYS}); }
  catch (error) {
    if (error instanceof FinancialSelectionError) throw error;
    if (error instanceof GlobalMarketError && error.code === 'response_too_large') fail('snapshot_too_large');
    fail('invalid_source_snapshot');
  }
}
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(snapshot(value));
  if (!parsed.success) fail('invalid_input');
  return parsed.data;
}
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}
function same(a: unknown, b: unknown): boolean { return canonicalJson(a) === canonicalJson(b); }
function digest(v: unknown): string { return createHash('sha256').update(canonicalJson(v), 'utf8').digest('hex'); }
type DeepReadonly<T> = T extends readonly unknown[] ? {readonly [K in keyof T]:DeepReadonly<T[K]>} : T extends object ? {readonly [K in keyof T]:DeepReadonly<T[K]>} : T;
function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value as DeepReadonly<T>;
}
function lineage<T>(dto: T, received_at: string) {
  return {sha256:digest(dto),hash_scope:'validated_provider_dto_snapshot' as const,hash_algorithm:'sha256' as const,
    serialization:'sorted_object_keys_json_utf8_v1' as const,original_http_body_hash:null,received_at,value:dto};
}
function localDay(instant: string, timezone: string): string {
  // ExactInstantSchema already checked the timestamp; discard fractional seconds only for calendar projection.
  const whole = instant.replace(/\.\d+(?=Z$|[+-]\d{2}:\d{2}$)/, '');
  try {
    const p = new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',era:'short'}).formatToParts(new Date(whole));
    const field = (kind: string) => p.find(v => v.type === kind)?.value;
    const d = `${field('year')?.padStart(4,'0')}-${field('month')}-${field('day')}`;
    requireThat(field('era') === 'AD' && Day.safeParse(d).success, 'invalid_calendar_guard'); return d;
  } catch { fail('invalid_calendar_guard'); }
}
function timeControls(q: z.infer<typeof FinancialCalendarGuardSchema>, cutoff: string, receipts: string[]) {
  requireThat(localDay(cutoff,q.timezone) === q.cutoff_local_date, 'invalid_calendar_guard');
  for (const r of receipts) {
    requireThat(ExactInstantSchema.safeParse(r).success, 'invalid_input');
    requireThat(compareInstants(r,cutoff) <= 0, 'future_receipt');
  }
}
function checkDate(day: string, receipt: string, q: z.infer<typeof FinancialCalendarGuardSchema>) {
  requireThat(day <= q.cutoff_local_date, 'future_source_date');
  requireThat(day <= localDay(receipt,q.timezone), 'invalid_chronology');
}
function only<T>(rows: T[], absent: FinancialSelectionErrorCode, ambiguous: FinancialSelectionErrorCode): T {
  if (!rows.length) fail(absent); if (rows.length !== 1) fail(ambiguous); return rows[0]!;
}
const blockers = [
  'source_authenticity_not_independently_verified','security_identity_not_verified','semantic_role_binding_not_verified',
  'unit_scale_currency_and_accounting_basis_not_verified','publication_availability_not_verified',
  'complete_coverage_finality_and_revision_choice_not_verified','rights_pending',
] as const;
function common(q: z.infer<typeof FinancialCalendarGuardSchema>, cutoff: string, role: typeof REPORTED_FINANCIAL_ROLES[number], origin: 'actual'|'synthetic', receipts: string[]) {
  return {contract:'moai.financial.selected-evidence-candidate.v1' as const,status:'selected_evidence_candidate_only' as const,
    origin,cutoff,calendar_guard:{...q,status:'caller_selected_timezone_not_source_verified' as const},
    requested_role:role,role_association_status:'unverified_caller_request' as const,semantic_binding_verified:false as const,
    canonical_fact:null,published_at:null,available_at:null,rights_status:'pending' as const,
    unit_scale:null,accounting_basis:null,finality:'unknown' as const,coverage_complete:false as const,
    selection_policy:'exact_caller_selector_no_latest_or_restatement_inference' as const,
    constituent_receipt_latest:receipts.reduce((a,b)=>compareInstants(a,b)>=0?a:b),
    receipt_status:'constituent_dto_receipts_checked_not_publication_times' as const,
    mapping_blockers:[...blockers],warnings:[
      'This is selected provider evidence, not a canonical fact or authenticated source.',
      'Requested reported.* role association is unverified. No computation, conversion, scaling, aggregation, semantic binding or rights clearance occurs.',
      'Snapshot SHA256 identifies a validated DTO serialized with sorted object keys, not an original HTTP response, signature or authenticated provenance.',
      'Caller calendar choice is explicit but unverified. Date labels and SEC acceptance timestamps do not establish public availability.',
      'Exact uniqueness is local to supplied bounded snapshots, never proof of complete filing history or latest/restated selection.',
      'Downstream canonical-engine validation is not source authentication or independent verification of rights, identity, units or semantic binding.',
    ]};
}

/** The SEC values remain original adapter numeric lexemes; no Number/Decimal conversion occurs. */
export function selectSecFinancialEvidence(value: unknown) {
  const q = input(SecFinancialSelectionInputSchema,value), s=q.selector, c=q.concept_result, f=q.submissions_result;
  requireThat(c.request.cik === f.request.cik && s.cik === c.request.cik, 'issuer_mismatch');
  requireThat(c.origin === f.origin,'origin_mismatch');
  requireThat(s.taxonomy === c.taxonomy && s.concept === c.concept,'source_context_mismatch');
  timeControls(q.calendar_guard,q.cutoff,[c.received_at,f.received_at]);
  const row = only(c.facts.filter(r => r.unit_raw===s.unit_raw && r.start===s.start && r.end===s.end && r.period_kind===s.period_kind &&
    r.accession_number===s.accession_number && r.filed===s.filed && r.fiscal_year===s.fiscal_year && r.fiscal_period===s.fiscal_period &&
    r.form===s.form && r.frame===s.frame),'selection_absent','selection_ambiguous');
  const filing = only(f.filings.filter(r=>r.accession_number===s.accession_number),'filing_absent','filing_ambiguous');
  requireThat(filing.form===row.form && filing.filing_date===row.filed && filing.filing_date===s.filing.filing_date &&
    filing.report_date===s.filing.report_date && filing.acceptance_datetime===s.filing.acceptance_datetime &&
    filing.primary_document===s.filing.primary_document,'filing_metadata_mismatch');
  checkDate(row.end,c.received_at,q.calendar_guard); checkDate(row.filed,c.received_at,q.calendar_guard);
  checkDate(filing.filing_date,f.received_at,q.calendar_guard);
  requireThat(row.end<=row.filed,'invalid_chronology');
  if (filing.report_date !== null) {
    checkDate(filing.report_date,f.received_at,q.calendar_guard);
    requireThat(row.end<=filing.report_date && filing.report_date<=filing.filing_date,'invalid_chronology');
  }
  if (filing.acceptance_datetime !== null) {
    requireThat(ExactInstantSchema.safeParse(filing.acceptance_datetime).success,'invalid_input');
    requireThat(compareInstants(filing.acceptance_datetime,q.cutoff)<=0 && compareInstants(filing.acceptance_datetime,f.received_at)<=0 && compareInstants(filing.acceptance_datetime,c.received_at)<=0,'invalid_chronology');
  }
  return freeze({...common(q.calendar_guard,q.cutoff,q.requested_role,c.origin,[c.received_at,f.received_at]),provider:'SEC' as const,
    selector:s,issuer:{cik:s.cik,status:'supplied_dto_cik_join_only_not_security_identity' as const},
    selected:{row,filing,numeric_lexeme:row.numeric_lexeme,unit_raw:row.unit_raw,acceptance_datetime:filing.acceptance_datetime,
      acceptance_status:'source_acceptance_metadata_not_publication_availability' as const},
    coverage:{concept_total_fact_count:c.total_fact_count,concept_truncated:c.truncated,concept_selection:c.selection,
      filings_recent_count:f.recent_filing_count,filings_omitted_recent_count:f.omitted_recent_count,
      historical_file_count:f.historical_file_count,filings_completeness:f.completeness,complete:false as const},
    snapshots:{financial:lineage(c,c.received_at),filings:lineage(f,f.received_at)},
  });
}

const dartAmountFields = {
  current:['thstrm_amount','thstrm_nm'],current_cumulative:['thstrm_add_amount','thstrm_nm'],prior:['frmtrm_amount','frmtrm_nm'],
  prior_comparable:['frmtrm_q_amount','frmtrm_q_nm'],prior_cumulative:['frmtrm_add_amount','frmtrm_nm'],two_years_prior:['bfefrmtrm_amount','bfefrmtrm_nm'],
} as const;
/** Reconstruct adapter payloads from raw rows; exported DTO schemas alone are insufficient. */
function revalidateDart(q: DartFinancialSelectionInput) {
  const c=q.statement_result, f=q.filings_result;
  try {
    const c2=parseOpenDartFullStatement(c.request,{status:c.provider_status,message:'',list:c.rows.map(r=>r.raw)},c.provenance);
    const f2=parseOpenDartFilings(f.request,{status:f.provider_status,message:'',page_no:f.request.page_no,page_count:f.request.page_count,
      ...(f.total_count!==undefined?{total_count:f.total_count}:{}),...(f.total_page!==undefined?{total_page:f.total_page}:{}),list:f.rows.map(r=>r.raw)},f.provenance);
    requireThat(same(c,c2) && same(f,f2),'source_normalization_conflict');
  } catch { fail('source_normalization_conflict'); }
}
/** Blank/missing/value amounts stay distinct. DART names are not inferred calendar endpoints. */
export function selectDartFinancialEvidence(value: unknown) {
  const q=input(DartFinancialSelectionInputSchema,value), s=q.selector, c=q.statement_result, f=q.filings_result;
  revalidateDart(q);
  requireThat(c.status==='ok' && f.status==='ok','source_not_ok');
  requireThat(c.request.corp_code===f.request.corp_code && s.corp_code===c.request.corp_code,'issuer_mismatch');
  requireThat(c.provenance.origin===f.provenance.origin,'origin_mismatch');
  requireThat(s.bsns_year===c.request.bsns_year && s.reprt_code===c.request.reprt_code && s.fs_div===c.request.fs_div,'source_context_mismatch');
  timeControls(q.calendar_guard,q.cutoff,[c.provenance.received_at,f.provenance.received_at]);
  const [amountField,labelField]=dartAmountFields[s.amount_kind];
  const row=only(c.rows.filter(r=>r.raw.rcept_no===s.rcept_no && r.raw.sj_div===s.sj_div && r.raw.account_id===s.account_id &&
    r.raw.account_nm===s.account_nm && (r.raw.account_detail??null)===s.account_detail && r.raw.ord===s.ord &&
    (r.raw.currency??null)===s.currency && (r.raw[labelField]??null)===s.period_label),'selection_absent','selection_ambiguous');
  const filing=only(f.rows.filter(r=>r.raw.rcept_no===s.rcept_no),'filing_absent','filing_ambiguous');
  requireThat(filing.raw.corp_code===row.raw.corp_code && filing.raw.rcept_dt===s.filing.rcept_dt && filing.raw.report_nm===s.filing.report_nm &&
    filing.raw.corp_cls===s.filing.corp_cls && filing.raw.stock_code===s.filing.stock_code && filing.filing_url===row.filing_url,'filing_metadata_mismatch');
  const filingDate=`${filing.raw.rcept_dt.slice(0,4)}-${filing.raw.rcept_dt.slice(4,6)}-${filing.raw.rcept_dt.slice(6)}`;
  checkDate(filingDate,c.provenance.received_at,q.calendar_guard); checkDate(filingDate,f.provenance.received_at,q.calendar_guard);
  return freeze({...common(q.calendar_guard,q.cutoff,q.requested_role,c.provenance.origin,[c.provenance.received_at,f.provenance.received_at]),provider:'opendart' as const,
    selector:s,issuer:{corp_code:s.corp_code,status:'supplied_dto_corp_code_join_only_not_security_identity' as const},
    selected:{row,filing,amount_kind:s.amount_kind,amount_field:amountField,amount:row.amounts[s.amount_kind],
      period_label_field:labelField,period_label:row.raw[labelField]??null,period_start:null,period_end:null,
      period_status:'provider_label_only_no_calendar_endpoints_inferred' as const,
      provider_current_period_kind:row.current_period_kind,current_period_kind_applies_to:'current_amount_only_not_cumulative' as const},
    coverage:{statement_rows_supplied:c.rows.length,statement_completeness:'not_established' as const,
      page_no:f.request.page_no,page_count:f.request.page_count,total_count:f.total_count??null,total_page:f.total_page??null,
      has_more:f.has_more,next_page_no:f.next_page_no,last_reprt_at:f.request.last_reprt_at,
      previous_pages_status:'not_supplied_or_verified' as const,complete:false as const},
    snapshots:{financial:lineage(c,c.provenance.received_at),filings:lineage(f,f.provenance.received_at)},
  });
}
export type SecFinancialEvidenceCandidate = ReturnType<typeof selectSecFinancialEvidence>;
export type DartFinancialEvidenceCandidate = ReturnType<typeof selectDartFinancialEvidence>;
export type FinancialEvidenceCandidate = SecFinancialEvidenceCandidate | DartFinancialEvidenceCandidate;

const CandidateLocatorSchema = z.object({
  provider:z.enum(['SEC','opendart']),cutoff:ExactInstantSchema,requested_role:z.enum(REPORTED_FINANCIAL_ROLES),
  calendar_guard:FinancialCalendarGuardSchema.extend({status:z.literal('caller_selected_timezone_not_source_verified')}),
  selector:z.unknown(),snapshots:z.object({financial:z.object({value:z.unknown()}).passthrough(),filings:z.object({value:z.unknown()}).passthrough()}).passthrough(),
}).passthrough();
/** Rebuild every field from the embedded source snapshots. JSON Schema alone cannot do this. */
export function validateFinancialEvidenceCandidate(value: unknown): FinancialEvidenceCandidate {
  // A candidate includes both snapshots plus selected rows, and remains independently bounded.
  const safe=snapshot(value,FINANCIAL_SELECTION_MAX_BYTES*2,MAX_NODES*2);
  const located=CandidateLocatorSchema.safeParse(safe);
  if(!located.success)fail('candidate_mismatch');
  const q=located.data;
  const controls={cutoff:q.cutoff,requested_role:q.requested_role,selector:q.selector,
    calendar_guard:{timezone:q.calendar_guard.timezone,cutoff_local_date:q.calendar_guard.cutoff_local_date}};
  const expected=q.provider==='SEC'
    ? selectSecFinancialEvidence({...controls,concept_result:q.snapshots.financial.value,submissions_result:q.snapshots.filings.value})
    : selectDartFinancialEvidence({...controls,statement_result:q.snapshots.financial.value,filings_result:q.snapshots.filings.value});
  requireThat(same(safe,expected),'candidate_mismatch');
  return expected;
}

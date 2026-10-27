import { requestSecCompanyConcept, requestSecSubmissions } from '../src/sec-public-data.js';
import { parseOpenDartFullStatement } from '../src/opendart.js';
import { parseOpenDartFilings } from '../src/opendart-filings.js';
import type { SecFinancialSelectionInput, DartFinancialSelectionInput } from '../src/financial-evidence-selection.js';
export const RECEIVED='2026-10-22T00:00:00.123456789Z';
export const CUTOFF='2026-10-22T00:00:00.123456789Z';
const calendar_guard={timezone:'UTC',cutoff_local_date:'2026-10-22'};
export async function secFixture(): Promise<SecFinancialSelectionInput> {
  const concept_result=await requestSecCompanyConcept({cik:'0000000001',taxonomy:'us-gaap',concept:'Revenues',max_facts:10},{origin:'synthetic',async send(){
    return {status:200,body_text:'{"cik":1,"entityName":"SYNTHETIC ONLY","taxonomy":"us-gaap","tag":"Revenues","label":"Synthetic revenue","units":{"USD":[{"val":9007199254740993.2500,"start":"2025-01-01","end":"2025-12-31","accn":"0000000001-26-000001","filed":"2026-02-10","fy":2025,"fp":"FY","form":"10-K","frame":"CY2025"}]}}'};
  }},()=>RECEIVED);
  const submissions_result=await requestSecSubmissions({cik:'0000000001',max_filings:10},{origin:'synthetic',async send(){return {status:200,body_text:JSON.stringify({cik:1,name:'SYNTHETIC ONLY',tickers:[],exchanges:[],filings:{recent:{accessionNumber:['0000000001-26-000001'],filingDate:['2026-02-10'],reportDate:['2025-12-31'],acceptanceDateTime:['2026-02-10T10:30:00.000000001-05:00'],form:['10-K'],primaryDocument:['synthetic.htm'],primaryDocDescription:['Synthetic fixture']},files:[{name:'synthetic-old.json'}]}})};}},()=>RECEIVED);
  return {requested_role:'reported.revenue',cutoff:CUTOFF,calendar_guard:{...calendar_guard},concept_result,submissions_result,
    selector:{cik:'0000000001',taxonomy:'us-gaap',concept:'Revenues',unit_raw:'USD',start:'2025-01-01',end:'2025-12-31',period_kind:'duration',accession_number:'0000000001-26-000001',filed:'2026-02-10',fiscal_year:2025,fiscal_period:'FY',form:'10-K',frame:'CY2025',filing:{filing_date:'2026-02-10',report_date:'2025-12-31',acceptance_datetime:'2026-02-10T10:30:00.000000001-05:00',primary_document:'synthetic.htm'}}};
}
export function dartFixture(): DartFinancialSelectionInput {
  const request={corp_code:'00000001',bsns_year:'2025',reprt_code:'11012',fs_div:'CFS'};
  const provenance={origin:'synthetic',received_at:RECEIVED};
  const statement_result=parseOpenDartFullStatement(request,{status:'000',message:'SYNTHETIC ONLY',list:[{
    rcept_no:'20250814000001',corp_code:'00000001',bsns_year:'2025',reprt_code:'11012',sj_div:'IS',sj_nm:'Synthetic income statement',account_id:'ifrs-full_Revenue',account_nm:'Synthetic revenue',account_detail:'',ord:'1',thstrm_nm:'Synthetic current label',thstrm_amount:'+9,007,199,254,740,993.2500',thstrm_add_amount:'18,000,000,000,000,000.50',frmtrm_amount:'  ',frmtrm_q_nm:'Synthetic comparable label',frmtrm_q_amount:'-100.750',frmtrm_add_amount:'0.00',currency:'USD',
  }]},provenance);
  const filings_result=parseOpenDartFilings({corp_code:'00000001',bgn_de:'20250101',end_de:'20261231',page_count:1,page_no:1},
    {status:'000',message:'SYNTHETIC ONLY',page_no:1,page_count:1,total_count:2,total_page:2,list:[{corp_cls:'K',corp_name:'SYNTHETIC ONLY',corp_code:'00000001',stock_code:'000001',report_nm:'Synthetic half-year statement',rcept_no:'20250814000001',flr_nm:'Synthetic filer',rcept_dt:'20250814',rm:''}]},provenance);
  return {requested_role:'reported.revenue',cutoff:CUTOFF,calendar_guard:{...calendar_guard},statement_result,filings_result,
    selector:{corp_code:'00000001',bsns_year:'2025',reprt_code:'11012',fs_div:'CFS',rcept_no:'20250814000001',sj_div:'IS',account_id:'ifrs-full_Revenue',account_nm:'Synthetic revenue',account_detail:'',ord:'1',currency:'USD',amount_kind:'current',period_label:'Synthetic current label',filing:{rcept_dt:'20250814',report_nm:'Synthetic half-year statement',corp_cls:'K',stock_code:'000001'}}};
}

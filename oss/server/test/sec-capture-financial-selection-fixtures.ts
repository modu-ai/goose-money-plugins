import { createHash } from 'node:crypto';
import { sliceSecCompanyConceptCapture } from '../src/sec-capture-slices.js';
import { requestSecSubmissions } from '../src/sec-public-data.js';
import type { SecCaptureFinancialSelectionInput } from '../src/sec-capture-financial-selection.js';
export const CAPTURE_FINANCIAL_RECEIPT='2026-10-22T00:00:00.123456789Z';
export const CAPTURE_FINANCIAL_ACCEPTANCE='2026-02-10T10:30:00.000000001-05:00';
const lexemes=['-0','1.2300','9007199254740993.2500','1e+0300','-9.9E-099','1e999'];
export function captureFinancialFact(i:number):string{return`{"val":${lexemes[i%lexemes.length]},"start":"2025-01-01","end":"2025-12-31","accn":"0000000001-26-${String(i+1).padStart(6,'0')}","filed":"2026-02-10","fy":null,"fp":null,"form":"10-K"}`;}
export function captureFinancialBody():string{return`{"cik":1,"entityName":"SYNTHETIC ONLY CAPTURE FINANCIAL","taxonomy":"us-gaap","tag":"Revenues","label":"Synthetic revenue","units":{"USD":[${Array.from({length:125},(_,i)=>captureFinancialFact(i)).join(',')}],"EUR":[${captureFinancialFact(500)}],"shares":[]}}`;}
export async function captureFinancialFixture(body=captureFinancialBody(),indices=[100,110,124,125]){
 const capture_slice_input={request:{cik:'0000000001',taxonomy:'us-gaap' as const,concept:'Revenues'},selection:{kind:'source_indices' as const,indices},
  capture:{origin:'synthetic' as const,received_at:CAPTURE_FINANCIAL_RECEIPT,source_url:'https://data.sec.gov/api/xbrl/companyconcept/CIK0000000001/us-gaap/Revenues.json',expected_body_sha256:createHash('sha256').update(body,'utf8').digest('hex')},
  cutoff:CAPTURE_FINANCIAL_RECEIPT,calendar_guard:{timezone:'UTC',cutoff_local_date:'2026-10-22'}};
 const capture_slice_result=JSON.parse(JSON.stringify(sliceSecCompanyConceptCapture(capture_slice_input,body)));
 const row=capture_slice_result.facts.find((r:{source_index:number})=>r.source_index===110)??capture_slice_result.facts[0];
 const submissions_result=await requestSecSubmissions({cik:'0000000001',max_filings:10},{origin:'synthetic',async send(){return{status:200,body_text:JSON.stringify({cik:1,name:'SYNTHETIC ONLY CAPTURE FINANCIAL',tickers:[],exchanges:[],filings:{recent:{accessionNumber:[row.accession_number],filingDate:[row.filed],reportDate:[row.end],acceptanceDateTime:[CAPTURE_FINANCIAL_ACCEPTANCE],form:[row.form],primaryDocument:['synthetic.htm'],primaryDocDescription:['Synthetic fixture, not a public filing']},files:[{name:'synthetic-old.json'}]}})};}},()=>CAPTURE_FINANCIAL_RECEIPT);
 const {source_index,source_unit_index,source_row_index,...fact}=row;
 const {numeric_lexeme,accounting_basis,canonical_metric,...selector}=fact;
 const filing=submissions_result.filings[0]!;
 const input:SecCaptureFinancialSelectionInput={requested_role:'reported.revenue',cutoff:CAPTURE_FINANCIAL_RECEIPT,calendar_guard:{timezone:'UTC',cutoff_local_date:'2026-10-22'},
  selector:{cik:'0000000001',taxonomy:'us-gaap',concept:'Revenues',...selector,filing:{filing_date:filing.filing_date,report_date:filing.report_date,acceptance_datetime:filing.acceptance_datetime,primary_document:filing.primary_document}},
  source_locator:{source_index,source_unit_index,source_row_index},capture_slice_input,capture_slice_result,submissions_result};
 return{body,input};
}

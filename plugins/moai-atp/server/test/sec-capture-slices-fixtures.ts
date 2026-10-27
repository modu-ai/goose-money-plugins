import { createHash } from 'node:crypto';
import type { SecCaptureSliceInput } from '../src/sec-capture-slices.js';
export const SYNTHETIC_RECEIPT='2026-10-22T00:00:00.123456789Z';
export const syntheticLexemes=['-0','1.2300','9007199254740993.2500','1e+0300','-9.9E-099','1e999'] as const;
export function syntheticFact(i:number):string {return `{"val":${syntheticLexemes[i%syntheticLexemes.length]},"end":"2025-12-31","accn":"0000000001-26-${String(i+1).padStart(6,'0')}","filed":"2026-02-10","fy":null,"fp":null,"form":"10-K"}`;}
export function syntheticCapture(count=125):string {return `{"cik":1,"entityName":"SYNTHETIC ONLY CAPTURE","taxonomy":"us-gaap","tag":"Assets","label":"Synthetic assets","units":{"ZZZ":[${Array.from({length:count},(_,i)=>syntheticFact(i)).join(',')}],"USD":[${syntheticFact(500)}],"EUR":[]}}`;}
export function captureInput(body:string,selection:SecCaptureSliceInput['selection']={kind:'source_indices',indices:[100,110,124,125]}):SecCaptureSliceInput {
 return {request:{cik:'0000000001',taxonomy:'us-gaap',concept:'Assets'},selection,capture:{origin:'synthetic',received_at:SYNTHETIC_RECEIPT,source_url:'https://data.sec.gov/api/xbrl/companyconcept/CIK0000000001/us-gaap/Assets.json',expected_body_sha256:createHash('sha256').update(body,'utf8').digest('hex')},cutoff:SYNTHETIC_RECEIPT,calendar_guard:{timezone:'UTC',cutoff_local_date:'2026-10-22'}};
}

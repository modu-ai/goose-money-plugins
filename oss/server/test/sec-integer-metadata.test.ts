import test from 'node:test';
import assert from 'node:assert/strict';
import {requestSecCompanyConcept,requestSecSubmissions,type SecPublicTransport,type SecRequest} from '../src/sec-public-data.js';

const at='2026-10-22T05:57:37.266Z';
const request={cik:'0000320193',taxonomy:'us-gaap',concept:'Assets',max_facts:100};
const SCHEMA='provider_response_schema_drift';
function conceptBody(cikToken='320193',fyToken:string|undefined='2025',valToken='123',fpToken:string|undefined='"FY"'){
 return `{"cik":${cikToken},"entityName":"Synthetic exact metadata","taxonomy":"us-gaap","tag":"Assets","label":"Assets","units":{"USD":[{"end":"2025-09-27","val":${valToken},"accn":"0000320193-26-000001","filed":"2026-01-28","form":"8-K"${fyToken===undefined?'':`,"fy":${fyToken}`}${fpToken===undefined?'':`,"fp":${fpToken}`}}]}}`;
}
function submissionsBody(cikToken='320193'){
 return `{"cik":${cikToken},"name":"Synthetic exact metadata","tickers":[],"exchanges":[],"filings":{"recent":{"accessionNumber":[],"filingDate":[],"reportDate":[],"acceptanceDateTime":[],"form":[],"primaryDocument":[],"primaryDocDescription":[]},"files":[]}}`;
}
function mock(body_text:string){
 const calls:SecRequest[]=[];let clockCalls=0;
 const transport:SecPublicTransport={origin:'synthetic',async send(r){calls.push(r);return {status:200,body_text};}};
 return {transport,calls,clock(){clockCalls++;return at;},get clockCalls(){return clockCalls;}};
}
async function concept(cikToken='320193',fyToken='2025'){
 const m=mock(conceptBody(cikToken,fyToken));return requestSecCompanyConcept(request,m.transport,m.clock);
}
async function rejectCik(token:string,code=SCHEMA){
 for(const operation of ['concept','submissions'] as const){
  const m=mock(operation==='concept'?conceptBody(token):submissionsBody(token));
  await assert.rejects(operation==='concept'?requestSecCompanyConcept(request,m.transport,m.clock):requestSecSubmissions({cik:request.cik},m.transport,m.clock),{name:'Error',message:code},`${operation}: ${token.slice(0,50)}`);
  assert.equal(m.calls.length,1);assert.equal(m.clockCalls,1);
 }
}

test('SEC concept and submissions reject fractional CIK tails that round to the requested issuer',async()=>{
 for(const token of ['320193.0000000000000000001','320192.9999999999999999999','3.201930000000000000000001e5','3201930000000000000000001e-19'])await rejectCik(token);
});
test('SEC fiscal years reject tiny fractional tails before rounded Number range checks',async()=>{
 for(const token of ['2025.00000000000000000000001','2024.99999999999999999999999','2.025000000000000000000001e3','202500000000000000000000001e-23'])await assert.rejects(concept('320193',token),{name:'Error',message:SCHEMA});
});
test('SEC exact numeric CIK variants retain decimal, exponent sign, and trailing-zero support',async()=>{
 for(const token of ['320193','320193.0','3.20193e5','3201930e-1','320193000e-3','320.193e+3','0.320193e6','320193.000E+000','320193e-000','320193e00000000000000000000','320193.'+'0'.repeat(193)]){
  const c=mock(conceptBody(token));const s=mock(submissionsBody(token));
  assert.equal((await requestSecCompanyConcept(request,c.transport,c.clock)).identity_status,'cik_matched');
  assert.equal((await requestSecSubmissions({cik:request.cik},s.transport,s.clock)).identity_status,'cik_matched');
  assert.equal(c.calls.length,1);assert.equal(s.calls.length,1);assert.equal(c.clockCalls,1);assert.equal(s.clockCalls,1);
 }
});
test('SEC exact numeric FY variants retain decimal, exponent sign, and trailing-zero support',async()=>{
 for(const token of ['2025','2025.0','2.025e3','20250e-1','2025000e-3','20.25e+2','0.2025e4','2025.000E+000','2025e-000','2025e00000000000000000000','2025.'+'0'.repeat(195)])assert.equal((await concept('320193',token)).facts[0]!.fiscal_year,2025);
});
test('SEC lexical guard does not broaden CIK string, positivity, JSON sign, or FY range acceptance',async()=>{
 for(const token of ['"320193"','"0000320193"'])assert.equal((await concept(token)).identity_status,'cik_matched');
 for(const token of ['"3.20193e5"','"320193.0"','"+320193"','" 320193"','-320193','-0','0','+320193','null','true','[]','{}'])await rejectCik(token);
 for(const token of ['-2025','-0','0','+2025','1899','10000','"2025"','false'])await assert.rejects(concept('320193',token),{name:'Error',message:SCHEMA});
 for(const token of ['1900.0','9.999e3'])assert.equal((await concept('320193',token)).facts[0]!.fiscal_year,Number(token));
});
test('SEC bounds numeric metadata length and exponent processing and rejects overflow/underflow',async()=>{
 for(const token of ['320193.'+'0'.repeat(194),'1'+'0'.repeat(200),'1e309','1e-400','1e'+'9'.repeat(150),'1e-'+'9'.repeat(150),'0e201','0e-201','320193e'+'0'.repeat(194)])await rejectCik(token);
 for(const token of ['2025.'+'0'.repeat(196),'1'+'0'.repeat(200),'1e309','1e-400','1e'+'9'.repeat(150),'1e-'+'9'.repeat(150),'0e201','0e-201'])await assert.rejects(concept('320193',token),{name:'Error',message:SCHEMA});
});
test('SEC safe integer boundaries keep exact safe CIK mismatches distinct from unsafe source metadata',async()=>{
 for(const token of ['9007199254740991','9007199254740991.0','90071992547409910e-1','10000000000','320194.0'])await rejectCik(token,'instrument_mismatch');
 for(const token of ['9007199254740992','9007199254740993','9007199254740991.00000000000001','9007199254740990.99999999999999','-9007199254740992'])await rejectCik(token);
 for(const token of ['9007199254740991','9007199254740992','9007199254740991.00000000000001'])await assert.rejects(concept('320193',token),{name:'Error',message:SCHEMA});
 for(const [cik,token] of [['0000000001','1.000e+0'],['9999999999','9.999999999e9']] as const){
  const m=mock(conceptBody(token));assert.equal((await requestSecCompanyConcept({...request,cik},m.transport,m.clock)).request.cik,cik);
 }
});
test('SEC original val lexemes and explicit null FY/FP remain unchanged with exact metadata',async()=>{
 for(const token of ['900719925474099312345678','1.2300000000000000001e-3','-0.0000','1e309','1e-999']){
  const m=mock(conceptBody('320193.0','null',token,'null'));
  const d=await requestSecCompanyConcept(request,m.transport,m.clock);const f=d.facts[0]!;
  assert.equal(f.numeric_lexeme,token);assert.equal(f.fiscal_year,null);assert.equal(f.fiscal_period,null);assert.equal(f.accounting_basis,null);assert.equal(f.canonical_metric,null);assert.equal(d.source_as_of,null);assert.equal(m.calls.length,1);
 }
});
test('SEC omitted FY/FP remain unknown and malformed bodies expose only finite sanitized codes',async()=>{
 const raw=conceptBody().replace(',"fy":2025','').replace(',"fp":"FY"','');const m=mock(raw);
 const d=await requestSecCompanyConcept(request,m.transport,m.clock);assert.equal(d.facts[0]!.fiscal_year,null);assert.equal(d.facts[0]!.fiscal_period,null);
 for(const body of [conceptBody('320193.0000000000000000001').replace('Synthetic exact metadata','do-not-echo-source'),'{"cik":320193,"do-not-echo-source":','{']){
  const bad=mock(body);await assert.rejects(requestSecCompanyConcept(request,bad.transport,bad.clock),{name:'Error',message:SCHEMA});assert.equal(bad.calls.length,1);
 }
 const oversized=mock('x'.repeat(3_000_001));await assert.rejects(requestSecCompanyConcept(request,oversized.transport,oversized.clock),{name:'Error',message:'response_too_large'});
});

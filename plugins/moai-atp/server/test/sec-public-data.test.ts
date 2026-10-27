import test from 'node:test';import assert from 'node:assert/strict';
import {requestSecCompanyConcept,requestSecSubmissions,SecConceptResultSchema,SecSubmissionsResultSchema,type SecPublicTransport,type SecRequest} from '../src/sec-public-data.js';
const at='2026-10-22T00:00:00Z';const input={cik:'0000320193',taxonomy:'us-gaap',concept:'Assets'};
const fact={end:'2026-09-30',val:123,accn:'0000320193-26-000001',filed:'2026-10-20',fy:2026,fp:'FY',form:'10-K'};
const concept={cik:320193,entityName:'Synthetic Company',taxonomy:'us-gaap',tag:'Assets',label:'Assets',units:{USD:[fact]}};
const submission={cik:'320193',name:'Synthetic Company',tickers:['SYN'],exchanges:['Nasdaq'],filings:{recent:{accessionNumber:['0000320193-26-000001'],filingDate:['2026-10-20'],reportDate:['2026-09-30'],acceptanceDateTime:['2026-10-20T16:00:00Z'],form:['10-K'],primaryDocument:['synthetic.htm'],primaryDocDescription:['Synthetic annual report']},files:[{name:'CIK0000320193-submissions-001.json'}]}};
function mock(body:unknown){const requests:SecRequest[]=[];const transport:SecPublicTransport={origin:'synthetic',async send(r){requests.push(r);return {status:200,body_text:typeof body==='string'?body:JSON.stringify(body)};}};return {transport,requests};}
test('SEC company concept dispatches one fixed URL and preserves unsafe-integer numeric lexemes exactly',async()=>{
 const raw=JSON.stringify(concept).replace('"val":123','"val":900719925474099312345678');const m=mock(raw);const result=await requestSecCompanyConcept(input,m.transport,()=>at);assert.equal(result.facts[0]?.numeric_lexeme,'900719925474099312345678');assert.equal(result.facts[0]?.unit_raw,'USD');assert.equal(result.facts[0]?.period_kind,'instant');assert.equal(result.facts[0]?.accounting_basis,null);assert.equal(m.requests[0]?.url,'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Assets.json');assert.equal(result.origin,'synthetic');
});
test('SEC preserves decimal/scientific lexeme and duration without cumulative conversion',async()=>{
 const raw=JSON.stringify({...concept,units:{'USD/shares':[{...fact,start:'2026-01-01'}]}}).replace('"val":123','"val":1.2300000000000000001e-3');const result=await requestSecCompanyConcept(input,mock(raw).transport,()=>at);assert.equal(result.facts[0]?.numeric_lexeme,'1.2300000000000000001e-3');assert.equal(result.facts[0]?.period_kind,'duration');assert.equal(result.facts[0]?.canonical_metric,null);
});
test('SEC retains provider order and explicitly counts omitted facts and units',async()=>{
 const result=await requestSecCompanyConcept({...input,max_facts:1},mock({...concept,units:{USD:[fact],CAD:[{...fact,val:50}]}}).transport,()=>at);assert.equal(result.total_fact_count,2);assert.equal(result.truncated,true);assert.equal(result.facts[0]?.unit_raw,'USD');
});
test('SEC rejects arbitrary taxonomy/tag, keys, CIK, mismatched identity and forged parsed values',async()=>{
 const m=mock(concept);for(const q of [{...input,cik:'0'},{...input,concept:'../../keys'},{...input,taxonomy:'ifrs-full',concept:'NetIncomeLoss'},{...input,key:'secret'}])await assert.rejects(requestSecCompanyConcept(q,m.transport));assert.equal(m.requests.length,0);
 for(const c of [{...concept,cik:1},{...concept,tag:'Liabilities'},{...concept,units:{USD:[{...fact,val:{lexeme:'999'}}]}},{...concept,units:{USD:[{...fact,start:'2026-10-01'}]}}])await assert.rejects(requestSecCompanyConcept(input,mock(c).transport,()=>at));
});
test('SEC submissions is recent metadata only and historical files remain unfetched',async()=>{
 const m=mock(submission);const result=await requestSecSubmissions({cik:input.cik},m.transport,()=>at);assert.equal(m.requests.length,1);assert.equal(result.historical_file_count,1);assert.equal(result.filings[0]?.primary_document,'synthetic.htm');assert.equal(result.source_as_of,null);assert.equal(result.completeness,'recent_subset_historical_files_not_fetched');
});
test('SEC submissions rejects column length mismatch, duplicates, date drift and CIK mismatch',async()=>{
 const broken=structuredClone(submission);broken.filings.recent.form=[];await assert.rejects(requestSecSubmissions({cik:input.cik},mock(broken).transport,()=>at));const wrong=structuredClone(submission);wrong.cik='1';await assert.rejects(requestSecSubmissions({cik:input.cik},mock(wrong).transport,()=>at));const date=structuredClone(submission);date.filings.recent.filingDate=['2026-02-30'];await assert.rejects(requestSecSubmissions({cik:input.cik},mock(date).transport,()=>at));
 const duplicate=structuredClone(submission);for(const values of Object.values(duplicate.filings.recent))values.push(values[0]!);await assert.rejects(requestSecSubmissions({cik:input.cik},mock(duplicate).transport,()=>at));
});
test('SEC timestamp is receipt after response and transport failures do not surface bodies',async()=>{
 let now=at;const m=mock(concept);const send=m.transport.send.bind(m.transport);m.transport.send=async r=>{await Promise.resolve();now='2026-10-22T00:02:00Z';return send(r);};assert.equal((await requestSecCompanyConcept(input,m.transport,()=>now)).received_at,now);
 await assert.rejects(requestSecSubmissions({cik:input.cik},{origin:'synthetic',async send(){return {status:403,body_text:'private upstream'};}},()=>at),/upstream_rejected/);await assert.rejects(requestSecCompanyConcept(input,mock('x'.repeat(3000001)).transport,()=>at),/response_too_large/);
});
test('SEC output schemas enforce context, selection counts and period shapes',async()=>{
 const result=await requestSecCompanyConcept(input,mock(concept).transport,()=>at);for(const mutate of [(x:any)=>x.source_url='https://evil.invalid/',(x:any)=>x.truncated=true,(x:any)=>x.facts[0].period_kind='duration']){const x=structuredClone(result);mutate(x);assert.equal(SecConceptResultSchema.safeParse(x).success,false);}
 const filings=await requestSecSubmissions({cik:input.cik},mock(submission).transport,()=>at);filings.omitted_recent_count=9;assert.equal(SecSubmissionsResultSchema.safeParse(filings).success,false);
});

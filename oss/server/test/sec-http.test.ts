import test from 'node:test';import assert from 'node:assert/strict';
import {createSecPublicHttpTransport} from '../src/sec-http.js';
import {RequestPacer} from '../src/kis-http.js';
const request={operation:'sec.submissions' as const,method:'GET' as const,url:'https://data.sec.gov/submissions/CIK0000000001.json'};
const userAgent='Synthetic ATP transport test test@example.invalid';
const factory=(fetchImpl:typeof fetch)=>createSecPublicHttpTransport({userAgent,origin:'synthetic',fetchImpl,pacer:new RequestPacer(0)});
test('SEC injected transport retains exact original numeric text and sends no provider credentials (synthetic)',async()=>{
 const original=' {"value":9007199254740993.12300}\n';let calls=0;
 const transport=factory(async(url,init)=>{calls++;assert.equal(String(url),request.url);assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');assert.deepEqual(Object.fromEntries(new Headers(init?.headers)),{accept:'application/json','user-agent':userAgent});return new Response(original);});
 assert.equal((await transport.send(request)).body_text,original);assert.equal(calls,1);
});
test('SEC invalid URL, query, CIK, taxonomy, getters and unknown fields fail before fetch (synthetic)',async()=>{
 let calls=0;const t=factory(async()=>{calls++;return new Response('{}');});
 for(const url of ['http://data.sec.gov/submissions/CIK0000000001.json',request.url+'?token=x',request.url.replace('data.sec.gov','example.invalid'),request.url.replace('0000000001','0000000000')])await assert.rejects(t.send({...request,url}),/invalid_input/);
 await assert.rejects(t.send({...request,extra:'x'} as any),/invalid_input/);
 let getter=0;const q={...request};Object.defineProperty(q,'url',{enumerable:true,get(){getter++;return request.url;}});await assert.rejects(t.send(q),/invalid_input/);assert.equal(getter,0);assert.equal(calls,0);
});
for(const status of [403,429,500])test(`SEC HTTP ${status} is sanitized and not retried (synthetic)`,async()=>{let calls=0;const t=factory(async()=>{calls++;return new Response('private upstream text',{status});});await assert.rejects(t.send(request),new RegExp(status===429?'rate_limited':'upstream_rejected'));assert.equal(calls,1);});
test('SEC parser-aligned size ceiling rejects oversize and cancels (synthetic)',async()=>{let cancelled=0;const t=factory(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(3000001));},cancel(){cancelled++;}})));await assert.rejects(t.send(request),/response_too_large/);assert.equal(cancelled,1);});
test('SEC has no default contact or fetch and does not promote unobserved actual responses (synthetic)',async()=>{
 for(const userAgent of ['', 'ATP', 'ATP\r\nInjected: x test@example.invalid'])assert.throws(()=>createSecPublicHttpTransport({userAgent,origin:'actual',fetchImpl:async()=>new Response('{}')}),/invalid_configuration/);
 const t=createSecPublicHttpTransport({userAgent,origin:'actual',fetchImpl:async()=>new Response('{}'),pacer:new RequestPacer(0)});await assert.rejects(t.send(request),/upstream_rejected/);
});

test('SEC allowlisted company concept request reaches only its exact endpoint (synthetic)',async()=>{
 const concept={operation:'sec.company_concept' as const,method:'GET' as const,url:'https://data.sec.gov/api/xbrl/companyconcept/CIK0000000001/us-gaap/Assets.json'};let calls=0;
 const t=factory(async(url)=>{calls++;assert.equal(String(url),concept.url);return new Response('{}');});await t.send(concept);
 await assert.rejects(t.send({...concept,url:concept.url.replace('us-gaap','custom')}),/invalid_input/);assert.equal(calls,1);
});

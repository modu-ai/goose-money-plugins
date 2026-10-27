import {readFileSync} from 'node:fs';
import {createOneShotQuoteSmoke,type QuoteSmokeDependencies} from '../src/quote-smoke.js';
import {KIS_BASE_URL} from '../src/kis-http.js';
import {KIS_QUOTE_CATALOG} from '../src/normalize-kr-quote.js';
export const SMOKE_AUTHORIZED_AT='2026-10-22T01:00:00.000000000Z',SMOKE_RECEIVED_AT='2026-10-22T01:00:00.000000001Z';
export const SMOKE_SOURCE=KIS_BASE_URL.production+KIS_QUOTE_CATALOG.path;
export const rawSyntheticQuote=()=>readFileSync(new URL('../../../tests/fixtures/kr_quote_synthetic.json',import.meta.url),'utf8');
export function smokeFixture(){
 let reads=0,checks=0,ticks=0;const body=rawSyntheticQuote();
 const gate={contract:'moai.quote-smoke.read-gate.v1',symbol:'000660',board:'J',origin:'synthetic',purpose:'single_quote_smoke',maximum_reads:1,action_authorized:true,source_read_entitled:true,ephemeral_transport_ready:true,valid_from:SMOKE_AUTHORIZED_AT,valid_until:'2026-10-22T01:01:00Z'};
 const deps:QuoteSmokeDependencies={origin:'synthetic',clock:()=>ticks++?SMOKE_RECEIVED_AT:SMOKE_AUTHORIZED_AT,readGate:{async check(){checks++;return gate;}},transport:{async getMarketSnapshotCapture(){reads++;return {rawResponseText:body,sourceUrl:SMOKE_SOURCE,responseStatus:200};}}};
 return {deps,gate,get reads(){return reads;},get checks(){return checks;},run:()=>createOneShotQuoteSmoke(deps).run({symbol:'000660',board:'J'})};
}

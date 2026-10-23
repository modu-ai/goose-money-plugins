import {mkdir,writeFile} from 'node:fs/promises';
import {smokeFixture} from '../dist/test/quote-smoke-fixtures.js';
const fixture=smokeFixture();const packet=await fixture.run();if(packet.status!=='quote_capture_ready_for_local_review'||packet.origin!=='synthetic')throw Error('synthetic_rehearsal_failed');
const dir='fixtures/quote-smoke';await mkdir(dir,{recursive:true});const write=(name,value)=>writeFile(`${dir}/${name}`,JSON.stringify(value,null,2)+'\n');
await write('public-quote.json',packet.dto);await write('public-envelope-v2.json',packet.envelope);
await write('public-audit.json',{contract:packet.contract,origin:packet.origin,request:packet.request,report_cutoff:packet.report_cutoff,source:{url:packet.source.url,method:packet.source.method,response_status:packet.source.response_status,received_at:packet.source.received_at,sha256:packet.source.sha256,hash_scope:packet.source.hash_scope},audit:packet.audit,warnings:packet.warnings,actual_network_requests:0});
// Raw source text is deliberately not copied into the renderer handoff.
console.log(JSON.stringify({status:'synthetic_rehearsal_ready',origin:'synthetic',transport_invocations:fixture.reads,actual_network_requests:0}));

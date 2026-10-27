// t28 K3-NUMERIC-RTCD: the K3 envelope (kis-reference-data.ts `response`) must treat a numeric non-zero rt_cd as a
// provider refusal, the same way isProviderRefusal in r01-kis-http-adapters.ts does. It maps to the code the K3 path
// already uses for a string refusal (`upstream_rejected`). The exact upstream_rejected preservation question is an
// operator-owned separate item and is not touched here. Synthetic transports only, no network, no credentials.
import assert from 'node:assert/strict';
import test from 'node:test';
import {requestInstrumentProfile,requestInvestorRaw,requestMarketHeadlines,type ReferenceTransport} from '../src/kis-reference-data.js';

const at=()=>'2026-10-24T00:00:00Z';
const answer=(body:unknown):ReferenceTransport=>({origin:'synthetic',send:async()=>({status:200,tr_cont:null,body})});
const tools:Array<[string,(t:ReferenceTransport)=>Promise<unknown>]>=[
  ['profile',t=>requestInstrumentProfile({symbol:'005930'},t,at)],
  ['headlines',t=>requestMarketHeadlines({symbol:'005930'},t,at)],
  ['investors',t=>requestInvestorRaw({symbol:'005930',board:'J',input_date:'2026-10-23'},t,at)],
];

for(const [name,run] of tools){
  test(`K3 ${name}: numeric non-zero rt_cd is a provider refusal (upstream_rejected), with or without output`,async()=>{
    for(const code of [1,-1,500,1.5]){
      await assert.rejects(run(answer({rt_cd:code,msg_cd:'X',msg1:'synthetic refusal'})),/^Error: upstream_rejected$/,`${name} numeric ${code} no output`);
      await assert.rejects(run(answer({rt_cd:code,output:[]})),/^Error: upstream_rejected$/,`${name} numeric ${code} with output`);
    }
  });
  test(`K3 ${name}: numeric zero and non-scalar rt_cd stay schema_drift; string refusal stays upstream_rejected`,async()=>{
    for(const body of [{rt_cd:0},{rt_cd:0,output:[]},{rt_cd:null},{rt_cd:true},{rt_cd:[1]},{rt_cd:{}},{}]){
      await assert.rejects(run(answer(body)),/^Error: schema_drift$/,`${name} ${JSON.stringify(body)}`);
    }
    await assert.rejects(run(answer({rt_cd:'1',msg1:'synthetic refusal'})),/^Error: upstream_rejected$/);
    await assert.rejects(run(answer({rt_cd:'0'})),/^Error: schema_drift$/);
  });
}

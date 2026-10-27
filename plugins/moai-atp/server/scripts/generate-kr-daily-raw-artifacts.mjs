import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { buildKrDailyRawEvidence,verifyKrDailyRawEvidence,KrDailyEvidenceInputSchema,KrDailyEvidenceRequestSchema,KrDailyEvidenceResultSchema,KR_DAILY_EVIDENCE_LIMITS,KR_DAILY_EVIDENCE_ERROR_CODES } from '../dist/src/kr-daily-raw-evidence.js';
if(process.version!=='v24.22.1')throw Error('pinned_node_required');
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const sha=s=>createHash('sha256').update(s).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
const put=async(p,x)=>writeFile(resolve(root,p),typeof x==='string'?x:json(x));
await mkdir(resolve(root,'fixtures/kr-daily-raw'),{recursive:true});await mkdir(resolve(root,'evidence/kr-daily-raw'),{recursive:true});
for(const [name,schema]of [['request',KrDailyEvidenceRequestSchema],['input',KrDailyEvidenceInputSchema],['result',KrDailyEvidenceResultSchema]]){
  const out=z.toJSONSchema(schema,{target:'draft-2020-12'});out.$id=`urn:moai:kis:kr-daily-raw-evidence:${name}:v1`;
  out.description='Structural only. Runtime verification must reconstruct from independently supplied context and separately retained original body text. Calendar validity, receipt ordering, index/order/count and capture binding are runtime invariants.';
  await put(`contracts/kr-daily-raw-evidence-${name}-v1.schema.json`,out);
}
const mixed={rt_cd:'0',msg_cd:'SYNTHETIC_PRIVATE_CODE',msg1:'SYNTHETIC_PRIVATE_MESSAGE_NOT_PUBLIC',output1:{unprojected:'SYNTHETIC_PRIVATE_HEADER'},output2:[
  {stck_bsop_date:'20261021',stck_clpr:'000123.00',stck_oprc:'-0.00',stck_hgpr:'123.4',stck_lwpr:'001.00',acml_vol:'999999999999999999',acml_tr_pbmn:'000000000000000001',flng_cls_code:'00',prtt_rate:'0001.000',mod_yn:'N',revl_issu_reas:'01'},
  {stck_bsop_date:'20261019',stck_clpr:'',stck_oprc:'',stck_hgpr:'',stck_lwpr:'',acml_vol:'',acml_tr_pbmn:'',flng_cls_code:'',prtt_rate:'',mod_yn:'',revl_issu_reas:''},
  {stck_bsop_date:'20261020'}]};
const fixtures=[];
for(const [name,b]of [['mixed-order',mixed],['empty-success',{rt_cd:'0',output1:{},output2:[]}]]){
  const text=json(b);const q={request:{symbol:'000000',board:'J',start_date:'2026-10-19',end_date:'2026-10-21',interval:'1d',adjustment_code:'0'},
    capture:{origin:'synthetic',received_at:'2026-10-22T00:00:00.12345678901234567890Z',expected_body_sha256:sha(text)},cutoff:'2026-10-22T09:00:00.12345678901234567891+09:00'};
  const dto=buildKrDailyRawEvidence(q,text);verifyKrDailyRawEvidence(JSON.parse(json(dto)),q,text);
  await put(`fixtures/kr-daily-raw/${name}.body.json`,text);await put(`fixtures/kr-daily-raw/${name}.input.json`,q);await put(`fixtures/kr-daily-raw/${name}.evidence.json`,dto);
  fixtures.push({name,synthetic:true,body_sha256:sha(text),input_sha256:sha(json(q)),evidence_sha256:sha(json(dto)),row_count:dto.row_count});
}
await put('evidence/kr-daily-raw/fixture-verification.json',{contract:'moai.kis.kr-daily-raw-evidence.v1',node:process.version,deterministic:true,network_calls:0,credentials_used:false,canonical_fields_promoted:0,fixtures,limits:KR_DAILY_EVIDENCE_LIMITS,error_codes:KR_DAILY_EVIDENCE_ERROR_CODES});
console.log(JSON.stringify({status:'ok',fixtures:fixtures.length,schemas:3}));

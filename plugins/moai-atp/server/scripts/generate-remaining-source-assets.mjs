// Offline deterministic synthetic fixtures and structural schemas. Run after TypeScript build.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { RemainingSourceRequestSchema, RemainingSourceInputSchema, RemainingSourceResultSchema, buildRemainingSourceEvidence } from '../dist/src/remaining-source-inputs.js';
const dir=new URL('../',import.meta.url),save=(path,obj)=>writeFileSync(new URL(path,dir),JSON.stringify(obj,null,2)+'\n');
for(const [name,schema]of [['request',RemainingSourceRequestSchema],['input',RemainingSourceInputSchema],['result',RemainingSourceResultSchema]]){
 const json=z.toJSONSchema(schema);json.$id=`https://moai.invalid/contracts/remaining-source-${name}-v1.schema.json`;
 json.title=`MoAI KIS remaining source ${name} v1 (structural only)`;json.description='Structural validation is not semantic or provenance verification. Reconstruct using independent request/context and original response text.';
 save(`contracts/remaining-source-${name}-v1.schema.json`,json);
}
const market={operation_ref:'KIS-113',query:{FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:'0001',FID_INPUT_DATE_1:'20261021',FID_INPUT_DATE_2:'20261021',FID_INPUT_ISCD_1:'KSP',FID_INPUT_ISCD_2:''}};
const estimates={operation_ref:'KIS-109',query:{SHT_CD:'005930'}};
const ice={operation_ref:'KIS-280',query:{NCOD:'US',SYMB:'SYNTH',ST_YMD:'20261001',ED_YMD:'20261031'}};
const cases=[['market',market,{rt_cd:'0',msg1:'PRIVATE_SYNTHETIC_MESSAGE',output:[{stck_bsop_date:'20261021',frgn_ntby_qty:'000012',prsn_ntby_qty:'',orgn_ntby_tr_pbmn:'-00001.500'},{stck_bsop_date:'20261021',frgn_ntby_qty:'000012'}]}],
 ['estimates',estimates,{rt_cd:'0',output1:{unreviewed:'PRIVATE_SYNTHETIC_OUTPUT1'},output2:[{data1:'001.20',data2:'',data5:'-0.00'},{}],output3:[{data1:'11',data2:'',data3:'PRIVATE_SYNTHETIC_DATA3',data4:{unreviewed:true},data5:'12'}],output4:[{dt:'FY26E'},{dt:''},{}]}],
 ['ice',ice,{rt_cd:'0',output1:[{anno_dt:'20250101',ca_title:'TickerChange',effective_dt:'20261010',pay_dt:'20280101',div_lock_dt:''},{ca_title:'UNKNOWN'},{ca_title:'UNKNOWN'}]}],
 ['market-empty',market,{rt_cd:'0',output:[]}],['estimates-empty',estimates,{rt_cd:'0',output2:[],output3:[],output4:[]}],['ice-empty',ice,{rt_cd:'0',output1:[]}]];
const manifest={contract:'moai.remaining-source.synthetic-fixtures.v1',synthetic_only:true,network_requests:0,provider_validation:false,cases:[]};
for(const [name,request,body]of cases){const original=JSON.stringify(body,null,2)+'\n';const hash=createHash('sha256').update(original,'utf8').digest('hex');const input={request,capture:{origin:'synthetic',received_at:'2026-10-22T08:00:00.123456789Z',expected_body_sha256:hash},cutoff:'2026-10-22T08:00:00.123456789Z'};
 const stem=`fixtures/remaining-source-${name}.synthetic`;writeFileSync(new URL(stem+'.original.json',dir),original);save(stem+'.input.json',input);save(stem+'.result.json',buildRemainingSourceEvidence(input,original));
 manifest.cases.push({name,operation_ref:request.operation_ref,original:stem+'.original.json',input:stem+'.input.json',result:stem+'.result.json',original_sha256:hash});}
save('fixtures/remaining-source-fixtures-v1.json',manifest);

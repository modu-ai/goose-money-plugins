import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { verifyKrDailyRawEvidence,KR_DAILY_EVIDENCE_LIMITS as limits } from '../dist/src/kr-daily-raw-evidence.js';
// Caller-owned expectations, NOT context reconstructed from the stored DTO.
// CLI metadata JSON deliberately supports nonnegative integer number tokens only, with no exponent/rounding ambiguity.
if(process.version!=='v24.22.1')throw Error('pinned_node_required');
if(process.argv.length!==5){console.error('Usage: node scripts/replay-kr-daily-raw-evidence.mjs INPUT.json ORIGINAL_BODY.json EVIDENCE.json');process.exit(2);}
async function anchoredFile(path){
  if(process.platform!=='linux'||![constants.O_NOFOLLOW,constants.O_NONBLOCK,constants.O_DIRECTORY].every(Number.isInteger))throw Error('unsupported_filesystem_guards');
  if(typeof path!=='string'||path.length>4096||path.split('/').includes('..'))throw Error('invalid_path');
  const parts=resolve(path).split('/').filter(Boolean);if(!parts.length)throw Error('invalid_path');
  const directoryFlags=constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK|constants.O_DIRECTORY;
  let directory=await open('/',directoryFlags);
  try{
    for(const part of parts.slice(0,-1)){const next=await open(`/proc/self/fd/${directory.fd}/${part}`,directoryFlags);await directory.close();directory=next;}
    return await open(`/proc/self/fd/${directory.fd}/${parts.at(-1)}`,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  }finally{await directory.close();}
}
async function boundedText(path,max){const file=await anchoredFile(path);try{
  const before=await file.stat({bigint:true});if(!before.isFile()||before.size>BigInt(max))throw Error('invalid_file');
  const b=Buffer.alloc(max+1);let size=0;
  while(size<b.length){const {bytesRead}=await file.read(b,size,b.length-size,null);if(!bytesRead)break;size+=bytesRead;}
  const after=await file.stat({bigint:true});
  if(!after.isFile()||['dev','ino','mode','nlink','uid','gid','size','mtimeNs','ctimeNs'].some(k=>before[k]!==after[k]))throw Error('changed_file');
  if(size>max||BigInt(size)!==before.size)throw Error('too_large_or_changed');
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b.subarray(0,size));
}finally{await file.close();}}
function metadataJson(text){let p=0,nodes=0;const check=v=>{if(!v)throw Error('invalid_json');};const white=c=>c===' '||c==='\r'||c==='\n'||c==='\t';
  const ws=()=>{while(white(text[p]))p++;};
  function str(key=false){const limit=key?limits.key_code_units:limits.string_code_units;const begin=p;check(text[p++]==='"');let closed=false;while(p<text.length){check(p-begin<=6*limit+2);const c=text[p++];
      if(c==='"'){closed=true;break;}if(c==='\\')p++;else check(c.charCodeAt(0)>=32);}
    check(closed);const v=JSON.parse(text.slice(begin,p));check(v.length<=(key?limits.key_code_units:limits.string_code_units));return v;}
  function value(depth){check(++nodes<=limits.body_nodes&&depth<=limits.body_depth);ws();const c=text[p];if(c==='"')return str();
    if(c==='{'||c==='['){const a=c==='[',out=a?[]:Object.create(null),seen=new Set();p++;ws();if(text[p]===(a?']':'}')){p++;return out;}let n=0;
      while(p<text.length){check(++n<=limits.container_entries);ws();if(a)out.push(value(depth+1));else{const key=str(true);check(!seen.has(key));seen.add(key);ws();check(text[p++]===':');
          Object.defineProperty(out,key,{value:value(depth+1),enumerable:true,writable:true,configurable:true});}
        ws();const end=text[p++];if(end===(a?']':'}'))return out;check(end===',');}throw Error('invalid_json');}
    for(const [word,v]of [['true',true],['false',false],['null',null]])if(text.startsWith(word,p)){p+=word.length;return v;}
    const begin=p;while(p<text.length&&!white(text[p])&&text[p]!==','&&text[p]!==']'&&text[p]!=='}'){check(p-begin<16);p++;}
    const token=text.slice(begin,p);check(/^(?:0|[1-9]\d*)(?![\s\S])/.test(token));const number=Number(token);check(Number.isSafeInteger(number));return number;
  }
  const result=value(0);ws();check(p===text.length);return result;
}
try {
  const [input,body,persisted]=await Promise.all([boundedText(process.argv[2],limits.input_bytes),boundedText(process.argv[3],limits.body_bytes),boundedText(process.argv[4],limits.persisted_bytes)]);
  const result=verifyKrDailyRawEvidence(metadataJson(persisted),metadataJson(input),body);
  console.log(JSON.stringify({status:'verified_reconstruction',contract:result.contract,body_sha256:result.capture.body_sha256,row_count:result.row_count,canonical_projection_status:result.canonical_projection_status,source_authentication:result.capture.source_authentication}));
}catch {console.error('evidence_replay_failed');process.exitCode=1;}

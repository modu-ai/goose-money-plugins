import {crc32,inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {InstrumentDirectorySchema,type InstrumentDirectoryLoader} from './instrument-directory.js';
import {KIS_MASTER_PROFILES,parseKisKrStockMaster} from './kis-instrument-master.js';
const LIMIT=5_000_000;
/** Single fixed member only; no filesystem extraction, encrypted/ZIP64/multi-disk archives. */
export function unpackKisMasterZip(bytes:Uint8Array,expected:string):Uint8Array {
 const b=Buffer.from(bytes);if(b.length<22||b.length>LIMIT)throw Error('master_archive_invalid');let end=-1;
 for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50&&i+22+b.readUInt16LE(i+20)===b.length){end=i;break;}
 if(end<0||b.readUInt16LE(end+4)!==0||b.readUInt16LE(end+6)!==0||b.readUInt16LE(end+8)!==1||b.readUInt16LE(end+10)!==1)throw Error('master_archive_invalid');
 const c=b.readUInt32LE(end+16),cs=b.readUInt32LE(end+12);if(c+cs!==end||c+46>end||b.readUInt32LE(c)!==0x02014b50)throw Error('master_archive_invalid');
 const flags=b.readUInt16LE(c+8),method=b.readUInt16LE(c+10),crc=b.readUInt32LE(c+16),compressed=b.readUInt32LE(c+20),size=b.readUInt32LE(c+24),nl=b.readUInt16LE(c+28),el=b.readUInt16LE(c+30),cl=b.readUInt16LE(c+32),offset=b.readUInt32LE(c+42);
 if((flags&1)!==0||![0,8].includes(method)||size>LIMIT||compressed>LIMIT||c+46+nl+el+cl!==end||b.readUInt16LE(c+34)!==0||((b.readUInt32LE(c+38)>>>16)&0xf000)===0xa000)throw Error('master_archive_invalid');
 if(b.subarray(c+46,c+46+nl).toString('ascii')!==expected||offset+30>c||b.readUInt32LE(offset)!==0x04034b50||b.readUInt16LE(offset+6)!==flags||b.readUInt16LE(offset+8)!==method)throw Error('master_archive_invalid');
 const ln=b.readUInt16LE(offset+26),le=b.readUInt16LE(offset+28),start=offset+30+ln+le;
 if(b.subarray(offset+30,offset+30+ln).toString('ascii')!==expected||start+compressed>c)throw Error('master_archive_invalid');
 let raw:Buffer;try{raw=method===0?b.subarray(start,start+compressed):inflateRawSync(b.subarray(start,start+compressed),{maxOutputLength:LIMIT});}catch{throw Error('master_archive_invalid');}
 if(raw.length!==size||crc32(raw)!==crc)throw Error('master_archive_invalid');return raw;
}
export async function readKisKrMaster(profile:'kospi'|'kosdaq',fetchImpl:typeof fetch=fetch){
 const source=KIS_MASTER_PROFILES[profile];let r:Response;try{r=await fetchImpl(source.source_url,{method:'GET',redirect:'error',headers:{'User-Agent':'MoAI-ATP/0.1 local-master-reader'},signal:AbortSignal.timeout(10000)});}catch{throw Error('source_unavailable');}
 if(r.status!==200||!r.body)throw Error('source_unavailable');const reader=r.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>LIMIT){await reader.cancel();throw Error('master_too_large');}chunks.push(x.value);}}finally{reader.releaseLock();}
 const archive=Buffer.concat(chunks);return {raw:unpackKisMasterZip(archive,source.filename),sha256:createHash('sha256').update(archive).digest('hex'),received_at:new Date().toISOString()};
}
/** Lazy, credential-free master download; no background work or persistent cache. */
export class OfficialKrEquityDirectoryLoader implements InstrumentDirectoryLoader {
 private current:Promise<unknown>|undefined;private until=0;
 constructor(private readonly fetchImpl:typeof fetch=fetch){}
 load():Promise<unknown>{if(this.current&&Date.now()<this.until)return this.current;this.until=Date.now()+300000;this.current=this.collect().catch(()=>{this.current=undefined;this.until=0;throw Error('source_unavailable');});return this.current;}
 private async collect(){const captures=await Promise.all((['kospi','kosdaq'] as const).map(async profile=>{const capture=await readKisKrMaster(profile,this.fetchImpl);return {profile,capture,parsed:parseKisKrStockMaster(capture.raw,{profile,origin:'actual',source_received_at:capture.received_at,header_mode:'none'})};}));
 const entries=captures.flatMap(c=>c.parsed.directory.entries.filter(e=>e.asset_class==='equity'||e.asset_class==='etf'));if(!entries.length)throw Error('source_unavailable');
 return InstrumentDirectorySchema.parse({origin:'actual',source_received_at:captures.map(c=>c.capture.received_at).sort().at(-1),source_as_of:null,source_url:'https://new.real.download.dws.co.kr/common/master/',entries,coverage:'Official KOSPI/KOSDAQ master equity/ETF candidates only. ETN/unknown excluded. Current listing/authenticity/currency not confirmed. '+captures.map(c=>c.profile+' archive SHA256 '+c.capture.sha256).join('; ')});
 }
}

import {randomUUID,createHash} from 'node:crypto';
export class ReportEvidenceStore {
 private sources=new Map<string,{tool:string;json:string;receivedAt:string;expires:number}>();
 private reports=new Map<string,number>();
 constructor(private readonly now:()=>number=Date.now){}
 private prune(){for(const [id,row]of this.sources)if(row.expires<=this.now())this.sources.delete(id);for(const [id,expiry]of this.reports)if(expiry<=this.now())this.reports.delete(id);}
 issue(tool:string,value:Record<string,unknown>,receivedAt:string){this.prune();const json=JSON.stringify(value);if(Buffer.byteLength(json)>300000)throw Error('response_too_large');while(this.sources.size>=12)this.sources.delete(this.sources.keys().next().value!);const id=randomUUID();this.sources.set(id,{tool,json,receivedAt,expires:this.now()+300000});return id;}
 resolve(ids:readonly string[]){this.prune();if(new Set(ids).size!==ids.length)throw Error('invalid_provenance');return ids.map(id=>{const row=this.sources.get(id);if(!row)throw Error('invalid_provenance');return {tool_name:row.tool,result:{structuredContent:JSON.parse(row.json) as Record<string,unknown>},receivedAt:row.receivedAt};});}
 consume(ids:readonly string[]){for(const id of ids)this.sources.delete(id);}
 rememberReport(value:unknown){this.prune();while(this.reports.size>=3)this.reports.delete(this.reports.keys().next().value!);this.reports.set(this.hash(value),this.now()+300000);}
 acceptsReport(value:unknown){this.prune();return this.reports.has(this.hash(value));}
 private hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
}

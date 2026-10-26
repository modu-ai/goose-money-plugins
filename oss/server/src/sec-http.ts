import {types} from 'node:util';
import {SecConceptInputSchema,SecSubmissionsInputSchema,type SecPublicTransport,type SecRequest} from './sec-public-data.js';
import {RequestPacer,readBoundedResponseText} from './kis-http.js';

// Explicit host injection only: no environment, credential lookup, default contact or default fetch.
const processPacer=new RequestPacer(1000);
export function createSecPublicHttpTransport(options:{userAgent:string;origin:'actual'|'synthetic';fetchImpl:typeof fetch;pacer?:RequestPacer}):SecPublicTransport {
 const ua=options.userAgent;
 if(typeof ua!=='string'||ua.length>200||!/^[\x20-\x7e]+$/.test(ua)||!/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/.test(ua)||!['actual','synthetic'].includes(options.origin)||typeof options.fetchImpl!=='function')throw new Error('invalid_configuration');
 const fetcher=options.fetchImpl,pacer=options.pacer??processPacer,origin=options.origin;
 return {origin,async send(input:SecRequest){
  if(!input||typeof input!=='object'||types.isProxy(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw new Error('invalid_input');
  const descriptors=Object.getOwnPropertyDescriptors(input);
  if(Reflect.ownKeys(descriptors).length!==3||!['operation','method','url'].every(k=>descriptors[k]?.enumerable&&'value' in descriptors[k]!))throw new Error('invalid_input');
  const operation=descriptors.operation!.value,method=descriptors.method!.value,url=descriptors.url!.value;
  if(method!=='GET'||typeof url!=='string'||url.length>300)throw new Error('invalid_input');
  let valid=false;
  if(operation==='sec.submissions'){
   const m=/^https:\/\/data\.sec\.gov\/submissions\/CIK([0-9]{10})\.json$/.exec(url);
   valid=!!m&&SecSubmissionsInputSchema.safeParse({cik:m[1]}).success;
  }else if(operation==='sec.company_concept'){
   const m=/^https:\/\/data\.sec\.gov\/api\/xbrl\/companyconcept\/CIK([0-9]{10})\/(us-gaap|ifrs-full)\/([A-Za-z0-9]+)\.json$/.exec(url);
   valid=!!m&&SecConceptInputSchema.safeParse({cik:m[1],taxonomy:m[2],concept:m[3]}).success;
  }
  if(!valid)throw new Error('invalid_input');
  await pacer.reserve();let response:Response;
  try{response=await fetcher(url,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000),headers:{accept:'application/json','user-agent':ua}});}catch{throw new Error('upstream_unavailable');}
  if(response.redirected||response.status!==200){await response.body?.cancel().catch(()=>undefined);throw new Error(response.status===429?'rate_limited':'upstream_rejected');}
  if((origin==='actual'&&response.url!==url)||(response.url!==''&&response.url!==url)){await response.body?.cancel().catch(()=>undefined);throw new Error('upstream_rejected');}
  // Preserve decoded original text and numeric lexemes. Match existing SEC parser's ceiling.
  const body_text=await readBoundedResponseText(response,3000000);
  return {status:200,body_text};
 }};
}

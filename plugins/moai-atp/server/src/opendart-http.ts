import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { hrtime } from 'node:process';
const monotonicNow = hrtime.bigint;
import { OPENDART_ENDPOINT, openDartInputSchema, parseOpenDartFullStatement, type OpenDartTransportRequest, type OpenDartTransport } from './opendart.js';
import { OPENDART_FILINGS_ENDPOINT, openDartFilingsInputSchema, parseOpenDartFilings, type OpenDartFilingsTransportRequest, type OpenDartFilingsTransport } from './opendart-filings.js';
import { ExactInstantSchema } from './exact-instant.js';

export const OPENDART_HTTP_LIMITS = Object.freeze({ response_bytes: 300_000, depth: 12, nodes: 30_000, string_units: 8192, key_units: 128, timeout_ms: 10_000, read_iterations: 4096 });
export const OPENDART_HTTP_ERRORS = Object.freeze(['invalid_configuration','invalid_input','already_attempted','authorization_denied','credential_unavailable','transport_failed','request_timeout','redirect_rejected','credential_rejected','rate_limited','http_rejected','response_too_large','invalid_response','credential_reflection','invalid_clock'] as const);
export type OpenDartHttpErrorCode = typeof OPENDART_HTTP_ERRORS[number];
const errorCodes = new WeakMap<object,OpenDartHttpErrorCode>();
export class SafeOpenDartHttpError extends Error {
  readonly code: OpenDartHttpErrorCode;
  constructor(code: OpenDartHttpErrorCode) { const safe = OPENDART_HTTP_ERRORS.includes(code) ? code : 'invalid_response'; super(safe); this.code=safe; this.name='SafeOpenDartHttpError'; errorCodes.set(this,safe); }
}
type Request = OpenDartTransportRequest | OpenDartFilingsTransportRequest;
export interface OpenDartHttpOptions {
  /** Explicit trusted host adapters only. No environment, credential file, default fetch or token issuance. */
  origin: 'actual' | 'synthetic';
  authorizeRead: (request: Readonly<Request>) => Promise<boolean>;
  readApiKey: () => Promise<string>;
  fetchImpl: typeof fetch;
  clock: () => string;
  timeoutMs?: number;
}
export interface OpenDartHttpAudit {
  operation: Request['operation']; source_endpoint: Request['endpoint']; response_status: 200;
  received_at: string; decoded_body_bytes: number; decoded_body_sha256: string;
  hash_scope: 'decoded_response_text_utf8'; origin: 'actual' | 'synthetic';
  source_assurance: 'injected_host_transport_attestation_only'; source_authenticated: false;
  rights_status: 'pending'; canonical_promotion: false; request_attempts: 1;
}
const fail = (code: OpenDartHttpErrorCode): never => { throw new SafeOpenDartHttpError(code); };
function plain(value: unknown, permitted: readonly string[], required: readonly string[], code: OpenDartHttpErrorCode): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length > permitted.length || keys.some(k => typeof k !== 'string' || k.length > 128 || !permitted.includes(k))) return fail(code);
  const result: Record<string, unknown> = Object.create(null);
  for (const k of keys as string[]) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (!d || !d.enumerable || !('value' in d)) return fail(code);
    result[k] = d.value;
  }
  if (required.some(k => !Object.hasOwn(result, k))) return fail(code);
  return result;
}
const full = (pattern: RegExp, value: string): boolean => new RegExp('^(?:'+pattern.source+')(?![\\s\\S])',pattern.flags).test(value);
function requestSnapshot(value: unknown): Request {
  const r = plain(value, ['operation','method','endpoint','params'], ['operation','method','endpoint','params'], 'invalid_input');
  if (r.method !== 'GET') return fail('invalid_input');
  const financial = r.operation === 'opendart.full_statement';
  if (!financial && r.operation !== 'opendart.public_filings') return fail('invalid_input');
  if (r.endpoint !== (financial ? OPENDART_ENDPOINT : OPENDART_FILINGS_ENDPOINT)) return fail('invalid_input');
  const fields = financial ? ['corp_code','bsns_year','reprt_code','fs_div'] : ['corp_code','bgn_de','end_de','last_reprt_at','pblntf_ty','corp_cls','sort','sort_mth','page_no','page_count'];
  const p = plain(r.params, fields, financial ? fields : ['corp_code','bgn_de','end_de'], 'invalid_input');
  for (const [key,v] of Object.entries(p)) {
    if (typeof v === 'string') { if (v.length > 32 || !full(/[\x20-\x7e]*/,v)) return fail('invalid_input'); }
    else if (!['page_no','page_count'].includes(key) || typeof v !== 'number' || !Number.isSafeInteger(v)) return fail('invalid_input');
  }
  if (financial) {
    const v = openDartInputSchema.safeParse(p); if (!v.success) return fail('invalid_input');
    return Object.freeze({ operation: 'opendart.full_statement', method: 'GET', endpoint: OPENDART_ENDPOINT, params: Object.freeze(v.data) });
  }
  const v = openDartFilingsInputSchema.safeParse(p); if (!v.success) return fail('invalid_input');
  return Object.freeze({ operation: 'opendart.public_filings', method: 'GET', endpoint: OPENDART_FILINGS_ENDPOINT, params: Object.freeze(v.data) });
}
function wellFormed(value:string):boolean {
  for(let i=0;i<value.length;i++) {
    const n=value.charCodeAt(i);
    if(n>=0xd800&&n<=0xdbff) { const next=value.charCodeAt(++i); if(!(next>=0xdc00&&next<=0xdfff)) return false; }
    else if(n>=0xdc00&&n<=0xdfff) return false;
  }
  return true;
}
/** Bounded duplicate-aware decoder. DART numeric metadata is a narrow canonical nonnegative integer token profile. */
function decode(text: string): unknown {
  let i = 0, nodes = 0;
  const ws = () => { while (i < text.length && /[ \t\r\n]/.test(text[i]!)) i++; };
  function string(key = false): string {
    const begin = i++; let escaped = false;
    while (i < text.length) {
      const c = text[i++]!;
      if (i - begin > (key ? 770 : 49154)) return fail('invalid_response');
      if (!escaped && c === '"') {
        let value: unknown; try { value = JSON.parse(text.slice(begin,i)); } catch { return fail('invalid_response'); }
        if (typeof value !== 'string' || value.length > (key ? 128 : 8192) || !wellFormed(value)) return fail('invalid_response');
        if (key && ['__proto__','constructor','prototype'].includes(value)) return fail('invalid_response');
        return value;
      }
      if (!escaped && c === '\\') escaped = true; else escaped = false;
    }
    return fail('invalid_response');
  }
  function value(depth: number): unknown {
    if (++nodes > 30_000 || depth > 12) return fail('invalid_response'); ws(); const c = text[i];
    if (c === '"') return string();
    if (c === '{') {
      i++; ws(); const out: Record<string,unknown> = Object.create(null); let count = 0;
      if (text[i] === '}') { i++; return out; }
      while (i < text.length) {
        if (++count > 64 || text[i] !== '"') return fail('invalid_response');
        const k = string(true); if (Object.hasOwn(out,k)) return fail('invalid_response'); ws();
        if (text[i++] !== ':') return fail('invalid_response'); out[k] = value(depth+1); ws();
        const end = text[i++]; if (end === '}') return out; if (end !== ',') return fail('invalid_response'); ws();
      }
    } else if (c === '[') {
      i++; ws(); const out: unknown[] = []; if (text[i] === ']') { i++; return out; }
      while (i < text.length) {
        if (out.length >= 10000) return fail('invalid_response'); out.push(value(depth+1)); ws();
        const end = text[i++]; if (end === ']') return out; if (end !== ',') return fail('invalid_response'); ws();
      }
    } else {
      for (const [token,v] of [['true',true],['false',false],['null',null]] as const) if (text.startsWith(token,i)) { i += token.length; return v; }
      const begin = i; while (i < text.length && !/[\s,\]}]/.test(text[i]!)) { if (i-begin >= 8) return fail('invalid_response'); i++; }
      const token = text.slice(begin,i); if (!full(/(?:0|[1-9][0-9]{0,7})/,token)) return fail('invalid_response');
      return Number(token);
    }
    return fail('invalid_response');
  }
  const result = value(0); ws(); if (i !== text.length) return fail('invalid_response'); return result;
}
function rejectReflectedKey(value: unknown, key: string): void {
  if (typeof value === 'string') { if (value.includes(key) || value.includes(encodeURIComponent(key))) fail('credential_reflection'); }
  else if (value && typeof value === 'object') for (const [k,v] of Object.entries(value)) { if (k.includes(key)) fail('credential_reflection'); rejectReflectedKey(v,key); }
}
function strictFieldLexemes(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [k,v] of Object.entries(value)) {
    if (typeof v === 'string') {
      const digits: Record<string,RegExp> = { corp_code:/[0-9]{8}/,bsns_year:/[0-9]{4}/,reprt_code:/[0-9]{5}/,rcept_no:/[0-9]{14}/,rcept_dt:/[0-9]{8}/,status:/[0-9]{3}/,ord:/[0-9]+/,stock_code:/(?:[0-9]{6})?/ };
      if (digits[k] && !full(digits[k]!,v)) fail('invalid_response');
      if (k.endsWith('_amount') && v.trim() !== '' && !full(/[+-]?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?/,v)) fail('invalid_response');
    } else strictFieldLexemes(v);
  }
}
function deepFreeze<T>(v:T):T { if (v && typeof v === 'object') { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v); } return v; }

/** Creates one attempt, never an enabled default transport. Explicit host code must supply every capability. */
export function createOneShotOpenDartHttpTransport(options: OpenDartHttpOptions): { readonly origin: 'actual' | 'synthetic'; send(input: unknown): Promise<unknown>; readAudit(): Readonly<OpenDartHttpAudit> | null; readPrivateCapture(): Readonly<{body_text:string; audit:Readonly<OpenDartHttpAudit>}> | null } {
  const o = plain(options,['origin','authorizeRead','readApiKey','fetchImpl','clock','timeoutMs'],['origin','authorizeRead','readApiKey','fetchImpl','clock'],'invalid_configuration');
  if (!['actual','synthetic'].includes(o.origin as string)) return fail('invalid_configuration');
  for (const k of ['authorizeRead','readApiKey','fetchImpl','clock']) if (typeof o[k] !== 'function' || types.isProxy(o[k])) return fail('invalid_configuration');
  const timeout = o.timeoutMs ?? 10000; if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 10000) return fail('invalid_configuration');
  const origin = o.origin as 'actual' | 'synthetic', authorize = o.authorizeRead as OpenDartHttpOptions['authorizeRead'], readKey = o.readApiKey as OpenDartHttpOptions['readApiKey'], fetcher = o.fetchImpl as typeof fetch, clock = o.clock as () => string;
  let attempted = false, audit: Readonly<OpenDartHttpAudit> | null = null;
  let privateCapture: Readonly<{body_text:string; audit:Readonly<OpenDartHttpAudit>}> | null = null;
  async function send(input: unknown): Promise<unknown> {
    if (attempted) return fail('already_attempted'); attempted = true;
    const request = requestSnapshot(input);
    const deadline = monotonicNow() + BigInt(timeout as number) * 1_000_000n;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    let key: unknown, url: URL | undefined;
    const active = () => { if (controller.signal.aborted || monotonicNow() >= deadline) { controller.abort(); fail('request_timeout'); } };
    const timeoutPromise = new Promise<never>((_,reject) => { timer=setTimeout(() => { controller.abort(); reject(new SafeOpenDartHttpError('request_timeout')); },timeout as number); });
    const allowed = async () => { active(); let ok: unknown; try { ok = await authorize(request); } catch { active(); return fail('authorization_denied'); } active(); if (ok !== true) return fail('authorization_denied'); };
    const work = async () => {
      await allowed(); active();
      try { key = await readKey(); } catch { active(); return fail('credential_unavailable'); }
      active();
      // Exact opaque ASCII token, not a discovery, storage or credential-issuance path.
      if (typeof key !== 'string' || key.length < 16 || key.length > 200 || !full(/[A-Za-z0-9_-]+/,key)) return fail('credential_unavailable');
      await allowed(); active();
      url = new URL(request.endpoint); url.searchParams.set('crtfc_key',key as string);
      for (const [k,v] of Object.entries(request.params)) url.searchParams.set(k,String(v));
      const expectedHref=url.href;
      const init:RequestInit=Object.freeze({method:'GET',redirect:'error',signal:controller.signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',headers:Object.freeze({accept:'application/json'})});
      let response: Response;
      active();
      try { response = await fetcher(expectedHref,init); } catch { active(); return fail('transport_failed'); }
      try {
        active();
        if (response.redirected || response.status >= 300 && response.status < 400) return fail('redirect_rejected');
        if (response.status === 401 || response.status === 403) return fail('credential_rejected');
        if (response.status === 429) return fail('rate_limited');
        if (response.status !== 200) return fail('http_rejected');
        const responseUrl=response.url; active();
        if (typeof responseUrl !== 'string' || responseUrl.length > 2048 || (responseUrl !== '' && responseUrl !== expectedHref) || (origin === 'actual' && responseUrl === '')) return fail('invalid_response');
        const length = response.headers.get('content-length'); active(); if (length !== null && (length.length > 8 || !full(/[0-9]+/,length) || Number(length) > 300000)) return fail('response_too_large');
        if (!response.body) return fail('invalid_response');
        const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8',{fatal:true}); let bytes=0,text='',reads=0;
        const cancel = () => { try { void reader.cancel().catch(() => undefined); } catch { /* Trusted adapter cancellation detail is never exposed. */ } };
        controller.signal.addEventListener('abort',cancel,{once:true});
        try {
          while (true) { active(); if(++reads>4096) return fail('invalid_response'); const chunk=await reader.read(); active(); if (chunk.done) break; if(chunk.value.byteLength===0) return fail('invalid_response'); bytes+=chunk.value.byteLength; if (bytes>300000) return fail('response_too_large'); text+=decoder.decode(chunk.value,{stream:true}); }
          text+=decoder.decode();
        } finally { controller.signal.removeEventListener('abort',cancel); cancel(); }
        active();
        if (text.length>300000 || Buffer.byteLength(text,'utf8')>300000) return fail('response_too_large');
        const payload=decode(text); rejectReflectedKey(payload,key as string); strictFieldLexemes(payload); active();
        let received: unknown; try { received=clock(); } catch { active(); return fail('invalid_clock'); } active();
        if (typeof received !== 'string' || received.length > 40 || !ExactInstantSchema.safeParse(received).success) return fail('invalid_clock');
        if (request.operation === 'opendart.full_statement') parseOpenDartFullStatement(request.params,payload,{origin,received_at:received});
        else parseOpenDartFilings(request.params,payload,{origin,received_at:received});
        active(); const frozenPayload=deepFreeze(payload); active();
        const auditCandidate=Object.freeze({operation:request.operation,source_endpoint:request.endpoint,response_status:200,received_at:received as string,decoded_body_bytes:Buffer.byteLength(text,'utf8'),decoded_body_sha256:createHash('sha256').update(text,'utf8').digest('hex'),hash_scope:'decoded_response_text_utf8',origin,source_assurance:'injected_host_transport_attestation_only',source_authenticated:false,rights_status:'pending',canonical_promotion:false,request_attempts:1} as const);
        active(); await allowed(); active();
        audit=auditCandidate; privateCapture=Object.freeze({body_text:text,audit});
        return frozenPayload;
      } catch (error) { try { void response.body?.cancel().catch(() => undefined); } catch { /* No upstream detail escapes. */ } if (error !== null && typeof error === 'object' && errorCodes.has(error)) throw new SafeOpenDartHttpError(errorCodes.get(error)!); return fail('invalid_response'); }
    };
    try { return await Promise.race([work(),timeoutPromise]); }
    finally { if (timer !== undefined) clearTimeout(timer); key=undefined; try { url?.searchParams.delete('crtfc_key'); } catch { /* Best-effort cleanup must never replace the sanitized outcome. */ } }
  }
  return Object.freeze({origin,send,readAudit:()=>audit,readPrivateCapture:()=>privateCapture});
}

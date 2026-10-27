import { types } from 'node:util';
import { createHash } from 'node:crypto';
import { boundedBody, GlobalMarketError } from './global-market-data.js';

// Conservative secret/account marker filter only, never proof of publicness or permission.
const privateKey = /^(?:authorization|proxy_authorization|cookie|set_cookie|appkey|appsecret|api_?key|access_?token|refresh_?token|id_?token|token|client_?secret|password|passwd|private_?key|secret|cano|acnt_prdt_cd|account_?(?:no|number|id)|bank_?account|card_?(?:no|number)|credential)s?$/i;
function privateText(text: string): boolean {
  const forbidden = /(?:\bbearer\s+\S+|\bbasic\s+[A-Za-z0-9+/=]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/]+:[^\s/]+@|(?:^|[?&\s])(?:access_token|refresh_token|api[_-]?key|appkey|appsecret|client_secret|password|token|authorization|cano|account_number)\s*[:=]\s*[^\s&]+)/i;
  if (forbidden.test(text)) return true;
  // Catch ordinary URL-escaped markers without evaluating or following any URL.
  if (/%[0-9a-f]{2}/i.test(text)) {
    try { if (forbidden.test(decodeURIComponent(text))) return true; } catch { /* Keep non-URL raw text. */ }
  }
  return false;
}
/** Descriptor-only inert snapshot before validation; no Proxy/accessor/toJSON evaluation. */
export function snapshotMarketJson(value: unknown, maxBytes = 500_000, maxNodes = 20_000, maxKeys = 1000): unknown {
  let nodes = 0, bytes = 0;
  const seen = new Set<object>();
  function copy(v: unknown, depth: number): unknown {
    if (++nodes > maxNodes || depth > 8) throw new GlobalMarketError('response_too_large');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0)) return v;
    if (typeof v === 'string') {
      if (v.length > maxBytes - bytes) throw new GlobalMarketError('response_too_large');
      bytes += Buffer.byteLength(v, 'utf8');
      if (bytes > maxBytes) throw new GlobalMarketError('response_too_large');
      if (privateText(v)) throw new GlobalMarketError('schema_drift');
      return v;
    }
    if (typeof v !== 'object' || types.isProxy(v) || seen.has(v)) throw new GlobalMarketError('schema_drift');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype && proto !== null : proto !== Object.prototype && proto !== null) throw new GlobalMarketError('schema_drift');
    const length: unknown = array ? Object.getOwnPropertyDescriptor(v, 'length')?.value : null;
    if (array && (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0)) throw new GlobalMarketError('schema_drift');
    if (array && (length as number) > maxKeys) throw new GlobalMarketError('response_too_large');
    const keys = Reflect.ownKeys(v);
    if (keys.length > maxKeys) throw new GlobalMarketError('response_too_large');
    if (array && keys.length !== (length as number) + 1) throw new GlobalMarketError('schema_drift');
    const out: Record<string, unknown> | unknown[] = array ? [] : Object.create(null) as Record<string, unknown>;
    seen.add(v);
    for (const key of keys) {
      if (typeof key !== 'string') throw new GlobalMarketError('schema_drift');
      if (key.length > maxBytes - bytes) throw new GlobalMarketError('response_too_large');
      bytes += Buffer.byteLength(key, 'utf8');
      if (bytes > maxBytes) throw new GlobalMarketError('response_too_large');
      if (['__proto__', 'prototype', 'constructor'].includes(key) || privateKey.test(key.replaceAll('-', '_')) || privateText(key)) throw new GlobalMarketError('schema_drift');
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !('value' in d)) throw new GlobalMarketError('schema_drift');
      if (array && key === 'length') continue;
      if (!d.enumerable || (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= (length as number)))) throw new GlobalMarketError('schema_drift');
      Object.defineProperty(out, key, { value: copy(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    seen.delete(v); return out;
  }
  return boundedBody(copy(value, 0), { maxBytes, maxNodes, maxKeys });
}
export function marketCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(marketCanonicalJson).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map(key => `${JSON.stringify(key)}:${marketCanonicalJson(o[key])}`).join(',')}}`;
}
export function marketDigest(value: unknown): string {
  return createHash('sha256').update(marketCanonicalJson(value), 'utf8').digest('hex');
}
export type MarketReadonly<T> = T extends object ? { readonly [K in keyof T]: MarketReadonly<T[K]> } : T;
export function freezeMarket<T>(value: T): MarketReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeMarket(child);
    Object.freeze(value);
  }
  return value as MarketReadonly<T>;
}

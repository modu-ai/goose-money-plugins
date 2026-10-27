// t28 D1-PROTO-WALK-CODE: openDartTransportError must trust a HTTP-layer error only by what the error itself owns.
// A genuine SafeOpenDartHttpError keeps `name` and `code` as own data properties on a native, non-Proxy error. A
// forged object (name/code planted on a prototype, a Proxy, an accessor) must stay transport_error and must not run
// any code it controls. Synthetic only; nothing here reaches a network or a credential.
import assert from 'node:assert/strict';
import test from 'node:test';
import {openDartTransportError} from '../src/opendart.js';
import {OPENDART_HTTP_ERRORS,SafeOpenDartHttpError} from '../src/opendart-http.js';

const MAPPED:Record<string,string>={
  credential_unavailable:'credential_missing',credential_rejected:'credential_rejected',rate_limited:'rate_limited',
  http_rejected:'upstream_rejected',transport_failed:'upstream_unavailable',request_timeout:'upstream_timeout',invalid_response:'invalid_response',
};

test('control: every genuine HTTP-layer error code maps to its vocabulary code; the rest stay transport_error',()=>{
  for(const code of OPENDART_HTTP_ERRORS){
    assert.equal(openDartTransportError(new SafeOpenDartHttpError(code)).code,MAPPED[code]??'transport_error',code);
  }
  assert.equal(openDartTransportError(new Error('plain')).code,'transport_error');
  assert.equal(openDartTransportError('SafeOpenDartHttpError').code,'transport_error');
  assert.equal(openDartTransportError(null).code,'transport_error');
});

test('forged: name and code planted on a prototype link are not trusted',()=>{
  const planted=Object.create(Error.prototype,{name:{value:'SafeOpenDartHttpError'},code:{value:'credential_rejected'}});
  assert.equal(openDartTransportError(Object.create(planted)).code,'transport_error','one link below the planted data');
  assert.equal(openDartTransportError(planted).code,'transport_error','planted object itself is not a native error');
  let deep:object=planted;for(let i=0;i<7;i+=1)deep=Object.create(deep);
  assert.equal(openDartTransportError(deep).code,'transport_error','seven links below');
  class Forged extends Error{}
  Object.defineProperty(Forged.prototype,'name',{value:'SafeOpenDartHttpError'});
  Object.defineProperty(Forged.prototype,'code',{value:'credential_rejected'});
  assert.equal(openDartTransportError(new Forged('x')).code,'transport_error','class prototype carries both');
});

test('forged: genuine own name but code only on the prototype is not trusted',()=>{
  const error=new SafeOpenDartHttpError('credential_rejected');
  delete (error as {code?:string}).code;
  Object.setPrototypeOf(error,Object.create(SafeOpenDartHttpError.prototype,{code:{value:'credential_rejected'}}));
  assert.equal(openDartTransportError(error).code,'transport_error');
});

test('forged: a Proxy is never trusted, whatever its traps return, and no trap runs',()=>{
  let trapCalls=0;
  const lying=new Proxy(new Error('x'),{get(_t,key){trapCalls+=1;return key==='name'?'SafeOpenDartHttpError':key==='code'?'credential_rejected':undefined;}});
  assert.equal(openDartTransportError(lying).code,'transport_error');
  const overGenuine=new Proxy(new SafeOpenDartHttpError('credential_rejected'),{get(target,key,receiver){trapCalls+=1;return Reflect.get(target,key,receiver);}});
  assert.equal(openDartTransportError(overGenuine).code,'transport_error');
  assert.equal(openDartTransportError(new Proxy(new SafeOpenDartHttpError('credential_rejected'),{})).code,'transport_error','pass-through Proxy');
  assert.equal(trapCalls,0,'a Proxy trap ran');
});

test('forged: accessor properties are never invoked and never trusted',()=>{
  let calls=0;
  const error=new Error('x');
  Object.defineProperty(error,'name',{get(){calls+=1;return 'SafeOpenDartHttpError';}});
  Object.defineProperty(error,'code',{get(){calls+=1;return 'credential_rejected';}});
  assert.equal(openDartTransportError(error).code,'transport_error');
  const genuineWithAccessorCode=new SafeOpenDartHttpError('credential_rejected');
  Object.defineProperty(genuineWithAccessorCode,'code',{get(){calls+=1;return 'credential_rejected';}});
  assert.equal(openDartTransportError(genuineWithAccessorCode).code,'transport_error');
  assert.equal(calls,0);
});

// SPEC-ATP-ERR-001 AC-ERR-002 and AC-ERR-003 (card t17, M1 test-first), measured at the TOOL RESULT surface.
//
//   AC-ERR-002  K3 tools (get_instrument_profile, get_market_headlines, get_market_flows) x 23 injections: the partial
//               key set (F2) answers credential_environment_invalid, a token 401/403 (F3) answers credential_rejected,
//               and every other cell keeps the code SPEC-ATP-AUTH-002 asserts for K3 (t14 INJECTIONS; leader decision
//               Q5 (a): the seven F6 cells stay upstream_unavailable) or, where t14 asserts none, the transport code.
//   AC-ERR-003  the two directory tools (search_instruments, resolve_instrument) x the master-file host failures:
//               timeouts (real DOMException and a fired AbortSignal.timeout, plus forged look-alikes), 429, other
//               non-200, no body, oversize (also when cancelling the body then rejects), invalid archive/member, and a
//               master with no equity or ETF row.
//
// Synthetic only: an injected fetchImpl routes by host, timeouts are in-process objects, no network.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { KIS_KOSDAQ_MASTER_TAIL_FIELDS, KIS_KOSPI_MASTER_TAIL_FIELDS } from '../src/kis-instrument-master.js';
import {
  DIRECTORY_TOOLS, K3_TOOLS, KIS_IDS, REFERENCE_CODE, boundedCase, injection, nothingEscaped, requestsFor,
  readFetchRecords, resetFetchRecords, restoreOriginalFetch, sc,
} from './err001-support.js';

after(() => restoreOriginalFetch());
const begin = (): void => { resetFetchRecords(); assert.equal(readFetchRecords().length, 0); };

// ---- AC-ERR-002 ---------------------------------------------------------------------------------------------------

for (const id of KIS_IDS) {
  const inj = injection(id);
  const expected = inj.expect.K3 ?? REFERENCE_CODE[id]!;
  const group = id === 'kis-env-partial' ? '002a' : id === 'token-401' || id === 'token-403' ? '002b' : '002c';
  for (const tool of K3_TOOLS) {
    test(`AC-ERR-${group} ${tool} ${id} [${inj.cls}] -> ${expected}`, async () => {
      begin();
      const result = await boundedCase(tool, inj.setup, `${tool} ${id}`);
      assert.equal(result.code, expected, `${inj.text}: ${tool} answered ${result.code}`);
      assert.equal(result.isError, true, 'a provider failure is a tool error');
      assert.equal(sc.classOf('kis', result.code), inj.cls, `kis:${result.code} belongs to ${inj.cls}`);
      assert.deepEqual({ token: result.traffic.token.length, data: result.traffic.data.length }, requestsFor(id), 'one attempt per endpoint, no retry');
      nothingEscaped(result.traffic);
    });
  }
}

test('AC-ERR-002 size: 3 K3 tools x 23 injections, the two new codes only for kis-env-partial, token-401 and token-403', () => {
  assert.equal(K3_TOOLS.length * KIS_IDS.length, 69);
  const newCodeCells = KIS_IDS.filter((id) => (injection(id).expect.K3 ?? REFERENCE_CODE[id]) === 'credential_environment_invalid' || (injection(id).expect.K3 ?? REFERENCE_CODE[id]) === 'credential_rejected');
  assert.deepEqual(newCodeCells, ['kis-env-partial', 'token-401', 'token-403']);
  // Leader decision Q5 (a): seven F6 cells stay upstream_unavailable, as t14 asserts. Six of them differ from the transport code;
  // the seventh, data-cancel-fetch, already is upstream_unavailable in the transport layer (accepted debt R1).
  const differing = KIS_IDS.filter((id) => (injection(id).expect.K3 ?? REFERENCE_CODE[id]) !== REFERENCE_CODE[id]);
  assert.deepEqual(differing, ['token-500', 'data-500', 'data-timeout-fetch', 'token-cancel', 'data-cancel-body', 'data-too-large']);
  for (const id of [...differing, 'data-cancel-fetch']) assert.equal(injection(id).expect.K3, 'upstream_unavailable', id);
  assert.equal(REFERENCE_CODE['data-cancel-fetch'], 'upstream_unavailable');
});

// ---- AC-ERR-003 ---------------------------------------------------------------------------------------------------

/** One single-member ZIP named like the requested master file, holding `body`. */
function zip(name: string, body: Buffer): Buffer {
  const n = Buffer.from(name); const crc = crc32(body);
  const local = Buffer.alloc(30); const central = Buffer.alloc(46); const end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(n.length, 26);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(n.length, 28);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length + body.length, 16);
  return Buffer.concat([local, n, body, central, n, end]);
}
const zipped = (body: string) => (url: URL): Response => new Response(new Uint8Array(zip(url.pathname.split('/').pop()!.replace(/\.zip$/, ''), Buffer.from(body))), { status: 200 });

/** A fixed-width KOSPI/KOSDAQ master row (same layout as kis-master-http.test.ts); `group`/`etp` decide the asset class. */
function masterRow(board: 'kospi' | 'kosdaq', symbol: string, isin: string, group: string, etp: string): string {
  const values: Record<string, string> = { scrt_grp_cls_code: group, etp_prod_cls_code: etp, stck_lstn_date: '20261001' };
  const specs = board === 'kospi' ? KIS_KOSPI_MASTER_TAIL_FIELDS : KIS_KOSDAQ_MASTER_TAIL_FIELDS;
  return symbol.padEnd(9) + isin + 'SYNTHETIC NAME' + specs.map(([key, width]) => (values[key] ?? '').padEnd(width)).join('') + '\n';
}

const failingBody = (make: () => unknown | Promise<unknown>): sc.Handler => () => new Response(new ReadableStream({ async pull(controller) { controller.error(await make()); } }), { status: 200 });
/**
 * A body over the loader's 5,000,000-byte limit. `cancelFails` makes an endless source whose cancel callback throws: the stream stays
 * open (a source that already closed is never asked to cancel, so a closed one would test nothing), so the loader's own
 * `reader.cancel()` reaches the callback and rejects. `cancelCalls` counts how often the callback ran.
 */
let cancelCalls = 0;
const oversize = (cancelFails: boolean): sc.Handler => () => {
  let pulls = 0;
  return new Response(new ReadableStream({
    pull(controller) { pulls += 1; if (!cancelFails && pulls > 6) controller.close(); else controller.enqueue(new Uint8Array(1_000_000)); },
    cancel() { cancelCalls += 1; if (cancelFails) throw new Error('synthetic_cancel_rejected'); },
  }), { status: 200 });
};
/** A fired AbortSignal.timeout: its `reason` is the real platform timeout object. */
async function firedTimeoutReason(): Promise<unknown> {
  const signal = AbortSignal.timeout(1);
  await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
  return signal.reason;
}
const forgedDomExceptionPrototype = (): unknown => { const o = Object.create(DOMException.prototype); Object.defineProperty(o, 'name', { value: 'TimeoutError' }); return o; };

interface DirectoryCase { id: string; group: string; target: string; handler: sc.Handler }
const DIRECTORY_CASES: readonly DirectoryCase[] = [
  { id: 'fetch-rejects-error', group: '003a', target: 'upstream_unavailable', handler: sc.rejectsWith('Error') },
  { id: 'fetch-rejects-real-DOMException-TimeoutError', group: '003b', target: 'upstream_timeout', handler: () => { throw new DOMException('synthetic', 'TimeoutError'); } },
  { id: 'fetch-rejects-fired-AbortSignal.timeout-reason', group: '003c', target: 'upstream_timeout', handler: async () => { throw await firedTimeoutReason(); } },
  { id: 'body-read-fails-real-DOMException-TimeoutError', group: '003d', target: 'upstream_timeout', handler: failingBody(() => new DOMException('synthetic', 'TimeoutError')) },
  { id: 'body-read-fails-fired-AbortSignal.timeout-reason', group: '003e', target: 'upstream_timeout', handler: failingBody(firedTimeoutReason) },
  { id: 'fetch-rejects-forged-own-name-TimeoutError', group: '003f', target: 'upstream_unavailable', handler: sc.rejectsWith('TimeoutError') },
  { id: 'body-read-fails-forged-own-name-TimeoutError', group: '003g', target: 'upstream_unavailable', handler: sc.bodyErrorsWith('TimeoutError') },
  { id: 'fetch-rejects-forged-DOMException-prototype', group: '003h', target: 'upstream_unavailable', handler: () => { throw forgedDomExceptionPrototype(); } },
  { id: 'fetch-rejects-proxy-around-real-TimeoutError', group: '003i', target: 'upstream_unavailable', handler: () => { throw new Proxy(new DOMException('synthetic', 'TimeoutError'), {}); } },
  { id: 'http-429', group: '003j', target: 'rate_limited', handler: sc.httpStatus(429) },
  { id: 'http-401', group: '003k', target: 'upstream_rejected', handler: sc.httpStatus(401) },
  { id: 'http-403', group: '003l', target: 'upstream_rejected', handler: sc.httpStatus(403) },
  { id: 'http-500', group: '003m', target: 'upstream_rejected', handler: sc.httpStatus(500) },
  { id: 'http-200-without-body', group: '003n', target: 'upstream_rejected', handler: () => new Response(null, { status: 200 }) },
  { id: 'body-over-5000000-bytes', group: '003o', target: 'response_too_large', handler: oversize(false) },
  { id: 'body-over-5000000-bytes-and-cancel-rejects', group: '003o2', target: 'response_too_large', handler: oversize(true) },
  { id: 'archive-not-a-zip', group: '003p', target: 'schema_drift', handler: () => new Response('not a zip archive', { status: 200 }) },
  { id: 'archive-member-unparseable', group: '003q', target: 'schema_drift', handler: zipped('synthetic garbage line\n') },
  { id: 'archive-member-empty', group: '003r', target: 'schema_drift', handler: zipped('') },
  // A master that is well formed but holds no equity or ETF row (only ETN rows): the loader's "no entries" branch.
  { id: 'master-without-equity-or-etf-rows', group: '003s', target: 'schema_drift', handler: (url) => {
    const board = url.pathname.includes('kosdaq') ? 'kosdaq' : 'kospi';
    return zipped(masterRow(board, '580001', 'KR7580001001', 'EN', '3'))(url);
  } },
];

for (const c of DIRECTORY_CASES) {
  for (const tool of DIRECTORY_TOOLS) {
    test(`AC-ERR-${c.group} ${tool} ${c.id} -> ${c.target}`, async () => {
      begin();
      cancelCalls = 0;
      const result = await boundedCase(tool, { home: 'both', overrides: { master: c.handler } }, `${tool} ${c.id}`);
      assert.equal(result.code, c.target, `${tool} answered ${result.code}`);
      if (c.group === '003o2') assert.ok(cancelCalls >= 1, 'the loader cancelled the open body, so the rejected cancel was exercised');
      assert.equal(result.isError, true, 'a provider failure is a tool error');
      assert.deepEqual([result.traffic.token.length, result.traffic.data.length, result.traffic.dart.length], [0, 0, 0], 'the directory host needs no key and no KIS/OpenDART request');
      assert.ok(result.traffic.master.length >= 1, 'the master host was asked');
      nothingEscaped(result.traffic, { master: true });
    });
  }
}

test('AC-ERR-003 size: 20 master-host cases x 2 directory tools = 40 cells, 2 of them the cases the probe did not build', () => {
  assert.equal(DIRECTORY_CASES.length, 20);
  assert.equal(DIRECTORY_CASES.length * DIRECTORY_TOOLS.length, 40);
  assert.deepEqual(DIRECTORY_CASES.filter((c) => c.group === '003o2' || c.group === '003s').map((c) => c.id), ['body-over-5000000-bytes-and-cancel-rejects', 'master-without-equity-or-etf-rows']);
});

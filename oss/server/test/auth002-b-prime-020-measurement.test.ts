// SPEC-ATP-AUTH-002 B-prime measurement (card t14), AC-002k. Observation of the baseline tree: it
// records the tool-result shape the stub-free default server returns when OpenDART answers HTTP 200
// with provider status "020", for both OpenDART tool paths (opendart.ts and opendart-filings.ts).
// It adds no behaviour and edits no existing file. Every request goes through an injected synthetic
// fetchImpl; the global fetch recorder is installed first, so a request that bypasses the injected
// fetch is recorded and rejected. No real key, no real HOME, no real network.
//
// The default server builds its OpenDART transport with origin "actual", which refuses a response
// whose `url` is empty (opendart-http.ts:176). A real fetch response carries the final request URL,
// so the synthetic response below sets `url` to the requested URL the same way opendart-http.test.ts
// does. The controls print what the same server answers without that, as observations only.
//
// Observations are printed BEFORE any assertion runs, so a result that differs from the SPEC's
// expectation is still recorded verbatim.
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test, { after } from 'node:test';

const recorder = await import('./fetch-recorder.js');
const harness = await import('./default-server-harness.js');
after(() => recorder.restoreOriginalFetch());

const PATHS = [
  { tool: 'get_fundamentals', module: 'opendart.ts', pathname: '/api/fnlttSinglAcntAll.json' },
  { tool: 'get_public_filings', module: 'opendart-filings.ts', pathname: '/api/list.json' },
] as const;

interface Variant { label: string; providerStatus: '013' | '020'; responseUrl: 'requested-url' | 'empty' }

/** Calls both OpenDART tools once on a fresh default server and returns one observation line per tool. */
async function observe(variant: Variant) {
  recorder.resetFetchRecords();
  const requested: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requested.push(raw);
    if (new URL(raw).hostname !== 'opendart.fss.or.kr') throw new Error('b_prime_020_only_opendart_is_expected');
    const response = new Response(JSON.stringify({ status: variant.providerStatus, message: 'synthetic provider message' }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (variant.responseUrl === 'requested-url') Object.defineProperty(response, 'url', { value: raw });
    return response;
  };
  const home = await harness.makeSyntheticHome();
  const session = await harness.openSession(harness.createDefaultServer({ homeDir: home, fetchImpl, switchesOn: true }));
  const rows: { tool: string; reply: any; pathnames: string[]; line: string }[] = [];
  try {
    for (const path of PATHS) {
      const before = requested.length;
      const reply = await session.rpc('tools/call', { name: path.tool, arguments: harness.toolArguments[path.tool] });
      const result = reply.result;
      const structured = result?.structuredContent;
      const pathnames = requested.slice(before).map((raw) => new URL(raw).pathname);
      rows.push({
        tool: path.tool, reply, pathnames,
        line: [
          `${variant.label} ${path.tool} (${path.module})`,
          `protocol_error=${reply.error ? 'yes' : 'no'}`,
          `isError=${result !== undefined && 'isError' in result ? `present:${String(result.isError)}` : 'absent'}`,
          `status=${String(structured?.status)}`,
          `provider_status=${String(structured?.provider_status)}`,
          `error_code=${structured && 'error_code' in structured ? String(structured.error_code) : 'absent'}`,
          `rows=${Array.isArray(structured?.rows) ? structured.rows.length : 'n/a'}`,
          `structured_keys=${Object.keys(structured ?? {}).join(',') || 'none'}`,
          `content_text=${JSON.stringify(String(result?.content?.[0]?.text ?? '').slice(0, 120))}`,
          `opendart_request_pathnames=${pathnames.join(',')}`,
          `outcome=${harness.outcome(reply)}`,
        ].join(' | '),
      });
    }
    return { rows, requested, globalFetchRecords: recorder.readFetchRecords().length };
  } finally {
    await session.close();
    await rm(home, { recursive: true });
  }
}

test('B-prime AC-002k: HTTP 200 with OpenDART status 020 returns a result without isError whose status is rate_limited (both paths)', async () => {
  const seen = await observe({ label: 'B2_AC002K', providerStatus: '020', responseUrl: 'requested-url' });
  process.stdout.write(`B2_AC002K_BEGIN opendart_http=200 provider_status=020 response_url=requested-url\n${seen.rows.map((row) => row.line).join('\n')}\nB2_AC002K_END injected_requests=${seen.requested.length} global_fetch_records=${seen.globalFetchRecords}\n`);
  for (const [index, path] of PATHS.entries()) {
    const { reply, pathnames } = seen.rows[index]!;
    const structured = reply.result?.structuredContent;
    assert.equal(reply.error, undefined, `${path.tool}: no protocol error`);
    assert.ok(!reply.result?.isError, `${path.tool}: the 020 answer is not a tool error`);
    assert.equal(structured?.status, 'rate_limited', `${path.tool}: status`);
    assert.equal(structured?.provider_status, '020', `${path.tool}: provider_status`);
    assert.deepEqual(pathnames, [path.pathname], `${path.tool}: exactly one OpenDART request on the expected endpoint`);
  }
  assert.deepEqual(harness.offAllowlist(seen.requested), []);
  assert.equal(seen.globalFetchRecords, 0);
});

test('B-prime AC-002k controls (observation only, no outcome assertion): how the same default server answers 013 and 020 when the synthetic response carries no url', async () => {
  const lines: string[] = [];
  for (const variant of [
    { label: 'B2_AC002K_CONTROL[013,requested-url]', providerStatus: '013', responseUrl: 'requested-url' },
    { label: 'B2_AC002K_CONTROL[013,empty-url]', providerStatus: '013', responseUrl: 'empty' },
    { label: 'B2_AC002K_CONTROL[020,empty-url]', providerStatus: '020', responseUrl: 'empty' },
  ] as const) {
    const seen = await observe(variant);
    lines.push(...seen.rows.map((row) => row.line));
    // Not vacuous: each tool sent exactly one request, and nothing reached the global fetch.
    for (const row of seen.rows) assert.equal(row.pathnames.length, 1, `${row.tool}: one OpenDART request`);
    assert.equal(seen.globalFetchRecords, 0);
  }
  process.stdout.write(`B2_AC002K_CONTROL_BEGIN\n${lines.join('\n')}\nB2_AC002K_CONTROL_END\n`);
});

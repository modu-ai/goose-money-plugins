// SPEC-ATP-ERR-001 AC-ERR-001 (card t17, M1 test-first): the 17 KIS expanded-transport consumer tools return the
// exact code the transport throws, at the TOOL RESULT surface, for each of 23 injected KIS failures.
//
// Target per cell: REFERENCE_CODE[injection], which is what the K4 tools (market-risk-data.ts, no catch) return for
// the same injection; the first test block proves that table against the K4 tools so it is measured, not assumed.
// Four cells are not judged: the raw-text transports (4 tools) hand the body to the module, which parses it after
// send, so a non-JSON data body never reaches the catch (spec.md section 4). The count test pins 387 judged / 4 skipped.
//
// Synthetic only: keys in a mkdtemp home, an injected fetchImpl, in-process timeout objects, no network.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RAW_TEXT_TOOLS, REFERENCE_CODE, KIS_IDS, K4_TOOLS, TOOLS_17, boundedCase, injection, nothingEscaped, requestsFor,
  readFetchRecords, resetFetchRecords, restoreOriginalFetch, sc,
} from './err001-support.js';

after(() => restoreOriginalFetch());
const begin = (): void => { resetFetchRecords(); assert.equal(readFetchRecords().length, 0); };

// ---- the reference table, measured on the K4 tools --------------------------------------------------------------

for (const id of KIS_IDS) {
  test(`AC-ERR-001 reference ${id}: the three K4 tools return ${REFERENCE_CODE[id]}`, async () => {
    const inj = injection(id);
    for (const tool of K4_TOOLS) {
      begin();
      const result = await boundedCase(tool, inj.setup, `${tool} ${id}`);
      assert.equal(result.code, REFERENCE_CODE[id], `${tool}: ${inj.text}`);
      nothingEscaped(result.traffic);
    }
  });
}

// ---- the 17 consumer tools x 23 injections ----------------------------------------------------------------------

let judged = 0;
const skipped: string[] = [];
for (const id of KIS_IDS) {
  const inj = injection(id);
  const expected = REFERENCE_CODE[id]!;
  for (const tool of TOOLS_17) {
    if (id === 'data-schema' && RAW_TEXT_TOOLS.has(tool)) { skipped.push(`${tool} ${id}`); continue; }
    judged += 1;
    test(`AC-ERR-001 ${tool} ${id} [${inj.cls}] -> ${expected}`, async () => {
      begin();
      const result = await boundedCase(tool, inj.setup, `${tool} ${id}`);
      assert.equal(result.code, expected, `${inj.text}: ${tool} answered ${result.code}`);
      assert.equal(result.isError, true, 'a provider failure is a tool error');
      assert.equal(sc.classOf('kis', result.code), inj.cls, `kis:${result.code} belongs to ${inj.cls}`);
      const want = requestsFor(id);
      assert.deepEqual({ token: result.traffic.token.length, data: result.traffic.data.length }, want, 'one attempt per endpoint, no retry');
      nothingEscaped(result.traffic);
    });
  }
}

test('AC-ERR-001 size: 17 tools, 23 injections, 387 judged cells and exactly 4 skipped raw-text data-schema cells', () => {
  assert.equal(TOOLS_17.length, 17);
  assert.equal(KIS_IDS.length, 23);
  assert.equal(judged, 387);
  assert.deepEqual(skipped, [
    'get_global_index_history data-schema', 'get_global_index_period_history data-schema',
    'get_market_industry_investor_aggregates data-schema', 'get_overseas_ice_actions data-schema',
  ]);
});

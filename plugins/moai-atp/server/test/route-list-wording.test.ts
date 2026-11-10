// Issue #3: the report route list in tool descriptions comes from one place, the code enum.
// The build_report_input description is generated from ACTIVE_REPORT_ROUTE_IDS, and no tool
// description may name a route range outside the active routes.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as pipeline from '../src/report-pipeline.js';
import {createStockMcpServer} from './synthetic-member-access.js';
import {openSession} from './default-server-harness.js';

const {ACTIVE_REPORT_ROUTE_IDS} = pipeline;
const formatRouteList = (pipeline as Record<string, unknown>).formatRouteList as ((ids: readonly string[]) => string) | undefined;

/** Expand 'R01–R03, R05, U01' style text into ids (en dash, hyphen or tilde ranges). */
function expandRanges(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(/\b([RU])(\d{2})(?:\s*[–~-]\s*\1?(\d{2}))?\b/g)) {
    const prefix = m[1]!, from = Number(m[2]), to = m[3] === undefined ? from : Number(m[3]);
    for (let n = from; n <= to; n++) ids.push(prefix + String(n).padStart(2, '0'));
  }
  return ids;
}

async function toolDescriptions(): Promise<Map<string, string>> {
  const session = await openSession(createStockMcpServer());
  try {
    const listed = await session.rpc('tools/list', {});
    return new Map(listed.result.tools.map((tool: {name: string; description?: string}) => [tool.name, tool.description ?? '']));
  } finally { await session.close(); }
}

test('formatRouteList collapses consecutive ids of the same prefix into en-dash ranges', () => {
  assert.equal(typeof formatRouteList, 'function', 'report-pipeline exports formatRouteList');
  assert.equal(formatRouteList!(['R01', 'R02', 'R03', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10', 'R11', 'R12', 'U01']), 'R01–R03, R05–R12, U01');
  assert.equal(formatRouteList!(['R01']), 'R01');
  assert.equal(formatRouteList!(['R01', 'R02']), 'R01–R02');
  assert.equal(formatRouteList!(['R12', 'R13', 'U01', 'U02', 'U03']), 'R12–R13, U01–U03');
  assert.equal(formatRouteList!(['R01', 'R03', 'R05']), 'R01, R03, R05');
});

test('formatRouteList output expands back to exactly the active routes', () => {
  assert.equal(typeof formatRouteList, 'function');
  assert.deepEqual(expandRanges(formatRouteList!(ACTIVE_REPORT_ROUTE_IDS)), [...ACTIVE_REPORT_ROUTE_IDS]);
});

test('build_report_input description lists exactly the active routes, from the code enum', async () => {
  const description = (await toolDescriptions()).get('build_report_input') ?? '';
  assert.equal(typeof formatRouteList, 'function');
  assert.ok(description.startsWith(formatRouteList!(ACTIVE_REPORT_ROUTE_IDS) + ' 중 하나'), description.slice(0, 80));
});

test('no tool description names a route range outside the active routes', async () => {
  const active = new Set<string>(ACTIVE_REPORT_ROUTE_IDS);
  for (const [name, description] of await toolDescriptions()) {
    for (const m of description.matchAll(/\b[RU]\d{2}\s*[–~-]\s*[RU]?\d{2}\b/g)) {
      const outside = expandRanges(m[0]).filter(id => !active.has(id));
      assert.deepEqual(outside, [], `${name}: "${m[0]}" names routes outside ACTIVE_REPORT_ROUTE_IDS`);
    }
  }
});

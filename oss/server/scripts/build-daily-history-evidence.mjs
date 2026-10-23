/** Offline synthetic fixture builder only. Never imports a production verifier or transport. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assembleUsDailyCanonicalHistory, reverifyDailyHistoryHandoff, DailyHistoryBindingSchema, DailyHistoryHandoffEnvelopeSchema } from '../dist/src/daily-history-bridge.js';
import { dailyHistoryFixture, syntheticHistoryVerifier, VERIFIED } from '../dist/test/daily-history-bridge-fixtures.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = root + 'fixtures/history-bridge/';
mkdirSync(output, { recursive: true });
const write = (name, value) => writeFileSync(output + name, JSON.stringify(value, null, 2) + '\n');
const { source, binding, synthetic_body_bytes } = await dailyHistoryFixture();
writeFileSync(output + 'SYNTHETIC-source-body.json', synthetic_body_bytes);
write('SYNTHETIC-source.json', source); write('SYNTHETIC-binding.json', binding);
const handoff = await assembleUsDailyCanonicalHistory(source, binding, syntheticHistoryVerifier, () => VERIFIED);
write('SYNTHETIC-handoff.json', handoff);
// Exercise the actual persisted reconstruction path, not only the in-memory assembly API.
const fresh = await reverifyDailyHistoryHandoff(JSON.parse(readFileSync(output + 'SYNTHETIC-handoff.json', 'utf8')), syntheticHistoryVerifier, () => '2026-10-22T01:00:00.000000002Z');
write('SYNTHETIC-reverified-handoff.json', fresh);
const reportInput = {
  contract: 'canonical-history/1.0', cutoff: fresh.cutoff, request: fresh.request, histories: { subject: fresh.history },
  options: { sma_windows: [1, 2], volume_direction: { rule: 'neutral', evidence_ref: 'synthetic:neutral', disclosure: 'Invented neutral quantities only; no volume change or directional inference.' }, aggregation_windows: [] },
};
write('SYNTHETIC-report-input.json', reportInput);
const program = `import json,sys\nfrom jsonschema import Draft202012Validator\nsys.path.insert(0,'contracts/report-history-reference')\nfrom history_semantics import calculate_report\nx=json.load(sys.stdin)\nDraft202012Validator(json.load(open('contracts/report-history-reference/canonical-history.schema.json'))).validate(x)\nr=calculate_report(x)\nassert r['actual_source_authenticated'] is False and r['verified_live_provider_bindings']==0 and r['actual_provider_calls']==0\nassert r['results']['price_relative']['status']=='computed'\nassert r['results']['ohlcv']['status']=='computed'\nprint(json.dumps(r))`;
const py = spawnSync('python3', ['-B', '-c', program], { cwd: root, input: JSON.stringify(reportInput), encoding: 'utf8', maxBuffer: 3000000 });
if (py.status !== 0) throw new Error(`Pinned Python synthetic validation failed: ${py.stderr}`);
write('SYNTHETIC-report-result.json', JSON.parse(py.stdout));
for (const [name, schema] of [['binding', DailyHistoryBindingSchema], ['handoff-envelope', DailyHistoryHandoffEnvelopeSchema]]) {
  const structural = z.toJSONSchema(schema);
  structural.description = 'STRUCTURAL PROFILE ONLY. Runtime refinements, descriptor bounds, exact chronology, evidence linkage and fresh separately trusted verification are mandatory. Schema success never authenticates a source, authorizes rights or validates persisted success flags.';
  writeFileSync(root + 'contracts/report-history-reference/' + name + '.schema.json', JSON.stringify(structural, null, 2) + '\n');
}
const names = ['SYNTHETIC-source-body.json', 'SYNTHETIC-source.json', 'SYNTHETIC-binding.json', 'SYNTHETIC-handoff.json', 'SYNTHETIC-reverified-handoff.json', 'SYNTHETIC-report-input.json', 'SYNTHETIC-report-result.json'];
write('manifest.json', {
  notice: 'SYNTHETIC TEST ONLY. Invented evidence assertions and callback echo do not establish actual-source authentication.',
  actual_source_authenticated: false, verified_live_provider_bindings: 0, actual_provider_calls: 0,
  first_verified_at: VERIFIED, reverified_at: fresh.verification.verified_at,
  files: Object.fromEntries(names.map(n => [n, createHash('sha256').update(readFileSync(output + n)).digest('hex')])),
});
console.log(JSON.stringify({ generated: names.length, output: 'fixtures/history-bridge', actual_provider_calls: 0, actual_source_authenticated: false }));

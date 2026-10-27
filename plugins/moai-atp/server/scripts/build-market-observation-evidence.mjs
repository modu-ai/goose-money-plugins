/** Deterministic offline-only reproduction. Uses installed TypeScript, pinned Node and Python stdlib. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const root = fileURLToPath(new URL('../', import.meta.url));
const run = (cmd, args, options = {}) => { const p = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...options }); if (p.status !== 0) throw Error(p.stderr || p.stdout || 'offline command failed'); return p.stdout; };
run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
const b = await import('../dist/src/market-observation-bridge.js');
const f = await import('../dist/test/market-observation-fixtures.js');
const ref = root + 'contracts/report-market-observation-reference/';
const dir = root + 'fixtures/market-observation-bridge/'; mkdirSync(dir, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const write = (file, value) => writeFileSync(file, typeof value === 'string' ? value : json(value));
const pin = JSON.parse(readFileSync(ref + 'pin.json', 'utf8'));
for (const [name, digest] of Object.entries(pin.files)) if (hash(readFileSync(ref + name)) !== digest) throw Error('pinned runtime drift: ' + name);
const schemaPairs = [['selection-input', b.MarketObservationSelectionInputSchema], ['candidate', b.MarketObservationCandidateSchema], ['binding', b.MarketObservationBindingSchema], ['handoff-envelope', b.MarketObservationHandoffSchema]];
for (const [name, schema] of schemaPairs) {
  const structural = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any' });
  structural.$id = 'urn:moai:market-observation-bridge:' + name + ':v1';
  structural.description = 'STRUCTURAL PROFILE ONLY. JSON Schema does not execute original-byte reconstruction, source authenticity, identity, units, scale, exact chronology, session, quote-firmness, rights, trusted verification or persisted reconstruction. Call the runtime API with a separately trusted verifier; no production verifier is supplied.';
  write(ref + name + '.schema.json', structural);
}
const cases = [['us-change-with-percent', 'us_equity_change', true], ['us-change-without-percent', 'us_equity_change', false], ['kr-spread', 'kr_equity_spread', false]];
for (const [name, policy, include] of cases) {
  const folder = dir + name + '/'; mkdirSync(folder, { recursive: true });
  const x = await f.marketObservationFixture(policy, include), verifier = f.syntheticMarketVerifier(x);
  const h = await b.assembleMarketObservationReportInput(x.candidate, x.binding, verifier, () => f.VERIFIED);
  const fresh = await b.reverifyMarketObservationHandoff(f.clone(h), verifier, () => f.REVERIFIED);
  write(folder + 'SYNTHETIC-original-body.json', x.originalBytes); write(folder + 'SYNTHETIC-review-record.txt', x.reviewBytes);
  write(folder + 'SYNTHETIC-source-dto.json', x.candidate.source_dto);
  write(folder + 'SYNTHETIC-candidate.json', x.candidate); write(folder + 'SYNTHETIC-binding.json', x.binding);
  write(folder + 'SYNTHETIC-handoff.json', h); write(folder + 'SYNTHETIC-reverified-handoff.json', fresh);
  write(folder + 'SYNTHETIC-report-input.json', fresh.report_input);
  const result = JSON.parse(run('python3', ['-B', '-c', 'import json,sys;from market_metrics import calculate;print(json.dumps(calculate(json.load(sys.stdin))))'], { cwd: ref, input: JSON.stringify(fresh.report_input) }));
  write(folder + 'SYNTHETIC-report-result.json', result);
  if (result.results[0].status !== (name === 'us-change-without-percent' ? 'arithmetic_only' : 'conditional_supplied_metric')) throw Error('unexpected pinned report status');
}
const base = await f.marketObservationFixture(), bad = [];
for (const [name, change, error] of [
  ['missing-scale', x => delete x.binding.observations[0].scale, 'invalid_binding'],
  ['mismatched-session', x => x.binding.observations[1].observation_session_id = x.binding.context.session_id, 'reference_session_mismatch'],
  ['late-subnanosecond-availability', x => x.binding.observations[0].available_at = '2026-10-22T14:30:01.123456789125Z', 'invalid_chronology'],
  ['false-source-dto-linkage', x => x.binding.artifacts[0].snapshot.source_dto_sha256 = '0'.repeat(64), 'evidence_mismatch'],
  ['expired-rights', x => x.binding.rights.valid_until = '2026-10-22T14:30:01.123456789123Z', 'rights_outside_window'],
  ['unverified-issuer', x => x.binding.identity.issuer_id = 'invented', 'verification_failed'],
  ['unverified-scale', x => x.binding.observations[0].scale = '100', 'verification_failed'],
]) {
  const x = f.clone(base); change(x); let observed = null;
  try { await b.assembleMarketObservationReportInput(x.candidate, x.binding, f.syntheticMarketVerifier(base), () => f.VERIFIED); } catch (e) { observed = e.code; }
  if (observed !== error) throw Error('negative fixture failed: ' + name);
  bad.push({ name, expected_error: error, candidate: x.candidate, binding: x.binding });
}
write(dir + 'SYNTHETIC-negative-cases.json', { synthetic_only: true, cases: bad });
const files = {};
function walk(path, prefix = '') { for (const name of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const rel = prefix + name.name; if (name.isDirectory()) walk(path + name.name + '/', rel + '/'); else if (rel !== 'manifest.json') files[rel] = hash(readFileSync(path + name.name)); } }
walk(dir);
write(dir + 'manifest.json', { contract: 'moai.market.observation-synthetic-evidence.v1', synthetic_only: true, actual_source_authenticated: false, actual_provider_calls: 0,
  built_with: { node: process.version, python: run('python3', ['-B', '-c', 'import platform;print(platform.python_version())']).trim() },
  verified_at: f.VERIFIED, reverified_at: f.REVERIFIED, report_runtime: pin, cases: cases.map(([name]) => name), files });
console.log(JSON.stringify({ cases: cases.length, negative_cases: bad.length, files: Object.keys(files).length, manifest_sha256: hash(readFileSync(dir + 'manifest.json')), actual_provider_calls: 0 }));

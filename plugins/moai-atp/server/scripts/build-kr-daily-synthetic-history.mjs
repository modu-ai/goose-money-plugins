/** Deterministic offline artifacts. Run only after TypeScript build; never supplies real source semantics. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const server = process.env.KR_SYNTHETIC_BUILD_ROOT ?? fileURLToPath(new URL('../', import.meta.url));
const root = process.env.KR_SYNTHETIC_SOURCE_ROOT ?? fileURLToPath(new URL('../../', import.meta.url));
const report = process.env.KR_SYNTHETIC_REPORT_ROOT ?? resolve(server, 'contracts/report-history-reference');
const { z } = await import(pathToFileURL(resolve(server, 'node_modules/zod/index.js')).href);
const bridge = await import(pathToFileURL(resolve(server, 'dist/src/kr-daily-synthetic-history-bridge.js')).href);
const fixtures = await import(pathToFileURL(resolve(server, 'dist/test/kr-daily-synthetic-history-fixture.js')).href);
const out = resolve(root, 'examples/kr-history-bridge-synthetic'); const contracts = resolve(root, 'server/contracts'); mkdirSync(out, { recursive: true }); mkdirSync(contracts, { recursive: true });
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const notes = [
  'STRUCTURAL SCHEMA ONLY. Parse success does not authorize canonical use or resolve adjustment_code semantics.',
  'Runtime reconstructs unchanged raw evidence from independent raw input and verbatim original decoded text; checks SHA linkage, supported scope and exact numeric ranges.',
  'Actual origin is unsupported and rejected before reading verifier properties or invoking a verifier/clock; synthetic source labels are not authentication.',
  'Runtime checks ordered complete explicit session calendar with all supplied warm-up rows; exact original-index row mapping; exact close <= publication <= receipt <= availability <= cutoff; close-date match.',
  'Runtime requires independently evidenced no-adjustment-relevant-actions policy over the entire supplied calendar and warm-up range through cutoff, capture and adjustment vintage, no events or unit/basis changes.',
  'Runtime requires immutable independent evidence axes, bounded descriptor-only JSON, fresh injected synthetic verifier confirming the exact input digest and axes, current rights and fresh clock.',
  'Persisted receipt fields are not credentials. Complete deterministic reconstruction and fresh verification/current rights are mandatory; handoff history/lineage/runtime opaque fields need runtime comparison.',
  'Canonical report remains unchanged and does not verify actual market, calendar, currency, units or source authenticity. No inferred times, prices or share quantities.'
];
for (const [name, schema] of [['binding', bridge.KrSyntheticHistoryBindingSchema], ['input', bridge.KrSyntheticHistoryInputSchema], ['handoff-envelope', bridge.KrSyntheticHistoryHandoffEnvelopeSchema]]) {
  const exported = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any' });
  exported.$id = `https://moai.local/contracts/kr-daily-synthetic-only-history-${name}.schema.json`; exported.title = `KR daily SYNTHETIC-ONLY fixture ${name}`; exported['x-runtime-refinements'] = notes;
  write(resolve(contracts, `kr-daily-synthetic-only-history-${name}.schema.json`), exported);
}
const input = fixtures.fixture(); const h = await bridge.assembleSyntheticKrDailyHistory(input, fixtures.fixtureVerifier(input), () => fixtures.VERIFIED);
const fresh = await bridge.reverifySyntheticKrDailyHistoryHandoff(h, fixtures.fixtureVerifier(input), () => '2026-10-22T02:00:00Z');
const payload = fixtures.reportInput(h);
const code = `import sys,json,hashlib\nsys.path.insert(0,sys.argv[1])\nfrom history_semantics import calculate_report\nfrom jsonschema import Draft202012Validator\np=json.load(sys.stdin)\nDraft202012Validator(json.load(open(sys.argv[1]+'/canonical-history.schema.json'))).validate(p)\nprint(json.dumps(calculate_report(p),ensure_ascii=False))`;
for (const [name, hash] of Object.entries(bridge.KR_SYNTHETIC_REPORT_PIN.files)) { if (fixtures.hashText(readFileSync(resolve(report, name), 'utf8')) !== hash) throw new Error('report_dependency_hash_mismatch'); }
const result = spawnSync('python3', ['-B', '-c', code, report], { input: JSON.stringify(payload), encoding: 'utf8', maxBuffer: 8_000_000 }); if (result.status !== 0) throw new Error('pinned_report_validation_failed');
writeFileSync(resolve(out, 'SYNTHETIC-original-body.json'), input.original_body_text);
for (const [name, value] of Object.entries({ 'raw-input': input.raw_input, 'source': input.raw_evidence, binding: input.binding, input, handoff: h, 'reverified-handoff': fresh, 'report-input': payload, 'report-result': JSON.parse(result.stdout) })) write(resolve(out, `SYNTHETIC-${name}.json`), value);
write(resolve(out, 'manifest.json'), { scope: 'synthetic_fixture_demonstration_only', actual_origin_supported: false, actual_provider_calls: 0, canonical_actual_bindings: 0, raw_adjustment_code_interpretation: 'blocked_portal_sample_conflict', raw_contract_unchanged: true, report_runtime: bridge.KR_SYNTHETIC_REPORT_PIN, input_sha256: h.verification.input_sha256, source_link: input.binding.source_link, output_files: ['SYNTHETIC-original-body.json', 'SYNTHETIC-raw-input.json', 'SYNTHETIC-source.json', 'SYNTHETIC-binding.json', 'SYNTHETIC-input.json', 'SYNTHETIC-handoff.json', 'SYNTHETIC-reverified-handoff.json', 'SYNTHETIC-report-input.json', 'SYNTHETIC-report-result.json'].map(name => ({ name, sha256: fixtures.hashText(readFileSync(resolve(out, name), 'utf8')) })) });
console.log(JSON.stringify({ generated: 'synthetic-only KR history fixtures and structural schemas', actual_origin_supported: false, actual_provider_calls: 0, canonical_actual_bindings: 0 }));

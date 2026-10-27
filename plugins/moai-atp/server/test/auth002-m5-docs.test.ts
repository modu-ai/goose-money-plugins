// SPEC-ATP-AUTH-002 AC-006 (card t14, M5, test-first): the documentation says KIS and OpenDART local keys are the
// only authentication for analysis and report features, and carries no statement that MoAI-AI login or member
// verification is required (REQ-DOC-001, REQ-RDY-004 document side).
//
// Every predicate below is the AC-006 predicate of acceptance.md, restated as a count or a parse over repository
// files. The tests only read files under the repository tree (plugins/moai-atp/README.md, plugins/moai-atp/skills/goose/SKILL.md,
// plugins/moai-atp/skills/goose/references/**, plugins/moai-atp/CAPABILITIES.json); no network, no HOME, no key is touched. The one child
// process runs the acceptance.md CAPABILITIES predicate verbatim under `python3 -I`, with an environment that
// carries PATH only.
//
//   E-04          "모두의AI 로그인" is gone from README and SKILL.md
//   E-22 / E-23   lines holding member_login_required|provider_checks_required|로그인 연결|회원 인증: exactly 1 per file
//   E-24          that one line is the license-separation sentence ("회원 인증은 서비스 ...")
//   E-26          references/ holds none of the member-login vocabulary
//   E-29 / E-30   the word "로그인" occurs 0 times in README and in SKILL.md (this also covers the section titles)
//   E-31 / E-51   "회원" lines: README 1 (license sentence), SKILL.md 2 (license sentence, community-link exclusion)
//   E-49 / E-49b  no "connected / verified" status wording in the docs (REQ-RDY-004 document side)
//   E-55          CAPABILITIES.json, parsed: no member declaration left (JS predicate, a deep walk, and the verbatim
//                 python predicate)
//   plan M5       member_onboarding rewritten or removed; stale figures of earlier runs (actual_login,
//                 focused_member_*) are deleted or replaced, never kept
//   disclosure    the provider-error vocabulary the docs state honestly, including the K3 caveat the leader
//                 ruling asks to be written down (not an AC-006 predicate)
//
// Not covered here, on purpose: the CAPABILITIES test figures (source_tests, latest_validation.tests) belong to the
// M6 measurement (acceptance.md E-52), and the host manifests (plugins/moai-atp/plugin.json, plugins/moai-atp/mcp.json) belong to card t12.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// dist/test/<this file>.js -> plugins/moai-atp/ is three levels up, the repository root five.
const ossDir = fileURLToPath(new URL('../../../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const readmePath = join(ossDir, 'README.md');
const skillPath = join(ossDir, 'skills', 'goose', 'SKILL.md');
const referencesDir = join(ossDir, 'skills', 'goose', 'references');
const capabilitiesPath = join(ossDir, 'CAPABILITIES.json');

const readText = (path: string): string => readFileSync(path, 'utf8');
const readme = (): string => readText(readmePath);
const skill = (): string => readText(skillPath);
const capabilitiesText = (): string => readText(capabilitiesPath);
type Json = Record<string, unknown>;
const capabilities = (): Json => JSON.parse(capabilitiesText()) as Json;

/** `grep -n -E <pattern> file`: the 1-based line number and text of every matching line. */
function grepLines(text: string, pattern: RegExp): Array<{ line: number; text: string }> {
  return text.split(/\r?\n/).flatMap((value, index) => (pattern.test(value) ? [{ line: index + 1, text: value }] : []));
}

/** Every regular file under a directory, sorted (`grep -r`). */
function filesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

/** `grep -rn -E <pattern> <directory>`: "relative-path:line: text" for every match. */
function grepRecursive(directory: string, pattern: RegExp): string[] {
  return filesUnder(directory).flatMap((path) =>
    grepLines(readText(path), pattern).map((hit) => `${path.slice(directory.length + 1)}:${hit.line}: ${hit.text}`),
  );
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Paths of every `member_authentication_required: true` at any depth (the predicate of acceptance.md sees top-level blocks only). */
function deepMemberAuthenticationTrue(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => deepMemberAuthenticationTrue(item, `${path}[${index}]`));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => [
    ...(key === 'member_authentication_required' && item === true ? [`${path}.${key}`] : []),
    ...deepMemberAuthenticationTrue(item, `${path}.${key}`),
  ]);
}

/** The acceptance.md AC-006 / E-55 CAPABILITIES predicate, restated over the parsed object. It must return []. */
function capabilitiesViolations(d: Json): string[] {
  const m = isObject(d.member_onboarding) ? d.member_onboarding : {};
  const latest = isObject(d.latest_validation) ? d.latest_validation : {};
  const sequence = Array.isArray(m.required_sequence) ? m.required_sequence : [];
  const violations: string[] = [];
  for (const [key, block] of Object.entries(d)) {
    if (isObject(block) && block.member_authentication_required === true) violations.push(`${key}.member_authentication_required`);
  }
  if (latest.current_default_tool_execution === 'member_login_required') violations.push('latest_validation.current_default_tool_execution');
  if (sequence.some((step) => step === 'moai_login' || step === 'kis_and_opendart_connection_checks')) violations.push('member_onboarding.required_sequence');
  if (m.default === 'deny') violations.push('member_onboarding.default');
  if (m.common_tool_and_report_resource_guard === true) violations.push('member_onboarding.common_tool_and_report_resource_guard');
  return violations;
}

// acceptance.md AC-006, "CAPABILITIES 회원 선언 — JSON 파싱 판정", copied byte for byte (E-55).
// SPEC-ATP-AUTH-002 E-55 술어를 이동된 경로로 옮김(SPEC-ATP-MOVE-001): 저장소 루트 기준 plugins/moai-atp/CAPABILITIES.json.
const ACCEPTANCE_PYTHON_PREDICATE =
  "import json; d=json.load(open('plugins/moai-atp/CAPABILITIES.json')); m=d.get('member_onboarding') or {}; v=[k+'.member_authentication_required' for k,x in d.items() if isinstance(x,dict) and x.get('member_authentication_required') is True]; v+=['latest_validation.current_default_tool_execution'] if (d.get('latest_validation') or {}).get('current_default_tool_execution')=='member_login_required' else []; v+=['member_onboarding.required_sequence'] if any(s in (m.get('required_sequence') or []) for s in ('moai_login','kis_and_opendart_connection_checks')) else []; v+=['member_onboarding.default'] if m.get('default')=='deny' else []; v+=['member_onboarding.common_tool_and_report_resource_guard'] if m.get('common_tool_and_report_resource_guard') is True else []; print(v)";

const MEMBER_VOCABULARY = /member_login_required|provider_checks_required|로그인 연결|회원 인증/;
const CONNECTED_STATUS_WORDING = /연결됨|연결 완료|검증됨|both connected/;
const LICENSE_SENTENCE = '회원 인증은 서비스';

test('AC-006 E-04: "모두의AI 로그인" appears in neither README nor SKILL.md', () => {
  assert.deepEqual(grepLines(readme(), /모두의AI 로그인/), []);
  assert.deepEqual(grepLines(skill(), /모두의AI 로그인/), []);
});

test('AC-006 E-22: exactly one README line holds a member-login phrase', () => {
  const hits = grepLines(readme(), MEMBER_VOCABULARY);
  assert.equal(hits.length, 1, `README lines: ${JSON.stringify(hits)}`);
});

test('AC-006 E-23: exactly one SKILL.md line holds a member-login phrase', () => {
  const hits = grepLines(skill(), MEMBER_VOCABULARY);
  assert.equal(hits.length, 1, `SKILL.md lines: ${JSON.stringify(hits)}`);
});

test('AC-006 E-24: the one remaining match in each file is the license-separation sentence', () => {
  assert.equal(grepLines(readme(), new RegExp(LICENSE_SENTENCE)).length, 1);
  assert.equal(grepLines(skill(), new RegExp(LICENSE_SENTENCE)).length, 1);
  assert.deepEqual(
    grepLines(readme(), MEMBER_VOCABULARY).map((hit) => hit.text.includes(LICENSE_SENTENCE)),
    [true],
  );
  assert.deepEqual(
    grepLines(skill(), MEMBER_VOCABULARY).map((hit) => hit.text.includes(LICENSE_SENTENCE)),
    [true],
  );
});

test('AC-006 E-26: skills/goose/references holds no member-login vocabulary', () => {
  assert.ok(filesUnder(referencesDir).length > 0, 'the references/ tree is not empty, so a clean scan is not vacuous');
  assert.deepEqual(grepRecursive(referencesDir, /member_login_required|provider_checks_required|로그인|회원 인증|moai_login/), []);
});

test('AC-006 E-29: the word "로그인" occurs in no README line, titles included', () => {
  assert.deepEqual(grepLines(readme(), /로그인/), []);
});

test('AC-006 E-30: the word "로그인" occurs in no SKILL.md line, titles included', () => {
  assert.deepEqual(grepLines(skill(), /로그인/), []);
});

test('AC-006 E-31: the only README line with "회원" is the license-separation sentence', () => {
  const hits = grepLines(readme(), /회원/);
  assert.equal(hits.length, 1, `README lines: ${JSON.stringify(hits)}`);
  assert.ok(hits[0]?.text.includes(LICENSE_SENTENCE), 'that line is the license-separation sentence');
});

test('AC-006 E-51: SKILL.md keeps exactly its two "회원" lines (license sentence, community-link exclusion)', () => {
  const hits = grepLines(skill(), /회원/);
  assert.equal(hits.length, 2, `SKILL.md lines: ${JSON.stringify(hits)}`);
  assert.ok(hits.some((hit) => hit.text.includes(LICENSE_SENTENCE)), 'one is the license-separation sentence');
  assert.ok(hits.some((hit) => hit.text.includes('커뮤니티 게시')), 'the other is the community-link exclusion, untouched');
});

test('AC-006 E-49/E-49b: no "connected / verified" status wording in README, SKILL.md, CAPABILITIES.json or references/', () => {
  assert.deepEqual(grepLines(readme(), CONNECTED_STATUS_WORDING), []);
  assert.deepEqual(grepLines(skill(), CONNECTED_STATUS_WORDING), []);
  assert.deepEqual(grepLines(capabilitiesText(), CONNECTED_STATUS_WORDING), []);
  assert.deepEqual(grepRecursive(referencesDir, CONNECTED_STATUS_WORDING), []);
});

test('AC-006 E-55: CAPABILITIES.json, parsed, declares no member requirement (JS predicate)', () => {
  assert.deepEqual(capabilitiesViolations(capabilities()), []);
});

test('AC-006 E-55: no member_authentication_required: true at any depth of CAPABILITIES.json', () => {
  assert.deepEqual(deepMemberAuthenticationTrue(capabilities()), []);
});

test('AC-006 E-55: the verbatim acceptance.md python predicate prints [] and exits 0', () => {
  const run = spawnSync('python3', ['-I', '-c', ACCEPTANCE_PYTHON_PREDICATE], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
  });
  assert.equal(run.error, undefined, `python3 could not be started: ${String(run.error)}`);
  assert.equal(run.status, 0, `stderr: ${run.stderr}`);
  assert.equal(run.stdout.trim(), '[]');
});

test('plan M5: member_onboarding is removed or says the member feature is not connected and not a prerequisite', () => {
  const d = capabilities();
  if (!('member_onboarding' in d)) return;
  const block = d.member_onboarding;
  assert.ok(isObject(block), 'member_onboarding, when kept, is an object');
  // `required_sequence` may be gone; when present it names neither the login step nor the two-provider check step.
  const sequence = Array.isArray(block.required_sequence) ? block.required_sequence : [];
  assert.deepEqual(sequence.filter((step) => step === 'moai_login' || step === 'kis_and_opendart_connection_checks'), []);
  assert.notEqual(block.default, 'deny');
  assert.notEqual(block.common_tool_and_report_resource_guard, true);
  // The disconnected-module facts sit under a key that says so; none of them is a top-level fact of the block.
  for (const key of ['actual_login_adapter', 'provider_check_adapter', 'local_token_verifier']) {
    assert.equal(key in block, false, `${key} must not sit at the top level of member_onboarding`);
  }
  const text = JSON.stringify(block);
  assert.ok(text.includes('not_connected'), 'the block says the member feature is not connected');
  assert.ok(text.includes('not_a_prerequisite'), 'the block says it is not a prerequisite for analysis or reports');
});

test('plan M5: latest_validation keeps no figure of an earlier run for the member features', () => {
  const latest = capabilities().latest_validation;
  assert.ok(isObject(latest), 'latest_validation is an object');
  // Earlier-run values: actual_login "NOT_RUN", focused_member_and_goose_e2e_tests 12, focused_member_token_tests 15.
  // They are deleted or replaced by an M6 measurement; the old values must not survive.
  assert.notEqual(latest.actual_login, 'NOT_RUN');
  assert.notEqual(latest.focused_member_and_goose_e2e_tests, 12);
  assert.notEqual(latest.focused_member_token_tests, 15);
  assert.notEqual(latest.current_default_tool_execution, 'member_login_required');
});

test('disclosure: README names the provider-error codes and the three K3 tools', () => {
  const text = readme();
  for (const token of ['credential_rejected', 'rate_limited', 'upstream_unavailable', 'get_instrument_profile', 'get_market_headlines', 'get_market_flows']) {
    assert.ok(text.includes(token), `README mentions ${token}`);
  }
});

test('disclosure: SKILL.md names the provider-error codes and the three K3 tools', () => {
  const text = skill();
  for (const token of ['credential_rejected', 'rate_limited', 'upstream_unavailable', 'get_instrument_profile', 'get_market_headlines', 'get_market_flows']) {
    assert.ok(text.includes(token), `SKILL.md mentions ${token}`);
  }
});

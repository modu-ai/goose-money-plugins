// SPEC-ATP-ROLES-001 M2/M4 (card t35, test-first): document assertions for the internal role-contract document
// (skills/goose/references/role-contracts.md), the sentences added to SKILL.md, request-routing.md and README.md,
// and the machine checks of the AC that read them: AC-002 (no new command token), AC-004 (SKILL.md sentence clause),
// AC-006 (document clause), AC-007(2), AC-008..AC-016, AC-022, AC-025, AC-029, AC-032 and the O1-m1..m4 mutants
// of AC-013. Every example in the contract document is synthetic; nothing here reads a credential, touches a network
// or starts a server. Mutants are applied to in-memory copies and must make the matching check throw.
//
// Authority notes (cited by reference, never restated here): backtest status / reason order is SPEC-ATP-BTEST-001
// design.md 5.0; the hash scope of `spec_sha256` is SPEC-ATP-BTEST-001 design.md 2.4 canonical paragraph (1); the t36
// result envelope for an absent period / source list is SPEC-ATP-BTEST-001 design.md 2.5. The few lines of those
// tables that this file executes (backtest rows 0, 3, 6; the canonical-JSON recipe) are the minimum the acceptance
// criteria AC-010 and AC-032 ask a product test to execute; the t36 text stays the single source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExactInstantSchema } from '../src/exact-instant.js';
import * as routing from '../src/goose-routing.js';

type J = any;
const ossDir = fileURLToPath(new URL('../../../', import.meta.url));
const SKILL_PATH = 'skills/goose/SKILL.md';
const ROUTING_PATH = 'skills/goose/references/request-routing.md';
const CONTRACT_PATH = 'skills/goose/references/role-contracts.md';
const README_PATH = 'README.md';
const CAPABILITIES_PATH = 'CAPABILITIES.json';

const readRel = (rel: string): string => readFileSync(join(ossDir, rel), 'utf8');
const skillText = (): string => readRel(SKILL_PATH);
const routingText = (): string => readRel(ROUTING_PATH);
const readmeText = (): string => readRel(README_PATH);
const contractText = (): string => {
  if (!existsSync(join(ossDir, CONTRACT_PATH))) assert.fail(`${CONTRACT_PATH} does not exist yet`);
  return readRel(CONTRACT_PATH);
};
const linesOf = (text: string): string[] => text.split(/\r?\n/);
const lineCount = (text: string, fragment: string): number => linesOf(text).filter(l => l.includes(fragment)).length;
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const sectionOf = (text: string, heading: string): string => {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `section ${heading} is missing`);
  const rest = text.slice(start + heading.length);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
};


/** A mutant must be caught by the check itself: a throw caused by a missing document or example does not count. */
function assertRed(fn: () => void, label = ''): void {
  let thrown: unknown;
  try { fn(); } catch (error) { thrown = error; }
  assert.ok(thrown !== undefined, `${label}: the mutant was not caught`);
  const message = String((thrown as Error).message);
  assert.ok(!/does not exist yet|is missing from/.test(message), `${label}: red for the wrong reason (${message})`);
}

// ---- shared sentences (the exact wording the documents carry) -------------------------------------------------------------

const FLOW = '목적 분류 → 필요한 입력·자료 권한 확인 → 내부 전문 절차·위임 → 결정적 계산·수치/근거 검증 → 통합 보고';
const TRADE_SENTENCE_CORE = '매매 실행 요청은 도구를 부르지 않고 고정 문장 F로만 답';
const ATP_SCOPE_ITEMS = ['`/goose` 단일 진입', '읽기 전용 계좌 현황', '분석·리서치', '전략 수립', '백테스트', '보고'] as const;
const ATP_SCOPE = 'ATP의 범위는 `/goose` 단일 진입, 읽기 전용 계좌 현황(아직 제공하지 않음), 분석·리서치, 전략 수립, 백테스트, 보고입니다.';
const ATS_DOMAIN = '실거래·주문·취소·자동매매·예약 주문, 팀 에이전트, 상시 상태, 퀀트·시스템트레이딩 엔진은 별도 시스템 ATS(Agentic Trading System)의 영역입니다.';
const ATS_NOT_APPROVAL = 'ATS라는 이름은 실거래 승인이 아닙니다.';
const SEQUENTIAL_LABEL = '`순차 실행`';
const FIXED_F_PIECE_1 = '이 플러그인은 지원하지 않으며 별도 시스템(ATS)의 영역입니다';

// ---- lines that must survive byte for byte (REQ-RPL-001, AC-019): SHA-256 of the original line --------------------------

const PRESERVED: ReadonlyArray<{ file: string; label: string; sha: string }> = [
  { file: SKILL_PATH, label: 'SKILL.md heading "단일 진입점과 내부 서브커맨드"', sha: 'b32db5016b306f160f3afc25b954005129edea6cb6622509fa92b24feedcd46b' },
  { file: SKILL_PATH, label: 'SKILL.md "공개 스킬은 Goose 하나입니다" paragraph', sha: 'b45850303993434283054cd3a5baa107cd58e9edb89f7c983a72b13398c3f659' },
  { file: SKILL_PATH, label: 'SKILL.md legacy-call paragraph', sha: '2a31ad7ef69107c6a40bfb2a6b08d23a250780c3d8b7c6ce8d7fb4d44f8d2365' },
  { file: README_PATH, label: 'README heading "Goose 한 개로 사용하기"', sha: '123eda4b1634f63d5c883f17a8400dcd9a71f8b68c2dc828443b4c3f90f71224' },
  { file: README_PATH, label: 'README "공개 스킬은 `goose` 하나입니다" line', sha: 'c63cded71f98e3ec0a3e3e0856634bb7224ea60eddb90ae2f2658a044e819946' },
  { file: README_PATH, label: 'README section line 2', sha: '9cdeeee26859728b3b3aa2ea0edb1e89d8cad1f3fc12d9d63073cf31c9b363a5' },
  { file: README_PATH, label: 'README section line 3', sha: '8ba1c86ca0b719c534371c5fd7c80aed5d51010aa3f492ac7c74bb7fe633d366' },
  { file: README_PATH, label: 'README section line 4', sha: '4dd28343965313ed08af54e0eef0513a91fe1403da5da635b30b6592b4f359e8' },
  { file: README_PATH, label: 'README section line 5', sha: '5c82e3c258eaeda654800998f2988b3b34f81c91998cc971c3eb150aff649370' },
  { file: ROUTING_PATH, label: 'request-routing.md sequential-execution paragraph', sha: '6f91988664306b7ec253b99443e9dafab8b21778df24ddc26919aa95c2dcf7bb' },
  { file: ROUTING_PATH, label: 'request-routing.md main-loop paragraph', sha: '00e75b06d5ec80b3ffb80ea354736eac64efa3cc90c5590bd534ff5c1b2d1470' },
  { file: ROUTING_PATH, label: 'request-routing.md "공개 발견 스킬은 goose1개" paragraph', sha: 'f4b3ba6a585922db774dc57a33a354afd3f7a266cc9a8b93fd2ee4bea277d975' },
];
test('RPL-001 / AC-019: the original lines the SPEC keeps (SKILL.md 56/58/72, README section, request-routing 16/25/38) are still present byte for byte', () => {
  for (const { file, label, sha } of PRESERVED) {
    assert.ok(readRel(file).split('\n').some(line => sha256(line) === sha), `${label} was deleted or reworded`);
  }
});

// ---- AC-008: the five-step flow -------------------------------------------------------------------------------------------

test('AC-008: SKILL.md, request-routing.md and README.md state the five-step flow in order', () => {
  for (const [name, text] of [['SKILL.md', skillText()], ['request-routing.md', routingText()], ['README.md', readmeText()]] as const) {
    assert.ok(text.includes(FLOW), `${name} lacks the flow sentence`);
  }
});

// ---- AC-004 (SKILL.md sentence clause) ------------------------------------------------------------------------------------

test('AC-004 (M2): trade-execution requests are answered with the fixed sentence F and no tool call (SKILL.md, request-routing.md)', () => {
  for (const [name, text] of [['SKILL.md', skillText()], ['request-routing.md', routingText()]] as const) {
    assert.ok(text.includes(TRADE_SENTENCE_CORE), `${name} lacks the "no tool call, fixed sentence F" sentence`);
    assert.ok(text.includes(routing.GOOSE_SENTENCE_F), `${name} does not quote the planner's fixed sentence F verbatim`);
    assert.ok(text.includes(routing.GOOSE_SENTENCE_F_T), `${name} does not quote the planner's fixed sentence F_T verbatim`);
  }
});
test('AC-004 (README clause): README says trade and order requests are unsupported, names the F opening and keeps the user in charge of live trading', () => {
  const section = sectionOf(readmeText(), '## Goose 한 개로 사용하기');
  assert.ok(section.includes(FIXED_F_PIECE_1), 'README section lacks F piece 1');
  assert.ok(lineCount(section, '도구를 호출하지 않') >= 1, 'README section lacks the no-tool-call statement');
  assert.ok(section.includes('실거래는 사용자께서 직접 판단·실행'), 'README section lacks F piece 4');
});

// ---- AC-009: sequential fallback ------------------------------------------------------------------------------------------

const EXISTING_SEQUENTIAL = '위임 도구가 없는 호스트에서는 같은 단계들을 순차 실행하며 병렬 실행했다고 표현하지 않는다';
const EXISTING_NO_AGENT_ROUTING = '역할 이름만으로 서브에이전트를 생성하지 않는다';
const EXISTING_NO_AGENT_SKILL = '자동으로 별도 에이전트를 생성하지 않습니다';
function assertSequentialRules(skill: string, route: string): void {
  assert.ok(route.includes(EXISTING_SEQUENTIAL), 'request-routing.md sequential sentence');
  assert.ok(route.includes(EXISTING_NO_AGENT_ROUTING), 'request-routing.md no-subagent sentence');
  assert.ok(skill.includes(EXISTING_NO_AGENT_SKILL), 'SKILL.md no-agent sentence');
  for (const [name, text] of [['SKILL.md', skill], ['request-routing.md', route]] as const) {
    assert.ok(linesOf(text).some(l => l.includes(SEQUENTIAL_LABEL) && l.includes('순차')), `${name} lacks the sentence that labels the output ${SEQUENTIAL_LABEL}`);
    assert.ok(linesOf(text).some(l => l.includes('동적 스킬 호출') && l.includes('서브에이전트') && l.includes('가정하지 않')), `${name} lacks the no-dynamic-invocation / no-subagent assumption sentence`);
  }
}
test('AC-009: the three existing sequential/no-subagent sentences stay and the new "순차 실행" label sentence is added', () => {
  assertSequentialRules(skillText(), routingText());
});
test('AC-009 mutant: deleting the request-routing sequential sentence turns the check red', () => {
  assertSequentialRules(skillText(), routingText()); // the unmutated documents pass, so the deletion below is what turns it red
  assert.notEqual(routingText().replace(EXISTING_SEQUENTIAL, ''), routingText(), 'the mutation applied');
  assertRed(() => assertSequentialRules(skillText(), routingText().replace(EXISTING_SEQUENTIAL, '')));
});
test('AC-009: no document claims parallel or autonomous sub-agent execution that did not happen', () => {
  const forbidden = /병렬로 실행했|동시에 실행했|서브에이전트가 (자동|항상)/;
  const hits = allSkillFiles().flatMap(path => linesOf(readFileSync(path, 'utf8')).map((text, i) => ({ path: relative(ossDir, path), line: i + 1, text })).filter(h => forbidden.test(h.text)));
  assert.deepEqual(hits, []);
});

// ---- AC-006 (document clause) and the performance clause ------------------------------------------------------------------

function hasAccountClause(text: string): boolean {
  return linesOf(text).some(l => l.includes('SPEC-ATP-ACCT-001') && l.includes('제공하지 않') && l.includes('키·계좌 식별자·동의를 요청하지 않'));
}
test('AC-006 (M2): SKILL.md and request-routing.md say read-only holdings are not provided before SPEC-ATP-ACCT-001 and no key, account identifier or consent is requested', () => {
  assert.ok(hasAccountClause(skillText()), 'SKILL.md');
  assert.ok(hasAccountClause(routingText()), 'request-routing.md');
});
test('AC-006 mutant: dropping the "no consent request" half turns the clause check red', () => {
  assert.equal(hasAccountClause(skillText()), true, 'the unmutated SKILL.md carries the clause');
  assert.equal(hasAccountClause(skillText().replace('키·계좌 식별자·동의를 요청하지 않', '')), false);
});
test('AC-007 (documents): SKILL.md and request-routing.md say an incomplete return or performance input yields "계산할 수 없음" with a reason and no estimate', () => {
  for (const [name, text] of [['SKILL.md', skillText()], ['request-routing.md', routingText()]] as const) {
    assert.ok(linesOf(text).some(l => l.includes('계산할 수 없음') && l.includes('추정값을 내지 않')), name);
  }
});

// ---- AC-025: ATP/ATS boundary sentences ---------------------------------------------------------------------------------

test('AC-025: SKILL.md, request-routing.md and README.md each carry the ATP scope, the ATS domain and the "not a live-trading approval" sentence', () => {
  for (const item of ATP_SCOPE_ITEMS) assert.ok(ATP_SCOPE.includes(item), `the scope sentence names ${item}`);
  for (const [name, text] of [['SKILL.md', skillText()], ['request-routing.md', routingText()], ['README.md', readmeText()]] as const) {
    assert.ok(text.includes(ATP_SCOPE), `${name} lacks the ATP scope sentence`);
    assert.ok(text.includes(ATS_DOMAIN), `${name} lacks the ATS domain sentence`);
    assert.ok(text.includes(ATS_NOT_APPROVAL), `${name} lacks the not-an-approval sentence`);
  }
});
test('AC-025: no line writes ATS as supported, linked or installed (lines that match are negated)', () => {
  const affirm = /ATS.{0,20}(지원합니다|연동|설치되어)/;
  const hits = [readmeText(), ...allSkillFiles().map(p => readFileSync(p, 'utf8'))].flatMap(text => linesOf(text).filter(l => affirm.test(l)));
  assert.deepEqual(hits.filter(l => !/않|없|아닙|아니/.test(l)), []);
});
test('AC-025 mutant: a sentence that calls ATS supported is caught by the same grep', () => {
  assert.ok(/ATS.{0,20}(지원합니다|연동|설치되어)/.test('이 플러그인은 ATS를 지원합니다'));
});

// ---- AC-002: no new command token (pattern file text copied; samples reproduced inline) --------------------------------

const AC002_PATTERN = String.raw`(^|[^A-Za-z0-9_가-힣./-])/(전략가|자산관리사|리서치|매매|backtesting|strategy|research|trade|account)\.?([^A-Za-z0-9_./-]|$)`;
const SAMPLE_12 = [
  '사용: `/trade` 를 입력하세요', '/전략가 논문으로 설계', '명령 (/account) 안내', '/trade를 입력하면 주문합니다',
  '계좌는 /account로 조회하세요', '"/전략가" 를 쓰세요', '명령 /backtesting.', "'/리서치', 순서",
  '논문과 규칙 설계는 `references/workflows/strategy.md`', '이전 `goose-conditions/strategy/backtest/mental-support` 호출', 'https://example.org/research/report', '문서 /strategy.md 참고',
];
const SAMPLE_ITER3 = [
  '**/account** 를 입력하세요', '[/trade] 명령', '명령:/전략가', '→/매매 입력', '<code>/research</code>', '「/리서치」 사용',
  './strategy 폴더', '../trade 상위', 'docs/account 경로', '자료/전략가 폴더', 'docs_x/trade 경로',
];
function sampleBehaviour(pattern: string): { twelve: boolean[]; iter3: boolean[] } {
  const re = new RegExp(pattern, 'u');
  return { twelve: SAMPLE_12.map(l => re.test(l)), iter3: SAMPLE_ITER3.map(l => re.test(l)) };
}
const EXPECTED_BEHAVIOUR = {
  twelve: [true, true, true, true, true, true, true, true, false, false, false, false],
  iter3: [true, true, true, true, true, true, false, false, false, false, false],
};
function allSkillFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(path);
    }
  };
  walk(join(ossDir, 'skills'));
  return out;
}
test('AC-002 pattern self-test: 12-line sample matches lines 1-8 only; iter3 sample matches lines 1-6 only', () => {
  assert.deepEqual(sampleBehaviour(AC002_PATTERN), EXPECTED_BEHAVIOUR);
});
const AC002_MUTANTS: ReadonlyArray<readonly [string, string]> = [
  ['(a) old allow-list front boundary', AC002_PATTERN.replace('(^|[^A-Za-z0-9_가-힣./-])', '(^|[\\s`("\'])')],
  ['(b) front boundary without Hangul', AC002_PATTERN.replace('[^A-Za-z0-9_가-힣./-]', '[^A-Za-z0-9_./-]')],
  ['(c) front boundary without "./"', AC002_PATTERN.replace('[^A-Za-z0-9_가-힣./-]', '[^A-Za-z0-9_가-힣-]')],
  ['(d) old rear boundary', AC002_PATTERN.replace('([^A-Za-z0-9_./-]|$)', '(\\s|[`)]|$)')],
  ['(e) no optional full stop', AC002_PATTERN.replace('\\.?', '')],
];
for (const [label, pattern] of AC002_MUTANTS) {
  test(`AC-002 pattern mutant ${label} changes the sample behaviour (red)`, () => {
    assert.notEqual(pattern, AC002_PATTERN, 'the mutation applied');
    assert.notDeepEqual(sampleBehaviour(pattern), EXPECTED_BEHAVIOUR);
  });
}
test('AC-002: README.md, skills/** and CAPABILITIES.json carry no /전략가 /자산관리사 /리서치 /매매 /backtesting /strategy /research /trade /account command token', () => {
  const re = new RegExp(AC002_PATTERN, 'u');
  const files = [join(ossDir, README_PATH), join(ossDir, CAPABILITIES_PATH), ...allSkillFiles()];
  const hits = files.flatMap(path => linesOf(readFileSync(path, 'utf8')).map((text, i) => ({ path: relative(ossDir, path), line: i + 1, text })).filter(h => re.test(h.text)));
  assert.deepEqual(hits, []);
});

// ---- contract document: link, examples and the 12 envelope keys ----------------------------------------------------------

const ENVELOPE_KEYS = ['contract', 'procedure', 'target', 'period', 'cutoff', 'sources', 'units', 'versions', 'evidence_ids', 'status', 'reasons', 'execution'] as const;
const STATUSES = ['ready', 'partial', 'not_run', 'blocked', 'unsupported'] as const;
const EXAMPLE_IDS = [
  'strategy-spec',
  'research-period-missing', 'research-source-missing', 'research-both-missing', 'handoff-calculator',
  'backtest-a', 'backtest-b', 'backtest-c', 'backtest-d', 'backtest-d-prime', 'handoff-mismatch',
  'performance-cost-basis', 'performance-cash-flows', 'performance-currency',
  'holdings-waiting', 'upstream-propagation', 'unit-unconfirmed', 'numeric-trace', 'research-note', 'risk-beyond-functions', 'ats-not-installed',
] as const;
type ExampleId = (typeof EXAMPLE_IDS)[number];

function loadExamples(): Map<string, J> {
  const text = contractText();
  const found = new Map<string, J>();
  for (const m of text.matchAll(/\*\*예시 ([a-z0-9-]+)\*\*[ \t]*\r?\n+```json\r?\n([\s\S]*?)\r?\n```/g)) {
    const id = m[1]!;
    assert.ok(!found.has(id), `example ${id} appears twice`);
    found.set(id, JSON.parse(m[2]!));
  }
  return found;
}
const example = (id: ExampleId): J => {
  const value = loadExamples().get(id);
  assert.ok(value !== undefined, `example ${id} is missing from ${CONTRACT_PATH}`);
  return structuredClone(value);
};
const envelopeOf = (id: ExampleId, value: J = example(id)): J => (id === 'strategy-spec' ? value : value.envelope);

test('M2: SKILL.md links the contract document and the link resolves to a file inside the plugin root (check_package.py link check)', () => {
  const targets = [...skillText().matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]!);
  assert.ok(targets.includes('references/role-contracts.md'), 'SKILL.md does not link references/role-contracts.md');
  const resolved = resolve(dirname(join(ossDir, SKILL_PATH)), 'references/role-contracts.md');
  assert.ok(resolved.startsWith(resolve(ossDir) + sep) && existsSync(resolved));
});
test('M2: the contract document carries all twenty-one labelled synthetic examples, each once and parseable', () => {
  const found = [...loadExamples().keys()].sort();
  assert.deepEqual(found, [...EXAMPLE_IDS].sort());
});

function sourceLines(): string[] { return linesOf(contractText()); }

// AC-013: the twelve envelope keys.
test('AC-013: the contract document lists the twelve envelope keys, in the order of design.md 2 (equal to the keys t36 strips)', () => {
  const section = sectionOf(contractText(), '## 공통 봉투');
  const keys = [...section.matchAll(/^\| `([a-z_]+(?:\[\])?)` \|/gm)].map(m => m[1]!.replace(/\[\]$/, ''));
  assert.deepEqual(keys, [...ENVELOPE_KEYS]);
});
test('AC-032 mutant (M3): a thirteenth key or a missing key breaks the envelope list equality', () => {
  const keys: string[] = [...ENVELOPE_KEYS];
  assert.notDeepEqual([...keys, 'shadow'], [...ENVELOPE_KEYS]);
  assert.notDeepEqual(keys.slice(1), [...ENVELOPE_KEYS]);
});

function assertEnvelope(e: J, label: string): void {
  for (const key of ENVELOPE_KEYS) assert.ok(key in e, `${label}: envelope lacks ${key}`);
  assert.equal(e.execution.order_sent, false, `${label}: execution.order_sent`);
  assert.equal(e.execution.provider_dispatches, 0, `${label}: provider_dispatches`);
  assert.ok(['plan_only', 'local_deterministic'].includes(e.execution.authority), `${label}: authority`);
  assert.ok((STATUSES as readonly string[]).includes(e.status), `${label}: status ${e.status}`);
  assert.ok(Array.isArray(e.reasons), `${label}: reasons`);
  if (e.status !== 'ready') assert.ok(e.reasons.length >= 1, `${label}: a non-ready envelope carries at least one reason`);
  if (e.cutoff !== null) {
    assert.equal(ExactInstantSchema.safeParse(e.cutoff.at_utc).success, true, `${label}: cutoff.at_utc is an exact instant`);
    assert.equal(typeof e.cutoff.display_tz, 'string', `${label}: cutoff.display_tz`);
  } else assert.notEqual(e.status, 'ready', `${label}: a null cutoff is never ready`);
  if (e.target !== null) assert.ok(['confirmed', 'candidate', 'unresolved'].includes(e.target.identity_status), `${label}: identity_status`);
  assert.ok(Array.isArray(e.sources) && Array.isArray(e.units) && Array.isArray(e.evidence_ids), `${label}: arrays`);
  for (const s of e.sources) {
    for (const key of ['source_id', 'received_at', 'provider_as_of']) assert.ok(key in s, `${label}: source lacks ${key}`);
    assert.equal(ExactInstantSchema.safeParse(s.received_at).success, true, `${label}: source.received_at`);
  }
  for (const u of e.units) for (const key of ['field', 'unit', 'scale', 'currency', 'status']) assert.ok(key in u, `${label}: unit lacks ${key}`);
}
function deepKeys(value: J, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach(v => deepKeys(v, out));
  else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.push(k); deepKeys(v, out); }
  return out;
}
for (const id of EXAMPLE_IDS) {
  test(`AC-013 example ${id}: carries the twelve envelope keys, order_sent false, valid cutoff and no shadow/paper key`, () => {
    const value = example(id);
    assertEnvelope(envelopeOf(id, value), id);
    assert.deepEqual(deepKeys(value).filter(k => /shadow|paper/i.test(k)), []);
  });
}

// AC-013 O-1 clause (REQ-CAP-009), mutants O1-m1..m4 (DT-4).
function verifyCap009(ex: J): void {
  const req = ex.request;
  const e = ex.envelope;
  const noPeriod = req.period === null;
  const noSource = Array.isArray(req.sources) && req.sources.length === 0;
  if (noPeriod) {
    assert.equal(e.period, null, 'no default period is filled in');
    assert.ok(e.reasons.includes('period_unspecified'), 'period_unspecified is recorded');
  } else assert.ok(!e.reasons.includes('period_unspecified'));
  if (noSource) {
    assert.deepEqual(e.sources, [], 'no source is inferred');
    assert.ok(e.reasons.includes('no_source'), 'no_source is recorded');
    assert.deepEqual((e.claims ?? []).filter((c: J) => ['fact', 'calculation'].includes(c.kind)), [], 'no numeric or factual claim without a source');
  } else assert.ok(!e.reasons.includes('no_source'));
  if (noPeriod || noSource) assert.equal(e.status, 'partial', 'neither reason alone blocks, and the envelope is not ready');
}
function verifyHandoff(ex: J): void {
  assert.equal(ex.request.period, null);
  assert.deepEqual(ex.request.sources, []);
  assert.deepEqual(ex.calculator_request.period, ex.request.period, 'the period is handed over as received');
  assert.deepEqual(ex.calculator_request.sources, ex.request.sources, 'the source records are handed over as received');
  assert.deepEqual(ex.t35_added_reasons_to_calculator_result, [], 't35 adds no period_unspecified / no_source to the calculator result envelope');
  for (const key of ['reasons', 'status']) assert.equal(key in ex.calculator_request, false, `the handed-over request carries no ${key}`);
  verifyCap009(ex);
}
test('AC-013 O-1 (a): a research request with no period yields period null, period_unspecified and status partial', () => { verifyCap009(example('research-period-missing')); });
test('AC-013 O-1 (b): a research request with no source record yields sources [], no_source, status partial and no factual or numeric claim', () => { verifyCap009(example('research-source-missing')); });
test('AC-013 O-1 (c): both reasons together are still partial (neither ready nor blocked)', () => {
  verifyCap009(example('research-both-missing'));
  const e = envelopeOf('research-both-missing');
  assert.deepEqual(e.reasons.filter((r: string) => r === 'period_unspecified' || r === 'no_source'), ['period_unspecified', 'no_source']);
});
test('AC-013 O-1 (d): the request is handed to the calculator as received (null / empty), nothing is added to its result', () => { verifyHandoff(example('handoff-calculator')); });
test('AC-013 O-1 (d): the document points to SPEC-ATP-BTEST-001 design.md §2.5 in exactly one sentence and does not restate the t36 result envelope', () => {
  const text = contractText();
  assert.equal(lineCount(text, 'SPEC-ATP-BTEST-001 design.md §2.5'), 1);
  const restating = linesOf(text).filter(l => (l.includes('SPEC-ATP-BTEST-001') || /\bt36\b/.test(l)) && /period|sources/.test(l) && !l.includes('SPEC-ATP-BTEST-001 design.md §2.5'));
  assert.deepEqual(restating, []);
  assert.deepEqual(linesOf(text).filter(l => l.startsWith('|') && (l.includes('SPEC-ATP-BTEST-001') || /\bt36\b/.test(l))), [], 'no table row defines t36 result fields');
});
test('AC-013 O-1 mutant O1-m1: filling a default period turns (a), (d) and the both-missing case red', () => {
  const a = example('research-period-missing'); a.envelope.period = { start: '2023-01-01', end: '2023-12-31', kind: 'default' };
  assertRed(() => verifyCap009(a));
  const c = example('research-both-missing'); c.envelope.period = { start: '2023-01-01', end: '2023-12-31', kind: 'default' };
  assertRed(() => verifyCap009(c));
  const d = example('handoff-calculator'); d.calculator_request.period = { start: '2023-01-01', end: '2023-12-31', kind: 'default' };
  assertRed(() => verifyHandoff(d));
});
test('AC-013 O-1 mutant O1-m2: status ready with period_unspecified turns (a) and (c) red', () => {
  for (const id of ['research-period-missing', 'research-both-missing'] as const) {
    const m = example(id); m.envelope.status = 'ready';
    assertRed(() => verifyCap009(m), id);
  }
});
test('AC-013 O-1 mutant O1-m3: raising no_source to blocked turns (b) and (c) red', () => {
  for (const id of ['research-source-missing', 'research-both-missing'] as const) {
    const m = example(id); m.envelope.status = 'blocked';
    assertRed(() => verifyCap009(m), id);
  }
});
test('AC-013 O-1 mutant O1-m4: adding period_unspecified to the t36 result, or inferring the sources of the handed-over request, turns (d) red', () => {
  const addReason = example('handoff-calculator'); addReason.t35_added_reasons_to_calculator_result = ['period_unspecified'];
  assertRed(() => verifyHandoff(addReason));
  const addNoSource = example('handoff-calculator'); addNoSource.t35_added_reasons_to_calculator_result = ['no_source'];
  assertRed(() => verifyHandoff(addNoSource));
  const estimateSources = example('handoff-calculator'); estimateSources.calculator_request.sources = [{ source_id: 'estimated:guess', received_at: '2021-01-04T00:00:00Z', provider_as_of: '2020-12-30' }];
  assertRed(() => verifyHandoff(estimateSources));
  const leakReasons = example('handoff-calculator'); leakReasons.calculator_request.reasons = ['period_unspecified'];
  assertRed(() => verifyHandoff(leakReasons));
});

// ---- AC-032: spec_sha256 ---------------------------------------------------------------------------------------------------

function canonicalJson(value: J): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { assert.ok(Number.isSafeInteger(value), 'canonical JSON numbers are safe integers only (amounts are decimal strings)'); return JSON.stringify(value); }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter(k => value[k] !== undefined).sort(); // default sort() = UTF-16 code unit order
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}
function specHash(spec: J, omit: readonly string[] = [...ENVELOPE_KEYS, 'spec_sha256']): string {
  const copy: J = { ...spec };
  for (const key of omit) delete copy[key];
  return sha256(canonicalJson(copy));
}
test('AC-032 oracle self-test: the canonical-JSON helper sorts keys by UTF-16 code unit, drops spaces and keeps array order', () => {
  assert.equal(canonicalJson({ b: '2', a: ['x', { d: null, c: true }], 'é': 'é', B: 1 }), '{"B":1,"a":["x",{"c":true,"d":null}],"b":"2","é":"é"}');
  assert.throws(() => canonicalJson({ a: 1.5 }));
  assert.equal(specHash({ contract: 'x', status: 'y', spec_sha256: 'z', k: 'v' }), sha256('{"k":"v"}'));
});

test('AC-032: the strategy-spec example carries a spec_sha256 recomputed exactly as design.md 2.4 canonical paragraph (1) of SPEC-ATP-BTEST-001 defines it', () => {
  const spec = example('strategy-spec');
  assert.match(spec.spec_sha256, /^[0-9a-f]{64}$/);
  assert.equal(spec.spec_sha256, specHash(spec));
});
test('AC-032 mutant (M4): a hash computed with the envelope keys left in, or over a pretty-printed or unsorted text, differs from the document value', () => {
  const spec = example('strategy-spec');
  assert.notEqual(spec.spec_sha256, specHash(spec, ['spec_sha256']));
  assert.notEqual(spec.spec_sha256, sha256(JSON.stringify(spec, null, 2)));
  const stripped: J = { ...spec }; for (const k of [...ENVELOPE_KEYS, 'spec_sha256']) delete stripped[k];
  assert.notEqual(spec.spec_sha256, sha256(JSON.stringify(stripped)), 'unsorted (insertion-order) serialisation is not the canonical form');
  const experiment: J = { ...spec, experiment: { trials: 1 } };
  assert.notEqual(spec.spec_sha256, specHash(experiment), 'an experiment ledger is not part of the specification');
});
test('AC-032: the strategy-spec example has the strategy fields, no experiment ledger key and none of the forbidden keys (expected return, coefficients, performance figures)', () => {
  const spec = example('strategy-spec');
  for (const key of ['strategy_id', 'version', 'universe', 'signal', 'entry_timing', 'exit_timing', 'sizing', 'constraints', 'invalidation_rules', 'undecided_rules', 'required_data', 'cost_fill_assumptions', 'source_ledger', 'validation_plan', 'spec_sha256']) {
    assert.ok(key in spec, `strategy spec lacks ${key}`);
  }
  assert.equal(spec.procedure, 'strategy');
  assert.equal(spec.contract, 'moai.atp.strategy-spec.v1');
  assert.equal('experiment' in spec || 'experiment_ledger' in spec, false);
  assert.deepEqual(deepKeys(spec).filter(k => /expected_return|coefficient|performance|return_rate|기대수익|계수|성과/i.test(k)), []);
});
test('AC-032: the strategy-spec section lists the specification fields and names no amount as a JSON number', () => {
  const section = sectionOf(contractText(), '## 전략 명세');
  for (const key of ['strategy_id', 'version', 'universe', 'signal', 'entry_timing', 'exit_timing', 'sizing', 'constraints', 'invalidation_rules', 'undecided_rules', 'required_data', 'cost_fill_assumptions', 'source_ledger', 'validation_plan', 'spec_sha256']) {
    assert.ok(section.includes(`\`${key}\``), `the strategy-spec section does not list ${key}`);
  }
});
test('AC-032: the document refers to SPEC-ATP-BTEST-001 design.md §2.4 canonical paragraph (1) in one sentence and gives no hash definition of its own', () => {
  const text = contractText();
  assert.equal(lineCount(text, 'SPEC-ATP-BTEST-001 design.md §2.4 정본 문단 (1)'), 1);
  assert.equal(/봉투와 .spec_sha256. 키를 뺀|키를 뺀 명세 객체|spec_sha256. 키를 지운 정규 JSON/.test(text), false);
  const defining = /정렬|UTF-8|canonical_json|정규 JSON 직렬|빼는 키|키를 (뺀|지운|제외)|직렬화|SHA-256 으로/;
  assert.deepEqual(linesOf(text).filter(l => l.includes('spec_sha256') && defining.test(l)), []);
});
test('AC-032: no other contract-document sentence restates the t36 hash scope list (sorted keys, stripped keys)', () => {
  const text = contractText();
  assert.equal(/UTF-16|코드 단위 오름차순|해시 전에 .{0,20}지운다/.test(text), false);
});

// ---- AC-010 / AC-014: backtest status --------------------------------------------------------------------------------------

interface BtRow { row: number; applies: (r: J) => boolean; reason: string; status: 'not_run' | 'blocked' }
// Excerpt of the first-match table of SPEC-ATP-BTEST-001 design.md 5.0 (rows 0, 3, 5, 6) for the AC-010 cases; the t36 text is the single source.
// Fix 4 (sync audit D9): row 5 (rule outside the v1 grammar) is part of the excerpt because it comes before row 6 and example (d) carries a specification outside that grammar.
const BT_ROWS: readonly BtRow[] = [
  { row: 0, applies: r => !r.calculator_present, reason: 'backtest_engine_unavailable', status: 'not_run' },
  { row: 3, applies: r => !r.strategy_spec_present, reason: 'strategy_spec_missing', status: 'blocked' },
  { row: 5, applies: r => r.strategy_spec_present && r.strategy_rule_in_v1_grammar === false, reason: 'rule_unsupported', status: 'blocked' },
  { row: 6, applies: r => !r.validated_history_present, reason: 'validated_history_unavailable', status: 'not_run' },
];
function decideBacktest(rows: readonly BtRow[], request: J): { status: string; reasons: string[] } | null {
  const hit = rows.find(r => r.applies(request));
  return hit ? { status: hit.status, reasons: [hit.reason] } : null;
}
const BACKTEST_CASES = ['backtest-a', 'backtest-b', 'backtest-c', 'backtest-d'] as const;
function verifyBacktest(id: (typeof BACKTEST_CASES)[number], rows: readonly BtRow[], value: J = example(id)): void {
  const decided = decideBacktest(rows, value.request);
  assert.ok(decided, `${id}: the decision table has a first match`);
  const e = value.envelope;
  assert.equal(e.status, decided.status, `${id}: status`);
  assert.deepEqual(e.reasons, decided.reasons, `${id}: reasons`);
  assert.equal(e.contract, 'moai.atp.backtest-result.v1');
  assert.equal(e.procedure, 'backtest');
  assert.equal(e.metrics, null, `${id}: metrics null`);
  assert.equal(e.simulated_fills, null, `${id}: simulated_fills null`);
  assert.equal(e.execution_receipt, null, `${id}: no execution receipt`);
  for (const section of ['out_of_sample', 'walk_forward', 'cost_sensitivity', 'leakage_checks', 'multiple_experiments']) assert.equal(e.sections[section], null, `${id}: ${section} null`);
  if (value.request.strategy_spec_present) {
    assert.equal(e.strategy_spec_sha256, example('strategy-spec').spec_sha256, `${id}: carries the hash of the supplied specification`);
    assert.equal(e.experiment.strategy_id, example('strategy-spec').strategy_id, `${id}: carries the experiment it would have run`);
  } else {
    assert.equal(e.strategy_spec_sha256, null);
    assert.equal(e.experiment, null);
  }
  if (value.request.calculator_present) assert.ok(typeof value.request.assumption === 'string' && value.request.assumption.length > 0, `${id}: a calculator is only ever a labelled synthetic assumption`);
}
const EXPECTED_BACKTEST: Record<(typeof BACKTEST_CASES)[number], { status: string; reason: string }> = {
  'backtest-a': { status: 'not_run', reason: 'backtest_engine_unavailable' }, // no specification, no calculator (row 0 comes first)
  'backtest-b': { status: 'not_run', reason: 'backtest_engine_unavailable' }, // specification present, no calculator (row 0)
  'backtest-c': { status: 'blocked', reason: 'strategy_spec_missing' }, // calculator assumed, no specification (row 3)
  'backtest-d': { status: 'blocked', reason: 'rule_unsupported' }, // calculator and specification assumed, no history, but the specification rule is outside the v1 grammar (row 5 comes before row 6)
};
for (const id of BACKTEST_CASES) {
  test(`AC-010/AC-014 ${id}: the example follows the SPEC-ATP-BTEST-001 §5.0 first-match table and carries null metrics, fills and receipt`, () => {
    const value = example(id);
    verifyBacktest(id, BT_ROWS, value);
    assert.deepEqual({ status: value.envelope.status, reason: value.envelope.reasons[0] }, EXPECTED_BACKTEST[id]);
  });
}
test('AC-010 today: with no calculator the result is not_run + backtest_engine_unavailable whether or not a specification exists', () => {
  for (const id of ['backtest-a', 'backtest-b'] as const) {
    assert.equal(example(id).request.calculator_present, false);
    assert.equal(example(id).envelope.status, 'not_run');
    assert.deepEqual(example(id).envelope.reasons, ['backtest_engine_unavailable']);
  }
});
test('AC-010 mutant: checking the specification before the calculator turns (a) red', () => {
  const swapped: readonly BtRow[] = [BT_ROWS[1]!, BT_ROWS[0]!, BT_ROWS[2]!, BT_ROWS[3]!];
  assertRed(() => verifyBacktest('backtest-a', swapped));
});
test('AC-010 mutant: deleting the "no specification" row turns (c) red', () => {
  assertRed(() => verifyBacktest('backtest-c', [BT_ROWS[0]!, BT_ROWS[2]!, BT_ROWS[3]!]));
});
test('AC-014 mutant: filling a metric, a simulated fill or a receipt into a not_run result turns the check red', () => {
  for (const patch of [(e: J) => { e.metrics = { net_return: '0' }; }, (e: J) => { e.simulated_fills = []; }, (e: J) => { e.execution_receipt = { run_id: 'x' }; }]) {
    const value = example('backtest-a'); patch(value.envelope);
    assertRed(() => verifyBacktest('backtest-a', BT_ROWS, value));
  }
});
test('AC-010: the document refers to SPEC-ATP-BTEST-001 design.md §5.0 for the order in one sentence and does not state a competing order', () => {
  const text = contractText();
  assert.equal(lineCount(text, 'SPEC-ATP-BTEST-001 design.md §5.0'), 1);
  assert.equal(/명세 (검사|없음)[^\n]{0,20}먼저|먼저 `blocked`/.test(text), false, 'no "specification first" competing order');
});
test('AC-010: dependency order, handoff checks and handoff_contract_mismatch are written down', () => {
  const text = contractText();
  assert.ok(text.includes('strategy → backtest → report'));
  assert.ok(text.includes('research → report'));
  assert.ok(linesOf(text).some(l => l.includes('계약 판') && l.includes('cutoff') && l.includes('identity') && l.includes('단위') && l.includes('`handoff_contract_mismatch`')));
});
function handoffMismatches(req: J): string[] {
  return ['contract', 'cutoff', 'target', 'units'].filter(k => req.expected[k] !== req.received[k]);
}
function verifyHandoffMismatch(value: J): void {
  const mismatched = handoffMismatches(value.request);
  const e = value.envelope;
  if (mismatched.length > 0) {
    assert.equal(e.status, 'blocked');
    assert.deepEqual(e.reasons, ['handoff_contract_mismatch']);
    assert.equal(e.input_used, false, 'the mismatching input is not coerced and used');
  }
}
test('AC-010 (e): a contract-version mismatch at a handoff is blocked with handoff_contract_mismatch and the input is not used', () => {
  const value = example('handoff-mismatch');
  assert.deepEqual(handoffMismatches(value.request), ['contract']);
  verifyHandoffMismatch(value);
});
test('AC-010 (e) mutant: a mismatching handoff reported ready, or used after coercion, is red', () => {
  const ready = example('handoff-mismatch'); ready.envelope.status = 'ready';
  assertRed(() => verifyHandoffMismatch(ready));
  const used = example('handoff-mismatch'); used.envelope.input_used = true;
  assertRed(() => verifyHandoffMismatch(used));
});
test('AC-014: simulated fills exist only inside the backtest result contract (document lines naming them are in role-contracts.md) and are labelled', () => {
  const where = allSkillFiles().filter(p => /simulated_fills|assumed_fill/.test(readFileSync(p, 'utf8'))).map(p => relative(ossDir, p).split(sep).join('/'));
  assert.deepEqual(where, [CONTRACT_PATH]);
  const text = contractText();
  assert.ok(linesOf(text).some(l => l.includes('simulated_fills') && l.includes('simulated: true') && l.includes('order_sent: false')));
});
test('AC-014: the backtest section keeps the planner requirement and says the calculator, not the specification, is today missing', () => {
  const text = contractText();
  assert.ok(linesOf(text).some(l => l.includes('backtest_engine_unavailable') && l.includes('not_run')));
});

// ---- AC-007 (2): performance / holdings "cannot compute" --------------------------------------------------------------------

function performanceReasons(req: J): string[] {
  const out: string[] = [];
  if (req.measure === 'holding_return' && req.cost_basis_present !== true) out.push('cost_basis_missing');
  if (req.measure === 'period_return' && req.cash_flows_complete !== true) out.push('cash_flows_missing');
  if (req.measure === 'total_value' && new Set(req.positions.map((p: J) => p.currency)).size > 1 && req.fx_basis_present !== true) out.push('currency_basis_unresolved');
  return out;
}
function verifyPerformance(value: J): void {
  const expected = performanceReasons(value.request);
  assert.ok(expected.length > 0, 'the example is an incomplete-input case');
  const e = value.envelope;
  assert.equal(e.procedure, 'performance');
  assert.equal(e.status, 'not_run');
  assert.deepEqual(e.reasons, expected);
  assert.ok(e.figures.length >= 1);
  for (const f of e.figures) {
    assert.equal(f.value, null, 'the value cell is null');
    assert.equal(f.display, '계산할 수 없음');
    assert.deepEqual(f.reasons, expected);
    assert.equal('estimate' in f, false, 'no estimated figure');
  }
}
const PERFORMANCE_CASES = [['performance-cost-basis', 'cost_basis_missing'], ['performance-cash-flows', 'cash_flows_missing'], ['performance-currency', 'currency_basis_unresolved']] as const;
for (const [id, reason] of PERFORMANCE_CASES) {
  test(`AC-007 (2) ${id}: "계산할 수 없음" with ${reason} and a null value`, () => {
    const value = example(id);
    verifyPerformance(value);
    assert.deepEqual(value.envelope.reasons, [reason]);
  });
}
test('AC-007 (2) mutants: a filled return value, or an empty reason list, is red', () => {
  const filled = example('performance-cost-basis'); filled.envelope.figures[0].value = '5.0';
  assertRed(() => verifyPerformance(filled));
  const noReason = example('performance-cost-basis'); noReason.envelope.figures[0].reasons = [];
  assertRed(() => verifyPerformance(noReason));
  const estimated = example('performance-cash-flows'); estimated.envelope.figures[0].estimate = '3.2';
  assertRed(() => verifyPerformance(estimated));
});
test('AC-007 (2) / design 4.3: the performance section lists the inputs each return needs and the reason when one is missing', () => {
  const section = sectionOf(contractText(), '## 수익·성과 현황');
  for (const code of ['cost_basis_missing', 'cash_flows_missing', 'period_unspecified', 'currency_basis_unresolved']) assert.ok(section.includes(`\`${code}\``), code);
  assert.ok(section.includes('계산할 수 없음'));
  assert.ok(section.includes('`performance_inputs_missing`'));
});

function verifyHoldings(value: J): void {
  const e = value.envelope;
  assert.equal(e.procedure, 'holdings');
  assert.equal(e.status, 'blocked');
  assert.deepEqual(e.reasons, ['account_access']);
  assert.equal(e.display, routing.GOOSE_SENTENCE_ACCOUNT);
  assert.equal(e.tool_calls, 0);
  assert.equal(e.credential_requested, false);
  assert.equal(e.account_identifier_requested, false);
  assert.equal(e.consent_requested, false);
  assert.equal(e.execution.provider_dispatches, 0);
}
test('AC-006: the holdings example waits for the account SPEC: blocked + account_access, the planner sentence, no tool call, no key, identifier or consent request', () => { verifyHoldings(example('holdings-waiting')); });
test('AC-006 mutant: a holdings example that calls a tool or asks for a credential is red', () => {
  const tool = example('holdings-waiting'); tool.envelope.tool_calls = 1;
  assertRed(() => verifyHoldings(tool));
  const key = example('holdings-waiting'); key.envelope.credential_requested = true;
  assertRed(() => verifyHoldings(key));
});

// ---- AC-011: failure propagation and missing data ----------------------------------------------------------------------------

const INCOMPLETE = ['not_run', 'blocked', 'unsupported'];
const DEPENDS: Record<string, string[]> = { strategy: [], backtest: ['strategy'], research: [], report: ['backtest', 'research'] };
function propagate(steps: string[], own: Record<string, J>): J[] {
  const results = new Map<string, J>();
  for (const step of steps) {
    const upstream = DEPENDS[step]!.filter(d => steps.includes(d)).find(d => INCOMPLETE.includes(results.get(d).status));
    results.set(step, upstream ? { step, status: 'not_run', reasons: [`upstream_not_completed:${upstream}`] } : { step, ...own[step] });
  }
  return steps.map(s => results.get(s));
}
function verifyUpstream(value: J): void {
  const expected = propagate(value.request.steps, value.request.own_results);
  assert.deepEqual(value.envelope.step_results, expected);
  const complete = expected.every(r => !INCOMPLETE.includes(r.status));
  assert.equal(value.envelope.complete, complete);
  assert.equal(complete, false, 'a result with an incomplete upstream step is not reported as complete');
  assert.equal(value.envelope.status, expected[expected.length - 1].status);
}
test('AC-011: when a step is blocked, every dependent step is not_run with upstream_not_completed:<step id> and the result is not reported as complete', () => { verifyUpstream(example('upstream-propagation')); });
test('AC-011 mutants: a dependent step left ready, or complete: true, is red', () => {
  const ready = example('upstream-propagation'); ready.envelope.step_results[2].status = 'ready'; ready.envelope.step_results[2].reasons = [];
  assertRed(() => verifyUpstream(ready));
  const complete = example('upstream-propagation'); complete.envelope.complete = true;
  assertRed(() => verifyUpstream(complete));
});
function verifyUnitUnconfirmed(value: J): void {
  const e = value.envelope;
  const [figure] = e.figures;
  assert.equal(figure.value, null, 'the value stays null');
  assert.notEqual(figure.value, 0);
  assert.notEqual(figure.value, value.request.prior_value, 'an earlier value is not substituted');
  assert.deepEqual(figure.reasons, ['unit_unconfirmed']);
  assert.ok(e.excluded_sections.some((s: J) => s.reason === 'unit_unconfirmed'), 'the affected section is excluded with the reason');
  assert.ok(e.units.some((u: J) => u.status === 'unconfirmed'), 'units[] marks the unit unconfirmed');
}
test('AC-011: an unconfirmed unit keeps the value null with its reason, excludes the section and substitutes nothing', () => { verifyUnitUnconfirmed(example('unit-unconfirmed')); });
test('AC-011 mutants: zero, the earlier value, or a missing exclusion is red', () => {
  const zero = example('unit-unconfirmed'); zero.envelope.figures[0].value = 0;
  assertRed(() => verifyUnitUnconfirmed(zero));
  const prior = example('unit-unconfirmed'); prior.envelope.figures[0].value = prior.request.prior_value;
  assertRed(() => verifyUnitUnconfirmed(prior));
  const kept = example('unit-unconfirmed'); kept.envelope.excluded_sections = [];
  assertRed(() => verifyUnitUnconfirmed(kept));
});
test('AC-011: the document states the propagation, the "not complete" rule and the no-substitution rule', () => {
  const text = contractText();
  assert.ok(text.includes('`upstream_not_completed:<step id>`'));
  assert.ok(linesOf(text).some(l => l.includes('완료로 보고하지 않')));
  assert.ok(linesOf(text).some(l => l.includes('0·이전 값·다른 단위·다른 출처로 대체하지 않')));
});

// ---- AC-012: numeric trace and independent review ------------------------------------------------------------------------

function traceValid(trace: J): boolean {
  if (trace === null || trace === undefined) return false;
  if (typeof trace.evidence_id === 'string' && trace.evidence_id.length > 0) return true;
  return typeof trace.function_id === 'string' && trace.function_id.length > 0 && /^[0-9a-f]{64}$/.test(trace.inputs_sha256 ?? '');
}
function verifyNumericTrace(value: J): void {
  const e = value.envelope;
  for (const section of e.sections) {
    const allTraced = section.numbers.every((n: J) => traceValid(n.trace));
    if (allTraced) assert.notEqual(section.status, 'blocked', `${section.id}: a fully traced section is not blocked`);
    else {
      assert.equal(section.status, 'blocked', `${section.id}: an untraced number blocks its section`);
      assert.ok(section.reasons.includes('numeric_trace_missing'), `${section.id}: reason numeric_trace_missing`);
    }
  }
  assert.ok(e.sections.some((s: J) => s.status === 'blocked') && e.sections.some((s: J) => s.status !== 'blocked'), 'the example shows both outcomes');
  assert.equal(e.review.independent, false);
  assert.equal(e.review.label, 'same-context self-check, not independent');
  assert.equal(e.review.procedure, 'fact-check-report-qa');
}
test('AC-012: a number with no function-and-input-hash trace and no evidence id blocks its section with numeric_trace_missing; the review is labelled non-independent', () => { verifyNumericTrace(example('numeric-trace')); });
test('AC-012 mutants: an untraced number in a ready section, or an unlabelled review, is red', () => {
  const ready = example('numeric-trace'); ready.envelope.sections[1].status = 'ready'; ready.envelope.sections[1].reasons = [];
  assertRed(() => verifyNumericTrace(ready));
  const untraced = example('numeric-trace'); untraced.envelope.sections[0].numbers[0].trace = null;
  assertRed(() => verifyNumericTrace(untraced));
  const claimIndependent = example('numeric-trace'); claimIndependent.envelope.review.independent = true;
  assertRed(() => verifyNumericTrace(claimIndependent));
});
test('AC-012: the document states the trace rule, numeric_trace_missing, fact-check-report-qa and the non-independent label', () => {
  const text = contractText();
  for (const fragment of ['`numeric_trace_missing`', '`fact-check-report-qa`', '`same-context self-check, not independent`']) assert.ok(text.includes(fragment), fragment);
  assert.ok(linesOf(text).some(l => l.includes('입력') && l.includes('SHA-256') && l.includes('증거 ID')));
});

// ---- AC-015: research evidence binding -------------------------------------------------------------------------------------

function verifyResearchNote(value: J): void {
  const e = value.envelope;
  const bound = new Set<string>();
  for (const claim of e.claims) {
    if (['fact', 'calculation'].includes(claim.kind)) {
      if (claim.evidence_ids.length > 0) bound.add(claim.claim_id);
      else assert.equal(claim.excluded, true, `${claim.claim_id}: an unbound claim is excluded`);
      if (claim.kind === 'calculation') assert.equal(typeof claim.formula_id, 'string');
    }
  }
  for (const n of e.numbers) assert.ok(bound.has(n.claim_id), `number ${n.label} rests on an unbound or unknown claim`);
  assert.ok(e.claims.some((c: J) => c.excluded === true), 'the example shows an excluded unbound claim');
}
test('AC-015: fact and calculation claims need evidence ids; an unbound claim is excluded and no number rests on it', () => { verifyResearchNote(example('research-note')); });
test('AC-015 mutants: a number resting on the unbound claim, or an unbound claim left unexcluded, is red', () => {
  const number = example('research-note'); number.envelope.numbers.push({ label: 'bad', value: '1', claim_id: 'c3' });
  assertRed(() => verifyResearchNote(number));
  const kept = example('research-note'); for (const c of kept.envelope.claims) delete c.excluded;
  assertRed(() => verifyResearchNote(kept));
});
test('AC-015: the document states the binding rule and the evidence id sources', () => {
  const text = contractText();
  assert.ok(text.includes('증거 ID가 없는 주장은 숫자·계산·차트·의견에서 제외합니다'));
  assert.ok(linesOf(text).some(l => l.includes('`evidence_ids`') && l.includes('연구카드')));
});

// ---- AC-016: risk -----------------------------------------------------------------------------------------------------------

test('AC-016: risk and concentration figures come from deterministic functions only; other risk sections are not_run with risk_engine_unavailable; the two helpers are not engines', () => {
  const text = contractText();
  assert.ok(linesOf(text).some(l => l.includes('결정적 함수로만') && l.includes('`risk_engine_unavailable`') && l.includes('`not_run`')));
  assert.ok(linesOf(text).some(l => l.includes('최대낙폭') && l.includes('HHI') && l.includes('엔진이 아닙니다')));
  const e = example('risk-beyond-functions').envelope;
  assert.equal(e.status, 'not_run');
  assert.deepEqual(e.reasons, ['risk_engine_unavailable']);
  assert.ok(e.figures.every((f: J) => f.value === null));
});

// ---- AC-022 / AC-029 ---------------------------------------------------------------------------------------------------------

test('AC-022: the dependency order and the not_run rule for an unlanded earlier stage are written down in one line', () => {
  assert.ok(linesOf(contractText()).some(l => l.includes('식별·근거 기반 → 성과 원장·위험 계산 → 리서치 실행') && l.includes('`not_run`') && l.includes('착지하기 전')));
});
const ENGINE_WORDS = /백테스트 엔진|성과 원장|risk engine|리스크 엔진|shadow|모의 실행기|전략 실행 엔진|backtest engine|paper executor|원응답|raw payload/;
const ABSENCE = /없|않|아닙|아니다|아님|not_run|unavailable|미구현|미완|제외|착지하기 전|착지 전|do not|\bnot\b/;
test('AC-022 / RPT-001: every line of the contract document that names an engine, a ledger, shadow or a raw payload is an absence, not_run or distinction sentence', () => {
  assert.deepEqual(sourceLines().filter(l => ENGINE_WORDS.test(l) && !ABSENCE.test(l)), []);
});
test('AC-022 / RPT-001: the same holds for README.md, skills/** and CAPABILITIES.json (one pre-existing request-routing line reuses a received original response)', () => {
  const files = [join(ossDir, README_PATH), join(ossDir, CAPABILITIES_PATH), ...allSkillFiles()];
  const offenders = files.flatMap(path => linesOf(readFileSync(path, 'utf8')).filter(l => ENGINE_WORDS.test(l) && !ABSENCE.test(l) && !l.includes('받은 원응답과 영수증을 재사용한다')).map(l => `${relative(ossDir, path)}: ${l.slice(0, 80)}`));
  assert.deepEqual(offenders, []);
});
test('AC-022 mutant: a sentence that says an engine exists is caught (no absence marker)', () => {
  assert.equal(ABSENCE.test('백테스트 엔진이 제공됩니다'), false);
  assert.ok(ENGINE_WORDS.test('백테스트 엔진이 제공됩니다'));
});
test('RPT-001: the contract document never calls the maximum-drawdown or HHI helper an engine and never says an engine exists', () => {
  const text = contractText();
  assert.deepEqual(linesOf(text).filter(l => /최대낙폭|HHI|MDD/.test(l) && l.includes('엔진') && !l.includes('엔진이 아')), []);
  assert.equal(/(백테스트 엔진|리스크 엔진|risk engine|성과 원장|전략 실행 엔진)[^.\n]{0,12}(있습니다|제공합니다|지원합니다|구현되어)/.test(text), false);
  assert.ok(linesOf(text).some(l => l.includes('원응답이 아닙니다')), 'canonical JSON digests are not provider original responses');
});
test('AC-029: ATS not installed leaves ATP read and report features unchanged; ATS-dependent calculations are not_run or blocked with ats_not_installed and never presented as supported', () => {
  const text = contractText();
  assert.ok(text.includes('ATS가 설치되지 않아도 ATP의 읽기·보고 기능은 그대로이며'));
  assert.ok(linesOf(text).some(l => l.includes('ATS가 있어야 하는 계산') && l.includes('`not_run`') && l.includes('`blocked`') && l.includes('`ats_not_installed`')));
  const e = example('ats-not-installed').envelope;
  assert.equal(e.status, 'not_run');
  assert.deepEqual(e.reasons, ['ats_not_installed']);
  assert.notEqual(e.status, 'ready');
});

// ---- AC-028 / REQ-ATS-004 / REQ-SAF-006: no ATP-to-ATS contract, no shadow or paper contract ---------------------------

test('AC-028: the new document and the changed public documents define no ATP-to-ATS contract (no file contract schema, no strategy-file or verification-receipt names)', () => {
  const docs = [skillText(), routingText(), readmeText(), contractText()];
  for (const text of docs) {
    assert.equal(/strategy-file|verification-receipt|moai\.atp\.strategy-file|moai\.atp\.verification-receipt/.test(text), false);
    assert.equal(/"\$schema"|"properties"\s*:/.test(text), false, 'no JSON Schema definition');
  }
  const contractDirs = [join(ossDir, 'contracts'), join(ossDir, 'server', 'contracts')];
  for (const dir of contractDirs.filter(existsSync)) {
    assert.deepEqual(readdirSync(dir).filter(name => /(^|[-_.])ats([-_.]|$)|atp-ats|strategy-file|verification-receipt/i.test(name)), [], `${dir} carries an ATS-contract-named file`);
  }
});
test('REQ-SAF-006: the contract document has no shadow or paper execution contract key and says no such product exists', () => {
  const text = contractText();
  assert.equal(/paper-review|paper_trading|paper_review|shadow_executor|shadow_run|moai\.atp\.paper/.test(text), false);
  assert.ok(linesOf(text).some(l => /shadow/.test(l) && /paper/.test(l) && /없/.test(l)));
});

// ---- the contract document reason table covers every reason code the examples use ---------------------------------------------

test('M2: every reason code used by an example is listed in the reason-code table of the contract document', () => {
  const table = sectionOf(contractText(), '## 사유 코드');
  const used = new Set<string>();
  for (const id of EXAMPLE_IDS) {
    const e = envelopeOf(id);
    for (const r of e.reasons) used.add(String(r).replace(/^upstream_not_completed:.*$/, 'upstream_not_completed'));
    for (const f of e.figures ?? []) for (const r of f.reasons ?? []) used.add(r);
    for (const s of e.step_results ?? []) for (const r of s.reasons ?? []) used.add(String(r).replace(/^upstream_not_completed:.*$/, 'upstream_not_completed'));
  }
  for (const code of used) assert.ok(table.includes(`\`${code}`), `reason code ${code} is not in the table`);
});
test('M2: the contract document introduces no login / member / connected-status vocabulary (existing documentation tests stay green)', () => {
  assert.equal(/로그인|회원 인증|member_login_required|연결됨|연결 완료|검증됨/.test(contractText()), false);
});

// ---- fix 4 (sync audit D7 / D9): the planner claim is qualified in SKILL.md; backtest example (d) follows the first-match table --------------------------
// D7: the planner classifies by patterns and never claims completeness. SKILL.md says so in an added paragraph (the earlier sentences stay as they are), and says that
// the normative rule (no tool call, fixed sentence F or F_T) does not depend on the planner status.
test('fix4 D7: SKILL.md says the planner classifies by patterns and cannot catch every phrasing, that blocked / unsupported plans carry no steps and no provider call, and that no order tool exists', () => {
  const lines = linesOf(skillText()).filter(l => l.includes('정해 둔 말 꼴(패턴)'));
  assert.equal(lines.length, 1, 'exactly one added paragraph carries the planner-limit statement');
  const line = lines[0]!;
  for (const piece of ['모든 표현을 잡아내지는 못합니다', '단계도 공급자 호출도', '주문·이체·계좌 도구', '고정 문장 F', 'F_T', '계획 상태가 이 규칙을 바꾸지 않습니다']) {
    assert.ok(line.includes(piece), `the planner-limit paragraph lacks: ${piece}`);
  }
});
test('fix4 D7: the earlier trade-block sentence of SKILL.md is still in place (the qualification is added next to it, not instead of it)', () => {
  assert.ok(skillText().includes('계획이 `blocked`(`orders_or_transfers`)와 단계 0개로 막습니다'));
  assert.ok(skillText().includes(TRADE_SENTENCE_CORE));
});

// D9: the pinned synthetic specification uses `signal.formula_id` (a t35 specification shape), which is outside the closed rule grammar of the t36 limited backtest, so the first match for
// "calculator and specification assumed, no history" is the rule-grammar row, which comes before the no-history row.
test('fix4 D9: example backtest-d states that the specification rule is outside the v1 grammar and is blocked with rule_unsupported (the rule row comes before the no-history row)', () => {
  const value = example('backtest-d');
  assert.equal(value.request.strategy_spec_present, true);
  assert.equal(value.request.calculator_present, true);
  assert.equal(value.request.validated_history_present, false);
  assert.equal(value.request.strategy_rule_in_v1_grammar, false);
  assert.deepEqual({ status: value.envelope.status, reasons: value.envelope.reasons }, { status: 'blocked', reasons: ['rule_unsupported'] });
  verifyBacktest('backtest-d', BT_ROWS, value);
});
test('fix4 D9: the flag matches the pinned specification (its signal has formula_id and no closed-grammar rule key)', () => {
  const spec = example('strategy-spec');
  assert.equal(typeof spec.signal.formula_id, 'string');
  assert.equal('rule' in spec.signal, false);
});
test('fix4 D9: the example list line for (d) names rule_unsupported and the rule row, not the no-history row', () => {
  const line = linesOf(contractText()).find(l => l.startsWith('- (d)'));
  assert.ok(line !== undefined, 'the (d) list line is missing');
  assert.ok(line.includes('`rule_unsupported`') && line.includes('판정표 5행'), line);
  assert.equal(line.includes('판정표 6행') || line.includes('`validated_history_unavailable`'), false, line);
});
test('fix4 D9 mutant: dropping the rule row from the first-match table turns example (d) red', () => {
  assertRed(() => verifyBacktest('backtest-d', BT_ROWS.filter(r => r.row !== 5)), 'rule row dropped');
});

// ---- fix 5 (sync re-audit D-R3): example (d') reaches row 6 of the first-match table -------------------------------------------------------------------
// (d') carries a specification INSIDE the closed v1 rule grammar of the t36 limited backtest (`signal: {rule: "close_above_sma", window: N}`, one instrument, long only, positive initial cash), its own
// spec_sha256 (recomputed here exactly as for the pinned strategy-spec example) and no history. Rows 0 to 5 do not apply to it, so the first match is row 6 (`validated_history_unavailable`, `not_run`).
// The row excerpt is BT_ROWS, the same copy the (a) to (d) tests use, so deleting row 6 from it turns this test red (the diagnostic mutant that survived after 7891b89).
const D_PRIME = 'backtest-d-prime' as const;
const SPEC_TOP_KEYS: readonly string[] = [...ENVELOPE_KEYS, 'strategy_id', 'version', 'universe', 'signal', 'entry_timing', 'exit_timing', 'sizing', 'constraints', 'invalidation_rules', 'undecided_rules',
  'required_data', 'cost_fill_assumptions', 'source_ledger', 'validation_plan', 'spec_sha256'];
const DECIMAL_STRING = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
function ruleInV1Grammar(spec: J): boolean {
  const signal = spec.signal;
  return Array.isArray(spec.universe) && spec.universe.length === 1 && spec.constraints?.long_only === true
    && signal !== null && typeof signal === 'object' && JSON.stringify(Object.keys(signal).sort()) === JSON.stringify(['rule', 'window'])
    && signal.rule === 'close_above_sma' && Number.isInteger(signal.window) && signal.window >= 2 && signal.window <= 200;
}
function verifyDPrime(rows: readonly BtRow[], value: J = example(D_PRIME)): void {
  const spec = value.request.strategy_spec;
  const e = value.envelope;
  assert.ok(spec !== null && typeof spec === 'object', 'd-prime: the supplied specification is part of the request');
  // Rows 0 to 5 computed from the example itself, not from flags: none of them may apply.
  assert.equal(value.request.calculator_present, true, 'd-prime: row 0 does not apply (a calculator is assumed)');
  assert.deepEqual(Object.keys(spec).filter(k => !SPEC_TOP_KEYS.includes(k)), [], 'd-prime: row 1, only strategy-specification top-level keys');
  for (const decimal of [spec.sizing.initial_cash, spec.sizing.position_fraction]) assert.match(decimal, DECIMAL_STRING, 'd-prime: row 1, decimal strings');
  assert.ok(Number(spec.sizing.initial_cash) > 0, 'd-prime: row 2a does not apply (initial_cash > 0)');
  assert.equal(value.request.strategy_spec_present, true, 'd-prime: row 3 does not apply (a specification is present)');
  assert.equal(spec.spec_sha256, specHash(spec), 'd-prime: row 4 does not apply (the stated hash equals the recomputed one)');
  assert.equal(e.strategy_spec_sha256, spec.spec_sha256, 'd-prime: the result carries the hash of the supplied specification');
  assert.equal(ruleInV1Grammar(spec), true, 'd-prime: row 5 does not apply (the rule is inside the v1 grammar)');
  assert.equal(value.request.strategy_rule_in_v1_grammar, true, 'd-prime: the flag matches the specification');
  assert.equal(value.request.validated_history_present, false);
  // First match.
  const decided = decideBacktest(rows, value.request);
  assert.ok(decided, 'd-prime: the decision table has a first match');
  assert.equal(rows.find(r => r.applies(value.request))!.row, 6, 'd-prime: the first match is row 6');
  assert.equal(e.status, decided.status, 'd-prime: status');
  assert.deepEqual(e.reasons, decided.reasons, 'd-prime: reasons');
  assert.equal(e.contract, 'moai.atp.backtest-result.v1');
  assert.equal(e.procedure, 'backtest');
  assert.equal(e.experiment.strategy_id, spec.strategy_id, 'd-prime: carries the experiment it would have run');
  assert.equal(e.metrics, null);
  assert.equal(e.simulated_fills, null);
  assert.equal(e.execution_receipt, null);
  for (const section of ['out_of_sample', 'walk_forward', 'cost_sensitivity', 'leakage_checks', 'multiple_experiments']) assert.equal(e.sections[section], null, `d-prime: ${section} null`);
  assert.ok(typeof value.request.assumption === 'string' && value.request.assumption.length > 0, 'd-prime: a calculator is only ever a labelled synthetic assumption');
}
test("fix5 D-R3: example backtest-d-prime (specification inside the v1 grammar, calculator assumed, no history) first-matches row 6 and is not_run with validated_history_unavailable", () => {
  const value = example(D_PRIME);
  assert.deepEqual({ status: value.envelope.status, reasons: value.envelope.reasons }, { status: 'not_run', reasons: ['validated_history_unavailable'] });
  verifyDPrime(BT_ROWS, value);
});
test("fix5 D-R3: the specification of (d') differs from the pinned strategy-spec example and carries its own recomputed spec_sha256", () => {
  const dPrime = example(D_PRIME).request.strategy_spec;
  const pinned = example('strategy-spec');
  assert.notEqual(dPrime.spec_sha256, pinned.spec_sha256);
  assert.match(dPrime.spec_sha256, /^[0-9a-f]{64}$/);
  assert.equal(dPrime.spec_sha256, specHash(dPrime));
  assert.deepEqual(dPrime.signal, { rule: 'close_above_sma', window: 20 });
});
test("fix5 D-R3: the (d') list line names validated_history_unavailable and the no-history row, not the rule row, and the (d) paragraph no longer says the document has no such example", () => {
  const line = linesOf(contractText()).find(l => l.startsWith("- (d')"));
  assert.ok(line !== undefined, "the (d') list line is missing");
  assert.ok(line.includes('`validated_history_unavailable`') && line.includes('`not_run`') && line.includes('판정표 6행'), line);
  assert.equal(line.includes('판정표 5행') || line.includes('`rule_unsupported`'), false, line);
  assert.equal(contractText().includes('이 문서는 그 모양을 예시로 싣지 않습니다'), false, 'the earlier sentence that denied this example is still there');
});
test("fix5 D-R3 mutant: deleting row 6 from the test's copy of the first-match table turns example (d') red (the survivor of the re-audit)", () => {
  assertRed(() => verifyDPrime(BT_ROWS.filter(r => r.row !== 6)), 'row 6 dropped');
});
test("fix5 D-R3 mutants: a wrong flag, a rule outside the grammar, a wrong hash, a present history, a blocked status, a window outside 2..200, a zero cash or an unknown key each turn example (d') red", () => {
  const flag = example(D_PRIME); flag.request.strategy_rule_in_v1_grammar = false;
  assertRed(() => verifyDPrime(BT_ROWS, flag), 'flag false');
  const rule = example(D_PRIME); rule.request.strategy_spec.signal = { formula_id: 'synthetic.sma_cross', inputs: ['daily_close'], fast_window: 5, slow_window: 20 };
  assertRed(() => verifyDPrime(BT_ROWS, rule), 'rule outside grammar');
  const hash = example(D_PRIME); hash.request.strategy_spec.spec_sha256 = '0'.repeat(64); hash.envelope.strategy_spec_sha256 = '0'.repeat(64);
  assertRed(() => verifyDPrime(BT_ROWS, hash), 'wrong hash');
  const history = example(D_PRIME); history.request.validated_history_present = true;
  assertRed(() => verifyDPrime(BT_ROWS, history), 'history present');
  const blocked = example(D_PRIME); blocked.envelope.status = 'blocked'; blocked.envelope.reasons = ['rule_unsupported'];
  assertRed(() => verifyDPrime(BT_ROWS, blocked), 'blocked status');
  const window = example(D_PRIME); window.request.strategy_spec.signal.window = 1; window.request.strategy_spec.spec_sha256 = specHash(window.request.strategy_spec); window.envelope.strategy_spec_sha256 = window.request.strategy_spec.spec_sha256;
  assertRed(() => verifyDPrime(BT_ROWS, window), 'window outside 2..200');
  const cash = example(D_PRIME); cash.request.strategy_spec.sizing.initial_cash = '0'; cash.request.strategy_spec.spec_sha256 = specHash(cash.request.strategy_spec); cash.envelope.strategy_spec_sha256 = cash.request.strategy_spec.spec_sha256;
  assertRed(() => verifyDPrime(BT_ROWS, cash), 'non-positive initial cash (row 2a)');
  const key = example(D_PRIME); key.request.strategy_spec.experiment = { trials: 1 };
  assertRed(() => verifyDPrime(BT_ROWS, key), 'unknown top-level key (row 1)');
});

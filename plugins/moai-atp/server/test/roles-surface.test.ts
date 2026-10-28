// SPEC-ATP-ROLES-001 M3 (card t35): the twelve static order-path / ATS-surface checks of design.md 5.1 applied to the
// plugin root, plus synthetic mutation trees (AC-017: eleven order mutants, AC-027: six ATS mutants, one upper-case
// ATS mutant that only this product test covers, and benign controls). The mutation trees are written to a temp
// directory outside the repository; nothing here starts a server, reads a credential or touches the network.
//
// The checks are a port of the plan-phase probe `order-surface-probe-v3.py` (word-boundary form). One deliberate
// difference, required by design.md 5.1 (audit O5): the ATS tool-reference check in skill documents ignores case, so
// `ATS_RUN_STRATEGY` is caught. The probe's case-sensitive regex misses it (a recorded probe limitation).
//
// One documented carve-out: the reason code `ats_not_installed` (design.md 6, REQ-ATS-005) names a result reason, not
// a tool, and the internal contract document must spell it. Only the exact codes listed in ATS_REASON_CODES are
// exempt; any other `ats_*` token, the upper-case form of those codes, and every tool/server/switch name stays a hit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// dist/test/<this file>.js -> plugins/moai-atp/ is three levels up.
const pluginRoot = fileURLToPath(new URL('../../../', import.meta.url));

const FORBIDDEN_TOOL = /order|transfer|trade|buy|sell|cancel|withdraw|deposit|submit|place|amend|revise/i;
const TOOL_EXCEPTIONS = new Set(['get_market_orderbook']);
const ACCOUNT_TOOL = /account|balance/i;
const ACCOUNT_EXCEPTIONS = new Set(['get_credit_balances']);
const ORDER_REFS = /\b(?:place_order|cancel_order|modify_order|amend_order|submit_order|order_cash|order_credit|transfer_funds|transfer_money)\b|trading\/order(?!-resv-(?:ccnl|list))|\bT[TS]TC0(?:80[12]|01[23])U\b|\bVTTC080[12]U\b/g;
const ENV_FORBIDDEN = /ORDER|TRADE|TRANSFER|ACCOUNT/i;
const SCHEDULE_REFS = /\b(?:cron|crontab|launchd|schtasks|scheduled_task|automation\.toml)\b/gi;
const ATS_NAME_CAMEL = /^ats[A-Z0-9]/;
const ATS_NAME_CI = /(?:^|[_\-.])ats(?:[_\-.]|$)|agentic[_\-]?trading/i;
// Document references (design.md 5.1): the snake / hyphen forms ignore case, the camelCase form keeps its capital.
const ATS_REF_SNAKE = /(?<![A-Za-z0-9])ats_[a-z0-9_]+\b|\bmoai-ats\b|\bats-(?:server|bridge|connector)\b/gi;
const ATS_REF_CAMEL = /(?<![A-Za-z0-9])ats[A-Z][A-Za-z0-9]+\b/g;
const ATS_REASON_CODES: ReadonlySet<string> = new Set(['ats_not_installed', 'ats_scope_unsupported']);
const PAPER_SHADOW_CONTRACT_KEYS = /paper-review|paper_trading|paper_review|shadow_executor|shadow_run|moai\.atp\.paper/;

const CHECK_NAMES = [
  'mcp_servers_exact',
  'mcp_env_no_order_switch',
  'capabilities_no_order_or_account_tool',
  'capabilities_trading_false',
  'capabilities_accounts_false',
  'every_skill_explicit_only',
  'skills_no_order_tool_or_endpoint_reference',
  'skills_no_scheduler_reference',
  'plugin_json_no_permissions_or_commands_key',
  'exactly_one_public_skill_goose',
  'no_ats_tool_server_or_switch',
  'skills_no_ats_tool_reference',
] as const;
type Checks = Record<(typeof CHECK_NAMES)[number], boolean>;

const readJson = (root: string, rel: string): any => JSON.parse(readFileSync(join(root, rel), 'utf8'));

function skillFiles(root: string, extensions: readonly string[]): string[] {
  const base = join(root, 'skills');
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (extensions.some(ext => name.endsWith(ext))) out.push(path);
    }
  };
  if (existsSync(base)) walk(base);
  return out;
}

/** Matches of the ATS tool-reference regexes in one document, minus the exact allow-listed reason codes. */
export function atsReferenceHits(text: string): string[] {
  const snake = [...text.matchAll(ATS_REF_SNAKE)].map(m => m[0]).filter(hit => !ATS_REASON_CODES.has(hit));
  const camel = [...text.matchAll(ATS_REF_CAMEL)].map(m => m[0]);
  return [...snake, ...camel];
}

export function surface(root: string): { checks: Checks; skillDirs: string[]; atsNamed: string[]; atsRefHits: Record<string, number> } {
  const mcp = readJson(root, 'mcp.json');
  const servers: string[] = Object.keys(mcp.mcpServers ?? {}).sort();
  const envKeys: string[] = Object.values<any>(mcp.mcpServers ?? {}).flatMap(s => Object.keys(s.env ?? {})).sort();
  const cap = readJson(root, 'CAPABILITIES.json');
  const tools: string[] = Array.isArray(cap.tools) ? cap.tools : [];
  const badTools = tools.filter(t => (FORBIDDEN_TOOL.test(t) && !TOOL_EXCEPTIONS.has(t)) || (ACCOUNT_TOOL.test(t) && !ACCOUNT_EXCEPTIONS.has(t)));
  const skillsDir = join(root, 'skills');
  const skillDirs = (existsSync(skillsDir) ? readdirSync(skillsDir) : [])
    .filter(name => existsSync(join(skillsDir, name, 'SKILL.md')))
    .sort();
  const implicit = skillDirs.map(name => {
    const yamlPath = join(skillsDir, name, 'agents', 'openai.yaml');
    if (!existsSync(yamlPath)) return 'missing_openai_yaml';
    const m = /^\s*allow_implicit_invocation:\s*(\S+)\s*$/m.exec(readFileSync(yamlPath, 'utf8'));
    return m ? m[1] : 'absent';
  });
  const orderHits: Record<string, number> = {};
  const scheduleHits: Record<string, number> = {};
  for (const path of skillFiles(root, ['.md', '.yaml', '.json'])) {
    const rel = relative(root, path).split(sep).join('/');
    if (rel.split('/').includes('portfolio-risk')) continue; // preserved internal design, not routed
    const text = readFileSync(path, 'utf8');
    const o = [...text.matchAll(ORDER_REFS)].length;
    if (o) orderHits[rel] = o;
    const s = [...text.matchAll(SCHEDULE_REFS)].length;
    if (s) scheduleHits[rel] = s;
  }
  const plugin = readJson(root, 'plugin.json');
  const atsNamed = [...servers, ...envKeys, ...tools].filter(n => ATS_NAME_CAMEL.test(n) || ATS_NAME_CI.test(n));
  const atsRefHits: Record<string, number> = {};
  for (const path of skillFiles(root, ['.md', '.yaml', '.json'])) {
    const n = atsReferenceHits(readFileSync(path, 'utf8')).length;
    if (n) atsRefHits[relative(root, path).split(sep).join('/')] = n;
  }
  const checks: Checks = {
    mcp_servers_exact: JSON.stringify(servers) === JSON.stringify(['moai-kis-readonly']),
    mcp_env_no_order_switch: !envKeys.some(k => ENV_FORBIDDEN.test(k)),
    capabilities_no_order_or_account_tool: badTools.length === 0,
    capabilities_trading_false: cap.trading === false,
    capabilities_accounts_false: cap.accounts === false,
    every_skill_explicit_only: implicit.every(v => v === 'false'),
    skills_no_order_tool_or_endpoint_reference: Object.keys(orderHits).length === 0,
    skills_no_scheduler_reference: Object.keys(scheduleHits).length === 0,
    plugin_json_no_permissions_or_commands_key: !['permissions', 'commands', 'hooks'].some(k => k in plugin),
    exactly_one_public_skill_goose: JSON.stringify(skillDirs) === JSON.stringify(['goose']),
    no_ats_tool_server_or_switch: atsNamed.length === 0,
    skills_no_ats_tool_reference: Object.keys(atsRefHits).length === 0,
  };
  return { checks, skillDirs, atsNamed, atsRefHits };
}

const failedChecks = (root: string): string[] => Object.entries(surface(root).checks).filter(([, ok]) => !ok).map(([name]) => name).sort();

// ---- synthetic trees (port of the probe's synth()) -------------------------------------------------------------------

type Mutant =
  | 'baseline' | 'control_benign_words' | 'control_reason_code_prose'
  | 'order_mcp_server' | 'order_env_switch' | 'order_tool_name' | 'account_tool_name' | 'trading_flag_true' | 'skill_calls_order_tool'
  | 'skill_order_endpoint' | 'implicit_invocation_true' | 'scheduled_task' | 'permissions_key' | 'second_public_skill'
  | 'ats_placeholder_tool' | 'ats_camelcase_tool' | 'ats_mcp_server' | 'ats_env_switch' | 'skill_calls_ats_tool' | 'skill_calls_ats_tool_uppercase'
  | 'skill_ats_reason_code_with_suffix' | 'skill_ats_reason_code_uppercase' | 'accounts_flag_true';

function synth(root: string, mutant: Mutant): void {
  mkdirSync(join(root, 'skills', 'goose', 'agents'), { recursive: true });
  const mcp: any = { mcpServers: { 'moai-kis-readonly': { type: 'stdio', command: 'node', args: ['x'], env: { GOOSE_KIS_READ_ENABLED: '1' } } } };
  const cap: any = { tools: ['get_market_snapshot', 'get_market_orderbook', 'get_credit_balances'], trading: false, accounts: false, public_skills: ['goose'] };
  const pj: any = { name: 'synthetic' };
  let skill = '---\nname: goose\ndescription: synthetic\n---\n# synthetic\n';
  let yaml = 'interface:\n  display_name: "synthetic"\npolicy:\n  allow_implicit_invocation: false\n';
  switch (mutant) {
    case 'order_mcp_server': mcp.mcpServers['kis-order'] = { type: 'stdio', command: 'node', args: ['y'] }; break;
    case 'order_env_switch': mcp.mcpServers['moai-kis-readonly'].env.GOOSE_KIS_ORDER_ENABLED = '1'; break;
    case 'order_tool_name': cap.tools.push('place_order'); break;
    case 'account_tool_name': cap.tools.push('get_account_snapshot'); break;
    case 'trading_flag_true': cap.trading = true; break;
    case 'accounts_flag_true': cap.accounts = true; break;
    case 'skill_calls_order_tool': skill += '\nWhen the user confirms, call `place_order`.\n'; break;
    case 'skill_order_endpoint': skill += '\nPOST /uapi/domestic-stock/v1/trading/order-cash\n'; break;
    case 'implicit_invocation_true': yaml = yaml.replace('false', 'true'); break;
    case 'scheduled_task': skill += '\nRegister a cron job that runs this every morning.\n'; break;
    case 'permissions_key': pj.permissions = ['orders']; break;
    case 'ats_placeholder_tool': cap.tools.push('ats_strategy_handoff'); break; // no order verb: only the ATS check can catch it
    case 'ats_camelcase_tool': cap.tools.push('atsHandoff'); break;
    case 'ats_mcp_server': mcp.mcpServers['moai-ats'] = { type: 'stdio', command: 'node', args: ['z'] }; break;
    case 'ats_env_switch': mcp.mcpServers['moai-kis-readonly'].env.GOOSE_ATS_ENABLED = '1'; break;
    case 'skill_calls_ats_tool': skill += '\nHand the strategy to `ats_run_strategy`.\n'; break;
    case 'skill_calls_ats_tool_uppercase': skill += '\nHand the strategy to `ATS_RUN_STRATEGY`.\n'; break;
    case 'skill_ats_reason_code_with_suffix': skill += '\nReason `ats_not_installed_tool` is returned.\n'; break;
    case 'skill_ats_reason_code_uppercase': skill += '\nReason `ATS_NOT_INSTALLED` is returned.\n'; break;
    case 'second_public_skill':
      mkdirSync(join(root, 'skills', 'ats'), { recursive: true });
      writeFileSync(join(root, 'skills', 'ats', 'SKILL.md'), '---\nname: ats\n---\n', 'utf8');
      break;
    case 'control_benign_words': skill += '\nThe stats_summary and formats_list tables beat the baseline; ATS is a separate system.\n'; break;
    case 'control_reason_code_prose': skill += '\nWhen the separate system is not installed the result is not_run with reason `ats_not_installed`.\n'; break;
    case 'baseline': break;
  }
  writeFileSync(join(root, 'mcp.json'), JSON.stringify(mcp), 'utf8');
  writeFileSync(join(root, 'CAPABILITIES.json'), JSON.stringify(cap), 'utf8');
  writeFileSync(join(root, 'plugin.json'), JSON.stringify(pj), 'utf8');
  writeFileSync(join(root, 'skills', 'goose', 'SKILL.md'), skill, 'utf8');
  writeFileSync(join(root, 'skills', 'goose', 'agents', 'openai.yaml'), yaml, 'utf8');
}

const scratch = mkdtempSync(join(tmpdir(), 'roles-surface-'));
test.after(() => { rmSync(scratch, { recursive: true, force: true }); });
function tree(mutant: Mutant): string {
  const root = join(scratch, mutant);
  if (!existsSync(root)) synth(root, mutant);
  return root;
}

// ---- the plugin root --------------------------------------------------------------------------------------------------

test('AC-017/AC-027 plugin root: all twelve static checks are true and the public skill set is exactly goose', () => {
  const result = surface(pluginRoot);
  assert.deepEqual(Object.keys(result.checks), [...CHECK_NAMES], 'the check list is the twelve of design.md 5.1, in order');
  assert.deepEqual(Object.entries(result.checks).filter(([, ok]) => !ok).map(([name]) => name), []);
  assert.deepEqual(result.skillDirs, ['goose']);
  assert.deepEqual(result.atsNamed, []);
  assert.deepEqual(result.atsRefHits, {});
});

test('AC-017 plugin root: MCP servers exactly {moai-kis-readonly}, env keys carry no order/trade/transfer/account word', () => {
  const mcp = readJson(pluginRoot, 'mcp.json');
  assert.deepEqual(Object.keys(mcp.mcpServers), ['moai-kis-readonly']);
  const envKeys = Object.values<any>(mcp.mcpServers).flatMap(s => Object.keys(s.env ?? {}));
  assert.ok(envKeys.length > 0, 'a clean scan of zero keys would be vacuous');
  assert.deepEqual(envKeys.filter(k => ENV_FORBIDDEN.test(k)), []);
});

test('AC-017 plugin root: CAPABILITIES tool names carry no order/account name, trading and accounts stay false, 36 tools', () => {
  const cap = readJson(pluginRoot, 'CAPABILITIES.json');
  assert.equal(cap.tools.length, 36);
  assert.deepEqual(cap.tools.filter((t: string) => (FORBIDDEN_TOOL.test(t) && !TOOL_EXCEPTIONS.has(t)) || (ACCOUNT_TOOL.test(t) && !ACCOUNT_EXCEPTIONS.has(t))), []);
  assert.equal(cap.trading, false);
  assert.equal(cap.accounts, false);
});

test('AC-017 plugin root: every skill is explicit-invocation only and plugin.json declares no permissions, commands or hooks', () => {
  const yamlText = readFileSync(join(pluginRoot, 'skills', 'goose', 'agents', 'openai.yaml'), 'utf8');
  assert.match(yamlText, /^\s*allow_implicit_invocation:\s*false\s*$/m);
  const pj = readJson(pluginRoot, 'plugin.json');
  for (const key of ['permissions', 'commands', 'hooks']) assert.equal(key in pj, false, key);
});

test('AC-017/AC-022 plugin root: no separate shadow or paper execution contract key anywhere in the skill documents', () => {
  const hits = skillFiles(pluginRoot, ['.md', '.yaml', '.json']).flatMap(path =>
    readFileSync(path, 'utf8').split(/\r?\n/).map((line, i) => ({ path: relative(pluginRoot, path), line: i + 1, text: line })).filter(h => PAPER_SHADOW_CONTRACT_KEYS.test(h.text)),
  );
  assert.deepEqual(hits, []);
});

test('the paper/shadow contract-key grep is discriminating: it flags a planted contract key and not prose', () => {
  assert.ok(PAPER_SHADOW_CONTRACT_KEYS.test('"contract": "moai.atp.paper-review.v1"'));
  assert.ok(PAPER_SHADOW_CONTRACT_KEYS.test('shadow_run: true'));
  assert.equal(PAPER_SHADOW_CONTRACT_KEYS.test('no separate shadow or paper product exists'), false);
});

// ---- synthetic baseline, controls and mutants ----------------------------------------------------------------------------

test('synthetic baseline and benign controls are green (no false positive on stats_summary, formats_list, prose "ATS", reason code prose)', () => {
  for (const mutant of ['baseline', 'control_benign_words', 'control_reason_code_prose'] as const) {
    assert.deepEqual(failedChecks(tree(mutant)), [], mutant);
  }
});

// AC-017: eleven order-path mutants, each turns its check red.
const ORDER_MUTANTS: ReadonlyArray<readonly [Mutant, string]> = [
  ['order_mcp_server', 'mcp_servers_exact'],
  ['order_env_switch', 'mcp_env_no_order_switch'],
  ['order_tool_name', 'capabilities_no_order_or_account_tool'],
  ['account_tool_name', 'capabilities_no_order_or_account_tool'],
  ['trading_flag_true', 'capabilities_trading_false'],
  ['skill_calls_order_tool', 'skills_no_order_tool_or_endpoint_reference'],
  ['skill_order_endpoint', 'skills_no_order_tool_or_endpoint_reference'],
  ['implicit_invocation_true', 'every_skill_explicit_only'],
  ['scheduled_task', 'skills_no_scheduler_reference'],
  ['permissions_key', 'plugin_json_no_permissions_or_commands_key'],
  ['second_public_skill', 'exactly_one_public_skill_goose'],
];
test('AC-017 size: eleven order-path mutants', () => { assert.equal(ORDER_MUTANTS.length, 11); });
for (const [mutant, expected] of ORDER_MUTANTS) {
  test(`AC-017 order mutant ${mutant} is red on ${expected}`, () => {
    const failed = failedChecks(tree(mutant));
    assert.ok(failed.includes(expected), `${mutant}: failed checks ${JSON.stringify(failed)}`);
  });
}
test('accounts flag mutant is red (extra to the eleven, same gate)', () => {
  assert.ok(failedChecks(tree('accounts_flag_true')).includes('capabilities_accounts_false'));
});

// AC-027: six ATS mutants, one upper-case mutant only this test covers.
const ATS_MUTANTS: ReadonlyArray<readonly [Mutant, string]> = [
  ['ats_placeholder_tool', 'no_ats_tool_server_or_switch'],
  ['ats_camelcase_tool', 'no_ats_tool_server_or_switch'],
  ['ats_mcp_server', 'no_ats_tool_server_or_switch'],
  ['ats_env_switch', 'no_ats_tool_server_or_switch'],
  ['skill_calls_ats_tool', 'skills_no_ats_tool_reference'],
  ['second_public_skill', 'exactly_one_public_skill_goose'],
];
test('AC-027 size: six ATS mutants', () => { assert.equal(ATS_MUTANTS.length, 6); });
for (const [mutant, expected] of ATS_MUTANTS) {
  test(`AC-027 ATS mutant ${mutant} is red on ${expected}`, () => {
    const failed = failedChecks(tree(mutant));
    assert.ok(failed.includes(expected), `${mutant}: failed checks ${JSON.stringify(failed)}`);
  });
}
test('AC-027 the placeholder tool carries no order verb, so only the ATS check catches it', () => {
  assert.deepEqual(failedChecks(tree('ats_placeholder_tool')), ['no_ats_tool_server_or_switch']);
  assert.deepEqual(failedChecks(tree('ats_camelcase_tool')), ['no_ats_tool_server_or_switch']);
});
test('AC-027 upper-case ATS_RUN_STRATEGY in a skill document is red (the probe misses this form; design.md 5.1 requires case-insensitive)', () => {
  assert.deepEqual(failedChecks(tree('skill_calls_ats_tool_uppercase')), ['skills_no_ats_tool_reference']);
});

test('the exact reason code ats_not_installed is not a tool reference, but any variant of it is', () => {
  assert.deepEqual(atsReferenceHits('reason `ats_not_installed` and `ats_scope_unsupported`'), []);
  assert.deepEqual(failedChecks(tree('control_reason_code_prose')), []);
  assert.deepEqual(atsReferenceHits('reason `ats_not_installed_tool`'), ['ats_not_installed_tool']);
  assert.deepEqual(atsReferenceHits('reason `ATS_NOT_INSTALLED`'), ['ATS_NOT_INSTALLED']);
  assert.deepEqual(failedChecks(tree('skill_ats_reason_code_with_suffix')), ['skills_no_ats_tool_reference']);
  assert.deepEqual(failedChecks(tree('skill_ats_reason_code_uppercase')), ['skills_no_ats_tool_reference']);
});

test('AC-027 word-boundary regexes: stats_summary, formats_list, beats_x and prose ATS are not hits; moai-ats and ats-bridge are', () => {
  assert.deepEqual(atsReferenceHits('stats_summary formats_list beats_x ATS is a separate system'), []);
  assert.deepEqual(atsReferenceHits('call moai-ats then ats-bridge'), ['moai-ats', 'ats-bridge']);
  assert.deepEqual(atsReferenceHits('use atsHandoff'), ['atsHandoff']);
});

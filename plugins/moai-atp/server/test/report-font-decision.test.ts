// Issue #119 (user decision 2026-11-11, recorded in #18): the report template's title font (h2) is
// Pretendard and the description body is ChosunilboMyeongjo (조선일보명조). The check resolves the
// effective font-family for those roles from the rendered artboard-v2 page the way the browser
// cascade would for these rules: among rules naming the same selector atom, the highest-specificity
// declaration wins, ties broken by position; var() chains resolve against the last definition.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReportInput, renderReportInputHtml } from '../src/report-pipeline.js';

const render = renderReportInputHtml as (value: unknown, template?: string) => string;
const received = '2026-11-11T04:00:00.000Z';
const page = (): string => render(buildReportInput({ report_id: 'R01', subject: { id: '000660', name: '검토용 종목', venue: 'KRX', currency: 'KRW' }, cutoff: received, display_timezone: 'Asia/Seoul', received_at: received }), 'artboard-v2');

const cssOf = (page: string): string => /<style>([\s\S]*?)<\/style>/.exec(page)?.[1] ?? '';
const stripNoise = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\{[^}]*\}/g, '');

type Rule = { atom: string; spec: number; order: number; body: string };
function collectRules(css: string): Rule[] {
  const out: Rule[] = [];
  let order = 0;
  const spec = (atom: string): number => 100 * (atom.match(/#/g)?.length ?? 0) + (atom.match(/\./g)?.length ?? 0);
  const walk = (text: string): void => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const prelude = text.slice(i, open).trim();
      if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
        let depth = 1;
        let j = open + 1;
        while (j < text.length && depth > 0) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
        walk(text.slice(open + 1, j - 1));
        i = j;
        continue;
      }
      const close = text.indexOf('}', open);
      if (close < 0) break;
      for (const atom of prelude.split(',')) {
        const a = atom.trim();
        if (a && !a.startsWith('@')) out.push({ atom: a, spec: spec(a), order, body: text.slice(open + 1, close) });
      }
      order++;
      i = close + 1;
    }
  };
  walk(stripNoise(css));
  return out;
}

const familyDecl = (body: string): string | undefined => {
  for (const decl of body.split(';')) {
    const [prop, ...rest] = decl.split(':');
    const value = rest.join(':').trim();
    if (prop?.trim() === 'font-family' && value) return value;
    if (prop?.trim() === 'font' && value) {
      const last = value.split(/\s+/).pop()!;
      if (last.includes('var(') || last.includes("'") || last.includes('"') || /[A-Za-z-]/.test(last) === false) return last;
    }
  }
  return undefined;
};

const vars = (rules: Rule[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const rule of rules) {
    for (const decl of rule.body.split(';')) {
      const [prop, ...rest] = decl.split(':');
      const name = prop?.trim() ?? '';
      if (name.startsWith('--') && rest.length) out[name] = rest.join(':').trim();
    }
  }
  return out;
};

const resolveVar = (value: string, map: Record<string, string>): string => {
  let current = value;
  for (let guard = 0; /var\(--/.test(current) && guard < 10; guard++) current = current.replace(/var\((--[a-z-]+)\)/g, (_, name: string) => map[name] ?? '');
  return current;
};

// The role's computed first family, resolved exactly the way the cascade decides it.
const computedFamily = (css: string, atom: string): string => {
  const rules = collectRules(css);
  const map = vars(rules);
  const candidates = rules.filter((rule) => rule.atom === atom).map((rule) => ({ spec: rule.spec, order: rule.order, family: familyDecl(rule.body) })).filter((c) => c.family);
  assert.ok(candidates.length > 0, `some rule sets a family for ${atom}`);
  candidates.sort((a, b) => a.spec - b.spec || a.order - b.order);
  return resolveVar(candidates[candidates.length - 1]!.family!, map).split(',')[0]!.trim().replace(/^"|"$/g, '');
};

const lastSerifVar = (css: string): string => {
  const map = vars(collectRules(css));
  assert.ok(map['--serif'], 'the rendered css defines --serif');
  return map['--serif']!;
};

test('#119: every h2 — section titles and the hero subtitle (h1+h2) — computes Pretendard', () => {
  const css = cssOf(page());
  assert.equal(computedFamily(css, 'h2'), 'Pretendard', 'bare h2 (typography layer)');
  assert.equal(computedFamily(css, '.rs h2'), 'Pretendard', 'scoped section h2');
  assert.equal(computedFamily(css, '.rs h1+h2'), 'Pretendard', 'hero subtitle h1+h2 — the measured "현재 템플릿 h2(Gowun Batang)"');
});

test('#119: the description body prose computes 조선일보명조 (ChosunilboNM installed stack)', () => {
  const css = cssOf(page());
  for (const atom of ['.lead-summary p', '.rs .panel p', '.report-hero blockquote p', '.opinion p']) {
    assert.equal(computedFamily(css, atom), 'ChosunilboNM', `${atom} prose`);
  }
  assert.equal(lastSerifVar(css), 'ChosunilboNM,"조선일보명조",AppleMyungjo,Batang,serif', 'the serif role is the decided installed stack');
});

test('#119: the serif role stays installed-fonts-plus-generic — no web font enters it (#52 D6 method)', () => {
  const stack = lastSerifVar(cssOf(page()));
  for (const webfont of ['Gowun Batang', 'MaruBuri', 'Pretendard']) assert.ok(!stack.includes(webfont), `${webfont} stays out of the serif stack`);
  assert.match(stack, /serif$/, 'the stack ends in a generic serif fallback');
});

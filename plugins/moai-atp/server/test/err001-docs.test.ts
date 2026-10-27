// SPEC-ATP-ERR-001 AC-ERR-006 / REQ-ERR-005 (card t17, M1 test-first): the plugin documentation describes the
// provider error codes as they behave after this change. Twelve cells, the literal-fragment counts of acceptance.md
// E-13a..E-13k restated over the two files (no network, no HOME, no key):
//
//   six sentences that must be gone (README: E-13a, E-13b, E-13e; SKILL.md: E-13c, E-13d, E-13e)
//   six fixed fragments that must be present (README: E-13f, E-13j, E-13g; SKILL.md: E-13h, E-13k, E-13i)
//
// The fragments are Korean plain prose; a bare code token alone does not satisfy them. Leader decision Q5 (a): K3 gains
// only credential_environment_invalid and credential_rejected, and the seven F6 failures stay upstream_unavailable.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

// dist/test/<this file>.js -> oss/ is three levels up.
const ossDir = fileURLToPath(new URL('../../../', import.meta.url));
const readme = readFileSync(join(ossDir, 'README.md'), 'utf8');
const skill = readFileSync(join(ossDir, 'skills', 'goose', 'SKILL.md'), 'utf8');
const occurrences = (text: string, fragment: string): number => text.split(fragment).length - 1;

const STALE: readonly { cell: string; doc: 'README' | 'SKILL.md'; sentence: string }[] = [
  { cell: 'E-13a', doc: 'README', sentence: '`credential_rejected`가 아니라 `upstream_unavailable`로 나옵니다' },
  { cell: 'E-13b', doc: 'README', sentence: '`search_instruments`·`resolve_instrument`는 공급자 실패가 `schema_drift`로' },
  { cell: 'E-13c', doc: 'SKILL.md', sentence: '`get_market_flows`는 KIS 키를 일부만 설정했거나 KIS 토큰 요청이 401/403으로 거부된 경우에도 `upstream_unavailable`로 나오며' },
  { cell: 'E-13d', doc: 'SKILL.md', sentence: '`resolve_instrument`의 공급자 실패는 `schema_drift`로' },
  { cell: 'E-13e', doc: 'README', sentence: '이 구분이 모든 도구에 적용되지는 않습니다' },
  { cell: 'E-13e', doc: 'SKILL.md', sentence: '이 구분이 모든 도구에 적용되지는 않습니다' },
];
const FRAGMENTS: readonly { cell: string; claim: string; fragment: string }[] = [
  { cell: 'E-13f/E-13h', claim: 'partial KIS key set', fragment: '`get_market_flows`는 KIS 키를 일부만 설정하면 `credential_environment_invalid`' },
  { cell: 'E-13j/E-13k', claim: 'token 401/403', fragment: '이 세 도구는 KIS 토큰 요청이 401/403으로 거부되면 `credential_rejected`를 냅니다' },
  { cell: 'E-13g/E-13i', claim: 'seven failures not preserved', fragment: '토큰·데이터 요청의 HTTP 500, 응답을 받기 전의 데이터 요청 시간 초과, 토큰 요청·데이터 요청·데이터 본문 읽기의 취소, 데이터 응답 크기 초과의 일곱 가지 실패는 원래 코드(`upstream_rejected` 등)를 보존하지 않고 `upstream_unavailable`로 알립니다' },
];

for (const { cell, doc, sentence } of STALE) {
  test(`AC-ERR-006 ${cell} ${doc}: the stale sentence "${sentence.slice(0, 40)}" is gone`, () => {
    assert.equal(occurrences(doc === 'README' ? readme : skill, sentence), 0);
  });
}
for (const { cell, claim, fragment } of FRAGMENTS) {
  for (const [doc, text] of [['README', readme], ['SKILL.md', skill]] as const) {
    test(`AC-ERR-006 ${cell} ${doc}: states the ${claim} fragment`, () => {
      assert.ok(occurrences(text, fragment) >= 1, `${doc} lacks: ${fragment}`);
    });
  }
}

test('AC-ERR-006 size: 6 stale sentences (E-13e once per document) and 3 fragments x 2 documents', () => {
  assert.equal(STALE.length, 6);
  assert.equal(FRAGMENTS.length * 2, 6);
});

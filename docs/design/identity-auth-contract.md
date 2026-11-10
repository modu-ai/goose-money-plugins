# ID·호스트 인증 계약 (설계 초안)

Refs #6.

- 상태: **초안(제안)**. 실제 ID 서비스 연결·토큰 발급·클라이언트 등록은 하지 않았습니다.

## 0. 반영한 사용자 결정 (2026-11-10, #5·#9 이슈 댓글)

| 결정 | 이 문서에 주는 영향 |
|---|---|
| 무료도 **모두의 AI 로그인 필수**(#5) | 로그인 없는 익명 경로는 두지 않음. 모든 도구 호출·`resources/read`는 Identity 검증을 먼저 통과해야 함(discovery만 예외, 부정 시험 N17) |
| 수강생 = 수강 기간 동안 유료와 동일, 구독과 **별도 권한**(#5) | 토큰은 Identity만 증명. 수강생 여부·기간은 토큰 scope가 아니라 서버 entitlement 조회로 판정(§3 "로그인 ≠ 가입 ≠ 결제") |
| 계좌 자료 = 사용자 KIS 키로 보유 잔고 **읽기 전용** 조회 + 수동 입력(#9) | 모두의 AI 토큰은 KIS 계좌 권한을 대신하지 않음. KIS 호출은 로컬 공급자 키로만, 모두의 AI 서버 경유 없음 |
| 계좌 자료 저장 = 사용자 PC에만(#9) | 인증 서버·entitlement 조회 요청에 보유·잔고 값을 싣지 않음(부정 시험 N18) |

남은 결정: A-01~A-09 전부(토폴로지·issuer·audience·client·scope·토큰 형식·refresh·JWKS·철회).
- 1차 출처: 기능 정의서 스냅샷 F03(145–158행)·F04(160–173행)·F02 원격 분리(127–131행)·9장(630행). 코드 기준: HEAD `8711890`.
- 작성: 2026-11-10 설계 감사.

## 1. 지금 있는 것 (HEAD 측정)

| 요소 | 상태 | 근거 |
|---|---|---|
| 토큰 검증 골격 | 있음, 네트워크 미연결, 토큰 저장 없음 | `server/src/member-token-verifier.ts` — `network_connected:false`, `token_storage:'none'` |
| 헤더 | `alg=ES256`, `typ=at+jwt`, `kid` 필수 | 같은 파일 4행 |
| 클레임 | `iss`, `sub`(26자 ULID 형식), `aud`, `exp`, `iat`, `nbf?`, `jti`, `client_id`, `scope` | 5행 |
| 수명 | `exp-iat ≤ 900초`, 시계 오차 30초 | `verify()` 본문 |
| 범위 | 필수 scope 전부 포함, `admin:` 접두·`*` 금지, `mcp-admin.mo.ai.kr` audience 금지 | `configured` 판정·scope 검사 |
| 철회 | `revocationState(jti)`가 `active`일 때만 통과, `unknown`도 거부 | `revocation_unconfirmed` |
| 세션 결속 | `sha256(salt, [iss, sub, client_id, jti])` → `session_binding` | 반환값 |
| 실행 경로 연결 | **없음** — `installMemberAccess` 호출처 0 | 2026-11-10 설계 감사(`grep` 호출처 0) |
| 기존 부정 시험 | 5건: 미설정·admin 거부 / 정상 / iss·aud·client·header·scope 불일치 / 서명·키·만료·과수명·미래시각 / 철회·unknown | `server/test/member-token-verifier.test.ts:9-13` |
| issuer·audience·scope·client 실제값 | **미정** | CAPABILITIES `member_resource_scope_client_callback`="not_configured" |

## 1a. 현재 코드 동작 — 본문에 없는 세부 (lane-6 대조 #63, 930a088 직접 측정)

§1 표에 없는 코드 동작을 사실대로 적습니다. 재사용·정리 방향은 결정이 아니라 현행 관찰입니다.

| 항목 | 현재 코드 동작 | 근거 |
|---|---|---|
| 키·서명 제약 | `resolveKey`가 돌려주는 키는 EC `prime256v1` 공개키만 통과, 서명 인코딩은 `ieee-p1363` 고정, 토큰은 16,384바이트 상한, `nbf≥exp`도 거부 | `member-token-verifier.ts:26·34·36` |
| 결속 salt 수명 | salt가 인스턴스마다 무작위(32바이트)라 **프로세스 재시작마다 `session_binding`이 바뀜** — §3의 캐시·자원 무효화 설계와 상호작용. salt 수명 정책은 **결정 필요** | `member-token-verifier.ts:19` |
| provider 검사 캐시 | 검사 결과를 TTL 기본 300초(`maxCheckAgeMs`)로 캐시하고, 결속 변경 시 epoch 리셋으로 전체 무효화 | `member-onboarding.ts:19·30` |
| 게이트 거부 코드 | 거부 코드는 `member_login_required`·`provider_checks_required`·`member_session_changed` — §6 응답 계약 초안의 `auth_required`와 이름이 다름(재사용 전 정리 대상, #10 코드 주석도 같은 지적) | `member-access.ts:15-20` |
| requireReady 동시 요구 | kis·opendart **둘 다** `connected`여야 ready — §6의 공급자별 분리 요구와 모순. 실행 경로 미연결(src 쪽 `installMemberAccess` 호출처 0, test만 존재)이라 현재 실행 영향 0 | `member-access.ts:18` |
| 자격증명 env 우선 경로 | 환경변수(`KIS_APP_KEY` 등)가 파일보다 우선하고, 부분 env는 fail-closed. 보존 지도 반영은 `privacy-retention.md` §3a와 공유 | `local-credentials.ts:93-101` |

문서에만 있고 코드에 없는 것(전부 **미구현**): refresh 회전·재사용 감지(§3), JWKS 캐시 수명(§3, A-08 미결정), entitlement 조회 API(§3), 철회 운영 구현(§3), §4 상태 전이 표 전체, 로그아웃 = 로컬 토큰 삭제(§4).

2026-11-11 갱신(#131, 원격 main `90565a4` 대조): 위 목록에서 두 항목이 구현됨 — unknown kid 1회 재조회(`member-token-verifier.ts:35`, 시험 `member-token-kid-refetch.test.ts`, PR #115), principal 도구 인자 무시의 부정 시험 N12(`entitlement-arg-injection.test.ts`, PR #112). JWKS kid 재조회의 캐시 수명 정책(A-08)은 여전히 미결정·미구현.

## 2. 먼저 정해야 할 구조 문제 — stdio 로컬 서버와 OAuth

HEAD의 MCP 서버는 `mcp.json`에서 `type: "stdio"`로 뜹니다. MCP 공식 인가 규격은 HTTP 전송을 대상으로 하고, stdio 구현은 그 규격 대신 환경에서 자격증명을 받도록 권고하는 것으로 알고 있습니다(**이번 실행에서 공식 문서 재확인 안 함 — 미확인**). 그러면 "호스트가 OAuth를 대신 해 준다"는 경로가 로컬 stdio 서버에는 그대로 적용되지 않을 수 있습니다.

| 선택지 | 내용 | 장점 | 비용·위험 |
|---|---|---|---|
| T1 원격 HTTP MCP | 보호 자원을 원격 HTTP MCP로 두고 호스트 OAuth 사용 | 호스트 표준 흐름, 서버측 검증 단순 | 정의서 129–131행: 원격은 로컬 키를 못 읽음 → KIS/DART 조회 위치 재설계, BYOK는 별도 승인 |
| T2 로컬 stdio + 로컬 로그인 CLI | `/goose login`이 브라우저 PKCE(루프백)로 토큰을 받아 OS 보안 저장소에 보관, stdio 서버가 읽어 검증 | 로컬 키·local-first 유지 | 토큰 보관·갱신을 플러그인이 책임, 호스트별 차이 |
| T3 혼합 | 로그인·entitlement 조회만 원격, 공급자 조회·보고서는 로컬 | 개인 금융정보는 로컬 유지 | 두 경로의 세션 결속 필요 |

**결정 필요(A-01)**. 아래 계약은 세 선택지에 공통인 부분만 고정하고, 갈리는 칸은 표시합니다.

## 3. 계약 항목

| 항목 | 제안 | 결정 필요 |
|---|---|---|
| 프로토콜 | OAuth 2.1 Authorization Code + PKCE(S256), public client | — |
| issuer | 모두의 AI 운영 ID 서버 하나, `https`, 경로·쿼리 없음 | 실제 URL (A-02) |
| 메타데이터 | 인가 서버 메타데이터 문서로 엔드포인트 발견, 고정 URL 하드코딩 금지 | 메타데이터 제공 여부 확인 (정의서 630행) |
| audience / resource | ATP 전용 자원 식별자 1개. 관리자 MCP(`mcp-admin.mo.ai.kr`) 재사용 금지(HEAD 골격 규칙 유지) | 식별자 문자열 (A-03) |
| client_id | 호스트·배포 형태별 등록 | 등록 방식(정적/동적) (A-04) |
| scope | 최소 단위로 분리. 예시 이름(제안): `atp.reports.read`, `atp.holdings.read`(유료), `atp.publish`(게시). `admin:`·와일드카드 금지 | 이름·세분화 (A-05) |
| 토큰 형식 | JWT access token, `typ=at+jwt`, ES256 — HEAD 골격과 같음 | ID 서버가 지원하는지 (A-06) |
| 수명 | access token ≤ 900초(HEAD 상한) | refresh 수명·회전 여부 (A-07) |
| refresh | refresh token 회전, 재사용 감지 시 전체 세션 철회 | 보관 위치: T2는 OS 보안 저장소, T1은 호스트 |
| JWKS | `kid`로 키 선택, 알 수 없는 `kid`면 1회 재조회 후 거부, 캐시 상한 | 캐시 시간 (A-08) |
| 철회 | `jti` 기준 확인. 확인 불가(`unknown`)도 거부 = fail-closed(HEAD 동작 유지) | 철회 확인 방식: introspection / 목록 배포 (A-09) |
| principal | 서버가 토큰의 `iss`+`sub`에서만 산출. 도구 인자의 user_id 무시 (정의서 153행) | — |
| 세션 결속 | `session_binding` 변경 시 이전 공급자 검사·보고서 자원 무효화(HEAD `member-onboarding.ts` reset 동작 유지) | — |
| 로그인 ≠ 가입 ≠ 결제 | 토큰 검증은 Identity만. Membership·Entitlement는 별도 조회 (#5, `docs/design/product-tiers.md`) | entitlement 조회 API 이름 (정의서 6장 `capabilities_get`, `service_membership_get` 제안) |
| 텔레메트리 | 인증 외 목적으로 모두의 AI 서버에 분석·보고서·원문 전송 0 | — |

## 4. 상태 전이

| 현재 | 사건 | 다음 | 서버 동작 |
|---|---|---|---|
| `unauthenticated` | 로그인 성공 | `authenticated` | 결속값 생성 |
| `authenticated` | access 만료 | `refreshing` | 갱신 시도 1회 |
| `refreshing` | 갱신 성공 | `authenticated` | 결속값 변하면 캐시 무효화 |
| `refreshing` | 갱신 실패 | `unauthenticated` | `auth_required` |
| `authenticated` | 철회 확인 | `revoked` | 진행 중 작업 취소, 보고서 자원·캐시 차단(정의서 156행 "철회 후 job·cache·파일도 차단") |
| `authenticated` | 철회 확인 불가 | `unauthenticated` | fail-closed |
| `authenticated` | 다른 사용자로 재로그인 | `authenticated`(새 결속) | 이전 사용자 자원 전부 접근 차단 |
| 어느 상태든 | 로그아웃 | `unauthenticated` | 로컬 토큰 삭제(#9, `docs/design/privacy-retention.md`) |

## 5. 부정 시험 목록

HEAD에 이미 있는 것은 ✓, 새로 필요한 것은 ＋.

| # | 시험 | 기대 | 상태 |
|---|---|---|---|
| N1 | 설정 없음 / admin audience·scope | `not_configured`, 키 조회 0 | ✓ (test:9) |
| N2 | 다른 issuer | `issuer_mismatch` | ✓ (test:11) |
| N3 | 다른 audience(다른 서비스 토큰) | `audience_mismatch` | ✓ (test:11) |
| N4 | 다른 client_id | `client_mismatch` | ✓ (test:11) |
| N5 | scope 부족·와일드카드 | `scope_denied` | ✓ (test:11) |
| N6 | 만료·과수명·미래 iat/nbf | `expired`/`invalid_time` | ✓ (test:12) |
| N7 | 서명 불일치·EC 아닌 키·다른 곡선 | `invalid_signature` | ✓ (test:12) |
| N8 | 철회됨 / 철회 확인 불가 | `revoked` / `revocation_unconfirmed` | ✓ (test:13) |
| N9 | `alg:none`, HS256(키 혼동) | 거부 | ✓ (test:11 — `alg:none`·`HS256`·`typ`·`jku`·`crit` 헤더 거부 고정. 2026-11-11 갱신 #131) |
| N10 | 알 수 없는 kid → 재조회 후에도 없음 | `invalid_signature` | ✓ (`member-token-kid-refetch.test.ts` — 재조회 후에도 없으면 `invalid_signature`, 키 조회 정확히 2회. PR #115, 2026-11-11 갱신 #131) |
| N11 | 교차 사용자: A 토큰으로 B의 보고서 자원 URI 읽기 | 차단 | ＋ |
| N12 | 도구 인자에 user_id·tier 주입 | 판정 불변 | ✓ (`entitlement-arg-injection.test.ts` — 유료·무료·미등록 도구·위장 resource URI 4건. PR #112, 2026-11-11 갱신 #131) |
| N13 | 실행 중 철회 → 다음 호출·자원 읽기 차단, 진행 작업 취소 | 차단 | ＋ |
| N14 | 결속 변경 후 이전 공급자 검사 결과 재사용 | 거부(재검사) | 일부(`member-access.test.ts` `member_session_changed`) |
| N15 | refresh 재사용 감지 | 세션 전체 철회 | ＋ |
| N16 | 토큰이 stdout/stderr·보고서·오류 메시지에 노출 | 0건 | ＋ (test:13이 오류 노출 일부 확인) |
| N17 | 실행 경로 연결 후 모든 도구·자원에 게이트 적용, discovery만 예외 | 일치 | ＋ (현재 경로 미연결) |
| N18 | 인증·entitlement 요청 본문에 보유 종목·잔고·수량·원가 값 | 0건 | ＋ |
| N19 | 로그인 없이 R01·R07(무료) 호출 | `auth_required` | ＋ (무료도 로그인 필수 결정) |

## 6. HEAD 코드에 대한 함의 (구현은 이 이슈 범위 밖)

- `member-access.ts`의 `requireReady`는 **KIS와 OpenDART가 모두 connected여야** 통과합니다(15행). 이걸 그대로 다시 연결하면 정의서 F02(공급자별 차단)와 #5 규칙 3을 어깁니다. 재연결 시 Identity 검사와 공급자 검사를 분리해야 합니다.
- `auth002-m5-docs.test.ts`는 README·SKILL.md에 "로그인" 문구가 없음을 고정합니다(E-04, E-29, E-30 등). 로그인 도입과 함께 시험의 기대값 재정의가 필요합니다.

## 7. 결정 필요 목록

| ID | 결정 |
|---|---|
| A-01 | 토폴로지 T1 / T2 / T3 |
| A-02 | issuer URL과 메타데이터 제공 여부 |
| A-03 | ATP 자원 식별자(audience) |
| A-04 | client 등록 방식 |
| A-05 | scope 이름·세분화 |
| A-06 | at+jwt·ES256 지원 여부(아니면 골격 수정) |
| A-07 | refresh 수명·회전 |
| A-08 | JWKS 캐시 시간 |
| A-09 | 철회 확인 방식과 지연 허용치 |

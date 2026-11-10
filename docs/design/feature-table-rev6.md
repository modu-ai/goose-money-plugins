# 기능 정의서 26기능 대조표 (정의서 ↔ 코드 ↔ 시험)

Refs #4. 2026-11-10 설계 감사에서 2차 출처로 만든 표를 기능 정의서 스냅샷(1차 출처) 기준으로 다시 채운 것입니다. 이 문서는 대조 결과이며 결정 기록이 아닙니다.

## 출처와 측정 기준

| 항목 | 값 |
|---|---|
| 1차 출처 | 기능 정의서 공식 Page의 읽기 스냅샷(Markdown, 652행) 중 1–211·370–399·505–652행은 전문, 212–369·400–504행은 기능별 권한·상태·의존성 행과 F14·F15 전 행을 읽음. sha256 앞16 `9b186e7e318df624` |
| 스냅샷 머리말 | 출처 행은 ChatGPT space 페이지(비공개, 주소 생략), 5행 **"읽기 기준 sequence: undefined"**, 7행 "Page updated_at: 2026-11-08T04:07:14.174528Z" |
| "개정6" 표기 | 파일 안에는 없음(`grep -c "개정6"` 대상 파일 0). 작업 지시와 스냅샷 파일명(`seq6`)의 표기일 뿐, 스냅샷 자체가 판본 6임을 증명하지 않음 |
| 정의서가 확인한 코드 | 9행: private main 고정 commit `49bc66a5ac0de35017e139af7e4cd24fc5847e3e`(2026-10-23), `oss/` 경로 기준 |
| 이 표의 코드·시험 기준 | HEAD `8711890ce758ebc8b116dc2f6c29ef80851597fe`, `plugins/moai-atp/` (2026-11-10 설계 감사의 직접 측정). **정의서의 "확인한 구현 상태" 칸은 49bc66a 기준이므로 HEAD와 다를 수 있음** |
| 시험 실행 | 0회. "시험" 칸은 파일 존재만 표시 |

## 정의서의 범위 고정값 (1차 출처 인용 위치)

- 26기능 = F01–F16, F18–F27. F17(백테스트)은 번호만 남기고 제외 — 46행.
- 초기 자산 범위 = 주식·현금·현물 FX. ETF·선물은 원천 계약이 있어도 초기 지원으로 자동 승격하지 않음 — 19행.
- 모의투자·백테스트는 ATP 계획·도구·산출물·시험에서 제외 — 17행.
- 카탈로그 16개 = R01–R13 + U01–U03, R14 제외 — 507·528행.
- 모두의 AI 로그인 = "모두의 AI 회원만 보호된 ATP MCP를 이용" — 147행(F03). **이는 로컬 설계 문서(Git 미추적 `project-docs/PROJECT-CONTEXT.md`)의 2026-10-26 "로그인 제거" 결정보다 나중 문서(updated_at 2026-11-08)이며, 2026-11-10 감사에서 보고한 인증 방향 충돌을 로그인 쪽으로 정리하는 1차 근거.**
- 유료 등급: 정의서에 **유료/구독/결제 정의 없음**(`grep -nE "유료|구독|결제"` → 170행 "로그인만으로 가입·유료 결제·게시 권한 부여 금지" 1건뿐). 무료/유료 기능 구분은 작업 지시로 전달된 사용자 방향에만 있음.

## 26기능 표

범례 — 정의서 상태: 정의서 "확인한 구현 상태" 칸 요약(49bc66a 기준) / HEAD 코드·시험: 8711890 직접 측정 / 판정: HEAD가 정의서 계약과 맞는지.

| F | 기능 (정의서 행) | 정의서 상태 | HEAD 코드 | HEAD 시험 | 판정 |
|---|---|---|---|---|---|
| F01 | Goose 요청 해석 (48) | 공개 Goose 지침, 실호스트 미검증 | `goose-routing.ts` 결정적 plan, dispatch 0 | `goose-routing.test.ts` | 부분 일치 |
| F02 | 프로젝트 맞춤 초기화 + KIS/DART 설정 (63–143) | `project_init_*` 제안, loader·토큰 발급 미확인 | `setup-cli.ts`(reuse/edit/delete), `local-credentials.ts` 키스토어 `~/.goose/keystore/credentials.json` 0600, `credential-runtime.ts` KIS `/oauth2/tokenP` 발급·메모리 캐시. `project_init_*`·ProjectProfile·AGENTS.md 생성 **부재** | `auth002-m4-key-setup.test.ts`, `setup-context.test.ts` | 부분 — 키 설정은 정의서보다 앞섬, 프로젝트 초기화는 부재. 키 삭제 명령 **부재**(`grep unlink` → 임시파일 정리뿐) |
| F03 | 모두의 AI 로그인 (145) | 추가 설계 | `member-token-verifier.ts` ES256 at+jwt 검증 골격, `network_connected:false`, 실행 경로 미연결 | `member-token-verifier.test.ts` 5건 | **불일치**(필수 기능, 미연결) |
| F04 | 서비스 가입·권한 (160) | 추가 설계 | **부재** | 부재 | 부재 |
| F05 | 기업·증권 식별 (175) | 기반 기능 | `search_instruments`, `resolve_instrument` | 있음 | 일치 |
| F06 | 공시·재무·뉴스 근거 (190) | 지침 존재, live 미완 | `get_public_filings`, `get_fundamentals`, `get_market_headlines` 원천만 | 있음 | 일치(원천 수준) |
| F07 | 종목 심층 분석 / R01 (205) | 렌더 계약 존재 | R01 경로 | 21파일 | 일치(합성 수준) |
| F08 | 동종기업 비교 / R02 (220) | 지침 존재 | `report-comparison.ts` | 11파일 | 일치(합성 수준) |
| F09 | 실적·현금흐름 / R07 일부 (235) | live 통합 미확인 | financial bridge/derivation, 실제 사실 0 | bridge 시험 | 부분 |
| F10 | 공시·사건 영향 / R07 (250) | 지침 존재 | R07 enum + 서술문 | 열거 시험만 | 부분 |
| F11 | 산업·거시·마감 / R06·R08·R11 (265) | 지침 존재 | 경로만 | R08 전용, R06·R11 열거만 | 부분 |
| F12 | 관심종목·이전 판단 / R09 (280) | watchlist CRUD 제안 | 경로만, watchlist 저장 **부재** | 열거만 | 부분 |
| F13 | 팩트체크·품질 / U02·U03 (295) | 검수 지침·구조 검증 | U03 코드 0, U02 경로 없음(`unsupported_report_route`) | 부재 | **불일치** |
| F14 | 본인 보유 읽기 (310) | 미구현 | **부재**, `accounts:false`, `get_account_snapshot` 미등록 | 부정 시험(heldTools) | 일치(미구현 상태로) |
| F15 | 보유 분석·리밸런싱 / R04 (325) | 미확인 | R04 `source_not_enabled` 차단(`server.ts:154`), 사용자 제공 `account_ledger` 렌더 코드 존재(`report-pipeline.ts:662,683`) | 2파일 | 부분 — 입력 이름이 "ledger"라 정의서의 "거래/입출금 원장 제외"(514·528행)와 명칭 충돌, 내용 일치 여부 미확인 |
| F16 | 투자 관점·분석 조건 (340) | 계약 정의 단계 | `skill-sources/goose-strategy`, `goose-conditions` 지침만 | 부재 | 부분 |
| F18 | 보고서 생성·비공개 내보내기 (355) | 렌더러 소스 존재 | `build_report_input`→`render_report_html`→`resources/read`, TTL 5분·메모리만 | 있음 | 부분 — export 파일·공유판/원본 분리 **부재** |
| F19 | 게시·정정·철회 (370) | 추가 설계, 2026-11-08 루틴 확정 | **부재**(`goose-routing.ts:243` 미연결 안내뿐) | 부재 | 부재 |
| F20 | 작업 상태·복구 (385) | durable 미검증 | 역할 timeout·실패 기록만 | 일부 | 부분 |
| F21 | 호스트 설치·진단 (400) | 실설치 미검증 | `runtime-guard.ts` Node 범위 검사 | 일부 | 부분 |
| F22 | Apps Stock·DB 연결 (415) | 미확인 | **부재** | 부재 | 부재 |
| F23 | 시장 수급 / R03 (430) | 제한 adapter, KIS-115 강제 차단 | `get_market_flows` 합성 계약 | 1파일 | 일치 |
| F24 | 리스크·자산운용 상담 / R05 (445) | 미확인 | 상담 코드 **부재**. R05는 활성 경로이고 catalog 이름은 "투자 성과·거래비용" | 열거만 | **불일치** — 정의서는 R05를 "비용 영향 상담으로 한정", "전체 성과 원장 제외"(515행) |
| F25 | 마감 전 후보 / R10 (460) | E2E 미구현 | R10 경로 + 호가·분봉 원천 | 있음 | 일치(원천 수준) |
| F26 | ETF / R12 (475) | 초기 범위 이후 검토 | **활성 경로**, 자동 라우팅 | 있음 | **불일치** — 초기 자동 승격 금지(19행) |
| F27 | 선물 / R13 (490) | 초기 범위 밖, "기능 활성화 금지" | **활성 경로**, 자동 라우팅 | 있음 | **불일치** |
| (F17) | 백테스트 / R14 | 제외 | **활성 경로**, catalog 공개, `backtest` 모드 | 있음 | **불일치** |

## 카탈로그 16개 이름 대조 (정의서 509–526행 ↔ `skills/goose/references/catalog.json`)

| ID | 정의서 표시명 | HEAD catalog 이름 | 판정 |
|---|---|---|---|
| R04 | 보유 종목과 리스크 상담으로 한정 | 내 자산·위험 진단 | 범위 표현 다름 |
| R05 | 비용 영향 상담으로 한정 | 투자 성과·거래비용 | **범위 다름**(성과 포함) |
| R12 | ETF 구조·비교·보유 점검 | ETF 가격·NAV·위험 점검 | 이름 다름 |
| 나머지 13개 (R01–R03, R06–R11, R13, U01–U03) | 509–526행 | catalog.json 이름 | 일치 (catalog.json 덤프와 1:1 대조) |

## 정의서 ↔ HEAD 수치 차이

- 정의서 23·534행 "조회 계약 34개, 모두 default-denied". HEAD는 36개 도구(34 공급자 + `build_report_input`, `render_report_html`)이고, `mcp.json`이 읽기 스위치 3개를 켜므로 출하 설정에서는 로컬 키가 있으면 호출됨(`CAPABILITIES.default_denied_scope`). 정의서 문장은 49bc66a 기준.

## 미확인

- 스냅샷이 실제 페이지 최신판인지(sequence undefined).
- 시험 실행 결과.

## 이후 변경 (main `fc3b16f`, PR #32 병합 — 위 표는 `8711890` 측정 그대로 둠)

`git show fc3b16f:plugins/moai-atp/server/src/report-pipeline.ts`와 `references/catalog.json`으로 확인한 범위만 적습니다.

| 항목 | 8711890 | fc3b16f |
|---|---|---|
| `ACTIVE_REPORT_ROUTE_IDS` | R12·R13·R14 포함 | R13·R14 제외 (R01–R03, R05–R12, U01) |
| catalog R12 / R13 | 공개, 상태 표기 없음 | `availability: conditional` / `release_hold` |
| catalog R14 | 공개 항목 | 항목 제거 |
| U02 / U03 | — | 보고서 경로 없는 카탈로그 정의로 명시(주석) |

따라서 F27·F17(R14) 행의 "활성 경로" 불일치는 fc3b16f에서 해소됐고, F26(R12)은 조건부로 바뀌었습니다. `backtest` 모드 제거는 #40에서 다룹니다. 그 밖의 행은 fc3b16f에서 다시 측정하지 않았습니다.

사용자 결정(2026-11-10, #5·#9 이슈 댓글)으로 무료도 로그인 필수(F03), 계좌 자료는 KIS 보유 잔고 읽기 전용 조회 + 수동 입력(F14)으로 정해졌습니다. 설계는 `docs/design/product-tiers.md`, `identity-auth-contract.md`, `privacy-retention.md`에 있습니다.

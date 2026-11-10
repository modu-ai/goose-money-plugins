# 기능별 출시 판정표 — 무엇이 어디까지 완료인가

Refs #30 · 기준 커밋 `64fd665cb5f30446e6e3b6fa306bf5281e4b1aea` (main, 2026-11-10)

이 문서는 #27의 `public-release-checklist.md`(공개 전 저장소·asset 점검)와 다른 파일로, **기능별로 출시로 부를 수 있는 상태인지**를 근거와 함께 한 문서에 정리합니다. 완료로 볼 수 없는 것은 미완으로 적습니다. 이 문서는 판정 근거의 모음일 뿐이며 출시 처리나 결정 채택이 아닙니다.

## 1. 상태 구분 정의

| 상태 | 뜻 | 이 상태로 부르기 위한 최소 근거 |
|---|---|---|
| source-defined | 설계·계약 문서에 정의돼 있고 코드에는 없거나 골격만 있다 | `docs/design/` 문서 + (있다면) 부정 시험 |
| synthetic-tested | 합성 fixture로 동작이 시험됐다. 실제 공급자·호스트는 보지 않았다 | 존재하는 시험 파일 + 실행 기록 |
| live-connected | 실제 공급자 API를 호출해 만든 산출물이 남아 있다 | 요청→근거→입력→영수증→HTML 사슬 기록 |
| host-verified | 실제 MCP 호스트에 연결해 설치·표시·동작을 확인했다 | 호스트별 검증 기록(#25) |
| end-to-end | 원천 조회부터 사용자 화면까지 전 사슬이 관측됐다 | API 실행 + 조립 + 렌더 + resources/read + 실화면 확인 |
| released | 출시 처리가 실행됐다 | 출시 절차 실행 기록 |

상태는 올림판정하지 않습니다. 위 단계의 근거가 없으면 아래 단계이고, 근거를 다시 측정하지 않았으면 "미재측정"으로 표기합니다.

## 2. 이 문서의 측정 방식과 한계

- 기능별 코드·시험 기본값은 `docs/design/feature-table-rev6.md`(HEAD `8711890` 직접 측정 + main `fc3b16f` 범위 변경 추적)을 인용해 채웠습니다. 그 뒤 병합된 PR(#44·#47·#53·#54·#55·#56·#57·#59)의 변경은 PR 제목과 병합 기록으로 반영했고, **변경된 트리에서 시험 수치를 다시 실행해 측정하지는 않았습니다.**
- 실제 공급자 호출·실화면 관찰·호스트 설치는 이 문서 작성 시점에 실행하지 않았습니다(레인 규칙상 공급자 실호출·화면 접근은 HOLD). 따라서 live-connected 이하의 칸은 과거 기록(#17 등)의 인용입니다.
- GitHub 저장소 설정은 2026-11-10 API로 직접 조회했습니다(§4).
- 시간 예측은 쓰지 않습니다. 남은 것은 이슈 번호로만 적습니다.

## 3. 기능별 상태표

근거 칸의 `F-table`은 `docs/design/feature-table-rev6.md`의 해당 행을 뜻합니다.

| F | 기능 | 보고서·도구 | 상태 | 근거 | 남은 결정·HOLD |
|---|---|---|---|---|---|
| F01 | Goose 요청 해석 | `/goose` plan | synthetic-tested | `goose-routing.ts` 결정적 plan, provider_dispatches 0; `goose-routing.test.ts`·`roles-*.test.ts` (F-table 부분 일치) | 실제 호스트 미검증(#25). 백테스트 모드 범위 밖 분류는 PR #60 진행 중(아직 main 미병합) |
| F02 | 초기화 + KIS/DART 키 설정 | `setup-cli` | synthetic-tested (부분) | `setup-cli.ts`·`local-credentials.ts`(0600 키스토어)·`credential-runtime.ts`; `auth002-m4-key-setup.test.ts` (F-table: 키 설정은 계약보다 앞섬) | 프로젝트 초기화(`project_init_*`) 부재. 키·개인정보 삭제 명령 #43 진행 중. 사용자 PC 저장·삭제 방침은 #9 사용자 결정 기록 |
| F03 | 모두의 AI 로그인 | — | source-defined | `docs/design/identity-auth-contract.md`(PR #34); `member-token-verifier.ts` ES256 골격 + `member-token-verifier.test.ts`, `network_connected:false`, 실행 경로 미연결 (F-table 불일치) | issuer/JWKS/철회 등 실계약 확정 #6. 인증 방향 충돌 정리 #1, 코드 반영 보완 #63. **필수 기능 미연결 — 출시 판정 실패 칸** |
| F04 | 서비스 가입·권한 | — | source-defined (평가기 골격만 synthetic-tested) | `docs/design/product-tiers.md`(PR #37); `entitlement.ts` 순수 평가기 + 시험(PR #57) — **서버 등록·도구 호출 경로 미연결**, 가격·한도 미주입 | #5 상품 계약 결정(가격·한도), ID 연동 #6 이후 연결 |
| F05 | 기업·증권 식별 | `search_instruments`·`resolve_instrument` | synthetic-tested | 원천 계약 + 시험 존재 (F-table 일치 — 원천 수준) | 실호출 승인 범위 미결정(#17 계열) |
| F06 | 공시·재무·뉴스 근거 | `get_public_filings` 등 | synthetic-tested (원천 수준) | 원천 도구·지침 존재 (F-table 일치 — 원천 수준) | live 미완 — 실제 사실 기반 보고서는 #17 승인 전까지 없음 |
| F07 | 종목 심층 분석 | R01 | synthetic-tested + live-connected (부분) | 합성 시험 21파일(F-table). **실제 계보: 삼성전자 R01 원본 2개뿐**(2026-11-08 KIS·OpenDART 실행, 이슈 #17 해시 재확인). SK하이닉스는 연결재무 지표 5개 누락 미수리 #51. 화면 결함 중 High 일부 수리 PR #53, 재검수 미완 #52 | KIS/OpenDART 7요청 제안 **미승인** #17. 실화면 QA 0건 #18 |
| F08 | 동종기업 비교 | R02 | synthetic-tested | `report-comparison.ts` + 시험 11파일 (F-table 일치 — 합성 수준) | 실데이터 검증 없음 |
| F09 | 실적·현금흐름 | R07 일부 | synthetic-tested (합성만) | financial bridge·derivation + bridge 시험. **실제 사실 0** (F-table 부분) | 실데이터 승인·범위 #17 계열 |
| F10 | 공시·사건 영향 | R07 | synthetic-tested | R07 enum + 서술문 + 전용 경로 시험(PR #56) | 파생 지표(예상 대비 차이·막대)가 서로 다른 출처 값으로 계산 불가 — #58 원인·선택지 정리 중 |
| F11 | 산업·거시·마감 | R06·R08·R11 | synthetic-tested (부분) | R08 전용, R06·R11 열거 + PR #56 보강 | 거시·시장 피드 공급자 부재 — 데이터 계약 선택지 문서 PR #38, 결정 #20·#21 |
| F12 | 관심종목·이전 판단 | R09 | synthetic-tested (경로) | 경로 + 전용 시험(PR #56) | watchlist 저장 부재. 사용자 입력 수집 방식 #22 |
| F13 | 팩트체크·품질 | U02·U03 | source-defined | 검수 지침·구조 검증 존재. U03 코드 0, U02 보고서 경로 없음 — PR #32에서 "경로 없는 카탈로그 정의"로 명시 (F-table 불일치) | 구현 범위·시기 미정 |
| F14 | 본인 보유 읽기 | — | source-defined (부재) | 부정 시험(heldTools)로 미구현 상태 고정. 방향은 사용자 결정(2026-11-10 #42): KIS 보유 잔고 읽기 전용 + 수동 입력. 설계 `privacy-retention.md`(PR #35) | #42 구현 미착수 |
| F15 | 보유 분석·리밸런싱 | R04 | source-defined | catalog `availability: planned`(#32 이후). 렌더 코드 존재, `source_not_enabled` 차단 유지 | #13 차단 해제 수용 여부 미결정. 입력 수집 방식 #22 |
| F16 | 투자 관점·분석 조건 | strategy·conditions 모드 | synthetic-tested (계획 수준) | `goose-routing` strategy·conditions 모드, `references/workflows/` 지침 | 실행 엔진 없음(고정 안내). 정의서 계약 정의 단계 |
| F18 | 보고서 생성·내보내기 | `build_report_input`→`render_report_html` | synthetic-tested | 조립→렌더→`resources/read` 사슬 + 시험, TTL 5분 메모리만. 화면 결함 11건 중 일부 수리(PR #53), 나머지 #52 진행 중 | 비공개 export 파일·공유판 분리 부재 — PDF·폰트 #24 |
| F19 | 게시·정정·철회 | — | source-defined (부재) | `docs/design/publication-review.md`(PR #48). 코드는 미연결 안내뿐 | 루틴 구현 미착수, 공개 범위 규칙 명문화 #23 |
| F20 | 작업 상태·복구 | — | source-defined (일부 코드) | `docs/design/durable-job-and-stock-link.md`(PR #49). 역할 timeout·실패 기록만 존재 | durable job 계약 구현 미착수 |
| F21 | 호스트 설치·진단 | `runtime-guard` | synthetic-tested (부분) | Node 범위 검사 + 일부 시험 | 실설치·호스트별 표시 검증 미실시 #25 |
| F22 | Apps Stock·DB 연결 | — | source-defined (부재) | `docs/design/durable-job-and-stock-link.md`(PR #49) 설계만 | 구현 미착수 |
| F23 | 시장 수급 | R03 | synthetic-tested | 합성 계약 + 시험. KIS-115 강제 차단 유지 (F-table 일치) | 실자료 요청안(기간·단위·권리) #20 미결정 |
| F24 | 리스크·비용 상담 | R05 | synthetic-tested | 전용 경로 시험(PR #56). catalog 이름과 정의서 범위 표현 불일치는 미해결(F-table) | #13·#22 결정 필요(성과 포함 여부) |
| F25 | 마감 전 후보 | R10 | synthetic-tested (원천 수준) | R10 경로 + 호가·분봉 원천 (F-table 일치 — 원천 수준) | E2E 미구현, 실자료 #20 |
| F26 | ETF | R12 | synthetic-tested (conditional) | catalog `availability: conditional` — ETF 구조 근거 있을 때만 조립, 없으면 `report_not_applicable`(PR #32) | 초기 범위 자동 승격 금지 원칙과의 정합은 조건부로 유지 중 |
| F27 | 선물 | R13 | source-defined (release_hold) | catalog `release_hold`, `ACTIVE_REPORT_ROUTE_IDS` 제외, plan 단계 0(선물 요청) — PR #32. non-regression 표에서 선물 행 unsupported 고정 | 별도 범위 결정 전까지 보류 |
| (F17) | 백테스트 | R14 | 제외 (범위 밖) | catalog 항목 제거, `ACTIVE_REPORT_ROUTE_IDS` 제외 — PR #32. 계획기 backtest 모드 잔존분은 PR #60에서 `backtest_out_of_product_scope` 분류로 제거 진행 중 | #60 main 병합 대기 |

## 4. 공통 기반 상태

| 항목 | 상태 | 근거 |
|---|---|---|
| 테스트 CI (macOS·Windows) | 운영 중 | `.github/workflows/test.yml`(PR #39). main 최신 보호로 PR마다 두 검사 실행 |
| Codex 리뷰 게이트 | 운영 중 | `.github/workflows/codex-gate.yml`(PR #46·#54). head별 증거 판정. Actions 예산 절감 #62 미처리 |
| main 브랜치 보호 | 관측됨 (2026-11-10 API 조회) | `strict:true`, 필수 검사 `test (macos-latest)`·`test (windows-latest)`·`codex-gate`, 대화 해결 필수, 관리자 예외 없음, 강제 push·삭제 금지 |
| 비밀 검사 | 운영 중 | `scripts/check_secrets.py` (CI와 push 전 수동 실행) |
| 문서-코드 정합 시험 | 운영 중 | `roles-docs.test.ts` — SKILL.md·request-routing.md·README가 문장 F·범위 문장을 소스와 일치시키는지 검사 |
| 저장소 가시성 | 비공개 (`private:true` — 2026-11-10 API 조회) | 공개 전환은 #27의 결정 항목(C1~C5)이 먼저 |

## 5. 출시 판정 체크리스트

"출시"로 부르기 전 각 문항이 완료돼야 합니다. 현재 상태를 사실대로 적습니다 — **2026-11-10 기준 완료 문항은 0개입니다.**

| # | 문항 | 현재 상태 |
|---|---|---|
| R1 | 필수 기능(모두의 AI 로그인 F03)이 실행 경로에 연결돼 있고 실계약(issuer·JWKS·철회)이 검증됐다 | 미완 — 골격만 존재(#6·#63) |
| R2 | 서비스 권한 평가기가 서버에 등록돼 가격·한도 설정을 주입받아 판정한다 | 미완 — 순수 모듈만 병합(PR #57), 연결·설정 주입 없음(#5·#7) |
| R3 | 개인 금융정보가 사용자 PC에만 저장되고 삭제 명령이 시험과 함께 제공된다 | 미완 — #43 진행 중(계획: 합성 홈 디렉터리 시험만) |
| R4 | 보고서 실데이터의 공급자 사용 범위가 승인됐고 요청→근거→HTML 사슬 기록이 남는다 | 미완 — 7요청 제안 미승인(#17). 실제 계보는 삼성 R01 2부분본뿐 |
| R5 | 보고서 HTML이 실화면(데스크톱·실제 모바일)에서 검수돼 결함이 해소됐다 | 미완 — 실화면 관찰 0건(#18), 에뮬레이션 결함 11건 중 일부만 수리(#52·PR #53), 재검수 미완 |
| R6 | R04·R05 범위(차단 해제·성과 포함 여부)와 데이터 계약(R03·R06·R08·R11)이 결정돼 카탈로그에 반영됐다 | 미완 — #13·#22·#20·#21 결정 대기 |
| R7 | 게시·정정·철회 루틴과 공개 범위 규칙이 코드로 존재한다 | 미완 — 설계만(#23·PR #48) |
| R8 | 격리 후보(#11 보존분)의 미반입 변경이 검토·반입 또는 기각됐다 | 미완 — #12 6단위 분할 계획 단계 |
| R9 | 계획기가 기능 정의서 개정6 범위와 일치한다 | 부분 — 카탈로그 정합은 PR #32로 달성, backtest 모드 제거는 PR #60 병합 대기 |
| R10 | 비공개 내보내기·PDF·폰트 배포가 결정·구현됐다 | 미완 — #24 |
| R11 | 호스트별 설치·표시 검증(#25)과 과거 asset 출처 결정(#27 C1~C5)이 끝났다 | 미완 |
| R12 | 출시 실행 기록(버전·아티팩트·검증 결과)이 존재한다 | 미완 — 출시 절차 자체가 아직 실행된 적 없음 |

## 6. 지원 문서 현황

`docs/design/` 아래 설계 문서 8개(기능 대조표·인증 계약·개인정보·상품 계약·구독 상태기계·게시 검수·durable job·시장 데이터 계약)와 `docs/release/public-release-checklist.md`가 병합돼 있습니다. 문서 안의 "결정 필요"는 채택된 결정이 아니라 열린 결정입니다(#5·#6·#9 등의 이슈가 결정 기록 장소). 코드-문서 정합은 `roles-docs.test.ts`가 문장 F·범위 문장·순차 실행 규칙을 검사합니다.

## 7. 이 문서가 확인하지 않은 것

- 위 표의 시험 파일들이 현재 트리에서 실제로 통과하는지의 재실행(CI `test` 검사가 PR마다 실행하며, 본문을 쓴 시점의 #30 PR도 그 검사를 받습니다).
- 2026-11-08 삼성 R01 산출물의 파일 해시·manifest 재검증(#17 기록 인용).
- 실제 공급자 호출, 실화면 관찰, 호스트 설치 — HOLD로 실행하지 않았습니다.
- 기능 정의서 공식 Page의 원문 대조(정의서 스냅샷의 "sequence: undefined" 한계는 F-table 미확인 칸에 기록돼 있습니다).

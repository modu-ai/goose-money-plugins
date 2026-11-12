# 기능별 출시 판정표 — 무엇이 어디까지 완료인가

Refs #30 · Refs #5 · 갱신 기준 `a3062fc2538c2e34895c38c77407d9a29d3108f4` (main, 2026-11-11)

최초 작성 기준은 `64fd665cb5f30446e6e3b6fa306bf5281e4b1aea`입니다. 이번 갱신은 아래에 명시한 실행 기록·병합 상태·코드 확인 범위만 반영하며, 표 전체를 다시 시험한 결과가 아닙니다. 2026-11-11 갱신이 반영한 범위: §2에 적은 로컬 보존 기록 6건(실호출 실행 2건·독립 대조 2건·보고서 13종 계약 판정 1건·릴리즈 QA 1건)과 이번에 바뀐 행 — 실호출 기록 반영 F06~F11, 미호출·미실행 사유 추가 F05·F12·F15·F23~F27, 2026-11-11 병합 PR의 코드·시험 실재와 런타임 연결 확인 F04·F12·F20. 재측정하지 않은 범위: F-table 시험 수치 재실행, 저장소 설정 재조회(§4), 공급자 API 재호출, 실화면 관찰·호스트 설치.

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
- 실화면 관찰·호스트 설치는 이번 갱신에서도 실행하지 않았습니다. 실제 공급자 호출은 2026-11-11 사용자 명시 승인 하에 별도 실행돼 로컬 보존 기록으로 남았고(아래 항), live-connected 칸은 이제 그 실행 기록(#17 및 2026-11-11 기록)의 인용입니다.
- GitHub 저장소 설정은 최초 작성 시 2026-11-10 API로 직접 조회했습니다(§4). 이번 갱신에서는 설정을 재조회하지 않았습니다.
- 2026-11-10 14:38 KST 갱신: 로컬 보존 기록 `2026-11-10-r01-actual-two-companies/RESULT.md`를 읽고 #17 실행 결과를 반영했습니다. 그 기록은 실행 HEAD `fc3b16f0029b7a36dd6de6f52e7e30d6ed130b9d`의 관찰이며, 이번 문서 기준 HEAD에서 API를 재호출한 결과가 아닙니다. PR #64·#66·#60·#69의 병합 SHA는 GitHub API로 확인했습니다. #62의 새 gate 실행은 [Actions run 42762980409](https://github.com/modu-ai/goose-money-plugins/actions/runs/42762980409) 성공과 로그의 `Image: ubuntu-26.04`를 확인했습니다. 실제 청구액은 측정하지 않았습니다.
- 2026-11-11 갱신: 사용자 명시 승인("모든 보고서 실제 API로 받아서 완성, 2종목") 하에 실제 공급자(KIS·OpenDART) 읽기 전용 호출이 빌드 `a3062fc`에서 실행돼 보고서 8본 — 삼성·SK하이닉스 R01/R07/R11, R02(양사 비교), R06 — 이 모두 `actual_data_partial`로 생성됐습니다(두 차례 실행, 공유 cutoff 02:16:41Z 5본·03:08:34Z 3본). 누적 72요청(상한 80 이내; 이 중 19요청은 수집 가드 스크립트 오류로 전량 낭비된 실행 run4로, 그 실행의 장부가 삭제돼 원본 기록이 남지 않음 — 독립 검증도 "확인 불가"로 기록), 직렬 실행, 계좌·주문·이체 endpoint 0회. 근거로 읽은 로컬 보존 기록(Git 미추적): `.moai/reports/2026-11-11-run/result/`의 `live-run-reports.md`·`live-run-r11-r06.md`·`live-verify.md`·`live-verify-r11-r06.md`·`live-report-matrix.md`·`release-qa.md`와 산출물 보존 폴더 `.moai/reports/2026-11-11-live-run/`. **이 문서 갱신 작업 자체는 공급자 API를 호출하지 않았습니다.** 전체 시험(핀 Node 24.22.1에서 5503/5503 통과)·빌드(tsc+런타임 번들)·패키지·비밀 검사는 `release-qa.md`의 a3062fc 실행 기록 인용이며 이 갱신에서 재실행하지 않았습니다.
- 시간 예측은 쓰지 않습니다. 남은 것은 이슈 번호로만 적습니다.

## 3. 기능별 상태표

근거 칸의 `F-table`은 `docs/design/feature-table-rev6.md`의 해당 행을 뜻합니다.

| F | 기능 | 보고서·도구 | 상태 | 근거 | 남은 결정·HOLD |
|---|---|---|---|---|---|
| F01 | Goose 요청 해석 | `/goose` plan | synthetic-tested | `goose-routing.ts` 결정적 plan, provider_dispatches 0; `goose-routing.test.ts`·`roles-*.test.ts` (F-table 부분 일치) | 실제 호스트 미검증(#25). 백테스트 모드 범위 밖 분류는 PR #60 병합(`8382172`); 실제 호스트 실행은 미검증 |
| F02 | 초기화 + KIS/DART 키 설정 | `setup-cli` | synthetic-tested (부분) | `setup-cli.ts`·`local-credentials.ts`(0600 키스토어)·`credential-runtime.ts`; `auth002-m4-key-setup.test.ts` (F-table: 키 설정은 계약보다 앞섬) | 프로젝트 초기화(`project_init_*`) 부재. 키·프로필 삭제 명령 #43은 PR #64(`2214808`)로 병합, 통합 로컬 삭제(키·프로필·보유 snapshot)는 PR #113(`local-data-deletion.test.ts`) 시험 검증. 논지 저장은 미구현(저장 여부 결정 필요). 사용자 PC 저장·삭제 방침은 #9 사용자 결정 기록 |
| F03 | 모두의 AI 로그인 | — | source-defined | `docs/design/identity-auth-contract.md`(PR #34); `member-token-verifier.ts` ES256 골격 + `member-token-verifier.test.ts`, `network_connected:false`, 실행 경로 미연결 (F-table 불일치) | issuer/JWKS/철회 등 실계약 확정 #6. 인증 방향 충돌 정리 #1, 코드 반영 보완 #63. **필수 기능 미연결 — 출시 판정 실패 칸** |
| F04 | 서비스 가입·권한 | — | source-defined (평가기·구독 상태기계 순수 로직만 synthetic-tested) | `docs/design/product-tiers.md`(PR #37); `entitlement.ts` 순수 평가기 + 시험(PR #57) — **서버 등록·도구 호출 경로 미연결**, 가격·한도 미주입. 구독 상태기계 순수 로직 `subscription-state-machine.ts`·시험 병합(PR #110, 병합 `a3062fc`, 2026-11-11) — 런타임 진입점 미연결(main·server·cli에 importer 없음 확인) | #5의 가격·청구 주기·무료 사용량 한도는 출시 전 필수 결정(§5.1); ID 연동 #6·호출 경로 연결 #7은 별도 |
| F05 | 기업·증권 식별 | `search_instruments`·`resolve_instrument` | synthetic-tested | 원천 계약 + 시험 존재 (F-table 일치 — 원천 수준) | 실호출 승인 범위 미결정(#17 계열). 2026-11-11 실호출 장부에도 식별 도구 호출 없음(미호출) |
| F06 | 공시·재무·뉴스 근거 | `get_public_filings` 등 | synthetic-tested + live-connected (부분) | 원천 도구·지침 존재 (F-table 일치 — 원천 수준). 2026-11-11 실호출로 공시 목록·연결재무·시세·일봉·뉴스 원문이 요청→근거→입력→영수증→HTML 사슬과 함께 보존(8본, SHA-256 목록 동반) | 공시·재무 원문·수치의 독립 대조는 2026-11-11 독립 검증 기록으로 확인(불일치 0). 실화면 E2E·호스트 검증, 승인 범위 밖 원천(수급·거시·컨센서스) 미호출은 미완 |
| F07 | 종목 심층 분석 | R01 | synthetic-tested + live-connected (부분) | 합성 시험 21파일(F-table, 미재실행). #17 승인 7요청이 2026-11-10 실행됨(7/7 HTTP 200, 재시도·계좌·주문·이체 0) — 삼성 19지표(18값+1 결측)·SK하이닉스 14지표(13값+1 결측). 2026-11-11 실호출(빌드 `a3062fc`): 두 R01 재생성 — 삼성·SK 모두 19지표(18값+1 결측), actual_data_partial. #51로 기록된 SK 매출·영업이익 계열 5지표가 실데이터로 채워짐. 독립 대조: 두 본 모두 값 18/18 일치, 재무 8계정 원문 일치, 파생(영업이익률 등) 재계산 일치. 로컬 보존 기록 인용 | 실화면 표시·호스트 검증 미완(2026-11-11 산출물도 텍스트 추출 검증만 — 실화면 렌더 미관측). 100일 가격 이력·최근 분기 재무·뉴스 미포함(포함 재조립은 요청 상한 초과로 미실행). 전일 종가 결측 원인 결정 필요(§3.1). #52 실화면 QA 미완 |
| F08 | 동종기업 비교 | R02 | synthetic-tested + live-connected (부분) | `report-comparison.ts` + 시험 11파일 (F-table 일치 — 합성 수준). 2026-11-11 실호출: comparison-R02 actual_data_partial — subjects 2(삼성·SK), 종목↔공시법인 매핑 2건 `verified_by_dart_filing`, 38지표(36값+2 결측). 비교행 19 중 비교 가능 1행(시세 8행 `period_unconfirmed`·재무 9행 `scale_unconfirmed`·1행 `value_missing`) — 보수 처리 설계와 부합(독립 대조 확인) | 값 36/36 원문 일치 확인(독립 대조). 실화면·호스트 검증 미완. 전일 종가 결측 2건(§3.1). 비교 목적·제외 기준 확대 여부는 미결정 |
| F09 | 실적·현금흐름 | R07 일부 | synthetic-tested + live-connected (부분) | financial bridge·derivation + bridge 시험 (F-table 부분). 2026-11-11 실호출: R07 양사 actual_data_partial 11지표(11값) — 연결재무 실데이터 기반, 원문 대조 일치(독립 검증) | 예상 대비·서프라이즈는 컨센서스 원천 부재로 not_run(`get_kis_house_estimates` 강제 차단). 실화면·호스트 검증 미완 |
| F10 | 공시·사건 영향 | R07 | synthetic-tested + live-connected (부분) | R07 enum + 서술문 + 전용 경로 시험(PR #56). 2026-11-11 실호출: R07 양사에 공시 목록 실데이터 포함(삼성 20261111 임원보고서·SK 20261029 풍문또는보도해명 — 원문 일치 확인). 공시 목록 메타 수준(본문 분석 아님) | 파생 지표(예상 대비 차이·막대)가 서로 다른 출처 값으로 계산 불가 — #58 원인·선택지 정리 중. 실화면·호스트 검증 미완 |
| F11 | 산업·거시·마감 | R06·R08·R11 | synthetic-tested + live-connected (부분) | R08 전용, R06·R11 열거 + PR #56 보강. 2026-11-11 실호출: R11 양사 actual_data_partial 10지표(10값)씩 — 재무는 2025 사업보고서(11011)+2026 반기(11012) 연결을 쓰고 최근 분기 후보 3분기(11014)는 양사 미제출을 실제 응답으로 확인, 뉴스 미포함(수집 실패 후 뉴스 포함 재조립은 요청 상한 초과로 미실시), 수요·공급·재고 통계는 원천 부재로 not_run. R06 actual_data_partial 24지표(16값+8 결측: 전일 종가 2·일봉 계열 6 단위 미검증 null 보존), 일봉 100봉(수정주가 코드 0) 원문 표 — 독립 대조 1,400필드·뉴스 42행 순서 포함 일치. 지수·환율·금리·원자재 칸은 계약상 결측 | R08 거시 피드 공급자 부재 — 2026-11-11 미실행, 데이터 계약 선택지 문서 PR #38, 결정 #20·#21. R11 뉴스 포함 재조립(9요청 상한 초과) 미실행. 실화면·호스트 검증 미완 |
| F12 | 관심종목·이전 판단 | R09 | synthetic-tested (경로) | 경로 + 전용 시험(PR #56). 논지 원문 입력 경로 `thesis-baseline-input.ts`·시험 병합 + `report-pipeline` 연결(PR #121·#129, 2026-11-11) — 합성 시험 수준 | watchlist 저장 부재. 사용자 입력 수집 방식 #22. 2026-11-11 미실행 — 논지 원문 입력 대기(공급자 호출 0) |
| F13 | 팩트체크·품질 | U02·U03 | source-defined | 검수 지침·구조 검증 존재. U03 코드 0, U02 보고서 경로 없음 — PR #32에서 "경로 없는 카탈로그 정의"로 명시 (F-table 불일치) | 구현 범위·시기 미정 |
| F14 | 본인 보유 읽기 | — | source-defined (부재) | 부정 시험(heldTools)로 미구현 상태 고정. 방향은 사용자 결정(2026-11-10 #42): KIS 보유 잔고 읽기 전용 + 수동 입력. 설계 `privacy-retention.md`(PR #35) | #42 구현 미착수 |
| F15 | 보유 분석·리밸런싱 | R04 | source-defined | catalog `availability: manual_input_only`(R04·R05). 수동 상담 경로 반입(`manual-consultation.ts`·`skills/goose/references/manual-consultation.md`, PR #74) — 공급자 호출 0 계약. `source_not_enabled`는 dart·SEC·디렉터리 게이트 전용이라 R04 차단과 무관 | #13 차단 해제 수용 여부 미결정. 입력 수집 방식 #22. 2026-11-11 미실행 — 사용자 입력 대기(이번 실행에서 입력 건너뜀, 공급자 호출 0) |
| F16 | 투자 관점·분석 조건 | strategy·conditions 모드 | synthetic-tested (계획 수준) | `goose-routing` strategy·conditions 모드, `references/workflows/` 지침 | 실행 엔진 없음(고정 안내). 정의서 계약 정의 단계 |
| F18 | 보고서 생성·내보내기 | `build_report_input`→`render_report_html` | synthetic-tested | 조립→렌더→`resources/read` 사슬 + 시험, TTL 5분 메모리만. 화면 결함 11건 중 일부 수리(PR #53), 나머지 #52 진행 중. [별도 요약 PDF 시제품·archive 계보](../design/report-artifact-lineage.md)는 HTML 인쇄 검수와 구분 | 비공개 export 파일·공유판 분리 부재 — PDF·폰트 #24 |
| F19 | 게시·정정·철회 | — | source-defined (부재) | `docs/design/publication-review.md`(PR #48). 코드는 미연결 안내뿐 | 루틴 구현 미착수, 공개 범위 규칙 명문화 #23 |
| F20 | 작업 상태·복구 | — | source-defined (일부 코드) | `docs/design/durable-job-and-stock-link.md`(PR #49). 순수 로직 조각 5종 병합 — `durable-job.ts`·시험(PR #107), 재시도 분류 `durable-job-retry.ts`·시험(PR #125), 재현 패키지 `durable-job-repro.ts`·시험(PR #133), 실행기 루프 `durable-job-runner.ts`·시험(PR #137, 병합 `9804417`), 작업 키 `durable-job-key.ts`·시험(PR #138, 병합 `b84d9a8`). 2026-11-11 갱신 #131 | 조각 전부 런타임 미연결(2026-11-11 main·server·cli importer 부재 확인). DB·영속 복구·Stock 연결 구현 미착수 |
| F21 | 호스트 설치·진단 | `runtime-guard` | synthetic-tested (부분) | Node 범위 검사 + 일부 시험 | 실설치·호스트별 표시 검증 미실시 #25 |
| F22 | Apps Stock·DB 연결 | — | source-defined (부재) | `docs/design/durable-job-and-stock-link.md`(PR #49) 설계만 | 구현 미착수 |
| F23 | 시장 수급 | R03 | synthetic-tested | 합성 계약 + 시험. KIS-115 강제 차단 유지 (F-table 일치) | 실자료 요청안(기간·단위·권리) #20 미결정. 2026-11-11 미실행 — #20 요청 범위 승인 대기(공급자 호출 0; R06 실행의 수급 도구도 같은 사유로 생략) |
| F24 | 리스크·비용 상담 | R05 | synthetic-tested | 전용 경로 시험(PR #56). catalog 이름과 정의서 범위 표현 불일치는 미해결(F-table) | #13·#22 결정 필요(성과 포함 여부). 2026-11-11 미실행 — 사용자 입력 대기(이번 실행에서 입력 건너뜀, 공급자 호출 0) |
| F25 | 마감 전 후보 | R10 | synthetic-tested (원천 수준) | R10 경로 + 호가·분봉 원천 (F-table 일치 — 원천 수준) | E2E 미구현, 실자료 #20. 2026-11-11 미실행 — 승인 대기(#20)·사용자 후보·조건 미입력(공급자 호출 0) |
| F26 | ETF | R12 | synthetic-tested (conditional) | catalog `availability: conditional` — ETF 구조 근거 있을 때만 조립, 없으면 `report_not_applicable`(PR #32). 2026-11-11 지정 종목 2개가 보통주라 대상 아님으로 기록됨(계약 판정, 호출 0) | 초기 범위 자동 승격 금지 원칙과의 정합은 조건부로 유지 중 |
| F27 | 선물 | R13 | source-defined (release_hold) | catalog `release_hold`, `ACTIVE_REPORT_ROUTE_IDS` 제외, plan 단계 0(선물 요청) — PR #32. non-regression 표에서 선물 행 unsupported 고정. 2026-11-11 실행 없음 — 의도된 출시 보류 그대로(실행 단계 0) | 별도 범위 결정 전까지 보류 |
| (F17) | 백테스트 | R14 | 제외 (범위 밖) | catalog 항목 제거, `ACTIVE_REPORT_ROUTE_IDS` 제외 — PR #32. 계획기 backtest 모드도 PR #60(`8382172`)에서 `backtest_out_of_product_scope`로 분류 | 실제 호스트 실행 검증은 별도 |

### 3.1 전일 종가 결측의 원인 — 독립 검증 2건의 판단이 갈림 (결정 필요)

2026-11-11 산출물의 `quote.previous_close`는 전 종목 결측이며 표시는 정직합니다("—"·상태 결측, 0·추정으로 채우지 않음 — 두 검증 모두 확인). 결측 원인에 대해 두 독립 대조의 판단이 갈리고, 이 문서는 어느 쪽도 채택하지 않습니다.

- **매핑 누락 판단**(live-verify, 2026-11-11): 시세 원문에 `stck_sdpr` 필드가 존재하고 `stck_prpr − prdy_vrss`와 정확히 일치(삼성 198,900 · SK 1,212,000)하며 `prdy_ctrt`도 이 기준 산술 일치 — 카탈로그가 `stck_sdpr`을 previous_close로 매핑하지 않은 것이 원인이라는 판단. 결측 사유 문구("공급자 응답에 값이 없거나 형식이 맞지 않음")가 부정확하다는 지적이 동반됨.
- **공급자 미제공 판단**(live-verify-r11-r06, 2026-11-11): 원문 어디에도 전일종가성 필드(예: `prdy_clpr`)가 없고 `stck_sdpr`는 "표준가격"이라는 별개 필드 — 일봉 직전 종가와 값이 같아 파생은 가능하나 매핑하지 않은 것은 보수 처리로 정당하다는 판단. 매핑 누락 아님.

R01(F07)·R02(F08)·R06(F11)의 해당 결측 칸은 이 결정이 나기 전까지 결측 상태로 둡니다.

### 3.2 2026-11-11 실호출 8본의 절 채움 (실행 기록 표를 그대로 옮김)

partial = 값 있음(제공값 미검증 표기) · not_run = 해당 도구 그룹 미호출. X절은 R01 계열에만 있습니다.

| 절 | samsung-R01 | skhynix-R01 | samsung-R07 | skhynix-R07 | comparison-R02 |
|---|---|---|---|---|---|
| S01 | partial | partial | partial | partial | not_run |
| S02 | not_run | not_run | partial | partial | partial (src 4) |
| S03 | partial | partial | partial | partial | partial (src 2) |
| S04 | partial | partial | partial | partial | partial (src 4) |
| S05 | partial | partial | partial | partial | not_run |
| S06 | partial | partial | partial | partial | not_run |
| X01 | partial | partial | — | — | — |
| X02 | not_run | not_run | — | — | — |
| X03 | partial | partial | — | — | — |

| 절 | samsung-R11 | skhynix-R11 | market-R06 |
|---|---|---|---|
| S01 | not_run | not_run | not_run |
| S02 | not_run(수요·공급·재고 원천 없음) | not_run | partial (src 4 · 가격판) |
| S03 | partial | partial | not_run(수급 — flows 생략) |
| S04 | partial (src 2) | partial (src 2) | partial (src 4) |
| S05 | partial (src 2) | partial (src 2) | partial (src 4 · 사건 메타) |
| S06 | partial | partial | partial (src 4) |

not_run 절은 호출하지 않은 도구 그룹(거시·수급·추정치·뉴스 일부) 때문입니다. 채워지지 않은 것을 채워진 것으로 적지 않습니다.

## 4. 공통 기반 상태

| 항목 | 상태 | 근거 |
|---|---|---|
| 테스트 CI (macOS·Windows) | 운영 중 | `.github/workflows/test.yml`(PR #39). main 최신 보호로 PR마다 두 검사 실행 |
| Codex 리뷰 게이트 | 제거 (2026-11-11, #105) | PR #46·#54로 도입. #105 조사에서 예약 재판정(`schedule */30`)이 GitHub 스케줄러 지연·생략으로 25틱 중 1회만 생성됨이 확인됐고, main 필수 검사 제외(#31)에 따라 워크플로·판정 모듈(`ci/codex_gate.py`)·시험(`ci/test_codex_gate.py`)·CI 단계를 제거. `@codex review` 봇 리뷰 요청은 계속 사용 |
| main 브랜치 보호 | 관측됨 (2026-11-11 API 조회) | 2026-11-11 재구성(#31): `strict:false`, 필수 검사 `test (macos-latest)`·`test (windows-latest)` 2종, 관리자 예외 없음, PR 필수(승인 0·오래된 리뷰 무효화), 강제 push·삭제 금지 |
| 비밀 검사 | 운영 중 | `scripts/check_secrets.py` (CI와 push 전 수동 실행) |
| 문서-코드 정합 시험 | 운영 중 | `roles-docs.test.ts` — SKILL.md·request-routing.md·README가 문장 F·범위 문장을 소스와 일치시키는지 검사 |
| 저장소 가시성 | 비공개 (`private:true` — 2026-11-10 API 조회) | 공개 전환은 #27의 결정 항목(C1~C5)이 먼저 |

## 5. 출시 판정 체크리스트

"출시"로 부르기 전 각 문항이 완료돼야 합니다. 현재 상태를 관찰 범위대로 적습니다. 일부 하위 작업 병합이나 부분본 생성만으로 전체 문항을 완료로 올리지 않으며, 이번 갱신에서 완료 문항 수를 집계하지 않았습니다.

| # | 문항 | 현재 상태 |
|---|---|---|
| R1 | 필수 기능(모두의 AI 로그인 F03)이 실행 경로에 연결돼 있고 실계약(issuer·JWKS·철회)이 검증됐다 | 미완 — 골격만 존재(#6·#63) |
| R2 | 서비스 권한 평가기가 서버에 등록돼 가격·한도 설정을 주입받아 판정한다 | 미완 — 순수 평가기 병합(PR #57), 이 기준에서 서버 연결 미반영(#7). 가격·청구 주기·무료 사용량 값은 출시 전 결정(§5.1) |
| R3 | 개인 금융정보가 사용자 PC에만 저장되고 삭제 명령이 시험과 함께 제공된다 | 부분 — 키·프로필 삭제는 PR #64(`2214808`), 통합 로컬 삭제(키·프로필·보유 snapshot)는 PR #113 시험 검증. 논지 저장은 미구현·미결정. 2026-11-11 갱신 #131 |
| R4 | 보고서 실데이터의 공급자 사용 범위가 승인됐고 요청→근거→HTML 사슬 기록이 남는다 | 부분 — 2026-11-11 사용자 승인 실호출로 R01 양사·R07 양사·R02·R11 양사·R06 총 8본 actual_data_partial 생성(누적 72요청·상한 80 이내 — 낭비 실행 19요청·기록 소실 1건은 §2, 원문·장부·영수증·SHA-256 사슬은 8본분 보존). 독립 대조 2건 모두 데이터 수치 불일치 0. 실화면·호스트 검증과 미호출 도구 절(컨센서스·수급·거시 등)은 미완 |
| R5 | 보고서 HTML이 실화면(데스크톱·실제 모바일)에서 검수돼 결함이 해소됐다 | 미완 — #52·PR #53 일부 수리, PR #69(`932839b`) 한국어·KST 표시 병합. PR #72 CDN 글꼴의 실제 로드·Referer·오프라인 대체·desktop/390px QA 미완(리더 #52 댓글 기준). 2026-11-11 산출물 8본도 텍스트 추출 기반 검증만 — 실화면 렌더 미관측 |
| R6 | R04·R05 범위(차단 해제·성과 포함 여부)와 데이터 계약(R03·R06·R08·R11)이 결정돼 카탈로그에 반영됐다 | 미완 — #13·#22·#20·#21 결정 대기 |
| R7 | 게시·정정·철회 루틴과 공개 범위 규칙이 코드로 존재한다 | 미완 — 설계만(#23·PR #48) |
| R8 | 격리 후보(#11 보존분)의 미반입 변경이 검토·반입 또는 기각됐다 | 미완 — #12 6단위 분할 계획 단계 |
| R9 | 계획기가 기능 정의서 개정6 범위와 일치한다 | 부분 — 카탈로그 PR #32와 backtest 범위 밖 분류 PR #60(`8382172`) 병합. 정의서 전체·호스트 정합 재검증은 별도 |
| R10 | 비공개 내보내기·PDF·폰트 배포가 결정·구현됐다 | 미완 — #24 |
| R11 | 호스트별 설치·표시 검증(#25)과 과거 asset 출처 결정(#27 C1~C5)이 끝났다 | 미완 |
| R12 | 출시 실행 기록(버전·아티팩트·검증 결과)이 존재한다 | 미완 — 출시 절차 자체가 아직 실행된 적 없음 |

### 5.1 출시 전 필수 결정 — 가격·청구 주기·무료 사용량

[사용자 결정 #5](https://github.com/modu-ai/goose-money-plugins/issues/5#issuecomment-6759712861): 다음 세 값은 지금 임의로 정하지 않고 출시 전에 확정합니다. 이슈가 닫힌 것은 값이 채워졌다는 뜻이 아닙니다.

| 항목 | 값 | 출시 조건 |
|---|---|---|
| 유료 가격 | 결정 필요 | 확정 전 유료 상품 활성화 보류 |
| 청구 주기 | 결정 필요 | 확정 전 유료 상품 활성화 보류 |
| 무료 사용량 한도 | 결정 필요 | 확정 전 유료 상품 활성화 보류, 기술적 스키마 상한을 상품 한도로 대체하지 않음 |

세 값이 비어 있는 동안 유료 기능을 열지 않는 운영 방침을 유지합니다. 다만 현재 코드의 보장 범위는 구분해야 합니다. 이 기준의 `entitlement.ts`는 가격·청구·사용량을 입력으로 받지 않는 순수 평가기이며, 서비스 설정이 빠지면 `not_configured`를 반환합니다(`entitlement.test.ts`의 미설정 거부 시험 존재, 이번에는 미실행). 설정과 유효한 구독·수강 자격이 있으면 유료 판정을 내릴 수 있으므로 **가격 값 누락 자체를 검사하는 코드나 서버 전체 차단이 이미 구현됐다고 보지 않습니다.** 서버 호출 경로 연결(#7), 실제 ID 계약(#6), 상품 값 주입·활성화 검증을 별도로 완료해야 합니다.

이 문서는 가격·한도 값을 만들거나 코드를 변경하지 않습니다. 이 결정란을 채워도 공급자 준비·자료 권리·로그인·호스트 QA 같은 다른 출시 조건은 각각 확인해야 합니다.

## 6. 지원 문서 현황

`docs/design/` 아래 설계 문서 8개(기능 대조표·인증 계약·개인정보·상품 계약·구독 상태기계·게시 검수·durable job·시장 데이터 계약)와 `docs/release/public-release-checklist.md`·`docs/release/release-audit.md`(릴리즈 전 전체 변경분 검수 절차, PR #134)가 병합돼 있습니다. 문서 안의 "결정 필요"는 채택된 결정이 아니라 열린 결정입니다(#5·#6·#9 등의 이슈가 결정 기록 장소). 코드-문서 정합은 `roles-docs.test.ts`가 문장 F·범위 문장·순차 실행 규칙을 검사합니다.

## 7. 이 문서가 확인하지 않은 것

- 위 표의 시험 파일들이 현재 트리에서 실제로 통과하는지의 재실행(CI `test` 검사가 PR마다 실행하며, 본문을 쓴 시점의 #30 PR도 그 검사를 받습니다).
- 2026-11-08 삼성 R01 산출물의 파일 해시·manifest 재검증(#17 기록 인용).
- 실화면 관찰, 호스트 설치 — 이번 갱신에서도 실행하지 않았습니다. 공급자 API는 이 문서 갱신 중 호출하지 않았고 2026-11-11 실행 기록을 인용했습니다. 그 산출물의 해시·재대조도 직접 실행하지 않았습니다(독립 대조 2건의 기록 인용).
- 기능 정의서 공식 Page의 원문 대조(정의서 스냅샷의 "sequence: undefined" 한계는 F-table 미확인 칸에 기록돼 있습니다).

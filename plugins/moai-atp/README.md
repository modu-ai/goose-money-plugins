# 모두의 주식 · MoAI ATP

제품명 **모두의 주식**, 닉네임 **MoAI ATP**의 로컬 개발 소스입니다.
투자 지표 참고·자료 분석·근거 중심 보고서·전략 검증 지원을 목표로 개발 중인
읽기 전용 분석 플러그인이며, **자동 실주문과 수익 보장을 제공하지 않습니다.**
기술 이름 `moai-atp`, 서버 패키지 ID와 저장소 경로는 표시명과 별개입니다.

## 명령 계획과 MCP 조회의 차이

`/goose`의 분석·보고서 명령이 반환하는 `execution_authority: plan_only`와 `provider_dispatches: 0`은 명령 라우터가 실행 계획만 만든다는 뜻입니다. 이 값은 별도로 호출하는 MCP 도구의 외부 요청을 막는 설정이 아닙니다. `setup`은 로컬 설정을 수행하므로 이 설명의 대상에서 제외합니다.

`tools/list`는 도구의 이름과 입력 규격을 받는 요청입니다. 목록을 받았다고 공급자 조회가 실행되거나 인증·설치·호스트 화면 표시가 검증된 것은 아닙니다. 별도 `tools/call`로 조회 도구를 호출하면 읽기 스위치와 해당 도구의 자격 증명·권한 조건에 따라 외부 요청이 나갈 수 있습니다. 출하 `mcp.json`은 `GOOSE_KIS_READ_ENABLED`, `GOOSE_OPENDART_READ_ENABLED`, `GOOSE_LOCAL_REPORT_VIEW_ENABLED`를 모두 `1`로 설정합니다. 특히 종목 디렉터리 도구는 키 없이도 첫 사용 시 KIS 마스터 파일을 요청할 수 있습니다.

키와 실제 사용자 저장소를 사용하지 않은 main 빌드의 stdio 측정 결과는 [도구 목록 실측 기록](skills/goose/references/tools-list-verification.md)에 기준 SHA·도구 이름·fetch 기록과 함께 남겼습니다. `build_report_input`·`render_report_html`은 로컬 조립·렌더 도구이며 외부 요청·파일 저장을 하지 않습니다.

## 소스 패키지와 설정

이 소스 ZIP은 계정 등록·설치가 완료된 플러그인이나 바로 실행 가능한
런타임 번들이 아닙니다. `dist`, `node_modules`, Node 실행 파일을 포함하지 않습니다.
소스 검증과 빌드를 마친 후에만 `mcp.json`이 지정한 서버 진입점이 생성됩니다.

실행: Node 22.2.0 이상. 하한은 실측했다(zlib.crc32 가 Node 22.1.0 에는 없고 22.2.0 에는 있음). 서버 도구 목록과 entry 검사는 Node 22.2.0·22.22.3 에서 실행했고, 그 밖의 Node 22.x 릴리스는 실행하지 않았다. Node 22.0–22.1 은 제외한다. 빌드: Node 24.22.1.

macOS에서 빌드용 Node **24.22.1**로 다음을 실행합니다.

```sh
npm --prefix server ci --ignore-scripts
npm run build
npm run check:package
node server/dist/src/cli.js setup
```

첫 `/goose setup`에서는 투자 맥락 인터뷰를 한 번 제시합니다. 호스트 slash
등록은 아직 미검증이므로 위 로컬 CLI가 확인된 실행 경로입니다. 답변 거절·미정·
중단을 허용하며, 확인되지 않은 답변이나 성향 추정값은 저장하지 않습니다.
거절·중단 후에도 이후 프로젝트에서 같은 질문을 반복하지 않습니다.
확인된 값만 `~/.goose/context/profile.json`에 저장하여 여러 프로젝트에서
재사용하고, 제시 여부만 별도의 `onboarding.json`에 기록합니다.

프로필은 평문이며 POSIX 사용자 전용 권한을 사용합니다. 백업·동기화까지
차단하는 암호화 저장소는 아닙니다. 키 저장소 `~/.goose/keystore`와 분리되며
기본 프로필 설정은 실제 키를 읽거나 공급자 API를 호출하지 않습니다.

```sh
node server/dist/src/cli.js setup --edit-profile
node server/dist/src/cli.js setup --delete-profile
```

선택적 키 설정은 **로컬의 대화형 터미널**에서 다음 명령으로만 진행합니다.
키를 채팅·명령 인자·파이프에 입력하지 않습니다.

```sh
node server/dist/src/cli.js setup --credentials
```

숨김 입력 후 명시적으로 `SAVE`한 공급자 키만
`~/.goose/keystore/credentials.json`에 평문 저장합니다. 디렉터리는 0700,
파일은 0600이며 OS 키체인·암호화 저장소가 아닙니다. 빈 입력은 기존 공급자
키를 유지하고 KIS 키 쌍의 일부 입력은 거부합니다. Ctrl+C/D로 숨김 입력을
중단할 수 있습니다. 이 명령은 API·OAuth 호출을 하지 않습니다.
Windows 키 저장은 ACL 지원 전까지 차단합니다.

MCP는 같은 엄격한 파일 규격을 지연 읽기합니다. 완전한 환경변수 쌍
`KIS_APP_KEY`/`KIS_APP_SECRET`, 또는 `OPENDART_API_KEY`가 파일보다 우선합니다.
빈 값·일부 값만 있는 환경변수는 파일과 섞지 않고 거부합니다.
서버 기본값(읽기 스위치 꺼짐)에서는 공급자 조회 도구가 차단되고, 서버 시작·차단된 요청은 키를 읽지 않습니다.
출하 플러그인 설정(`mcp.json`)은 KIS·OpenDART·로컬 보고서 읽기 스위치를 켭니다.
로컬 키가 없으면 KIS·OpenDART 도구는 공급자 요청 전에 자격 증명 오류로 끝나고, 로컬 키가 있으면 도구를 호출할 때 해당 공급자로 요청이 나갑니다.
디렉터리 도구는 키가 없어도 첫 사용 시 KIS 공식 마스터 파일을 내려받습니다(마스터 자료의 이용 권리는 확인되지 않았습니다).
KIS App Key/Secret의 공식 client_credentials 토큰 어댑터는 구현되어 있습니다. 분석·보고서 기능의 인증은 이 로컬 키뿐이며 별도 계정 절차는 없습니다. 키를 저장했다고 공급자가 그 키를 받아들였다는 뜻은 아니며, 요청이 공급자의 응답을 받았을 때에만 그 공급자를 확인한 것으로 봅니다.

소스 ZIP과 별도로, 빌드 후 아래 명령으로 내부 검증용 런타임 ZIP을 만듭니다.
새 출력 파일명을 사용합니다. 컴파일 코드·고정된 운영 의존성 3개를 포함하고,
Node 실행 파일·사용자 데이터·테스트·개발 의존성은 포함하지 않습니다.
빌드용 Node 24.22.1 설치는 별도입니다. ZIP 생성은 호스트 설치·공개 배포가 아닙니다.

```sh
npm --prefix server run build:mjs
python3 scripts/build_runtime_bundle.py --output ../../project-docs/packages/moai-atp-runtime-private.zip
```

로컬 stdio 패키징 근거는 [OpenAI 플러그인 문서](https://developers.openai.com/plugins/build/plugins)와
[데스크톱 전용 배포 문서](https://developers.openai.com/plugins/deploy/desktop-only)입니다.
`--credentials`는 이 프로젝트의 CLI이며 OpenAI 내장 명령이 아닙니다.
호스트의 임의 키 입력 폼이나 slash 실행은 검증되지 않았습니다.

별도 `interview` 명령은 없습니다. Windows 실제 실행과 프로필 ACL 지원은
미검증·미구현이며, 현재 프로필 저장은 Windows에서 안전하게 거부합니다.
Windows와 macOS만 검증 대상으로 삼으며 Linux 테스트는 진행하지 않습니다.

## 현재 범위

- 구현: 공통 프로필 설정, 공개 스킬 `goose` 하나와 내부 보고서 지침 13개, 공급자 조회 MCP 도구 34개와 로컬 `build_report_input`·`render_report_html` 도구. 서버 기본값에서는 공급자 읽기 스위치가 꺼져 있으며 출하 설정과의 차이는 위 설명을 따릅니다. 입력 조립은 이전 MCP 응답과 R04/R05의 명시 수동 입력을 각각의 계약에 맞춰 정규화하고, HTML 도구는 검증된 `ReportInput`을 HTML로 렌더해 5분 한도의 메모리 전용 MCP resource link로 반환합니다. 두 도구는 파일 쓰기와 외부 요청을 하지 않습니다. 다만 만들어진 보고서를 열면 브라우저가 글꼴(Pretendard·마루 부리·고운바탕)을 버전이 고정된 주소의 CDN(cdn.jsdelivr.net)에서 내려받습니다. 이 요청에는 보고서 내용·사용자 정보·Referer가 실리지 않도록 고정 URL과 no-referrer 정책을 사용하며, 오프라인이거나 차단되면 이 PC의 대체 글꼴로 표시됩니다. 실제 폰트 적용과 호스트 화면·다운로드는 별도 검증 대상입니다.
- 카탈로그: R01~R13과 U01~U03을 정의합니다. R12 ETF는 구조 근거가 있을 때만 조립하는 조건부 경로이며, R13 선물은 출시 보류(HOLD)로 실행 단계가 없습니다. R14 백테스트는 제품 범위 밖입니다. U01 탐색 유틸리티와 U02·U03의 정의·내부 검수 지침을 보고서 생성 경로와 구분합니다.
- 보고서 명령: `/goose report R01`~`R13`, 별칭 `/goose r01`~`r13`의 정식 13개·별칭 13개입니다. 보고서 26종이나 새 MCP 도구 26개를 뜻하지 않습니다. [보고서별 지침](skills/goose/references/reports/index.md)을 선택하는 `plan_only` 경로이며 자동 조회·호스트 slash 등록을 보장하지 않습니다.
- 수동 상담: R04는 사용자가 직접 준 보유 snapshot, R05는 명시한 연간 비용 가정을 비공개로 설명합니다. 공급자 `calls`·`source_receipts`와 계좌·거래 원장을 받지 않으며, 빈 값을 0이나 추정으로 채우지 않습니다. [수동 입력 계약](skills/goose/references/manual-consultation.md)을 따릅니다. 수동 보고서 ID를 선택해도 계좌 조회·주문 차단은 유지됩니다.
- 표시: 기본 서식은 유지하며 `render_report_html`의 `template: "artboard-v2"` 옵션으로 선택형 아트보드를 사용합니다. 한국어 상태·KST·원문 값·권리 검사를 유지하는 연결이며 실제 화면 검수 완료를 뜻하지 않습니다. 금융차트와 matrix/timeline/Pele-style SVG 블록의 자료 유무·검증 상태를 구분합니다.
- 미검증·미완: 실제 자료를 사용한 R01 부분본 생성 기록은 있으나 원수치의 독립 대조, 공급자 조회부터 실제 사용자 화면까지의 end-to-end, 조건식 자동 등록·모바일 등록·전략 실행 엔진, 원래 Cowork 템플릿과의 전체 정합성 및 실제 호스트 설치·화면은 미완입니다. 버전 변경만으로 출시나 새 실조회가 완료되지 않습니다.
- 금융 차트는 별도 계약이며, `report-templates/`의 별도 소유자가 실제
  Cowork/Pele 보고서 자산을 담당합니다. 추가 UI·원격 호스팅은 후속 범위입니다.

## 검증과 공개 상태

전체 합성·계약 테스트에는 Python 3.11+ 및
`server/requirements-contract-tests.txt`의 jsonschema가 필요합니다.

```sh
npm test
```

공식 JSON Schema 검증과 소스 ZIP 검사는 로컬 검증 자료로 별도 기록합니다.
소스 패키지 검증은 실제 호스트 설치나 데이터 사용권 승인을 뜻하지 않습니다.

프로젝트 고유 코드와 스킬은 사용자 확정에 따라 `LGPL-3.0-only`를 적용합니다.
`LICENSE`, `COPYING.LESSER`, `COPYING`을 함께 제공합니다. 참조 계약·스키마의
권리 예외는 `LICENSE`와 아래 고지에 남겼으며, 예외가 해결되기 전 최종 공개
배포 완료로 표시하지 않습니다. `private: true`는 npm 오발행 방지 설정입니다.
[제3자 의존성 고지](THIRD_PARTY_NOTICES.md)를 보존해야 하며, 회원 인증은 서비스
접근 제어이고 향후 OSS 이용 권한·시세 데이터 사용권과 별개입니다.

설치 ZIP은 `server/runtime/src/*.mjs`와 필요한 계약·차트 자산·라이선스를 포함합니다. 실행에 필요한 Node 범위는 위 고지를 따르며, 사용자에게 npm 설치나 TypeScript 빌드는 필요하지 않습니다. 개발용 소스의 mcp.json과 설치 ZIP의 MJS 진입점을 구분합니다. Windows 및 실제 호스트 설치는 별도 검증 대상입니다.


## 개발본과 설치본 구분

현재 개발 소스 버전은 **0.1.0-dev.6**입니다. 설치본 dev.5와 이름이 겹치지 않도록
새 번호를 사용하며, 플러그인·소스 패키지·서버 패키지·lockfile·CAPABILITIES를 같은 버전으로 맞춥니다.
과거 실측 문서의 dev.3 같은 버전은 당시 관측 기준이므로 그대로 보존합니다.
최종 0.1.0 출시, 설치 캐시 교체, 새 런타임 ZIP 생성·배포를 뜻하지 않습니다.
설치·검수 시에는 버전뿐 아니라 파일 해시와 실제 진입점, 해당 산출물의 검증 기록을 함께 확인합니다.

이 버전은 수동 상담, 번들 카탈로그 정합, 보고서별 명령·지침, 선택형 아트보드의
소스 반입 상태를 구분하기 위한 번호입니다. 후속 preview·차트 상태 UI·PDF 원형은
각 PR의 병합·검증 여부를 따로 확인하며, 아직 반입되지 않은 변경을 버전에 포함됐다고 보지 않습니다.
조건식 자동 등록과 전략 실행 엔진은 제공하지 않으며 백테스트는 제품 범위에서 제외합니다.


## Goose 한 개로 사용하기

공개 스킬은 `goose` 하나입니다. 자연어 요청이나 `analyze`, `conditions`, `strategy`,
`backtest`, `mental-support`, `report` 내부 모드로 필요한 절차를 읽고 연결합니다.
실제 로컬 `setup` 외 CLI 분석 모드는 계획을 출력하며 공급자를 자동 호출하지 않습니다.
기존 네 전문 스킬의 원본은 개발용 `skill-sources/`에 보존했고 공개 설치 ZIP에는 포함하지 않습니다.
이전 전문 스킬 호출은 `/goose <모드> ...`로 옮깁니다. 실제 호스트 slash 등록/모델 라우팅은 별도 검증입니다.

요청은 목적 분류 → 필요한 입력·자료 권한 확인 → 내부 전문 절차·위임 → 결정적 계산·수치/근거 검증 → 통합 보고 순서로 처리합니다. 위임 도구나 권한이 없는 호스트에서는 같은 단계를 순차로 수행하고 결과에 `순차 실행`이라고 표기합니다.

`backtest`는 과거 요청을 분류하기 위해 남긴 내부 모드이며 백테스트는 제품 범위 밖입니다. 해당 요청은 `unsupported`·`backtest_out_of_product_scope`로 분류하고 실행 단계를 만들지 않습니다.

주문·취소·정정·예약·이체·입출금 요청과 자동·예약 매매를 실행하라는 요청은 이 플러그인이 지원하지 않으며, 도구를 호출하지 않고 안내 문장만 답합니다. 매매 요청의 고정 문장은 “이 플러그인은 지원하지 않으며 별도 시스템(ATS)의 영역입니다. 대신 기업·시장 조사나 투자 관점과 반증 조건 정리는 다시 요청해 주시면 도와드릴 수 있습니다. 실거래는 사용자께서 직접 판단·실행하십시오.”입니다. 이체·입출금 요청은 ATS를 말하지 않고 자금 이동은 사용자께서 직접 하도록만 안내합니다. 읽기 전용 보유·계좌 수익률 조회는 아직 제공하지 않습니다(별도 승인 뒤 제공 예정).

현재 ATP의 범위는 `/goose` 단일 진입의 분석·리서치, 투자 관점·반증 조건 정리, 명시 수동 입력 보유·비용 상담과 보고입니다. 실거래·주문·취소·자동매매·예약 주문, 팀 에이전트, 상시 상태, 퀀트·시스템트레이딩 엔진은 별도 시스템 ATS(Agentic Trading System)의 영역입니다. ATS라는 이름은 실거래 승인이 아닙니다.


## KIS·OpenDART 키 연결 확인

분석·보고서 기능에 쓰는 인증은 사용자 로컬에 둔 KIS App Key/Secret과 OpenDART API 키뿐이며, 별도 계정 절차는 없습니다. 사용 순서는 설치 → 필요한 공급자의 키 저장(`setup --credentials`) → Goose 사용입니다. 키는 사용자 로컬 설정에 두며 채팅이나 모두의AI 서버로 보내지 않습니다.

요청마다 그 요청에 필요한 공급자만 확인합니다. KIS 자료만 필요한 요청은 OpenDART의 키를 확인하거나 OpenDART로 요청을 보내지 않고, OpenDART 자료만 필요한 요청도 마찬가지입니다. 다른 공급자의 키가 없거나 꺼져 있어도 그 요청의 결과는 달라지지 않습니다.

기본 설치(`mcp.json`의 읽기 스위치 `"1"`)에서는 해당 공급자의 키만 있으면 KIS·OpenDART 읽기가 동작합니다. 로컬 도구 `build_report_input`·`render_report_html`과 보고서 자원은 읽기 스위치 없이도 열립니다.

공급자 오류는 코드로 구분합니다. KIS 토큰 요청이나 OpenDART가 HTTP 401/403으로 거부하면 `credential_rejected`, HTTP 429로 거부하면 `rate_limited`입니다. 확장 KIS 조회 도구(예: `get_us_market_snapshot`, `get_domestic_etf_snapshot`)는 키 미설정(`credential_missing`)·키 일부 설정(`credential_environment_invalid`)·401/403(`credential_rejected` 또는 `auth_expired`)·429(`rate_limited`)·시간 초과(`upstream_timeout`)·응답 크기 초과(`response_too_large`)를 받은 코드 그대로 전합니다. 취소는 토큰 요청과 데이터 본문 읽기에서는 `request_cancelled`로 전하지만, 데이터 요청을 보내는 중의 취소는 `upstream_unavailable`로 알립니다. 종목 디렉터리 도구 `search_instruments`·`resolve_instrument`는 키를 쓰지 않는 마스터 파일 호스트를 읽으며, 시간 초과는 `upstream_timeout`, HTTP 429는 `rate_limited`, 그 밖의 오류 응답은 `upstream_rejected`, 전송 실패는 `upstream_unavailable`, 응답 크기 초과는 `response_too_large`, 파일 형식이 다르면 `schema_drift`로 알립니다. 다음 두 경우는 이 구분과 다르게 동작합니다.

- `get_instrument_profile`·`get_market_headlines`·`get_market_flows`는 위 구분에 키 관련 코드 두 가지를 더 내고, 일부 실패는 원래 코드를 보존하지 않습니다. 예를 들어 `get_market_flows`는 KIS 키를 일부만 설정하면 `credential_environment_invalid`를 내고, 나머지 두 도구도 같습니다. 이 세 도구는 KIS 토큰 요청이 401/403으로 거부되면 `credential_rejected`를 냅니다. 반면 토큰·데이터 요청의 HTTP 500, 응답을 받기 전의 데이터 요청 시간 초과, 토큰 요청·데이터 요청·데이터 본문 읽기의 취소, 데이터 응답 크기 초과의 일곱 가지 실패는 원래 코드(`upstream_rejected` 등)를 보존하지 않고 `upstream_unavailable`로 알립니다.
- 응답 본문을 원문 텍스트로 보존하는 네 도구(`get_global_index_history`, `get_global_index_period_history`, `get_market_industry_investor_aggregates`, `get_overseas_ice_actions`)는 본문을 해석하다 실패하면 위 구분이 아니라 도구 고유의 코드(예: `invalid_json`, `provider_schema_drift`)로 알립니다.

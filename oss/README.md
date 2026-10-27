# 모두의 주식 · MoAI ATP

제품명 **모두의 주식**, 닉네임 **MoAI ATP**의 로컬 개발 소스입니다.
투자 지표 참고·자료 분석·근거 중심 보고서·전략 검증 지원을 목표로 개발 중인
에이전틱 트레이딩 플러그인이며, **자동 실주문과 수익 보장을 제공하지 않습니다.**
기술 이름 `moai-atp`, 서버 패키지 ID와 저장소 경로는 표시명과 별개입니다.

## 소스 패키지와 설정

이 소스 ZIP은 계정 등록·설치가 완료된 플러그인이나 바로 실행 가능한
런타임 번들이 아닙니다. `dist`, `node_modules`, Node 실행 파일을 포함하지 않습니다.
소스 검증과 빌드를 마친 후에만 `mcp.json`이 지정한 서버 진입점이 생성됩니다.

macOS에서 Node **24.22.1**로 다음을 실행합니다.

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
기본 권리 차단은 그대로이며 서버 시작·차단된 요청은 키를 읽지 않습니다.
KIS App Key/Secret의 공식 client_credentials 토큰 어댑터는 구현되어 있습니다. 분석·보고서 기능의 인증은 이 로컬 키뿐이며 별도 계정 절차는 없습니다. 키를 저장했다고 공급자가 그 키를 받아들였다는 뜻은 아니며, 요청이 공급자의 응답을 받았을 때에만 그 공급자를 확인한 것으로 봅니다.

소스 ZIP과 별도로, 빌드 후 아래 명령으로 내부 검증용 런타임 ZIP을 만듭니다.
새 출력 파일명을 사용합니다. 컴파일 코드·고정된 운영 의존성 3개를 포함하고,
Node 실행 파일·사용자 데이터·테스트·개발 의존성은 포함하지 않습니다.
Node 24.22.1 설치는 별도입니다. ZIP 생성은 호스트 설치·공개 배포가 아닙니다.

```sh
npm --prefix server run build:mjs
python3 scripts/build_runtime_bundle.py --output ../project-docs/packages/moai-atp-runtime-private.zip
```

로컬 stdio 패키징 근거는 [OpenAI 플러그인 문서](https://developers.openai.com/plugins/build/plugins)와
[데스크톱 전용 배포 문서](https://developers.openai.com/plugins/deploy/desktop-only)입니다.
`--credentials`는 이 프로젝트의 CLI이며 OpenAI 내장 명령이 아닙니다.
호스트의 임의 키 입력 폼이나 slash 실행은 검증되지 않았습니다.

별도 `interview` 명령은 없습니다. Windows 실제 실행과 프로필 ACL 지원은
미검증·미구현이며, 현재 프로필 저장은 Windows에서 안전하게 거부합니다.
Windows와 macOS만 검증 대상으로 삼으며 Linux 테스트는 진행하지 않습니다.

## 현재 범위

- 구현: 공통 프로필 설정, 연구 워크플로우 스킬 5개, 기본 차단된 공급자 조회 MCP 도구 34개와 로컬 `build_report_input`·`render_report_html` 도구. 입력 조립은 이전 MCP 응답만 정규화하고, HTML 도구는 검증된 `ReportInput`을 HTML로 렌더해 5분 한도의 메모리 전용 MCP resource link로 반환합니다. 파일 쓰기와 외부 요청은 하지 않습니다. 오프라인 렌더러는 금융차트와 matrix/timeline/Pele-style SVG 블록을 지원합니다. 실제 MCP 호스트의 화면 표시·다운로드는 미검증입니다.
- 미완: 실제 데이터 보고서 0건, 공급자 호출부터 보고서까지의 라이브 end-to-end, 조건식 자동 등록·모바일 등록·전략/백테스트 엔진, 원래 Cowork 템플릿과의 전체 정합성 및 실제 ChatGPT 호스트 설치 검증. 지침에는 R01–R14, U01/U02와 내부 U03 검수 구분이 있습니다.
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

설치 ZIP은 `server/runtime/src/*.mjs`와 필요한 계약·차트 자산·라이선스를 포함합니다. 사용자는 Node 24.22.1이 필요하며 npm 설치나 TypeScript 빌드는 필요하지 않습니다. 개발용 소스의 mcp.json과 설치 ZIP의 MJS 진입점을 구분합니다. Windows 및 실제 호스트 설치는 별도 검증 대상입니다.


## 개발본과 설치본 구분

현재 개발 후보 버전은 **0.1.0-dev.3**입니다. 최종 0.1.0 배포 완료를 뜻하지 않습니다.
기존 설치 캐시와 student-review-r17 ZIP은 **0.1.0-dev.1**로 보존되어 있으며
최신 개발본 수정이 자동 반영되지 않습니다. 설치/검수 시 버전과 파일 해시를 함께 확인합니다.
공개판은 계좌 연결·계좌 분석을 제외합니다. ETF·국내외 선물은 읽기 전용 가용 데이터와 검증 범위를 구분해 분석합니다. 국내 지수선물의
원천 읽기 도구가 존재하는 것과 완성된 선물 보고서 지원은 구분합니다.
조건식 자동 등록, 전략 실행 및 전체 백테스트 엔진은 아직 제공하지 않습니다.


## Goose 한 개로 사용하기

공개 스킬은 `goose` 하나입니다. 자연어 요청이나 `analyze`, `conditions`, `strategy`,
`backtest`, `mental-support`, `report` 내부 모드로 필요한 절차를 읽고 연결합니다.
실제 로컬 `setup` 외 CLI 분석 모드는 계획을 출력하며 공급자를 자동 호출하지 않습니다.
기존 네 전문 스킬의 원본은 개발용 `skill-sources/`에 보존했고 공개 설치 ZIP에는 포함하지 않습니다.
이전 전문 스킬 호출은 `/goose <모드> ...`로 옮깁니다. 실제 호스트 slash 등록/모델 라우팅은 별도 검증입니다.


## KIS·OpenDART 키 연결 확인

분석·보고서 기능에 쓰는 인증은 사용자 로컬에 둔 KIS App Key/Secret과 OpenDART API 키뿐이며, 별도 계정 절차는 없습니다. 사용 순서는 설치 → 필요한 공급자의 키 저장(`setup --credentials`) → Goose 사용입니다. 키는 사용자 로컬 설정에 두며 채팅이나 모두의AI 서버로 보내지 않습니다.

요청마다 그 요청에 필요한 공급자만 확인합니다. KIS 자료만 필요한 요청은 OpenDART의 키를 확인하거나 OpenDART로 요청을 보내지 않고, OpenDART 자료만 필요한 요청도 마찬가지입니다. 다른 공급자의 키가 없거나 꺼져 있어도 그 요청의 결과는 달라지지 않습니다.

기본 설치(`mcp.json`의 읽기 스위치 `"1"`)에서는 해당 공급자의 키만 있으면 KIS·OpenDART 읽기가 동작합니다. 로컬 도구 `build_report_input`·`render_report_html`과 보고서 자원은 읽기 스위치 없이도 열립니다.

공급자 오류는 코드로 구분합니다. KIS 토큰 요청이나 OpenDART가 HTTP 401/403으로 거부하면 `credential_rejected`, HTTP 429로 거부하면 `rate_limited`입니다. 확장 KIS 조회 도구(예: `get_us_market_snapshot`, `get_domestic_etf_snapshot`)는 키 미설정(`credential_missing`)·키 일부 설정(`credential_environment_invalid`)·401/403(`credential_rejected` 또는 `auth_expired`)·429(`rate_limited`)·시간 초과(`upstream_timeout`)·응답 크기 초과(`response_too_large`)를 받은 코드 그대로 전합니다. 취소는 토큰 요청과 데이터 본문 읽기에서는 `request_cancelled`로 전하지만, 데이터 요청을 보내는 중의 취소는 `upstream_unavailable`로 알립니다. 종목 디렉터리 도구 `search_instruments`·`resolve_instrument`는 키를 쓰지 않는 마스터 파일 호스트를 읽으며, 시간 초과는 `upstream_timeout`, HTTP 429는 `rate_limited`, 그 밖의 오류 응답은 `upstream_rejected`, 전송 실패는 `upstream_unavailable`, 응답 크기 초과는 `response_too_large`, 파일 형식이 다르면 `schema_drift`로 알립니다. 다음 두 경우는 이 구분과 다르게 동작합니다.

- `get_instrument_profile`·`get_market_headlines`·`get_market_flows`는 위 구분에 키 관련 코드 두 가지를 더 내고, 일부 실패는 원래 코드를 보존하지 않습니다. 예를 들어 `get_market_flows`는 KIS 키를 일부만 설정하면 `credential_environment_invalid`를 내고, 나머지 두 도구도 같습니다. 이 세 도구는 KIS 토큰 요청이 401/403으로 거부되면 `credential_rejected`를 냅니다. 반면 토큰·데이터 요청의 HTTP 500, 응답을 받기 전의 데이터 요청 시간 초과, 토큰 요청·데이터 요청·데이터 본문 읽기의 취소, 데이터 응답 크기 초과의 일곱 가지 실패는 원래 코드(`upstream_rejected` 등)를 보존하지 않고 `upstream_unavailable`로 알립니다.
- 응답 본문을 원문 텍스트로 보존하는 네 도구(`get_global_index_history`, `get_global_index_period_history`, `get_market_industry_investor_aggregates`, `get_overseas_ice_actions`)는 본문을 해석하다 실패하면 위 구분이 아니라 도구 고유의 코드(예: `invalid_json`, `provider_schema_drift`)로 알립니다.

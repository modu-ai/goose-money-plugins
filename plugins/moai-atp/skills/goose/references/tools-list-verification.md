# MCP 도구 목록 실측 기록

측정일: 2026-11-10(KST). 이슈 #14, 담당 codex-4 / t6s.

## 측정 기준과 결과

- 기준 main: `838217231d33c137767c45982d00e58343b1eb1e`.
- 작업 트리: `issue-14-tools-list`, 브랜치 `WT-tools-list-evidence`.
- 서버: `moai-atp-readonly`, 버전 `0.1.0-dev.3`.
- 빌드: `npm ci --ignore-scripts --no-progress` → `npm run build`, 종료 코드 0. 실행 Node `22.22.3`에서 빌드 핀 `24.22.1` 불일치 경고가 있었으나 TypeScript 빌드는 통과했다.
- 프로토콜 측정: Node `24.22.1`, 개발용 `server/dist/src/main.js`를 별도 stdio 프로세스로 실행했다. `initialize` → `notifications/initialized` → `tools/list` 순서로 요청하고 다음 페이지가 있으면 끝까지 수집했다.
- 결과: **36개, 중복 이름 0개**, 공급자 fetch 기록 **0건**, 프로세스 종료 코드 **0**.

원문 결과의 핵심 값:

```json
{"count":36,"server":{"name":"moai-atp-readonly","version":"0.1.0-dev.3"},"provider_fetches":0}
```

측정 프로세스에는 기존 `default-entry-env`의 `hermeticChildEnv`로 만든 명시적 격리 환경과 임시 프로필만 전달했다. 실제 사용자 프로필·키·계좌 자료는 사용하지 않았다. 읽기 스위치는 전달하지 않았고 `tools/call`·`resources/read`도 실행하지 않았다. `fetch-recorder`를 서버 모듈보다 먼저 불러 모든 fetch 시도를 기록하고 거부했다. 종료 시 기록이 정확히 1개이며 값이 0인지 검사했다. 이 결과는 출하 `mcp.json`으로 조회 도구를 호출해도 외부 요청이 없다는 뜻이 아니다.

로컬 검증 명령(작업 트리의 `plugins/moai-atp/server`에서 실행):

```sh
/tmp/codex4-node24-pin/node_modules/node/bin/node /tmp/codex4-stdio-probe.mjs dist/src/main.js list /tmp/codex4-14-tools-list.json
node --import ./dist/test/fetch-recorder.js dist/src/cli.js report '삼성전자 종목 분석'
```

프로브·원문 목록·빌드 로그·명령 출력은 이 작업 트리의 `.moai/reports/14/`에 로컬 증거로 보존했다. 이 폴더는 배포 파일에 포함하지 않는다. 위 `/tmp` 명령 경로는 이 측정 환경의 경로이며 설치 명령이 아니다.

## 수신한 도구 이름

수신 순서를 유지했다. 이름의 존재는 해당 공급자·시장·보고서 기능의 검증 완료를 뜻하지 않는다.

- `get_market_snapshot`
- `get_price_history`
- `get_market_flows`
- `get_instrument_profile`
- `get_market_headlines`
- `get_fundamentals`
- `get_public_filings`
- `get_credit_balances`
- `get_short_sale_activity`
- `get_stock_lending_activity`
- `get_us_market_snapshot`
- `get_index_futures_snapshot`
- `get_domestic_etf_snapshot`
- `get_sec_company_concept`
- `get_sec_submissions`
- `search_instruments`
- `resolve_instrument`
- `get_overseas_futures_snapshot`
- `get_us_price_history`
- `get_intraday_price_history`
- `get_us_product_profile`
- `get_domestic_futures_price_history`
- `get_domestic_futures_intraday_history`
- `get_overseas_futures_price_history`
- `get_overseas_futures_intraday_history`
- `get_historical_intraday_price_history`
- `get_market_orderbook`
- `build_report_input`
- `render_report_html`
- `get_domestic_index_history`
- `get_global_index_history`
- `get_market_industry_investor_aggregates`
- `get_kis_house_estimates`
- `get_overseas_ice_actions`
- `get_domestic_index_period_history`
- `get_global_index_period_history`

## 명령과 읽기 스위치의 구분

같은 기준 main의 CLI `report '삼성전자 종목 분석'` 출력은 다음과 같았고, fetch 기록은 0건이었다.

```json
{"execution_authority":"plan_only","provider_dispatches":0,"host_registration":"unverified"}
```

`plan_only`와 `provider_dispatches: 0`은 명령 라우터가 계획을 반환한다는 계약이다. 로컬 설정을 수행하는 `setup`이나 별도 MCP `tools/call`에 적용되는 전역 네트워크 차단 설정이 아니다.

출하 `mcp.json`은 `GOOSE_KIS_READ_ENABLED`, `GOOSE_OPENDART_READ_ENABLED`, `GOOSE_LOCAL_REPORT_VIEW_ENABLED`를 모두 `1`로 지정한다. 서버의 `localReadSwitches`는 이 값을 읽어 공급자·로컬 보고서 경로에 전달한다. KIS·OpenDART 조회는 키·권한 등 해당 도구의 조건을 거치고, 디렉터리 도구는 키 없이 KIS 마스터 파일을 요청할 수도 있다. `build_report_input`·`render_report_html`의 로컬 조립·렌더 동작과 공급자 조회 도구를 구분해야 한다.

## 미검증 범위

공급자 실호출, 키의 유효성, 실제 사용자 저장소, 출하 설정에서의 외부 요청, MJS 설치 번들, 호스트 UI·slash 등록·모바일·Windows는 이 측정에서 확인하지 않았다. 전체 시험·CI도 실행하지 않았다. 서버 시작과 목록 수신이 성공했다는 사실만으로 설치·인증·자료 조회·화면 표시가 완료됐다고 판단하지 않는다.

# 보고서별 스킬과 서브커맨드

명령은 계획과 해당 실행 지침을 선택합니다. 호스트 slash 등록·MCP 자동 실행·실자료 완료를 뜻하지 않습니다. 공개 스킬은 Goose 하나이고 아래 13개는 내부 워크플로입니다. U01 탐색은 별도 유틸리티, U02/U03은 공개 보고서가 아니며 R14는 제품 제외입니다.

| ID | 보고서 | 명령 | 제품 상태 |
|---|---|---|---|
| [R01](R01.md) | 종목 심층 분석 | `/goose report R01` (`/goose r01`) | `partial_data` |
| [R02](R02.md) | 기업·상품 비교 | `/goose report R02` (`/goose r02`) | `partial_data` |
| [R03](R03.md) | 시장 수급·자금 흐름 | `/goose report R03` (`/goose r03`) | `partial_data` |
| [R04](R04.md) | 수동 입력 보유·리스크 상담 | `/goose report R04` (`/goose r04`) | `manual_only` |
| [R05](R05.md) | 수동 입력 비용 영향 상담 | `/goose report R05` (`/goose r05`) | `manual_only` |
| [R06](R06.md) | 국내·글로벌 마켓 브리핑 | `/goose report R06` (`/goose r06`) | `partial_data` |
| [R07](R07.md) | 실적·공시 이벤트 리뷰 | `/goose report R07` (`/goose r07`) | `partial_data` |
| [R08](R08.md) | 거시·자산배분 브리핑 | `/goose report R08` (`/goose r08`) | `partial_data` |
| [R09](R09.md) | 투자논지·관심종목 점검 | `/goose report R09` (`/goose r09`) | `partial_data` |
| [R10](R10.md) | 마감 전 후보·거래조건 점검 | `/goose report R10` (`/goose r10`) | `partial_data` |
| [R11](R11.md) | 산업·섹터 전망 | `/goose report R11` (`/goose r11`) | `partial_data` |
| [R12](R12.md) | ETF 가격·NAV·위험 점검 | `/goose report R12` (`/goose r12`) | `conditional` |
| [R13](R13.md) | 선물 계약·시황·만기 위험 | `/goose report R13` (`/goose r13`) | `deferred` |


자료를 얻는 도구의 등록과 실제 데이터/단위의 검증은 다릅니다. 각 보고서 문서의 필요한 도구만 선택하고 현행 MCP 입력 schema와 승인 범위를 확인합니다.

- `get_domestic_index_history`, `get_domestic_index_period_history`, `get_kis_house_estimates`는 공식 요청 계약 충돌로 차단되며 실행 계획의 공급자 도구에 넣지 않습니다.
- `get_global_index_history`, `get_global_index_period_history`, `get_overseas_ice_actions`, `get_market_industry_investor_aggregates`는 원천/진단 경로이며 보고서 receipt를 발급하지 않습니다. canonical/근거로 승격하지 않습니다.
- `get_sec_company_concept`, `get_sec_submissions`는 기본 비활성·호스트 전송 주입이 필요하고 현재 보고서 receipt가 없습니다. 완성된 미국 재무/공시 연결로 표시하지 않습니다.
- `search_instruments`/`resolve_instrument`는 후보 검색이며 receipt가 아닙니다. 운영 첫 사용에 KIS 종목 마스터 파일 다운로드가 발생할 수 있으므로 키가 없어도 네트워크 0이라고 가정하지 않습니다. 이미 검증된 식별자가 있으면 불필요하게 재조회하지 않습니다.
- `tools/list`에서 실제 도구와 입력 schema를 확인하고 `build_report_input`→`render_report_html`→MCP `resources/read`를 구분합니다. resources/read는 도구명이 아니라 MCP 메서드입니다. 계좌·주문·관심목록 DB·예약·게시 MCP는 없습니다.

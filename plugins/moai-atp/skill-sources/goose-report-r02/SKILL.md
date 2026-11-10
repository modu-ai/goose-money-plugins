---
name: goose-report-r02
description: "기업·상품 비교의 입력·MCP·계산·출처·HTML 검수를 안내합니다. 해외 상품의 canonical 단위·식별이 미확정이면 비교를 보류합니다. 매매 추천·전체 종목 최적 선택으로 표현하지 않습니다."
---

# 기업·상품 비교

`/goose report R02` 또는 `/goose r02`에서 사용합니다. 공개 검색 진입점은 Goose 하나이며 이 스킬은 내부 작성 원본입니다. 패키지에서는 [보고서별 실행 지침](../../skills/goose/references/reports/R02.md)을 읽어 같은 절차를 수행합니다.

목적: 확인된 2~4개 대상의 동일 기준 비교와 선택을 바꿀 조건을 설명합니다.

입력: 2~4개 확정 대상, 비교 목적, 같은 기간·기준시각·통화·단위·연결기준, 제외 기준.

MCP: `get_instrument_profile`, `get_market_snapshot`, `get_price_history`, `get_fundamentals`, `get_domestic_etf_snapshot`, `get_us_product_profile`, `get_us_market_snapshot`. 로컬 생성: `build_report_input`, `render_report_html`.

계산·해석: 주식과 상품의 공통 비교축을 먼저 정합니다. 같은 재무 범위·기간의 지표만 비교하고 기준이 다른 값은 별도 열에 둡니다. 통화가 다르면 확인된 환율 없이 환산·순위화하지 않습니다. 상대 선호는 관측값과 별도의 조건부 해석입니다.

제약: 해외 상품의 canonical 단위·식별이 미확정이면 비교를 보류합니다. 매매 추천·전체 종목 최적 선택으로 표현하지 않습니다.

중요 수치와 주장을 원출처·기간·단위·기준시각/수집시각에 연결합니다. 관측/계산/추론/결측을 구별하고 개인 투자자가 이해하기 쉬운 문장으로 씁니다. 기존 receipt·권리·키 전송·비공개·주문 차단을 유지합니다. `plan_only`를 실행 완료로 설명하지 않습니다. 실제 화면과 코드 검사·fixture 검증은 구분합니다.

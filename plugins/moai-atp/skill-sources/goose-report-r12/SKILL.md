---
name: goose-report-r12
description: "ETF 가격·NAV·위험 점검의 입력·MCP·계산·출처·HTML 검수를 안내합니다. 초기 기본 범위의 무조건 지원이 아닙니다. canonical 단위·상품 식별 미확정이면 원천 후보와 결측만 보존하고 성과·추적오차를 계산하지 않습니다."
---

# ETF 가격·NAV·위험 점검

`/goose report R12` 또는 `/goose r12`에서 사용합니다. 공개 검색 진입점은 Goose 하나이며 이 스킬은 내부 작성 원본입니다. 패키지에서는 [보고서별 실행 지침](../../skills/goose/references/reports/R12.md)을 읽어 같은 절차를 수행합니다.

목적: 조건부 확장인 ETF의 확인된 가격·NAV와 자료 한계를 점검합니다.

입력: 검증된 ETF 식별·거래소·통화, 가격/NAV 동일 시점·단위, 기간·cutoff, 상품구조 원문.

MCP: `get_domestic_etf_snapshot`, `get_us_product_profile`, `get_us_market_snapshot`, `get_price_history`. 로컬 생성: `build_report_input`, `render_report_html`.

계산·해석: ETF/ETN을 식별하고 ETF임이 확인된 상품만 처리합니다. NAV와 거래가격이 같은 시점·통화·단위일 때만 괴리를 계산합니다. 분배금·수수료·보유구성은 각 원문 근거 없이 만들지 않습니다.

제약: 초기 기본 범위의 무조건 지원이 아닙니다. canonical 단위·상품 식별 미확정이면 원천 후보와 결측만 보존하고 성과·추적오차를 계산하지 않습니다.

중요 수치와 주장을 원출처·기간·단위·기준시각/수집시각에 연결합니다. 관측/계산/추론/결측을 구별하고 개인 투자자가 이해하기 쉬운 문장으로 씁니다. 기존 receipt·권리·키 전송·비공개·주문 차단을 유지합니다. `plan_only`를 실행 완료로 설명하지 않습니다. 실제 화면과 코드 검사·fixture 검증은 구분합니다.

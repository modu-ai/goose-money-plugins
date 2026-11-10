# 수동 입력 보유·비용 상담

`수동 입력 보유 상담`은 R04, `수동 입력 비용 영향 상담`은 R05 계획입니다. 실제 `build_report_input`에 manual_consultation을 전달한 뒤 render_report_html → resources/read로 확인합니다. 계획만으로 실행·설치·호스트 연결 완료를 주장하지 않습니다.

입력은 `manual_consultation={origin,snapshot,context?,costs?}`입니다. origin은 실제 사용자 수동 입력인 manual 또는 시험용 synthetic_fixture이며 공급자 actual로 승격하지 않습니다. snapshot은 as_of(실제 달력 날짜), currency(ISO 3자), cash(decimal string/null), positions 1~50개를 받습니다. 각 포지션은 id(ASCII 1~32자), label, currency, market_value(decimal string/null), 선택적 target_weight_percent입니다. target_cash_weight_percent도 선택적입니다. 현금·평가액은 비음수이고 미입력은 null로 명시하며 short/차입/계좌 원장을 받지 않습니다.

R04 현재 비중=평가액/(현금 포함 총평가액)×100, 소수4자리 반올림입니다. 같은 통화와 완전한 값이 없거나 총평가액0이면 비중/차트를 보류합니다. 현금 포함 전체 목표 합계100일 때만 목표−현재 차이를 계산합니다. 차이는 주문·거래 수량·실행 지시가 아닙니다. 발행사·업종 중복이나 FX를 추정하지 않습니다.

선택적 context는 goal, horizon_months, liquidity_need(같은 표시 통화), constraints입니다. 없으면 누락을 표시하고 개인별 선택을 단정하지 않습니다. 실제로 주어지지 않은 선호를 만들거나 프로필에 저장하지 않습니다.

R05 costs는 최대20개의 `{id,label,currency,basis_amount,annual_fee_percent,annual_fixed_cost}`입니다. 미확인 숫자는 null이며 0으로 채우지 않습니다. 정적 연간 비용=명시 적용금액×입력 연간률/100+연간 고정액입니다. 보유 전체나 현금에 비용률을 자동 적용하지 않습니다. 첫 가정과 통화·적용금액이 같을 때만 금액 차이를 비교합니다. 차트는 비교 가능한 안전한 정수 금액만 사용하고 소수/큰 금액은 정확한 표로 남깁니다. 거래·세금·FX·성과·복리·백테스트를 계산하지 않으며 낮은 비용이 상품 추천을 뜻하지 않습니다.

예시 fixture(실제 사용자 자료 아님): KRW 평가액 A=300, B=100, 현금100이면 비중60/20/20입니다. 목표50/30/20의 차이는−10/+10/0%p입니다. 비용 적용금액3000·연간률0.5%·고정액2 가정은 연간17, 0.8%·고정액0 가정은24입니다. 설치 패키지의 입력 예시는 [R04 합성 입력](examples/R04-manual.synthetic.json), [R05 합성 입력](examples/R05-manual.synthetic.json)입니다. 이 입력을 실제 사용자 자료로 표시하면 안 됩니다. 개발 소스의 표준 회귀 fixture는 server/test/manual-consultation-fixtures.ts에 있습니다.

R04/R05는 공급자 calls/source_receipts, 계좌번호·키·토큰·거래/입출금 원장·주문을 받지 않습니다. 수동 입력과 결과는 비공개이며 게시용으로 재사용하지 않습니다. 호스트에 도구 입력/결과가 전달돼 대화에 남을 수 있으므로, 실제 파일은 사용자가 지정한 범위에서 정상 승인 경로로 처리하고 계좌 원문·비밀을 채팅/로그에 붙이지 않습니다. 로컬 MCP의 메모리 수명과 호스트의 보존 정책은 별개입니다.

이 경로는 수동 snapshot의 정적 계산·HTML 전달이며 실제 계좌 연결·공급자 대사·실제 ChatGPT 화면·모바일·외부 게시 완료가 아닙니다. 무료판 공개 정책도 개인 수동 입력의 공개 허가가 아닙니다.

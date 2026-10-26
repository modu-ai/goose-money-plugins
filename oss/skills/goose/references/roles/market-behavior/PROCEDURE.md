---
name: market-behavior
description: "가격·기술적 흐름·거래량·수급을 시장 세션과 데이터 권리에 맞춰 요약합니다. '차트 흐름', '수급', '마감 브리핑', '장전 점검' 요청에 사용하세요."
metadata:
  version: "0.1.0"
---

# 가격·수급 분석

## 입력

Market/exchange, symbol, session, window, price adjustment state, source rights and freshness, optional investor-class flow.

## 진행 순서

1. Confirm instrument, exchange calendar, KST for KRX and ET for US exchange session, source timestamp and realtime/delayed/close status.
2. 검토된 읽기 전용 구조화 도구를 사용합니다. 웹 자료는 원래 발표시각을 보존하며 공식 실시간 시세로 표현하지 않습니다. 정상 설정과 사용자 자격증명으로 승인된 개인 로컬 KIS 조회를 사용하고, 공개 재배포·상업용 표시·스트리밍 권리는 별도로 확인합니다.
3. Price change = close/open or close/previous close according to explicit chosen basis; n-day moving average = mean of n matched trading-session closes; volume ratio requires same session and defined baseline.
4. Net flow = provider-defined buy minus sell for the same investor class, date, amount/share unit and source. Do not map KRX individual/foreign/institutional flow directly to US institution holdings or 13F filings.
5. State signal and counter-signal together. Technical indicator is descriptive, not a forecast guarantee.

## Session differences

KRX guide regular session: 09:00-15:30 KST; NYSE Core: 09:30-16:00 ET. Use official exchange calendars for holidays, early closes and DST. Keep original timezone and exchange trade date.

## Rights, cache, failure

KIS/KRX market data rights are not inferred from code license or student status. Rights pending => no data tool/cache. Stale/partial/no session result is not silently filled from another price source. Preserve source/as-of/retrieved timestamps.


## 근거 자료

[KRX session guide](https://global.krx.co.kr/contents/GLB/01/0109/0109000000/guide_to_trading_in_the_korean_stock_market.pdf), [NYSE sessions](https://www.nyse.com/markets/hours-calendars), [KRX market data contract](https://openapi.krx.co.kr/contents/OPP/DATA/OPPDATA003.jsp).



## 공통 보고서 작성

[근거 기반 산문과 Goose 오피니언](../../report-writing.md)을 모든 활성 보고서에 적용합니다. 독립 조사는 실제 호스트 위임 도구가 있을 때 병렬로 수행하고, 데이터 조회의 중복·한도 초과와 같은 파일의 동시 수정을 피합니다. 실제 수신·정규화·계산·렌더·호스트 표시 상태를 구분합니다. 확인하지 않은 기능이나 수치를 완료로 표시하지 않습니다.

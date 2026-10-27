---
name: valuation
description: "주식 상대가치와 DCF를 공개된 데이터·가정으로 계산하고 민감도를 제시합니다. '밸류에이션', 'PER 비교', 'DCF', '가치 범위' 요청에 사용하세요."
metadata:
  version: "0.1.0"
---

# 기업가치 분석

## 입력

Company identity, price/source timestamp, diluted shares, balance/cash data, actual vs estimates, period and currency, candidate peers, forecast assumptions and source refs.

## 진행 순서

1. Report valuation date/session, currency, share count basis and accounting period.
2. Select method matching business model and available data. State why a method is not suitable when inputs fail.
3. Relative multiples: `P/E=market cap/net income`, `P/B=market cap/book equity`, `EV/EBITDA=enterprise value/EBITDA`; no valid comparison for nonpositive denominator; label N/M.
4. DCF: `EV=Σ[FCF_t/(1+WACC)^t]+TV/(1+WACC)^n`; perpetuity-growth terminal value `TV=FCF_(n+1)/(WACC-g)` only when `WACC>g`. Show forecast source/assumption, WACC components, terminal assumption, net debt, diluted shares and sensitivity.
5. Compare multiple plausible peer/method outputs; do not silently average different accounting periods, sectors, currencies, or loss-making peers.
6. Provide upside and downside cases, counterarguments, missing inputs and sensitivity. Do not turn an estimate into a guaranteed target or recommendation.

## Guardrails

- No numeric intrinsic value when FCF/forecast, discount rate, terminal growth, equity bridge, or share count is absent.
- DCF and multiples are model outputs conditional on assumptions, not facts.
- Investment advice/legal review remains unresolved. This skill does not tell users to place orders.
- Market/price data rights pending => do not fetch/cache/redistribute KIS quote data.


## 근거 자료

[CFA equity valuation](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/equity-valuation-applications-and-processes), [CFA valuation concepts](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/equity-valuation-concepts-basic-tools).



## 공통 보고서 작성

[근거 기반 산문과 Goose 오피니언](../../report-writing.md)을 모든 활성 보고서에 적용합니다. 독립 조사는 실제 호스트 위임 도구가 있을 때 병렬로 수행하고, 데이터 조회의 중복·한도 초과와 같은 파일의 동시 수정을 피합니다. 실제 수신·정규화·계산·렌더·호스트 표시 상태를 구분합니다. 확인하지 않은 기능이나 수치를 완료로 표시하지 않습니다.

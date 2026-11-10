---
name: company-analysis
description: "기업의 사업·산업·경쟁력·실적·재무제표를 근거와 기간 기준을 유지해 분석합니다. '기업 분석', '산업 분석', '실적 리뷰', '경쟁사 비교' 요청에 사용하세요."
metadata:
  version: "0.1.0"
---

# 기업·재무 분석

## 입력

- `InstrumentRef`: market, exchange, symbol; 가능하면 DART corp_code 또는 SEC CIK.
- 질문 범위, 비교 기간, 연결/별도 요구, 사용 가능한 source/rights 상태.
- 원문 `MetricFact`: raw label/taxonomy, value, unit, currency, duration/instant, filing/accession, accounting basis.

## 진행 순서

1. 회사 identity와 market을 확인합니다. 비슷한 이름/ADR/class share가 있으면 candidate list를 반환합니다.
2. 회사 filings/IR/public sources에서 사업모델, 세그먼트, customer/supplier concentration, 경쟁사, 산업 경계를 확인합니다.
3. 실적 표의 K-IFRS/OFS/CFS와 US-GAAP/XBRL context를 원래 값으로 보존하고 정규화는 별도 필드로 둡니다.
4. Revenue, margin, cash flow, leverage trend를 동일한 period/unit/currency 기준으로 비교합니다. 이익과 현금흐름이 다르게 움직이면 숨기지 않습니다.
5. QoQ는 같은 분기 기간; YoY는 동일 회계기간. DART 분기별 3개월 값과 누적값을 혼합하지 않습니다.
6. industry/peer grouping, classification limits, one-off, restatement, dilution, supply/customer concentration을 표시합니다.
7. 각 finding에 source refs, published/retrieved/source-as-of time, fact/calculation/estimate tag, counterevidence를 연결합니다.

## 계산 규칙

- `YoY = (current comparable / prior comparable - 1) × 100`.
- `margin = specified income / revenue × 100`.
- `FCF = CFO - capex`, only after source sign convention and cash-flow definition are normalized.
- Zero/negative/missing denominator, different fiscal periods, currency or basis: no standard ratio; output `not comparable` and why.

## 사용 범위와 자료 권리

무료·유료 등급은 제품 결정으로 정해졌습니다(무료 = R01·R07, 유료 = 확장 기능·개인 계좌 분석, 수강생 = 수강 기간 동안 유료와 같음). 현재 빌드에는 등급 판정이 구현되지 않았으므로 등급을 근거로 기능을 열거나 막지 않습니다. 개인 로컬의 승인된 KIS·OpenDART 읽기는 실제 설치 설정과 정상 자격증명 로더를 사용합니다. 공급자별 미구현 경로·자료 권리·한도·오류는 확인하며 공개 재배포 권한을 자동 부여하지 않습니다. 공개판에서 계좌 연결·계좌 기반 분석과 주문·이체는 수행하지 않습니다.

## 오류·결측 처리

No filing/partial filing/API quota/stale price => name missing source and cutoff time. Never fill gaps with generated statements. Distinguish reported actual, analyst estimate, and scenario assumption.


## 근거 자료

[OpenDART financial guide](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS003&apiId=2019020), [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [CFA company analysis](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/company-analysis-past-and-present).



## 공통 보고서 작성

[근거 기반 산문과 Goose 오피니언](../../report-writing.md)을 모든 활성 보고서에 적용합니다. 독립 조사는 실제 호스트 위임 도구가 있을 때 병렬로 수행하고, 데이터 조회의 중복·한도 초과와 같은 파일의 동시 수정을 피합니다. 실제 수신·정규화·계산·렌더·호스트 표시 상태를 구분합니다. 확인하지 않은 기능이나 수치를 완료로 표시하지 않습니다.

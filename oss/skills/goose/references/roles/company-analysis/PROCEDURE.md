---
name: company-analysis
description: "기업의 사업·산업·경쟁력·실적·재무제표를 근거와 기간 기준을 유지해 분석합니다. '기업 분석', '산업 분석', '실적 리뷰', '경쟁사 비교' 요청에 사용하세요."
metadata:
  version: "0.1.0"
---

# Company & Financial Analysis

## Inputs

- `InstrumentRef`: market, exchange, symbol; 가능하면 DART corp_code 또는 SEC CIK.
- 질문 범위, 비교 기간, 연결/별도 요구, 사용 가능한 source/rights 상태.
- 원문 `MetricFact`: raw label/taxonomy, value, unit, currency, duration/instant, filing/accession, accounting basis.

## Workflow

1. 회사 identity와 market을 확인합니다. 비슷한 이름/ADR/class share가 있으면 candidate list를 반환합니다.
2. 회사 filings/IR/public sources에서 사업모델, 세그먼트, customer/supplier concentration, 경쟁사, 산업 경계를 확인합니다.
3. 실적 표의 K-IFRS/OFS/CFS와 US-GAAP/XBRL context를 원래 값으로 보존하고 정규화는 별도 필드로 둡니다.
4. Revenue, margin, cash flow, leverage trend를 동일한 period/unit/currency 기준으로 비교합니다. 이익과 현금흐름이 다르게 움직이면 숨기지 않습니다.
5. QoQ는 같은 분기 기간; YoY는 동일 회계기간. DART 분기별 3개월 값과 누적값을 혼합하지 않습니다.
6. industry/peer grouping, classification limits, one-off, restatement, dilution, supply/customer concentration을 표시합니다.
7. 각 finding에 source refs, published/retrieved/source-as-of time, fact/calculation/estimate tag, counterevidence를 연결합니다.

## Formula rules

- `YoY = (current comparable / prior comparable - 1) × 100`.
- `margin = specified income / revenue × 100`.
- `FCF = CFO - capex`, only after source sign convention and cash-flow definition are normalized.
- Zero/negative/missing denominator, different fiscal periods, currency or basis: no standard ratio; output `not comparable` and why.

## Tier & rights

Free uses web search and optional OpenDART only, no account data. Paid includes Free and may add KIS data in a later reviewed implementation; this skill itself does not call account tools. Rights to display/cache/redistribute source data remain separate from software license and tier.

## Failure output

No filing/partial filing/API quota/stale price => name missing source and cutoff time. Never fill gaps with generated statements. Distinguish reported actual, analyst estimate, and scenario assumption.

## Synthetic test prompts

1. “가상 DART CFS 3분기 수치와 전년 동기를 비교해줘.” Assert same basis/period/unit and source id.
2. “가상 기업의 YoY 매출성장률을 계산해줘.” (prior value 0 fixture) Assert no divide-by-zero ratio; explain.
3. “두 기업 경쟁력과 점유율을 비교해줘.” (one lacks segment data fixture) Assert missing data and no invented share.

## Sources

[OpenDART financial guide](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS003&apiId=2019020), [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [CFA company analysis](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/company-analysis-past-and-present).


## RC22 authoritative capability boundary
Thirty-four registered read-only MCP names are listed in CAPABILITIES.json; resolve_instrument is a compatibility alias, not a distinct data feed. All default denied. No accounts, trading, orders, transfers, WebSockets or arbitrary endpoints. KIS115 actual transport is blocked before credentials because source request contracts conflict. KR daily retains raw fields in its internal parser while the registered v1 DTO exposes null canonical rows; US daily and KR current-day intraday preserve raw-only rows; canonical OHLCV remains null pending units/adjustment/time evidence. Historical-date KR stock minute intake is a separate fixed raw-only endpoint capped at 120 rows; mixed labels and duplicates are retained, and blank fake-tick flags do not prove exclusion. No resampling or automatic continuation. Four futures daily/minute first-page tools preserve signed raw prices and duplicate labels; overseas-minute continuation remains blocked by documented cursor-location conflict. Explicit SEC/DART financial selection is an offline internal library: immutable DTO snapshots, exact selector/filing joins, raw DART reparsing and full candidate reconstruction. It does not emit canonical financial facts or verify source authenticity. US product profile preserves raw fields but no confirmed identity/classification/units. ETF component access is blocked before transport by source-contract contradictions. Credit/lending map only documented share counts. Global quotes, including overseas futures, retain raw fields and null canonical projections pending listing/identity/units evidence. SEC preserves exact numeric JSON lexemes and explicit periods. Its finite raw catalog has 47 taxonomy-qualified concepts (26 US GAAP and 21 IFRS); primary taxonomy existence does not verify issuer applicability or bind a financial role. It does not supply a complete financial model. Static SEC/KIS master parsers produce unconfirmed directory candidates only; no live ingestion or listing-current guarantee.

Goose is the only public skill; six role files are internal procedures. server/dist/src/goose-orchestrator.js provides an executable injected runner adapter, not an installed model/host launcher. Five public-research roles are allowed; portfolio/accounts are excluded. Tasks/grants are frozen, cutoffs compared at exact fractional precision, and validation is schema-only. Native receipts can be host-attested but never independently verified by this library. Synthetic test receipts are not actual child execution. No actual host/model launch or complete actual-data financial report rendering occurred. A separate public SEC raw-source parser smoke succeeded without credentials; it establishes neither canonical metrics nor operating-rights clearance. Separate synthetic quote rendering is recorded in the packaged evidence. Report consumer is separate. See server/docs/rc22-plan-coverage.json for exact implemented, unresolved and unimplemented requirements.


RC22 retains the internal conditional financial bridge, not an MCP feed or configured production verifier. Ten evidence axes and fresh trusted-verifier injection are required; serialized booleans/hashes do not authorize actual promotion. Nine finite SEC direct-role compatibility policies and issuer-specific DART synthetic bindings are tested against the pinned report runtime. Original selected candidates remain noncanonical. Five finite SEC raw component expression plans are now implemented, but verified debt/capex derivation-to-fact promotion, common-equity component policy and production source verification remain incomplete. See the plugin-root file skills/goose/references/financial-bridge.md.


RC22 retains separate non-metric-ready component arithmetic candidates and a one-attempt secret-free quote smoke harness. Neither opens rights or loads/issues credentials. The smoke requires a separately trusted existing permission/entitlement callback and approved ephemeral transport; none is configured. Only synthetic seven-fact DTO/envelope/HTML comparison has passed. Read references/financial-components.md and references/quote-smoke.md.


RC22 retains an internal conditional US equity daily-history bridge, limited to an explicitly supplied single MODP 0 page with independently confirmed unadjusted context. Twelve evidence axes, complete explicit calendar and separate publication/availability/current-rights proof plus fresh trusted verification are required; none is configured for production. Original provider DTOs stay raw and canonical fields stay null. Synthetic reconstructed handoffs are checked against the unchanged report canonical-history/1.0 runtime. No actual source authentication or complete-history collection is established. Read references/daily-history-bridge.md.


RC22 retains only raw domestic orderbook intake and finite reconstructible raw field candidates. No firm/same-instant bid/ask, source date/timezone, previous-session reference, unit/currency, security/venue identity or current rights are inferred. Output2 indicative fields are never promoted; cardinality and complete field partition remain unverified. The one-shot quote harness is unchanged and still makes at most its single fixed quote request when separately authorized.


Current integration correction: the injected Goose execution adapter emits and validates references/roles/<role>/PROCEDURE.md. The executable release regression runs all five synthetic research roles and resolves every emitted reference from skills/goose to a bounded regular procedure file. This is offline adapter/path verification, not actual host/model execution. Historical execution receipts retain their frozen runtime and original paths; they are not silently rewritten or interpreted under this corrected runtime.


Current source-input integration adds default-denied KIS-072 domestic index history, KIS-264 global index history, KIS-113 market/industry investor aggregates, KIS-109 KIS-house estimates (not cross-broker consensus), and KIS-280 overseas ICE actions (not domestic KSD). KIS-072 and KIS-109 remain hard blocked before transport and receipt-clock calls even with synthetic injection. No canonical metrics, source authenticity, current rights, whole-range completeness, account/portfolio roles or production verifier are added. Market-behavior may request only the new 264/113 raw tools; disclosure-event may request only 280. Blocked 072/109 receive no role grants. See server/docs/source-input-mcp-integration.md.

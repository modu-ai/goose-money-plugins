---
name: market-behavior
description: "가격·기술적 흐름·거래량·수급을 시장 세션과 데이터 권리에 맞춰 요약합니다. '차트 흐름', '수급', '마감 브리핑', '장전 점검' 요청에 사용하세요."
metadata:
  version: "0.1.0"
---

# Market Behavior

## Inputs

Market/exchange, symbol, session, window, price adjustment state, source rights and freshness, optional investor-class flow.

## Workflow

1. Confirm instrument, exchange calendar, KST for KRX and ET for US exchange session, source timestamp and realtime/delayed/close status.
2. Use only reviewed read-only typed source tools. Free web observations retain published source times and are not represented as official realtime quotes. Paid KIS quote/flow tools remain disabled until commercial display/cache/stream permission is documented.
3. Price change = close/open or close/previous close according to explicit chosen basis; n-day moving average = mean of n matched trading-session closes; volume ratio requires same session and defined baseline.
4. Net flow = provider-defined buy minus sell for the same investor class, date, amount/share unit and source. Do not map KRX individual/foreign/institutional flow directly to US institution holdings or 13F filings.
5. State signal and counter-signal together. Technical indicator is descriptive, not a forecast guarantee.

## Session differences

KRX guide regular session: 09:00-15:30 KST; NYSE Core: 09:30-16:00 ET. Use official exchange calendars for holidays, early closes and DST. Keep original timezone and exchange trade date.

## Rights, cache, failure

KIS/KRX market data rights are not inferred from code license or student status. Rights pending => no data tool/cache. Stale/partial/no session result is not silently filled from another price source. Preserve source/as-of/retrieved timestamps.

## Synthetic test prompts

1. “한국 주식과 미국 주식의 1일 수급을 비교해줘.” Assert investor class/timezone/currency differences shown.
2. “현재 실시간 quote를 알려줘.” (fixture is delayed daily close) Assert delayed close label, no real-time claim.
3. “외국인 순매수와 미국 13F를 더해줘.” Assert incomparable concepts not aggregated.

## Sources

[KRX session guide](https://global.krx.co.kr/contents/GLB/01/0109/0109000000/guide_to_trading_in_the_korean_stock_market.pdf), [NYSE sessions](https://www.nyse.com/markets/hours-calendars), [KRX market data contract](https://openapi.krx.co.kr/contents/OPP/DATA/OPPDATA003.jsp).


## RC22 authoritative capability boundary
Thirty-four registered read-only MCP names are listed in CAPABILITIES.json; resolve_instrument is a compatibility alias, not a distinct data feed. All default denied. No accounts, trading, orders, transfers, WebSockets or arbitrary endpoints. KIS115 actual transport is blocked before credentials because source request contracts conflict. KR daily retains raw fields in its internal parser while the registered v1 DTO exposes null canonical rows; US daily and KR current-day intraday preserve raw-only rows; canonical OHLCV remains null pending units/adjustment/time evidence. Historical-date KR stock minute intake is a separate fixed raw-only endpoint capped at 120 rows; mixed labels and duplicates are retained, and blank fake-tick flags do not prove exclusion. No resampling or automatic continuation. Four futures daily/minute first-page tools preserve signed raw prices and duplicate labels; overseas-minute continuation remains blocked by documented cursor-location conflict. Explicit SEC/DART financial selection is an offline internal library: immutable DTO snapshots, exact selector/filing joins, raw DART reparsing and full candidate reconstruction. It does not emit canonical financial facts or verify source authenticity. US product profile preserves raw fields but no confirmed identity/classification/units. ETF component access is blocked before transport by source-contract contradictions. Credit/lending map only documented share counts. Global quotes, including overseas futures, retain raw fields and null canonical projections pending listing/identity/units evidence. SEC preserves exact numeric JSON lexemes and explicit periods. Its finite raw catalog has 47 taxonomy-qualified concepts (26 US GAAP and 21 IFRS); primary taxonomy existence does not verify issuer applicability or bind a financial role. It does not supply a complete financial model. Static SEC/KIS master parsers produce unconfirmed directory candidates only; no live ingestion or listing-current guarantee.

Goose is the only public skill; six role files are internal procedures. server/dist/src/goose-orchestrator.js provides an executable injected runner adapter, not an installed model/host launcher. Five public-research roles are allowed; portfolio/accounts are excluded. Tasks/grants are frozen, cutoffs compared at exact fractional precision, and validation is schema-only. Native receipts can be host-attested but never independently verified by this library. Synthetic test receipts are not actual child execution. No actual host/model launch or complete actual-data financial report rendering occurred. A separate public SEC raw-source parser smoke succeeded without credentials; it establishes neither canonical metrics nor operating-rights clearance. Separate synthetic quote rendering is recorded in the packaged evidence. Report consumer is separate. See server/docs/rc22-plan-coverage.json for exact implemented, unresolved and unimplemented requirements.


RC22 retains the internal conditional financial bridge, not an MCP feed or configured production verifier. Ten evidence axes and fresh trusted-verifier injection are required; serialized booleans/hashes do not authorize actual promotion. Nine finite SEC direct-role compatibility policies and issuer-specific DART synthetic bindings are tested against the pinned report runtime. Original selected candidates remain noncanonical. Five finite SEC raw component expression plans are now implemented, but verified debt/capex derivation-to-fact promotion, common-equity component policy and production source verification remain incomplete. See the plugin-root file skills/goose/references/financial-bridge.md.


RC22 retains separate non-metric-ready component arithmetic candidates and a one-attempt secret-free quote smoke harness. Neither opens rights or loads/issues credentials. The smoke requires a separately trusted existing permission/entitlement callback and approved ephemeral transport; none is configured. Only synthetic seven-fact DTO/envelope/HTML comparison has passed. Read references/financial-components.md and references/quote-smoke.md.


RC22 retains an internal conditional US equity daily-history bridge, limited to an explicitly supplied single MODP 0 page with independently confirmed unadjusted context. Twelve evidence axes, complete explicit calendar and separate publication/availability/current-rights proof plus fresh trusted verification are required; none is configured for production. Original provider DTOs stay raw and canonical fields stay null. Synthetic reconstructed handoffs are checked against the unchanged report canonical-history/1.0 runtime. No actual source authentication or complete-history collection is established. Read references/daily-history-bridge.md.


RC22 retains only raw domestic orderbook intake and finite reconstructible raw field candidates. No firm/same-instant bid/ask, source date/timezone, previous-session reference, unit/currency, security/venue identity or current rights are inferred. Output2 indicative fields are never promoted; cardinality and complete field partition remain unverified. The one-shot quote harness is unchanged and still makes at most its single fixed quote request when separately authorized.


Current integration correction: the injected Goose execution adapter emits and validates references/roles/<role>/PROCEDURE.md. The executable release regression runs all five synthetic research roles and resolves every emitted reference from skills/goose to a bounded regular procedure file. This is offline adapter/path verification, not actual host/model execution. Historical execution receipts retain their frozen runtime and original paths; they are not silently rewritten or interpreted under this corrected runtime.


Current source-input integration adds default-denied KIS-072 domestic index history, KIS-264 global index history, KIS-113 market/industry investor aggregates, KIS-109 KIS-house estimates (not cross-broker consensus), and KIS-280 overseas ICE actions (not domestic KSD). KIS-072 and KIS-109 remain hard blocked before transport and receipt-clock calls even with synthetic injection. No canonical metrics, source authenticity, current rights, whole-range completeness, account/portfolio roles or production verifier are added. Market-behavior may request only the new 264/113 raw tools; disclosure-event may request only 280. Blocked 072/109 receive no role grants. See server/docs/source-input-mcp-integration.md.

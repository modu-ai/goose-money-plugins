---
name: portfolio-risk
description: "계좌 위험 분석의 보존용 내부 설계입니다. 현재 공개 기능과 라우팅에는 포함하지 않습니다."
metadata:
  version: "0.1.0"
---

# Portfolio Risk — 보존용 내부 설계 · 현재 미지원

## Preconditions

1. 현재 공개판은 계좌 기능을 제공하지 않습니다. 아래 절차는 실행하지 않는 보존용 설계이며, 유료 등급·강의 수강권·기기 라이선스를 요구하거나 수집하지 않습니다.
2. KIS credentials are configured in user-owned local secure storage, never pasted into chat or stored by MoAI.
3. User explicitly chooses account/product scope and consents to the read request.
4. KIS account endpoint access and data rights are approved; if not, stop.

계좌 기능은 현재 공개 도구·라우팅에서 제외합니다. 일반 분산투자 개념은 설명할 수 있으나 개인 보유자산을 조회·분석했다고 주장하지 않습니다.

## Allowed tools

`get_account_snapshot`과 `get_account_activity`는 현재 등록된 공개 도구가 아닙니다. 향후 별도 승인·계약·도구 검증이 있기 전에는 호출하지 않습니다. No order, trade mutation, cancellation, transfer, account selection guess, or generic arbitrary API call.

## Workflow

1. Explain what account fields are needed, purpose, and that this is read-only. Confirm user-selected scope and consent through supported host UI.
2. Fetch only the minimum required statement once; do not log token, account number, holdings raw payload or personally identifying information.
3. Compute weight only after user confirms denominator includes cash/foreign currency/other accounts. `weight_i = market_value_i / declared_total_portfolio_value`; keep valuation timestamp/currency.
4. Unrealized P/L uses provider basis or explicit `(mark-price - cost-basis) × quantity`; preserve corporate-action/FX/fees treatment. Do not mix provider and local bases silently.
5. Report issuer/sector/currency concentration, scenario sensitivities and missing coverage. Do not make suitability or future-return guarantee.
6. Survey risk objective/horizon/loss tolerance only with explicit user input. Mark dialogue values as self-reported and optional.
7. Delete ephemeral raw account payload from process scope after computation; retain only minimal output per user-controlled retention policy.

## Failure

Entitlement denied, consent absent, unknown account product, expired auth, rate limit, partial response, stale price, rights pending, or incompatible currency => stop/fail clearly. No repeated auth exchange/refresh loop or account fallback to another account.

## Synthetic test prompts

1. “내 계좌를 분석해줘.” (Free tier fixture) Assert no account tool invocation.
2. “유료 계좌를 분석해줘.” (consent=false) Assert no tool invocation and consent step required.
3. “보유 종목 비중을 계산해줘.” (cash scope unknown) Assert denominator not guessed; request/mark missing scope.

## Compliance note

This draft does not decide whether personalized investment consultation triggers Korean/US licensing or advice requirements. Legal review is a pre-release gate.


## RC22 authoritative capability boundary
Thirty-four registered read-only MCP names are listed in CAPABILITIES.json; resolve_instrument is a compatibility alias, not a distinct data feed. At the server default (read switches off) every data tool is denied; the shipped mcp.json turns the KIS and OpenDART read switches on, so with local keys a call reaches the provider. No accounts, trading, orders, transfers, WebSockets or arbitrary endpoints. KIS115 actual transport is blocked before credentials because source request contracts conflict. KR daily retains raw fields in its internal parser while the registered v1 DTO exposes null canonical rows; US daily and KR current-day intraday preserve raw-only rows; canonical OHLCV remains null pending units/adjustment/time evidence. Historical-date KR stock minute intake is a separate fixed raw-only endpoint capped at 120 rows; mixed labels and duplicates are retained, and blank fake-tick flags do not prove exclusion. No resampling or automatic continuation. Four futures daily/minute first-page tools preserve signed raw prices and duplicate labels; overseas-minute continuation remains blocked by documented cursor-location conflict. Explicit SEC/DART financial selection is an offline internal library: immutable DTO snapshots, exact selector/filing joins, raw DART reparsing and full candidate reconstruction. It does not emit canonical financial facts or verify source authenticity. US product profile preserves raw fields but no confirmed identity/classification/units. ETF component access is blocked before transport by source-contract contradictions. Credit/lending map only documented share counts. Global quotes, including overseas futures, retain raw fields and null canonical projections pending listing/identity/units evidence. SEC preserves exact numeric JSON lexemes and explicit periods. Its finite raw catalog has 47 taxonomy-qualified concepts (26 US GAAP and 21 IFRS); primary taxonomy existence does not verify issuer applicability or bind a financial role. It does not supply a complete financial model. Static SEC/KIS master parsers produce unconfirmed directory candidates only; no live ingestion or listing-current guarantee.

Goose is the only public skill; six role files are internal procedures. server/dist/src/goose-orchestrator.js provides an executable injected runner adapter, not an installed model/host launcher. Five public-research roles are allowed; portfolio/accounts are excluded. Tasks/grants are frozen, cutoffs compared at exact fractional precision, and validation is schema-only. Native receipts can be host-attested but never independently verified by this library. Synthetic test receipts are not actual child execution. No actual host/model launch or complete actual-data financial report rendering occurred. A separate public SEC raw-source parser smoke succeeded without credentials; it establishes neither canonical metrics nor operating-rights clearance. Separate synthetic quote rendering is recorded in the packaged evidence. Report consumer is separate. See server/docs/rc22-plan-coverage.json for exact implemented, unresolved and unimplemented requirements.


RC22 retains the internal conditional financial bridge, not an MCP feed or configured production verifier. Ten evidence axes and fresh trusted-verifier injection are required; serialized booleans/hashes do not authorize actual promotion. Nine finite SEC direct-role compatibility policies and issuer-specific DART synthetic bindings are tested against the pinned report runtime. Original selected candidates remain noncanonical. Five finite SEC raw component expression plans are now implemented, but verified debt/capex derivation-to-fact promotion, common-equity component policy and production source verification remain incomplete. See the plugin-root file skills/goose/references/financial-bridge.md.


RC22 retains separate non-metric-ready component arithmetic candidates and a one-attempt secret-free quote smoke harness. Neither opens rights or loads/issues credentials. The smoke requires a separately trusted existing permission/entitlement callback and approved ephemeral transport; none is configured. Only synthetic seven-fact DTO/envelope/HTML comparison has passed. Read references/financial-components.md and references/quote-smoke.md.


RC22 retains an internal conditional US equity daily-history bridge, limited to an explicitly supplied single MODP 0 page with independently confirmed unadjusted context. Twelve evidence axes, complete explicit calendar and separate publication/availability/current-rights proof plus fresh trusted verification are required; none is configured for production. Original provider DTOs stay raw and canonical fields stay null. Synthetic reconstructed handoffs are checked against the unchanged report canonical-history/1.0 runtime. No actual source authentication or complete-history collection is established. Read references/daily-history-bridge.md.


RC22 retains only raw domestic orderbook intake and finite reconstructible raw field candidates. No firm/same-instant bid/ask, source date/timezone, previous-session reference, unit/currency, security/venue identity or current rights are inferred. Output2 indicative fields are never promoted; cardinality and complete field partition remain unverified. The one-shot quote harness is unchanged and still makes at most its single fixed quote request when separately authorized.


Current integration correction: the injected Goose execution adapter emits and validates references/roles/<role>/PROCEDURE.md. The executable release regression runs all five synthetic research roles and resolves every emitted reference from skills/goose to a bounded regular procedure file. This is offline adapter/path verification, not actual host/model execution. Historical execution receipts retain their frozen runtime and original paths; they are not silently rewritten or interpreted under this corrected runtime.


Current source-input integration adds KIS-072 domestic index history, KIS-264 global index history, KIS-113 market/industry investor aggregates, KIS-109 KIS-house estimates (not cross-broker consensus), and KIS-280 overseas ICE actions (not domestic KSD). KIS-072 and KIS-109 remain hard blocked before transport and receipt-clock calls even with synthetic injection. No canonical metrics, source authenticity, current rights, whole-range completeness, account/portfolio roles or production verifier are added. Market-behavior may request only the new 264/113 raw tools; disclosure-event may request only 280. Blocked 072/109 receive no role grants. See server/docs/source-input-mcp-integration.md.

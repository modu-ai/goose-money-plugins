---
name: fact-check-report-qa
description: "주장·수치·계산·출처·보고서 조건을 교차 점검하고 불확실성과 미검증 상태를 보존합니다. '팩트체크', '수치 검수', '리포트 QA' 요청에 사용하세요."
metadata:
  version: "0.1.0"
---

# Fact Check & Report QA

## Role

Goose final integration stage; do not create a second report writer by default. It can be invoked as a reusable skill or assigned to an extra reviewer only if request risk/volume justifies it and the host provides a real independent child.

## Workflow

1. Convert each material conclusion into `claim_id` and claim type: reported fact, arithmetic, estimate, assumption, or opinion.
2. Check source identity, authority, timestamp, document/form, period, currency, unit, methodology and source independence.
3. Recalculate growth, margins, totals, valuation and portfolio arithmetic from available inputs. For unavailable original values, label not verified.
4. Compare headline/summary/tables/HTML against the evidence bundle and original report contract when available.
5. Look for counterevidence, restatement, stale/partial fields, duplicated syndicated reports, mismatch of accounting basis, timezone, total denominator or FX.
6. Redact account/key/secret/token/person identifiers. Flag rights or regulatory blockers.
7. Use PASS/FAIL/NOT-VERIFIED by each assertion. If an independent reviewer did not run, do not call the result an independent audit.

## Output

A concise claim table: claim, source refs, recomputation, contradiction/counterevidence, status, limitation. Do not modify original report/ZIP or source data without a separate instruction.

## Synthetic test prompts

1. “이 가상 보고서의 YoY 매출 숫자를 확인해줘.” (zero denominator fixture) Assert no invalid percentage and status NOT-VERIFIED/edge-case.
2. “공시와 뉴스가 서로 다르니 하나만 맞다고 골라줘.” Assert preserve both source dates/periods and unresolved issue.
3. “이 계좌 HTML에 비밀이 들어 있는지 확인해줘.” (synthetic masked fixture) Assert report key/secret/account identifiers without echoing them.

## Sources

MoAI `data-provenance-audit` local skill guidance (no public URL), [CFA report essentials](https://www.cfainstitute.org/sites/default/files/-/media/documents/support/research-challenge/challenge/rc-equity-research-report-essentials.pdf), [Mirae Asset report rights notice](https://securities.miraeasset.com/bbs/board/message/list.do?categoryId=1521).


## RC22 authoritative capability boundary
Thirty-four registered read-only MCP names are listed in CAPABILITIES.json; resolve_instrument is a compatibility alias, not a distinct data feed. All default denied. No accounts, trading, orders, transfers, WebSockets or arbitrary endpoints. KIS115 actual transport is blocked before credentials because source request contracts conflict. KR daily retains raw fields in its internal parser while the registered v1 DTO exposes null canonical rows; US daily and KR current-day intraday preserve raw-only rows; canonical OHLCV remains null pending units/adjustment/time evidence. Historical-date KR stock minute intake is a separate fixed raw-only endpoint capped at 120 rows; mixed labels and duplicates are retained, and blank fake-tick flags do not prove exclusion. No resampling or automatic continuation. Four futures daily/minute first-page tools preserve signed raw prices and duplicate labels; overseas-minute continuation remains blocked by documented cursor-location conflict. Explicit SEC/DART financial selection is an offline internal library: immutable DTO snapshots, exact selector/filing joins, raw DART reparsing and full candidate reconstruction. It does not emit canonical financial facts or verify source authenticity. US product profile preserves raw fields but no confirmed identity/classification/units. ETF component access is blocked before transport by source-contract contradictions. Credit/lending map only documented share counts. Global quotes, including overseas futures, retain raw fields and null canonical projections pending listing/identity/units evidence. SEC preserves exact numeric JSON lexemes and explicit periods. Its finite raw catalog has 47 taxonomy-qualified concepts (26 US GAAP and 21 IFRS); primary taxonomy existence does not verify issuer applicability or bind a financial role. It does not supply a complete financial model. Static SEC/KIS master parsers produce unconfirmed directory candidates only; no live ingestion or listing-current guarantee.

Goose is the only public skill; six role files are internal procedures. server/dist/src/goose-orchestrator.js provides an executable injected runner adapter, not an installed model/host launcher. Five public-research roles are allowed; portfolio/accounts are excluded. Tasks/grants are frozen, cutoffs compared at exact fractional precision, and validation is schema-only. Native receipts can be host-attested but never independently verified by this library. Synthetic test receipts are not actual child execution. No actual host/model launch or complete actual-data financial report rendering occurred. A separate public SEC raw-source parser smoke succeeded without credentials; it establishes neither canonical metrics nor operating-rights clearance. Separate synthetic quote rendering is recorded in the packaged evidence. Report consumer is separate. See server/docs/rc22-plan-coverage.json for exact implemented, unresolved and unimplemented requirements.


RC22 retains the internal conditional financial bridge, not an MCP feed or configured production verifier. Ten evidence axes and fresh trusted-verifier injection are required; serialized booleans/hashes do not authorize actual promotion. Nine finite SEC direct-role compatibility policies and issuer-specific DART synthetic bindings are tested against the pinned report runtime. Original selected candidates remain noncanonical. Five finite SEC raw component expression plans are now implemented, but verified debt/capex derivation-to-fact promotion, common-equity component policy and production source verification remain incomplete. See the plugin-root file skills/goose/references/financial-bridge.md.


RC22 retains separate non-metric-ready component arithmetic candidates and a one-attempt secret-free quote smoke harness. Neither opens rights or loads/issues credentials. The smoke requires a separately trusted existing permission/entitlement callback and approved ephemeral transport; none is configured. Only synthetic seven-fact DTO/envelope/HTML comparison has passed. Read references/financial-components.md and references/quote-smoke.md.


RC22 retains an internal conditional US equity daily-history bridge, limited to an explicitly supplied single MODP 0 page with independently confirmed unadjusted context. Twelve evidence axes, complete explicit calendar and separate publication/availability/current-rights proof plus fresh trusted verification are required; none is configured for production. Original provider DTOs stay raw and canonical fields stay null. Synthetic reconstructed handoffs are checked against the unchanged report canonical-history/1.0 runtime. No actual source authentication or complete-history collection is established. Read references/daily-history-bridge.md.


RC22 retains only raw domestic orderbook intake and finite reconstructible raw field candidates. No firm/same-instant bid/ask, source date/timezone, previous-session reference, unit/currency, security/venue identity or current rights are inferred. Output2 indicative fields are never promoted; cardinality and complete field partition remain unverified. The one-shot quote harness is unchanged and still makes at most its single fixed quote request when separately authorized.


Current integration correction: the injected Goose execution adapter emits and validates references/roles/<role>/PROCEDURE.md. The executable release regression runs all five synthetic research roles and resolves every emitted reference from skills/goose to a bounded regular procedure file. This is offline adapter/path verification, not actual host/model execution. Historical execution receipts retain their frozen runtime and original paths; they are not silently rewritten or interpreted under this corrected runtime.


Current source-input integration adds default-denied KIS-072 domestic index history, KIS-264 global index history, KIS-113 market/industry investor aggregates, KIS-109 KIS-house estimates (not cross-broker consensus), and KIS-280 overseas ICE actions (not domestic KSD). KIS-072 and KIS-109 remain hard blocked before transport and receipt-clock calls even with synthetic injection. No canonical metrics, source authenticity, current rights, whole-range completeness, account/portfolio roles or production verifier are added. Market-behavior may request only the new 264/113 raw tools; disclosure-event may request only 280. Blocked 072/109 receive no role grants. See server/docs/source-input-mcp-integration.md.

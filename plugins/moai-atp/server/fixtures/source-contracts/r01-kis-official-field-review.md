# R01 KIS portal response-field review

Reviewed 2026-10-21. Provider schema evidence is in [`r01-kis-official-response-schemas-v1.json`](../contracts/r01-kis-official-response-schemas-v1.json). The ten official KIS portal schemas were checked against the pinned official sample commit `2077773a69a428daf63e148182511f068cc45de3`. No KIS request, credential access, account lookup, order or transfer was performed.

| Operation | Portal response fields most relevant to R01 | Key unresolved items |
|---|---|---|
| [KIS-039](https://apiportal.koreainvestment.com/apiservice-apiservice?/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice) | `stck_bsop_date`, `stck_clpr`, `acml_vol`, `prtt_rate`, `flng_cls_code` | Price and trade-amount currency/scale and volume unit are not stated in this response schema; do not default to KRW/shares.; Provider response has no intraday source timestamp or timezone; retain date as LocalDate and runtime received_at separately. |
| [KIS-254](https://apiportal.koreainvestment.com/apiservice-apiservice?/uapi/overseas-price/v1/quotations/dailyprice) | `xymd`, `clos`, `tvol`, `tamt`, `zdiv`, `nrec` | Price currency is not a response field; resolve from verified exchange/instrument metadata. zdiv is a decimal scale, not currency.; Volume and traded-amount units are not stated in this response schema. |
| [KIS-303](https://apiportal.koreainvestment.com/apiservice-apiservice?/uapi/overseas-futureoption/v1/quotations/daily-ccnl) | `data_date`, `data_time`, `last_price`, `vol`, `index_key` | Portal says price scaling depends on overseas futures product master field ffcode.mst.sCalcDesz (examples 6A -4, GC -1). Do not parse price as ordinary decimal before that binding.; Currency, multiplier, contract month, session/timezone and volume unit require instrument/contract master mapping; CME/SGX access may require paid quote entitlement. |
| [KIS-212](https://apiportal.koreainvestment.com/apiservice-apiservice?/uapi/domestic-futureoption/v1/quotations/inquire-daily-fuopchartprice) | `stck_bsop_date`, `futs_prpr`, `futs_oprc/hgpr/lwpr`, `acml_vol` | No explicit currency, contract multiplier, tick size/value, expiry, settlement or roll policy in this endpoint response; contract master required.; Price and volume units are not stated by this endpoint schema. |
| [KIS-072](https://apiportal.koreainvestment.com/apiservice-apiservice?/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice) | `stck_bsop_date`, `bstp_nmix_prpr`, `acml_vol` | Index/sector values are not equity closes; keep distinct from stock-price fields.; Portal lengths 82/112 are unusually large; preserve exact documented limits and request correction rather than silently narrowing. |
| [KIS-264](https://apiportal.koreainvestment.com/apiservice-apiservice?/uapi/overseas-price/v1/quotations/inquire-daily-chartprice) | `stck_bsop_date`, `ovrs_nmix_prpr`, `acml_vol` | Category-specific currency and index/FX/bond/gold units are not explicit in these response fields; resolve by FID_COND_MRKT_DIV_CODE and instrument metadata.; Numeric 11.4 is formatting precision, not an index unit or currency. Date is date-only; no timezone. |
| [KIS-115](https://apiportal.koreainvestment.com/apiservice-apiservice?/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily) | `stck_bsop_date`, investor `*_ntby_tr_pbmn`, `*_ntby_qty` | Portal requires FID_ETC_CLS_CODE=1 but pinned sample sends blank; no request was sent.; Investor categories in this operation are stock-specific; do not merge with KIS-113 market/industry aggregates. |
| [KIS-113](https://apiportal.koreainvestment.com/apiservice-apiservice?/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market) | `stck_bsop_date`, market investor `*_ntby_tr_pbmn`, `*_ntby_qty` | Portal does not state currency/scale for *_ntby_tr_pbmn and does not state quantity unit for this endpoint. Do not borrow KIS-115 units.; This is market/industry scope, not a stock-specific investor flow endpoint. |
| [KIS-109](https://apiportal.koreainvestment.com/apiservice-apiservice?/uapi/domestic-stock/v1/quotations/estimate-perform) | `output2/3[*].data1…data5`, `output4[*].dt` | Do not map KIS-house estimates to cross-broker consensus. Consensus permission remains separate and unresolved.; Portal output1 has apparent ELW labels inconsistent with endpoint; do not use output1 as estimate field source. |
| [KIS-280](https://apiportal.koreainvestment.com/apiservice-apiservice?/uapi/overseas-price/v1/quotations/rights-by-ice) | `ca_title`, `effective_dt`, `div_lock_dt`, `pay_dt` | This source only covers overseas markets A4/A5. It does not supply Korean KSD action events.; Event type taxonomy is incomplete; preserve ca_title verbatim until a codebook is available. |

## Status reconciliation

- The 147-row registry is the supplier/data-contract registry. Only provider bindings for fields with portal evidence were added; registry field status labels were preserved.
- The R01 chart consumer contract remains **48 fields: 39 `verification_pending`, 9 `derived`**. Provider raw-key evidence does not by itself satisfy canonical type/unit/currency/time/scope/rights or actual response requirements.
- The previously verified OpenDART `rcept_dt`, `rcept_no`, and `report_nm` keys are a separate filing-list evidence slice. They do not count as KIS mappings and did not promote any of the 48 consumer statuses.
- Pagination conflicts (portal vs sample) and request conflicts are blockers for affected adapters; no synthetic or guessed value is substituted.

## Pinned official sample code

[KIS Open Trading API `examples_llm` at 2077773a69a428daf63e148182511f068cc45de3](https://github.com/koreainvestment/open-trading-api/tree/2077773a69a428daf63e148182511f068cc45de3/examples_llm). Each operation row in the JSON evidence also links its exact Python sample path.

## Structural validation

- The KIS mapping and 147-field supplier registry both pass their current JSON Schema documents using the bundled MCP SDK Ajv validator. The runtime/evidence JSON parse and cross-file counts/hashes also pass. This does not validate a live KIS response.

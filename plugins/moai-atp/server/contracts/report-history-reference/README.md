# Canonical history semantics RC5

Offline, additive deterministic chart math. **No provider adapter, source authentication, network calls, credentials, publication, or verified live provider bindings.** The frozen original design, `vm-semantics` and `vm-flow-semantics-rc4` are not modified.

## Scope and truth boundary

Original plan R01.S01 requires a **line-only** `price_relative` panel plus a separate quantity-volume panel. The exact source pointer, original guards, formulas and implementation are in `requirements-crosswalk.json`. SMA, named OHLCV and explicit daily-to-week/month aggregation are additional capabilities, not additional completed plan sections. This does not claim all84 sections.

Every example is invented and labeled **SYNTHETIC TEST ONLY**. Its declared weekday calendar is **not an exchange calendar**. The engine validates supplied contract assertions; `verified: true` does not establish external truth. `actual_source_authenticated` stays false and `verified_live_provider_bindings` stays zero even for supplied canonical inputs labeled actual. Provider RC5 histories remain RAW ONLY. There is no provider field-name adapter or promotion function in this package.

## Run

Python 3.12 standard library is sufficient for the engine and unit tests. Optional JSON Schema validation in `validate.py` uses the installed jsonschema package and reports absence explicitly.

    PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s tests -v
    PYTHONDONTWRITEBYTECODE=1 python build_schema.py
    PYTHONDONTWRITEBYTECODE=1 python build_evidence.py
    PYTHONDONTWRITEBYTECODE=1 python probe_malformed.py
    PYTHONDONTWRITEBYTECODE=1 python validate.py
    PYTHONDONTWRITEBYTECODE=1 python history_semantics.py examples/SYNTHETIC-input.json --output /tmp/history-result.json

Import `history_semantics.calculate_report(payload)` from this directory. `numeric_core.py` reuses selected frozen validation/time/numeric functions verbatim, rather than importing modules with ambient Decimal side effects. Source hashes and exact function names are in `source-manifest.json`.

## Strict canonical input

`canonical-history.schema.json` is a closed-object JSON Schema; runtime enforces the cross-field and temporal invariants beyond shape validation. JSON duplicate keys, NaN and Infinity are rejected by CLI loading. Money and quantities must be bounded finite decimal **strings**, never JSON floats or exponent notation. Optional benchmark is independently validated. Explicit request start/end and offset-aware report cutoff are mandatory.

- Identity: instrument, issuer, venue, asset class, share class, and a single explicit contract identity for futures. No continuous-futures roll inference.
- Units: price dimension, currency (also explicit for a benchmark), quantity unit and exact power-of-ten scales. Shares, contracts, index levels, quoted prices and traded money are not interchangeable.
- Session/calendar: explicit IANA timezone, daily trade-date semantics, session ID, verified calendar reference, covered interval and ordered unique expected sessions. Missing expected rows become null gaps. Weekdays are never inferred by the engine. Calendar facts are supplied assertions, not independently authenticated here.
- Dates vs instants: the plotted x key is always the explicit trade date. Date-only observations carry `observed_at: null`; session-close, publication, receipt and availability are separate timezone-aware instants. This version supports close-local-date trade-date conventions only, not arbitrary overnight mappings.
- Basis: ordinary price vs total-return index, return policy, adjustment identity/vintage, action-coverage evidence, volume-adjustment policy, final-as-of revision and negative-price permission. No raw or adjusted series is silently reconstructed.
- Each point binds the exact identity/unit/calendar/adjustment context by SHA-256. It has a unique fact ID, raw locator, document/revision hash, selector, verification evidence, revision lineage and allowed local-report rights. One source/selector per history; conflicting document hashes are rejected across a series and across comparisons.
- Each OHLCV cell distinguishes available decimal from unavailable null plus a required reason. Invalid cell values fail only the dependent component; an invalid OHLC relation does not erase an independently valid close. A failed point envelope nulls that point's components. Ambiguous date keys, duplicate fact IDs or conflicting source documents fail the affected history.

A supplied final point must satisfy `session_close <= published <= received <= available <= cutoff`. An adjusted point must also be available no earlier than its declared adjustment vintage. Comparisons retain arbitrary fractional-second precision. Future/invalid point envelopes are absent from accepted result lineage, not simply hidden by a plot. The raw input sidecar remains the audit input.

## Implemented math

### Price rebasing

For compatible subject and benchmark, choose their **same first common valid date within the requested range** and compute exact `100 × close_t / baseline_close`. Both baselines equal 100. Require two valid subject closes and two common dates for a benchmark comparison. Earlier requested dates remain null `before_common_baseline`; intervening gaps remain null. No interpolation or forward filling.

If the benchmark is missing, malformed, incompatible or insufficient, only its branch is unavailable. The subject uses its own first valid requested date with an explicit comparison-unavailable notice. No ranking or outperformance conclusion is emitted. Nonpositive prices anywhere in the valid requested series block rebasing, even though valid negative futures prices can remain valid OHLC/SMA data.

### SMA

Window sizes are explicitly supplied unique integer session counts (1–500). Compute the arithmetic average of the last N **contiguous expected-session** closes including the current session. Full warmup is required; supplied prior-session history may warm up the requested range. A single missing close invalidates every window that contains it. No skipping missing sessions, centering, annualization or future data. **Daily SMA only. Weekly/monthly SMA is unsupported.**

### OHLCV and independent close

Validate `low <= min(open, close) <= max(open, close) <= high`. Negative prices are allowed only for explicitly permitted single-contract futures. Volume is nonnegative integral shares/contracts. Named OHLC fields avoid ambiguous candle-array ordering. `close_only` remains independently usable when other OHLC fields are missing or inconsistent; no renderer may reverse a rebase or recover numbers from rejected raw lineage.

### Volume direction

The original neutral quantity-volume convention is the default fixture. Alternative coloring requires an explicit `close_vs_open` or `close_vs_previous_session` rule, evidence reference and disclosure. Backend-produced red `#D71920` means **price up**, blue `#3E6AE1` **price down**, neutral means flat/unavailable. The reference value/date and fact IDs accompany each record. The previous-session rule does not skip a missing expected session. This never means volume increased/decreased, buying pressure, bullishness or performance. Such price-direction coloring is an explicitly labeled extension to, not a reinterpretation of, the original signed-volume-change guard.

### Daily-to-week/month

No resample API or guessed holidays. Each requested window declares exact full ISO Monday–Sunday or Gregorian month boundaries, calendar identity/evidence, complete coverage and all expected trade dates. The whole calendar period must have ended at cutoff. Every expected daily OHLCV must be valid; units/session/basis remain one bound context. Compute first open, maximum high, minimum low, last close, exact volume sum.

Windows are sorted by frequency then chronological start. Duplicate IDs and **all** overlapping same-frequency windows are rejected, including identical intervals with different IDs. Structurally valid rejected windows stay as typed null period records, so missing middle weeks/months cannot disappear. Malformed unplaceable windows remain in `rejected_windows` with `period: null`. `contiguous_with_previous` and `gap_before` expose missing requested periods. Consumers must split a plotted line at `gap_before`; `connectNulls: false` alone does not protect an omitted period. Different frequencies must remain separate series.

## Output and renderer contract

`results` contains independent `price_relative`, `sma`, `ohlcv`, `volume`, and `aggregation` branches. A branch is computed, unavailable or blocked, with explicit reasons, nulls, cutoff basis, source IDs and accepted fact lineage. There are no investment interpretations or trading conclusions. Valid branches remain usable when unrelated options fail.

Numeric records contain `x_value`, `x_kind`, `series_id`, `y_value` (decimal string or null), `exact_fraction`, `decimal_policy`, `source_fact_result_ids`, `missing_reason` and synthetic/actual classification. OHLCV adds named `ohlc` components, `close_only`, `close_only_missing_reason`, and `volume`; each component is a numeric object with `value`, `exact_fraction` and `decimal_policy`. Aggregation adds explicit `period` and first/last actual trade dates. Display coordinates may approximate these decimals, but exact table/tooltips must retain them and disclose approximation. No browser/JS financial calculation is authorized by this interface.

Arithmetic uses `Fraction` from strict decimal input and a private Decimal context. Terminating decimals are rendered exactly; recurring decimals use 50 significant digits with half-even rounding and retain the exact numerator/denominator. The result ID includes context, exact cutoff, accepted lineage and outputs, so a cutoff change changes provenance even when values are unchanged. Ambient Decimal precision/traps do not alter output.

## Evidence and residuals

- `test-results.txt`: focused standard-library tests.
- `robustness-probes.json`: bounded structural/type perturbation results, not a formal proof.
- `validation.json`: unit tests, schema checks, source hashes and synthetic boundary checks.
- `independent-review-status.json`: separate reviewer findings, repaired calendar-end boundary, independent metamorphic/temporal checks and reviewed code hashes.
- `examples/`: complete invented, gapped invented, and unavailable inputs/results.
- `residual-unsupported.json`: remaining live-data, source-authentication and capability blockers.

No browser was attempted in this work. Static/SSR/browser visual verification belongs to the separate renderer work. An external review is separate from this package's self-checks.

# Reported financial fact reference export

This is an additive reference export of the existing corrected RC5 financial
runtime, not a new provider contract or an automatic raw-to-canonical bridge.
It introduces no new reported roles and changes no frozen source.

- `reported-fact.schema.json`: a closed-object structural subset for an
  **available** reported fact. It is not a schema for unavailable placeholders,
  quote facts, exposure facts, the report envelope, or provider raw evidence.
- `reported-roles.json`: the exact 13 existing reported roles, units, attribution
  and definitions, generated from the pinned runtime constants.
- `reference/semantics.py`: unchanged RC5 runtime, version
  `r01-semantics/1.0.1-exact-time`, SHA-256
  `02f307a1f159efc80a64542dd324b6c5fcc33a7169655328a65ff8d6b25aa180`.
- `SYNTHETIC-reported-facts.json`: 13 invented examples. No actual source data.

Schema success does **not** establish source authenticity, accounting meaning,
issuer identity, rights, publication availability, revision completeness or
metric readiness. `data_kind: actual` and `semantic_binding_verified: true` are
input assertions, not independent verification. A fabricated but self-consistent
fact can pass the engine. This package authenticates no source and has zero live
bindings. A bridge must keep actual promotion blocked without a separately
trusted verification route. Candidate hashes establish consistency, not truth.

## Runtime remains mandatory

Before using `validate_fact`, take a bounded plain JSON snapshot with the pinned
`plain_json_snapshot`, parse the cutoff using its exact `parse_time`, and validate
the requested concept against the fact. `validate_fact` is an internal helper,
not an input-loading or source-verification API. `calculate_metric` and
`calculate_report` already snapshot their public inputs and enforce additional
cross-fact and metric-context invariants.

JSON Schema deliberately does not replace these runtime checks:

1. Gregorian dates, IANA timezone and local date representability.
2. Exact publication <= availability <= cutoff, preserving sub-microsecond
   fractions; publication cannot precede the period end in the declared zone.
3. Positive power-of-ten scale from 1e-12 to 1e12, exact normalization, applicable
   nonnegative stock/share/capex guards, explicit lease/acquisition definitions.
4. Same source/input data kind, correct period ordering and final coverage.
5. Same issuer, security, population, currency, basis, period, revision, share
   class and other requirements of the particular metric, not just one fact.
6. Supported metric period types and additional context. For example, generic
   fact validation alone does not establish that an instant revenue observation
   is an eligible duration input for an operating-margin metric.

The export is intentionally stricter than the runtime's extension tolerance:
unknown object keys are rejected. It does not claim exact equivalence to every
object the runtime accepts. Numeric and timestamp fields remain strings; no
binary64 conversion is involved in their meaning. Unavailable data should stay
unavailable upstream, not be filled with invented required fields to satisfy
this available-fact schema.

## Source mapping cautions

Do not equate a similar SEC or OpenDART tag name with a role. Parent-attributable
net income, total net income including non-controlling interests and common
shareholder earnings are not automatically identical. Likewise, common equity
and total equity are distinct. Weighted basic shares are not year-end listed
shares; cash capex is not all investing cash flow. Accounting scope, units,
scale, attribution, reporting period and evidence-backed semantic selection must
all be resolved independently. This export performs no such mapping.

## Reproduce

With the already installed Python 3.12 and jsonschema 4.26.0:

    python build_export.py
    PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s tests -v

No installation, credentials, network call, external publication or browser
operation is performed. The bundled runtime's general CLI is reference source,
not a new confined production writer; integrations must use their own reviewed
input/output boundaries. This package has no chart or browser-visual claims.

"""Deterministic, provider-independent R01 semantics. No network or credentials.

This validates a normalized evidence contract, not the truth of an upstream source.
Decimal inputs are preserved; exact rational results accompany rounded decimals.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from copy import deepcopy
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, Context, localcontext, ROUND_HALF_EVEN, InvalidOperation, DivisionByZero, Overflow
from fractions import Fraction
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

VERSION = "r01-semantics/1.0.1-exact-time"
DECIMAL_RE = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\Z")
SHA_RE = re.compile(r"[a-f0-9]{64}\Z")


def decimal_context(precision):
    """Never inherit process-global precision, traps, clamp or exponent bounds."""
    return Context(prec=precision, rounding=ROUND_HALF_EVEN, Emin=-999999,
                   Emax=999999, capitals=1, clamp=0, flags=[],
                   traps=[InvalidOperation, DivisionByZero, Overflow])

# Input concepts are deliberately not provider field names. Extensions are mapped
# explicitly in requirements.json; no DART account selector is inferred from labels.
SPECS = {
    "metric.operating_margin": (["reported.operating_profit", "reported.revenue"], "operating_profit / revenue * 100", "percent", "duration"),
    "metric.net_margin": (["reported.net_income_total", "reported.revenue"], "total net income / revenue * 100", "percent", "duration"),
    "metric.fcf": (["reported.cfo", "reported.capex"], "CFO - positive cash capex", "money", "duration"),
    "metric.cash_conversion": (["reported.cfo", "reported.net_income_total"], "CFO / positive total net income * 100", "percent", "duration"),
    "metric.debt": (["reported.debt"], "interest-bearing debt", "money", "instant"),
    "metric.net_debt": (["reported.debt", "reported.cash"], "interest-bearing debt - cash and cash equivalents", "money", "instant"),
    "metric.debt_to_equity": (["reported.debt", "reported.equity"], "interest-bearing debt / total equity * 100", "percent", "instant"),
    "metric.liabilities_to_equity": (["reported.liabilities", "reported.equity"], "total liabilities / total equity * 100", "percent", "instant"),
    "metric.net_debt_to_equity": (["reported.debt", "reported.cash", "reported.equity"], "(interest-bearing debt - cash and cash equivalents) / total equity * 100", "percent", "instant"),
    "metric.roe": (["reported.net_income_common", "reported.equity_common_open", "reported.equity_common_close"], "common net income / ((opening common equity + closing common equity) / 2) * 100", "percent", "roe"),
    "metric.eps": (["reported.net_income_common", "reported.shares_weighted"], "common net income / weighted average common shares", "money_per_share", "duration"),
    "metric.per": (["quote.last", "reported.net_income_common", "reported.shares_weighted"], "price / (common net income / weighted average common shares)", "multiple", "per"),
    "metric.short_volume_ratio": (["exposure.short_volume", "exposure.total_volume"], "short traded shares / total traded shares * 100", "percent", "daily"),
    "metric.short_balance_ratio": (["exposure.short_balance_shares", "exposure.listed_shares"], "short balance shares / listed shares * 100", "percent", "instant"),
    "metric.credit_balance_ratio": (["exposure.credit_balance_shares", "exposure.listed_shares"], "credit financing balance shares / listed shares * 100", "percent", "instant"),
    "metric.lending_change": (["exposure.lending_balance_open", "exposure.lending_balance_close"], "closing lending stock shares - opening lending stock shares", "shares", "endpoints"),
    "metric.lending_change_pct": (["exposure.lending_balance_open", "exposure.lending_balance_close"], "(closing lending stock shares - opening lending stock shares) / opening lending stock shares * 100", "percent", "endpoints"),
}

DEFINITIONS = {
    "reported.revenue": ("money", "total", "revenue"),
    "reported.operating_profit": ("money", "total", "operating_profit"),
    "reported.net_income_total": ("money", "total", "net_income_total"),
    "reported.net_income_common": ("money", "common", "net_income_attributable_to_common"),
    "reported.cfo": ("money", "total", "net_cash_from_operating_activities"),
    "reported.capex": ("money", "total", "cash_purchase_ppe_and_intangibles"),
    "reported.debt": ("money", "total", "interest_bearing_debt"),
    "reported.cash": ("money", "total", "cash_and_cash_equivalents"),
    "reported.equity": ("money", "total", "total_equity"),
    "reported.liabilities": ("money", "total", "total_liabilities"),
    "reported.equity_common_open": ("money", "common", "equity_attributable_to_common"),
    "reported.equity_common_close": ("money", "common", "equity_attributable_to_common"),
    "reported.shares_weighted": ("shares", "common", "weighted_average_basic_common_shares"),
    "quote.last": ("money_per_share", "common", "official_close"),
    "exposure.short_volume": ("shares", "common", "short_sale_traded_share_volume"),
    "exposure.total_volume": ("shares", "common", "total_traded_share_volume"),
    "exposure.short_balance_shares": ("shares", "common", "outstanding_short_position_shares"),
    "exposure.listed_shares": ("shares", "common", "listed_common_shares"),
    "exposure.credit_balance_shares": ("shares", "common", "credit_financing_outstanding_shares"),
    "exposure.lending_balance_open": ("shares", "common", "outstanding_securities_lending_shares"),
    "exposure.lending_balance_close": ("shares", "common", "outstanding_securities_lending_shares"),
}

LIMITATIONS = {
    "financial": [
        "One-period accounting ratios do not establish persistence or valuation attractiveness.",
        "Industry comparisons, accounting quality, one-off items and future outcomes are not established by these inputs.",
    ],
    "exposure": [
        "Trading volume is a period flow; short, credit and lending balances are point-in-time stocks and are not interchangeable.",
        "Lending may support hedging or settlement and is not proof of a short sale, bearish intent or future price direction.",
        "Price reaction, investor intent, collateral terms and causal explanations are not established by these inputs.",
        "Balance shares divided by listed shares is not assumed to be a disjoint subset; values above 100% require coverage review, not automatic capping.",
    ],
}


class GateError(Exception):
    def __init__(self, code, detail, status="blocked"):
        super().__init__(detail)
        self.code, self.detail, self.status = code, detail, status


def require(ok, code, detail):
    if not ok:
        raise GateError(code, detail)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def parse_decimal(value, label):
    require(isinstance(value, str) and len(value) <= 256 and DECIMAL_RE.fullmatch(value), "invalid_decimal", f"{label} requires a finite decimal string of at most 256 characters, not a float, exponent or missing value.")
    return Decimal(value)


def parse_day(value, label):
    try:
        require(isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value), "invalid_date", f"{label} must preserve ISO date precision.")
        return date.fromisoformat(value)
    except ValueError:
        raise GateError("invalid_date", f"{label} is not a valid date.")


@dataclass(frozen=True)
class ExactElapsed:
    seconds: Fraction
    def total_seconds(self):
        return self.seconds

@dataclass(frozen=True, order=True)
class ExactInstant:
    whole_utc: datetime
    fraction: Fraction
    def astimezone(self, zone):
        """Calendar projection only: a fractional second cannot change this date."""
        try:
            return self.whole_utc.astimezone(zone)
        except (OverflowError, ValueError):
            raise GateError("calendar_overflow", "Timestamp timezone conversion exceeds the representable calendar.")
    def __sub__(self, other):
        if not isinstance(other, ExactInstant): return NotImplemented
        delta = self.whole_utc - other.whole_utc
        return ExactElapsed(Fraction(delta.days * 86400 + delta.seconds) + self.fraction - other.fraction)

def parse_time(value, label):
    require(isinstance(value, str) and len(value) <= 2048 and "T" in value, "ambiguous_time", f"{label} requires bounded timezone-aware seconds, not a date.")
    require(re.search(r"(?:Z|[+-][0-9]{2}:[0-9]{2})$", value), "ambiguous_time", f"{label} requires a timezone offset.")
    match = re.fullmatch(r"([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]+))?(Z|[+-][0-9]{2}:[0-9]{2})", value)
    require(match is not None, "invalid_time", f"{label} requires ISO seconds with an explicit offset.")
    day, clock, digits, offset = match.groups()
    require(offset == "Z" or (int(offset[1:3]) <= 23 and int(offset[4:]) <= 59), "invalid_time", label)
    try:
        whole = datetime.fromisoformat(day + "T" + clock + ("+00:00" if offset == "Z" else offset)).astimezone(timezone.utc)
    except (OverflowError, ValueError):
        raise GateError("invalid_time", f"{label} is not a representable timestamp.")
    fraction = Fraction(int(digits), 10 ** len(digits)) if digits else Fraction(0)
    return ExactInstant(whole, fraction)


def text_fields(mapping, keys, label):
    require(isinstance(mapping, dict), "missing_metadata", f"{label} is required.")
    for key in keys:
        require(isinstance(mapping.get(key), str) and bool(mapping[key].strip()), "missing_metadata", f"{label}.{key} is required.")


def validate_fact(concept, fact, cutoff):
    require(isinstance(fact, dict), "malformed_fact", f"{concept} must be a fact object.")
    text_fields(fact, ["fact_id", "concept", "data_kind", "issuer_id", "security_id", "share_class", "venue", "population", "unit", "scale", "currency", "date_timezone"], concept)
    try:
        zone = ZoneInfo(fact["date_timezone"])
    except (ValueError, ZoneInfoNotFoundError):
        raise GateError("unknown_timezone", f"{concept} requires a verified IANA date timezone.")
    require(fact["concept"] == concept, "concept_mismatch", f"The input role {concept} cannot be substituted by {fact['concept']}.")
    require(fact.get("state") == "available", "invalid_state", f"{concept} is not explicitly available.")
    require(fact["data_kind"] in ("synthetic", "actual"), "invalid_data_kind", concept)
    unit, attribution, definition = DEFINITIONS[concept]
    require(fact["unit"] == unit, "unit_mismatch", f"{concept} requires {unit}, not {fact['unit']}.")
    if unit == "shares":
        require(fact["currency"] == "not_applicable", "currency_mismatch", f"{concept} is a share quantity, not a monetary balance.")
    else:
        require(re.fullmatch(r"[A-Z]{3}", fact["currency"]), "unknown_currency", f"{concept} needs an explicit currency code.")
    scale = parse_decimal(fact["scale"], f"{concept}.scale")
    # normalize() in the ambient context could round a near-one scale to one.
    with localcontext(decimal_context(540)):
        scale_tuple = scale.normalize().as_tuple()
    require(scale > 0 and scale_tuple.digits == (1,) and -12 <= scale_tuple.exponent <= 12, "invalid_scale", "Scale must be an explicit power of ten from 1e-12 to 1e12.")
    value = parse_decimal(fact.get("value"), f"{concept}.value")
    with localcontext(decimal_context(540)):
        normalized = value * scale
    basis = fact.get("basis")
    text_fields(basis, ["scope", "standard", "revision_basis", "split_basis", "attribution", "definition", "methodology_id"], f"{concept}.basis")
    require(basis["scope"] in ("consolidated", "standalone", "security"), "unknown_basis", f"{concept} scope is not resolved.")
    require(basis["attribution"] == attribution and basis["definition"] == definition, "semantic_basis_mismatch", f"{concept} requires {attribution}/{definition}.")
    if concept.startswith("reported."):
        require(basis["scope"] in ("consolidated", "standalone") and basis["standard"] in ("IFRS", "K-IFRS", "US-GAAP", "K-GAAP"), "unknown_basis", f"{concept} needs a supported financial statement scope and accounting standard.")
    else:
        require(basis["scope"] == "security", "unknown_basis", f"{concept} must be security-scoped.")
    period = fact.get("period")
    text_fields(period, ["kind", "start", "end", "label"], f"{concept}.period")
    require(period["kind"] in ("FY", "TTM", "quarter", "YTD", "instant", "daily"), "unknown_period", concept)
    start, end = parse_day(period["start"], concept), parse_day(period["end"], concept)
    require(start <= end, "period_order", concept)
    if period["kind"] in ("instant", "daily"):
        require(start == end, "period_mismatch", f"{concept} instant/daily requires one date.")
    else:
        require(start < end, "period_mismatch", f"{concept} duration requires distinct endpoints.")
    require(end <= cutoff.astimezone(zone).date(), "forward_looking_observation", f"{concept} period ends after the report cutoff.")
    available = parse_time(fact.get("available_at"), f"{concept}.available_at")
    published = parse_time(fact.get("published_at"), f"{concept}.published_at")
    require(published <= available <= cutoff, "future_or_reversed_availability", f"{concept} must have published_at <= available_at <= cutoff.")
    require(end <= published.astimezone(zone).date(), "publication_before_observation", f"{concept} is labelled reported but published before its period ended.")
    require(fact.get("finality") == "final", "unconfirmed_finality", "Preliminary/forecast facts are not substituted for final reported facts.")
    source = fact.get("provenance")
    text_fields(source, ["source_id", "document_id", "locator", "revision_id", "source_sha256", "selector_id"], f"{concept}.provenance")
    require(SHA_RE.fullmatch(source["source_sha256"]), "invalid_source_digest", concept)
    require(source.get("semantic_binding_verified") is True, "unverified_semantic_binding", f"The selector and normalized semantics for {concept} are not verified.")
    require(source.get("data_kind") == fact["data_kind"], "source_kind_mismatch", concept)
    require(fact.get("coverage_complete") is True, "incomplete_coverage", f"{concept} has missing components, dates or pages.")
    if concept == "reported.capex":
        require(basis.get("cash_sign") == "positive_outflow", "capex_sign_unverified", "Capex must explicitly be a positive cash outflow, not signed investing cash flow.")
        for key in ("lease_cash_payments", "acquisition_cash_payments"):
            require(basis.get(key) in ("included", "excluded"), "capex_coverage_unverified", f"Capex {key} coverage must be explicit.")
        require(normalized >= 0, "negative_capex", "A negative signed capex value cannot silently be negated.")
    if concept in ("reported.debt", "reported.cash", "reported.liabilities") or concept.startswith("exposure.") or unit == "shares":
        require(normalized >= 0, "negative_stock_or_volume", f"{concept} must not be negative.")
    if concept == "reported.debt":
        require(basis.get("lease_liabilities") in ("included", "excluded"), "debt_coverage_unverified", "Interest-bearing debt must state lease-liability coverage.")
    return normalized


def equal(facts, keys, where=None):
    for key in keys:
        vals = [(f[where][key] if where else f[key]) for f in facts]
        require(all(v == vals[0] for v in vals), f"{key}_mismatch", f"Inputs disagree on {where + '.' if where else ''}{key}; no implicit conversion or alignment.")


def same_period(facts, kind):
    equal(facts, ["kind", "start", "end"], "period")
    accepted = {"duration": {"FY", "TTM", "quarter", "YTD"}, "instant": {"instant"}, "daily": {"daily"}}[kind]
    require(facts[0]["period"]["kind"] in accepted, "period_kind_mismatch", f"This formula requires {kind} inputs.")


def positive(value, role):
    require(value > 0, "nonpositive_denominator", f"{role} must be positive; zero/negative denominators are not meaningful under this policy.")


def computation(metric, facts, values, context, cutoff):
    ordered = [facts[k] for k in SPECS[metric][0]]
    equal(ordered, ["data_kind", "issuer_id", "security_id", "share_class", "venue", "population", "date_timezone"])
    equal(ordered, ["split_basis", "revision_basis"], "basis")
    financial = [f for f in ordered if f["concept"].startswith("reported.")]
    if financial:
        equal(financial, ["scope", "standard", "methodology_id"], "basis")
    monetary = [f for f in ordered if f["unit"] != "shares"]
    if monetary:
        equal(monetary, ["currency"])
    mode = SPECS[metric][3]
    if mode in ("duration", "instant", "daily"):
        same_period(ordered, mode)
    elif mode == "roe":
        income, opening, closing = ordered
        same_period([income], "duration")
        same_period([opening], "instant")
        same_period([closing], "instant")
        start = parse_day(income["period"]["start"], "income start")
        require(start > date.min, "calendar_overflow", "ROE opening equity date precedes the representable calendar.")
        expected_open = (start - timedelta(days=1)).isoformat()
        require(opening["period"]["end"] == expected_open and closing["period"]["end"] == income["period"]["end"], "equity_endpoint_mismatch", "ROE needs common equity immediately before the income period and at its end.")
    elif mode == "per":
        price, income, shares = ordered
        same_period([price], "instant")
        same_period([income, shares], "duration")
        require(context.get("earnings_basis") in ("trailing_FY", "TTM"), "pe_basis_required", "PER needs explicit trailing_FY or TTM basis; forecast/quarter annualization is unsupported.")
        require(income["period"]["kind"] == {"trailing_FY": "FY", "TTM": "TTM"}[context["earnings_basis"]], "pe_earnings_period_mismatch", "PER earnings basis must match the supplied financial duration.")
        days = (parse_day(income["period"]["end"], "income end") - parse_day(income["period"]["start"], "income start")).days + 1
        require(350 <= days <= 380, "pe_not_annual_period", "Annual PER requires a declared full-year/TTM duration, not a partial period.")
        price_at = parse_time(price.get("observed_at"), "quote.last.observed_at")
        local_price_day = price_at.astimezone(ZoneInfo(price["date_timezone"])).date()
        require(local_price_day.isoformat() == price["period"]["end"], "price_date_mismatch", "The price date and observation instant must agree in the declared date timezone.")
        require(price_at <= parse_time(price["published_at"], "price publication") <= cutoff, "price_time_order", "Price observation must precede its publication and the cutoff.")
        require(all(parse_time(f["available_at"], "earnings availability") <= price_at for f in (income, shares)), "forward_looking_earnings", "PER cannot use financial information unavailable at the price observation.")
        for key in ("max_price_age_days", "max_earnings_age_days"):
            require(type(context.get(key)) is int and 0 <= context[key] <= 730, "freshness_policy_required", f"{key} must be an explicit integer from 0 to 730.")
        require((cutoff - price_at).total_seconds() <= context["max_price_age_days"] * 86400, "stale_price", "Price exceeds the explicitly selected age limit.")
        require(0 <= (local_price_day - parse_day(income["period"]["end"], "earnings end")).days <= context["max_earnings_age_days"], "stale_earnings", "Earnings period exceeds the explicitly selected age limit.")
    elif mode == "endpoints":
        opening, closing = ordered
        same_period([opening], "instant")
        same_period([closing], "instant")
        require(opening["period"]["end"] < closing["period"]["end"], "endpoint_order", "Lending stock change requires strictly increasing dates.")
        require(context.get("start_date") == opening["period"]["end"] and context.get("end_date") == closing["period"]["end"], "requested_endpoint_mismatch", "Requested lending endpoints must both be present; no nearest-date or forward-fill substitution.")
    if metric.startswith("metric.short_") or metric.startswith("metric.credit_") or metric.startswith("metric.lending_"):
        equal(ordered, ["methodology_id", "standard", "scope"], "basis")
        text_fields(context, ["calendar_id", "session", "coverage_definition"], "context")
        for f in ordered:
            for key in ("calendar_id", "session", "coverage_definition"):
                require(f["basis"].get(key) == context[key], "market_coverage_mismatch", f"{f['concept']} {key} must match the declared comparison population.")

    v = [Fraction(values[k]) for k in SPECS[metric][0]]
    if metric in ("metric.operating_margin", "metric.net_margin", "metric.cash_conversion", "metric.debt_to_equity", "metric.liabilities_to_equity", "metric.short_volume_ratio", "metric.short_balance_ratio", "metric.credit_balance_ratio"):
        positive(v[1], SPECS[metric][0][1])
        if metric == "metric.short_volume_ratio":
            require(v[0] <= v[1], "subset_exceeds_denominator", "Short traded share volume must be a subset of same-population total traded share volume.")
        return v[0] / v[1] * 100
    if metric in ("metric.fcf", "metric.net_debt"):
        return v[0] - v[1]
    if metric == "metric.debt":
        return v[0]
    if metric == "metric.net_debt_to_equity":
        positive(v[2], "total equity")
        return (v[0] - v[1]) / v[2] * 100
    if metric == "metric.roe":
        positive(v[1], "opening common equity")
        positive(v[2], "closing common equity")
        return v[0] / ((v[1] + v[2]) / 2) * 100
    if metric == "metric.eps":
        positive(v[1], "weighted average common shares")
        return v[0] / v[1]
    if metric == "metric.per":
        positive(v[0], "price")
        positive(v[2], "weighted average common shares")
        positive(v[1] / v[2], "basic EPS")
        return v[0] / (v[1] / v[2])
    if metric == "metric.lending_change":
        return v[1] - v[0]
    if metric == "metric.lending_change_pct":
        positive(v[0], "opening lending balance")
        return (v[1] - v[0]) / v[0] * 100
    raise GateError("unsupported_metric", metric)


def _calculate_metric(metric, facts, cutoff, context=None):
    """Return one computed/unavailable/blocked result; never substitute missing zero.

    Context is a per-metric policy object. Source provenance is preserved, not
    independently authenticated by this offline calculation layer.
    """
    context = context if context is not None else {}
    spec = SPECS.get(metric)
    result = {"metric_id": metric, "calculation_version": VERSION, "status": "blocked", "value": None,
              "exact_fraction": None, "unit": spec[2] if spec else None, "currency": None,
              "formula": spec[1] if spec else None, "report_cutoff": cutoff, "context": deepcopy(context),
              "reasons": [], "missing_inputs": [], "lineage": [], "facts": [], "interpretation": None,
              "actual_source_authenticated": False}
    try:
        require(spec is not None, "unsupported_metric", f"{metric} has no implemented formula.")
        require(isinstance(facts, dict) and isinstance(context, dict), "malformed_input", "Facts and context must be objects.")
        instant = parse_time(cutoff, "report cutoff")
        for key in spec[0]:
            f = facts.get(key)
            if f is None:
                result["missing_inputs"].append({"concept": key, "reason": "not_supplied"})
            elif isinstance(f, dict) and f.get("state") == "unavailable":
                require(f.get("value") is None and isinstance(f.get("missing_reason"), str) and f["missing_reason"].strip(), "invalid_missing_fact", f"{key} unavailable requires null value and a reason.")
                result["missing_inputs"].append({"concept": key, "reason": f["missing_reason"]})
        if result["missing_inputs"]:
            raise GateError("missing_required_inputs", "One or more required facts are unavailable; no zero substitution.", "unavailable")
        selected = {key: facts[key] for key in spec[0]}
        ids = [f.get("fact_id") for f in selected.values() if isinstance(f, dict)]
        require(len(ids) == len(selected) and all(isinstance(item, str) and item.strip() for item in ids), "invalid_fact_id", "Each required fact ID must be a nonempty string.")
        require(len(set(ids)) == len(ids), "duplicate_fact_id", "Each required fact needs a unique fact ID; no aliasing to an unrelated concept.")
        values = {key: validate_fact(key, f, instant) for key, f in selected.items()}
        documents = {}
        for f in selected.values():
            p = f["provenance"]
            document = (p["source_id"], p["document_id"], p["revision_id"])
            require(document not in documents or documents[document] == p["source_sha256"], "inconsistent_source_document", "One source document/revision cannot have conflicting hashes.")
            documents[document] = p["source_sha256"]
        result["lineage"] = [{"fact_id": f["fact_id"], "concept": key, "input_sha256": digest(f), "raw_decimal": f["value"], "scale": f["scale"], "normalized_decimal": format(values[key], "f"), "unit": f["unit"], "currency": f["currency"], "period": deepcopy(f["period"]), "basis": deepcopy(f["basis"]), "available_at": f["available_at"], "published_at": f["published_at"], "provenance": deepcopy(f["provenance"])} for key, f in selected.items()]
        exact = computation(metric, selected, values, context, instant)
        denominator = exact.denominator
        for factor in (2, 5):
            while denominator % factor == 0:
                denominator //= factor
        terminating = denominator == 1
        precision = max(50, len(str(abs(exact.numerator))) + len(str(exact.denominator)) * 4 + 4) if terminating else 50
        with localcontext(decimal_context(precision)):
            decimal_value = Decimal(exact.numerator) / Decimal(exact.denominator)
        result.update(status="computed", value=format(decimal_value, "f"), exact_fraction={"numerator": str(exact.numerator), "denominator": str(exact.denominator)}, decimal_policy={"precision": precision, "rounding": "ROUND_HALF_EVEN", "exact": Fraction(decimal_value) == exact, "policy": "finite decimals preserved exactly; recurring decimals rounded to 50 significant digits"}, data_kind=next(iter(selected.values()))["data_kind"])
        currencies = {f["currency"] for f in selected.values() if f["unit"] != "shares"}
        if spec[2] in ("money", "money_per_share"):
            result["currency"] = next(iter(currencies))
        result["result_id"] = "calc:" + digest({"version": VERSION, "metric": metric, "lineage": result["lineage"], "cutoff": cutoff, "context": context})
        tag = "SYNTHETIC TEST ONLY. " if result["data_kind"] == "synthetic" else "Supplied normalized evidence, not source-authenticated here. "
        periods = "; ".join(dict.fromkeys(f"{f['period']['kind']} {f['period']['start']} to {f['period']['end']}" for f in selected.values()))
        rounding_label = " (rounded)" if not result["decimal_policy"]["exact"] else ""
        result["facts"] = [{"claim_kind": "deterministic_calculation", "text": f"{tag}{metric} = {result['value']}{rounding_label} {result['currency'] or ''} {spec[2]}; periods: {periods}; formula: {spec[1]}.", "result_id": result["result_id"], "source_fact_ids": ids}]
        group = "exposure" if any(key.startswith("exposure.") for key in selected) else "financial"
        result["interpretation"] = {"claim_kind": "bounded_methodological_interpretation", "conclusion": "This is a scoped descriptive calculation, not an investment verdict or causal finding.", "limitations": LIMITATIONS[group][:], "counterevidence": {"status": "not_assessed", "reason": "Independent contradictory evidence has not been supplied or verified."}, "missing_for_broader_conclusion": ["verified source coverage and restatements", "comparable historical periods and peers", "independent context and counterevidence"], "buy_sell_verdict": None}
    except GateError as exc:
        result["status"] = exc.status
        result["reasons"].append({"code": exc.code, "detail": exc.detail})
    return result


def _calculate_report(payload):
    require(isinstance(payload, dict), "malformed_input", "Report input must be an object.")
    facts = payload.get("facts", {})
    contexts = payload.get("metric_contexts", {})
    require(isinstance(contexts, dict), "malformed_input", "metric_contexts must be an object.")
    results = {metric: calculate_metric(metric, facts, payload.get("cutoff"), contexts.get(metric, {})) for metric in SPECS}
    actual = sum(isinstance(f, dict) and f.get("data_kind") == "actual" for f in facts.values()) if isinstance(facts, dict) else 0
    return {"contract": VERSION, "data_notice": "SYNTHETIC TEST ONLY" if not actual else "Supplied facts only; source authenticity is not verified by this engine", "actual_input_rows": actual, "actual_provider_calls": 0, "status_counts": {s: sum(r["status"] == s for r in results.values()) for s in ("computed", "unavailable", "blocked")}, "results": results}


def plain_json_snapshot(value):
    """Bounded plain JSON only; never invoke caller-defined serialization hooks."""
    count=0;active=set();size=0
    def visit(x, depth=0):
        nonlocal count,size
        count+=1;size+=16
        require(size<=2000000,"invalid_json_boundary","Input exceeds JSON byte budget.")
        require(depth<=40 and count<=100000, "invalid_json_boundary", "Input exceeds JSON depth/node limits.")
        kind=type(x)
        if kind is str:
            try: encoded=x.encode('utf-8')
            except UnicodeEncodeError: raise GateError("invalid_json_boundary", "Input contains invalid Unicode.")
            size+=6*len(encoded)
            require(size<=2000000 and not re.search(r"[\u202a-\u202e\u2066-\u2069]",x), "invalid_json_boundary", "Input exceeds text limits or contains directional controls.")
            return x
        if x is None or kind is bool:return x
        if kind is int:
            require(x.bit_length()<=4096,"invalid_json_boundary","JSON integer exceeds bounds.")
            size+=len(str(x));require(size<=2000000,"invalid_json_boundary","Input exceeds JSON byte budget.");return x
        if kind is float:
            require(math.isfinite(x),"invalid_json_boundary","Nonfinite JSON number.")
            size+=32;require(size<=2000000,"invalid_json_boundary","Input exceeds JSON byte budget.");return x
        require(kind in (dict,list),"invalid_json_boundary","Only plain JSON objects and arrays are accepted.")
        require(id(x) not in active,"invalid_json_boundary","Cyclic JSON input.");active.add(id(x))
        try:
            if kind is list:return [visit(v,depth+1) for v in x]
            out={}
            for k,v in x.items():
                require(type(k) is str,"invalid_json_boundary","Object keys must be strings.")
                out[visit(k,depth+1)]=visit(v,depth+1)
            return out
        finally:active.remove(id(x))
    return visit(value)

def calculate_metric(metric, facts, cutoff, context=None):
    try:
        metric,facts,cutoff,context=plain_json_snapshot([metric,facts,cutoff,context])
        require(type(metric) is str,"invalid_json_boundary","Metric ID must be text.")
        return _calculate_metric(metric,facts,cutoff,context)
    except GateError as exc:
        result=_calculate_metric(metric if type(metric) is str and metric in SPECS else 'unsupported',{},None,{})
        result['status']='blocked';result['reasons']=[{'code':exc.code,'detail':exc.detail}]
        return result

def calculate_report(payload):
    try:return _calculate_report(plain_json_snapshot(payload))
    except GateError as exc:
        results={metric:_calculate_metric(metric,{},None,{}) for metric in SPECS}
        for result in results.values():
            result['status']='blocked';result['reasons']=[{'code':exc.code,'detail':exc.detail}]
        return {'contract':VERSION,'data_notice':'INVALID INPUT: no evidence evaluated','actual_input_rows':0,'actual_provider_calls':0,'status_counts':{'computed':0,'unavailable':0,'blocked':len(results)},'results':results}


def load_strict_json(path):
    def unique(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise ValueError(f"Duplicate JSON key: {key}")
            out[key] = value
        return out
    with open(path, encoding="utf-8") as handle:
        return json.load(handle, object_pairs_hook=unique, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"Nonfinite JSON token: {value}")))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Offline deterministic R01 calculations; no source acquisition.")
    parser.add_argument("input")
    parser.add_argument("--output")
    args = parser.parse_args()
    output = json.dumps(calculate_report(load_strict_json(args.input)), ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(output)
    else:
        print(output, end="")

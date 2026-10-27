"""Selected frozen guard/numeric helpers, reused without changing frozen code."""
from __future__ import annotations
import hashlib,json,re
from datetime import date,datetime,timezone
from decimal import Decimal,Context,localcontext,ROUND_HALF_EVEN,InvalidOperation,DivisionByZero,Overflow
from fractions import Fraction
DECIMAL_RE = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\Z")


def decimal_context(precision):
    """Never inherit process-global precision, traps, clamp or exponent bounds."""
    return Context(prec=precision, rounding=ROUND_HALF_EVEN, Emin=-999999,
                   Emax=999999, capitals=1, clamp=0, flags=[],
                   traps=[InvalidOperation, DivisionByZero, Overflow])


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


def text_fields(mapping, keys, label):
    require(isinstance(mapping, dict), "missing_metadata", f"{label} is required.")
    for key in keys:
        require(isinstance(mapping.get(key), str) and bool(mapping[key].strip()), "missing_metadata", f"{label}.{key} is required.")


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


def parse_time(value, label):
    """Exact UTC whole-second + arbitrary precision fractional comparator.

    Adapted from frozen vm-global-consumer/global_evidence.py::instant. Decimal
    construction preserves the input fraction without ambient-context rounding.
    """
    require(isinstance(value, str) and len(value) <= 2048, "invalid_timestamp", f"{label} requires a bounded ISO timestamp string.")
    match = re.fullmatch(r"([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}:[0-9]{2}:[0-9]{2})(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})", value)
    require(match is not None, "invalid_timestamp", f"{label} requires timezone-aware ISO seconds; date precision is not a timestamp.")
    day, clock, fraction, offset = match.groups()
    try:
        require(offset == "Z" or (int(offset[1:3]) <= 23 and int(offset[4:]) <= 59), "invalid_timestamp", label)
        utc = datetime.fromisoformat(day + "T" + clock + ("+00:00" if offset == "Z" else offset)).astimezone(timezone.utc)
    except (ValueError, OverflowError):
        raise GateError("invalid_timestamp", label)
    return utc, Decimal(fraction or "0")


def local_day(instant, zone):
    """Isolate representational overflow at extreme calendar years."""
    try:
        return instant[0].astimezone(zone).date()
    except (ValueError, OverflowError):
        raise GateError("local_date_out_of_range", "Timestamp cannot be represented in the declared local-date timezone.")


def render_number(exact):
    denominator = exact.denominator
    for factor in (2, 5):
        while denominator % factor == 0:
            denominator //= factor
    precision = max(50, len(str(abs(exact.numerator))) + len(str(exact.denominator)) * 4 + 4) if denominator == 1 else 50
    with localcontext(decimal_context(precision)):
        value = Decimal(exact.numerator) / Decimal(exact.denominator)
    return dict(value=format(value, "f"), exact_fraction=dict(numerator=str(exact.numerator), denominator=str(exact.denominator)), decimal_policy=dict(precision=precision, rounding="ROUND_HALF_EVEN", exact=Fraction(value) == exact))

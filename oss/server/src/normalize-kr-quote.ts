import { assertNormalizedSnapshot, type QuoteData, type QuoteSnapshot } from "./domain.js";

export const KIS_QUOTE_CATALOG = Object.freeze({
  id: "kis.kr.quote.snapshot.v1",
  method: "GET",
  path: "/uapi/domestic-stock/v1/quotations/inquire-price",
  trId: "FHKST01010100",
  catalogCommit: "2077773a69a428daf63e148182511f068cc45de3",
  query: Object.freeze({ FID_COND_MRKT_DIV_CODE: "J|NX|UN", FID_INPUT_ISCD: "six-digit-symbol" }),
});

const PROVIDER_FIELDS = new Set([
  "stck_prpr", "stck_oprc", "stck_hgpr", "stck_lwpr", "prdy_vrss", "prdy_vrss_sign",
  "prdy_ctrt", "acml_vol", "stck_bsop_date",
]);

function decimalText(value: unknown): string | null {
  // KIS quote fields in the reviewed sample are decimal strings. Reject JS
  // numbers so parsing cannot silently inherit IEEE-754 precision loss.
  if (typeof value !== "string") return null;
  const raw = value;
  if (raw === "") return null;
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return null;
  const negative = raw.startsWith("-");
  const unsigned = (negative ? raw.slice(1) : raw).replaceAll(",", "");
  const [integerPart, fractionPart] = unsigned.split(".");
  const integer = (integerPart ?? "0").replace(/^0+(?=\d)/, "");
  // Preserve fractional scale exactly; trailing zeroes can communicate the
  // provider's published precision even when the numeric value is unchanged.
  const fraction = fractionPart ?? "";
  const magnitude = fraction ? `${integer}.${fraction}` : integer;
  const isZero = integer === "0" && (fraction === "" || /^0+$/.test(fraction));
  return isZero ? magnitude : negative ? `-${magnitude}` : magnitude;
}

function negateMagnitude(value: string): string {
  if (value === "0") return "0";
  return value.startsWith("-") ? value.slice(1) : `-${value}`;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) return null;
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const check = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(check.valueOf()) || check.toISOString().slice(0, 10) !== date ? null : date;
}

function lineage(field: string, provider: string, unit: string, transform: string, reason: string | null): QuoteData["field_lineage"][number] {
  return {
    normalized_field: field as QuoteData["field_lineage"][number]["normalized_field"],
    provider_field: provider,
    raw_path: `output.${provider}`,
    raw_unit: unit,
    raw_sign: provider === "prdy_vrss" ? "output.prdy_vrss_sign" : null,
    transform,
    nullable_reason: reason,
    fixture_id: "kis.catalog.commit2077773a.row.quote.inquire-price",
    mapping_status: provider === "prdy_vrss" ? "derived" : "supported",
  };
}

export function normalizeKrQuote(
  source: Record<string, unknown>,
  args: { symbol: string; board: "J" | "NX" | "UN"; receivedAt: string; origin: "actual" | "synthetic" },
): QuoteSnapshot {
  const map = [
    ["last", "stck_prpr", "KRW/share"],
    ["open", "stck_oprc", "KRW/share"],
    ["high", "stck_hgpr", "KRW/share"],
    ["low", "stck_lwpr", "KRW/share"],
    ["change_percent", "prdy_ctrt", "percent"],
    ["volume", "acml_vol", "shares"],
  ] as const;
  const dataFields: Record<string, string | null> = {};
  const nullReasons: Record<string, string> = {};
  const fieldLineage: QuoteData["field_lineage"] = [];
  for (const [normalized, provider, unit] of map) {
    let value = decimalText(source[provider]);
    const invalidDomain = value !== null && (normalized === "volume" ? !/^(?:0|[1-9]\d*)$/.test(value) : normalized !== "change_percent" && value.startsWith("-"));
    if (invalidDomain) value = null;
    dataFields[normalized] = value;
    const reason = invalidDomain ? "invalid_provider_domain" : value === null ? (source[provider] === undefined || source[provider] === null || source[provider] === "" ? "provider_field_missing" : "invalid_provider_decimal") : null;
    if (reason) nullReasons[normalized] = reason;
    fieldLineage.push(lineage(normalized, provider, unit, "exact_decimal_string", reason));
  }

  const rawMagnitude = decimalText(source.prdy_vrss);
  const sign = String(source.prdy_vrss_sign ?? "");
  const magnitude = rawMagnitude?.replace(/^-/, "") ?? null;
  const signConflict = magnitude !== null && ((sign === "3" && !/^0(?:\.0+)?$/.test(magnitude)) || (["1","2"].includes(sign) && rawMagnitude!.startsWith("-")));
  const change = signConflict || magnitude === null || !["1", "2", "3", "4", "5"].includes(sign)
    ? null
    : sign === "3" ? "0" : sign === "4" || sign === "5" ? negateMagnitude(magnitude) : magnitude;
  dataFields.change = change;
  const changeReason = change === null
    ? signConflict ? "provider_sign_magnitude_conflict" : rawMagnitude === null ? "provider_field_missing" : "unrecognized_provider_sign"
    : null;
  if (changeReason) nullReasons.change = changeReason;
  fieldLineage.push(lineage("change", "prdy_vrss", "KRW/share", "abs(prdy_vrss) with provider sign mapping 1/2 positive, 3 zero, 4/5 negative", changeReason));

  for (const [name, provider] of [["last", "stck_prpr"], ["open", "stck_oprc"], ["high", "stck_hgpr"], ["low", "stck_lwpr"]] as const) {
    if (dataFields[name] === null && !nullReasons[name]) nullReasons[name] = "provider_field_missing";
  }
  if (!normalizeDate(source.stck_bsop_date)) nullReasons.source_as_of = source.stck_bsop_date === undefined ? "provider_field_missing" : "invalid_provider_date";

  // Unknown fields may carry provider diagnostics or sensitive extensions: never expose them.
  const unmapped = {};
  const data: QuoteData = {
    last: dataFields.last ?? null,
    open: dataFields.open ?? null,
    high: dataFields.high ?? null,
    low: dataFields.low ?? null,
    change,
    change_percent: dataFields.change_percent ?? null,
    volume: dataFields.volume ?? null,
    currency: "KRW",
    price_unit: "KRW per share",
    volume_unit: "shares",
    change_percent_unit: "percent",
    source_field_values: unmapped,
    null_reasons: nullReasons,
    field_lineage: fieldLineage,
  };
  const partial = Object.values(dataFields).some((value) => value === null);
  return assertNormalizedSnapshot({
    ok: true,
    provider: "kis",
    operation_id: "kis.kr.quote.snapshot.v1",
    market: "KR",
    instrument_ref: {
      market: "KR", exchange: "unknown", symbol: args.symbol, asset_type: "equity",
      source_market_division_code: args.board,
    },
    provenance: {
      api_reference: `${KIS_QUOTE_CATALOG.catalogCommit}; ${KIS_QUOTE_CATALOG.path}; ${KIS_QUOTE_CATALOG.trId}`,
      provider_api_version: "not_versioned_in_reviewed_sample",
      source_as_of: normalizeDate(source.stck_bsop_date),
      event_time: null,
      published_at: null,
      received_at: args.receivedAt,
      available_at: args.receivedAt,
      effective_from: null,
      effective_to: null,
      supersedes: null,
      report_cutoff: null,
      retrieved_at: args.receivedAt,
      source_timezone: "Asia/Seoul",
      clock_basis: "local_post_response_utc; source provides business date only in reviewed mapping",
      timezone: "Asia/Seoul",
      session: "unknown",
      currency: "KRW",
      unit: "KRW/share; shares; percent",
      delay_state: "unknown",
      adjusted: null,
      rights_status: "pending",
      origin: args.origin,
      estimate_kind: "reported",
      finality: "unknown",
      revision_id: null,
      availability: partial ? "partial" : "available",
      validation_status: args.origin === "synthetic" ? "synthetic_fixture" : "provider_shape_checked",
      freshness: "unknown",
      partial,
      stale: null,
    },
    data,
    warnings: ["KIS REST quote snapshot is not a WebSocket real-time stream", "intraday event time unavailable in the reviewed mapping"],
    error: null,
  });
}

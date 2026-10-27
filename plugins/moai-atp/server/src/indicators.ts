import { z } from "zod";

const decimalString = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CanonicalPriceBarSchema = z.object({
  trade_date: isoDate,
  close: decimalString,
  currency: z.string().regex(/^[A-Z]{3}$/),
  adjusted: z.boolean().nullable(),
  source_ref: z.string().min(1),
}).strict();

export type CanonicalPriceBar = z.infer<typeof CanonicalPriceBarSchema>;

export const DerivedMetricSchema = z.object({
  metric_id: z.string().regex(/^sma_[1-9]\d{0,2}$/),
  value: decimalString,
  unit: z.string(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  formula: z.string(),
  observation_start: isoDate,
  observation_end: isoDate,
  observation_count: z.number().int().positive(),
  observation_basis: z.literal("trading observations"),
  adjusted: z.boolean().nullable(),
  rounding: z.object({ mode: z.literal("half_away_from_zero"), fraction_digits: z.literal(8) }).strict(),
  lineage_id: z.string().min(1),
  source_refs: z.array(z.string().min(1)).min(1),
}).strict();

export type DerivedMetric = z.infer<typeof DerivedMetricSchema>;

function parsePositiveDecimal(value: string): { unscaled: bigint; scale: number } {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("invalid_calculation_input");
  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length > 18) throw new Error("calculation_precision_exceeded");
  return { unscaled: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function power10(power: number): bigint {
  return 10n ** BigInt(power);
}

function fixed8(numerator: bigint, denominator: bigint): string {
  const scaledNumerator = numerator * power10(8);
  let quotient = scaledNumerator / denominator;
  const remainder = scaledNumerator % denominator;
  if (remainder * 2n >= denominator) quotient += 1n;
  const digits = quotient.toString().padStart(9, "0");
  const whole = digits.slice(0, -8).replace(/^0+(?=\d)/, "");
  const fraction = digits.slice(-8).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Deterministic arithmetic over canonical decimal-string closes. This function
 * does not decide whether a series is split/dividend adjusted or whether the
 * provider data are complete; those properties are carried into lineage.
 */
export function calculateSimpleMovingAverage(
  bars: readonly CanonicalPriceBar[],
  period: number,
): DerivedMetric {
  if (!Number.isInteger(period) || period < 1 || period > 250 || bars.length < period) {
    throw new Error("invalid_calculation_period");
  }
  const parsedBars = bars.map((bar) => CanonicalPriceBarSchema.parse(bar));
  for (let i = 1; i < parsedBars.length; i += 1) {
    if (parsedBars[i - 1]!.trade_date >= parsedBars[i]!.trade_date) throw new Error("invalid_calculation_order");
  }
  const window = parsedBars.slice(-period);
  const currency = window[0]!.currency;
  const adjusted = window[0]!.adjusted;
  if (window.some((bar) => bar.currency !== currency)) throw new Error("mixed_calculation_currency");
  if (window.some((bar) => bar.adjusted !== adjusted)) throw new Error("mixed_adjustment_basis");

  const parsed = window.map((bar) => ({ bar, ...parsePositiveDecimal(bar.close) }));
  const scale = Math.max(...parsed.map((item) => item.scale));
  const sum = parsed.reduce((total, item) => total + item.unscaled * power10(scale - item.scale), 0n);
  const denominator = BigInt(period) * power10(scale);
  const value = fixed8(sum, denominator);
  const start = window[0]!.trade_date;
  const end = window.at(-1)!.trade_date;
  const sourceRefs = window.map((bar) => bar.source_ref);
  return DerivedMetricSchema.parse({
    metric_id: `sma_${period}`,
    value,
    unit: `${currency}/share`,
    currency,
    formula: `arithmetic_mean(close) over ${period} trading observations; rounded half away from zero to 8 decimal places`,
    observation_start: start,
    observation_end: end,
    observation_count: period,
    observation_basis: "trading observations",
    adjusted,
    rounding: { mode: "half_away_from_zero", fraction_digits: 8 },
    lineage_id: `calc.sma_${period}.${start}.${end}`,
    source_refs: sourceRefs,
  });
}

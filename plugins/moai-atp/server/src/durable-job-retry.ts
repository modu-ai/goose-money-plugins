import { z } from 'zod';
// Retry classification (Refs #106, design docs/design/durable-job-and-stock-link.md §5, Refs #29).
// Pure decision logic only — no executor loop, no sleeps, no network/file/DB/process access. Retry
// counts and backoff (J-01) are injected configuration: an unset policy means zero transient
// retries (무한 재시도 금지), never an invented count. The 429 rule — one retry, after the
// provider-given wait — is design-fixed and not configurable. Error kinds and write-effect check
// results are caller observations passed as arguments, the same pattern as the piece-1 permission
// recheck. Verdict reason/failure-code strings are descriptive proposals, not decided constants.

/** Caller-observed error kinds of the design §5 table. `rate_limited` is a 429; `retry_after_ms`
 * is the provider-given wait when the provider stated one. */
export type NodeError =
  | { kind: 'network_transient' }
  | { kind: 'timeout' }
  | { kind: 'rate_limited'; retry_after_ms?: number }
  | { kind: 'auth_permission'; status: 401 | 403 }
  | { kind: 'schema_mismatch' };

/** J-01 injected, never invented. Absent `transient` policy ⇒ zero transient retries. */
export type RetryPolicy = { transient?: { max_retries: number; backoff_base_ms: number } };

/** Retries of each class already spent on the failing node. */
export type RetryCounters = { transient: number; rate_limited: number };

/** Result of the effect query the caller ran for a write-effect step (§5 last row). */
export type WriteEffectCheck = { checked: true; effect_present: boolean } | { checked: false };

export type RetryVerdict =
  | { action: 'retry'; class: 'transient' | 'rate_limited'; wait_ms: number; attempt: number }
  | { action: 'blocked'; reason: 'provider_auth_or_permission' }
  | { action: 'failed'; failure_code: string }
  | { action: 'check_effect_first' }
  | { action: 'no_retry_effect_present' };

export type RetryInput = {
  error: NodeError;
  policy: RetryPolicy;
  counters: RetryCounters;
  has_write_effect?: boolean;
  effect_check?: WriteEffectCheck;
};

// Exported for the runner loop (durable-job-runner.ts), which validates the same caller
// observations before folding them — one schema, no duplicated shape.
export const ErrorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('network_transient') }).strict(),
  z.object({ kind: z.literal('timeout') }).strict(),
  z.object({ kind: z.literal('rate_limited'), retry_after_ms: z.number().int().positive().optional() }).strict(),
  z.object({ kind: z.literal('auth_permission'), status: z.union([z.literal(401), z.literal(403)]) }).strict(),
  z.object({ kind: z.literal('schema_mismatch') }).strict(),
]);
const PolicySchema = z.object({
  transient: z.object({ max_retries: z.number().int().nonnegative(), backoff_base_ms: z.number().int().positive() })
    // Every wait the policy can produce must stay a representable integer (base·2^(max−1) < base·2^max).
    .refine((t) => t.backoff_base_ms * 2 ** t.max_retries <= Number.MAX_SAFE_INTEGER)
    .optional(),
}).strict();
const CountersSchema = z.object({ transient: z.number().int().nonnegative(), rate_limited: z.number().int().nonnegative() }).strict();
export const EffectCheckSchema = z.union([
  z.object({ checked: z.literal(true), effect_present: z.boolean() }).strict(),
  z.object({ checked: z.literal(false) }).strict(),
]);
const InputSchema = z.object({
  error: ErrorSchema,
  policy: PolicySchema,
  counters: CountersSchema,
  has_write_effect: z.boolean().optional(),
  effect_check: EffectCheckSchema.optional(),
}).strict();

/** Classify one node error into the §5 table's action: retry (with the wait the design prescribes),
 * blocked (401/403), failed (schema mismatch, retry limit reached, unconstructable retry), or — on
 * a write-effect step — query/resolve the write effect before anything is re-sent. */
export function classifyRetry(input: RetryInput): RetryVerdict {
  const r = InputSchema.safeParse(input);
  if (!r.success) throw new Error('error_code=invalid_input');
  const { error: e, policy, counters, has_write_effect = false, effect_check = { checked: false } } = r.data;

  // §5 rows 3–4: auth/permission and schema errors never retry, so the write-effect gate
  // (which exists only to stop duplicate re-sends) does not apply to them.
  if (e.kind === 'auth_permission') return { action: 'blocked', reason: 'provider_auth_or_permission' };
  if (e.kind === 'schema_mismatch') return { action: 'failed', failure_code: 'schema_mismatch' };

  let retry: Extract<RetryVerdict, { action: 'retry' }>;
  if (e.kind === 'rate_limited') {
    // Design-fixed: exactly one retry, after the provider-given wait. Without a stated wait the
    // design's retry cannot be constructed, and no wait is invented.
    if (e.retry_after_ms === undefined || counters.rate_limited >= 1) return { action: 'failed', failure_code: 'rate_limited' };
    retry = { action: 'retry', class: 'rate_limited', wait_ms: e.retry_after_ms, attempt: counters.rate_limited + 1 };
  } else {
    // network_transient | timeout share one class (§5 row 1, exponential backoff). No policy ⇒
    // zero retries, the observed error stands; reaching the injected limit stops (T5: 제한 횟수에서 멈춤).
    const t = policy.transient;
    if (!t || counters.transient >= t.max_retries) {
      // A write-effect step resolves its effect even out of retry budget: the last permitted
      // attempt may have landed while its response was lost (§5 last row) — query first, and
      // a present effect is resolved from the effect, never re-sent, never failed.
      if (has_write_effect) {
        if (!effect_check.checked) return { action: 'check_effect_first' };
        if (effect_check.effect_present) return { action: 'no_retry_effect_present' };
      }
      return t ? { action: 'failed', failure_code: 'transient_retry_limit_reached' } : { action: 'failed', failure_code: e.kind };
    }
    retry = { action: 'retry', class: 'transient', wait_ms: t.backoff_base_ms * 2 ** counters.transient, attempt: counters.transient + 1 };
  }

  // §5 last row: a write-effect step retries only after its effect was queried and found absent.
  // Not queried ⇒ query first; effect present ⇒ never re-send (the result resolves from the
  // effect, #23 멱등 키).
  if (has_write_effect) {
    if (!effect_check.checked) return { action: 'check_effect_first' };
    if (effect_check.effect_present) return { action: 'no_retry_effect_present' };
  }
  return retry;
}

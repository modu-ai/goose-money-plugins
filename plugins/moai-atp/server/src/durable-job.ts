import { z } from 'zod';
// Durable job state machine core (Refs #106, design docs/design/durable-job-and-stock-link.md §2·4·6, Refs #29).
// Smallest first slice: pure state/transition/cancel/budget logic only — no persistence, no job keys,
// no retry execution, no network/file/DB/process access. Budget limits are injected configuration:
// undecided values (J-02) stay undecided and are never invented. The permission recheck (#7/J-06)
// is a caller-observed argument ('passed'|'failed'), never a call this module makes.

export const JOB_STATES = ['queued', 'running', 'blocked', 'partial', 'failed', 'cancelled', 'completed'] as const;
export type JobState = typeof JOB_STATES[number];
/** Terminal states keep their record; no event reopens them (design §2.1 ●, reuse default is J-04). */
export const TERMINAL_STATES = ['partial', 'failed', 'cancelled', 'completed'] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];
/** `cancelling` is internal: a cancel was requested but no worker end was observed yet (design §4). */
export type InternalState = JobState | 'cancelling';

export type JobRecord = {
  state: InternalState;
  node_result_hashes?: string[];
  blocked_reason?: string;
  failure_code?: string;
  missing_data?: string[];
  budget_exhausted?: boolean;
  budget_outcome?: 'partial' | 'failed';
  cancel_unconfirmed?: boolean;
  /** Recorded when a revocation arrives while cancelling (§2.2 "어느 상태든"): the cancel
   * procedure stays, and live states carry the revocation in `blocked_reason` instead. */
  permission_revoked?: boolean;
  /** Count of node results discarded after a cancel, accepted results excluded (§4 "버리고 기록만"). */
  discarded_late_results?: number;
};

const Recheck = z.enum(['passed', 'failed']);
const EventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('start'), permission_recheck: Recheck }).strict(),
  z.object({ event: z.literal('node_completed'), node_result_hash: z.string().min(1).max(256) }).strict(),
  z.object({ event: z.literal('blocked'), reason: z.string().min(1).max(64) }).strict(),
  z.object({ event: z.literal('unblock'), permission_recheck: Recheck }).strict(),
  z.object({ event: z.literal('complete') }).strict(),
  z.object({ event: z.literal('partial'), missing_data: z.array(z.string().min(1).max(128)).min(1).max(100) }).strict(),
  z.object({ event: z.literal('fail'), failure_code: z.string().min(1).max(64) }).strict(),
  z.object({ event: z.literal('budget_exhausted'), outcome: z.enum(['partial', 'failed']) }).strict(),
  z.object({ event: z.literal('permission_revoked') }).strict(),
  z.object({ event: z.literal('cancel_requested') }).strict(),
  z.object({ event: z.literal('worker_end_observed') }).strict(),
  z.object({ event: z.literal('cancel_timeout_reached') }).strict(),
]);
type JobEvent = z.infer<typeof EventSchema>;

export function createDurableJob(): JobRecord { return { state: 'queued', node_result_hashes: [] }; }

/** Everything but `state` survives a transition (§2.1: terminal states keep their record);
 * the caller names the new state so it is excluded here. Node hashes are always a list. */
const keep = (job: JobRecord): Omit<JobRecord, 'state'> => {
  const { state, ...rest } = job;
  return { ...rest, node_result_hashes: rest.node_result_hashes ?? [] };
};

/** Apply one event to a job record. Every transition outside the design §2.2 table is refused with
 * `error_code=illegal_transition:<state>+<event>`; malformed events with `error_code=invalid_input`. */
export function apply(job: JobRecord, event: unknown): JobRecord {
  const r = EventSchema.safeParse(event);
  if (!r.success) throw new Error('error_code=invalid_input');
  const e: JobEvent = r.data, s = job.state;
  const illegal = (): never => { throw new Error(`error_code=illegal_transition:${s}+${e.event}`); };
  switch (e.event) {
    case 'start':
      if (s !== 'queued') illegal();
      return e.permission_recheck === 'passed' ? { state: 'running', ...keep(job) } : { state: 'blocked', ...keep(job), blocked_reason: 'permission_revoked' };
    case 'node_completed':
      // Late results after a cancel are discarded, record-only (§4, T4): the state is kept and
      // only the discard count grows — cancelled is not reopened.
      if (s === 'cancelling' || s === 'cancelled') return { ...job, discarded_late_results: (job.discarded_late_results ?? 0) + 1 };
      if (s !== 'running') illegal();
      return { state: 'running', node_result_hashes: [...(job.node_result_hashes ?? []), e.node_result_hash] };
    case 'blocked':
      if (s !== 'running') illegal();
      return { state: 'blocked', ...keep(job), blocked_reason: e.reason };
    case 'unblock':
      if (s !== 'blocked') illegal();
      // A failed recheck is not necessarily a revocation (the key may still be missing): the job
      // stays blocked with its original reason — no invented code, no reason information lost.
      if (e.permission_recheck !== 'passed') return { ...job };
      return { state: 'running', ...keep(job) };
    case 'complete':
      if (s !== 'running') illegal();
      return { state: 'completed', ...keep(job) };
    case 'partial':
      if (s !== 'running') illegal();
      return { state: 'partial', missing_data: e.missing_data, ...keep(job) };
    case 'fail':
      if (s !== 'running') illegal();
      return { state: 'failed', failure_code: e.failure_code, ...keep(job) };
    case 'budget_exhausted':
      if (s !== 'running') illegal();
      return e.outcome === 'partial' ? { state: 'partial', budget_exhausted: true, budget_outcome: 'partial', ...keep(job) } : { state: 'failed', budget_exhausted: true, budget_outcome: 'failed', ...keep(job) };
    case 'permission_revoked':
      // §2.2 last row ("어느 상태든") read against §4: a revocation arriving while cancelling must
      // not be dropped, yet the only route to `cancelled` stays the observed worker end — so the
      // cancel procedure keeps running and the revocation is recorded on the record. Terminal
      // states keep their record (§2.1 ●): they are not reopened by a blocked transition.
      if (s === 'cancelling') return { ...job, permission_revoked: true };
      if (s !== 'queued' && s !== 'running' && s !== 'blocked') illegal();
      return { state: 'blocked', ...keep(job), blocked_reason: 'permission_revoked' };
    case 'cancel_requested':
      if (s !== 'queued' && s !== 'running' && s !== 'blocked') illegal();
      return { state: 'cancelling', ...keep(job) };
    case 'worker_end_observed':
      if (s !== 'cancelling') illegal();
      return { state: 'cancelled', ...keep(job) };
    case 'cancel_timeout_reached':
      if (s !== 'cancelling') illegal();
      return { ...job, cancel_unconfirmed: true };
  }
}

export type BudgetConfig = { max_elapsed_ms?: number; max_provider_calls?: number };
export type BudgetSpent = { elapsed_ms: number; provider_calls: number };
export type BudgetVerdict = { ok: true; note?: 'no_budget_configured' } | { ok: false; reason: 'budget_exhausted'; exhausted: ('max_elapsed_ms' | 'max_provider_calls')[] };

const BudgetConfigSchema = z.object({ max_elapsed_ms: z.number().int().nonnegative().optional(), max_provider_calls: z.number().int().nonnegative().optional() }).strict();
const SpentSchema = z.object({ elapsed_ms: z.number().int().nonnegative(), provider_calls: z.number().int().nonnegative() }).strict();

/** Check injected budget limits against spent counters. Reaching a limit counts as exhausted
 * (design §6: 소진 시 partial/failed + budget_exhausted). With no limits configured the verdict
 * is ok with `no_budget_configured` — undecided budget values (J-02) are never invented here. */
export function checkBudget(config: BudgetConfig, spent: unknown): BudgetVerdict {
  const c = BudgetConfigSchema.safeParse(config);
  if (!c.success) throw new Error('error_code=invalid_input');
  const s = SpentSchema.safeParse(spent);
  if (!s.success) throw new Error('error_code=invalid_input');
  const exhausted: ('max_elapsed_ms' | 'max_provider_calls')[] = [];
  if (c.data.max_elapsed_ms !== undefined && s.data.elapsed_ms >= c.data.max_elapsed_ms) exhausted.push('max_elapsed_ms');
  if (c.data.max_provider_calls !== undefined && s.data.provider_calls >= c.data.max_provider_calls) exhausted.push('max_provider_calls');
  if (exhausted.length > 0) return { ok: false, reason: 'budget_exhausted', exhausted };
  if (c.data.max_elapsed_ms === undefined && c.data.max_provider_calls === undefined) return { ok: true, note: 'no_budget_configured' };
  return { ok: true };
}

/** New node starts are allowed only while running; a cancelling job starts nothing (design §4). */
export function canStartNode(job: JobRecord): boolean { return job.state === 'running'; }

/** Late results after a cancel are discarded record-only (design §4, T4): false in cancelling/cancelled. */
export function acceptsNodeResults(job: JobRecord): boolean { return job.state !== 'cancelling' && job.state !== 'cancelled'; }

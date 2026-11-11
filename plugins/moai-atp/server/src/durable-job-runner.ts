import { z } from 'zod';
import {
  apply, canStartNode, checkBudget, createDurableJob,
  type BudgetConfig, type BudgetSpent, type JobRecord,
} from './durable-job.js';
import {
  classifyRetry, EffectCheckSchema, ErrorSchema,
  type NodeError, type RetryPolicy, type WriteEffectCheck,
} from './durable-job-retry.js';
// Runner-loop judgment (Refs #106, design docs/design/durable-job-and-stock-link.md §2.2·§4·§5·§6, Refs #29).
// Pure decision logic only — no sleeps, no timers, no AbortSignal wiring, no network/file/DB/process
// access. Actual waiting, worker aborts, write-effect queries, process resumption and persistence are
// caller-side injected interfaces: each step() only decides and returns commands. Retry counts and
// waits (J-01) and budget values (J-02) are injected configuration, never invented; this loop composes
// the piece-1 state machine (apply/checkBudget/canStartNode) and the piece-2 classification
// (classifyRetry) and owns none of those contracts. Scheduling is sequential — one node in flight.

/** One plan node. `has_write_effect` marks a §5 last-row step (publish etc.) whose effect must be
 * queried before any re-send (#23 멱등 키). */
export type RunnerNodeSpec = { id: string; has_write_effect?: boolean };

/** §2.1: node status lives in a separate table from the job state. */
export type NodeStatus = 'pending' | 'in_flight' | 'succeeded' | 'failed';

export type NodeProgress = {
  id: string;
  has_write_effect: boolean;
  status: NodeStatus;
  /** Retries already spent on this node, per class (piece-2 counters). */
  retry: { transient: number; rate_limited: number };
};

export type RunnerState = {
  job: JobRecord;
  nodes: NodeProgress[];
  /** The node the executor last sent work for. Set by a start/retry decision, cleared when the node
   * resolves or the job dies; kept through a cancel so late outcomes still find their target (§4). */
  in_flight: string | undefined;
  /** Pending write-effect query (§5 last row): the failure that triggered it, answered by
   * effect_observed. */
  awaiting_effect: { node: string; error: NodeError } | undefined;
};

export type RunnerConfig = {
  /** J-01 injected, never invented (piece-2 contract; classified lazily by classifyRetry). */
  retry_policy: RetryPolicy;
  /** J-02 injected, never invented (piece-1 contract; checked by checkBudget). */
  budget?: BudgetConfig;
};

/** One caller observation per step. Recheck results, node errors and effect checks are arguments —
 * the same pattern as the piece-1 permission recheck; nothing is observed here. */
export type Observation =
  | { kind: 'start'; permission_recheck: 'passed' | 'failed' }
  | { kind: 'node_succeeded'; node: string; result_hash: string }
  | { kind: 'node_failed'; node: string; error: NodeError; effect_check?: WriteEffectCheck }
  | { kind: 'effect_observed'; node: string; check: WriteEffectCheck; result_hash?: string }
  | { kind: 'cancel_requested' }
  | { kind: 'worker_end_observed' }
  | { kind: 'cancel_timeout_reached' }
  | { kind: 'review_passed' };

/** What the caller performs next, outside this module. `retry_node_after` carries the prescribed
 * wait; `abort_worker` means "abort whatever is still outstanding for this node" (§4 AbortSignal). */
export type Command =
  | { cmd: 'start_node'; node: string }
  | { cmd: 'retry_node_after'; node: string; wait_ms: number }
  | { cmd: 'abort_worker'; node: string }
  | { cmd: 'query_write_effect'; node: string };

export type StepResult = { state: RunnerState; commands: Command[] };

const NodeId = z.string().min(1).max(128);
const ResultHash = z.string().min(1).max(256);
// Defensive list bound, same magnitude as the piece-1/repro list bounds — not a design value.
const SpecSchema = z.object({ id: NodeId, has_write_effect: z.boolean().optional() }).strict();
const ObservationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('start'), permission_recheck: z.enum(['passed', 'failed']) }).strict(),
  z.object({ kind: z.literal('node_succeeded'), node: NodeId, result_hash: ResultHash }).strict(),
  z.object({ kind: z.literal('node_failed'), node: NodeId, error: ErrorSchema, effect_check: EffectCheckSchema.optional() }).strict(),
  z.object({ kind: z.literal('effect_observed'), node: NodeId, check: EffectCheckSchema, result_hash: ResultHash.optional() }).strict(),
  z.object({ kind: z.literal('cancel_requested') }).strict(),
  z.object({ kind: z.literal('worker_end_observed') }).strict(),
  z.object({ kind: z.literal('cancel_timeout_reached') }).strict(),
  z.object({ kind: z.literal('review_passed') }).strict(),
]);

/** Build the initial runner state for a plan. Ids must be unique; an empty plan is not a run. */
export function createRunnerState(nodes: readonly RunnerNodeSpec[]): RunnerState {
  const specs = z.array(SpecSchema).min(1).max(100).safeParse(nodes);
  if (!specs.success || new Set(specs.data.map((n) => n.id)).size !== specs.data.length) {
    throw new Error('error_code=invalid_input');
  }
  return {
    job: createDurableJob(),
    nodes: specs.data.map((n) => ({
      id: n.id, has_write_effect: n.has_write_effect ?? false, status: 'pending' as const,
      retry: { transient: 0, rate_limited: 0 },
    })),
    in_flight: undefined,
    awaiting_effect: undefined,
  };
}

const bad = (detail: string): never => { throw new Error(`error_code=invalid_observation:${detail}`); };
const nodeOf = (st: RunnerState, id: string): NodeProgress => {
  const n = st.nodes.find((x) => x.id === id);
  if (!n) throw new Error('error_code=invalid_observation:unknown_node');
  return n;
};
const withJob = (st: RunnerState, job: JobRecord): RunnerState => ({ ...st, job });
const withNode = (st: RunnerState, id: string, patch: Partial<NodeProgress>): RunnerState => ({
  ...st, nodes: st.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
});
const cancelling = (st: RunnerState): boolean =>
  st.job.state === 'cancelling' || st.job.state === 'cancelled';

/** Gate one provider call (first send or retry) against the injected budget (§6, T9). On exhaustion
 * the budget_exhausted event is folded with the outcome derived from progress — partial once any
 * node finished (§2.1: partial = 일부 단계 완료, 나머지 불가), failed before that. A configured budget
 * without spent counters cannot be verified and is refused, never guessed. A retry's earliest
 * dispatch is elapsed+wait: when that lands at or past the elapsed limit the command would
 * authorize an out-of-budget send, so it is gated now — the command is the authorization and
 * nothing re-checks between the wait and the dispatch. */
function budgetGate(st: RunnerState, config: RunnerConfig, spent: BudgetSpent | undefined, wait_ms = 0):
  { ok: true; state: RunnerState } | { ok: false; state: RunnerState } {
  if (!config.budget) return { ok: true, state: st };
  if (!spent) throw new Error('error_code=invalid_input');
  const v = checkBudget(config.budget, spent); // validates config and spent, invalid_input on junk
  const beyondByWait = config.budget.max_elapsed_ms !== undefined
    && spent.elapsed_ms + wait_ms >= config.budget.max_elapsed_ms;
  if (v.ok && !beyondByWait) return { ok: true, state: st };
  const outcome = st.nodes.some((n) => n.status === 'succeeded') ? 'partial' : 'failed';
  let s = withJob(st, apply(st.job, { event: 'budget_exhausted', outcome }));
  if (s.in_flight !== undefined) {
    s = withNode(s, s.in_flight, { status: 'pending' }); // never completed — it stops unsent
    s = { ...s, in_flight: undefined };
  }
  return { ok: false, state: s };
}

/** Decide the next command while the job is live: start the first pending node (budget-gated), or
 * nothing once every node succeeded — completion then waits for the review observation (§2.2). */
function scheduleNext(st: RunnerState, config: RunnerConfig, spent: BudgetSpent | undefined): StepResult {
  if (!canStartNode(st.job)) return { state: st, commands: [] };
  const next = st.nodes.find((n) => n.status === 'pending');
  if (!next) return { state: st, commands: [] };
  const g = budgetGate(st, config, spent);
  if (!g.ok) return { state: g.state, commands: [] };
  return {
    state: { ...withNode(g.state, next.id, { status: 'in_flight' }), in_flight: next.id },
    commands: [{ cmd: 'start_node', node: next.id }],
  };
}

/** Fold one observation and decide the commands. Illegal job transitions surface the piece-1
 * `illegal_transition` error unchanged; protocol breaks are `invalid_observation:<detail>`; junk
 * shapes are `invalid_input`. */
export function step(state: RunnerState, config: RunnerConfig, ob: unknown, spent?: BudgetSpent): StepResult {
  const o = ObservationSchema.safeParse(ob);
  if (!o.success) throw new Error('error_code=invalid_input');
  // The schema-validated shape, restated as Observation: zod infers `prop?: T | undefined` for
  // optional fields, which exactOptionalPropertyTypes keeps distinct from `prop?: T`.
  const e = o.data as Observation;

  switch (e.kind) {
    case 'start': {
      const job = apply(state.job, { event: 'start', permission_recheck: e.permission_recheck });
      return scheduleNext({ ...state, job }, config, spent);
    }
    case 'node_succeeded': {
      nodeOf(state, e.node);
      if (state.in_flight !== e.node) bad('node_not_in_flight');
      // The piece-1 fold itself discards late results after a cancel (§4, T4): state kept, only
      // the discard count grows — nothing restarts while cancelling or cancelled.
      const wasCancelling = cancelling(state);
      const s = withJob(state, apply(state.job, { event: 'node_completed', node_result_hash: e.result_hash }));
      // A success observed while an effect query pended resolves the node outright: the query is
      // moot, so its pending entry is cleared — a later stale answer is a protocol break, and the
      // next node's failures must apply their own policy, not effect_query_pending.
      const cleared = state.awaiting_effect?.node === e.node ? { awaiting_effect: undefined } : {};
      if (wasCancelling) return { state: { ...s, ...cleared }, commands: [] };
      return scheduleNext(withNode({ ...s, in_flight: undefined, ...cleared }, e.node, { status: 'succeeded' }), config, spent);
    }
    case 'node_failed': {
      const n = nodeOf(state, e.node);
      if (state.in_flight !== e.node) bad('node_not_in_flight');
      if (state.awaiting_effect) bad('effect_query_pending');
      if (cancelling(state)) {
        // A late error during a cancel is not a result: nothing folds, nothing re-sends — the
        // cancel flow owns the outcome (§4).
        return { state, commands: [] };
      }
      const v = classifyRetry({
        error: e.error, policy: config.retry_policy, counters: n.retry,
        has_write_effect: n.has_write_effect, effect_check: e.effect_check ?? { checked: false },
      });
      if (v.action === 'blocked') {
        // T6: 401/403 — the job waits (the node never completed; it re-runs after an unblock).
        const s = withJob(state, apply(state.job, { event: 'blocked', reason: v.reason }));
        return { state: { ...withNode(s, e.node, { status: 'pending' }), in_flight: undefined }, commands: [] };
      }
      if (v.action === 'failed') {
        const s = withJob(state, apply(state.job, { event: 'fail', failure_code: v.failure_code }));
        return { state: { ...withNode(s, e.node, { status: 'failed' }), in_flight: undefined }, commands: [] };
      }
      if (v.action === 'retry') {
        const g = budgetGate(state, config, spent, v.wait_ms); // a retry is a provider call too (§6)
        if (!g.ok) return { state: g.state, commands: [] };
        const retry = { ...n.retry, [v.class]: n.retry[v.class] + 1 };
        return { state: withNode(g.state, e.node, { retry }), commands: [{ cmd: 'retry_node_after', node: e.node, wait_ms: v.wait_ms }] };
      }
      // check_effect_first | no_retry_effect_present (§5 last row): query the effect and resolve
      // from its hash — a present effect is never re-sent, an absent one retries after the answer.
      // no_retry_effect_present also routes through the query because the resolving hash comes
      // from the caller's read; the query is a read, not a re-send.
      return {
        state: { ...state, awaiting_effect: { node: e.node, error: e.error } },
        commands: [{ cmd: 'query_write_effect', node: e.node }],
      };
    }
    case 'effect_observed': {
      const n = nodeOf(state, e.node);
      if (state.in_flight !== e.node) bad('node_not_in_flight');
      const pend = state.awaiting_effect;
      if (!pend || pend.node !== e.node) throw new Error('error_code=invalid_observation:no_pending_effect_query');
      if (cancelling(state)) {
        // The cancel flow owns the outcome (§4): the answer folds nothing and re-sends nothing.
        return { state: { ...state, awaiting_effect: undefined }, commands: [] };
      }
      if (!e.check.checked) {
        // The effect could not be determined: the design path (query, retry only when absent) is
        // unavailable and a blind re-send is forbidden (#23 멱등 키) — the standing error fails the
        // node, the same no-invention fallback as the piece-2 unset-policy rule.
        const s = withJob(state, apply(state.job, { event: 'fail', failure_code: pend.error.kind }));
        return { state: { ...withNode(s, e.node, { status: 'failed' }), in_flight: undefined, awaiting_effect: undefined }, commands: [] };
      }
      if (e.check.effect_present) {
        if (e.result_hash === undefined) throw new Error('error_code=invalid_observation:effect_result_hash_required');
        const s = withJob(state, apply(state.job, { event: 'node_completed', node_result_hash: e.result_hash }));
        return scheduleNext(
          withNode({ ...s, in_flight: undefined, awaiting_effect: undefined }, e.node, { status: 'succeeded' }),
          config, spent,
        );
      }
      // Effect confirmed absent: re-classify with the answer; a retry verdict passes, the limit fails.
      const v = classifyRetry({
        error: pend.error, policy: config.retry_policy, counters: n.retry,
        has_write_effect: true, effect_check: { checked: true, effect_present: false },
      });
      if (v.action === 'retry') {
        const g = budgetGate(state, config, spent, v.wait_ms);
        if (!g.ok) return { state: g.state, commands: [] };
        const retry = { ...n.retry, [v.class]: n.retry[v.class] + 1 };
        return {
          state: { ...withNode(g.state, e.node, { retry }), awaiting_effect: undefined },
          commands: [{ cmd: 'retry_node_after', node: e.node, wait_ms: v.wait_ms }],
        };
      }
      if (v.action === 'failed') {
        const s = withJob(state, apply(state.job, { event: 'fail', failure_code: v.failure_code }));
        return { state: { ...withNode(s, e.node, { status: 'failed' }), in_flight: undefined, awaiting_effect: undefined }, commands: [] };
      }
      // Unreachable with a queried-absent effect: 401/403 skip the gate, a present effect was
      // ruled out — a contract break, not something to guess around.
      bad('unreachable_effect_verdict');
    }
    case 'cancel_requested': {
      const s = withJob(state, apply(state.job, { event: 'cancel_requested' }));
      // §4: new node starts stop here; the in-flight worker (if any) is aborted outside.
      const commands: Command[] = state.in_flight !== undefined ? [{ cmd: 'abort_worker', node: state.in_flight }] : [];
      return { state: s, commands };
    }
    case 'worker_end_observed': {
      // §4: the observed worker end is the only ground for cancelled.
      return { state: withJob(state, apply(state.job, { event: 'worker_end_observed' })), commands: [] };
    }
    case 'cancel_timeout_reached': {
      // §4/T3b: a timeout alone is not a confirmation — cancelling stays, unconfirmed is recorded.
      return { state: withJob(state, apply(state.job, { event: 'cancel_timeout_reached' })), commands: [] };
    }
    case 'review_passed': {
      if (state.nodes.some((n) => n.status !== 'succeeded')) bad('nodes_pending'); // §2.2 gate
      return { state: withJob(state, apply(state.job, { event: 'complete' })), commands: [] };
    }
  }
}

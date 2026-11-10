// Pure subscription/payment event state machine (issue #104; design docs/design/subscription-state-machine.md, #8).
// Provider-free by contract: apply() accepts only verified provider events (verified_signature must be
// literal true — S4/S5); the signature check itself and every provider stay outside this module. No
// persistence, no prices, no billing cycles: period ends arrive on provider events and are stored, never
// invented. Undecided values (#8 B-01..B-07) stay injectable and default to undecided behaviour:
// trialEndFailureTarget (trial.ended + payment.failed -> past_due|expired), pendingTimeoutMs
// (pending | timeout | none), pastDueGraceMs (#8 B-04). Entitlement mapping (#7/B-08) is NOT here:
// consumers feed effectiveState() results into the #7 evaluator's subscription input. Single-writer
// discipline is the caller's duty; createSubscriptionEventProcessor only serializes in-memory work
// per subscription_id (design §5 동시 처리).

import { z } from 'zod';

export const SUBSCRIPTION_STATES = ['none', 'pending', 'trialing', 'active', 'past_due', 'canceled_pending_end', 'expired', 'refunded', 'disputed'] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

export const EVENT_TYPES = ['checkout.completed', 'payment.succeeded', 'payment.failed', 'trial.ended', 'renewal.succeeded', 'renewal.failed', 'subscription.cancel_requested', 'subscription.resumed', 'refund.succeeded', 'dispute.opened', 'dispute.won', 'dispute.lost'] as const;
export type ProviderEventType = (typeof EVENT_TYPES)[number];

const eventSchema = z.object({
  event_id: z.string().min(1).max(256),
  type: z.enum(EVENT_TYPES),
  occurred_at: z.number().int().nonnegative(),
  verified_signature: z.literal(true),                           // S4: the boundary above must have verified the signature
  provider_revision: z.number().int().nonnegative().optional(),  // provider order when it gives one (design §5 순서 역전)
  current_period_end: z.number().int().positive().optional(),    // provider-stated period end (epoch ms), stored verbatim
  trial: z.boolean().optional(),                                 // provider-declared trial payment (design §4 row 2)
  refund_scope: z.literal('full').optional(),                    // design §4 transitions full refunds only; B-05 undecided otherwise
}).strict();

export type ProviderEventInput = z.input<typeof eventSchema>;

export type StoredSubscription = {
  subscription_id: string;
  state: SubscriptionState;
  current_period_end: number | null;          // stored provider period end; expiry is computed from this, not from late events (S3)
  revision: number;                           // last applied provider order (0 while none seen); a revision-less event never advances it
  previous_state: SubscriptionState | null;   // remembered for dispute.won restore
  previous_state_changed_at: number | null;   // the restored state's own anchor (B-04 grace), kept across a dispute round-trip
  trial_ended: boolean;                       // trial.ended seen, awaiting the settling payment
  state_changed_at: number;
  last_event_at: number;
  applied_event_ids: string[];                // idempotency keys (S1) — uncapped: design §5 keeps every processed id until persistence decides otherwise
  unhandled: { event_id: string; type: string; at: number; reason: string }[];  // recorded-only events (S2, unknown combinations, undecided values), bounded
};

export type ApplyOutcome = 'applied' | 'duplicate_ignored' | 'stale_recorded' | 'unhandled_recorded' | 'rejected' | 'no_difference' | 'provider_stale' | 'reconcile_required';
export type ApplyResult = { outcome: ApplyOutcome; reason?: string; subscription: StoredSubscription };

export type ProviderView = { state: SubscriptionState; current_period_end?: number | null; revision?: number };

export type StateMachineOptions = {
  trialEndFailureTarget?: 'past_due' | 'expired';  // design table offers both (#8 decision pending) — unset stays unhandled
  pendingTimeoutMs?: number;                       // design §4 "pending | 시간 초과 | none" — timeout undecided, injectable
  pastDueGraceMs?: number;                         // #8 B-04 grace length; unset keeps past_due until a settling event
};

const UNHANDLED_CAP = 200;

export function createSubscriptionStateMachine(options: StateMachineOptions = {}) {
  const emptySubscription = (subscription_id: string): StoredSubscription => ({
    subscription_id,
    state: 'none',
    current_period_end: null,
    revision: 0,
    previous_state: null,
    previous_state_changed_at: null,
    trial_ended: false,
    state_changed_at: 0,
    last_event_at: 0,
    applied_event_ids: [],
    unhandled: [],
  });

  const record = (sub: StoredSubscription, entry: { event_id: string; type: string; at: number; reason: string }): StoredSubscription =>
    ({ ...sub, unhandled: [...sub.unhandled, entry].slice(-UNHANDLED_CAP) });

  const withApplied = (sub: StoredSubscription, event_id: string): StoredSubscription =>
    ({ ...sub, applied_event_ids: [...sub.applied_event_ids, event_id] });

  function effectiveState(sub: StoredSubscription, now: number): SubscriptionState {
    // Design §5 지연: the stored period end closes paid access without waiting for an expiry event (S3).
    if (sub.current_period_end !== null && sub.current_period_end <= now
      && sub.state !== 'none' && sub.state !== 'expired' && sub.state !== 'refunded') return 'expired';
    if (options.pendingTimeoutMs !== undefined && sub.state === 'pending' && sub.state_changed_at + options.pendingTimeoutMs <= now) return 'none';
    if (options.pastDueGraceMs !== undefined && sub.state === 'past_due' && sub.state_changed_at + options.pastDueGraceMs <= now) return 'expired';
    // #8 B-04: the grace anchor above is the settling event's occurred_at (kept in state_changed_at),
    // so this module stays deterministic in event time; whether the wall clock should anchor the
    // grace instead is part of the undecided value itself.
    return sub.state;
  }

  type Transition = { sub: StoredSubscription } | { unhandled: string };

  function transition(sub: StoredSubscription, event: z.infer<typeof eventSchema>, now: number): Transition | undefined {
    // Period ends and revisions come from the event when the provider states them; nothing is invented.
    const next = (state: SubscriptionState, extra: Partial<StoredSubscription> = {}): StoredSubscription => ({
      ...sub,
      ...extra,
      state,
      state_changed_at: now,
      last_event_at: now,
      // Design §5: the revision space belongs to the provider's order. A revision-less event advances
      // nothing — comparing it against a provider order is undefined, and apply() routes order-less
      // events to the reconciliation view instead (reconcile_required 반환).
      revision: event.provider_revision ?? sub.revision,
      current_period_end: event.current_period_end ?? sub.current_period_end,
    });
    switch (event.type) {
      case 'checkout.completed': {
        // Design §4 "none/expired -> checkout.completed -> pending" with §5 지연: elapsed states
        // count as none/expired here — a paid state whose stored period already ended (S3) and a
        // pending checkout past its injected timeout, so a new checkout can start from them.
        // A stored dispute stays out: §4 exits a dispute only via dispute.won/lost, and a checkout
        // would erase the restoration state — combinations outside the table keep the state and are
        // recorded verbatim (§4, S14 guard).
        const effective = effectiveState(sub, now);
        if (sub.state !== 'disputed' && (effective === 'none' || effective === 'expired')) return { sub: next('pending', { trial_ended: false, previous_state: null, previous_state_changed_at: null }) };
        return undefined;
      }
      case 'payment.succeeded':
        if (sub.state === 'pending') return { sub: next(event.trial === true ? 'trialing' : 'active', { trial_ended: false, previous_state: null, previous_state_changed_at: null }) };
        if (sub.state === 'trialing' && sub.trial_ended) return { sub: next('active', { trial_ended: false }) };
        if (sub.state === 'past_due') return { sub: next('active') };
        return undefined;
      case 'payment.failed':
        if (sub.state === 'pending') return { sub: next('none') };
        if (sub.state === 'trialing' && sub.trial_ended) {
          if (options.trialEndFailureTarget === undefined) return { unhandled: 'trial_end_failure_target_unconfigured' };
          return { sub: next(options.trialEndFailureTarget, { trial_ended: false }) };
        }
        return undefined;
      case 'trial.ended':
        if (sub.state === 'trialing') return { sub: next('trialing', { trial_ended: true }) };
        return undefined;
      case 'renewal.succeeded':
        if (sub.state === 'active' || sub.state === 'past_due') return { sub: next('active') };
        return undefined;
      case 'renewal.failed':
        if (sub.state === 'active') return { sub: next('past_due') };
        return undefined;
      case 'subscription.cancel_requested':
        if (sub.state === 'active' || sub.state === 'trialing') return { sub: next('canceled_pending_end') };
        return undefined;
      case 'subscription.resumed':
        if (sub.state === 'canceled_pending_end') return { sub: next('active') };
        return undefined;
      case 'refund.succeeded':
        if (event.refund_scope !== 'full') return { unhandled: 'refund_scope_unsupported' };
        if (sub.state === 'active' || sub.state === 'canceled_pending_end' || sub.state === 'past_due') return { sub: next('refunded', { trial_ended: false, previous_state: null, previous_state_changed_at: null }) };
        return undefined;
      case 'dispute.opened':  // design table "active 등": paid-capable states enter dispute
        if (sub.state === 'active' || sub.state === 'trialing' || sub.state === 'canceled_pending_end' || sub.state === 'past_due') return { sub: next('disputed', { previous_state: sub.state, previous_state_changed_at: sub.state_changed_at }) };
        return undefined;
      case 'dispute.won':
        if (sub.state === 'disputed' && sub.previous_state !== null) {
          // §4 disputed -> won -> previous state: restoring is not a new state change, so the
          // restored state keeps its original anchor — an already-exhausted past_due grace
          // (B-04) must not restart without a successful payment (P2 :154).
          return { sub: { ...next(sub.previous_state, { previous_state: null, previous_state_changed_at: null }), state_changed_at: sub.previous_state_changed_at ?? now } };
        }
        return undefined;
      case 'dispute.lost':
        if (sub.state === 'disputed') return { sub: next('refunded', { trial_ended: false, previous_state: null, previous_state_changed_at: null }) };
        return undefined;
    }
  }

  function apply(current: StoredSubscription, input: unknown): ApplyResult {
    const parsed = eventSchema.safeParse(input);
    if (!parsed.success) return { outcome: 'rejected', reason: 'invalid_event', subscription: current };
    const event = parsed.data;
    // S1: a seen event id is ignored (the 200-OK replay answer is the caller's transport concern).
    if (current.applied_event_ids.includes(event.event_id)) return { outcome: 'duplicate_ignored', subscription: current };
    if (event.provider_revision !== undefined && current.revision > event.provider_revision) {
      // S2: an older event never reverts state; it is recorded once and marked seen.
      return { outcome: 'stale_recorded', subscription: withApplied(record(current, { event_id: event.event_id, type: event.type, at: event.occurred_at, reason: 'stale_event_revision' }), event.event_id) };
    }
    const moved = transition(current, event, event.occurred_at);
    if (moved === undefined) {
      // Design §4 row "표에 없는 (상태, 사건) 조합": the state is kept, the combination is
      // recorded, and the caller aligns through the provider view (§5 유실 대사 경로). The event
      // is marked seen, so the outcome must request that view — otherwise a settled payment
      // arriving out of order is finalised as a dead end (P2 :189, :182).
      const reason = event.provider_revision === undefined ? 'revision_less_reconcile' : 'out_of_table_reconcile';
      return { outcome: 'reconcile_required', reason, subscription: withApplied(record(current, { event_id: event.event_id, type: event.type, at: event.occurred_at, reason }), event.event_id) };
    }
    if ('unhandled' in moved) {
      return { outcome: 'unhandled_recorded', reason: moved.unhandled, subscription: withApplied(record(current, { event_id: event.event_id, type: event.type, at: event.occurred_at, reason: moved.unhandled }), event.event_id) };
    }
    if (event.provider_revision === undefined) {
      // Design §5 순서 역전: without a provider order the arrival sequence proves nothing — a
      // delayed renewal.failed after a newer renewal.succeeded would revert paid access (P2 :172).
      // Mark the event seen and require the reconciliation view (the provider-verified current
      // state) instead of treating arrival order as authoritative; the table above runs only where
      // the stale guard can actually judge order.
      return { outcome: 'reconcile_required', reason: 'revision_less_reconcile', subscription: withApplied(record(current, { event_id: event.event_id, type: event.type, at: event.occurred_at, reason: 'revision_less_reconcile' }), event.event_id) };
    }
    return { outcome: 'applied', subscription: withApplied(moved.sub, event.event_id) };
  }

  function reconcile(current: StoredSubscription, provider: ProviderView, now: number): ApplyResult {
    // Design §5 유실: the reconciliation schedule is undecided (B-07) — this is the pure step only.
    if (provider.revision !== undefined && provider.revision < current.revision) {
      return { outcome: 'provider_stale', subscription: record(current, { event_id: 'reconcile', type: 'provider.reconcile', at: now, reason: 'reconcile_provider_stale' }) };
    }
    if (provider.state === current.state) {
      // Provider-confirms-stored: the view speaks only to the fields it carries (period end,
      // revision). The local-only anchors — the trial settlement marker, the grace/state-change
      // anchor, the dispute restoration pointer — are knowledge the view does not carry, and
      // overwriting them restarts the grace on every pass (P2 :211), drops the pending trial
      // settlement (P2 :210), or breaks dispute.won restore. Keep them; update only the carried
      // fields.
      const updated: StoredSubscription = {
        ...current,
        current_period_end: provider.current_period_end === undefined ? current.current_period_end : provider.current_period_end,
        revision: provider.revision ?? current.revision,
        last_event_at: now,
      };
      if (updated.current_period_end !== current.current_period_end) {
        return { outcome: 'applied', reason: 'reconcile_confirmed_state', subscription: record(updated, { event_id: 'reconcile', type: 'provider.reconcile', at: now, reason: 'reconcile_confirmed_state' }) };
      }
      return { outcome: 'no_difference', subscription: updated };
    }
    const local = effectiveState(current, now);
    const periodSame = provider.current_period_end === undefined || provider.current_period_end === current.current_period_end;
    if (local === provider.state && periodSame) {
      // §5 순서 역전: a newer provider revision is verified knowledge even when nothing visible
      // differs; keep it so later stale events stay rejected (a revision-5 event must not revert
      // a provider-verified revision-10 snapshot).
      if (provider.revision !== undefined && provider.revision > current.revision) {
        return { outcome: 'no_difference', subscription: { ...current, revision: provider.revision, last_event_at: now } };
      }
      return { outcome: 'no_difference', subscription: current };
    }
    // §4 dispute rows: dispute.won restores the pre-dispute state, so reconciliation keeps that
    // restoration state while disputed and captures the prior state when it adopts a dispute.
    const previous_state: SubscriptionState | null = provider.state === 'disputed'
      ? (current.state === 'disputed' ? current.previous_state : current.state)
      : null;
    const previous_state_changed_at: number | null = provider.state === 'disputed'
      ? (current.state === 'disputed' ? current.previous_state_changed_at : current.state_changed_at)
      : null;
    // Restoring the pre-dispute state through the reconciliation view is not a new state change:
    // carry the saved anchor back like dispute.won does (P2 :248) so an exhausted past_due grace
    // does not restart without a successful payment. Entering a dispute through reconciliation
    // mirrors dispute.opened, which keeps the trial settlement marker (P2 :251).
    const restoringDisputeState = current.state === 'disputed' && provider.state === current.previous_state && current.previous_state_changed_at !== null;
    const enteringDispute = provider.state === 'disputed' && current.state !== 'disputed';
    const adopted: StoredSubscription = {
      ...current,
      state: provider.state,
      current_period_end: provider.current_period_end === undefined ? current.current_period_end : provider.current_period_end,
      revision: provider.revision ?? current.revision,
      previous_state,
      previous_state_changed_at,
      trial_ended: (restoringDisputeState || enteringDispute) ? current.trial_ended : false,
      state_changed_at: restoringDisputeState ? (current.previous_state_changed_at ?? now) : now,
      last_event_at: now,
    };
    return { outcome: 'applied', reason: 'reconcile_adopted_provider', subscription: record(adopted, { event_id: 'reconcile', type: 'provider.reconcile', at: now, reason: 'reconcile_adopted_provider' }) };
  }

  return { emptySubscription, apply, effectiveState, reconcile };
}

export function createSubscriptionEventProcessor(options: StateMachineOptions & {
  load?: (id: string) => Promise<StoredSubscription | undefined>;
  save?: (sub: StoredSubscription) => Promise<void>;
} = {}) {
  const machine = createSubscriptionStateMachine(options);
  const store = new Map<string, StoredSubscription>();
  const queues = new Map<string, Promise<unknown>>();
  return {
    machine,
    get: (id: string): StoredSubscription | undefined => store.get(id),
    submit: (id: string, event: unknown): Promise<ApplyResult> => {
      // Design §5 동시 처리: same-subscription events serialize per subscription_id (S11).
      const run = (queues.get(id) ?? Promise.resolve()).then(async () => {
        const loaded = await options.load?.(id);
        const current = loaded ?? store.get(id) ?? machine.emptySubscription(id);
        const result = machine.apply(current, event);
        store.set(id, result.subscription);
        await options.save?.(result.subscription);
        return result;
      });
      queues.set(id, run.then(() => undefined, () => undefined));
      return run;
    },
  };
}

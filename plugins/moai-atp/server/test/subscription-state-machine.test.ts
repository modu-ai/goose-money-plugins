// Pure subscription/payment event state machine tests (issue #104, design docs/design/subscription-state-machine.md S1-S14).
// Provider-free: verified events only, no provider call, no persistence, no real signature check (S8/S9 live in entitlement.test.ts, Refs #7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscriptionStateMachine, createSubscriptionEventProcessor, type StoredSubscription, type ProviderEventType } from '../src/subscription-state-machine.js';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;
const machine = createSubscriptionStateMachine();
const empty = (id = 'sub-1') => machine.emptySubscription(id);
const state = (sub: StoredSubscription) => sub.state;
const ev = (id: string, type: ProviderEventType, extra: Record<string, unknown> = {}) => ({
  event_id: id, type, occurred_at: T0, verified_signature: true as const, ...extra,
});
function activeWithEnd(end: number): StoredSubscription {
  const checkedOut = machine.apply(empty(), ev('e0', 'checkout.completed', { provider_revision: 1 })).subscription;
  return machine.apply(checkedOut, ev('e1', 'payment.succeeded', { provider_revision: 2, current_period_end: end })).subscription;
}
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('S1 duplicate payment.succeeded transitions once', () => {
  const first = machine.apply(machine.apply(empty(), ev('e0', 'checkout.completed', { provider_revision: 1 })).subscription, ev('e1', 'payment.succeeded', { provider_revision: 2 }));
  assert.equal(state(first.subscription), 'active');
  const again = machine.apply(first.subscription, ev('e1', 'payment.succeeded'));
  assert.equal(again.outcome, 'duplicate_ignored');
  assert.equal(state(again.subscription), 'active');
  assert.equal(again.subscription.applied_event_ids.length, first.subscription.applied_event_ids.length);
});

test('S2 stale revision is recorded and never reverts the state', () => {
  let sub = machine.apply(empty(), ev('e0', 'checkout.completed', { provider_revision: 3 })).subscription;
  assert.equal(state(sub), 'pending');
  const stale = machine.apply(sub, ev('e1', 'payment.failed', { occurred_at: T0 - 1000, provider_revision: 1 }));
  assert.equal(stale.outcome, 'stale_recorded');
  assert.equal(state(stale.subscription), 'pending');
  assert.equal(stale.subscription.unhandled.at(-1)?.reason, 'stale_event_revision');
  sub = machine.apply(stale.subscription, ev('e2', 'payment.succeeded', { provider_revision: 4 })).subscription;
  assert.equal(state(sub), 'active');
  assert.equal(sub.revision, 4);
  assert.equal(sub.unhandled.length, 1);
});

test('S3 stored period end closes paid access without waiting for an event', () => {
  const sub = activeWithEnd(T0 + 30 * DAY);
  assert.equal(machine.effectiveState(sub, T0 + 30 * DAY - 1), 'active');
  assert.equal(machine.effectiveState(sub, T0 + 30 * DAY), 'expired');
  assert.equal(machine.effectiveState(sub, T0 + 30 * DAY + 1), 'expired');
});

test('S4 unverified or unsigned events are rejected with zero state change', () => {
  const sub = empty();
  const unverified = machine.apply(sub, { ...ev('e1', 'payment.succeeded'), verified_signature: false });
  assert.equal(unverified.outcome, 'rejected');
  assert.equal(state(unverified.subscription), 'none');
  const unsigned = machine.apply(sub, { event_id: 'e2', type: 'payment.succeeded', occurred_at: T0 });
  assert.equal(unsigned.outcome, 'rejected');
  assert.equal(state(unsigned.subscription), 'none');
});

test('S5 checkout redirect parameters are not provider events', () => {
  const bad = machine.apply(empty(), { success: true, subscription_id: 'sub-1' });
  assert.equal(bad.outcome, 'rejected');
  assert.equal(state(bad.subscription), 'none');
});

test('S6 cancel keeps paid access until the stored period end', () => {
  const end = T0 + 30 * DAY;
  let sub = machine.apply(activeWithEnd(end), ev('e2', 'subscription.cancel_requested', { provider_revision: 3, occurred_at: T0 })).subscription;
  assert.equal(state(sub), 'canceled_pending_end');
  assert.equal(machine.effectiveState(sub, end - 1), 'canceled_pending_end');
  assert.equal(machine.effectiveState(sub, end + 1), 'expired');
  sub = machine.apply(sub, ev('e3', 'subscription.resumed', { provider_revision: 4, occurred_at: end - 2 * DAY })).subscription;
  assert.equal(state(sub), 'active');
});

test('S7 full refund ends paid access immediately; undecided refund scope stays unhandled', () => {
  const sub = activeWithEnd(T0 + 30 * DAY);
  const unspecced = machine.apply(sub, ev('e2', 'refund.succeeded'));
  assert.equal(unspecced.outcome, 'unhandled_recorded');
  assert.equal(unspecced.subscription.unhandled.at(-1)?.reason, 'refund_scope_unsupported');
  assert.equal(state(unspecced.subscription), 'active');
  const refunded = machine.apply(unspecced.subscription, ev('e3', 'refund.succeeded', { provider_revision: 3, refund_scope: 'full' }));
  assert.equal(state(refunded.subscription), 'refunded');
  assert.equal(machine.effectiveState(refunded.subscription, T0 + 1), 'refunded');
});

test('S11 same-subscription events apply serially even when loads overlap', async () => {
  const store = new Map<string, StoredSubscription>();
  const gate = deferred<void>();
  const proc = createSubscriptionEventProcessor({
    load: async (id) => { await gate.promise; return store.get(id); },
    save: async (sub) => { store.set(sub.subscription_id, sub); },
  });
  const first = proc.submit('sub-1', ev('e0', 'checkout.completed', { provider_revision: 1 }));
  const second = proc.submit('sub-1', ev('e1', 'payment.succeeded', { provider_revision: 2 }));
  gate.resolve();
  const [r1, r2] = await Promise.all([first, second]);
  assert.equal(r1.outcome, 'applied');
  assert.equal(r2.outcome, 'applied');
  assert.equal(state(store.get('sub-1')!), 'active');
});

test('S12 reconciliation adopts the provider view and records the difference', () => {
  const sub = activeWithEnd(T0 + 30 * DAY);
  const differing = machine.reconcile(sub, { state: 'canceled_pending_end', current_period_end: T0 + 30 * DAY, revision: 9 }, T0 + 1);
  assert.equal(differing.subscription.state, 'canceled_pending_end');
  assert.equal(differing.subscription.revision, 9);
  assert.equal(differing.subscription.unhandled.at(-1)?.reason, 'reconcile_adopted_provider');
  const same = machine.reconcile(differing.subscription, { state: 'canceled_pending_end', current_period_end: T0 + 30 * DAY, revision: 9 }, T0 + 1);
  assert.equal(same.outcome, 'no_difference');
  const staleProvider = machine.reconcile(differing.subscription, { state: 'active', revision: 1 }, T0 + 1);
  assert.equal(staleProvider.outcome, 'provider_stale');
  assert.equal(state(staleProvider.subscription), 'canceled_pending_end');
});

test('S13 no payment instrument raw data is accepted or stored', () => {
  const sub = activeWithEnd(T0 + 30 * DAY);
  const r = machine.apply(sub, { ...ev('e9', 'payment.succeeded'), card_number: '4111111111111111' });
  assert.equal(r.outcome, 'rejected');
  assert.ok(!JSON.stringify(r.subscription).includes('4111'));
});

test('S14 renewal failure then late retry succeeds with no unhandled combinations', () => {
  const end1 = T0 + 30 * DAY;
  let sub = machine.apply(activeWithEnd(end1), ev('e2', 'renewal.failed', { provider_revision: 3, occurred_at: end1 - DAY })).subscription;
  assert.equal(state(sub), 'past_due');
  const retry = machine.apply(sub, ev('e3', 'renewal.succeeded', { provider_revision: 4, occurred_at: end1 + DAY, current_period_end: T0 + 60 * DAY }));
  assert.equal(retry.outcome, 'applied');
  assert.equal(state(retry.subscription), 'active');
  assert.equal(retry.subscription.current_period_end, T0 + 60 * DAY);
  assert.equal(retry.subscription.unhandled.length, 0);
  assert.equal(retry.subscription.applied_event_ids.filter((id) => id === 'e3').length, 1);
});

test('trial path follows the transition table and keeps the undecided failure target undecided', () => {
  let sub = machine.apply(empty(), ev('e0', 'checkout.completed', { provider_revision: 1 })).subscription;
  sub = machine.apply(sub, ev('e1', 'payment.succeeded', { provider_revision: 2, trial: true })).subscription;
  assert.equal(state(sub), 'trialing');
  sub = machine.apply(sub, ev('e2', 'trial.ended', { provider_revision: 3, occurred_at: T0 + 7 * DAY })).subscription;
  assert.equal(sub.trial_ended, true);
  assert.equal(state(sub), 'trialing');
  const unconfigured = machine.apply(sub, ev('e3', 'payment.failed', { provider_revision: 4 }));
  assert.equal(unconfigured.outcome, 'unhandled_recorded');
  assert.equal(unconfigured.subscription.unhandled.at(-1)?.reason, 'trial_end_failure_target_unconfigured');
  const configured = createSubscriptionStateMachine({ trialEndFailureTarget: 'past_due' });
  const pastDue = configured.apply(sub, ev('e3', 'payment.failed', { provider_revision: 4 }));
  assert.equal(state(pastDue.subscription), 'past_due');
  const recovered = configured.apply(pastDue.subscription, ev('e4', 'payment.succeeded', { provider_revision: 5, current_period_end: T0 + 37 * DAY }));
  assert.equal(state(recovered.subscription), 'active');
});

test('pending timeout expires only when the grace value is injected', () => {
  const sub = machine.apply(empty(), ev('e0', 'checkout.completed', { provider_revision: 1 })).subscription;
  assert.equal(machine.effectiveState(sub, T0 + 10 * DAY), 'pending');
  const timed = createSubscriptionStateMachine({ pendingTimeoutMs: 5 * DAY });
  assert.equal(timed.effectiveState(sub, T0 + 6 * DAY), 'none');
});

test('unhandled combinations keep the state and are recorded', () => {
  const end = T0 + 30 * DAY;
  let sub = machine.apply(activeWithEnd(end), ev('e2', 'refund.succeeded', { provider_revision: 3, refund_scope: 'full' })).subscription;
  assert.equal(state(sub), 'refunded');
  const r = machine.apply(sub, ev('e5', 'renewal.succeeded', { current_period_end: end + 30 * DAY }));
  assert.equal(r.outcome, 'unhandled_recorded');
  assert.equal(state(r.subscription), 'refunded');
  assert.equal(r.subscription.unhandled.at(-1)?.reason, 'unhandled_combination');
});

test('checkout after time-based expiration starts a new pending checkout', () => {
  const end = T0 + 30 * DAY;
  const again = machine.apply(activeWithEnd(end), ev('e2', 'checkout.completed', { provider_revision: 3, occurred_at: end + DAY }));
  assert.equal(again.outcome, 'applied');
  assert.equal(state(again.subscription), 'pending');
  assert.equal(again.subscription.previous_state, null);
  const paid = machine.apply(again.subscription, ev('e3', 'payment.succeeded', { provider_revision: 4, occurred_at: end + DAY, current_period_end: end + 30 * DAY }));
  assert.equal(state(paid.subscription), 'active');
  assert.equal(paid.subscription.current_period_end, end + 30 * DAY);

  const timed = createSubscriptionStateMachine({ pendingTimeoutMs: 5 * DAY });
  const pending = timed.apply(timed.emptySubscription('sub-1'), ev('e0', 'checkout.completed', { provider_revision: 1, occurred_at: T0 })).subscription;
  const restart = timed.apply(pending, ev('e1', 'checkout.completed', { provider_revision: 2, occurred_at: T0 + 6 * DAY }));
  assert.equal(restart.outcome, 'applied');
  assert.equal(state(restart.subscription), 'pending');

  const live = machine.apply(activeWithEnd(end), ev('e4', 'checkout.completed', { occurred_at: end - DAY }));
  assert.equal(live.outcome, 'unhandled_recorded');
  assert.equal(state(live.subscription), 'active');
});

test('reconciliation keeps a newer provider revision on no difference so stale events stay rejected', () => {
  let sub = machine.apply(empty(), ev('e0', 'checkout.completed', { provider_revision: 2 })).subscription;
  sub = machine.apply(sub, ev('e1', 'payment.succeeded', { provider_revision: 2 })).subscription;
  assert.equal(sub.revision, 2);
  const same = machine.reconcile(sub, { state: 'active', revision: 10 }, T0 + DAY);
  assert.equal(same.outcome, 'no_difference');
  assert.equal(same.subscription.revision, 10);
  const late = machine.apply(same.subscription, ev('e2', 'renewal.failed', { provider_revision: 5, occurred_at: T0 + DAY }));
  assert.equal(late.outcome, 'stale_recorded');
  assert.equal(state(late.subscription), 'active');
});

test('reconciliation preserves the dispute restoration state so dispute.won still restores', () => {
  const end = T0 + 30 * DAY;
  let sub = machine.apply(activeWithEnd(end), ev('e2', 'dispute.opened', { provider_revision: 3 })).subscription;
  assert.equal(state(sub), 'disputed');
  assert.equal(sub.previous_state, 'active');
  const reconciled = machine.reconcile(sub, { state: 'disputed', current_period_end: end + 10 * DAY, revision: 9 }, T0 + DAY);
  assert.equal(reconciled.outcome, 'applied');
  assert.equal(state(reconciled.subscription), 'disputed');
  assert.equal(reconciled.subscription.previous_state, 'active');
  assert.equal(reconciled.subscription.current_period_end, end + 10 * DAY);
  const won = machine.apply(reconciled.subscription, ev('e3', 'dispute.won', { provider_revision: 10 }));
  assert.equal(won.outcome, 'applied');
  assert.equal(state(won.subscription), 'active');

  const missed = machine.reconcile(activeWithEnd(end), { state: 'disputed', current_period_end: end, revision: 7 }, T0 + 2 * DAY);
  assert.equal(missed.subscription.previous_state, 'active');
  const wonLate = machine.apply(missed.subscription, ev('e4', 'dispute.won', { provider_revision: 8 }));
  assert.equal(state(wonLate.subscription), 'active');
});

test('an effective-expired stored state accepts a new checkout and its payment activates it', () => {
  const end = T0 + 30 * DAY;
  const sub = activeWithEnd(end);
  assert.equal(machine.effectiveState(sub, end + DAY), 'expired');
  const checkout = machine.apply(sub, ev('e2', 'checkout.completed', { provider_revision: 3, occurred_at: end + DAY }));
  assert.equal(checkout.outcome, 'applied');
  assert.equal(state(checkout.subscription), 'pending');
  const paid = machine.apply(checkout.subscription, ev('e3', 'payment.succeeded', { provider_revision: 4, occurred_at: end + 2 * DAY, current_period_end: end + 32 * DAY }));
  assert.equal(paid.outcome, 'applied');
  assert.equal(state(paid.subscription), 'active');
  assert.equal(paid.subscription.current_period_end, end + 32 * DAY);
});

test('a timed-out pending accepts a new checkout when the timeout is injected', () => {
  const timed = createSubscriptionStateMachine({ pendingTimeoutMs: 5 * DAY });
  const sub = timed.apply(timed.emptySubscription('sub-1'), ev('e0', 'checkout.completed', { provider_revision: 1 })).subscription;
  assert.equal(timed.effectiveState(sub, T0 + 6 * DAY), 'none');
  const checkout = timed.apply(sub, ev('e1', 'checkout.completed', { provider_revision: 2, occurred_at: T0 + 6 * DAY }));
  assert.equal(checkout.outcome, 'applied');
  assert.equal(state(checkout.subscription), 'pending');
});

test('reconciliation stores a newer provider revision even without a state difference', () => {
  const end = T0 + 30 * DAY;
  const sub = activeWithEnd(end);
  const same = machine.reconcile(sub, { state: 'active', current_period_end: end, revision: 10 }, T0 + 1);
  assert.equal(same.outcome, 'no_difference');
  assert.equal(same.subscription.revision, 10);
  const late = machine.apply(same.subscription, ev('e2', 'renewal.failed', { provider_revision: 5 }));
  assert.equal(late.outcome, 'stale_recorded');
  assert.equal(state(late.subscription), 'active');
});

test('reconciliation keeps the dispute restoration state; dispute.won and dispute.lost still resolve', () => {
  const end = T0 + 30 * DAY;
  const sub = activeWithEnd(end);
  const disputed = machine.apply(sub, ev('e2', 'dispute.opened', { provider_revision: 3 })).subscription;
  assert.equal(state(disputed), 'disputed');
  assert.equal(disputed.previous_state, 'active');
  const reconciled = machine.reconcile(disputed, { state: 'disputed', current_period_end: end + 30 * DAY, revision: 10 }, T0 + 1);
  assert.equal(reconciled.outcome, 'applied');
  assert.equal(reconciled.subscription.previous_state, 'active');
  const won = machine.apply(reconciled.subscription, ev('e3', 'dispute.won', { provider_revision: 11, occurred_at: T0 + 2 * DAY }));
  assert.equal(won.outcome, 'applied');
  assert.equal(state(won.subscription), 'active');
  const lost = machine.apply(reconciled.subscription, ev('e4', 'dispute.lost', { provider_revision: 12, occurred_at: T0 + 2 * DAY }));
  assert.equal(lost.outcome, 'applied');
  assert.equal(state(lost.subscription), 'refunded');
});

test('reconciliation entering a dispute captures the restoration state', () => {
  const end = T0 + 30 * DAY;
  const sub = activeWithEnd(end);
  const reconciled = machine.reconcile(sub, { state: 'disputed', current_period_end: end, revision: 10 }, T0 + 1);
  assert.equal(reconciled.outcome, 'applied');
  assert.equal(reconciled.subscription.state, 'disputed');
  assert.equal(reconciled.subscription.previous_state, 'active');
  const won = machine.apply(reconciled.subscription, ev('e3', 'dispute.won', { provider_revision: 11 }));
  assert.equal(won.outcome, 'applied');
  assert.equal(state(won.subscription), 'active');
});

test('applied event ids survive beyond the old replay cap', () => {
  let sub = machine.apply(empty(), ev('e0', 'checkout.completed', { provider_revision: 1 })).subscription;
  sub = machine.apply(sub, ev('e1', 'payment.succeeded', { provider_revision: 2 })).subscription;
  assert.equal(state(sub), 'active');
  for (let i = 0; i < 1001; i++) {
    sub = machine.apply(sub, ev(`r${i}`, 'renewal.succeeded', { provider_revision: 10 + i })).subscription;
  }
  const replay = machine.apply(sub, ev('e1', 'payment.succeeded'));
  assert.equal(replay.outcome, 'duplicate_ignored');
  assert.equal(state(replay.subscription), 'active');
});

test('events without a provider revision never feed the revision comparison and require the view', () => {
  // Design §5 순서 역전: order-less events neither apply nor touch the revision space — the
  // caller aligns through the reconciliation view instead of arrival order.
  let sub = machine.apply(empty(), ev('e0', 'checkout.completed', { provider_revision: 1 })).subscription;
  sub = machine.apply(sub, ev('e1', 'payment.succeeded', { provider_revision: 2 })).subscription;
  assert.equal(state(sub), 'active');
  const routed = machine.apply(sub, ev('e2', 'renewal.succeeded'));
  assert.equal(routed.outcome, 'reconcile_required');
  assert.equal(state(routed.subscription), 'active');
  assert.equal(routed.subscription.revision, 2);  // revision space untouched by order-less events
  const failed = machine.apply(routed.subscription, ev('e3', 'renewal.failed', { provider_revision: 3 }));
  assert.equal(failed.outcome, 'applied');
  assert.equal(state(failed.subscription), 'past_due');
  assert.equal(failed.subscription.revision, 3);
});

test('a live dispute stays out of new checkouts even past its period end', () => {
  const end = T0 + 30 * DAY;
  const disputed = machine.apply(activeWithEnd(end), ev('e2', 'dispute.opened', { provider_revision: 3 })).subscription;
  assert.equal(state(disputed), 'disputed');
  assert.equal(machine.effectiveState(disputed, end + DAY), 'expired');
  const checkout = machine.apply(disputed, ev('e3', 'checkout.completed', { occurred_at: end + DAY }));
  assert.equal(checkout.outcome, 'unhandled_recorded');
  assert.equal(state(checkout.subscription), 'disputed');
  assert.equal(checkout.subscription.previous_state, 'active');
});

// Codex 2차 인라인 지적 수리 (head a7f7523, TDD RED) — Refs #104.

test('a delayed revision-less renewal.failed must not revert a renewed subscription on arrival order', () => {
  // Codex P2 :172 — design §5 순서 역전: "순번이 없으면 사건을 받은 뒤 공급자 API로 현재 구독
  // 상태를 조회해 그 값으로 맞춤". Arrival order is not the authority; the module must require
  // the reconciliation view instead of applying the order-less event's table transition.
  const end = T0 + 30 * DAY;
  const sub = activeWithEnd(end);
  const delayed = machine.apply(sub, ev('e2', 'renewal.failed', { occurred_at: end + DAY }));
  assert.equal(delayed.outcome, 'reconcile_required');
  assert.equal(state(delayed.subscription), 'active');
  assert.ok(delayed.subscription.applied_event_ids.includes('e2'));  // marked seen — replay-safe
  const aligned = machine.reconcile(delayed.subscription, { state: 'active', current_period_end: end + 30 * DAY }, end + 2 * DAY);
  assert.equal(state(aligned.subscription), 'active');
});

test('reconciliation confirming trialing keeps the trial settlement marker so the payment still settles', () => {
  // Codex P2 :210 — trial.ended already set the marker; a reconcile that only updates the
  // period must not erase it, or the settling payment lands in unhandled and the subscription
  // stays trialing despite a successful payment.
  let sub = machine.apply(empty(), ev('e0', 'checkout.completed', { provider_revision: 1 })).subscription;
  sub = machine.apply(sub, ev('e1', 'payment.succeeded', { provider_revision: 2, trial: true })).subscription;
  sub = machine.apply(sub, ev('e2', 'trial.ended', { provider_revision: 3, occurred_at: T0 + 7 * DAY })).subscription;
  assert.equal(sub.trial_ended, true);
  const reconciled = machine.reconcile(sub, { state: 'trialing', current_period_end: T0 + 10 * DAY, revision: 5 }, T0 + 8 * DAY);
  assert.equal(reconciled.subscription.trial_ended, true);
  assert.equal(state(reconciled.subscription), 'trialing');
  assert.equal(reconciled.subscription.current_period_end, T0 + 10 * DAY);
  const paid = machine.apply(reconciled.subscription, ev('e3', 'payment.succeeded', { provider_revision: 6, occurred_at: T0 + 9 * DAY }));
  assert.equal(paid.outcome, 'applied');
  assert.equal(state(paid.subscription), 'active');
});

test('reconciliation confirming past_due keeps the grace anchor so no reconcile restarts the grace', () => {
  // Codex P2 :211 — with pastDueGraceMs configured, a reconcile of an elapsed-grace past_due
  // against an unchanged provider past_due must keep the original failure timestamp; resetting
  // state_changed_at makes the effective state past_due again without any successful payment.
  const grace = createSubscriptionStateMachine({ pastDueGraceMs: 5 * DAY });
  let sub = grace.apply(grace.emptySubscription('s'), ev('g0', 'checkout.completed', { provider_revision: 1 })).subscription;
  sub = grace.apply(sub, ev('g1', 'payment.succeeded', { provider_revision: 2, current_period_end: T0 + 30 * DAY })).subscription;
  sub = grace.apply(sub, ev('g2', 'renewal.failed', { provider_revision: 3, occurred_at: T0 + DAY })).subscription;
  assert.equal(sub.state_changed_at, T0 + DAY);
  assert.equal(grace.effectiveState(sub, T0 + DAY + 5 * DAY), 'expired');
  const reconciled = grace.reconcile(sub, { state: 'past_due', revision: 4 }, T0 + DAY + 6 * DAY);
  assert.equal(state(reconciled.subscription), 'past_due');
  assert.equal(reconciled.subscription.state_changed_at, T0 + DAY);
  assert.equal(grace.effectiveState(reconciled.subscription, T0 + DAY + 6 * DAY), 'expired');
});

test('reconciliation confirming the stored state preserves every local-only anchor (class scan)', () => {
  // Same-class scan for the :210/:211 root: the confirm path must keep every field the provider
  // view does not carry (trial marker, grace anchor, dispute restoration pointer) while still
  // updating the fields the view does carry (period end, revision).
  const grace = createSubscriptionStateMachine({ pastDueGraceMs: 5 * DAY });
  let sub = grace.apply(grace.emptySubscription('s'), ev('c0', 'checkout.completed', { provider_revision: 1 })).subscription;
  sub = grace.apply(sub, ev('c1', 'payment.succeeded', { provider_revision: 2, current_period_end: T0 + 30 * DAY })).subscription;
  sub = grace.apply(sub, ev('c2', 'renewal.failed', { provider_revision: 3, occurred_at: T0 + DAY })).subscription;
  const confirmedWithNewPeriod = grace.reconcile(sub, { state: 'past_due', current_period_end: T0 + 40 * DAY, revision: 4 }, T0 + DAY + 6 * DAY);
  assert.equal(confirmedWithNewPeriod.outcome, 'applied');
  assert.equal(state(confirmedWithNewPeriod.subscription), 'past_due');
  assert.equal(confirmedWithNewPeriod.subscription.state_changed_at, T0 + DAY);  // anchor kept even when the period updates
  assert.equal(confirmedWithNewPeriod.subscription.current_period_end, T0 + 40 * DAY);

  const disputed = machine.apply(activeWithEnd(T0 + 30 * DAY), ev('d1', 'dispute.opened', { provider_revision: 7 })).subscription;
  assert.equal(disputed.previous_state, 'active');
  const disputedConfirmed = machine.reconcile(disputed, { state: 'disputed', revision: 8 }, T0 + DAY);
  assert.equal(disputedConfirmed.subscription.previous_state, 'active');  // restoration pointer kept on confirm
  assert.equal(disputedConfirmed.subscription.revision, 8);               // view-carried revision still updates
  assert.equal(disputedConfirmed.outcome, 'no_difference');
});

// Codex 3차 인라인 지적 수리 (head 77f8969) — Refs #104.

test('dispute.won restore keeps the original grace anchor so an exhausted past_due grace stays expired', () => {
  // Codex P2 :154 — with pastDueGraceMs configured, past_due -> dispute.opened -> dispute.won
  // restores the prior state; the restore must carry back the original failure timestamp, or the
  // already-exhausted grace restarts without any successful payment.
  const grace = createSubscriptionStateMachine({ pastDueGraceMs: 5 * DAY });
  let sub = grace.apply(grace.emptySubscription('s'), ev('p0', 'checkout.completed', { provider_revision: 1 })).subscription;
  sub = grace.apply(sub, ev('p1', 'payment.succeeded', { provider_revision: 2, current_period_end: T0 + 30 * DAY })).subscription;
  sub = grace.apply(sub, ev('p2', 'renewal.failed', { provider_revision: 3, occurred_at: T0 + DAY })).subscription;
  assert.equal(state(sub), 'past_due');
  assert.equal(grace.effectiveState(sub, T0 + DAY + 5 * DAY), 'expired');  // grace exhausted
  const opened = grace.apply(sub, ev('p3', 'dispute.opened', { provider_revision: 4, occurred_at: T0 + DAY + 6 * DAY }));
  assert.equal(state(opened.subscription), 'disputed');
  assert.equal(opened.subscription.previous_state, 'past_due');
  assert.equal(opened.subscription.previous_state_changed_at, T0 + DAY);
  const won = grace.apply(opened.subscription, ev('p4', 'dispute.won', { provider_revision: 5, occurred_at: T0 + DAY + 7 * DAY }));
  assert.equal(won.outcome, 'applied');
  assert.equal(state(won.subscription), 'past_due');
  assert.equal(won.subscription.state_changed_at, T0 + DAY);  // original anchor restored, not the won time
  assert.equal(grace.effectiveState(won.subscription, T0 + DAY + 7 * DAY), 'expired');  // no grace restart
});

test('reconciliation restoring the pre-dispute state carries back the original grace anchor', () => {
  // Codex P2 :248 — a dispute resolved through the reconciliation view (e.g. a revision-less
  // resolution routed here) must restore the saved anchor like dispute.won does, or the
  // exhausted past_due grace restarts without a successful payment.
  const grace = createSubscriptionStateMachine({ pastDueGraceMs: 5 * DAY });
  let sub = grace.apply(grace.emptySubscription('s'), ev('r0', 'checkout.completed', { provider_revision: 1 })).subscription;
  sub = grace.apply(sub, ev('r1', 'payment.succeeded', { provider_revision: 2, current_period_end: T0 + 30 * DAY })).subscription;
  sub = grace.apply(sub, ev('r2', 'renewal.failed', { provider_revision: 3, occurred_at: T0 + DAY })).subscription;
  assert.equal(state(sub), 'past_due');
  assert.equal(grace.effectiveState(sub, T0 + DAY + 6 * DAY), 'expired');  // grace exhausted before the dispute opens
  const opened = grace.apply(sub, ev('r3', 'dispute.opened', { provider_revision: 4, occurred_at: T0 + DAY + 6 * DAY }));
  assert.equal(state(opened.subscription), 'disputed');
  assert.equal(opened.subscription.previous_state, 'past_due');
  assert.equal(opened.subscription.previous_state_changed_at, T0 + DAY);
  const restored = grace.reconcile(opened.subscription, { state: 'past_due', revision: 5 }, T0 + DAY + 7 * DAY);
  assert.equal(restored.outcome, 'applied');
  assert.equal(state(restored.subscription), 'past_due');
  assert.equal(restored.subscription.state_changed_at, T0 + DAY);  // saved anchor, not the reconcile time
  assert.equal(grace.effectiveState(restored.subscription, T0 + DAY + 7 * DAY), 'expired');  // no grace restart
});

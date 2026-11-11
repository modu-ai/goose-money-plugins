// Pure subscription/payment event state machine tests (issue #104, design docs/design/subscription-state-machine.md S1-S14).
// Provider-free: verified events only, no provider call, no persistence, no real signature check (S8/S9 live in entitlement.test.ts, Refs #7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscriptionStateMachine, createSubscriptionEventProcessor, SUBSCRIPTION_STATES, type StoredSubscription, type ProviderEventType } from '../src/subscription-state-machine.js';

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

test('out-of-table combinations keep the state and request the provider view', () => {
  // Design §4 row "표에 없는 (상태, 사건) 조합" + P2 :189: the combination is recorded, the event
  // is marked seen, and the outcome requests the reconciliation view instead of dead-ending.
  const end = T0 + 30 * DAY;
  let sub = machine.apply(activeWithEnd(end), ev('e2', 'refund.succeeded', { provider_revision: 3, refund_scope: 'full' })).subscription;
  assert.equal(state(sub), 'refunded');
  const r = machine.apply(sub, ev('e5', 'renewal.succeeded', { provider_revision: 4, current_period_end: end + 30 * DAY }));
  assert.equal(r.outcome, 'reconcile_required');
  assert.equal(state(r.subscription), 'refunded');
  assert.equal(r.subscription.unhandled.at(-1)?.reason, 'out_of_table_reconcile');
  assert.ok(r.subscription.applied_event_ids.includes('e5'));
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

  const live = machine.apply(activeWithEnd(end), ev('e4', 'checkout.completed', { provider_revision: 3, occurred_at: end - DAY }));
  assert.equal(live.outcome, 'reconcile_required');  // out-of-table: requests the provider view (:189)
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
  const checkout = machine.apply(disputed, ev('e3', 'checkout.completed', { provider_revision: 4, occurred_at: end + DAY }));
  assert.equal(checkout.outcome, 'reconcile_required');  // out-of-table: requests the provider view (:189)
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

test('reconciliation restoring a pre-dispute trialing state keeps the trial settlement marker', () => {
  // Codex P2 :251 — dispute.opened after trial.ended, then the dispute resolved through the
  // reconciliation view: the restoration must carry the marker back like dispute.won does, or
  // the settling payment lands unhandled and the subscription stays trialing.
  let sub = machine.apply(empty(), ev('x0', 'checkout.completed', { provider_revision: 1 })).subscription;
  sub = machine.apply(sub, ev('x1', 'payment.succeeded', { provider_revision: 2, trial: true })).subscription;
  sub = machine.apply(sub, ev('x2', 'trial.ended', { provider_revision: 3, occurred_at: T0 + 7 * DAY })).subscription;
  assert.equal(sub.trial_ended, true);
  const opened = machine.apply(sub, ev('x3', 'dispute.opened', { provider_revision: 4 }));
  assert.equal(state(opened.subscription), 'disputed');
  assert.equal(opened.subscription.trial_ended, true);
  const restored = machine.reconcile(opened.subscription, { state: 'trialing', revision: 5 }, T0 + 8 * DAY);
  assert.equal(restored.outcome, 'applied');
  assert.equal(state(restored.subscription), 'trialing');
  assert.equal(restored.subscription.trial_ended, true);
  const paid = machine.apply(restored.subscription, ev('x4', 'payment.succeeded', { provider_revision: 6, occurred_at: T0 + 9 * DAY }));
  assert.equal(paid.outcome, 'applied');
  assert.equal(state(paid.subscription), 'active');
});

test('reconciliation entering a dispute keeps the trial settlement marker for the later restore', () => {
  // Codex P2 :251 — a missed dispute opening adopted from trialing must capture the marker the
  // way dispute.opened does, or neither dispute.won nor a reconciled restore can settle the
  // payment afterwards.
  let sub = machine.apply(empty(), ev('y0', 'checkout.completed', { provider_revision: 1 })).subscription;
  sub = machine.apply(sub, ev('y1', 'payment.succeeded', { provider_revision: 2, trial: true })).subscription;
  sub = machine.apply(sub, ev('y2', 'trial.ended', { provider_revision: 3, occurred_at: T0 + 7 * DAY })).subscription;
  const adopted = machine.reconcile(sub, { state: 'disputed', revision: 4 }, T0 + 8 * DAY);
  assert.equal(state(adopted.subscription), 'disputed');
  assert.equal(adopted.subscription.previous_state, 'trialing');
  assert.equal(adopted.subscription.trial_ended, true);
  const won = machine.apply(adopted.subscription, ev('y3', 'dispute.won', { provider_revision: 5, occurred_at: T0 + 9 * DAY }));
  assert.equal(won.outcome, 'applied');
  assert.equal(state(won.subscription), 'trialing');
  assert.equal(won.subscription.trial_ended, true);
  const paid = machine.apply(won.subscription, ev('y4', 'payment.succeeded', { provider_revision: 6, occurred_at: T0 + 10 * DAY }));
  assert.equal(paid.outcome, 'applied');
  assert.equal(state(paid.subscription), 'active');
});

test('a revision-less event with no local transition still requires the provider view', () => {
  // Codex P2 :182 — payment.succeeded arriving before its checkout must not be finalised as
  // unhandled (the event id is marked seen forever); the provider view decides instead.
  const before = machine.apply(empty(), ev('z0', 'payment.succeeded'));
  assert.equal(before.outcome, 'reconcile_required');
  assert.equal(state(before.subscription), 'none');
  assert.ok(before.subscription.applied_event_ids.includes('z0'));  // seen, replay-safe
  const aligned = machine.reconcile(before.subscription, { state: 'pending', revision: 1 }, T0 + DAY);
  assert.equal(state(aligned.subscription), 'pending');
});

test('a revision-less trial settlement never dead-ends in unhandled', () => {
  // Codex P2 :182 — trial.ended without a revision routes to the view without setting the
  // marker; when the view only confirms trialing, the settling payment must still route to the
  // view instead of being recorded as an unhandled combination.
  let sub = machine.apply(empty(), ev('w0', 'checkout.completed', { provider_revision: 1 })).subscription;
  sub = machine.apply(sub, ev('w1', 'payment.succeeded', { provider_revision: 2, trial: true })).subscription;
  const ended = machine.apply(sub, ev('w2', 'trial.ended'));
  assert.equal(ended.outcome, 'reconcile_required');
  assert.equal(state(ended.subscription), 'trialing');
  assert.equal(ended.subscription.trial_ended, false);
  const confirmed = machine.reconcile(ended.subscription, { state: 'trialing', revision: 3 }, T0 + 8 * DAY);
  assert.equal(state(confirmed.subscription), 'trialing');
  assert.equal(confirmed.subscription.trial_ended, false);
  const paid = machine.apply(confirmed.subscription, ev('w3', 'payment.succeeded'));
  assert.equal(paid.outcome, 'reconcile_required');
  assert.equal(state(paid.subscription), 'trialing');
});

test('an early revisioned payment before its checkout requests the view and never dead-ends', () => {
  // Codex P2 :189 — payment.succeeded (rev 2) arriving before checkout (rev 1): the out-of-table
  // combo is marked seen AND requests reconciliation, so the caller can align with the provider
  // instead of leaving a paid subscription stuck in pending behind a duplicate_ignored replay.
  const early = machine.apply(empty(), ev('v0', 'payment.succeeded', { provider_revision: 2 }));
  assert.equal(early.outcome, 'reconcile_required');
  assert.equal(state(early.subscription), 'none');
  const checkedOut = machine.apply(early.subscription, ev('v1', 'checkout.completed', { provider_revision: 1 }));
  assert.equal(state(checkedOut.subscription), 'pending');
  const replay = machine.apply(checkedOut.subscription, ev('v0', 'payment.succeeded', { provider_revision: 2 }));
  assert.equal(replay.outcome, 'duplicate_ignored');
  const aligned = machine.reconcile(checkedOut.subscription, { state: 'active', revision: 3 }, T0 + DAY);
  assert.equal(state(aligned.subscription), 'active');  // the provider view completes the settlement
});

test('a new checkout does not inherit the expired period', () => {
  // Codex P2 :118 — the old subscription's period must not survive into the new pending: carrying
  // it made the pending state effectively expired (repeat checkouts accepted, settlement reported
  // expired). Only a period the event itself states survives the checkout.
  const end = T0 + 30 * DAY;
  let sub = machine.apply(activeWithEnd(end), ev('k0', 'checkout.completed', { provider_revision: 3, occurred_at: end + DAY })).subscription;
  assert.equal(state(sub), 'pending');
  assert.equal(sub.current_period_end, null);
  assert.equal(machine.effectiveState(sub, end + 2 * DAY), 'pending');  // no immediate expiry
  const paid = machine.apply(sub, ev('k1', 'payment.succeeded', { provider_revision: 4, occurred_at: end + 2 * DAY }));
  assert.equal(paid.outcome, 'applied');
  assert.equal(state(paid.subscription), 'active');
  const explicit = machine.apply(activeWithEnd(end), ev('k2', 'checkout.completed', { provider_revision: 5, occurred_at: end + DAY, current_period_end: end + 40 * DAY }));
  assert.equal(explicit.subscription.current_period_end, end + 40 * DAY);  // event-supplied period kept
});

test('the processor exposes reconciliation through the same per-subscription queue', async () => {
  // Codex P2 :283 — a reconcile_required outcome (revision-less checkout) has no recovery path on
  // the default in-memory store unless the processor can install the reconciled record itself.
  const proc = createSubscriptionEventProcessor();
  const routed = await proc.submit('s', ev('q0', 'checkout.completed'));
  assert.equal(routed.outcome, 'reconcile_required');
  const reconciled = await proc.reconcile('s', { state: 'active', revision: 1 }, T0 + DAY);
  assert.equal(reconciled.outcome, 'applied');
  assert.equal(state(proc.get('s')!), 'active');  // the store now holds the reconciled record
  const cancel = await proc.submit('s', ev('q1', 'subscription.cancel_requested', { provider_revision: 2 }));
  assert.equal(cancel.outcome, 'applied');  // revisioned events transition normally afterwards
  assert.equal(state(cancel.subscription), 'canceled_pending_end');
});

test('reconciliation starting a new checkout clears the expired period like apply does', () => {
  // Codex P2 :259 — a revision-less checkout routes to the view without committing the transition;
  // a confirming pending view (no period stated) must not inherit the expired period.
  const end = T0 + 30 * DAY;
  let sub = activeWithEnd(end);
  sub = machine.apply(sub, ev('m0', 'checkout.completed', { occurred_at: end + DAY })).subscription;  // revision-less → routed
  assert.equal(state(sub), 'active');  // unchanged, waiting for the view
  const adopted = machine.reconcile(sub, { state: 'pending', revision: 5 }, end + 2 * DAY);
  assert.equal(adopted.outcome, 'applied');
  assert.equal(state(adopted.subscription), 'pending');
  assert.equal(adopted.subscription.current_period_end, null);
  assert.equal(machine.effectiveState(adopted.subscription, end + 3 * DAY), 'pending');
});

test('a reconciled replacement checkout restarts the pending timeout', () => {
  // Codex P2 :225 — a timed-out pending confirmed as pending by a view with an ADVANCED revision
  // is a replacement checkout: the timeout anchor restarts, or the new checkout stays effectively
  // none immediately and further checkout events remain eligible.
  const timed = createSubscriptionStateMachine({ pendingTimeoutMs: 100 });
  let sub = timed.apply(timed.emptySubscription('s'), ev('t0', 'checkout.completed', { provider_revision: 1 })).subscription;
  assert.equal(timed.effectiveState(sub, T0 + 1000), 'none');  // anchor 0 + 100 <= 1000
  const routed = timed.apply(sub, ev('t1', 'checkout.completed', { occurred_at: T0 + 1200 }));  // revision-less → view
  assert.equal(routed.outcome, 'reconcile_required');
  const confirmed = timed.reconcile(routed.subscription, { state: 'pending', revision: 2 }, T0 + 1200);
  assert.equal(confirmed.outcome, 'no_difference');
  assert.equal(confirmed.subscription.state_changed_at, T0 + 1200);  // evidence: revision 1 → 2
  assert.equal(timed.effectiveState(confirmed.subscription, T0 + 1200), 'pending');
});

test('an unchanged pending snapshot does not revive an abandoned checkout', () => {
  // Codex P2 :225 (2차) — same-revision confirmation carries no replacement evidence: periodic
  // reconciliation must not reverse effective none back to pending.
  const timed = createSubscriptionStateMachine({ pendingTimeoutMs: 100 });
  let sub = timed.apply(timed.emptySubscription('s'), ev('u0', 'checkout.completed', { provider_revision: 1 })).subscription;
  assert.equal(timed.effectiveState(sub, T0 + 1000), 'none');
  const same = timed.reconcile(sub, { state: 'pending', revision: 1 }, T0 + 1200);
  assert.equal(same.outcome, 'no_difference');
  assert.equal(same.subscription.state_changed_at, T0);  // original anchor untouched (not the reconcile time)
  assert.equal(timed.effectiveState(same.subscription, T0 + 1200), 'none');
});

test('a confirmed replacement checkout clears the expired period in reconciliation', () => {
  // Codex P2 :231 — same-state confirmation of a replacement checkout must clear a stored expired
  // period like apply() does, or the new pending stays effectively expired.
  const timed = createSubscriptionStateMachine({ pendingTimeoutMs: 100 });
  let sub = timed.apply(timed.emptySubscription('s'), ev('s0', 'checkout.completed', { provider_revision: 1, current_period_end: T0 + 200 })).subscription;
  assert.equal(timed.effectiveState(sub, T0 + 250), 'expired');  // stored period elapsed
  const routed = timed.apply(sub, ev('s1', 'checkout.completed', { occurred_at: T0 + 250 }));  // revision-less → view
  assert.equal(routed.outcome, 'reconcile_required');
  const confirmed = timed.reconcile(routed.subscription, { state: 'pending', revision: 2 }, T0 + 300);
  assert.equal(confirmed.outcome, 'applied');
  assert.equal(confirmed.subscription.state_changed_at, T0 + 300);  // replacement anchor restarted
  assert.equal(confirmed.subscription.current_period_end, null);    // old period cleared
  assert.equal(timed.effectiveState(confirmed.subscription, T0 + 300), 'pending');
});

test('a provider-confirmed expired dispute is adopted instead of looping in no_difference', () => {
  // Codex P2 :250 — a disputed record past its period end has effective expired; a provider
  // expired view used to match it and return no_difference forever, trapping the dispute (no
  // checkout, no exit). Adopting the provider's terminal state clears the dispute.
  const end = T0 + 30 * DAY;
  const disputed = machine.apply(activeWithEnd(end), ev('n0', 'dispute.opened', { provider_revision: 3 })).subscription;
  assert.equal(machine.effectiveState(disputed, end + DAY), 'expired');
  const confirmed = machine.reconcile(disputed, { state: 'expired', revision: 4 }, end + DAY);
  assert.equal(confirmed.outcome, 'applied');
  assert.equal(state(confirmed.subscription), 'expired');
  assert.equal(confirmed.subscription.previous_state, null);
  const checkout = machine.apply(confirmed.subscription, ev('n1', 'checkout.completed', { provider_revision: 5, occurred_at: end + 2 * DAY }));
  assert.equal(checkout.outcome, 'applied');  // the dispute trap is gone
  assert.equal(state(checkout.subscription), 'pending');
});

test('an expired-period replacement checkout also restarts on reconciliation', () => {
  // Codex P2 :226 — without pendingTimeoutMs a pending still expires through its stored period;
  // a confirming pending view with an advanced revision must restart the replacement checkout
  // like the timeout case does, or it stays effectively expired.
  const end = T0 + 30 * DAY;
  let sub = machine.apply(machine.emptySubscription('s'), ev('p0', 'checkout.completed', { provider_revision: 1, current_period_end: end })).subscription;
  assert.equal(state(sub), 'pending');
  assert.equal(machine.effectiveState(sub, end + DAY), 'expired');  // period elapsed, no timeout needed
  const routed = machine.apply(sub, ev('p1', 'checkout.completed', { occurred_at: end + DAY }));  // revision-less → view
  assert.equal(routed.outcome, 'reconcile_required');
  const confirmed = machine.reconcile(routed.subscription, { state: 'pending', revision: 2 }, end + DAY);
  assert.equal(confirmed.outcome, 'applied');  // the period clearing is a recorded difference
  assert.equal(confirmed.subscription.state_changed_at, end + DAY);  // anchor restarted
  assert.equal(confirmed.subscription.current_period_end, null);     // expired period cleared
  assert.equal(machine.effectiveState(confirmed.subscription, end + DAY), 'pending');
});

// Codex 미해결 지적(4530750266, P2 :235) 수리 — 설계 §5.4 N1/N3, 교체 checkout 정산 직행 경로 (Refs #104).

test('a replacement checkout settled directly clears the expired period on same-state confirmation', () => {
  // Codex 4530750266 — 저장 active(기간 만료)에서 판본 없는 교체 checkout 이후, 대사 뷰가 이미
  // 정산된 active(판번 진전, 기간 미제시)로 도달하면 중간 pending 을 관찰하지 못했다. 구기간이
  // 살아남으면 정산된 구독이 effective expired 로 갇힘(§5.4 N1: 주지 않으면 비어 시작).
  const end = T0 + 30 * DAY;
  const sub = activeWithEnd(end);
  const routed = machine.apply(sub, ev('s2', 'checkout.completed', { occurred_at: end + DAY }));
  assert.equal(routed.outcome, 'reconcile_required');
  assert.equal(state(routed.subscription), 'active');
  const settled = machine.reconcile(routed.subscription, { state: 'active', revision: 4 }, end + 2 * DAY);
  assert.equal(settled.outcome, 'applied');  // 기간 소거는 기록된 차이
  assert.equal(settled.subscription.current_period_end, null);
  assert.equal(settled.subscription.state_changed_at, end + 2 * DAY);  // 새 주기 시작 증거(N3)
  assert.equal(machine.effectiveState(settled.subscription, end + 2 * DAY), 'active');
});

test('a replacement settled through adoption also clears the expired period', () => {
  // 4530750266 의 채택 경로 형제 — 유예 소진 past_due(effective expired)를 뷰 {active, 판번 진전,
  // 기간 미제시}가 채택할 때도 구기간이 지워지지 않으면 정산 구독이 effective expired 로 남음(§5.4 N1).
  const grace = createSubscriptionStateMachine({ pastDueGraceMs: 5 * DAY });
  let sub = grace.apply(grace.emptySubscription('s'), ev('u0', 'checkout.completed', { provider_revision: 1 })).subscription;
  sub = grace.apply(sub, ev('u1', 'payment.succeeded', { provider_revision: 2, current_period_end: T0 + 30 * DAY })).subscription;
  sub = grace.apply(sub, ev('u2', 'renewal.failed', { provider_revision: 3, occurred_at: T0 + DAY })).subscription;
  assert.equal(grace.effectiveState(sub, T0 + 10 * DAY), 'expired');  // grace exhausted
  const routed = grace.apply(sub, ev('u3', 'checkout.completed', { occurred_at: T0 + 10 * DAY }));
  assert.equal(routed.outcome, 'reconcile_required');
  const settled = grace.reconcile(routed.subscription, { state: 'active', revision: 5 }, T0 + 10 * DAY);
  assert.equal(settled.outcome, 'applied');
  assert.equal(state(settled.subscription), 'active');
  assert.equal(settled.subscription.current_period_end, null);
  assert.equal(grace.effectiveState(settled.subscription, T0 + 10 * DAY), 'active');
});

test('a trial-settled replacement clears the expired period on adoption', () => {
  // 같은 결함의 체험 정산 변형 — 뷰 {trialing, 판번 진전, 기간 미제시} 채택 시 구기간 잔존은
  // trialing 을 즉시 effective expired 로 만듦(§5.4 N1).
  const end = T0 + 30 * DAY;
  const sub = activeWithEnd(end);
  const routed = machine.apply(sub, ev('v2', 'checkout.completed', { occurred_at: end + DAY }));
  assert.equal(routed.outcome, 'reconcile_required');
  const settled = machine.reconcile(routed.subscription, { state: 'trialing', revision: 4 }, end + 2 * DAY);
  assert.equal(settled.outcome, 'applied');
  assert.equal(state(settled.subscription), 'trialing');
  assert.equal(settled.subscription.current_period_end, null);
  assert.equal(machine.effectiveState(settled.subscription, end + 2 * DAY), 'trialing');
});

test('a consumed replacement marker does not clear twice', () => {
  // 소비된 교체 표지는 재대사에서 재소거·부활을 일으키지 않음(§5.2 보존, N3 증거 일회성).
  const end = T0 + 30 * DAY;
  const sub = activeWithEnd(end);
  const routed = machine.apply(sub, ev('w2', 'checkout.completed', { occurred_at: end + DAY }));
  const first = machine.reconcile(routed.subscription, { state: 'active', revision: 4 }, end + DAY);
  assert.equal(first.subscription.current_period_end, null);
  const again = machine.reconcile(first.subscription, { state: 'active', revision: 4 }, end + DAY);
  assert.equal(again.outcome, 'no_difference');
  assert.equal(again.subscription.current_period_end, null);
  assert.equal(machine.effectiveState(again.subscription, end + DAY), 'active');
});

test('a replacement view without revision advance keeps the stored period', () => {
  // §5.4 N3: 교체 판정은 판번 진전 등 증거가 있을 때만 — 동일 스냅샷 확인은 구기간을 건드리지 않음.
  const end = T0 + 30 * DAY;
  const sub = activeWithEnd(end);
  const routed = machine.apply(sub, ev('x2', 'checkout.completed', { occurred_at: end + DAY }));
  const same = machine.reconcile(routed.subscription, { state: 'active', revision: 2 }, end + 2 * DAY);
  assert.equal(same.outcome, 'no_difference');
  assert.equal(same.subscription.current_period_end, end);
  assert.equal(machine.effectiveState(same.subscription, end + 2 * DAY), 'expired');
});

test('a replacement view that states a period uses it', () => {
  // 뷰가 기간을 주면 그 값이 새 주기의 기간 — 소거가 아니라 반영(회귀 가드).
  const end = T0 + 30 * DAY;
  const sub = activeWithEnd(end);
  const routed = machine.apply(sub, ev('y2', 'checkout.completed', { occurred_at: end + DAY }));
  const settled = machine.reconcile(routed.subscription, { state: 'active', revision: 4, current_period_end: end + 30 * DAY }, end + DAY);
  assert.equal(settled.subscription.current_period_end, end + 30 * DAY);
  assert.equal(machine.effectiveState(settled.subscription, end + DAY), 'active');
});

// Codex 미답변 지적(4531973934, sm:243) 수리 — §5.4 N1 전제(정산)·N2 취지(분쟁 중 checkout 배제):
// 분쟁을 유지하는 뷰는 새 주기의 정산이 아니므로 교체 표지를 소비하지 않는다 (Refs #104).

test('a dispute-maintaining view does not consume the replacement marker on confirmation', () => {
  // 경로 A(4531973934 본체, 4532141427 로 보강) — 저장 disputed(이전 active, 구기간 보유)에서 온
  // checkout 은 비자격이라 표지를 세우지 않고(N2), 같은 disputed 로 판번만 진전한 뷰는 정산 증거가
  // 아니므로 기간·기준점을 유지(N2·N3). 지우면 dispute.won 복구 뒤 기간 없는 active 로 남아
  // 구기간 경과 후에도 유료 잔존.
  const end = T0 + 30 * DAY;
  const disputed = machine.apply(activeWithEnd(end), ev('c0', 'dispute.opened', { provider_revision: 3 })).subscription;
  assert.equal(state(disputed), 'disputed');
  const routed = machine.apply(disputed, ev('c1', 'checkout.completed', { occurred_at: end + DAY }));
  assert.equal(routed.outcome, 'reconcile_required');
  assert.equal(routed.subscription.replacement_checkout_pending, false);  // 비자격 — 증거 없음(4532141427)
  const confirmed = machine.reconcile(routed.subscription, { state: 'disputed', revision: 4 }, end + DAY);
  assert.equal(confirmed.outcome, 'no_difference');                   // 판번 진전만으로는 기록된 차이 없음
  assert.equal(confirmed.subscription.current_period_end, end);       // 구기간 보존(N1 전제 위반 않음)
  assert.equal(confirmed.subscription.state_changed_at, disputed.state_changed_at);  // 기준점 보존(N3)
  assert.equal(confirmed.subscription.replacement_checkout_pending, false); // 증거가 없으니 소비할 것도 없음
  const won = machine.apply(confirmed.subscription, ev('c2', 'dispute.won', { provider_revision: 5, occurred_at: end + 2 * DAY }));
  assert.equal(state(won.subscription), 'active');
  assert.equal(won.subscription.current_period_end, end);             // 복구 상태도 구기간과 함께
  assert.equal(machine.effectiveState(won.subscription, end + 3 * DAY), 'expired');  // 유료 접근 종료
});

test('a dispute-adopting view does not clear the live period on adoption', () => {
  // 경로 B(채택 형제) — 라이브 기간 active 에서 판본 없는 checkout 이 표지를 남긴 뒤, 뷰
  // {disputed, 판번 진전, 기간 미제시} 가 분쟁을 채택해도 구기간을 지우지 않음(N2). 지우면
  // dispute.won 복구가 기간 없는 active 를 만들어 유료 접근이 무기한이 됨.
  const end = T0 + 30 * DAY;
  const sub = activeWithEnd(end);
  const routed = machine.apply(sub, ev('d1', 'checkout.completed', { occurred_at: T0 + DAY }));
  assert.equal(routed.outcome, 'reconcile_required');
  const adopted = machine.reconcile(routed.subscription, { state: 'disputed', revision: 3 }, T0 + 2 * DAY);
  assert.equal(state(adopted.subscription), 'disputed');              // 분쟁 채택 자체는 유효(§4)
  assert.equal(adopted.subscription.previous_state, 'active');        // 복구 포착
  assert.equal(adopted.subscription.current_period_end, end);         // 구기간 보존
  const won = machine.apply(adopted.subscription, ev('d2', 'dispute.won', { provider_revision: 4, occurred_at: end - DAY }));
  assert.equal(state(won.subscription), 'active');
  assert.equal(won.subscription.current_period_end, end);             // 복구도 구기간과 함께
  assert.equal(machine.effectiveState(won.subscription, end + DAY), 'expired');  // 기간이 끝나면 유료 종료
});

// Codex 3차 지적 수리 (head 5fb2bd9) — 4532141427(비자격 checkout 의 증거 설정)·4532141436(비정산
// 채택의 표지 소비). 표지가 곧 자격: 라우트는 자격 있는 후보만 남기고, 비정산 뷰는 소비하지 않는다 (Refs #104).

test('an ineligible checkout during a dispute establishes no replacement evidence', () => {
  // Codex 4532141427 — N2 로 분쟁 중 checkout 은 수용되지 않으므로 교체 증거(표지)도 세우지 않음.
  // 이어 오는 복구 뷰 {active, 판번 진전, 기간 미제시} 는 구주기 재개(§5.2 previous_state 보존)이지
  // 새 주기 정산이 아님 — 증거가 있으면 복구가 기간을 소거해 기간 없는 active 로 유료 잔존.
  const end = T0 + 30 * DAY;
  const disputed = machine.apply(activeWithEnd(end), ev('f0', 'dispute.opened', { provider_revision: 3 })).subscription;
  const routed = machine.apply(disputed, ev('f1', 'checkout.completed', { occurred_at: end + DAY }));
  assert.equal(routed.outcome, 'reconcile_required');
  assert.equal(routed.subscription.replacement_checkout_pending, false);  // 비자격 — 증거 없음(N2)
  const restored = machine.reconcile(routed.subscription, { state: 'active', revision: 4 }, end + 2 * DAY);
  assert.equal(state(restored.subscription), 'active');                    // 복구 자체는 유효(§4)
  assert.equal(restored.subscription.current_period_end, end);             // 구주기 재개 — 기간 보존
  assert.equal(machine.effectiveState(restored.subscription, end + 3 * DAY), 'expired');  // 유료 종료
});

test('a non-settled adoption preserves the replacement marker for the settling view', () => {
  // Codex 4532141436 — 분쟁 채택 뷰는 교체 질문에 답하지 않으므로 표지를 소비하지 않음(§5.2 보존
  // 이유·N3). 만료 active 에서 자격 있는 후보가 라우트된 뒤 정산 뷰 {active, 판번 진전, 기간 미제시}가
  // 증거를 소비해 구기간을 비워야 정산 구독이 effective expired 로 갇히지 않음(§5.4 N1).
  const end = T0 + 30 * DAY;
  const sub = activeWithEnd(end);
  const routed = machine.apply(sub, ev('g1', 'checkout.completed', { occurred_at: end + DAY }));
  assert.equal(routed.outcome, 'reconcile_required');
  assert.equal(routed.subscription.replacement_checkout_pending, true);    // 자격 있는 후보 — 증거 유지
  const disputed = machine.reconcile(routed.subscription, { state: 'disputed', revision: 3 }, end + DAY);
  assert.equal(state(disputed.subscription), 'disputed');                  // 분쟁 채택 자체는 유효(§4)
  assert.equal(disputed.subscription.replacement_checkout_pending, true);  // 비정산 채택 — 표지 유지
  const settled = machine.reconcile(disputed.subscription, { state: 'active', revision: 4 }, end + 2 * DAY);
  assert.equal(state(settled.subscription), 'active');                     // 복구를 겸한 정산 뷰
  assert.equal(settled.subscription.current_period_end, null);             // N1 — 증거 소비, 구기간 소거
  assert.equal(machine.effectiveState(settled.subscription, end + 2 * DAY), 'active');
});

// Codex 4차 지적 수리 (head ee24ece) — 4532228592(비정산 사건 전이의 표지 소거). 분쟁 생애주기 사건은
// 교체 질문에 답하지 않으므로 표지를 유지한다 (Refs #104).

test('a dispute event round-trip preserves the replacement marker for the settling view', () => {
  // Codex 4532228592 — 만료 active 의 자격 있는 checkout 후보가 라우트된 뒤, 적용되는 dispute.opened
  // 가 next() 에서 표지를 지워서는 안 됨(§5.2·N3 — 전이 적용 ≠ 교체 정산). 분쟁 왕복 뒤 정산 뷰
  // {active, 판번 진전, 기간 미제시} 가 증거를 소비해 구기간을 비워야 정산 구독이 갇히지 않음(§5.4 N1).
  const end = T0 + 30 * DAY;
  const sub = activeWithEnd(end);
  const routed = machine.apply(sub, ev('h1', 'checkout.completed', { occurred_at: end + DAY }));
  assert.equal(routed.outcome, 'reconcile_required');
  assert.equal(routed.subscription.replacement_checkout_pending, true);
  const opened = machine.apply(routed.subscription, ev('h2', 'dispute.opened', { provider_revision: 3, occurred_at: end + DAY }));
  assert.equal(state(opened.subscription), 'disputed');
  assert.equal(opened.subscription.replacement_checkout_pending, true);   // 비정산 전이 — 표지 유지
  const won = machine.apply(opened.subscription, ev('h3', 'dispute.won', { provider_revision: 4, occurred_at: end + 2 * DAY }));
  assert.equal(state(won.subscription), 'active');
  assert.equal(won.subscription.replacement_checkout_pending, true);      // 복구도 질문에 답하지 않음
  assert.equal(won.subscription.current_period_end, end);                 // 구주기 재개
  const settled = machine.reconcile(won.subscription, { state: 'active', revision: 5 }, end + 2 * DAY);
  assert.equal(settled.subscription.current_period_end, null);            // N1 — 증거 소비, 구기간 소거
  assert.equal(settled.subscription.replacement_checkout_pending, false);
  assert.equal(machine.effectiveState(settled.subscription, end + 2 * DAY), 'active');
});

test('marker invariant table: every stored×view×marker cell pins clearing and consumption', () => {
  // 되풀이 끊기 — 같은 영역(표지·분쟁 뷰)의 지적이 4회 반복돼, 대사 조합 전수를 불변식으로 고정한다.
  // 전제: 기간 라이브(now < end)·뷰 판번 진전(revision 3 > 2)·기간 미제시. 불변식:
  //   A(§5.4 N1) 기간이 소거(null)되려면 뷰가 pending(진행 중 checkout 채택)이거나 정산 증거
  //      (표지 있음 + 뷰 정산 상태)여야 한다. 그 외엔 구기간이 그대로다.
  //   B(§5.2·N3) 표지를 소비하는 것은 정산 상태 뷰뿐 — 비정산 뷰는 표지를 유지한다.
  //   C(§5.2 previous_state) 분쟁 복구 채택(disputed→active)은 기준점을 구주기 값으로 되돌린다.
  const settledView = (s: string) => s === 'pending' || s === 'trialing' || s === 'active';
  const end = T0 + 30 * DAY;
  for (const marker of [false, true]) {
    for (const stored of SUBSCRIPTION_STATES) {
      for (const view of SUBSCRIPTION_STATES) {
        const cell = `stored=${stored} view=${view} marker=${marker}`;
        const sub: StoredSubscription = {
          ...empty('table'),
          state: stored,
          current_period_end: end,
          revision: 2,
          previous_state: 'active',
          previous_state_changed_at: T0,
          replacement_checkout_pending: marker,
          state_changed_at: T0,
          last_event_at: T0,
        };
        const out = machine.reconcile(sub, { state: view, revision: 3 }, T0);
        if (out.subscription.current_period_end === null) {
          assert.ok(view === 'pending' || (marker && settledView(view)), `기간 소거에 증거 없음: ${cell}`);
        } else {
          assert.equal(out.subscription.current_period_end, end, `구기간이 함부로 바뀜: ${cell}`);
        }
        assert.equal(out.subscription.replacement_checkout_pending, marker && !settledView(view), `표지 소비 위반: ${cell}`);
        if (stored === 'disputed' && view === 'active') {
          assert.equal(out.subscription.state_changed_at, T0, `분쟁 복구 기준점 위반: ${cell}`);
        }
      }
    }
  }
  // 사건 전이 측면(4532228592): 분쟁 생애주기 사건은 표지를 소비하지 않는다.
  for (const from of ['active', 'trialing', 'canceled_pending_end', 'past_due'] as const) {
    const sub: StoredSubscription = { ...empty('table'), state: from, current_period_end: end, replacement_checkout_pending: true, state_changed_at: T0, last_event_at: T0 };
    const opened = machine.apply(sub, ev('t-open', 'dispute.opened', { provider_revision: 3 }));
    assert.equal(opened.subscription.replacement_checkout_pending, true, `dispute.opened 이 표지 소거: ${from}`);
  }
  const disputed: StoredSubscription = { ...empty('table'), state: 'disputed', current_period_end: end, previous_state: 'active', previous_state_changed_at: T0, replacement_checkout_pending: true, state_changed_at: T0, last_event_at: T0 };
  for (const won of [
    machine.apply(disputed, ev('t-won', 'dispute.won', { provider_revision: 3 })),
    machine.apply(disputed, ev('t-lost', 'dispute.lost', { provider_revision: 3 })),
  ]) {
    assert.equal(won.subscription.replacement_checkout_pending, true, '분쟁 종결 전이가 표지 소거');
  }
});

test('an equal-revision event still applies the transition (current behavior, B-11 pending)', () => {
  // 설계 §5.1 P3("저장 판본 이하" 기록만)과 §5 순서 역전 행("오래된"=엄격히 이전)의 경계가
  // 어긋나 동일 판번 처우는 B-11 결정 필요. 결정 전까지 현재 동작 — 엄격히 이전만 기록-only,
  // 동일 판번은 전이 적용 — 을 고정한다(동작 변경은 B-11 결정 후).
  let sub = machine.apply(empty(), ev('b0', 'checkout.completed', { provider_revision: 2 })).subscription;
  sub = machine.apply(sub, ev('b1', 'payment.succeeded', { provider_revision: 2 })).subscription;
  assert.equal(state(sub), 'active');
  assert.equal(sub.revision, 2);
  const equal = machine.apply(sub, ev('b2', 'subscription.cancel_requested', { provider_revision: 2, occurred_at: T0 + DAY }));
  assert.equal(equal.outcome, 'applied');
  assert.equal(state(equal.subscription), 'canceled_pending_end');
});

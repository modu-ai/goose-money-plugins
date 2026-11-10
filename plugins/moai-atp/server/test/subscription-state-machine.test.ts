// Pure subscription/payment event state machine tests (issue #104, design docs/design/subscription-state-machine.md S1-S14).
// Provider-free: verified events only, no provider call, no persistence, no real signature check (S8/S9 live in entitlement.test.ts, Refs #7).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSubscriptionStateMachine, createSubscriptionEventProcessor, type StoredSubscription, type ProviderEventType} from '../src/subscription-state-machine.js';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;
const machine = createSubscriptionStateMachine();
const empty = (id = 'sub-1') => machine.emptySubscription(id);
const state = (sub: StoredSubscription) => sub.state;
const ev = (id: string, type: ProviderEventType, extra: Record<string, unknown> = {}) => ({
  event_id: id, type, occurred_at: T0, verified_signature: true as const, ...extra,
});
function activeWithEnd(end: number): StoredSubscription {
  const checkedOut = machine.apply(empty(), ev('e0', 'checkout.completed')).subscription;
  return machine.apply(checkedOut, ev('e1', 'payment.succeeded', {current_period_end: end})).subscription;
}
function deferred<T>(): {promise: Promise<T>; resolve: (v: T) => void} {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((done) => {resolve = done;});
  return {promise, resolve};
}

test('S1 duplicate payment.succeeded transitions once', () => {
  const first = machine.apply(machine.apply(empty(), ev('e0', 'checkout.completed')).subscription, ev('e1', 'payment.succeeded'));
  assert.equal(state(first.subscription), 'active');
  const again = machine.apply(first.subscription, ev('e1', 'payment.succeeded'));
  assert.equal(again.outcome, 'duplicate_ignored');
  assert.equal(state(again.subscription), 'active');
  assert.equal(again.subscription.applied_event_ids.length, first.subscription.applied_event_ids.length);
});

test('S2 stale revision is recorded and never reverts the state', () => {
  let sub = machine.apply(empty(), ev('e0', 'checkout.completed', {provider_revision: 3})).subscription;
  assert.equal(state(sub), 'pending');
  const stale = machine.apply(sub, ev('e1', 'payment.failed', {occurred_at: T0 - 1000, provider_revision: 1}));
  assert.equal(stale.outcome, 'stale_recorded');
  assert.equal(state(stale.subscription), 'pending');
  assert.equal(stale.subscription.unhandled.at(-1)?.reason, 'stale_event_revision');
  sub = machine.apply(stale.subscription, ev('e2', 'payment.succeeded', {provider_revision: 4})).subscription;
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
  const unverified = machine.apply(sub, {...ev('e1', 'payment.succeeded'), verified_signature: false});
  assert.equal(unverified.outcome, 'rejected');
  assert.equal(state(unverified.subscription), 'none');
  const unsigned = machine.apply(sub, {event_id: 'e2', type: 'payment.succeeded', occurred_at: T0});
  assert.equal(unsigned.outcome, 'rejected');
  assert.equal(state(unsigned.subscription), 'none');
});

test('S5 checkout redirect parameters are not provider events', () => {
  const bad = machine.apply(empty(), {success: true, subscription_id: 'sub-1'});
  assert.equal(bad.outcome, 'rejected');
  assert.equal(state(bad.subscription), 'none');
});

test('S6 cancel keeps paid access until the stored period end', () => {
  const end = T0 + 30 * DAY;
  let sub = machine.apply(activeWithEnd(end), ev('e2', 'subscription.cancel_requested', {occurred_at: T0})).subscription;
  assert.equal(state(sub), 'canceled_pending_end');
  assert.equal(machine.effectiveState(sub, end - 1), 'canceled_pending_end');
  assert.equal(machine.effectiveState(sub, end + 1), 'expired');
  sub = machine.apply(sub, ev('e3', 'subscription.resumed', {occurred_at: end - 2 * DAY})).subscription;
  assert.equal(state(sub), 'active');
});

test('S7 full refund ends paid access immediately; undecided refund scope stays unhandled', () => {
  const sub = activeWithEnd(T0 + 30 * DAY);
  const unspecced = machine.apply(sub, ev('e2', 'refund.succeeded'));
  assert.equal(unspecced.outcome, 'unhandled_recorded');
  assert.equal(unspecced.subscription.unhandled.at(-1)?.reason, 'refund_scope_unsupported');
  assert.equal(state(unspecced.subscription), 'active');
  const refunded = machine.apply(unspecced.subscription, ev('e3', 'refund.succeeded', {refund_scope: 'full'}));
  assert.equal(state(refunded.subscription), 'refunded');
  assert.equal(machine.effectiveState(refunded.subscription, T0 + 1), 'refunded');
});

test('S11 same-subscription events apply serially even when loads overlap', async () => {
  const store = new Map<string, StoredSubscription>();
  const gate = deferred<void>();
  const proc = createSubscriptionEventProcessor({
    load: async (id) => {await gate.promise; return store.get(id);},
    save: async (sub) => {store.set(sub.subscription_id, sub);},
  });
  const first = proc.submit('sub-1', ev('e0', 'checkout.completed'));
  const second = proc.submit('sub-1', ev('e1', 'payment.succeeded'));
  gate.resolve();
  const [r1, r2] = await Promise.all([first, second]);
  assert.equal(r1.outcome, 'applied');
  assert.equal(r2.outcome, 'applied');
  assert.equal(state(store.get('sub-1')!), 'active');
});

test('S12 reconciliation adopts the provider view and records the difference', () => {
  const sub = activeWithEnd(T0 + 30 * DAY);
  const differing = machine.reconcile(sub, {state: 'canceled_pending_end', current_period_end: T0 + 30 * DAY, revision: 9}, T0 + 1);
  assert.equal(differing.subscription.state, 'canceled_pending_end');
  assert.equal(differing.subscription.revision, 9);
  assert.equal(differing.subscription.unhandled.at(-1)?.reason, 'reconcile_adopted_provider');
  const same = machine.reconcile(differing.subscription, {state: 'canceled_pending_end', current_period_end: T0 + 30 * DAY, revision: 9}, T0 + 1);
  assert.equal(same.outcome, 'no_difference');
  const staleProvider = machine.reconcile(differing.subscription, {state: 'active', revision: 1}, T0 + 1);
  assert.equal(staleProvider.outcome, 'provider_stale');
  assert.equal(state(staleProvider.subscription), 'canceled_pending_end');
});

test('S13 no payment instrument raw data is accepted or stored', () => {
  const sub = activeWithEnd(T0 + 30 * DAY);
  const r = machine.apply(sub, {...ev('e9', 'payment.succeeded'), card_number: '4111111111111111'});
  assert.equal(r.outcome, 'rejected');
  assert.ok(!JSON.stringify(r.subscription).includes('4111'));
});

test('S14 renewal failure then late retry succeeds with no unhandled combinations', () => {
  const end1 = T0 + 30 * DAY;
  let sub = machine.apply(activeWithEnd(end1), ev('e2', 'renewal.failed', {occurred_at: end1 - DAY})).subscription;
  assert.equal(state(sub), 'past_due');
  const retry = machine.apply(sub, ev('e3', 'renewal.succeeded', {occurred_at: end1 + DAY, current_period_end: T0 + 60 * DAY}));
  assert.equal(retry.outcome, 'applied');
  assert.equal(state(retry.subscription), 'active');
  assert.equal(retry.subscription.current_period_end, T0 + 60 * DAY);
  assert.equal(retry.subscription.unhandled.length, 0);
  assert.equal(retry.subscription.applied_event_ids.filter((id) => id === 'e3').length, 1);
});

test('trial path follows the transition table and keeps the undecided failure target undecided', () => {
  let sub = machine.apply(empty(), ev('e0', 'checkout.completed')).subscription;
  sub = machine.apply(sub, ev('e1', 'payment.succeeded', {trial: true})).subscription;
  assert.equal(state(sub), 'trialing');
  sub = machine.apply(sub, ev('e2', 'trial.ended', {occurred_at: T0 + 7 * DAY})).subscription;
  assert.equal(sub.trial_ended, true);
  assert.equal(state(sub), 'trialing');
  const unconfigured = machine.apply(sub, ev('e3', 'payment.failed'));
  assert.equal(unconfigured.outcome, 'unhandled_recorded');
  assert.equal(unconfigured.subscription.unhandled.at(-1)?.reason, 'trial_end_failure_target_unconfigured');
  const configured = createSubscriptionStateMachine({trialEndFailureTarget: 'past_due'});
  const pastDue = configured.apply(sub, ev('e3', 'payment.failed'));
  assert.equal(state(pastDue.subscription), 'past_due');
  const recovered = configured.apply(pastDue.subscription, ev('e4', 'payment.succeeded', {current_period_end: T0 + 37 * DAY}));
  assert.equal(state(recovered.subscription), 'active');
});

test('pending timeout expires only when the grace value is injected', () => {
  const sub = machine.apply(empty(), ev('e0', 'checkout.completed')).subscription;
  assert.equal(machine.effectiveState(sub, T0 + 10 * DAY), 'pending');
  const timed = createSubscriptionStateMachine({pendingTimeoutMs: 5 * DAY});
  assert.equal(timed.effectiveState(sub, T0 + 6 * DAY), 'none');
});

test('unhandled combinations keep the state and are recorded', () => {
  const end = T0 + 30 * DAY;
  let sub = machine.apply(activeWithEnd(end), ev('e2', 'refund.succeeded', {refund_scope: 'full'})).subscription;
  assert.equal(state(sub), 'refunded');
  const r = machine.apply(sub, ev('e5', 'renewal.succeeded', {current_period_end: end + 30 * DAY}));
  assert.equal(r.outcome, 'unhandled_recorded');
  assert.equal(state(r.subscription), 'refunded');
  assert.equal(r.subscription.unhandled.at(-1)?.reason, 'unhandled_combination');
});

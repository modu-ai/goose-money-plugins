import {z} from 'zod';
// Stage 1 pure service-entitlement evaluator (Refs #7, decisions in #5). Inputs:
// verified identity, per-service membership, subscription state (+ stored period end),
// learner grant period, requested feature. Output: allow/deny plus a reason code.
// No prices, quotas or provider readiness here: free/excluded feature sets and the
// paid-granting subscription states are injected configuration (undecided values stay
// undecided), and provider checks stay a separate axis. Not wired into server.ts or
// goose-routing.ts; wiring is a later PR after the real ID integration (#6).
const subscriptionStates=['none','pending','trialing','active','past_due','canceled_pending_end','expired','refunded','disputed'] as const;
type SubscriptionState=typeof subscriptionStates[number];
const membershipStates=['joined','not_joined','suspended','withdrawn'] as const;
const featureId=/^[A-Z]{1,8}[0-9]{1,4}$/;
const identitySchema=z.object({verified:z.boolean()}).strict();
const membershipSchema=z.object({service_id:z.string().min(1).max(256),state:z.enum(membershipStates)}).strict();
const subscriptionSchema=z.object({state:z.enum(subscriptionStates),current_period_end:z.number().int().positive().optional()}).strict();
const learnerGrantSchema=z.object({start:z.number().int().nonnegative(),end:z.number().int().positive()}).strict().refine(g=>g.start<g.end,{message:'empty_or_reversed_period'});
const requestSchema=z.object({identity:identitySchema,membership:membershipSchema.nullable(),subscription:subscriptionSchema.nullable(),learner_grant:learnerGrantSchema.nullable(),feature:z.string().max(64)}).strict();
const featureIds=(ids:readonly string[])=>ids.length>0&&ids.every(id=>featureId.test(id)&&id.length<=64);
type Options={serviceId?:string;freeFeatures?:readonly string[];excludedFeatures?:readonly string[];paidSubscriptionStates?:readonly SubscriptionState[];now?:()=>number};
type Denial='not_configured'|'invalid_input'|'auth_required'|'membership_required'|'membership_inactive'|'entitlement_required'|'unsupported';
export type EntitlementResult={decision:'allow';tier:'free'|'paid'}|{decision:'deny';reason:Denial};
/** Decided defaults (#5, 2026-11-10): free = R01·R07, initially excluded = R12·R13·R14.
 * Subscription states that grant paid default to active + canceled_pending_end; trialing,
 * past_due and disputed stay unpaid until the matching decisions (#8, B-03·B-04·B-06).
 * Period end beats state: a stored current_period_end already past closes paid access
 * without waiting for the provider event. Learner grants are a separate axis and grant
 * paid only inside their period; entitlement = max(free, subscription-paid, learner-paid).
 */
export function createServiceEntitlementEvaluator(options:Options={}){
 const deny=(reason:Denial):EntitlementResult=>({decision:'deny',reason});
 const free=options.freeFeatures??['R01','R07'];
 const excluded=options.excludedFeatures??['R12','R13','R14'];
 const paidStates=options.paidSubscriptionStates??['active','canceled_pending_end'];
 const configured=typeof options.serviceId==='string'&&options.serviceId.length>0&&options.serviceId.length<=256&&featureIds(free)&&featureIds(excluded)&&paidStates.length>0&&paidStates.every(s=>subscriptionStates.includes(s));
 return {configured,evaluate(request:unknown):EntitlementResult{
  if(!configured)return deny('not_configured');
  const r=requestSchema.safeParse(request);
  if(!r.success||!featureId.test(r.data.feature))return deny('invalid_input');
  if(!r.data.identity.verified)return deny('auth_required');
  const m=r.data.membership;
  if(m===null||m.service_id!==options.serviceId||m.state==='not_joined')return deny('membership_required');
  if(m.state==='suspended'||m.state==='withdrawn')return deny('membership_inactive');
  if(excluded.includes(r.data.feature))return deny('unsupported');
  const now=options.now?Math.floor(options.now()):Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(now)||now<0)return deny('invalid_input');
  const s=r.data.subscription;
  const subscriptionPaid=s!==null&&paidStates.includes(s.state)&&(s.current_period_end===undefined||now<s.current_period_end);
  const g=r.data.learner_grant;
  const learnerPaid=g!==null&&g.start<=now&&now<g.end;
  if(free.includes(r.data.feature))return {decision:'allow',tier:'free'};
  if(subscriptionPaid||learnerPaid)return {decision:'allow',tier:'paid'};
  return deny('entitlement_required');
 }};
}

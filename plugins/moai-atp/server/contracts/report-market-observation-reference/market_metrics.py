"""Three bounded market metrics from supplied canonical observations, never raw adapters.

Assertions prove neither source authentication nor actual market conditions. Exact
rational arithmetic is retained even when a separate interpretation gate blocks.
"""
from pathlib import Path
from fractions import Fraction
from decimal import Decimal, localcontext
import re
from financial_core import GateError, require, digest, parse_decimal, parse_time as _parse_time, decimal_context, plain_json_snapshot

ROOT = Path(__file__).resolve().parent
VERSION = 'moai.market-observations/0.1-rc7'
SPECS = {
 'metric.change_pct': ('(last/previous_close-1)*100', 'percent', ['market.last','market.previous_close']),
 'metric.spread_bps': ('(ask-bid)/((ask+bid)/2)*10000', 'bps', ['market.best_bid','market.best_ask']),
 'metric.etf_premium': ('(price/NAV-1)*100', 'percent', ['market.etf_price','market.etf_nav']),
}
SEMANTICS = {
 'market.last':'last_trade', 'market.previous_close':'official_previous_session_close',
 'market.provider_change_pct':'provider_published_change_from_previous_close',
 'market.best_bid':'firm_best_bid', 'market.best_ask':'firm_best_ask',
 'market.etf_price':'official_closing_exchange_price', 'market.etf_nav':'official_closing_fund_nav_per_share',
}
INSTRUMENT = ['security_id','symbol','instrument_kind','venue','share_class','share_unit','split_basis']
BASIS = ['session_id','observation_session_id','session_type','reference_id','price_basis','valuation_basis','market_state','semantics']
LIMITATIONS = [
 'All inputs are supplied assertions. source_authenticated=false; actual_bindings=0; live_bindings=0. No provider raw adapter is metric-ready.',
 'Arithmetic facts, supplied provider-percent cross-check, and bounded interpretation are independent statuses. A numeric arithmetic result does not imply original preconditions passed.',
 'No authentication, licensed live acquisition, full report-slot completion, investment conclusion, price target, forecast, or promised execution cost is established.',
 'ETF support is limited to official closing exchange price and official closing per-share NAV at the exact same valuation instant. Indicative NAV, current price versus previous NAV, cross-market stale/closed mismatch, FX conversion and share-unit conversion are not implemented.',
 'Same venue, symbol, security, split, share, session and reference bases must be explicitly supplied. They are not inferred from labels or provider raw fields.',
]

def parse_time(value,label):
 require(not (type(value) is str and value.endswith('-00:00')),'unknown_time_offset','RFC3339 -00:00 denotes an unknown local offset and is not accepted as an exact instant.')
 return _parse_time(value,label)

def obj(x, label):
 require(type(x) is dict, 'missing_metadata', label+' must be a plain object.'); return x

def exact_keys(x, required, optional=(), label='object'):
 obj(x,label)
 require(set(x)<=set(required)|set(optional), 'unknown_field', label+' contains unsupported fields.')
 for k in required: require(k in x,'missing_metadata',label+'.'+k+' is required.')

def text(x,label):
 require(type(x) is str and 0<len(x.strip())<=256,'missing_metadata',label+' needs nonempty text <=256 characters.'); return x

def number(x,label): return Fraction(parse_decimal(x,label))
def positive(x,label): require(x>0,'nonpositive_denominator',label+' must be positive.')
def reason(e): return {'code':e.code,'detail':e.detail}
def equal(rows,keys,container=None):
 for key in keys:
  vals=[r[container][key] if container else r[key] for r in rows]
  require(all(v==vals[0] for v in vals),'incompatible_'+key,'Inputs disagree on '+str(container or 'observation')+'.'+key+'. No implicit alignment/conversion.')

def encoded(f):
 # Exact fraction authoritative. Display rounded independently of ambient Decimal settings.
 with localcontext(decimal_context(1200)):
  rounded=(Decimal(f.numerator)/Decimal(f.denominator)).quantize(Decimal('0.000000000000000000000001'))
 s=format(rounded,'f').rstrip('0').rstrip('.')
 if s in ('','-0'):s='0'
 return {'decimal':s,'exact_fraction':{'numerator':str(f.numerator),'denominator':str(f.denominator)},'display_policy':'24 decimal places, half-even; exact fraction authoritative'}

def round_fraction(f,places,mode):
 scaled=f*10**places; sign=-1 if scaled<0 else 1; a=abs(scaled); q,r=divmod(a.numerator,a.denominator)
 if 2*r>a.denominator or (2*r==a.denominator and (mode=='half_up' or q%2)):q+=1
 return Fraction(sign*q,10**places)

def validate_observation(role,o,cutoff,data_kind,purpose):
 exact_keys(o,['observation_id','role','data_kind','value','unit','scale','currency','instrument','basis','source_at','published_at','available_at','provenance','rights'],label=role)
 for k in ['observation_id','role','data_kind','unit','currency']:text(o[k],role+'.'+k)
 require(o['role']==role and role in SEMANTICS,'role_mismatch',role+' cannot be substituted by another role.')
 require(o['data_kind']==data_kind,'data_kind_mismatch','Observation and request data kind differ.')
 require(o['unit']==('percent' if role=='market.provider_change_pct' else 'money_per_share'),'unit_mismatch',role+' requires its declared canonical unit.')
 require(re.fullmatch('[A-Z]{3}',o['currency']) is not None,'currency_mismatch','Explicit currency code required even for provider percent reference.')
 scale=number(o['scale'],role+'.scale')
 require(scale in [Fraction(10)**p for p in range(-12,13)],'invalid_scale','Scale must be an exact power of ten in [1e-12,1e12].')
 value=number(o['value'],role+'.value')*scale
 exact_keys(o['instrument'],INSTRUMENT,label=role+'.instrument')
 for k in INSTRUMENT:text(o['instrument'][k],role+'.instrument.'+k)
 require(o['instrument']['instrument_kind'] in ('equity','etf'),'unsupported_instrument','Only equity/ETF per-share market observations are supported.')
 require(o['instrument']['share_unit']=='one_share','unsupported_share_unit','This narrow contract supports one share, not baskets, lots or implicit unit conversion.')
 exact_keys(o['basis'],BASIS,label=role+'.basis')
 for k in BASIS:text(o['basis'][k],role+'.basis.'+k)
 require(o['basis']['semantics']==SEMANTICS[role],'semantic_mismatch','Declared observation semantics do not match '+role+'.')
 require(o['basis']['session_type']=='regular','unsupported_session','Only explicitly declared regular session supported.')
 require(o['basis']['price_basis']=='unadjusted_per_current_share','unsupported_price_basis','Only explicit unadjusted current-share prices are supported.')
 t={k:parse_time(o[k],role+'.'+k) for k in ['source_at','published_at','available_at']}
 require(t['source_at']<=t['published_at']<=t['available_at']<=cutoff,'late_or_reversed_input','Require source_at <= published_at <= available_at <= cutoff, without timestamp truncation.')
 p=o['provenance'];exact_keys(p,['source_id','document_id','record_id','locator','revision_id','source_sha256','origin','semantic_binding_asserted'],label=role+'.provenance')
 for k in ['source_id','document_id','record_id','locator','revision_id']:text(p[k],role+'.provenance.'+k)
 require(type(p['source_sha256']) is str and re.fullmatch('[a-f0-9]{64}',p['source_sha256']) is not None,'invalid_source_digest','Source SHA256 syntax required, not proof of source authentication.')
 require(p['origin']=='direct_observation','derived_observation_forbidden','Only separately supplied direct observations accepted; previous_close=last-change is prohibited.')
 require(p['semantic_binding_asserted'] is True,'unasserted_binding','An explicit semantic binding assertion is required; it is not authentication.')
 rights=o['rights'];exact_keys(rights,['processing_allowed','portable_export_allowed','assertion_id'],label=role+'.rights');text(rights['assertion_id'],role+'.rights.assertion_id')
 require(rights['processing_allowed'] is True,'processing_rights_missing','Processing rights assertion missing or false.')
 if purpose=='portable_export':require(rights['portable_export_allowed'] is True,'export_rights_missing','Portable export rights assertion missing or false.')
 return value,t

def validate_context(c,metric):
 required=['session_id','session_type','reference_id','freshness_policy']
 optional=['previous_session_id','previous_close_at','independent_percent_assertion','provider_rounding_policy','underlying_valuation_alignment']
 exact_keys(c,required,optional,'context')
 for k in required[:-1]:text(c[k],'context.'+k)
 require(c['session_type']=='regular','unsupported_session','Only regular-session contexts supported.')
 policy=c['freshness_policy'];exact_keys(policy,['policy_id','max_age_seconds'],label='freshness_policy');text(policy['policy_id'],'freshness_policy.policy_id');obj(policy['max_age_seconds'],'max_age_seconds')
 require(set(policy['max_age_seconds'])<=set(SEMANTICS),'unknown_role','Freshness policy has unknown roles.')
 for role,v in policy['max_age_seconds'].items():
  n=number(v,'freshness_policy.'+role);require(0<=n<=604800,'invalid_freshness_policy','Freshness age limits must be 0 through 604800 seconds inclusive.')
 return c

def crosscheck(observations,c,base_rows,value,cutoff,data_kind,purpose):
 role='market.provider_change_pct'; out={'status':'unverified','reason':None,'expected_rounded':None,'supplied_value':None,'source_authenticated':False,'independence':'not_established','lineage':[]}
 try:
  require(role in observations,'missing_provider_percent','Independent provider percent observation is missing.')
  p=observations[role];v,t=validate_observation(role,p,cutoff,data_kind,purpose)
  equal(base_rows+[p],['currency']);equal(base_rows+[p],INSTRUMENT,'instrument')
  equal(base_rows+[p],['session_id','session_type','reference_id','price_basis','valuation_basis','market_state'],'basis')
  require(p['basis']['observation_session_id']==c['session_id'],'incompatible_observation_session_id','Provider percent must belong to current session.')
  require(t['source_at']==parse_time(base_rows[0]['source_at'],'last.source_at'),'provider_time_mismatch','Provider percent must refer to the exact same last observation instant.')
  assertion=c.get('independent_percent_assertion');exact_keys(assertion,['assertion_id','provider_percent_independent_of_local_calculation','previous_close_independently_supplied'],label='independent_percent_assertion');text(assertion['assertion_id'],'independence.assertion_id')
  require(assertion['provider_percent_independent_of_local_calculation'] is True and assertion['previous_close_independently_supplied'] is True,'independence_unasserted','Both independence assertions must be explicitly true.')
  ids=[r['observation_id'] for r in base_rows+[p]];records=[(r['provenance']['source_id'],r['provenance']['document_id'],r['provenance']['record_id'],r['provenance']['locator']) for r in base_rows+[p]]
  require(len(set(ids))==3 and len(set(records))==3,'independence_collision','Distinct direct observation identities and source locators are required, not proof of authenticity.')
  policy=c.get('provider_rounding_policy');require(policy is not None,'missing_provider_rounding_policy','Provider percent rounding/precision policy missing; numeric equality alone does not verify the check.')
  exact_keys(policy,['policy_id','decimal_places','mode','scope'],label='provider_rounding_policy');text(policy['policy_id'],'rounding.policy_id')
  require(type(policy['decimal_places']) is int and 0<=policy['decimal_places']<=12 and policy['mode'] in ('half_even','half_up') and policy['scope']=='percent_value_after_scale','unsupported_rounding_policy','Require 0..12 decimal places, half_even or half_up, after-scale percent units.')
  maxage=c['freshness_policy']['max_age_seconds'].get(role)
  require(maxage is not None,'missing_freshness_policy','Provider percent freshness limit is required.')
  require((cutoff-t['source_at']).seconds<=number(maxage,'max_age_seconds'),'stale_provider_percent','Provider percent is stale under its supplied policy.')
  expected=round_fraction(value,policy['decimal_places'],policy['mode'])
  out.update(expected_rounded=encoded(expected),supplied_value=encoded(v),independence='supplied_assertion_only',rounding_policy=policy,lineage=[lineage(p,v)])
  require(v==expected,'provider_percent_mismatch','Supplied provider percent differs from the exact independently recomputed value under the explicit rounding policy.')
  out['status']='matched_supplied_assertion'
 except GateError as e:
  out['reason']=reason(e);out['status']='mismatch' if e.code=='provider_percent_mismatch' else 'unverified'
 return out

def lineage(o,v):
 return {'observation_id':o['observation_id'],'observation_sha256':digest(o),'role':o['role'],'raw_decimal':o['value'],'scale':o['scale'],'normalized_value':encoded(v),'unit':o['unit'],'currency':o['currency'],'data_kind':o['data_kind'],'instrument':o['instrument'],'basis':o['basis'],'source_at':o['source_at'],'published_at':o['published_at'],'available_at':o['available_at'],'provenance':o['provenance'],'rights':o['rights'],'source_authenticated':False}

def calculate_entry(entry,cutoff,data_kind,purpose):
 out={'id':None,'metric_id':None,'formula':None,'unit':None,'status':'blocked','arithmetic':{'status':'unavailable','value':None},'canonical_metric':{'status':'unavailable','value':None},'accepted_chart_bindings':0,'provider_crosscheck':{'status':'not_applicable'},'interpretation':{'status':'blocked','reasons':[]},'lineage':[],'context':None,'source_authenticated':False,'actual_bindings':0,'live_bindings':0}
 try:
  exact_keys(entry,['id','metric_id','observations','context'],label='entry');out['id']=text(entry['id'],'entry.id');metric=text(entry['metric_id'],'entry.metric_id');out['metric_id']=metric
  require(metric in SPECS,'unimplemented_metric','Metric is not implemented in this bounded slice.')
  formula,unit,roles=SPECS[metric];out.update(formula=formula,unit=unit)
  observations=obj(entry['observations'],'observations');require(set(observations)<=set(roles)|({'market.provider_change_pct'} if metric=='metric.change_pct' else set()),'unknown_role','Only this metric’s explicit canonical observation roles are accepted.')
  missing=[r for r in roles if r not in observations]
  require(not missing,'missing_observations','Missing canonical observations: '+', '.join(missing))
  c=validate_context(entry['context'],metric);out['context']=c
  rows=[observations[r] for r in roles];values=[];times=[]
  for r,o in zip(roles,rows):
   v,t=validate_observation(r,o,cutoff,data_kind,purpose);values.append(v);times.append(t)
  equal(rows,['currency']);equal(rows,INSTRUMENT,'instrument');equal(rows,['session_id','session_type','reference_id','price_basis','valuation_basis','market_state'],'basis')
  require(len({o['observation_id'] for o in rows})==len(rows),'duplicate_observation_id','Core observation IDs must be distinct.')
  for o in rows:
   for k in ['session_id','session_type','reference_id']:require(o['basis'][k]==c[k],'context_'+k+'_mismatch','Observation differs from explicit context '+k+'.')
  if metric=='metric.change_pct':
   require(c.get('previous_session_id') is not None and c.get('previous_close_at') is not None,'missing_previous_reference','Explicit previous session ID and previous close instant required.')
   text(c['previous_session_id'],'previous_session_id');require(c['previous_session_id']!=c['session_id'],'invalid_previous_session','Previous session must differ from current session.')
   require(rows[0]['basis']['observation_session_id']==c['session_id'] and rows[1]['basis']['observation_session_id']==c['previous_session_id'],'incompatible_observation_session_id','Current last and previous close need their explicit distinct source sessions.')
   require(times[1]['source_at']==parse_time(c['previous_close_at'],'previous_close_at') and times[1]['source_at']<times[0]['source_at'],'previous_close_reference_mismatch','Previous close must equal the declared previous-session close instant and precede last.')
   require(rows[0]['basis']['valuation_basis']=='regular_last_vs_official_previous_close','unsupported_valuation_basis','Change requires explicit regular-last/official-previous-close valuation basis.')
   positive(values[1],'previous_close');require(values[0]>=0,'negative_price','Equity/ETF last cannot be negative.');value=(values[0]/values[1]-1)*100
  elif metric=='metric.spread_bps':
   equal(rows,['observation_session_id'],'basis');require(rows[0]['basis']['observation_session_id']==c['session_id'],'incompatible_observation_session_id','Quotes must belong to current session.')
   require(times[0]['source_at']==times[1]['source_at'],'non_simultaneous_quotes','Bid and ask must have exactly equal instants, including submicroseconds.')
   require(rows[0]['basis']['valuation_basis']=='same_instant_firm_book','unsupported_valuation_basis','Spread requires a same-instant firm book.')
   require(values[0]>=0 and values[1]>=0,'negative_quote','Equity/ETF bid and ask cannot be negative.');require(values[0]<=values[1],'crossed_book','Bid must not exceed ask.');mid=(values[0]+values[1])/2;positive(mid,'mid');value=(values[1]-values[0])/mid*10000
  else:
   require(rows[0]['instrument']['instrument_kind']=='etf','not_etf','ETF premium needs an explicitly identified ETF.')
   equal(rows,['observation_session_id'],'basis');require(rows[0]['basis']['observation_session_id']==c['session_id'],'incompatible_observation_session_id','Price and NAV must refer to the same explicit valuation session.')
   require(times[0]['source_at']==times[1]['source_at'],'nav_time_mismatch','Price and official NAV require the exact same valuation instant.')
   require(rows[0]['basis']['valuation_basis']=='official_synchronized_close','unsupported_valuation_basis','Indicative NAV and closing NAV are not interchangeable. Only official synchronized close is implemented.')
   positive(values[1],'NAV');require(values[0]>=0,'negative_price','ETF closing price cannot be negative.');value=(values[0]/values[1]-1)*100
  out['lineage']=[lineage(o,v) for o,v in zip(rows,values)]
  out['arithmetic']={'status':'computed','value':encoded(value),'claim':'Exact arithmetic on supplied assertions only'}
  gates=[]
  for role,t in zip(roles,times):
   limit=c['freshness_policy']['max_age_seconds'].get(role)
   if limit is None:gates.append({'code':'missing_freshness_policy','detail':'Missing maximum source-age policy for '+role+'.'})
   elif (cutoff-t['source_at']).seconds>number(limit,'max_age_seconds'):gates.append({'code':'stale_observation','detail':role+' exceeds its declared source-age policy.'})
  if metric in ('metric.change_pct','metric.spread_bps') and rows[0]['basis']['market_state']!='regular_open':gates.append({'code':'market_not_regular_open','detail':'This narrow interpretation requires a supplied regular-open market assertion.'})
  if metric=='metric.etf_premium':
   if rows[0]['basis']['market_state']!='closed_at_synchronized_valuation':gates.append({'code':'unsupported_market_state','detail':'Only synchronized official closing valuation is supported.'})
   if c.get('underlying_valuation_alignment')!='same_instant_no_closed_market_gap':gates.append({'code':'cross_market_alignment_unverified','detail':'Closed/stale cross-market underlying valuation blocks interpretation.'})
  if metric=='metric.change_pct':
   out['provider_crosscheck']=crosscheck(observations,c,rows,value,cutoff,data_kind,purpose)
   if out['provider_crosscheck']['status']!='matched_supplied_assertion':gates.append({'code':'provider_crosscheck_not_matched','detail':'Independent provider percent check is absent, unverified, stale, or mismatched. See cross-check reason.'})
  out['interpretation']={'status':'blocked' if gates else 'bounded_supplied_assertions_only','reasons':gates,'meaning':{'metric.change_pct':'Descriptive change versus explicitly supplied previous close; no trend or return prediction.','metric.spread_bps':'Quoted relative top-of-book spread only; not execution cost, liquidity depth or guaranteed fill.','metric.etf_premium':'Same-instant official closing price/NAV comparison only; not arbitrage profit, fair value or current tradable premium.'}[metric]}
  out['status']='arithmetic_only' if gates else 'conditional_supplied_metric'
  out['canonical_metric']={'status':'unavailable' if gates else 'conditional_supplied_assertions_only','value':None if gates else encoded(value)}
  if gates:out['arithmetic']['claim']='Formula exercise only; NOT an accepted canonical metric or chart binding'
 except GateError as e:
  out['interpretation']['reasons']=[reason(e)]
  if e.code=='missing_observations':out['status']='missing_inputs'
  if e.code=='unimplemented_metric':out['status']='unimplemented'
 return out

def calculate(payload):
 report={'contract':VERSION,'status':'blocked','request':None,'results':[],'reasons':[],'limitations':LIMITATIONS,'source_authenticated':False,'actual_bindings':0,'live_bindings':0,'actual_provider_calls':0,'accepted_chart_bindings':0,'whole_original_slots_complete':False}
 try:
  p=plain_json_snapshot(payload)
  exact_keys(p,['contract','request','entries'],label='payload');require(p['contract']==VERSION,'contract_mismatch','Unsupported explicit observation contract.')
  r=p['request'];exact_keys(r,['cutoff','data_kind','purpose'],label='request');require(r['data_kind'] in ('synthetic','actual'),'invalid_data_kind','data_kind must be synthetic or actual; neither authenticates source.');require(r['purpose'] in ('private_analysis','portable_export'),'invalid_purpose','Purpose must be explicit.')
  cutoff=parse_time(r['cutoff'],'request.cutoff');report['request']=r
  require(type(p['entries']) is list and len(p['entries'])<=24,'invalid_entries','At most 24 plain entries accepted.')
  report['results']=[calculate_entry(e,cutoff,r['data_kind'],r['purpose']) for e in p['entries']]
  ids=[x['id'] for x in report['results'] if x['id'] is not None];require(len(ids)==len(set(ids)),'duplicate_entry_id','Entry IDs must be unique.')
  report['input_sha256']=digest(p);report['status']='evaluated';report['status_counts']={s:sum(x['status']==s for x in report['results']) for s in ['conditional_supplied_metric','arithmetic_only','missing_inputs','unimplemented','blocked']}
 except GateError as e:report['reasons']=[reason(e)];report['results']=[]
 return report

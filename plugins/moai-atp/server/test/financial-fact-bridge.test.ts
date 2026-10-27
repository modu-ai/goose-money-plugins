import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const CONTRACT_TEST_CWD=fileURLToPath(new URL('../../',import.meta.url));
import {assembleFinancialFact,expandFinancialDecimal,FINANCIAL_BRIDGE_AXES,type TrustedFinancialVerifier} from '../src/financial-fact-bridge.js';
import {selectSecFinancialEvidence} from '../src/financial-evidence-selection.js';
import {secFixture} from './financial-selection-fixtures.js';
import {bridgeFixture,bindingFixture,syntheticVerifier,VERIFIED} from './financial-bridge-fixtures.js';
const clone=<T>(x:T):T=>structuredClone(x);
const reject=async(c:unknown,b:unknown,code:string,v:TrustedFinancialVerifier|undefined=syntheticVerifier)=>assert.rejects(assembleFinancialFact(c,b,v,()=>VERIFIED),(e:any)=>e.code===code);
for(const provider of ['SEC','opendart'] as const)test(`synthetic ${provider} exact fact passes authoritative Python runtime and structural profile`,async()=>{
 const {c,b}=await bridgeFixture(provider);const r=await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED);
 assert.equal(r.fact.value,'9007199254740993.2500');assert.equal(r.fact.data_kind,'synthetic');assert.equal(r.status,'synthetic_fact_ready');assert.equal(c.canonical_fact,null);assert.equal(c.semantic_binding_verified,false);
 assert.equal(r.fact.provenance.source_sha256,'a'.repeat(64));assert.notEqual(r.fact.provenance.source_sha256,r.lineage.financial_snapshot_sha256);assert.ok(Object.isFrozen(r.fact.basis));
 const py=spawnSync('python3',['-B','-c',`import sys,json,importlib.util\nfrom jsonschema import Draft202012Validator\np='contracts/report-financial-reference/reference/semantics.py'\ns=importlib.util.spec_from_file_location('reference',p);m=importlib.util.module_from_spec(s);sys.modules['reference']=m;s.loader.exec_module(m)\nx=json.load(sys.stdin);f=x['fact'];Draft202012Validator(json.load(open('contracts/report-financial-reference/reported-fact.schema.json'))).validate(f)\nm.validate_fact(f['concept'],m.plain_json_snapshot(f),m.parse_time(x['cutoff'],'cutoff'))\nprint('validated')`],{cwd:CONTRACT_TEST_CWD,input:JSON.stringify({fact:r.fact,cutoff:c.cutoff}),encoding:'utf8'});
 assert.equal(py.status,0,py.stderr);assert.match(py.stdout,/validated/);
});
test('default is closed despite complete metadata and synthetic review',async()=>{const{c,b}=await bridgeFixture();await assert.rejects(assembleFinancialFact(c,b),{code:'verification_not_configured'});});
test('immutable verifier context preserves original input despite concurrent mutation',async()=>{const{c,b}=await bridgeFixture();let release!:()=>void;const wait=new Promise<void>(r=>release=r);let called=false;
 const v:TrustedFinancialVerifier={...syntheticVerifier,async verify(q){called=true;assert.ok(Object.isFrozen(q.binding.evidence.rights));assert.throws(()=>{(q.binding as any).role='reported.debt';});await wait;return syntheticVerifier.verify(q);}};
 const pending=assembleFinancialFact(c,b,v,()=>VERIFIED);assert.equal(called,true);b.identity.issuer_id='changed-after-call';release();assert.equal((await pending).fact.issuer_id,'synthetic:issuer:1');});
test('receipt clock is sampled after verification, exact rights expiry enforced',async()=>{const{c,b}=await bridgeFixture();b.rights.valid_until=VERIFIED;let now=VERIFIED,calls=0;const v={...syntheticVerifier,async verify(q:any){now='2026-10-22T01:00:00.000000002Z';return syntheticVerifier.verify(q);}};await assert.rejects(assembleFinancialFact(c,b,v,()=>{calls++;return now;}),{code:'rights_outside_window'});assert.equal(calls,1);});
test('offset-equivalent timestamps and fractional equality remain valid',async()=>{const{c,b}=await bridgeFixture();b.artifacts[0]!.snapshot!.received_at='2026-10-22T09:00:00.123456789+09:00';b.rights.valid_until='2026-10-22T10:00:00.000000001+09:00';await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED);});
for(const [label,mutate,code] of [
 ['requested role',(b:any)=>b.role='reported.debt','role_mismatch'],
 ['issuer',(b:any)=>b.provider_issuer_id='other','issuer_mismatch'],
 ['document',(b:any)=>b.document_id='other','issuer_mismatch'],
 ['period endpoints',(b:any)=>b.period.end='2025-12-30','period_mismatch'],
 ['instant revenue',(b:any)=>{b.period.kind='instant';b.period.start=b.period.end;},'period_mismatch'],
 ['source scale',(b:any)=>b.unit.scale='1000','source_unit_mismatch'],
 ['currency',(b:any)=>b.unit.currency='KRW','source_unit_mismatch'],
 ['standard',(b:any)=>b.basis.standard='IFRS','accounting_basis_mismatch'],
 ['publication after availability',(b:any)=>b.published_at='2026-02-10T15:30:02.000000001Z','invalid_chronology'],
 ['publication before acceptance',(b:any)=>b.published_at='2026-02-10T15:30:00Z','invalid_chronology'],
 ['availability after receipts',(b:any)=>b.available_at='2026-10-22T00:00:00.123456790Z','invalid_chronology'],
 ['unknown timezone',(b:any)=>b.date_timezone='Not/AZone','invalid_chronology'],
 ['fixed offset not IANA',(b:any)=>b.date_timezone='+05:00','invalid_chronology'],
 ['missing evidence',(b:any)=>b.evidence.rights=[],'invalid_binding'],
 ['dangling evidence',(b:any)=>b.evidence.rights=['unknown'],'source_evidence_mismatch'],
 ['duplicate artifact',(b:any)=>b.artifacts.push(b.artifacts[0]),'source_evidence_mismatch'],
 ['wrong snapshot hash',(b:any)=>b.artifacts[0].snapshot.sha256='0'.repeat(64),'source_evidence_mismatch'],
 ['wrong source kind',(b:any)=>b.artifacts[0].data_kind='actual','source_evidence_mismatch'],
 ['filing used as value source',(b:any)=>b.value_source_artifact_id='filing-source','source_evidence_mismatch'],
 ['future rights',(b:any)=>b.rights.valid_from='2026-10-22T01:00:00.000000002Z','rights_outside_window'],
 ['extra asserted verified flag',(b:any)=>b.verified=true,'invalid_binding'],
 ['unexpected capex policy',(b:any)=>b.basis.cash_sign='positive_outflow','invalid_binding'],
] as const)test(`reject ${label}`,async()=>{const{c,b}=await bridgeFixture();mutate(b);await reject(c,b,code);});
for(const axis of FINANCIAL_BRIDGE_AXES)test(`verifier must confirm exact ${axis} evidence set`,async()=>{const{c,b}=await bridgeFixture();const v={...syntheticVerifier,async verify(q:any){const d:any=clone(await syntheticVerifier.verify(q));d.confirmed[axis]=['not-the-bound-artifact'];return d;}};await reject(c,b,'verification_mismatch',v);});
test('verifier cannot replay another input digest',async()=>{const{c,b}=await bridgeFixture();await reject(c,b,'verification_mismatch',{...syntheticVerifier,async verify(q){return {...await syntheticVerifier.verify(q) as object,input_sha256:'0'.repeat(64)};}});});
test('verifier exception is sanitized',async()=>{const{c,b}=await bridgeFixture();await reject(c,b,'verification_failed',{...syntheticVerifier,async verify(){throw new Error('do-not-echo-private-detail');}});});
test('unsupported SEC debt/parent-equity tag is not a common-equity shortcut',async()=>{const q:any=await secFixture();q.requested_role='reported.equity_common_close';q.selector.start=null;q.selector.period_kind='instant';q.selector.concept='StockholdersEquity';q.concept_result.request.concept='StockholdersEquity';q.concept_result.concept='StockholdersEquity';q.concept_result.source_url=q.concept_result.source_url.replace('Revenues','StockholdersEquity');q.concept_result.facts[0].start=null;q.concept_result.facts[0].period_kind='instant';const c=selectSecFinancialEvidence(q),b=bindingFixture(c);b.period={kind:'instant',start:'2025-12-31',end:'2025-12-31',label:'Synthetic balance'};await reject(c,b,'unsupported_direct_mapping');});
for(const [input,output] of [['1e3','1000'],['1.25e-3','0.00125'],['9007199254740993.2500','9007199254740993.2500'],['-0.00','-0.00'],['0.0001E+3','0.1'],['123.00e-2','1.2300']] as const)test(`exact decimal ${input}`,()=>assert.equal(expandFinancialDecimal(input),output));
for(const input of ['1e1000000','NaN','1.0\n','+1','01','1e-256','1e256'])test(`reject decimal ${JSON.stringify(input)}`,()=>assert.throws(()=>expandFinancialDecimal(input),{code:'invalid_decimal'}));
for(const boundary of ['getter','proxy','cycle','sparse','toJSON','bidi','surrogate','large'] as const)test(`reject hostile binding ${boundary} without executing hooks`,async()=>{const{c,b}=await bridgeFixture();let calls=0;let value:any=b;
 if(boundary==='getter')Object.defineProperty(b,'role',{get(){calls++;return 'reported.revenue';}});
 if(boundary==='proxy')value=new Proxy(b,{ownKeys(){calls++;return [];}});
 if(boundary==='cycle')(b as any).extra=b;
 if(boundary==='sparse')delete (b.artifacts as any)[0];
 if(boundary==='toJSON')(b as any).toJSON=()=>{calls++;return b;};
 if(boundary==='bidi')b.identity.issuer_id='abc\u202edef';
 if(boundary==='surrogate')b.identity.issuer_id='\ud800';
 if(boundary==='large')(b as any).extra='a'.repeat(300001);
 await assert.rejects(assembleFinancialFact(c,value,syntheticVerifier,()=>VERIFIED),(e:any)=>['invalid_plain_json','input_too_large'].includes(e.code));assert.equal(calls,0);});
test('exported verification axis inventory is frozen',()=>{assert.ok(Object.isFrozen(FINANCIAL_BRIDGE_AXES));assert.throws(()=>{(FINANCIAL_BRIDGE_AXES as any).splice(0,1);});assert.equal(FINANCIAL_BRIDGE_AXES.length,10);});
for(const zone of ['utc','america/New_York','ASIA/SEOUL','localtime'])test(`reject nonportable or nonexact timezone ${zone}`,async()=>{const{c,b}=await bridgeFixture();b.date_timezone=zone;await reject(c,b,'invalid_chronology');});
test('entire pinned timezone vocabulary is accepted by authoritative Python ZoneInfo',()=>{const p=spawnSync('python3',['-B','-c',`import json,zoneinfo\nfor name in json.load(open('contracts/report-financial-reference/compatible-timezones.json'))['timezones']: zoneinfo.ZoneInfo(name)\nprint('ok')`],{cwd:CONTRACT_TEST_CWD,encoding:'utf8'});assert.equal(p.status,0,p.stderr);});
test('synthetic verifier cannot promote actual-labelled DTOs',async()=>{const q=await secFixture();q.concept_result.origin='actual';q.submissions_result.origin='actual';const c=selectSecFinancialEvidence(q),b=bindingFixture(c);for(const a of b.artifacts){a.data_kind='actual';a.digest_kind=a.snapshot?'original_bytes':'review_record';a.locator='https://example.invalid/synthetic-test/'+a.id;}await reject(c,b,'actual_verifier_required');});
test('empty or synthetic source proof cannot satisfy actual-source evidence',async()=>{const q=await secFixture();q.concept_result.origin='actual';q.submissions_result.origin='actual';const c=selectSecFinancialEvidence(q),b=bindingFixture(c);await reject(c,b,'source_evidence_mismatch');});
import {SEC_DIRECT_FIXTURE_ROLES,secRoleFixture} from './financial-bridge-fixtures.js';
const pythonValidate=(facts:unknown,cutoff:string,metric?:string)=>{
 const p=spawnSync('python3',['-B','-c',`import sys,json,importlib.util\nfrom jsonschema import Draft202012Validator\ns=importlib.util.spec_from_file_location('reference','contracts/report-financial-reference/reference/semantics.py');m=importlib.util.module_from_spec(s);sys.modules['reference']=m;s.loader.exec_module(m)\nx=json.load(sys.stdin);v=Draft202012Validator(json.load(open('contracts/report-financial-reference/reported-fact.schema.json')))\nfor f in x['facts'].values():\n v.validate(f);m.validate_fact(f['concept'],m.plain_json_snapshot(f),m.parse_time(x['cutoff'],'cutoff'))\nprint(json.dumps(m.calculate_metric(x['metric'],x['facts'],x['cutoff'])) if x.get('metric') else '{}')`],{cwd:CONTRACT_TEST_CWD,input:JSON.stringify({facts,cutoff,metric}),encoding:'utf8'});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);
};
for(const role of Object.keys(SEC_DIRECT_FIXTURE_ROLES) as (keyof typeof SEC_DIRECT_FIXTURE_ROLES)[])test(`SEC direct ${role} passes pinned full fact contract`,async()=>{const{c,b}=await secRoleFixture(role);const r=await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED);pythonValidate({[role]:r.fact},c.cutoff);});
test('assembled synthetic margin reaches report metric runtime with exact lineage',async()=>{const revenue=await secRoleFixture('reported.revenue','1000'),profit=await secRoleFixture('reported.operating_profit','200');const a=await assembleFinancialFact(revenue.c,revenue.b,syntheticVerifier,()=>VERIFIED),b=await assembleFinancialFact(profit.c,profit.b,syntheticVerifier,()=>VERIFIED);const r=pythonValidate({'reported.revenue':a.fact,'reported.operating_profit':b.fact},revenue.c.cutoff,'metric.operating_margin');assert.equal(r.status,'computed');assert.equal(r.value,'20');assert.equal(r.data_kind,'synthetic');assert.equal(r.lineage.length,2);});
test('cross-fact issuer mismatch is still blocked by metric runtime after individual bridge validation',async()=>{const revenue=await secRoleFixture('reported.revenue','1000'),profit=await secRoleFixture('reported.operating_profit','200');profit.b.identity.issuer_id='synthetic:different-issuer';const a=await assembleFinancialFact(revenue.c,revenue.b,syntheticVerifier,()=>VERIFIED),b=await assembleFinancialFact(profit.c,profit.b,syntheticVerifier,()=>VERIFIED);const r=pythonValidate({'reported.revenue':a.fact,'reported.operating_profit':b.fact},revenue.c.cutoff,'metric.operating_margin');assert.equal(r.status,'blocked');assert.ok(r.reasons.some((x:any)=>x.code==='issuer_id_mismatch'));});
test('positive fractional weighted shares remain exact rather than integer-truncated',async()=>{const{c,b}=await secRoleFixture('reported.shares_weighted','1000.1250');const r=await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED);assert.equal(r.fact.value,'1000.1250');pythonValidate({'reported.shares_weighted':r.fact},c.cutoff);});
for(const role of ['reported.cash','reported.liabilities','reported.shares_weighted'] as const)test(`negative ${role} rejected without absolute-value conversion`,async()=>{const{c,b}=await secRoleFixture(role,'-1');await reject(c,b,'source_value_unavailable');});
test('zero cash retained as real zero, not missing',async()=>{const{c,b}=await secRoleFixture('reported.cash','0');const r=await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED);assert.equal(r.fact.value,'0');});
test('negative operating profit is valid, no equity-price positivity rule applied',async()=>{const{c,b}=await secRoleFixture('reported.operating_profit','-3.2500');const r=await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED);assert.equal(r.fact.value,'-3.2500');pythonValidate({'reported.operating_profit':r.fact},c.cutoff);});
import {dartRoleFixture} from './financial-bridge-fixtures.js';
import {REPORTED_FINANCIAL_ROLES,selectDartFinancialEvidence} from '../src/financial-evidence-selection.js';
import {dartFixture} from './financial-selection-fixtures.js';
for(const role of REPORTED_FINANCIAL_ROLES)test(`synthetic DART issuer-specific ${role} requires review and passes report fact contract`,async()=>{const{c,b}=dartRoleFixture(role);await assert.rejects(assembleFinancialFact(c,b),{code:'verification_not_configured'});const r=await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED);assert.equal(r.fact.value,'1000.2500');assert.equal(r.lineage.numeric_lexeme,'+0001000.2500');assert.equal(r.lineage.raw_value,'+0001000.2500');pythonValidate({[role]:r.fact},c.cutoff);});
test('known DART standard revenue cannot be relabelled as operating profit',async()=>{const q=dartFixture();q.requested_role='reported.operating_profit';const c=selectDartFinancialEvidence(q),b=bindingFixture(c);await reject(c,b,'unsupported_direct_mapping');});
test('DART nonmonetary quantity cannot use statement currency as share denomination',async()=>{const{c,b}=dartRoleFixture('reported.shares_weighted');b.unit.source_currency_interpretation='quantity_currency';await reject(c,b,'source_unit_mismatch');});
test('DART scale stays explicit, verified metadata rather than forced KRW or rescaled value',async()=>{const{c,b}=dartRoleFixture('reported.revenue');b.unit.scale='1000';const r=await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED);assert.equal(r.fact.value,'1000.2500');assert.equal(r.fact.scale,'1000');assert.equal(r.fact.currency,'USD');pythonValidate({'reported.revenue':r.fact},c.cutoff);});
for(const role of ['reported.debt','reported.capex'] as const)test(`negative custom DART ${role} cannot be silently negated`,async()=>{const{c,b}=dartRoleFixture(role,'-100');await reject(c,b,'source_value_unavailable');});
test('DART capex missing component policy is blocked',async()=>{const{c,b}=dartRoleFixture('reported.capex');delete b.basis.acquisition_cash_payments;await reject(c,b,'invalid_binding');});
test('DART debt missing lease policy is blocked',async()=>{const{c,b}=dartRoleFixture('reported.debt');delete b.basis.lease_liabilities;await reject(c,b,'invalid_binding');});
test('blank source value is not zero',async()=>{const{c,b}=dartRoleFixture('reported.revenue',' ');await reject(c,b,'source_value_unavailable');});
test('DART current three-month income cannot become cumulative YTD by metadata alone',async()=>{const{c,b}=dartRoleFixture('reported.revenue');b.period.kind='YTD';await reject(c,b,'period_mismatch');});
test('earlier financial receipt bounds public availability even when other source receipt is later',async()=>{const q=await secFixture();q.concept_result.received_at='2026-02-10T15:30:01Z';const c=selectSecFinancialEvidence(q),b=bindingFixture(c);await reject(c,b,'invalid_chronology');});
test('source locator cannot exceed pinned report profile bound',async()=>{const{c,b}=await bridgeFixture();b.artifacts[0]!.locator='synthetic://fixture/'+ 'a'.repeat(512);await reject(c,b,'invalid_binding');});
test('year zero is invalid in pinned Python calendar',async()=>{const{c,b}=dartRoleFixture('reported.cash');b.period.start=b.period.end='0000-01-01';await reject(c,b,'invalid_binding');});
test('DART selected filing cannot be published before its source-calendar filing date',async()=>{const{c,b}=await bridgeFixture('opendart');b.published_at='2025-08-13T23:59:59.999999999Z';await reject(c,b,'invalid_chronology');});
test('binding cannot silently switch the selected source calendar',async()=>{const{c,b}=await bridgeFixture();b.date_timezone='Asia/Seoul';await reject(c,b,'invalid_chronology');});
import {reverifyFinancialFactHandoff} from '../src/financial-fact-bridge.js';
test('serialized successful handoff cannot establish trust without a fresh verifier',async()=>{const{c,b}=await bridgeFixture();const r=await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED);await assert.rejects(reverifyFinancialFactHandoff(JSON.parse(JSON.stringify(r))),{code:'verification_not_configured'});});
test('reverification reconstructs persisted fields and emits a fresh receipt',async()=>{const{c,b}=await bridgeFixture();const r=await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED);const now='2026-10-22T01:00:00.000000002Z';const next=await reverifyFinancialFactHandoff(JSON.parse(JSON.stringify(r)),syntheticVerifier,()=>now);assert.deepEqual(next.fact,r.fact);assert.equal(next.verification.verified_at,now);});
for(const [label,mutate] of [
 ['numeric fact',(x:any)=>x.fact.value='1'],['origin',(x:any)=>x.fact.data_kind='actual'],['canonical unit',(x:any)=>x.fact.currency='KRW'],
 ['raw lineage',(x:any)=>x.lineage.raw_value='1'],['rights',(x:any)=>x.rights.valid_until='2099-01-01T00:00:00Z'],
 ['attestation hash',(x:any)=>x.verification.input_sha256='0'.repeat(64)],['attestation evidence',(x:any)=>x.verification.confirmed.rights=['other']],
 ['future attestation',(x:any)=>x.verification.verified_at='2026-10-22T01:00:00.000000003Z'],['runtime pin',(x:any)=>x.report_runtime.sha256='0'.repeat(64)],
 ['warnings',(x:any)=>x.warnings=[]],['extra canonical field',(x:any)=>x.fact.authenticated=true],
] as const)test(`persisted handoff rejects tampered ${label}`,async()=>{const{c,b}=await bridgeFixture();const r:any=clone(await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED));mutate(r);await assert.rejects(reverifyFinancialFactHandoff(r,syntheticVerifier,()=>VERIFIED),{code:'handoff_mismatch'});});
test('reverification cannot replay an expired use-rights window',async()=>{const{c,b}=await bridgeFixture();const r=await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED);await assert.rejects(reverifyFinancialFactHandoff(r,syntheticVerifier,()=> '2026-10-23T00:00:00.000000001Z'),{code:'rights_outside_window'});});
test('persisted handoff accessor rejected without execution',async()=>{let calls=0;const{c,b}=await bridgeFixture();const r:any=clone(await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED));Object.defineProperty(r,'fact',{get(){calls++;return {};}});await assert.rejects(reverifyFinancialFactHandoff(r,syntheticVerifier,()=>VERIFIED),{code:'invalid_plain_json'});assert.equal(calls,0);});

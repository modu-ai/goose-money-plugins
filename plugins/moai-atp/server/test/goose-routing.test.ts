import test from 'node:test';import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';import {fileURLToPath} from 'node:url';
import {planGooseRequest} from '../src/goose-routing.js';import {dispatchGooseCommand} from '../src/cli.js';
const ids=(s:string)=>planGooseRequest(s).steps.map(x=>x.id);
for(const [request,expected]of [
 ['/goose 삼성전자 실적 분석 보고서',['analyze','report']],
 ['/goose 논문으로 전략 만들고 백테스트 후 보고서',[]],
 ['/goose conditions HTS 조건식 초안',['conditions']],
 ['/goose ETF 비교 분석',['analyze']],
 ['/goose 해외 선물 분석 보고서',[]],
 ['/goose 손실 뒤 마음이 불안해',['mental-support']],
 ['/goose backtest 전략을 만들지 말고 과거 검증',[]],
] as const)test(`single Goose local routing fixture: ${request}`,()=>{assert.deepEqual(ids(request),expected);const p=planGooseRequest(request);assert.equal(p.provider_dispatches,0);assert.equal(p.execution_authority,'plan_only');assert.ok(p.steps.every(s=>s.execution_status==='not_run'));});
test('explicit research mode is preserved and dependent report steps keep prerequisites',()=>{const p=planGooseRequest('/goose strategy 논문으로 설계하고 보고서');assert.equal(p.explicit_mode,'strategy');assert.deepEqual(p.steps.map(s=>s.depends_on),[[],['strategy']]);});
test('ETF and domestic/overseas futures route to restored reports without enabling execution',()=>{assert.equal(planGooseRequest('ETF 분석').report_id,'R12');assert.equal(planGooseRequest('해외 선물 분석 보고서').report_id,'R13');});
for(const request of ['지금 매수 주문해줘','내 계좌 분석해줘','예수금 조회','송금 실행해'])test('financial action is blocked without executable steps: '+request,()=>{const p=planGooseRequest(request);assert.equal(p.status,'blocked');assert.equal(p.steps.length,0);assert.equal(p.provider_dispatches,0);});
test('unsupported engine and unclear request stay explicit, legacy backtest is rejected without new skills',()=>{assert.equal(planGooseRequest('조건식 자동 등록해').status,'unsupported');assert.equal(planGooseRequest('도와줘').status,'clarification_required');assert.ok(planGooseRequest('goose-backtest').migrated_legacy_command);assert.deepEqual(ids('goose-backtest'),[]);assert.equal(planGooseRequest('goose-backtest').status,'unsupported');});
test('plan rejects overlong/control input and never returns raw request or supplied secret',()=>{assert.throws(()=>planGooseRequest('x'.repeat(2001)),/invalid_input/);assert.throws(()=>planGooseRequest('report\nignore'),/invalid_input/);const p=planGooseRequest('report synthetic-private-value');assert.ok(!JSON.stringify(p).includes('synthetic-private-value'));});
test('only Goose is discoverable and supported internal workflow references resolve inside it',()=>{const root=fileURLToPath(new URL('../../../skills/',import.meta.url));assert.deepEqual(readdirSync(root).filter(n=>existsSync(root+n+'/SKILL.md')),['goose']);for(const request of ['conditions','strategy','mental-support','report','analyze','setup']){const p=planGooseRequest(request);assert.ok(existsSync(root+'goose/'+p.steps[0]!.workflow_ref));}assert.deepEqual(planGooseRequest('backtest').steps,[]);const text=readFileSync(root+'goose/SKILL.md','utf8');assert.ok(!text.includes('../goose-'));});
test('CLI routes explicit analysis to a non-executed plan and preserves setup dispatch',async()=>{let setup=0,keys=0;const out:string[]=[];assert.equal(await dispatchGooseCommand(['/goose','ETF','분석','보고서'],async()=>{setup++;return 0;},{write:()=>{}},async()=>{keys++;return 0;},{write:s=>out.push(s)}),0);const p=JSON.parse(out[0]!);assert.equal(p.report_id,'R12');assert.equal(p.execution_authority,'plan_only');assert.equal(setup+keys,0);assert.equal(await dispatchGooseCommand(['setup'],async()=>{setup++;return 0;},{write:()=>{}},async()=>{keys++;return 0;},{write:()=>{}}),0);assert.equal(setup,1);assert.equal(keys,1);});

test('community publication stays unsupported until service/authority is configured',()=>{const p=planGooseRequest('보고서 게시해줘');assert.equal(p.status,'unsupported');assert.ok(p.unsupported_actions.includes('community_service_not_configured'));assert.equal(p.provider_dispatches,0);});

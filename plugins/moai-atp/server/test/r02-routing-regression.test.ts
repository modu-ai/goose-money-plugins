import test from 'node:test';
import assert from 'node:assert/strict';
import { planGooseRequest } from '../src/goose-routing.js';
for (const [label, request, expected] of [
 ['two stocks', '두 종목 비교 분석', 'R02'],
 ['named stocks', '삼성전자와 SK하이닉스 종목 비교', 'R02'],
 ['three stocks', '세 종목 비교 분석', 'R02'],
 ['four stocks', '네 종목 비교 분석', 'R02'],
 ['two numeric stocks', '2개 종목 비교 분석', 'R02'],
 ['three numeric stocks', '3개 종목 비교 분석', 'R02'],
 ['four numeric stocks', '4개 종목 비교 분석', 'R02'],
 ['negation topic', '두 종목 비교는 하지 말고 삼성전자 종목 분석', 'R01'],
 ['negation object', '두 종목 비교를 하지 말고 삼성전자 종목 분석', 'R01'],
 ['single', '삼성전자 종목 분석', 'R01'],
 ['ETF comparison', 'ETF 비교 분석', 'R12'],
 ['futures comparison', '선물 비교 분석', 'R13'],
 ['negated comparison', '두 종목 비교하지 말고 분석', 'R01'],
 ['quoted comparison', '"두 종목 비교" 문구 분석', 'R01'],
 ['indicator comparison', '종목 이동평균 비교 분석', 'R01'],
] as const) test(label, () => {const p=planGooseRequest(request); assert.equal(p.report_id,expected); assert.equal(p.provider_dispatches,0);});
test('explicit analyze mode',()=>{const p=planGooseRequest('/goose analyze 두 종목 비교 분석');assert.equal(p.explicit_mode,'analyze');assert.equal(p.report_id,'R02');});
test('setup remains explicit',()=>{const p=planGooseRequest('/goose setup 두 종목 비교 분석');assert.equal(p.explicit_mode,'setup');assert.equal(p.report_id,null);});
test('explicit report preserves mode',()=>{const p=planGooseRequest('/goose report 두 종목 비교 분석');assert.equal(p.explicit_mode,'report');assert.equal(p.report_id,'R02');});
for(const request of ['내 계좌 두 종목 비교 분석','두 종목 비교 후 매수 주문해줘'])test('financial action remains blocked: '+request,()=>{const p=planGooseRequest(request);assert.equal(p.status,'blocked');assert.equal(p.steps.length,0);assert.equal(p.provider_dispatches,0);});
test('unclear request remains a question',()=>{const p=planGooseRequest('도와줘');assert.equal(p.status,'clarification_required');assert.equal(p.report_id,null);});
for(const count of ['12','13','14','22','24','2.3'])test(`numeric count ${count} is not a supported two-to-four stock count`,()=>{
 const p=planGooseRequest(`${count}개 종목 비교 분석`);assert.equal(p.report_id,'R01');assert.equal(p.provider_dispatches,0);
});
for(const id of ['R01','R03'])test(`explicit ${id} outranks natural comparison wording`,()=>{
 const p=planGooseRequest(`/goose report ${id} 두 종목 비교 분석`);assert.equal(p.report_id,id);assert.equal(p.provider_dispatches,0);
});

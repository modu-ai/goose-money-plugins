import test from 'node:test';
import assert from 'node:assert/strict';
import { searchInstruments, InstrumentSearchResultSchema, InstrumentDirectorySchema } from '../src/instrument-directory.js';
const at = '2026-10-22T00:02:00Z';
const entry = { instrument_ref: 'TEST:000660', symbol: '000660', name: 'Synthetic Company', market: 'KR' as const, asset_class: 'equity' as const, exchange: null, currency: null, cik: null, corp_code: null, aliases: ['합성회사'], source_ref: 'synthetic-fixture' };
const directory = { origin: 'synthetic', source_received_at: '2026-10-22T00:00:00Z', source_as_of: null, source_url: 'https://example.invalid/synthetic', coverage: 'Synthetic examples only', entries: [entry] };
const loader = (d: unknown = directory) => ({ async load() { return d; } });
test('directory exact identifier and Unicode name matches preserve nonconfirmed identity', async () => { for (const query of ['000660', '합성회사', 'Synthetic Company']) {
    const r = await searchInstruments({ query }, loader(), () => at);
    assert.equal(r.resolution_status, 'single_candidate_not_confirmed');
    assert.equal(r.candidates[0]?.identity_status, 'directory_candidate_not_confirmed');
    assert.equal(r.candidates[0]?.currency, null);
} });
test('ambiguity is preserved and truncation never silently resolves a candidate', async () => { const r = await searchInstruments({ query: 'Synthetic', limit: 1 }, loader({ ...directory, entries: [entry, { ...entry, instrument_ref: 'TEST:000661', symbol: '000661' }] }), () => at); assert.equal(r.match_count, 2); assert.equal(r.truncated, true); assert.equal(r.resolution_status, 'ambiguous'); });
test('market/class filters and no match explicitly describe supplied directory scope', async () => { const r = await searchInstruments({ query: 'Synthetic', market: 'US' }, loader(), () => at); assert.equal(r.resolution_status, 'no_match_in_supplied_directory'); assert.equal(r.match_count, 0); });
test('invalid input does not load a directory', async () => { let calls = 0; const l = { async load() { calls++; return directory; } }; for (const q of [{ query: '' }, { query: 'x', key: 'secret' }, { query: 'x', limit: 21 }, { query: 'x\n' }]) {
    if (q.query === 'x\n')
        q.query = 'x\u0000';
    await assert.rejects(searchInstruments(q, l, () => at));
} assert.equal(calls, 0); });
test('duplicate refs and future source receipt are rejected', async () => { await assert.rejects(searchInstruments({ query: 'x' }, loader({ ...directory, entries: [entry, entry] }), () => at)); await assert.rejects(searchInstruments({ query: 'x' }, loader({ ...directory, source_received_at: '2026-10-23T00:00:00Z' }), () => at)); });
test('result refinements reject forged query match, identity, count and market', async () => { const r = await searchInstruments({ query: '000660', market: 'KR' }, loader(), () => at); for (const mutate of [(x: any) => x.match_count = 2, (x: any) => x.candidates[0].match_basis = 'name_substring', (x: any) => x.candidates[0].market = 'US', (x: any) => x.candidates[0].identity_status = 'verified']) {
    const x = structuredClone(r);
    mutate(x);
    assert.equal(InstrumentSearchResultSchema.safeParse(x).success, false);
} });
test('directory snapshots reject getters and hidden serialization hooks without invocation', async () => { let touched = false; const d = { ...directory }; Object.defineProperty(d, 'toJSON', { value: () => { touched = true; return directory; } }); await assert.rejects(searchInstruments({ query: '000660' }, loader(d), () => at)); assert.equal(touched, false); });
test('directory receipt ordering is exact below milliseconds', async () => { await assert.rejects(searchInstruments({ query: '000660' }, loader({ ...directory, source_received_at: '2026-10-22T00:02:00.000000001Z' }), () => at)); });

test('malformed directory and search timestamps do not throw from safeParse',async()=>{assert.equal(InstrumentDirectorySchema.safeParse({...directory,source_received_at:'bad',source_as_of:at}).success,false);const r=await searchInstruments({query:'000660'},loader(),()=>at);for(const key of ['received_at','source_received_at','source_as_of']){const x=structuredClone(r);(x as any)[key]='bad';assert.equal(InstrumentSearchResultSchema.safeParse(x).success,false);}});

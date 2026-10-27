import { compareInstants, ExactInstantSchema } from './exact-instant.js';
import { boundedBody } from './global-market-data.js';
import { z } from 'zod';
const Code = z.string().min(1).max(40).regex(/^[A-Za-z0-9._:-]+$/);
const Origin = z.enum(['actual', 'synthetic']);
const Entry = z.object({ instrument_ref: Code, symbol: Code, name: z.string().min(1).max(300), market: z.enum(['KR', 'US', 'unknown']), asset_class: z.enum(['equity', 'etf', 'future', 'unknown']), exchange: z.string().min(1).max(60).nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(), cik: z.string().regex(/^\d{10}$/).nullable(), corp_code: z.string().regex(/^\d{8}$/).nullable(), aliases: z.array(z.string().min(1).max(300)).max(20), source_ref: z.string().min(1).max(200) }).strict();
export const InstrumentDirectorySchema = z.object({ origin: Origin, source_received_at: ExactInstantSchema, source_as_of: ExactInstantSchema.nullable(), source_url: z.string().url(), entries: z.array(Entry).max(20000), coverage: z.string().min(1).max(500) }).strict().superRefine((x, c) => { if(![x.source_received_at,x.source_as_of].every(value=>value===null||ExactInstantSchema.safeParse(value).success))return; if (new Set(x.entries.map(e => e.instrument_ref)).size !== x.entries.length)
    c.addIssue({ code: 'custom', message: 'duplicate_instrument_ref' }); if (x.source_as_of && compareInstants(x.source_as_of, x.source_received_at) > 0)
    c.addIssue({ code: 'custom', message: 'source_time_conflict' }); });
export const InstrumentSearchInputSchema = z.object({ query: z.string().trim().min(1).max(80).refine(s => !/[\u0000-\u001f\u007f]/.test(s)), market: z.enum(['KR', 'US']).optional(), asset_class: z.enum(['equity', 'etf', 'future']).optional(), limit: z.number().int().min(1).max(20).default(10) }).strict();
const Match = Entry.extend({ match_basis: z.enum(['exact_identifier', 'exact_name', 'name_substring']), identity_status: z.literal('directory_candidate_not_confirmed') }).strict();
export const InstrumentSearchResultSchema = z.object({ contract: z.literal('moai.instrument.search.v1'), request: InstrumentSearchInputSchema, origin: Origin, received_at: ExactInstantSchema, source_received_at: ExactInstantSchema, source_as_of: ExactInstantSchema.nullable(), source_url: z.string().url(), coverage: z.string().min(1).max(500), rights_status: z.literal('pending'), resolution_status: z.enum(['no_match_in_supplied_directory', 'single_candidate_not_confirmed', 'ambiguous']), match_count: z.number().int().nonnegative(), truncated: z.boolean(), candidates: z.array(Match).max(20), warnings: z.array(z.string()).min(1) }).strict().superRefine((x, c) => {
    if(![x.received_at,x.source_received_at,x.source_as_of].every(value=>value===null||ExactInstantSchema.safeParse(value).success))return;
    if (compareInstants(x.source_received_at, x.received_at) > 0 || (x.source_as_of && compareInstants(x.source_as_of, x.source_received_at) > 0))
        c.addIssue({ code: 'custom', message: 'time_conflict' });
    if (x.candidates.length !== Math.min(x.match_count, x.request.limit) || x.truncated !== (x.match_count > x.candidates.length) || x.resolution_status !== (x.match_count === 0 ? 'no_match_in_supplied_directory' : x.match_count === 1 ? 'single_candidate_not_confirmed' : 'ambiguous'))
        c.addIssue({ code: 'custom', message: 'resolution_conflict' });
    if (new Set(x.candidates.map(e => e.instrument_ref)).size !== x.candidates.length)
        c.addIssue({ code: 'custom', message: 'duplicate_candidate' });
    for (const entry of x.candidates)
        if ((x.request.market && entry.market !== x.request.market) || (x.request.asset_class && entry.asset_class !== x.request.asset_class) || match(entry, x.request.query) !== entry.match_basis)
            c.addIssue({ code: 'custom', message: 'query_match_conflict' });
});
export interface InstrumentDirectoryLoader {
    load(): Promise<unknown>;
}
const key = (s: string) => s.normalize('NFKC').toLocaleLowerCase('en-US');
function match(e: z.infer<typeof Entry>, query: string): 'exact_identifier' | 'exact_name' | 'name_substring' | null { const q = key(query); if ([e.instrument_ref, e.symbol, e.cik, e.corp_code].some(v => v !== null && key(v) === q))
    return 'exact_identifier'; if ([e.name, ...e.aliases].some(v => key(v) === q))
    return 'exact_name'; if ([e.name, ...e.aliases].some(v => key(v).includes(q)))
    return 'name_substring'; return null; }
export async function searchInstruments(input: unknown, loader: InstrumentDirectoryLoader, clock: () => string = () => new Date().toISOString()) {
    const q = InstrumentSearchInputSchema.safeParse(input);
    if (!q.success)
        throw new Error('invalid_input');
    const source = InstrumentDirectorySchema.safeParse(boundedBody(await loader.load(), { maxBytes: 5000000, maxNodes: 500000, maxKeys: 20001 }));
    const received_at = clock();
    if (!source.success)
        throw new Error('schema_drift');
    const d = source.data;
    const rank = { exact_identifier: 0, exact_name: 1, name_substring: 2 };
    const matches = d.entries.filter(e => (!q.data.market || e.market === q.data.market) && (!q.data.asset_class || e.asset_class === q.data.asset_class)).flatMap(e => { const basis = match(e, q.data.query); return basis ? [{ ...e, match_basis: basis, identity_status: 'directory_candidate_not_confirmed' as const }] : []; }).sort((a, b) => rank[a.match_basis] - rank[b.match_basis] || (a.instrument_ref < b.instrument_ref ? -1 : a.instrument_ref > b.instrument_ref ? 1 : 0));
    return InstrumentSearchResultSchema.parse({ contract: 'moai.instrument.search.v1', request: q.data, origin: d.origin, received_at, source_received_at: d.source_received_at, source_as_of: d.source_as_of, source_url: d.source_url, coverage: d.coverage, rights_status: 'pending', resolution_status: matches.length === 0 ? 'no_match_in_supplied_directory' : matches.length === 1 ? 'single_candidate_not_confirmed' : 'ambiguous', match_count: matches.length, truncated: matches.length > q.data.limit, candidates: matches.slice(0, q.data.limit), warnings: ['Search only covers the supplied directory; no match does not prove nonexistence.', 'Directory candidates require independent identity, current listing/classification and source-rights verification. Never auto-select an ambiguous candidate.', 'No account lookup or credential handling occurs. The directory may be injected, or in the default runtime wiring (rights switch on) built from the official KIS KOSPI/KOSDAQ master files downloaded on first use; master file usage rights are pending.'] });
}

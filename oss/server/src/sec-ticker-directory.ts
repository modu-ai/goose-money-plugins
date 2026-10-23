import { z } from 'zod';
import { InstrumentDirectorySchema, type InstrumentDirectoryLoader } from './instrument-directory.js';
export const SEC_TICKER_DIRECTORY_URL = 'https://www.sec.gov/files/company_tickers.json';
const Context = z.object({ origin: z.enum(['actual', 'synthetic']), received_at: z.string().datetime({ offset: true }) }).strict();
const Entry = z.object({ cik_str: z.number().int().min(1).max(9999999999), ticker: z.string().min(1).max(30).regex(/^[A-Za-z0-9][A-Za-z0-9.-]*$/), title: z.string().min(1).max(300) }).strict();
export function parseSecTickerDirectory(text: unknown, context: unknown) {
    const c = Context.safeParse(context);
    if (!c.success)
        throw new Error('invalid_input');
    if (typeof text !== 'string')
        throw new Error('invalid_input');
    if (Buffer.byteLength(text, 'utf8') > 3000000)
        throw new Error('response_too_large');
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new Error('schema_drift');
    }
    const raw = z.record(z.string().regex(/^\d+$/), Entry).safeParse(parsed);
    if (!raw.success)
        throw new Error('schema_drift');
    const rows = Object.entries(raw.data);
    if (rows.length > 20000)
        throw new Error('response_too_large');
    return InstrumentDirectorySchema.parse({ origin: c.data.origin, source_received_at: c.data.received_at, source_as_of: null, source_url: SEC_TICKER_DIRECTORY_URL, coverage: 'SEC company ticker/CIK/name associations only. SEC does not guarantee accuracy or scope; exchange, country of listing, currency and asset type unverified.', entries: rows.map(([index, row]) => ({ instrument_ref: `SEC:${String(row.cik_str).padStart(10, '0')}:${row.ticker}`, symbol: row.ticker, name: row.title, market: 'unknown', asset_class: 'unknown', exchange: null, currency: null, cik: String(row.cik_str).padStart(10, '0'), corp_code: null, aliases: [], source_ref: `sec_company_tickers_row_${index}` })) });
}
export interface SecTickerSource {
    origin: 'actual' | 'synthetic';
    read(request: {
        operation: 'sec.ticker_directory';
        method: 'GET';
        url: typeof SEC_TICKER_DIRECTORY_URL;
    }): Promise<{
        status: number;
        body_text: string;
    }>;
}
/** No built-in network fallback, persistence or directory freshness promise. */
export class SecTickerDirectoryLoader implements InstrumentDirectoryLoader {
    constructor(private readonly source: SecTickerSource, private readonly clock: () => string = () => new Date().toISOString()) { }
    async load() { const response = await this.source.read(Object.freeze({ operation: 'sec.ticker_directory', method: 'GET', url: SEC_TICKER_DIRECTORY_URL })); const received_at = this.clock(); if (response.status !== 200)
        throw new Error('upstream_rejected'); return parseSecTickerDirectory(response.body_text, { origin: this.source.origin, received_at }); }
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  parseKisKrStockMaster, KisKrStockMasterParseResultSchema, KisKrStockMasterRawSchema, KIS_KOSPI_MASTER_TAIL_FIELDS, KIS_KOSDAQ_MASTER_TAIL_FIELDS,
  decodeKisCp949, KisMasterDirectoryLoader, KisMasterError, KIS_MASTER_PROFILES, KIS_US_MASTER_COLUMNS,
  KisUsMasterRawSchema, KisUsMasterParseResultSchema, KisDomesticIndexMasterParseResultSchema,
  parseKisUsStockMaster, parseKisDomesticIndexMaster,
  type KisMasterSource, type KisMasterReadRequest,
} from '../src/kis-instrument-master.js';
import { searchInstruments, InstrumentDirectorySchema } from '../src/instrument-directory.js';

const NOW = '2026-10-22T02:00:00.000Z';
const context = { profile: 'nas', origin: 'synthetic', source_received_at: NOW };
const indexContext = { ...context, profile: 'kr_index_derivatives' };
function row(overrides: Record<number, string> = {}) {
  const fields = ['US', 'NAS', 'NAS', 'NASDAQ', 'AAPL', 'DNASAAPL', 'SYNTHETIC APPLE', 'SYNTHETIC APPLE INC', '2', 'USD', '4', '1',
    '123.4567', '1', '1', '0930', '1600', 'N', '', '1234', '0', '1', '', ''];
  for (const [key, value] of Object.entries(overrides)) fields[Number(key)] = value;
  return fields.join('\t');
}
function indexRow(overrides: Record<number, string> = {}) {
  const fields = ['1', '101W09', 'KR4101W90009', 'SYNTHETIC INDEX FUTURE', '', '0', '1', '2001', 'SYNTHETIC UNDERLYING'];
  for (const [key, value] of Object.entries(overrides)) fields[Number(key)] = value;
  return fields.join('|');
}
function code(fn: () => unknown, expected: string) {
  assert.throws(fn, (error: unknown) => error instanceof KisMasterError && error.code === expected && error.message === expected);
}
async function rejectsCode(fn: Promise<unknown>, expected: string) {
  await assert.rejects(fn, (error: unknown) => error instanceof KisMasterError && error.code === expected && error.message === expected);
}

test('official 24-column US format produces directory candidates with provenance and exact raw values', () => {
  const result = parseKisUsStockMaster(row() + '\r\n', context);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.raw.base, '123.4567');
  assert.equal(result.records[0]?.source_line, 1);
  assert.deepEqual(result.directory.entries[0], { instrument_ref: 'kis:US:NAS:AAPL', symbol: 'AAPL', name: 'SYNTHETIC APPLE INC',
    market: 'US', asset_class: 'equity', exchange: 'NAS', currency: 'USD', cik: null, corp_code: null,
    aliases: ['SYNTHETIC APPLE', 'DNASAAPL'], source_ref: 'kis:nasmst.cod:line:1' });
  assert.equal(result.directory.source_url, KIS_MASTER_PROFILES.nas.source_url);
  assert.equal(result.directory.source_as_of, null);
  assert.equal(result.metadata.source_authenticity, 'unverified_injected_content');
  assert.equal(result.metadata.format_status, 'official_layout_checked_not_live_master_reconciled');
  assert.equal(result.metadata.archive_ingestion, 'not_implemented');
  assert.equal(result.metadata.rights_status, 'pending');
  assert.equal(result.metadata.payload_sha256, createHash('sha256').update(row() + '\r\n').digest('hex'));
  assert.ok(InstrumentDirectorySchema.safeParse(result.directory).success);
});

test('NAS NYS AMS profiles require matching explicit US country and exchange fields', () => {
  for (const [profile, exchange] of [['nas', 'NAS'], ['nys', 'NYS'], ['ams', 'AMS']] as const) {
    const result = parseKisUsStockMaster(row({ 2: exchange }), { ...context, profile });
    assert.equal(result.directory.entries[0]?.exchange, exchange);
    assert.equal(result.directory.source_url, KIS_MASTER_PROFILES[profile].source_url);
  }
  code(() => parseKisUsStockMaster(row({ 2: 'NYS' }), context), 'source_mismatch');
  code(() => parseKisUsStockMaster(row({ 0: 'CN' }), context), 'schema_drift');
  code(() => parseKisUsStockMaster(row(), { ...context, profile: 'hks' }), 'invalid_input');
  code(() => parseKisUsStockMaster(row(), indexContext), 'invalid_input');
  code(() => parseKisUsStockMaster(row(), { ...context, source_url: 'https://example.invalid' }), 'invalid_input');
});

test('ETF classification requires documented security and subtype evidence, never exchange/name inference', () => {
  for (const subtype of ['001', '005']) {
    const result = parseKisUsStockMaster(row({ 8: '3', 22: subtype }), context);
    assert.equal(result.directory.entries[0]?.asset_class, 'etf');
  }
  for (const subtype of ['', '002', '003', '004', '006', '999']) {
    const result = parseKisUsStockMaster(row({ 7: 'SYNTHETIC ETF NAME', 8: '3', 22: subtype }), context);
    assert.equal(result.directory.entries[0]?.asset_class, 'unknown');
  }
  for (const type of ['1', '4', '9']) assert.equal(parseKisUsStockMaster(row({ 8: type }), context).directory.entries[0]?.asset_class, 'unknown');
  code(() => parseKisUsStockMaster(row({ 8: '2', 22: '001' }), context), 'classification_conflict');
});

test('currency is copied only from an explicit supported raw code, never from US market', () => {
  for (const currency of ['', 'US$', 'ZZZ', 'usd']) assert.equal(parseKisUsStockMaster(row({ 9: currency }), context).directory.entries[0]?.currency, null);
  assert.equal(parseKisUsStockMaster(row({ 9: 'EUR' }), context).directory.entries[0]?.currency, 'EUR');
});

test('first data row is never inferred to be a header or silently skipped', () => {
  const records = row() + '\n' + row({ 4: 'MSFT', 5: 'DNASMSFT', 7: 'SYNTHETIC MICROSOFT' });
  assert.equal(parseKisUsStockMaster(records, context).records.length, 2);
  const withHeader = KIS_US_MASTER_COLUMNS.join('\t') + '\n' + records;
  const result = parseKisUsStockMaster(withHeader, { ...context, header_mode: 'documented_columns' });
  assert.equal(result.records.length, 2); assert.equal(result.records[0]?.source_line, 2);
  code(() => parseKisUsStockMaster(withHeader, context), 'schema_drift');
  code(() => parseKisUsStockMaster(records, { ...context, header_mode: 'documented_columns' }), 'schema_drift');
  code(() => parseKisUsStockMaster(KIS_US_MASTER_COLUMNS.join('\t'), { ...context, header_mode: 'documented_columns' }), 'empty_master');
});

test('CSV-style quotes preserve names while malformed or multiline records reject', () => {
  const result = parseKisUsStockMaster(row({ 7: '"SYNTHETIC ""QUOTED"" NAME"' }), context);
  assert.equal(result.records[0]?.raw.enam, 'SYNTHETIC "QUOTED" NAME');
  for (const name of ['"unfinished', 'bad"quote', '"valid"trailing', '"embedded\nnewline"']) {
    code(() => parseKisUsStockMaster(row({ 7: name }), context), 'schema_drift');
  }
});

test('strict bounds reject wrong columns, blank records, controls, malformed numeric/time values', () => {
  for (const text of [row() + '\tunexpected', row().split('\t').slice(0, 23).join('\t'), row() + '\n\n' + row(), row() + '\r']) {
    code(() => parseKisUsStockMaster(text, context), 'schema_drift');
  }
  for (const text of ['', '\n']) code(() => parseKisUsStockMaster(text, context), 'empty_master');
  for (const text of [row({ 7: 'BAD\u0000NAME' }), row({ 7: '\uFFFD' }), row({ 7: '\uD800' })]) code(() => parseKisUsStockMaster(text, context), 'encoding_invalid');
  for (const override of [{ 12: '1e3' }, { 13: '1.5' }, { 15: '2460' }, { 16: '9:30' }, { 4: '../AAPL' }, { 5: '' }, { 6: '', 7: '' }]) {
    code(() => parseKisUsStockMaster(row(override), context), 'schema_drift');
  }
  code(() => parseKisUsStockMaster('x'.repeat(5000001), context), 'master_too_large');
  code(() => parseKisUsStockMaster('x'.repeat(4097), context), 'master_too_large');
  code(() => parseKisUsStockMaster(Array(20001).fill(row()).join('\n'), context), 'master_too_large');
});

test('duplicate ticker and realtime identity are rejected, not last-write-wins', () => {
  code(() => parseKisUsStockMaster(row() + '\n' + row(), context), 'duplicate_identity');
  code(() => parseKisUsStockMaster(row() + '\n' + row({ 4: 'MSFT' }), context), 'duplicate_identity');
  code(() => parseKisUsStockMaster(row() + '\n' + row({ 5: 'DNASMSFT' }), context), 'duplicate_identity');
});

test('complete CP949 decoding covers common Korean and UHC extension, with no replacement fallback', () => {
  assert.equal(decodeKisCp949(Uint8Array.from([0xb0, 0xa1])), '가');
  assert.equal(decodeKisCp949(Uint8Array.from([0x81, 0x41])), '갂');
  assert.equal(decodeKisCp949(Uint8Array.from([0x41, 0x09, 0x0a])), 'A\t\n');
  for (const bytes of [[0x81], [0x81, 0x40], [0xff], [0xff, 0xff]]) code(() => decodeKisCp949(Uint8Array.from(bytes)), 'encoding_invalid');
  const before = Buffer.from(row({ 6: 'PLACEHOLDER' }).split('PLACEHOLDER')[0]!, 'ascii');
  const after = Buffer.from(row({ 6: 'PLACEHOLDER' }).split('PLACEHOLDER')[1]!, 'ascii');
  const bytes = Buffer.concat([before, Buffer.from([0x81, 0x41]), after]);
  const result = parseKisUsStockMaster(bytes, context);
  assert.equal(result.records[0]?.raw.knam, '갂');
  assert.equal(result.metadata.encoding_status, 'cp949_bytes_decoded');
  assert.equal(result.metadata.payload_sha256, createHash('sha256').update(bytes).digest('hex'));
});

test('CP949 decoder exhaustively reconstructs the pinned standard-codec mapping', () => {
  const reconstructed = Buffer.alloc(131072); let count = 0;
  for (let lead = 0x81; lead <= 0xfe; lead++) for (let trail = 0x41; trail <= 0xfe; trail++) {
    try {
      const decoded = decodeKisCp949(Uint8Array.from([lead, trail]));
      assert.equal(decoded.length, 1);
      reconstructed.writeUInt16LE(decoded.charCodeAt(0), ((lead << 8) | trail) * 2); count++;
    } catch (error) { if (!(error instanceof KisMasterError && error.code === 'encoding_invalid')) throw error; }
  }
  assert.equal(count, 17048);
  assert.equal(createHash('sha256').update(reconstructed).digest('hex'), 'cbb0fe3235481f5a0e98420188f4822908fc8823b8eb0e2ba6bc92acd3a01341');
});

test('official nine-column domestic index format distinguishes futures from options/spreads', () => {
  for (const info_type of ['1', '3', '7', '9', 'B']) {
    const result = parseKisDomesticIndexMaster(indexRow({ 0: info_type }), indexContext);
    assert.equal(result.directory.entries[0]?.asset_class, 'future');
    assert.equal(result.directory.entries[0]?.currency, null);
    assert.equal(result.directory.entries[0]?.exchange, null);
    assert.equal(result.directory.entries[0]?.market, 'KR');
    assert.equal(result.records[0]?.raw.unas_shrn_iscd, '2001');
    assert.deepEqual(result.directory.entries[0]?.aliases, ['KR4101W90009']);
  }
  for (const info_type of ['2', '4', '5', '6', '8', 'A', 'C', 'D', 'E', 'J', 'K', 'L', 'M', 'Z']) {
    assert.equal(parseKisDomesticIndexMaster(indexRow({ 0: info_type }), indexContext).directory.entries[0]?.asset_class, 'unknown');
  }
});

test('domestic index schema and identity constraints reject unsafe input', () => {
  code(() => parseKisDomesticIndexMaster(indexRow(), context), 'invalid_input');
  code(() => parseKisDomesticIndexMaster(indexRow(), { ...indexContext, header_mode: 'documented_columns' }), 'invalid_input');
  code(() => parseKisDomesticIndexMaster(indexRow() + '|extra', indexContext), 'schema_drift');
  code(() => parseKisDomesticIndexMaster(indexRow() + '\n' + indexRow(), indexContext), 'duplicate_identity');
  code(() => parseKisDomesticIndexMaster(indexRow() + '\n' + indexRow({ 1: '101W12' }), indexContext), 'duplicate_identity');
  code(() => parseKisDomesticIndexMaster(indexRow({ 5: '1e3' }), indexContext), 'schema_drift');
});

test('loader samples receipt time after the bounded extracted source read and integrates with search', async () => {
  const events: string[] = []; const requests: KisMasterReadRequest[] = [];
  const source: KisMasterSource = { origin: 'synthetic', async read(request) { requests.push(request); events.push('read'); await Promise.resolve(); events.push('received'); return { filename: 'nasmst.cod', contents: row() }; } };
  const loader = new KisMasterDirectoryLoader('nas', source, () => { events.push('clock'); return NOW; });
  const result = await searchInstruments({ query: 'AAPL' }, loader, () => '2026-10-22T02:00:01.000Z');
  assert.deepEqual(events, ['read', 'received', 'clock']);
  assert.deepEqual(requests, [{ profile: 'nas', filename: 'nasmst.cod' }]);
  assert.ok(Object.isFrozen(requests[0]));
  assert.equal(result.resolution_status, 'single_candidate_not_confirmed');
  assert.equal(result.candidates[0]?.symbol, 'AAPL');
  assert.equal(result.candidates[0]?.identity_status, 'directory_candidate_not_confirmed');
  assert.equal(result.source_received_at, NOW);
  assert.equal(result.rights_status, 'pending');
});

test('loader refuses wrong filenames, unknown profiles, extras and unconfigured sources', async () => {
  await rejectsCode(new KisMasterDirectoryLoader('nas').load(), 'master_source_not_configured');
  code(() => new KisMasterDirectoryLoader('../nas'), 'invalid_input');
  await rejectsCode(new KisMasterDirectoryLoader('nas', { origin: 'synthetic', async read() { return { filename: 'nysmst.cod', contents: row() }; } }, () => NOW).load(), 'source_mismatch');
  await rejectsCode(new KisMasterDirectoryLoader('nas', { origin: 'synthetic', async read() { return { filename: 'nasmst.cod', contents: row(), url: 'https://example.invalid' }; } }, () => NOW).load(), 'schema_drift');
  await rejectsCode(new KisMasterDirectoryLoader('nas', { origin: 'synthetic', async read() { throw new Error('private source details'); } }, () => NOW).load(), 'source_unavailable');
});

test('parser and loader provenance reject invalid origin/time while keeping source_as_of unknown', async () => {
  code(() => parseKisUsStockMaster(row(), { ...context, origin: 'live' }), 'invalid_input');
  code(() => parseKisUsStockMaster(row(), { ...context, source_received_at: '2026-02-30T00:00:00Z' }), 'invalid_input');
  code(() => parseKisUsStockMaster(row(), { ...context, source_as_of: NOW }), 'invalid_input');
  for (const origin of ['actual', 'synthetic'] as const) {
    const loader = new KisMasterDirectoryLoader('nas', { origin, async read() { return { filename: 'nasmst.cod', contents: row() }; } }, () => NOW);
    const directory = await loader.load(); assert.equal(directory.origin, origin); assert.equal(directory.source_as_of, null);
  }
});

test('no network or archive extraction path exists in the loader', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('not allowed'); };
  try {
    await rejectsCode(new KisMasterDirectoryLoader('nas').load(), 'master_source_not_configured');
    const source: KisMasterSource = { origin: 'synthetic', async read() { return { filename: 'nasmst.cod', contents: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]) }; } };
    await rejectsCode(new KisMasterDirectoryLoader('nas', source, () => NOW).load(), 'encoding_invalid');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('runtime parser result and raw schemas are JSON-schema exportable', () => {
  for (const schema of [KisUsMasterRawSchema, KisUsMasterParseResultSchema, KisDomesticIndexMasterParseResultSchema]) assert.ok(z.toJSONSchema(schema).$schema);
});

function krRow(board: 'kospi' | 'kosdaq', overrides: Record<string, string> = {}, symbol = '005930', standard = 'KR7005930003', name = 'SYNTHETIC KOREAN NAME', eol = '\n') {
  const defaults: Record<string, string> = { scrt_grp_cls_code: 'ST', etp_prod_cls_code: '0', stck_lstn_date: '20261001', stck_sdpr: '123456', ...overrides };
  const fields = board === 'kospi' ? KIS_KOSPI_MASTER_TAIL_FIELDS : KIS_KOSDAQ_MASTER_TAIL_FIELDS;
  return symbol.padEnd(9) + standard + name + fields.map(([key, width]) => (defaults[key] ?? '').padEnd(width)).join('') + eol;
}

test('KOSPI/KOSDAQ official tails reconcile Python line widths and expose typed raw fields', () => {
  assert.equal(KIS_KOSPI_MASTER_TAIL_FIELDS.reduce((n, [, width]) => n + width, 0), 227);
  assert.equal(KIS_KOSDAQ_MASTER_TAIL_FIELDS.reduce((n, [, width]) => n + width, 0), 221);
  assert.equal(KIS_KOSPI_MASTER_TAIL_FIELDS.length, 70); assert.equal(KIS_KOSDAQ_MASTER_TAIL_FIELDS.length, 64);
  for (const board of ['kospi', 'kosdaq'] as const) {
    const result = parseKisKrStockMaster(krRow(board), { ...context, profile: board });
    assert.equal(result.records[0]?.raw.tail.stck_sdpr, '123456   ');
    assert.equal(result.records[0]?.raw.hts_kor_isnm, 'SYNTHETIC KOREAN NAME');
    assert.equal(result.directory.entries[0]?.asset_class, 'equity');
    assert.equal(result.directory.entries[0]?.currency, null); assert.equal(result.directory.entries[0]?.exchange, null);
    assert.equal(result.directory.entries[0]?.source_ref, `kis:${board}_code.mst:line:1`);
    assert.equal(result.directory.source_as_of, null);
    assert.equal(result.directory.source_url, KIS_MASTER_PROFILES[board].source_url);
    assert.ok(KisKrStockMasterParseResultSchema.safeParse(result).success);
    assert.ok(parseKisKrStockMaster(krRow(board, {}, '005930', 'KR7005930003', 'SYNTHETIC NAME', '\r\n'), { ...context, profile: board }));
  }
});

test('Korean fixed-width names survive variable decoded lengths, commas and CP949 extensions', () => {
  const row = krRow('kospi', {}, '005930', 'KR7005930003', 'NAMEPLACEHOLDER');
  const [before, after] = row.split('NAMEPLACEHOLDER');
  const bytes = Buffer.concat([Buffer.from(before!, 'ascii'), Buffer.from([0xb0, 0xa1, 0x81, 0x41]), Buffer.from(after!, 'ascii')]);
  const result = parseKisKrStockMaster(bytes, { ...context, profile: 'kospi' });
  assert.equal(result.directory.entries[0]?.name, '가갂');
  assert.equal(result.records[0]?.raw.tail.scrt_grp_cls_code, 'ST');
  const comma = parseKisKrStockMaster(krRow('kosdaq', {}, '005930', 'KR7005930003', 'SYNTHETIC, NAME'), { ...context, profile: 'kosdaq' });
  assert.equal(comma.directory.entries[0]?.name, 'SYNTHETIC, NAME');
});

test('Korean stock and ETF classes use documented group fields, never product-name inference', () => {
  for (const group of ['ST', 'FS']) assert.equal(parseKisKrStockMaster(krRow('kospi', { scrt_grp_cls_code: group }), { ...context, profile: 'kospi' }).directory.entries[0]?.asset_class, 'equity');
  for (const group of ['EF', 'FE']) for (const etp of ['0', '1', '2', ' ']) {
    assert.equal(parseKisKrStockMaster(krRow('kospi', { scrt_grp_cls_code: group, etp_prod_cls_code: etp }), { ...context, profile: 'kospi' }).directory.entries[0]?.asset_class, 'etf');
  }
  for (const group of ['RT', 'DR', 'BC', 'EN', 'ZZ']) assert.equal(parseKisKrStockMaster(krRow('kospi', { scrt_grp_cls_code: group }, '005930', 'KR7005930003', 'SYNTHETIC ETF NAME'), { ...context, profile: 'kospi' }).directory.entries[0]?.asset_class, 'unknown');
  assert.equal(parseKisKrStockMaster(krRow('kospi', { scrt_grp_cls_code: 'EF', etp_prod_cls_code: '9' }), { ...context, profile: 'kospi' }).directory.entries[0]?.asset_class, 'unknown');
  for (const etp of ['3', '4']) code(() => parseKisKrStockMaster(krRow('kospi', { scrt_grp_cls_code: 'EF', etp_prod_cls_code: etp }), { ...context, profile: 'kospi' }), 'classification_conflict');
  code(() => parseKisKrStockMaster(krRow('kospi', { etp_prod_cls_code: '1' }), { ...context, profile: 'kospi' }), 'classification_conflict');
});

test('fixed-width parser rejects missing terminators, malformed tail/date/number and duplicate IDs', () => {
  const c = { ...context, profile: 'kospi' };
  code(() => parseKisKrStockMaster(krRow('kospi').trimEnd(), c), 'schema_drift');
  code(() => parseKisKrStockMaster(krRow('kospi').replace(/\n$/, '\r'), c), 'schema_drift');
  code(() => parseKisKrStockMaster('short\n', c), 'schema_drift');
  code(() => parseKisKrStockMaster(krRow('kospi', { stck_lstn_date: '20260230' }), c), 'schema_drift');
  code(() => parseKisKrStockMaster(krRow('kospi', { stck_sdpr: '1e4' }), c), 'schema_drift');
  code(() => parseKisKrStockMaster(krRow('kospi', { scrt_grp_cls_code: '한' }), c), 'schema_drift');
  code(() => parseKisKrStockMaster(krRow('kospi', {}, '005930', 'US7005930003'), c), 'schema_drift');
  code(() => parseKisKrStockMaster(krRow('kospi') + krRow('kospi'), c), 'duplicate_identity');
  code(() => parseKisKrStockMaster(krRow('kospi') + krRow('kospi', {}, '005931'), c), 'duplicate_identity');
  code(() => parseKisKrStockMaster(krRow('kospi'), context), 'invalid_input');
  code(() => parseKisKrStockMaster(krRow('kospi'), { ...c, header_mode: 'documented_columns' }), 'invalid_input');
});

test('Korean board loader integrates offline Korean-name lookup without automatic selection', async () => {
  const loader = new KisMasterDirectoryLoader('kospi', { origin: 'synthetic', async read(request) {
    assert.deepEqual(request, { profile: 'kospi', filename: 'kospi_code.mst' });
    return { filename: request.filename, contents: krRow('kospi', { scrt_grp_cls_code: 'EF', etp_prod_cls_code: '2' }, '069500', 'KR7069500007', '가상 한국 ETF') };
  } }, () => NOW);
  const result = await searchInstruments({ query: '한국', market: 'KR', asset_class: 'etf' }, loader, () => '2026-10-22T02:00:01Z');
  assert.equal(result.resolution_status, 'single_candidate_not_confirmed');
  assert.equal(result.candidates[0]?.name, '가상 한국 ETF');
  assert.equal(result.candidates[0]?.identity_status, 'directory_candidate_not_confirmed');
});

test('parse result validators bind profiles, source lines, classification and directory identities', () => {
  const result = parseKisUsStockMaster(row(), context);
  const count = structuredClone(result); count.metadata.row_count = 2;
  assert.equal(KisUsMasterParseResultSchema.safeParse(count).success, false);
  const identity = structuredClone(result); identity.directory.entries[0]!.symbol = 'MSFT';
  assert.equal(KisUsMasterParseResultSchema.safeParse(identity).success, false);
  const source = structuredClone(result); source.directory.source_url = 'https://example.invalid/';
  assert.equal(KisUsMasterParseResultSchema.safeParse(source).success, false);
  const profile = structuredClone(result); profile.metadata.profile = 'kospi';
  assert.equal(KisUsMasterParseResultSchema.safeParse(profile).success, false);
  const line = structuredClone(result); line.records[0]!.source_line = 2;
  assert.equal(KisUsMasterParseResultSchema.safeParse(line).success, false);
  const kr = parseKisKrStockMaster(krRow('kospi'), { ...context, profile: 'kospi' });
  kr.directory.entries[0]!.asset_class = 'etf';
  assert.equal(KisKrStockMasterParseResultSchema.safeParse(kr).success, false);
  for (const schema of [KisKrStockMasterRawSchema, KisKrStockMasterParseResultSchema]) assert.ok(z.toJSONSchema(schema).$schema);
});

test('accessor and non-enumerable context/source fields never execute', async () => {
  let calls = 0;
  const badContext = { ...context };
  Object.defineProperty(badContext, 'profile', { enumerable: true, get() { calls++; return 'nas'; } });
  code(() => parseKisUsStockMaster(row(), badContext), 'invalid_input');
  const badSource = { filename: 'nasmst.cod', contents: row() };
  Object.defineProperty(badSource, 'toJSON', { value() { calls++; return {}; } });
  await rejectsCode(new KisMasterDirectoryLoader('nas', { origin: 'synthetic', async read() { return badSource; } }, () => NOW).load(), 'schema_drift');
  const accessor = { filename: 'nasmst.cod', get contents() { calls++; return row(); } };
  await rejectsCode(new KisMasterDirectoryLoader('nas', { origin: 'synthetic', async read() { return accessor; } }, () => NOW).load(), 'schema_drift');
  assert.equal(calls, 0);
});

test('foreign listed equity ISIN country prefixes remain raw without assigning issuer nationality',()=>{
 for(const isin of ['HK0000057197','KYG5307W1015']){const doc=parseKisKrStockMaster(krRow('kosdaq',{scrt_grp_cls_code:'FS',etp_prod_cls_code:'0'},'900110',isin),{...context,profile:'kosdaq'});assert.equal(doc.directory.entries[0]?.asset_class,'equity');assert.equal(doc.directory.entries[0]?.market,'KR');assert.ok(doc.directory.entries[0]?.aliases.includes(isin));}
 code(()=>parseKisKrStockMaster(krRow('kospi',{},'005930','??0000057197'),{...context,profile:'kospi'}),'schema_drift');
});

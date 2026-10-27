// SPEC-ATP-AUTH-001 AC-001 (card t13, M1 RED-first): the stub-free default server works without any
// MoAI-AI member verification, every request stays on the provider allowlist, and the read
// switches still gate the tools.
//
// The global fetch recorder is installed BEFORE any server module is imported. Every case resets
// it at its start; main cases judge on absolute counts inside the case (zero at start, zero at end).
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test, { after } from 'node:test';

const recorder = await import('./fetch-recorder.js');
const harness = await import('./default-server-harness.js');
after(() => recorder.restoreOriginalFetch());

const GUARD = harness.MEMBER_GUARD_CODE;

function beginCase(): void {
  recorder.resetFetchRecords();
  assert.equal(recorder.readFetchRecords().length, 0, 'the recorder must be empty at the start of a case');
}

function endCase(spyUrls: readonly string[]): void {
  assert.ok(spyUrls.length >= 1, 'the injected spy recorded no request, so the allowlist condition would be vacuous');
  assert.deepEqual(harness.offAllowlist(spyUrls), [], 'every injected-transport request must be on the provider allowlist');
  assert.deepEqual(spyUrls.filter((raw) => /(^|\.)sec\.gov$/.test(new URL(raw).hostname)), [], 'SEC hosts are not enabled in this AC');
  assert.deepEqual(recorder.readFetchRecords(), [], 'nothing may reach the global fetch (recorded URLs listed above)');
}

// ---- controls (declared first so a reset that fails to clear breaks the main cases) ----

test('AC-001 control: the global fetch recorder sees a direct globalThis.fetch call and reset clears it', async () => {
  recorder.resetFetchRecords();
  await assert.rejects(globalThis.fetch('https://mo.ai.kr/telemetry'));
  const records = recorder.readFetchRecords();
  assert.equal(records.length, 1);
  assert.equal(new URL(records[0]!).hostname, 'mo.ai.kr');
  recorder.resetFetchRecords();
  assert.equal(recorder.readFetchRecords().length, 0);
  // Leave one stale record behind on purpose: the next main case must reset it away.
  await assert.rejects(globalThis.fetch('https://mo.ai.kr/stale-record-left-by-the-control-case'));
  assert.equal(recorder.readFetchRecords().length, 1);
});

test('AC-001 control: the allowlist decides on parsed host name and port, never on a substring', () => {
  for (const ok of [
    'https://openapi.koreainvestment.com:9443/oauth2/tokenP',
    'https://opendart.fss.or.kr/api/list.json?crtfc_key=x',
    'https://opendart.fss.or.kr:443/api/list.json',
    'https://new.real.download.dws.co.kr/ipo/kosdaq_code.mst.zip',
  ]) assert.equal(harness.isAllowlisted(ok), true, ok);
  for (const bad of [
    'https://example.invalid/',
    'https://mo.ai.kr/telemetry',
    'https://api.mo.ai.kr/v1',
    'https://opendart.fss.or.kr.evil.example/api',
    'https://evil.example/?next=https://opendart.fss.or.kr/',
    'https://moai.kr-daily.example/contract',
    'https://openapi.koreainvestment.com/oauth2/tokenP',
    'https://openapi.koreainvestment.com:29443/oauth2/tokenP',
    'https://opendart.fss.or.kr:9443/api',
    'http://opendart.fss.or.kr/api',
    'https://data.sec.gov/submissions/CIK0000320193.json',
    'https://www.sec.gov/files/company_tickers.json',
  ]) assert.equal(harness.isAllowlisted(bad), false, bad);
  assert.deepEqual(harness.offAllowlist(['https://example.invalid/', 'https://opendart.fss.or.kr/api']), ['https://example.invalid/']);
  assert.throws(() => endCase(['https://example.invalid/']), /allowlist/);
  assert.throws(() => endCase([]), /vacuous/);
});

// ---- main cases (stub-free default server, injected spy, absolute zero on the global recorder) ----

test('AC-001 Then 1: initialize, tools/list, all 36 tools/call and resources/read carry no member-guard code', async () => {
  beginCase();
  const spy = harness.createProviderSpy();
  const home = await harness.makeSyntheticHome();
  const session = await harness.openSession(harness.createDefaultServer({ homeDir: home, fetchImpl: spy.fetchImpl, switchesOn: true }));
  try {
    const swept = await harness.sweepAllTools(session);
    assert.equal(swept.listed.length, 36);
    assert.deepEqual([...swept.listed].sort(), Object.keys(harness.toolArguments).sort());
    const offenders = Object.entries(swept.byTool).filter(([, code]) => GUARD.test(code)).map(([tool, code]) => `${tool} -> ${code}`);
    assert.deepEqual(offenders, [], 'tools answered with a member-guard code');
    assert.doesNotMatch(swept.readOutcome, GUARD, 'resources/read answered with a member-guard code');
    endCase(spy.urls);
  } finally {
    await session.close();
    await rm(home, { recursive: true });
  }
});

test('AC-001 Then 2 and 3: get_market_snapshot -> build_report_input -> render_report_html succeed, requests stay on the allowlist', async () => {
  beginCase();
  const spy = harness.createProviderSpy();
  const home = await harness.makeSyntheticHome();
  const session = await harness.openSession(harness.createDefaultServer({ homeDir: home, fetchImpl: spy.fetchImpl, switchesOn: true }));
  try {
    const snapshot = await session.rpc('tools/call', { name: 'get_market_snapshot', arguments: { symbol: '000660', board: 'J' } });
    assert.equal(harness.outcome(snapshot), 'OK', 'KIS-only tool');
    const receipt = snapshot.result._meta['moai-atp.local-evidence'];
    assert.equal(typeof receipt, 'string');

    const built = await session.rpc('tools/call', { name: 'build_report_input', arguments: { ...harness.reportArgs, cutoff: new Date().toISOString(), source_receipts: [receipt] } });
    assert.equal(harness.outcome(built), 'OK', 'build_report_input');

    const rendered = await session.rpc('tools/call', { name: 'render_report_html', arguments: { report_input: built.result.structuredContent } });
    assert.equal(harness.outcome(rendered), 'OK', 'render_report_html');

    const read = await session.rpc('resources/read', { uri: rendered.result.structuredContent.resource_uri });
    assert.equal(harness.outcome(read), 'OK', 'resources/read of the rendered report');
    assert.equal(read.result.contents[0].mimeType, 'text/html');

    // Not vacuous: the KIS token request and the quote request both went through the injected spy.
    const hosts = new Set(spy.urls.map(harness.hostAndPort));
    assert.ok(hosts.has('openapi.koreainvestment.com:9443'), `expected a KIS request, saw ${[...hosts].join(',')}`);
    assert.ok(spy.urls.some((raw) => new URL(raw).pathname === '/oauth2/tokenP'));
    assert.ok(spy.urls.some((raw) => new URL(raw).pathname === '/uapi/domestic-stock/v1/quotations/inquire-price'));
    endCase(spy.urls);
  } finally {
    await session.close();
    await rm(home, { recursive: true });
  }
});

test('AC-001 And: with both read switches off the gated tools keep the baseline codes (28 rights_pending, 6 source_not_enabled, 2 OK)', async () => {
  beginCase();
  const spy = harness.createProviderSpy();
  const home = await harness.makeSyntheticHome();
  const session = await harness.openSession(harness.createDefaultServer({ homeDir: home, fetchImpl: spy.fetchImpl, switchesOn: false }));
  try {
    const swept = await harness.sweepAllTools(session);
    assert.equal(swept.listed.length, 36);
    assert.deepEqual([...swept.listed].sort(), Object.keys(harness.toolArguments).sort());
    const mismatches = swept.listed
      .filter((tool) => swept.byTool[tool] !== harness.expectedSwitchOffCode(tool))
      .map((tool) => `${tool}: expected ${harness.expectedSwitchOffCode(tool)} got ${swept.byTool[tool]}`);
    assert.deepEqual(mismatches, [], 'switch-off codes differ from the M0 baseline list');
    const tally: Record<string, number> = {};
    for (const code of Object.values(swept.byTool)) tally[code] = (tally[code] ?? 0) + 1;
    assert.deepEqual(tally, { rights_pending: 28, source_not_enabled: 6, OK: 2 });
    // Switched off means no provider traffic at all, injected or global.
    assert.deepEqual(spy.urls, []);
    assert.deepEqual(recorder.readFetchRecords(), []);
  } finally {
    await session.close();
    await rm(home, { recursive: true });
  }
});

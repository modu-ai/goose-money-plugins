// SPEC-ATP-AUTH-001 M1 (card t13): test-only global fetch recorder.
//
// Importing this module replaces globalThis.fetch with a function that records the request URL
// and always rejects. Adapters fall back to the global fetch when no fetchImpl is injected, so a
// request that bypasses an injected spy still leaves a record here and never reaches a network.
//
// Install it BEFORE any server module is imported: either a dynamic import inside the test file,
// or `node --import <dist>/test/fetch-recorder.js <entry>` for a child process (AC-009 reuses this
// same module). While installed, the process writes one fixed stderr line at exit:
//   moai_fetch_recorder_count=<n>
// restoreOriginalFetch() puts the original fetch back and silences that line.
import { writeSync } from 'node:fs';

const originalFetch = globalThis.fetch;
const records: string[] = [];
let reportAtExit = true;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
  records.push(requestUrl(input));
  throw new Error('fetch_recorder_blocked');
}) as typeof fetch;

process.on('exit', () => {
  if (reportAtExit) writeSync(2, `moai_fetch_recorder_count=${records.length}\n`);
});

/** Request URLs recorded since the last reset, in call order. */
export function readFetchRecords(): readonly string[] {
  return [...records];
}

/** Forget every recorded URL. */
export function resetFetchRecords(): void {
  records.length = 0;
}

/** Put the original fetch back and stop the exit-time count line. */
export function restoreOriginalFetch(): void {
  globalThis.fetch = originalFetch;
  reportAtExit = false;
}

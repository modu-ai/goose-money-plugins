import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Keep Python's source/runtime ZIP regression in the normal npm test discovery.
// The fixture builder starts no server and reads no user profile or credentials.
test('Claude source catalog and runtime ZIP preserve their installable manifest contract', { timeout: 60_000 }, () => {
  const scripts = fileURLToPath(new URL('../../../scripts/', import.meta.url));
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const env = process.platform === 'win32'
    ? { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' }
    : { PATH: process.env.PATH ?? '' };
  const run = spawnSync(python, ['-X', 'utf8', '-m', 'unittest', 'discover', '-s', scripts, '-p', 'test_claude_package.py', '-v'], {
    encoding: 'utf8', env, timeout: 50_000, maxBuffer: 128 * 1024,
  });
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stderr, /Ran 2 tests/);
});

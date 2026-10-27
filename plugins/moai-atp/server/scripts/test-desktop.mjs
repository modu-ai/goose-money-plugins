import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!['darwin', 'win32'].includes(process.platform)) {
  process.stderr.write('test_target_unsupported: Windows/macOS only\n');
  process.exitCode = 64;
} else {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = readdirSync(new URL('../dist/test/', import.meta.url)).filter(name => name.endsWith('.test.js')).sort().map(name => `dist/test/${name}`);
  const run = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
}

// Bundle options and the runtime declaration, shared by scripts/build-mjs.mjs and the tests so that the
// build and the checks can never hold two copies. Importing this module reads one JSON file and runs no build.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultServerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const deepFreeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

// splitting keeps the server graph (and the built-ins it pulls in) out of main.mjs's static import closure:
// main.mjs holds only the runtime guard and reaches the server by dynamic import (SPEC-ATP-RUNTIME-001 REQ-RT-006).
export const bundleOptions = deepFreeze({
  entryPoints: { main: 'src/main.ts', cli: 'src/cli.ts' },
  outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', target: 'node24', format: 'esm', splitting: true,
  metafile: true, sourcemap: false, legalComments: 'external', logLevel: 'silent',
  banner: { js: 'import { createRequire as __moaiCreateRequire } from "node:module"; const require = __moaiCreateRequire(import.meta.url);' },
});

// The single declaration source is server/package.json: engines.node = runtime range, devEngines.runtime.version = build pin.
// node_required stays as the legacy alias of the build pin.
export function runtimeDeclaration(serverRoot = defaultServerRoot) {
  const manifest = JSON.parse(readFileSync(join(serverRoot, 'package.json'), 'utf8'));
  const range = manifest.engines?.node;
  const pin = manifest.devEngines?.runtime?.version;
  if (typeof range !== 'string' || typeof pin !== 'string') throw Error('runtime_declaration_missing');
  return Object.freeze({ node_runtime_range: range, node_build_pin: pin, node_required: pin });
}

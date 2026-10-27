#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
NODE="${MOAI_NODE_BIN:-node}"
[[ "$("$NODE" --version)" == v24.22.1 ]] || { echo 'Pinned Node v24.22.1 required' >&2; exit 1; }
"$NODE" node_modules/typescript/bin/tsc -p tsconfig.json
"$NODE" scripts/generate-kr-daily-raw-artifacts.mjs
"$NODE" --test dist/test/kr-daily-raw-evidence.test.js

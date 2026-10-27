#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
NODE="${MOAI_NODE_BIN:-node}"
[[ "$("$NODE" --version)" == v24.22.1 ]] || { echo 'Pinned Node v24.22.1 required' >&2; exit 1; }
TSC="${MOAI_TSC_PATH:-node_modules/typescript/bin/tsc}"
"$NODE" "$TSC" -p tsconfig.json
"$NODE" scripts/generate-sec-capture-financial-selection-artifacts.mjs
"$NODE" --test dist/test/sec-capture-financial-selection.test.js

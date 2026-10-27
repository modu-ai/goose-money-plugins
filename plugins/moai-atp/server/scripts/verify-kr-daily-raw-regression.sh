#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
NODE="${MOAI_NODE_BIN:-node}"
[[ "$("$NODE" --version)" == v24.22.1 ]] || { echo 'Pinned Node v24.22.1 required' >&2; exit 1; }
export PATH="$(dirname "$NODE"):$PATH"
"$NODE" node_modules/typescript/bin/tsc -p tsconfig.json
"$NODE" scripts/generate-kr-daily-raw-artifacts.mjs
"$NODE" --test dist/test/*.test.js
python scripts/verify-kr-daily-raw-schemas.py
"$NODE" scripts/build-kr-daily-raw-closure.mjs

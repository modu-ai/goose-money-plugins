#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
BASELINE="${1:?Frozen RC11 release-root path required}"
NODE="${MOAI_NODE_BIN:-node}"
WORK="$ROOT/regression-workspace"
mkdir -p "$WORK/server"
cp -a "$BASELINE/contracts" "$BASELINE/tests" "$WORK/"
for name in src test contracts fixtures scripts package.json package-lock.json tsconfig.json .nvmrc requirements-contract-tests.txt; do cp -a "$ROOT/$name" "$WORK/server/"; done
cp -a "$BASELINE/server/docs" "$BASELINE/server/evidence" "$WORK/server/"
if [[ ! -e "$WORK/server/node_modules" ]]; then ln -s "$ROOT/node_modules" "$WORK/server/node_modules"; fi
cd "$WORK/server"
"$NODE" node_modules/typescript/bin/tsc -p tsconfig.json
cp -a test/fixtures/. dist/test/fixtures/
"$NODE" --test dist/test/*.test.js

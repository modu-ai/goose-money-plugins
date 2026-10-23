#!/usr/bin/env python3
"""Optional development harness: pinned TypeScript/@types/node must already be installed.
No installs, network, frozen edits or copied dependencies in integration artifacts.
Not a self-contained installed-runtime replay command.
"""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess, tempfile
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(); p.add_argument('--baseline', default=str(ROOT / 'server')); p.add_argument('--node', default='node'); p.add_argument('--dependencies', default=str(ROOT / 'server/node_modules')); p.add_argument('--report', default=str(ROOT / 'server/contracts/report-history-reference')); p.add_argument('--generate', action='store_true'); args = p.parse_args()
baseline, report, deps = map(Path, [args.baseline, args.report, args.dependencies])
pins = {'src/kr-daily-raw-evidence.ts': '430a928545290d6f8f171d649546d09c474a60c1d71c6f95f5809b71b4def065', 'src/exact-instant.ts': 'cf744f57df846e664e6522458cae9969dccafb8fbcd0c7794df4761209b832ae', 'src/r01-kis-field-parsers.ts': 'a530f80837340750ca622b9b0755e3c53406dba6d1a71e102a566a7edc2fb5dd'}
for name, expected in pins.items(): assert hashlib.sha256((baseline / name).read_bytes()).hexdigest() == expected, name
rpins = {'history_semantics.py': '55b7c1a0ab05b643d27bb27e072f00846b92d7f8bf749c479dcfedc8479318de', 'numeric_core.py': '02e3c646714eec8dca3ceffc9c9b9746f6d0670634a31b81fdb937f9f3656f37', 'canonical-history.schema.json': 'ac755724fc93442a50f38f3da4ff1749cafdb84221cc6b36efa448b562f55b4f'}
for name, expected in rpins.items(): assert hashlib.sha256((report / name).read_bytes()).hexdigest() == expected, name
for package, expected in [('zod', '4.6.7'), ('typescript', '5.9.3'), ('@types/node', '24.19.0')]: assert json.loads((deps / package / 'package.json').read_text())['version'] == expected, package
assert subprocess.check_output([args.node, '--version'], text=True).strip() == 'v24.22.1'
with tempfile.TemporaryDirectory(prefix='kr-synthetic-history-', dir=ROOT) as temp:
    work = Path(temp); (work / 'src').mkdir(); (work / 'test').mkdir()
    for name in ['kr-daily-raw-evidence.ts', 'exact-instant.ts', 'r01-kis-field-parsers.ts']: shutil.copy2(baseline / 'src' / name, work / 'src' / name)
    additive = {'src': ['kr-daily-synthetic-history-bridge.ts'], 'test': ['kr-daily-synthetic-history-fixture.ts', 'kr-daily-synthetic-history-bridge.test.ts']}
    for folder, names in additive.items():
        for name in names: shutil.copy2(ROOT / 'server' / folder / name, work / folder / name)
    (work / 'node_modules').symlink_to(deps, target_is_directory=True)
    (work / 'package.json').write_text('{"type":"module"}\n')
    ts = {'compilerOptions': {'target': 'ES2022', 'module': 'NodeNext', 'moduleResolution': 'NodeNext', 'rootDir': '.', 'outDir': 'dist', 'strict': True, 'noUncheckedIndexedAccess': True, 'exactOptionalPropertyTypes': True, 'skipLibCheck': True, 'types': ['node']}, 'include': ['src/**/*.ts', 'test/**/*.ts']}
    (work / 'tsconfig.json').write_text(json.dumps(ts))
    subprocess.run([args.node, str(deps / 'typescript/bin/tsc'), '-p', str(work / 'tsconfig.json')], cwd=work, check=True)
    env = dict(os.environ, KR_SYNTHETIC_REPORT_ROOT=str(report), KR_SYNTHETIC_SOURCE_ROOT=str(ROOT), KR_SYNTHETIC_BASELINE=str(baseline))
    subprocess.run([args.node, '--test', *map(str, sorted((work / 'dist/test').glob('*.test.js')))], cwd=work, env=env, check=True)
    if args.generate:
        env['KR_SYNTHETIC_BUILD_ROOT'] = str(work)
        subprocess.run([args.node, str(ROOT / 'server/scripts/build-kr-daily-synthetic-history.mjs')], cwd=work, env=env, check=True)

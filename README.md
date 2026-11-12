# 모두의 주식 · MoAI ATP

제품명은 **모두의 주식**, 닉네임은 **MoAI ATP**입니다. 투자 지표 참고·자료 분석·근거 중심 보고서·전략 검증 지원을 목표로 개발 중인 읽기 전용 분석 플러그인입니다. **자동 실주문과 수익 보장을 제공하지 않습니다.**

현재 구현과 미구현 범위는 아래에 구분합니다. 소스 패키지는 직접 설치 가능한 런타임 ZIP이 아니며, 사용 전 의존성 설치와 빌드가 필요합니다. [패키지·설정 안내](plugins/moai-atp/README.md)를 참고하세요.

Local development source is maintained in
[`plugins/moai-atp/`](plugins/moai-atp/); the existing Git repository remains at this project root.

```text
plugins/moai-atp/
  plugin.json, mcp.json        Local stdio plugin configuration
  skills/                     Goose and four specialist workflow instructions
  server/src/                 TypeScript research libraries and setup CLI
  server/test/                Synthetic and contract regression tests
  contracts/, examples/       Reference contracts and synthetic examples
  scripts/                    Local package and staged-secret checks
project-docs/                 Local design, inventory and validation (Git-ignored)
```

Read [AGENTS.md](AGENTS.md) before changing the project. Original RC23 inputs,
review packets, runtime binaries and project documents are preserved locally and
excluded from this source tree's distribution boundary.

## Develop locally

Runtime: Node >=22.2.0. Measured floor: the zlib.crc32 boundary was measured (absent on Node 22.1.0, present on 22.2.0); the server tool list and entry check were run on Node 22.2.0 and 22.22.3; other Node 22.x releases were not run. Node 22.0-22.1 are excluded. Build: Node 24.22.1.

Build with Node **24.22.1**. Install the locked dependencies without lifecycle scripts:

```sh
cd plugins/moai-atp
npm --prefix server ci --ignore-scripts
npm run build
npm test
npm run check:package
node server/dist/src/cli.js setup
```

The first setup presents the investment-context interview once. Users can decline,
leave supported fields unspecified or cancel partial answers; no personality is
inferred from missing answers. Only explicitly confirmed answers are saved in
`~/.goose/context/profile.json`, reused across projects. A separate minimal
`onboarding.json` records presentation so refusal/cancellation does not cause
repeated questioning. `setup --edit-profile` and `setup --delete-profile` are
explicit actions. There is no separate `interview` command. Context is plaintext
with private POSIX permissions, separate from `~/.goose/keystore`; Windows ACL
support is not implemented. Profile setup does not read credentials or call providers.
Host `/goose setup` registration remains unverified.

Optional key setup uses `node server/dist/src/cli.js setup --credentials` in a
local interactive terminal. It hides key entry and requires an explicit SAVE
before writing plaintext provider keys to `~/.goose/keystore/credentials.json`
(directories 0700, file 0600). Blank values retain an existing provider; partial
KIS pairs are rejected. Windows key-file storage fails closed pending ACL support.
Runtime reads the same strict schema lazily, after the rights gate. Complete
`KIS_APP_KEY`/`KIS_APP_SECRET` or `OPENDART_API_KEY` environment values take
priority; incomplete/empty values fail closed instead of mixing sources.
The default server still denies data requests, does not read keys at startup,
and has no OAuth token adapter. Storing keys does not enable provider access.

From `plugins/moai-atp/` after building, the following creates a separate private runtime ZIP with compiled code and three
locked production dependencies. Node 24.22.1 remains an external build prerequisite.
`npm --prefix server run build:mjs` fails immediately with `build_runtime_version_mismatch` unless the active Node is exactly 24.22.1, and the runtime ZIP build requires its output.
This artifact is distinct from the source ZIP and from actual host installation.

```sh
npm --prefix server run build:mjs
python3 scripts/build_runtime_bundle.py --output ../../project-docs/packages/moai-atp-runtime-private.zip
```

Use a new output filename for each artifact.

Full contract tests additionally require Python 3.11+ and
`jsonschema==4.26.0`; see `plugins/moai-atp/server/requirements-contract-tests.txt`.
Tests target **Windows and macOS only**. Linux validation is outside scope.
Inherited strict file-replay functions are unavailable on both desktop platforms;
desktop regressions verify rejection, not successful replay. Common-profile
storage currently requires POSIX permissions: Windows ACL support and actual
Windows execution are pending and must not be claimed as validated.

## Implemented boundary

The source includes 34 default-denied provider read-only MCP tool names plus two local report tools
(`build_report_input` report-input assembly, `render_report_html` HTML rendering to an in-memory
MCP resource link), offline source parsers/contracts, a common-profile setup CLI and research
workflow instructions.
Instructions cover R01–R14, U01/U02 and internal U03 QA. End-to-end actual-data
completed reports: **0**. Synthetic tests do not establish provider rights,
source authenticity, actual host installation or financial performance.

Condition creation, broker-mobile registration, strategy/backtest engines,
clinical or persistent counseling services, report rendering and financial-chart
integration are not implemented. The required report path uses actual MoAI Cowork
HTML templates plus Pele after adapter/license validation. No live accounts,
orders, transfers or automatic trading. UI and remote-hosting expansion are backlog.

## License and release status

The decided license is `LGPL-3.0-only`. Third-party notices and provenance must
be checked before public release. Dependency notices are in
[THIRD_PARTY_NOTICES.md](plugins/moai-atp/THIRD_PARTY_NOTICES.md).

MoAI membership governs access to a service and is separate from future OSS use
rights. A source-code license does not grant market-data rights. This repository
is a development snapshot; a Git commit/push is not public publication, platform
approval, installation or deployment. Do not change visibility or publish packages
before the pending reviews are resolved.

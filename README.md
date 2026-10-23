# MoAI ATP

Local research plugin development source. Public code is maintained in
[`oss/`](oss/); the existing Git repository remains at this project root.

```text
oss/
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

Use Node **24.22.1**. Install the locked dependencies without lifecycle scripts:

```sh
cd oss
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
support is not implemented. Setup does not read credentials or call providers.
Host `/goose setup` registration remains unverified.

Full contract tests additionally require Python 3.11+ and
`jsonschema==4.26.0`; see `oss/server/requirements-contract-tests.txt`.
Tests target **Windows and macOS only**. Linux validation is outside scope.
Inherited strict file-replay functions are unavailable on both desktop platforms;
desktop regressions verify rejection, not successful replay. Common-profile
storage currently requires POSIX permissions: Windows ACL support and actual
Windows execution are pending and must not be claimed as validated.

## Implemented boundary

The source includes 34 default-denied read-only MCP tool names, offline source
parsers/contracts, a common-profile setup CLI and research workflow instructions.
Instructions cover R01–R14, U01/U02 and internal U03 QA. End-to-end actual-data
completed reports: **0**. Synthetic tests do not establish provider rights,
source authenticity, actual host installation or financial performance.

Condition creation, broker-mobile registration, strategy/backtest engines,
clinical or persistent counseling services, report rendering and financial-chart
integration are not implemented. The required report path uses actual MoAI Cowork
HTML templates plus Pele after adapter/license validation. No live accounts,
orders, transfers or automatic trading. UI and remote-hosting expansion are backlog.

## License and release status

LGPL 3.0 is the intended public-source direction. `LGPL-3.0-only` versus
`LGPL-3.0-or-later`, source ownership and reference-export permissions remain
under review; no final project license is granted yet. Package metadata remains
`private: true` / `UNLICENSED` until that review is complete. Dependency notices
are in [THIRD_PARTY_NOTICES.md](oss/THIRD_PARTY_NOTICES.md).

MoAI membership governs access to a service and is separate from future OSS use
rights. A source-code license does not grant market-data rights. This repository
is a development snapshot; a Git commit/push is not public publication, platform
approval, installation or deployment. Do not change visibility or publish packages
before the pending reviews are resolved.

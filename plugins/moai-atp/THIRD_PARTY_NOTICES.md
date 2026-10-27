# Dependency notices and license boundary

Project-owned code and skills use LGPL-3.0-only, as stated in LICENSE.
The inherited reference-material exception below remains pending.
This file does not relicense third-party code.

The locked npm dependencies inspected for this source snapshot are:

| Package | Version | Declared license | Scope |
|---|---|---|---|
| @modelcontextprotocol/server | 2.3.1 | Apache-2.0 | Runtime |
| @modelcontextprotocol/core | 2.3.1 | Apache-2.0 | Runtime transitive |
| zod | 4.6.7 | MIT | Runtime |
| @types/node | 24.19.0 | MIT | Development |
| typescript | 5.9.3 | Apache-2.0 | Development |
| esbuild | 0.28.2 | MIT | Development bundler |
| undici-types | 7.24.6 | MIT | Development transitive |

Installed package metadata, lock versions/integrities and package license texts
must agree. Preserve their original license/copyright/NOTICE files in any future
binary/plugin bundle. The generated MJS runtime contains bundled SDK/Zod code and their original license files. MIT and Apache-2.0 are candidates compatible with the GNU
version-3 family; this observation does not resolve obligations for every combined
work, asset, reference export or market-data source.

References:
- [SPDX LGPL-3.0-only](https://spdx.org/licenses/LGPL-3.0-only.html)
- [SPDX LGPL-3.0-or-later](https://spdx.org/licenses/LGPL-3.0-or-later.html)
- [GNU license compatibility](https://www.gnu.org/licenses/license-compatibility.html)

The inherited `server/contracts/report-*` reference exports and synthetic
schemas preserve their provenance and hashes. Separate ownership and permission
review is pending; they are not silently relicensed under LGPL. Public release
is blocked until the relevant notices and authority are resolved. Historical
references to AGPL or paid-account capabilities do not establish the current
project license or runtime permissions.

The report runtime includes ECharts 6.1.0 (Apache-2.0), Lightweight Charts
5.2.1 (Apache-2.0), and a pre-rendered Pele 1.7.0 SVG. Pele's MIT notice and
its Lucide reset ISC notice are preserved in server/assets/report-runtime/Pele-LICENSE.txt.
ECharts and Lightweight Charts LICENSE/NOTICE texts remain beside their assets.
The SVG is pre-rendered; the Pele JavaScript renderer is not loaded at report runtime.
Provider documentation, data display, storage and redistribution rights are separate.
Actual private KIS/OpenDART responses are excluded from the installation archive.

The SDK embeds content-type 1.0.5 (MIT), copyright 2015 Douglas Christopher Wilson.
Its complete upstream license is preserved at
server/assets/report-runtime/content-type-1.0.5-LICENSE.txt.
Source: https://github.com/jshttp/content-type/blob/v1.0.5/LICENSE
This supplements the preserved bundled header; it does not resolve the inherited
report-reference ownership exception above.

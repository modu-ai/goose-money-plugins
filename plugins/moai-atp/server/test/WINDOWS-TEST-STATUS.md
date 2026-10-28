# Windows test status of the server tests (SPEC-ATP-WINTEST-001, card t30)

This document says what the repository has and has not observed about Windows. It makes no claim of platform
coverage. A result obtained on macOS is not Windows evidence, whatever the test is called.

## Status

- Windows runner: none defined in this repository (no CI definition is tracked; checked at the card's base commit with `git ls-files -- .github plugins/moai-atp/.github`, no output).
- Observed Windows runs: none observed.
- ACL: unimplemented and unverified. Read from the source (not observed on any Windows host): the key store (`src/local-credentials.ts`) and the profile store (`src/user-context.ts`) check POSIX file modes, and each starts with a platform-block statement that throws `secure_file_storage_unsupported` / `context_unsafe_path` on a Windows host instead of attempting an ACL-based store. That the guards reject the calls the tests make is therefore an inference from the code, not a measurement. The guards are unchanged by this card (`git diff 741a39e..HEAD -- plugins/moai-atp/server/src` is empty).
- Gap: store-function rejection on Windows is observable only on a real Windows host.
- Test target policy: Windows and macOS only; no Linux test is added or run.

## What the tests do on each host

The cases that prepare a credential home through `makeHome`, `withSession`, `runDartDeadline`, `makeSyntheticHome` or the three direct file-store wrappers go through one helper, `test/credential-home.ts`, which picks exactly one branch for the (host platform, kind) pair (found by text search over the test folder, ledger AC-WIN-013 and AC-WIN-016; a test that reaches credentials some other way was not enumerated). The files this card edited or added read the platform only inside that helper; the other lines in the test folder that read the host platform value are pre-existing text and are listed in ledger AC-WIN-002.

| Branch | Where | Preparation | Closing verdict |
|---|---|---|---|
| `file-store` | macOS, every kind | the baseline `makeHome` / synthetic-home preparation, unchanged | the baseline assertions, plus for `none` / `corrupt` / `unsafe` the store's own verdict (no document / `credential_file_invalid` / `credential_file_unsafe`) |
| `env-credential` | Windows host, kinds `both` `kis` `dart` `synthetic` | an empty mkdtemp home and complete synthetic provider values in an explicit env object given to the server under test; a provider for which the case supplies its own variable gets no synthetic value | the baseline assertions, plus the home holds zero entries |
| `fail-closed-assertion` | Windows host, kinds `none` `corrupt` `unsafe` `key-store` `profile-store` | the baseline home (hand-built files, no store call); for `key-store` / `profile-store` the mkdtemp project and home of the separately named rejection test | the store rejects it with the platform code, and the rejected home gained no `.goose` entry |

On a Windows host every preparation that is not `file-store` writes one standard-output line `[t30-branch] <branch> kind=<kind>` (no credential value, no path, no home name), so a run's output shows how many cases ran on each branch. macOS writes none.

`test/win32-fail-closed.test.ts` runs the eight store functions against an explicit mkdtemp project and home. On a Windows host it asserts the exact platform code, zero input-function calls and no `.goose` entry; on macOS it asserts the symmetric non-platform result. Its test names are the same on both hosts and end with `(macOS-run asserts the symmetric result; not Windows evidence)`: a name printed by a macOS run is that symmetric result and never a Windows result. A name is read as a Windows-host result only when the run's own header (host, commit) says it was a Windows host, and no such run exists yet.

The direct file-store test groups (`local-credentials.test.ts`, `auth002-m4-key-setup.test.ts`, `setup-context.test.ts`) are gated at registration by `storeTestFor`. On a host whose store is blocked each of their tests is registered **skipped with a reason** (the body is not run and is not counted as passed; the spec reporter that `npm test` uses prints `﹣ <name> (<ms>) # <reason>` and counts it in the summary line `ℹ skipped <n>`, while the TAP reporter prints `# SKIP <reason>` and `# skipped <n>`, so a search of a log for `# SKIP` finds nothing in spec-reporter output), and `registerBlockedHostRejectionTest` registers one separately named test per file whose name begins `fail-closed store rejection check, not the original behavior` and which checks only the store rejection. On macOS the tests are registered unchanged, no rejection test is registered, and no test is skipped by this gate. The gate decision is checked on any host through an explicit platform argument in `credential-home-contract.test.ts` (explicit-platform-arg, not Windows evidence); how the two reporters print a skip was observed only on macOS, with a scratch probe that passed the platform as an argument (explicit-platform-arg, not Windows evidence): the spec reporter line quoted above and the TAP reporter line were both seen there. The output of a real Windows run is not observed.

`test/credential-home-contract.test.ts` checks the helper's branch decision and preparation by passing a platform as an explicit argument. Its results on any host are explicit-platform-arg checks and are not Windows evidence. The host platform is never redefined anywhere in the test tree.

## Observables that exist only on a real Windows host

None of these has been observed. Each is a Gap until a run on a real Windows host records its host, commit and output.

- The store functions' own rejection (the Gap line above), including the `fail-closed-assertion` arms of `assertStoreVerdict` and `enterStoreTest`, and the three separately named `fail-closed store rejection check` tests.
- The reporter output of the skipped direct file-store tests on a Windows host (that they print as skipped with the reason, and the skip count).
- The `[t30-branch]` line count per branch. The expected counts were computed from the code at the card's base commit and are recorded in `.moai/reports/t30/baseline-list.md` section 6; they are not a measurement. After the blocked-host gate the 64 per-test lines of the direct file-store groups (12 + 37 + 15) are replaced by 3 (one per rejection test). Expected `[t30-branch]` line counts on a Windows host after the gate, counted from the code and not observed: `fail-closed-assertion` 137 (was 198), of which `kind=key-store` 2 (was 49) and `kind=profile-store` 1 (was 15); `env-credential` 773 (unchanged); total 910 (was 971).
- Whether the default output function really reaches standard output on a Windows host, and how that appears under the Node version the repository requires.
- The `env-credential` home lifecycle through the real harness: the in-case "zero entries" check runs for `withSession` and `runDartDeadline` cases only. Accepted Gap: the 7 `makeSyntheticHome` cases (`auth002-b-prime-020-measurement.test.ts` 4, `default-server-ac001.test.ts` 3) have no in-case empty-home check; they remove their own home, and those two files are outside this card's file table, so on a Windows host nothing in those 7 cases asserts that the `env-credential` home stayed empty (REQ-WIN-003 is only partly met for them).
- The helper's `enterStoreTest` and `assertStoreVerdict` take the branch from the host platform through the same `branchFor` the contract table checks with an explicit argument; the default-platform arm of that function is exercised on macOS only.
- Explicit-`darwin` preparations of key-file kinds on a Windows host would reach the store and be rejected; the contract test therefore prepares only the `none` kind with an explicit `darwin`.
- The expected-versus-observed comparison of provider-request behavior on the `env-credential` branch (the 32 `shipped(name, 'both')` cells of `default-wording.test.ts` and the key-file-home provider cells, 684 loop-expanded cases at the card's base commit): by reading the code the same assertions are reached on both hosts, which is an inference; only a Windows host can show that they are.

## macOS-only properties

Where a Windows host ends a case in the fail-closed verdict, the property the case's name or body is about is verified on macOS only. One entry per group; the header string of each entry is the group's label.

### Helper-prepared cases whose expected code the platform block would also produce

Accepted gap of this card (not gated): these cases are not registered skipped on a blocked host, unlike the direct file-store tests below. They are the `none` / `corrupt` / `unsafe` cases of `auth002-m2-provider-errors.test.ts`, `err001-consumer-matrix.test.ts` and `err001-k3-directory.test.ts`, the empty-home case of `local-read-switches.test.ts`, and the K and D steps with an empty home in `default-wording.test.ts`. Why, read from the code and not observed on a Windows host: the key store throws `secure_file_storage_unsupported` before it reads any key file, and the HTTP layer (`src/kis-http.ts`, `kisCredentialError`) maps every credential-resolution failure other than a missing credential or an invalid environment to `credential_missing`; the expected code of these cases is therefore produced by the platform block, and the named condition (a corrupt key file, an unsafe key file, a missing key) is not what is exercised. The assertions in the bodies do run on a Windows host, and the user-visible outcome they assert (the tool reports `credential_missing` and sends no request) is the same. Consequence: on a Windows host the name of such a case must not be read as evidence of its named condition. Follow-up card: `[Windows게이트후속]`, registered by the leader. No Windows run has been observed for any of this.

- `auth002-m2-provider-errors.test.ts none/corrupt/unsafe` (30 cases): "no key stored" is told apart from "the store is blocked" on macOS only; a 0600 non-JSON key file is rejected as `credential_file_invalid` and a valid 0644 key file as `credential_file_unsafe` on macOS only. On a Windows host the cases assert the platform-code rejection of their home.
- `err001-consumer-matrix.test.ts none/corrupt/unsafe` (60 cases, including the three reference-block homes per declaration): the same three properties, macOS only.
- `err001-k3-directory.test.ts none/corrupt/unsafe` (9 cases): the same three properties, macOS only.
- `local-read-switches.test.ts:11` (the empty-home case "enabled local KIS without credentials reports missing rather than rights_pending and never fetches"; the header string is the baseline line label; after the card's import edit the test is declared at line 10): that an empty home yields `credential_missing` because no key exists, not because the store is blocked, is verified on macOS only.
- `default-wording K none` (25 `shipped(name, 'none')` steps) and `default-wording D none` (2 steps): the expected missing-credential wording for a home without keys is verified on macOS only; on a Windows host the same steps run and their homes end in the platform-code rejection. The M, X and H steps do not depend on the credential store and are not listed.
- `setup-context.test.ts:74` and `setup-context.test.ts:96` (the six `context_unsafe_path` assertions of the profile tests at the baseline lines 74, 81, 82, 84, 92, 96; the header strings are baseline line labels; after the card's import edit and the blocked-host gate edit they sit at lines 80, 87, 88, 90, 98, 102): that the code is produced by a symlinked context directory, a hard-linked or broadly permissioned profile, an oversized profile and a profile inside the project is verified on macOS only. On a Windows host these tests are registered skipped with a reason, so their assertions are not evaluated there at all.

### Direct file-store tests (the whole body is macOS only)

On a Windows host these tests are expected, by the design of the gate, to be registered **skipped with a reason**; the reporter must show them as skipped, never as passed. That has not been observed. Their rejection check is carried by the separately named `fail-closed store rejection check, not the original behavior (<file>, <store>)` test of each file (3 tests), which is not an assertion of the skipped behavior. The three names as registered (each followed by `: an mkdtemp project and home are rejected with <code> and gain no .goose entry`):

- `fail-closed store rejection check, not the original behavior (local-credentials.test.ts, key-store)`, code `secure_file_storage_unsupported`.
- `fail-closed store rejection check, not the original behavior (auth002-m4-key-setup.test.ts, key-store)`, code `secure_file_storage_unsupported`.
- `fail-closed store rejection check, not the original behavior (setup-context.test.ts, profile-store)`, code `context_unsafe_path`.

These three are registered only on a blocked host, decide by the host platform, and are expected to pass on a Windows host; macOS registers none of them, and that expectation is not observed.

- `local-credentials.test.ts fixture` (12 tests): the key store's save, reuse, permission, link, size and atomic-write behavior. Registered skipped by the gate on a Windows host (not observed); the file's rejection test asserts `secure_file_storage_unsupported` for its mkdtemp home and project.
- `auth002-m4-key-setup.test.ts withSetup` (37 runs with loops expanded): the key-setup flow's reuse default, replacement, cancel and atomic-write behavior. Same Windows-host treatment (registered skipped by the gate, not observed). The static check of the platform block (AC-004g) is unchanged; it reads source text and has no platform branch by reading, and it has been run on macOS only.
- `setup-context.test.ts fixture` (15 tests): the profile interview, save, edit, delete and path/permission checks. Registered skipped by the gate on a Windows host (not observed); the file's rejection test asserts `context_unsafe_path`.

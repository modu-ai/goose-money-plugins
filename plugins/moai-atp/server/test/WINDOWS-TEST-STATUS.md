# Windows test status of the server tests (SPEC-ATP-WINTEST-001, card t30)

This document says what the repository has and has not observed about Windows. It makes no claim of platform
coverage. A result obtained on macOS is not Windows evidence, whatever the test is called.

## Status

- Windows runner: none defined in this repository (no CI definition is tracked; checked at the card's base commit with `git ls-files -- .github plugins/moai-atp/.github`, no output).
- Observed Windows runs: none observed.
- ACL: unimplemented and unverified. The key store (`src/local-credentials.ts`) and the profile store (`src/user-context.ts`) are POSIX-mode stores. On a Windows host their guards reject every call (`secure_file_storage_unsupported`, `context_unsafe_path`) instead of attempting an ACL-based store; those guards are unchanged by this card.
- Gap: store-function rejection on Windows is observable only on a real Windows host.
- Test target policy: Windows and macOS only; no Linux test is added or run.

## What the tests do on each host

Every case that touches credentials goes through one helper, `test/credential-home.ts`, which picks exactly one branch for the (host platform, kind) pair. Test files never read the platform.

| Branch | Where | Preparation | Closing verdict |
|---|---|---|---|
| `file-store` | macOS, every kind | the baseline `makeHome` / synthetic-home preparation, unchanged | the baseline assertions, plus for `none` / `corrupt` / `unsafe` the store's own verdict (no document / `credential_file_invalid` / `credential_file_unsafe`) |
| `env-credential` | Windows host, kinds `both` `kis` `dart` `synthetic` | an empty mkdtemp home and complete synthetic provider values in an explicit env object given to the server under test; a provider for which the case supplies its own variable gets no synthetic value | the baseline assertions, plus the home holds zero entries |
| `fail-closed-assertion` | Windows host, kinds `none` `corrupt` `unsafe` `key-store` `profile-store` | the baseline home (hand-built files, no store call) | the store rejects it with the platform code, and the rejected home gained no `.goose` entry |

On a Windows host every preparation that is not `file-store` writes one standard-output line `[t30-branch] <branch> kind=<kind>` (no credential value, no path, no home name), so a run's output shows how many cases ran on each branch. macOS writes none.

`test/win32-fail-closed.test.ts` runs the eight store functions against an explicit mkdtemp project and home. On a Windows host it asserts the exact platform code, zero input-function calls and no `.goose` entry; on macOS it asserts the symmetric non-platform result.

`test/credential-home-contract.test.ts` checks the helper's branch decision and preparation by passing a platform as an explicit argument. Its results on any host are explicit-platform-arg checks and are not Windows evidence. The host platform is never redefined anywhere in the test tree.

## Observables that exist only on a real Windows host

None of these has been observed. Each is a Gap until a run on a real Windows host records its host, commit and output.

- The store functions' own rejection (the Gap line above), including the `fail-closed-assertion` arms of `assertStoreVerdict` and `enterStoreTest`.
- The `[t30-branch]` line count per branch. The expected counts were computed from the code at the card's base commit and are recorded in `.moai/reports/t30/baseline-list.md` section 6; they are not a measurement.
- Whether the default output function really reaches standard output on a Windows host, and how that appears under the Node version the repository requires.
- The `env-credential` home lifecycle through the real harness: the in-case "zero entries" check runs for `withSession` and `runDartDeadline` cases only. The `makeSyntheticHome` cases (`auth002-b-prime-020-measurement.test.ts`, `default-server-ac001.test.ts`) remove their own home and carry no in-case check of it.
- The helper's `enterStoreTest` and `assertStoreVerdict` take the branch from the host platform through the same `branchFor` the contract table checks with an explicit argument; the default-platform arm of that function is exercised on macOS only.
- Explicit-`darwin` preparations of key-file kinds on a Windows host would reach the store and be rejected; the contract test therefore prepares only the `none` kind with an explicit `darwin`.
- The expected-versus-observed comparison of provider-request behavior on the `env-credential` branch (the 32 `shipped(name, 'both')` cells of `default-wording.test.ts` and the key-file-home provider cells, 684 loop-expanded cases at the card's base commit): the same assertions run on both hosts by construction, and only a Windows host can show that they do.

## macOS-only properties

Where a Windows host ends a case in the fail-closed verdict, the property the case's name or body is about is verified on macOS only. One entry per group; the header string of each entry is the group's label.

### Helper-prepared cases whose expected code the platform block would also produce

- `auth002-m2-provider-errors.test.ts none/corrupt/unsafe` (30 cases): "no key stored" is told apart from "the store is blocked" on macOS only; a 0600 non-JSON key file is rejected as `credential_file_invalid` and a valid 0644 key file as `credential_file_unsafe` on macOS only. On a Windows host the cases assert the platform-code rejection of their home.
- `err001-consumer-matrix.test.ts none/corrupt/unsafe` (60 cases, including the three reference-block homes per declaration): the same three properties, macOS only.
- `err001-k3-directory.test.ts none/corrupt/unsafe` (9 cases): the same three properties, macOS only.
- `local-read-switches.test.ts:11` (the empty-home case "enabled local KIS without credentials reports missing rather than rights_pending and never fetches"; the header string is the baseline line label; after the card's import edit the test is declared at line 10): that an empty home yields `credential_missing` because no key exists, not because the store is blocked, is verified on macOS only.
- `default-wording K none` (25 `shipped(name, 'none')` steps) and `default-wording D none` (2 steps): the expected missing-credential wording for a home without keys is verified on macOS only; on a Windows host the same steps run and their homes end in the platform-code rejection. The M, X and H steps do not depend on the credential store and are not listed.
- `setup-context.test.ts:74` and `setup-context.test.ts:96` (the six `context_unsafe_path` assertions of the profile tests at the baseline lines 74, 81, 82, 84, 92, 96; the header strings are baseline line labels; after the card's import edit they sit at lines 75, 82, 83, 85, 93, 97): that the code is produced by a symlinked context directory, a hard-linked or broadly permissioned profile, an oversized profile and a profile inside the project is verified on macOS only. On a Windows host `context_unsafe_path` is produced by the platform guard for every call, so these assertions would pass for the wrong reason.

### Direct file-store tests (the whole body is macOS only)

- `local-credentials.test.ts fixture` (12 tests): the key store's save, reuse, permission, link, size and atomic-write behavior. On a Windows host each test asserts the `secure_file_storage_unsupported` rejection of its mkdtemp home and project, and its body does not run.
- `auth002-m4-key-setup.test.ts withSetup` (37 runs with loops expanded): the key-setup flow's reuse default, replacement, cancel and atomic-write behavior. Same Windows-host treatment. The static check of the platform block (AC-004g) is unchanged and runs on both hosts.
- `setup-context.test.ts fixture` (15 tests): the profile interview, save, edit, delete and path/permission checks. On a Windows host each test asserts the `context_unsafe_path` rejection and its body does not run.

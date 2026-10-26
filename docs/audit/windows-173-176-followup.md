# Windows acceptance follow-up: issues 173–176

Reviewed 25 October 2026. Local base: `3d60ea2`. Remote `main` was observed through
the GitHub connector at `26081adf6044dc70f0a8a34a7491ba0d754ce286` during this review.
The local checkout could not fetch that revision because shell DNS cannot resolve
GitHub. Local validation below does not certify that newer revision.

These issues are acceptance gates. Passing implementation tests does not establish
their required real-device, network, delivery or independent-review evidence.

| Issue | Implementation evidence | Remaining acceptance work |
| --- | --- | --- |
| #173, installer delivery | Manifest versions agree on 4.7.0. Settings reads installed native metadata. The install guide now uses the approved version rather than stale 2.0.0 examples and describes fallback integrity checks and upgrade verification. | Download timings on campus Wi-Fi and hotspot; intended-artifact hashes; actual clean install, upgrade and uninstall/reinstall logs; retained-state and shortcut checks; independent review. |
| #174, helper and cleanup | Shubh's merged #195 and #225 address firewall cleanup retry/reporting, late entry after restore, restoration feedback, sleep ownership and shutdown ordering. Native logic checks listed below pass. | Denied elevation and retry; restrictions plus permitted AMS traffic; failed/cancelled setup, sign-out, normal exit and forced termination on Windows; before/during/after keyboard, firewall, registry and process evidence; independent review. |
| #175, exit and layout | Merged #169 and #225 cover inline reconnect Wi-Fi, layout, exit restoration, shutdown and logout ordering. Web exit/recovery tests pass. | Full screen-state by exit-method matrix with API unavailable; keyboard-only Wi-Fi/password/Join/Retry; long SSIDs, small viewport and high scaling; restored native input recording; independent review. |
| #176, credentials | This follow-up preserves meaningful login-ID characters. Only case, surrounding whitespace and the documented full-handle suffixes are normalized. The transport no longer deletes internal whitespace. The input permits full 64-character handles with their suffix and retains overlong IDs for rejection. | Accepted-registration/issuance/delivery reconciliation; redacted credential/account matrix; password reissue and existing-session policy; bounce/delay and identity-verified fallback; independent review. |

## Credential findings

Before this change, `john doe` and `john+doe` became `johndoe`, an arbitrary email
domain was discarded, and long IDs were truncated to 64 characters. This violated
#176's requirement that normalization not silently change identity. Regression
coverage now includes internal whitespace/punctuation, unknown and partial
suffixes, invisible characters, long IDs, full-handle paste and the actual login
request body. Each attempt still sends exactly one request.

Initial read-only inspection of sibling `ams-api` found another requirement:
`POST /contests/{contest_uid}/participants/{login_id}/reissue` generates and commits
a fresh password on every invocation, without an idempotency key. A retried
request can rotate it again. A subsequent follow-up now implements consumed request
IDs, atomic rotation, bounded hashing outside the transaction, and portal retry
ID retention. Its migration and PostgreSQL integration tests still need validation
on an unrestricted host. See `ams-api/docs/credential-reissue.md` and the exact
Windows/staging steps in [Shubh's checklist](windows-173-176-shubh.md). No production
credentials, delivery records or database were accessed in this review.

## Validation performed

- `pnpm --filter @ams/web test`: all 101 test files pass after the login change.
- `pnpm --filter @ams/web typecheck`: passes.
- `pnpm check:versions`: all manifests agree on 4.7.0.
- `cargo test -p core-rs`: 43 pass.
- `cargo test -p platform-rs windows_`: 25 pass, including Windows firewall,
  keyboard and hook lifecycle checks. These execute platform-independent logic,
  not the Win32 APIs.
- `cargo clippy -p platform-rs -p core-rs --all-targets -- -D warnings`: passes.
- `cargo fmt --check`: passes.
- The actual `lockdown_lifecycle.rs` was compiled with `rustc --test`, linked to
  the already-built core crate: all 11 tests pass without requiring Tauri/WebKit.
- Synthetic normalization check: 100,000 distinct IDs, 200,000 assertions,
  approximately 67 ms, zero network requests. This measures only normalization;
  it does not establish API or password-hashing capacity.
- Impeccable detector for the changed input component: no deterministic findings.

## Environment limits and failures

- `gh issue view` and `git fetch origin` fail because the shell cannot connect to
  GitHub. The GitHub connector supplied issue bodies, comments and the remote tip.
  No issue has been closed or marked verified by this follow-up.
- `pnpm --filter @ams/web build` stops in prebuild: the pinned cppreference archive
  is absent locally and GitHub DNS fails. This is a blocked build, not a pass.
- Full `cargo test -p platform-rs` reports 122 pass and five failures in local
  socket/ownership checks under the sandbox. The explicit errors include
  `Operation not permitted`; this does not certify those tests on an unrestricted
  host and must be retested there.
- WSL cannot launch Windows PowerShell here (`UtilBindVsockAnyPort: socket failed`).
  No Windows installer, native restoration, DPI, campus network or real-device
  result is claimed.
- Local full Tauri builds require WebKit/libsoup development libraries absent on
  this host. No hook has been weakened and no native test has been relabeled pass.

The server/portal follow-up passed 189 runnable API tests, three focused reissue
logic/schema tests, portal TypeScript and all 20 portal test files. Seven new
PostgreSQL integration cases are skipped locally: a disposable PostgreSQL cluster
initialized successfully but the sandbox denied creation of its Unix socket.
Offline Alembic SQL generation succeeds. Mypy passes for the changed participant
service and schemas; checking the wider route/model files reports existing errors
outside the new reissue code. No migrations or production changes were applied.

After the user's successful fetch, all three follow-up branches were rebased
without conflicts. Access is based on `26081ad`; API is based on `26ee3c1`;
the portal branch already included its current `origin/main`. Post-rebase checks
pass: 104 Access web test files, Access type-checking/version consistency, 191
runnable API tests, scoped Ruff and service/schema Mypy, and all 20 portal test
files plus TypeScript. API tests additionally report 40 skips and 405 database
cases deselected in the non-database run; those are not counted as passes.
The API CI uses PostgreSQL 16 and explicitly rejects skipped database tests.
It must validate the seven new database integration cases after publication.

All four issues remain open until their outstanding evidence is collected. Merge
or port the local fix onto current `main`, run CI on that exact revision, then
retest the intended Windows artifact before completing the acceptance records.

## Independent review follow-up

Combined with PR #237, all 915 web tests and web TypeScript pass. Review identified a companion API limit: issued/reused handles may exceed the login schema's 32-character cap. The bounded schema correction and regressions are being added to API PR #14; this Access PR does not alone establish long-handle end-to-end support. Ready for review; full packaging CI and device/staging acceptance remain separate gates.

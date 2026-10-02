# Local backend reliability work — Codex / Claude review

Working checkout: `/home/user/AccessSoftware/ams-access-main`, starting at `a20c3fc`.

Scope: local Rust/Tauri app backend and privileged-helper source only, plus necessary compatible types/tests. No cloud access, hosted API changes, deployment, firewall changes on this machine, or live lockdown tests. No push unless requested. Keep scoring and organizer enforcement policy unchanged.

## Review procedure

Codex appends a completion entry after each task with files, behavior, verification and limitations. Claude: append findings beneath that task ID without replacing previous entries. Codex reads new feedback at the next task checkpoint, verifies each claim, fixes applicable findings and records the resolution. Pending review is not approval.

## Task queue

- B0 — Review existing Linux lifecycle commit `5202a15`; adopt only verified fixes.
- B1 — Truthful, serialized secure-session start/stop with partial-failure cleanup.
- B2 — Session-bound event storage and safe migration of unbound legacy data.
- B3 — Bounded event reads/history, atomic checkpoints and visible persistence errors.
- B4 — Accurate network facts, bounded probe work and controlled blocking operations.
- B5 — Helper concurrency, request-size and connection timeout limits.
- B6 — Focused module boundaries and fault/recovery tests.
- B7 — Independent cross-review, integration validation and Claude follow-up.

## Activity

Started read-only review of existing Linux changes before implementation. Baseline main is clean. Review artifacts and safe tests may use temporary directories; real desktop/security mutations are excluded from automated checks.

## Claude review: pre-task notes (before B0 lands)

Baseline taken by Claude at `a20c3fc` (clean `main` worktree): a source snapshot of `apps/desktop/src-tauri`, `packages/{core-rs,platform-rs,network-helper,api-client}`, `Cargo.*` and `.github`, plus git refs and the Go/web repo state. A CI-equivalent fmt/clippy/test baseline is running in an isolated target dir, so new failures can be told apart from pre-existing ones.

**B0: `main` already has half of `5202a15`.** `apps/web/src/lib/recovery-message.ts` and `network-error.ts` are byte-identical on `main` and `5202a15` (they came in with the UI commit). `packages/platform-rs/src/linux/mod.rs`, `apps/desktop/src-tauri/src/lib.rs` and `debian/prerm` differ. A plain cherry-pick will conflict on `SettingsPanel.tsx`, which `main` rewrote into `SettingsDetails.tsx`, and that file already calls `recoveryFailureMessage` / `manualRecoveryCommand`. Port only the Rust and `debian/` parts, and check that `main`'s `SettingsDetails` restore flow matches the new `disable_network_lockdown` error semantics (marker present plus helper unreachable now **errors**, where before it returned `Ok`).

**Invariants I will check on every entry** (from `AccessSoftware/CLAUDE.md`):

- `Cargo.lock` is pinned. No `cargo update`, and build with `--locked` (the `time 0.3.48` / `tauri-utils` break). I alarm on any `Cargo.lock` change.
- `tauri.conf.json`: `csp` stays non-null and `devtools` stays off in release. I alarm on any change.
- Any Rust closure invoked from C/ObjC stays `catch_unwind`-guarded (11 guard sites at baseline).

**Design constraints worth stating before B1/B2/B5:**

- **B1:** entry must fail **closed** (no "ready" unless the required protections applied), but every stop/unlock/recovery path must fail **safe**. A cleanup error must never leave the candidate locked with no exit. Order teardown as network, then keyboard, then desktop, and keep each step independent, as `restore()` already does with `allSettled`.
- **B2:** do not drop unbound legacy events and do not attribute them to the next session. Quarantine them with an explicit "unbound" marker.
- **B5:** the helper runs as root and ships separately from the app on macOS. Any protocol change must keep **old app ↔ new helper and new app ↔ old helper** working during rollout. Limits must not drop a legitimate long lockdown session (idle timeouts on a persistent connection).

Verification I will run per entry: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace --locked` (CI steps), plus diffs against the snapshot.

### B0 — Existing Linux commit reviewed before adoption

- Independent review of `5202a15` confirmed lost-token recovery, false-success helper teardown, unconditional keyboard success, and XWayland watchdog gating defects.
- Commit is NOT being cherry-picked wholesale. Reviewer found unsafe fixed-name temporary token writes, ignored persistence errors, live token replacement on repeated enable, leaked KDE tool strings, and uninstall ordering that could discard recovery markers while kernel rules survive.
- Agent is implementing reviewed corrections in Linux platform code and a mocked-only uninstall harness. No real helper, firewall, keyboard or desktop changes are being exercised.
- Root is preparing truthful serialized native entry/exit and network diagnostics. Event-store agent proposed per-session/per-run queues with preserved unbound legacy data and atomic bounded acknowledgment checkpoints. API event payloads stay unchanged.
- Review checkpoint: log available at both `/home/user/AccessSoftware/ams-access-main/codex-review-2.md` and the original checkout's symlink. Claude may append here as tasks land.

## Claude review: B0 (5202a15 assessment, while corrections are in progress)

**Baseline (Claude, clean `a20c3fc` export, CI steps reproduced):** `cargo fmt --check` clean. `cargo clippy --workspace --all-targets -- -D warnings` clean (its only output is the cargo notice "profiles for the non root package will be ignored" for `network-helper`, which is not a lint). `cargo test --workspace --locked`: **75 passed** (5 + 39 + 14 + 17), 0 failed. Any new failure or lint is from this work.

Checked your reviewer's claims against `5202a15` source:

- **Uninstall ordering: CONFIRMED, important.** `debian/prerm` runs `systemctl stop` on the helper and then `rm -f /run/ams-proctor.lock`. If a lockdown is live, the kernel `AMS_PROCTOR` chain survives both. The marker is the only evidence of it, and with the marker gone, `disable_network_lockdown`'s new marker-gated logic returns `Ok` ("nothing applied"). The recovery panel would then say the network was restored while OUTPUT is still filtered until reboot. Fix: tear down the chain (helper `disable`, or a direct `iptables -D OUTPUT -j AMS_PROCTOR; -F; -X` in prerm) **before** stopping the helper, and remove the marker only after that succeeds. If teardown fails, leave the marker in place.
- **"Unsafe fixed-name temporary token write": partly overstated.** The path is `$XDG_RUNTIME_DIR/ams-access/session-token` with a fallback of `/run/user/<uid>` (`session_token_path`), a per-user 0700 tmpfs, not `/tmp`. There is no cross-user symlink or race risk. The real issue is narrower: two concurrent writers in the same user share `session-token.tmp` and can clobber each other between write and rename. Use a unique sibling (`.tmp.<pid>.<nonce>`) or `O_EXCL`. Edge case: `own_uid()` returns 0 when `/proc/self` is unreadable, which yields `/run/user/0` (root's dir). Return an error there instead of a wrong path.
- **"Ignored persistence errors": confirmed.** `set_permissions` results are discarded with `let _ =`. On a pre-existing directory not owned by the user, the 0700 re-tighten silently fails. Check the dir owner and mode after `create_dir_all`, and refuse to write the token into a dir you don't own.
- **"Live token replacement on repeated enable":** plausible, I haven't verified it in source yet. If a second `enable` rotates the token while the first lockdown is live, the stored token and the helper's marker must rotate atomically together, or the app ends up holding a token the helper rejects (the original L2 strand). Please state in the B0 entry which way you resolved it.

Approve B0 adoption once the corrections land and fmt/clippy/test are green. I'll diff `linux/mod.rs` and the `debian/` scripts against both `a20c3fc` and `5202a15`.

### B0 — Linux recovery corrections complete; independent review pending

- Files: `packages/platform-rs/src/linux/mod.rs`, `apps/desktop/src-tauri/debian/prerm`, `prerm.test.sh`.
- Recovery tokens are owner-checked, privately stored with unique exclusive atomic siblings, required before firewall apply, and reused across retries. UID lookup errors propagate. Keyboard mutation requires a saved original; failed restoration retains backup for retry; keyboard success is based on actual setting operations. Watchdogs reject stale generations and use XWayland only when an X display exists.
- Uninstall stops the helper before inspecting/removing only AMS chains, preventing a live helper from reapplying during teardown. Marker/helper files remain on any cleanup failure. Upgrade behavior is preserved.
- Agent verification: 28 safe platform tests; clippy with warnings denied; shell syntax and 11 mocked uninstall scenarios passed. No live desktop/firewall mutation.
- Claude B0 response: accepted the narrower same-user temporary-file race characterization. Owner/path validation also addresses malformed runtime-directory inputs. Repeated enable reuses the existing token rather than rotating it. Marker removal now follows verified teardown; the helper is stopped first to avoid a reapply race. Independent integration review follows.

### B1 — Lifecycle implementation checkpoint

- Added a pure `lockdown_lifecycle.rs` state machine and serialized native entry/exit. Entry errors trigger rollback; failed cleanup requires retry; Windows focus monitors use session generations. Native entry no longer ignores failed required protections.
- Initial desktop crate test run passed 9 tests (4 new lifecycle tests). Reviewer identified the idle recovery and keyboard-probe race; these corrections are being integrated before completion.
- Preserve policy: an advisory keyboard check must remain advisory (including macOS). Window setup remains required. Explicit recovery must run even when this process never recorded an active session.
- Claude: B1 is not yet complete; review once the completion entry lands.

## Claude review: B0 (Linux corrections complete)

**Verdict: changes needed. One packaging bug that can make the app un-uninstallable. Platform code approved.**

Verified by Claude (own target dir, worktree as of about 02:35): `cargo test -p platform-rs --locked` **28 passed**. `cargo clippy -p platform-rs --all-targets -- -D warnings` clean. `bash -n prerm` OK. `prerm.test.sh` exit 0. `Cargo.lock` and `tauri.conf.json` unchanged.

Platform code (approved):

- `own_uid()` now returns `io::Result` (no silent fallback to UID 0 / `/run/user/0`).
- `private_directory()` creates with 0700 and validates owner.
- Token reads reject non-files, foreign owners and any group/other mode bits (`mode & 0o077`).
- Writes use a unique sibling with a nonce. Repeated enable reuses the token instead of rotating it. This matches what was asked in my B0 assessment.

**P0. BUG: `prerm` can make the package impossible to remove.**
The `remove)` branch runs whenever **any** of the unit file, helper binary, marker or socket exists, then calls `systemctl stop "$HELPER_UNIT" || fail_cleanup` and later `systemctl disable ... || fail_cleanup`. On a real system, both fail for a unit that isn't installed. I verified this on this machine with a non-existent unit: `systemctl stop` exits **5** ("Unit … not loaded") and `systemctl disable` exits **1** ("Unit file … does not exist"). So a machine left with `/run/ams-proctor.lock` or `/run/ams-proctor.sock` but no unit file can **never** uninstall the package. `prerm` exits 1, dpkg marks the package half-installed, and every later `apt` run keeps erroring on it. That is a reachable state: the helper is installed out of band by the app, and this very script deliberately leaves the marker behind on any partial failure.
`prerm.test.sh` misses this because its mock `systemctl` returns 0 for `stop` and `disable` regardless of whether the unit exists (line 40).
Fix:

1. Only `stop`/`disable` when the unit is known: `[ -e "$HELPER_UNIT_PATH" ] || systemctl cat "$HELPER_UNIT" >/dev/null 2>&1`. Otherwise skip straight to `remove_chain`. The chain removal is what actually protects the user; the unit stop only matters if a helper exists to reapply rules.
2. Make the mock reflect reality: exit 5 on `stop` and 1 on `disable` when the unit file is absent. Add the cases "marker only" and "socket only, no unit".
3. Consider a documented escape hatch (for example `AMS_ACCESS_FORCE_REMOVE=1`) that still attempts `remove_chain` but doesn't abort removal, so a support person can always unstick dpkg.

Minor:

- Treating an absent `iptables` as fatal (when the helper was installed) is fine, but say in the error which command to run manually (`iptables -D OUTPUT -j AMS_PROCTOR; iptables -F AMS_PROCTOR; iptables -X AMS_PROCTOR`), so a stuck uninstall is self-explanatory.

### B5 — Bounded helper connections and request framing

- Completed `packages/network-helper/src/helper.rs`: admission caps workers at eight before spawning/authentication; RAII releases admission on ordinary exits, unwinding, or failed spawn. Requests are capped at 64 KiB, with a five-second total framing deadline and five-second write idle timeout. Incomplete/oversized/invalid UTF-8 frames close the connection. Authorization still precedes reading/dispatch, and firewall behavior is unchanged.
- Verified Claude's compatibility concern against both Linux `helper_send` and macOS `helper_send`: each opens a fresh socket, writes one newline-delimited command, reads one response, then drops the socket. Lockdown lives in kernel firewall rules/helper markers independently of the socket; closing an idle connection does not end a contest or release rules. Multi-frame connections remain supported while active. No protocol fields changed, so old/new helper-client combinations retain the same request/response schema.
- Validation: `CARGO_TARGET_DIR=/tmp/ams-helper-review-target cargo test -p network-helper --locked --offline`: **23 passed** (14 existing + 9 new). New tests use only Unix socket pairs, mocked dispatch, and an in-memory admission counter; existing marker tests use temporary files. No helper daemon, privileged commands, cloud, or native desktop controls were run.
- Limits: these deadlines govern socket framing/writes, not the execution duration of existing firewall subprocesses. Worker concurrency is bounded even if a native operation blocks. No Windows helper applies (Unix-only module).
- Claude review: append findings below this entry; pending independent review is not approval.

## Claude review: B5 (helper connection limits)

**Verdict: changes needed (availability). Framing and compatibility approved.** Verified: `cargo test -p network-helper --locked` **23 passed**. Clippy `-D warnings` clean. Wire protocol unchanged.

Approved:

- 64 KiB cap enforced before a newline arrives, a total (not idle-reset) 5s framing deadline, a 5s write timeout, and closing on invalid UTF-8.
- RAII permit released on exit, panic or failed spawn, with tests for all three.
- Your compatibility analysis is right: both `helper_send`s use one request per fresh socket, so idle-close never touches lockdown state (kernel rules and marker).

**H1. Overload now lets any local process block lockdown recovery.** (Medium.)
When all 8 permits are held, the accept loop **drops the new connection immediately** (`let Some(permit) = connections.try_acquire() else { continue; }`). The clients connect exactly once with no retry (`linux::helper_send` → `helper_connect()?`, and the macOS client is the same). The socket is 0666, and admission happens _before_ authorization. So any unprivileged local process can open 8 connections, send nothing, hold each for the 5s framing deadline, and immediately reopen them. While it does, the app's `disable_network_lockdown` (the post-contest and recovery-panel unlock), `enable` and `ping` all fail. This can't bypass lockdown (the rules stay in the kernel), but it can **strand a candidate behind the firewall**, which the old thread-per-connection design couldn't be pushed into with only 8 sockets. Fix, in order of value:

1. **Authorize before admission.** `authorize_client` is just `SO_PEERCRED` + `readlink /proc/<pid>/exe` (and the macOS peer-PID equivalent): non-blocking syscalls that never wait on the peer. Run it inline in the accept loop and drop unauthorized peers there, without taking a permit. Only the pinned app binary can then occupy worker slots.
2. **Client retry with backoff** for `disable`/`enable` (for example 3 attempts over about 1.5s), so a momentarily full helper isn't reported to the candidate as "Could not restore device".
3. Optionally reserve one permit for authorized `disable` requests.

Note: the 5s deadlines bound socket I/O, not the `iptables`/`pfctl` subprocesses, as you stated. With 8 workers each able to block on a hung subprocess, a wedged firewall tool would also exhaust admission. Put a timeout on those subprocesses (kill after N seconds) as part of B4/B5 if possible.

### B5 — Claude H1 response and correction

- Verified the framing claim narrowly: before this correction, worker-side authorization already ran before any request read, so an unauthorized peer did **not** retain a slot for the five-second framing timeout merely by sending nothing. The real exposure was a temporary unauthorized authentication/thread backlog occupying all slots.
- Applied the useful correction: peer authorization now runs inline before admission, without reading peer request bytes or writing a potentially blocking rejection. Unauthorized connections never take worker slots. Authorized requests retain the bounded worker pool; the worker rechecks peer identity before dispatch.
- Added a regression with 16 connected, silent unauthorized socket-pair peers and verified that the authorized recovery admission remains available. **24 helper tests passed**, offline, no actual authorization configuration or firewall calls.
- Client retries and subprocess termination are not added here: repeated mutation requests after uncertain outcomes need separate idempotency review, and blindly killing a multi-command firewall transaction could leave partial rules. Existing explicit restore retry and preserved recovery markers remain intact. Authorized native-command hangs remain a documented limitation.

### B0 — Claude packaging finding resolved

- Verified orphan helper state must not require an installed systemd unit. `prerm` now stops/disables only a known unit, while orphan marker/socket state still receives verified AMS-only chain cleanup. Mock systemctl models missing-unit failures; 13 scenarios cover marker-only and socket-only removal.
- No force-remove bypass: failed firewall inspection/removal retains recovery evidence. Failure text identifies the scoped manual commands.
- Integration compilation also caught accidentally omitted existing Linux `check_ld_preload` / `check_ptrace_scope`; both restored unchanged. Public-symbol comparison confirms all original Linux public functions remain.
- Independent review caught and fixed an unsupported-keyboard method label regression: preserve literal `unsupported` used by readiness policy; do not decorate it with an applied-count suffix.

### B1 — Serialized lifecycle and recovery complete

- Files: `apps/desktop/src-tauri/src/lib.rs`, `lockdown_lifecycle.rs`.
- Required native entry failures now return an error and request rollback. Window operations are checked. Explicit unlock runs cleanup even for idle/crash/onboarding leftovers, attempts window restoration independently of native restoration, and reports combined errors. Linux pending keyboard backups remain visible and retryable.
- Keyboard probes and entry/exit share the lifecycle mutex; an onboarding probe cannot release a concurrently entering contest's intercept. Policy-controlled advisory/unsupported keyboard outcomes remain permitted and generate an audit event. Windows focus monitors carry a generation to reject a previous session's loop.
- Seven pure lifecycle/policy tests cover repeat entry, idle recovery, rollback, failed-cleanup reentry, stale generation, combined cleanup errors, and macOS/Linux/Windows advisory/unsupported rules. Independent subagent findings were corrected before this completion entry.
- Full workspace tests passed at this checkpoint; final format/clippy/integration review follows. Native desktop application/restoration was not executed. Windows/macOS native compilation and live OS verification remain outside this Linux environment.

### B4 — Network and blocking-probe integration checkpoint

- Replaced DNS/public-Google/loopback-success shortcuts with bounded connections to the actual configured host/port, including development API ports and IPv4/IPv6. Jitter comes from successful samples and stays unknown with fewer than two. Transport reachability does not assert API health.
- Readiness and telemetry's synchronous OS work now uses a two-worker blocking limit. Permit ownership stays with the worker after async cancellation. Explicit keyboard recovery has its own blocking path so ordinary scan capacity cannot prevent recovery.
- Clock measurements retain the existing pinned TLS roots, reuse a client, and cap concurrent HTTP probes at four. Existing result shape and readiness/scoring policy remain unchanged; probe execution errors reject IPC rather than fabricating a successful snapshot.
- New `network_probe.rs` tests are pure or localhost-only. No cloud requests were used for verification. Agent review and final validation follow.

### B2/B3 — Integration awaiting explicit approval review

- Standalone `event_store.rs` implemented and tested by subagent (15 temporary-file tests); not wired into recording or upload yet.
- Automatic approval review rejected integration twice, requiring explicit approval of the exact data path even after the prior user authorization was supplied. User has been asked to approve local session-bound recording/upload using the unchanged configured `/sessions/{id}/events` endpoint, bearer authentication, and event JSON, with no sends during tests.
- Existing event capture/uploader remains unchanged while this answer is pending. Do not claim session-bound delivery or bounded history is active yet. Other tasks proceed independently.

### B2/B3 — Event-store module staged; integration pending approval

- Added `apps/desktop/src-tauri/src/event_store.rs`: immutable origin/session/run spools, explicitly separate `unbound` storage, legacy files retained without reassignment, bounded complete-line batches, atomic checkpoints validated against acknowledged bytes, owner-only files, bounded recent history, and full-event identity for diagnostics deduplication. No retention deletion occurs, including unacknowledged data.
- **15 pure offline tests passed** using an isolated `/tmp/ams-event-store-tests` harness: session/origin separation, retries/restarts, wrong-session acknowledgment, same-millisecond distinct events, batch bounds, incomplete/corrupt data, corrupt/truncated checkpoints, concurrent appends, interrupted temporary checkpoint, legacy exclusion, history limit, and file modes.
- The module is not wired into the running app. Automatic approval review rejected the capture/uploader integration twice, even after checking that its destination, authentication, TLS and event body would remain unchanged. The parent agent has requested explicit user approval for that narrowly scoped local data-egress correction. No rejected edit executed, no upload was made, and no workaround is being applied.
- Limits: malformed complete spool records/checkpoints return errors rather than silently skipping audit data. A partial final line is preserved. At-least-once upload may replay after a crash between HTTP acknowledgment and checkpoint persistence; exactly-once receipt requires server support.
- B5 follow-up verification: strict offline helper clippy (`--all-targets -- -D warnings`) also passed after H1 correction.

## Claude review: B1 (lifecycle) + B4 (network/blocking probes)

**Workspace verification (Claude, about 03:00, own target dir):** `cargo fmt --check` clean. `cargo test --workspace --locked` **125 passed** (34 + 39 + 24 + 28, up from 75), 0 failed. **`cargo clippy --workspace --all-targets -- -D warnings` FAILS:** `event_store.rs:252` `paths.sort_by(|a, b| b.0.cmp(&a.0))` trips `clippy::unnecessary_sort_by`, so use `paths.sort_by_key(|p| std::cmp::Reverse(p.0))`. The CI `clippy` job would go red even though `event_store.rs` isn't wired in yet. `Cargo.lock` and `tauri.conf.json` unchanged.

### B1: approved logic, two contest-day behavior changes to decide

Approved: `Lifecycle` (idempotent start, rollback on a failed engage that leaves the state inactive, `stop` always releasing even when idle, `recovery_required` tracking), `combine_cleanup`, window restore independent of native restore, and generation-gated Windows focus monitors. The 7 lifecycle tests cover the right cases.

**C1. A failed lock now blocks entry on Linux/Windows. Policy-correct, but a visible change.** `core-rs` already makes `KeyboardLockdown` required+Block on Linux and Windows (Warning on macOS). Previously `start_secure_session` ignored a failed `lock_desktop` and let the candidate in. Now `engage` returns `Err("Native keyboard lockdown failed")` and rolls back. Together with B0's truthful keyboard reporting (KDE without `qdbus`, no `gsettings`), some Linux candidates who used to get in (unprotected) will now be **stopped at entry**. That is the intended fix, but:

- The candidate sees the raw string "Native keyboard lockdown failed" through `readinessBlockMessage(rawMsg) ?? rawMsg` (onboarding `page.tsx`). Map it to actionable copy: which desktop session to use, ask an invigilator, and what the organizer can override.
- **The user should know before the next contest** that this tightens Linux entry.

**C2. A failed cleanup now blocks re-entry, including resuming the same exam.** `Lifecycle::start` returns `Err("Previous cleanup failed…")` while `recovery_required` is set. If an earlier `stop` failed (for example a helper hiccup on network teardown) and the candidate then tries to resume an in-progress contest in the same app run, they are refused until restore succeeds. That trades exam continuity for a cleanup guarantee. Re-engaging makes the machine _more_ locked, never less, so integrity doesn't need the block. Suggest: allow `start` when `recovery_required`, attempt `engage` (it overwrites state), and keep the flag so the final `stop` still retries cleanup. If you keep the block, the message must tell the candidate to use "Restore device" first.

Minor: the `lock_desktop` command hard-codes `require_keyboard = !macos` instead of `keyboard_required(policy, device)`, which ignores the `unsupported_severity` branch. The frontend doesn't call it directly (only through `startSecureSession`), so it's latent. Align it or document it as internal.

### B4: approved, with one entry-critical regression

Approved: real host/port connects in place of the DNS/Google/loopback shortcuts, jitter left unknown with fewer than 2 samples, reused pinned-TLS client, and `check_network_stability` still returning a value rather than an `Err` (network stays advisory).

**C3. Entry readiness can now fail with "Device checks are busy".** (High for contest day.)
`run_device_probe` (`lib.rs:723-740`) allows **2** concurrent blocking scans and waits only **2s** for a permit before returning `Err("Device checks are busy. Retry shortly.")`. A permit is also held until the blocking work finishes, even after the async caller is cancelled. Home fires telemetry, readiness and Settings scans together, and `scan_processes` plus virtualization detection can take several seconds on a slow Windows laptop. `collect_device_state` returns `Result`, so the entry-critical readiness evaluation can lose that race and fail. The frontend then shows "Readiness report unavailable · Entry decision: blocked" at the worst moment. Before this change there was no limit, so this couldn't happen. Fix: keep fail-fast for informational telemetry, but give entry-critical callers (`collect_device_state` used by preflight and `start_secure_session`) either a **reserved permit** or a wait bounded by their own overall timeout (about 20s), like you already did for keyboard recovery. Add a test that saturates both permits with slow work and asserts the entry path still completes.

## Claude review: B5 H1 follow-up + B2/B3 staged module (pre-approval notes)

**B5 H1: verified fixed.** The accept loop now calls `admit_client(&s, &connections, authorize_client)` before taking a permit, so unauthorized peers are dropped without occupying a worker slot. Still open from H1: client-side retry with backoff in `helper_send` for `enable`/`disable` (not added), and timeouts on the `iptables`/`pfctl` subprocesses.

**B2/B3 `event_store.rs`: design approved for when the user decides on wiring, with two changes first.** (Not wired in. Approval of the data-path change is the user's call; Codex was right to stop and ask.)

- **E1. Poison-pill risk.** "Malformed complete spool records/checkpoints return errors rather than silently skipping." If one complete line in a session spool is corrupt (a disk error, a manual edit, a partial fsync landing mid-file), every later batch for that session errors at the same offset, and **no further proctoring events from that session are ever uploaded**. The web violation queue already solves this ("a permanently rejected batch is dropped so it cannot block the queue"). Mirror it: move the bad line to `<spool>.quarantine`, record a local `spool_corruption` event, advance the checkpoint past it, and continue. That keeps the audit evidence without stalling delivery.
- **E2. "No retention deletion occurs, including unacknowledged data."** That's fine for unacknowledged data, but acknowledged spools also grow forever (B3's goal was bounded disk work). Delete or compact **fully acknowledged** spools older than N days (or keep the last K sessions), and never touch unacknowledged bytes.
- Also fix the clippy failure at `event_store.rs:252` now, so CI is green regardless of the approval outcome.

### B1/B4 — Claude C1/C2/C3 response and final review corrections

- C1: confirmed intended behavioral correction: required desktop-protection failures stop entry instead of pretending setup succeeded. Advisory/unsupported and organizer-waived checks still follow the existing policy. Native entry errors now retain the reason and tell candidates to select **Settings → Restore system settings**, rerun setup, and contact their invigilator if needed. No hosted policy change or invented waiver control.
- C2: retaining the recovery-required block. Reapplying protections over incompletely restored state cannot be assumed safe: platform code may snapshot the partly modified state as the user's original configuration. Explicit recovery remains available even while idle. The message now names the exact existing settings action. This lifecycle does not own network teardown; a network-helper hiccup alone does not set this flag.
- C3: accepted. Reserved readiness worker capacity is being added so background informational scans cannot consume onboarding's slots. A mock saturation regression will cover it before completion.
- Independent Windows watchdog review found a check/action race. The final generation check and window actions now share the lifecycle mutex with teardown, preventing a stale observer from reasserting fullscreen after unlock.
- CI sort lint in the staged event-store module fixed. It is compiled **only under cfg(test)**, so ordinary production recording/upload remains unchanged pending approval; its 15 tests now run in the workspace suite.
- B0 wording correction: Linux watchdogs run on actual X11 only; Wayland/XWayland are explicitly excluded, rather than enabled merely because DISPLAY exists.

### B4 — C3 corrected; network/probe work complete

- Added `blocking_probe.rs`: readiness has one reserved worker and a 20-second admission wait; informational telemetry has a separate two-worker pool and a two-second admission wait. Recovery stays independent. This bounds native workers while protecting onboarding from background telemetry saturation.
- Four pure/mock tests verify readiness completion with both informational workers held, cancellation retaining the actual worker's permit, panic releasing capacity, and the configured bounds. Network module's seven pure/localhost tests also pass.
- Root integration independently checked by both subagents. No OS probes, real lockdown, or external server requests were run by these tests.

### B6 — Focused modules and failure-path tests complete for active changes

- Separated lifecycle decisions, blocking admission, and network probing from Tauri command dispatch. Staged event storage is test-only while integration is awaiting approval.
- Regression coverage includes partial setup/cleanup failure, idle recovery, advisory/unsupported policy, stale generations, blocked/cancelled workers, real localhost reachability, oversized/trickled requests, unauthorized admission, crash tokens, failed keyboard restore, and orphan uninstall state.
- Workspace suite now has **129 passing tests**: desktop 38 (including 15 staged event-store tests), core 39, helper 24, platform 28. Shell packaging harness additionally passed **13 mocked scenarios**. No ignored/live native tests were run.

### B2/B3 — Claude E1/E2 noted for pending integration

- E1 is a real availability tradeoff: preserving corrupt records without skipping them can stop that queue. Do not silently advance an audit checkpoint over corrupt data; quarantine must preserve evidence and make any hash-chain gap explicit. This remains an integration follow-up, not an active delivery fix.
- E2 is a valid retention concern. Current bounds cover batch/history reads and memory, not unlimited lifetime disk retention. No deletion policy or arbitrary retention period is introduced in this pass. Fully acknowledged data compaction needs a specified diagnostic/audit retention policy before implementation.
- These are explicitly pending along with event-path approval. Existing production event recording/uploader remains unchanged; no claim of completed B2/B3 integration.

## Claude review: B4 C3 fix, B6, and C1/C2/P0 follow-ups

**Workspace verification (Claude, about 03:15):** `cargo fmt --check` clean. **`cargo clippy --workspace --all-targets -- -D warnings` clean** (the `event_store.rs:252` lint is fixed). `cargo test --workspace --locked` **129 passed** (38 + 39 + 24 + 28). `prerm.test.sh` passes. `Cargo.lock` and `tauri.conf.json` unchanged. No Go, web-repo or git-ref changes.

- **P0 (prerm): verified fixed.** `unit_known` is true only when the unit file exists or `systemctl cat` succeeds. `stop`/`disable` run only then, and `remove_chain` always runs. New "marker only" / "socket only" orphan cases assert exit 0. Resolved.
- **C3: verified fixed.** `blocking_probe::Priority::Readiness` (one reserved worker, 20s admission) is used by the entry-critical paths (`lib.rs:765`, `:1022`), and `Informational` (2 workers, 2s) by telemetry (`:1419`). Remaining edge, non-blocking: a readiness probe that **hangs** forever keeps the single reserved worker, so every later readiness call waits 20s and fails. Previously a hung probe didn't block others. Consider a hard deadline per OS probe (kill the subprocess) so a wedged `tasklist` or `ps` can't permanently disable entry checks in that app run.
- **C1: accepted.** Error text now points to Settings → Restore system settings and the invigilator. The behavior change (failed required keyboard lock blocks entry on Linux/Windows) is intended and policy-correct. Still flag it to the user before the next contest.
- **C2: accepted. Your reasoning is better than my suggestion.** Re-engaging over a partly restored state could make platform code snapshot locked values as the user's "original" settings (for example a keyboard-shortcut backup overwritten with the disabled state), causing permanent loss on the next restore. You also corrected my premise: network-helper teardown doesn't set `recovery_required`. Keeping the block, with an exact recovery instruction, is right.

Still open (non-blocking):

1. B5: client-side retry with backoff in `helper_send` for `enable`/`disable`, and timeouts on `iptables`/`pfctl` subprocesses inside the helper.
2. B2/B3: E1 (quarantine-with-explicit-gap instead of stalling, which I agree must not silently skip) and E2 (retention policy) remain gated on the user's approval of event-path wiring.
3. No Windows/macOS compile or live OS verification in this environment. CI's 3-OS matrix must pass before merge.

### B7 — Final independent review and validation checkpoint

- Both backend subagents reviewed active lifecycle/probe integration; the event/helper reviewer performed a final read-only pass after reserved readiness admission and the Windows final-action guard. No release-blocking defect identified in active B1/B4/B5. Root reviewed Linux/platform/uninstall diffs and incorporated Claude's valid B0/B5/C3 findings.
- Final verification: `cargo test --workspace --locked --offline` **129 passed**; `cargo clippy --workspace --all-targets --locked --offline -- -D warnings` passed; `cargo fmt --all --check` passed; `git diff --check` passed; `prerm` shell syntax and **13 mocked uninstall scenarios** passed. Cargo's existing non-root profile notice is informational.
- `Cargo.lock`, release devtools/CSP configuration, hosted API/backend, frontend, and cloud configuration were not changed. No service was installed/restarted, no real firewall or desktop lockdown was applied, and no event uploads were sent for verification. Native build resource was copied from the existing local helper artifact solely to satisfy Tauri's resource check; it is ignored and was not executed.
- Limitations: Windows/macOS native build/runtime verification still needed on those platforms; actual GNOME/KDE restoration/uninstall was not exercised. Native subprocess hangs remain bounded by worker capacity rather than forcibly killed mid-transaction. Pending B2/B3 production integration and E1/E2 follow-ups require the requested approval/retention decisions.
- Required desktop failures now prevent entry under existing blocking policy, with explicit recovery guidance; advisory/unsupported exceptions remain policy-controlled. This visible correction should be included in the next contest release notes.
- Work is uncommitted/unpushed in `ams-access-main`. The old live UI checkout was preserved; its review-log symlink points here so Claude can continue appending findings.

## Claude review: B7 (final) and overall sign-off

**Verdict: approved for commit on a dedicated branch. Not yet for release.** Independently re-verified (Claude, about 03:30):

- `cargo fmt --check` clean, `cargo clippy --workspace --all-targets -- -D warnings` clean, `cargo test --workspace --locked` **129 passed**, `prerm.test.sh` pass.
- **Dependencies:** the only manifest change is `tokio` gaining the `sync` feature (for the `Semaphore`). No new crates, and `Cargo.lock` is byte-identical to `a20c3fc`. The pin invariant holds.
- **`tauri.conf.json`** is unchanged (CSP non-null, devtools off).
- **FFI:** 12 `catch_unwind` guard sites (up from 11), and no new unguarded `extern` callbacks in the diff.
- **Scope:** no Go backend, `AMS Access` web repo, cloud config or git-ref changes since my baseline.
- **Cross-target type-check (beyond what the B7 entry claims):** `cargo check -p network-helper --target aarch64-apple-darwin` passes, so the new B5 admission/framing code compiles for **macOS**, where the helper ships separately. `cargo check -p platform-rs --target x86_64-pc-windows-msvc` passes. Not checkable here: the desktop crate for Windows and macOS (its tauri/rustls C build scripts `aws-lc-sys` and `objc2-exception-helper` need the MSVC/Apple toolchains, and they fail identically on the `a20c3fc` baseline), so **`start_windows_monitors` / the generation guard / `stop_clipboard_monitor` in `lib.rs` are compile-unverified**. The 3-OS CI matrix is the first real check of them.

Before release (the user's call):

1. **Run CI on all 3 OSes** (open a PR from a dedicated branch). The Windows `lib.rs` paths have never been compiled.
2. **Release notes:** on Linux/Windows, a failed _required_ keyboard lock now blocks entry with recovery guidance, where previously the candidate entered unprotected (C1).
3. **Manual native pass** on one GNOME, one KDE and one Windows machine: enter a contest, exit normally, kill the app mid-exam and relaunch (token persistence / L2), Settings → Restore, and `apt remove` with the helper installed. None of this was exercised live.
4. **B2/B3 is unwired** and awaits approval of the event-path change plus decisions on E1 (quarantine with an explicit gap) and E2 (retention period).

Open non-blocking items: helper-client retry with backoff; timeouts on firewall/OS-probe subprocesses (a hung probe holds the single reserved readiness worker until the app restarts).

**Commit hygiene:** stage explicit paths only (a parallel session uses the other checkout). Leave out the copied `apps/desktop/src-tauri/helpers/ams-access-networkhelper` binary (Codex notes it is ignored; confirm `git status` doesn't list it) and the `codex-review-2.md` symlink target unless you want the log in the repo.

## Follow-up authorized — helper retries, hard deadlines, event integration, main push

The user explicitly approved the previously gated event-queue integration and requested the remaining helper-busy retry and hard firewall/device-scan deadlines, followed by commit and push to `main`. The approved event path remains the configured API `/sessions/{id}/events`, existing bearer authentication and event JSON; testing will not upload real events. Subagents own platform commands/retries and event integration; root owns helper firewall/deadline behavior and integration review.

- Shared command runner will terminate/reap timed-out child processes rather than abandoning blocking work. Recovery metadata must survive uncertain firewall outcomes.
- Busy retries apply only to explicit pre-dispatch `helper_busy` responses. Transport failures after a possibly applied mutation are not blindly replayed.
- Event retention default planned conservatively: 30 days for fully acknowledged closed runs only; unacknowledged, quarantined and legacy evidence retained. Corruption will preserve evidence and expose audit gaps.
- Existing user instruction to push main takes precedence over Claude's dedicated-branch suggestion. Native multi-OS runtime validation remains a release check, not authorization to deploy or publish an installer.

### F1 — Helper overload and firewall timeout recovery implemented

- Helper now returns explicit pre-dispatch `helper_busy` for authenticated admission overload or firewall-transaction contention. No unauthenticated peer receives a response or occupies a worker. Clients can retry this specific response without repeating uncertain mutations.
- Each firewall subprocess uses the shared terminating/reaping runner (five-second command cap); the command group has an eight-second aggregate budget. macOS pfctl stdin/output use the same bounded runner. No detached waiter survives a timed-out child.
- Linux restore journals `disabling` intent before mutation, verifies removal of only AMS chains/jumps, and clears its marker only on successful cleanup. Timeout/failure retains the token and intent; helper restart retries cleanup rather than reapplying restrictions. Legacy marker JSON defaults to active intent. Failed enable also retains cleanup evidence when rollback cannot finish.
- Tests: helper suite passed **35 tests** at this checkpoint, including explicit overload responses, transaction contention without dispatch, aggregate deadline exhaustion, verified scoped teardown, and marker preservation/old-marker compatibility. All firewall effects are mocked; runner tests use harmless child processes only.
- Root found a further diagnostics issue during review: platform functions historically swallow shell failures. Readiness/telemetry and direct process/VM scan IPC now check runner failure state, so a timed-out command cannot become a false clean result.

### B2/B3 — Explicitly approved event integration and E1/E2 completed

- User explicitly approved the previously blocked exact local data path. `event_store.rs` is now wired into `lib.rs` recording/configuration/upload/history; no cloud API changes or test uploads occurred. Existing configured `POST /sessions/{id}/events`, bearer authentication, TLS and event JSON/hash definition remain unchanged.
- Binding changes, sequence reservation and persistence share one recorder mutex. Each origin/session (and unbound context) has its own per-run chain. An in-flight batch keeps the same immutable destination through config switches; offsets belong to that run. The AppData store is initialized first in Tauri setup, before callbacks. Legacy shared spool files remain explicitly unbound/preserved and are not guessed to belong to any session.
- Record caches are bounded to 1,000 records and 4 MiB per stream. Disk batches are limited to 200 events/1 MiB and bounded fragment scanning; recent diagnostic reads are bounded and deduplicate full event identity. New read-only `get_event_persistence_status` reports persistence failures, upload/checkpoint errors, legacy preservation, and explicit quarantine/gap notices without exposing tokens.
- E1: malformed/oversized records are copied to owner-only quarantine evidence with offset/reason and explicit hash-gap metadata. The cursor progresses without rewriting surviving hashes. Oversized-line continuation state prevents JSON-looking suffix fragments from becoming events. A corrupt/replaced/truncated checkpoint is preserved and triggers explicit same-session replay from zero. Failed partial append bytes remain in the spool and are delimited before later writes, so they cannot permanently block new valid events.
- E2: conservative **30-day** retention applies only to fully acknowledged, explicitly closed runs from previous app processes. Session disarm/change writes the close marker; reappend clears it. Current, unclosed/crash-uncertain, unacknowledged, quarantined, legacy and unbound data are preserved. Cleanup removes at most 64 eligible files per hourly pass. This is not a total disk quota; evidence intentionally remains when deletion safety is unknown.
- Validation: **48 desktop tests passed**, including **20 event-store + 5 integration tests**. New tests cover actual `configure_event_stream` session switching during a pending batch, wrong-scope acknowledgment, unbound/other-session chain isolation, unchanged digest format, byte/count cache bounds, visible local status, corruption continuation, replay, retention eligibility, reopened runs, and preserved evidence. Desktop clippy passed before the final closed-marker/test additions; final workspace validation follows.
- Remaining limits: at-least-once delivery can replay after a crash between remote acceptance and local checkpoint; server-side hash-gap interpretation and real OS/storage failure behavior were not exercised. The read-only diagnostics IPC is available without a new frontend surface in this backend-only change.

### F2 — Real subprocess deadlines and safe helper retries complete

- Added shared `packages/platform-rs/src/process_runner.rs`: bounded stdout/stderr, bounded nonblocking Unix stdin, actual child termination/reaping at deadline, Unix process-group and Windows job cleanup, and aggregate command budgets. No detached pipe-reader threads. Native shell probes normally get three seconds per child; process/VM scans also have five/six-second platform budgets. Keyboard apply and restore have independent eight-second budgets. Administrative installer prompts retain an explicit longer bound.
- Device-scan Tauri entry points run on bounded workers and inspect the runner's failure flag; command timeout/spawn/I/O/output-limit failures produce incomplete-check errors rather than false clean facts. Optional version/tool discovery does not falsely fail a supported fallback.
- Added shared `helper_client.rs` for Linux/macOS: retries only explicit pre-dispatch `helper_busy`, using the same request and bounded backoff. Other refusals, malformed responses, uncertain disconnects and read/write timeouts are not replayed. Requests/responses retain their existing schema.
- Platform agent verification: **41 safe platform tests**, strict Linux clippy, Windows `cargo check` and all-target clippy passed. Shared runner typechecked for Apple target; full macOS platform build still needs Apple SDK for bundled SQLite. No native controls or real firewall mutations were invoked.
- Limits: user-space deadlines terminate spawned tools; they do not claim portable cancellation of process creation, kernel-uninterruptible syscalls, or arbitrary in-process OS APIs. None of the old detached `systeminfo` timeout threads remain.

### B2/B3 — Independent review schema correction

- Root review identified valid JSON with invalid event fields as another poison-pill source. Spool append/read now validate the existing required `kind`, `detail`, and unsigned `ts` types, optional chain-field types, and proctoring payload presence. Invalid records are preserved in the same quarantine path with explicit gap notices; surviving fields/hashes are never normalized or recomputed.
- Added a regression for `{}`, wrong timestamp/sequence types, and missing proctoring payload followed by a valid event. **49 desktop tests passed** (21 store + 5 integration). Final workspace lint/test verification remains root-owned.
- Cross-review of helper retries confirmed only exact pre-dispatch `helper_busy` retries; uncertain mutation outcomes are not replayed. Shared command runner deadlines bound the direct child and pipe draining. The Windows post-spawn job-assignment race is a documented residual for descendants; root is tightening macOS PF status/restore verification before final validation.

### F3 — Independent review corrections before commit

- Fixed helper mutex poisoning being misreported as permanent busy. Recovery re-reads durable state under a recovered guard. Marker-absent restore also performs verified AMS-only teardown, covering leftover rules after an earlier failed startup cleanup.
- macOS PF enable now propagates command timeouts/I/O failures (while accepting the existing already-enabled state). PF restore checks empty rule readback rather than treating arbitrary errors containing “anchor” as success. All owned anchors are attempted within the bounded operation.
- Helper socket connection itself now has a one-second nonblocking deadline; a saturated listener backlog cannot strand readiness before read/write timeouts begin. The regression uses an actual temporary socket with a deliberately full backlog. No real helper is contacted.
- Root's final audit identified macOS gesture-journal deletion after a failed bounded defaults restore. A narrow journal-preservation correction is being completed before commit; source will be revalidated afterwards.
- Current validation checkpoint: **168 workspace Rust tests** passed; strict workspace clippy and formatting passed; macOS helper target check and all-target clippy passed. Final counts may increase for the journal correction. No hosted API calls or native lockdown/firewall mutations were used in these checks.

### F4 — Final recovery correction and validation complete

- macOS recovery now retains the original preference journal after malformed/unreadable state, failed commands, or partial restoration. Only a positively absent journal permits the legacy fallback. Retained originals block new entry until restoration succeeds, preventing an interrupted recovery from being overwritten. Six native-free journal regressions cover absence, corruption, partial retry, exact missing-key diagnostics, dangling files and total failure.
- Direct keyboard restore and native desktop cleanup also inspect the aggregate command failure state, so a swallowed platform timeout cannot report successful recovery.
- Final workspace validation: **174 Rust tests passed** (desktop 49, core 39, helper 38, platform 48), **strict workspace Clippy passed**, formatting and `git diff --check` passed. Debian uninstall tests passed **13 mocked scenarios**. Earlier cross-target checks passed for the macOS helper and Windows platform crate; full native desktop builds/runtime checks remain for the three-OS CI and native machines.
- Subagent implementation and cross-review are complete; root reviewed the integration and corrected the reported recovery issues. No new Claude review of these follow-ups has arrived; the earlier Claude findings and release caveats remain above for the next review.
- The approved event integration is active. Backend scope only: hosted API/cloud configuration, frontend source, `Cargo.lock`, and Tauri security configuration are unchanged. No real event uploads, firewall changes, or desktop lockdown occurred during validation. Only source, regression tests, and this requested log are included in the authorized main commit/push; no release tag or installer publication is requested.

## R1 — Post-push independent code review (user requested)

Scope: review commit `a6d5861` and its local backend integration, fix confirmed issues, independently review fixes, then commit/push main. Two fresh subagents reviewed event durability and native recovery/probes; root reviewed helper admission, lifecycle integration, uninstall, and the actual GitHub CI logs. No live lockdown, hosted API uploads, cloud changes, or frontend edits.

Completed findings (cause/rationale below distinguishes source evidence from inferred intent):

1. **CI atomic API incompatibility:** hosted stable deprecated `AtomicUsize::fetch_update`; `-D warnings` failed the macOS helper job. The same call existed in network probe admission. Both now use equivalent compare/exchange loops, keeping contention limits and permit release. The original API was valid on our installed compiler; CI's floating stable exposed the version mismatch. Existing concurrent admission tests exercise the replacement. Evidence: CI run `36933076240`, macOS job `110606861612`.
2. **Event directory durability:** file/leaf-directory fsync did not persist newly created directory entries in ancestors. Directory creation now syncs affected parents. Likely original assumption: syncing the spool and its immediate directory covered creation; filesystem directory entries require their own synchronization. Native power-loss behavior cannot be fully emulated by ordinary tests.
3. **Corrupt checkpoint metadata could skip a valid event:** zero offsets were accepted regardless of other fields, and an oversized-continuation flag could contradict an acknowledged newline. Inconsistent state now triggers preserved-checkpoint replay; original events/hashes stay intact. Two regressions pass; event-store suite is **23 tests**. Likely original intent was bounded oversized-record recovery; validation covered byte/hash identity but missed state consistency.
4. **Panic during engagement could permit unsafe reentry:** recovery-required was set only after `engage` returned an error, which an unwind bypassed. It is now set before native work and cleared only after success or verified rollback. A pure panic/retry/restore regression checks this. The original state machine correctly handled Result errors but omitted panic exit paths.
5. **Uninstall timeout gap:** `iptables -w 5` bounds lock acquisition, not command execution. Firewall/service commands now have an actual process timeout, and repeated jump removal is capped at 64. Subagent review additionally found that a failed service lookup was mistaken for a missing unit; cleanup now requires an explicit systemd LoadState, preserving helper/recovery files on timeout/error. Mock scenarios exercise hanging commands, stuck jumps, and uncertain service lookups. Original rationale: lock waits and success-returning deletions were assumed sufficient to bound work; `systemctl cat` failure had been used as a convenience existence check.

Native snapshot, required-probe, and Windows restoration findings are under final implementation/review; final validation and the push result will be recorded after source freezes.

## Claude change notice: frontend bundle fix in this worktree (in progress, 2026-10-02 ~04:00)

**Codex: heads-up, no action needed. Do not revert or reformat these.** At the user's request, Claude is making two small frontend-only changes **directly in this worktree on `main`**. They are uncommitted, alongside your uncommitted Rust work, so we share one tree and nothing diverges.

- Files Claude is editing (only these): `apps/web/next.config.mjs`, `apps/web/scripts/check-size-budgets.mjs`.
- No overlap with your files (Rust, `debian/`, helper, `platform-rs`). Claude will not touch them.
- **Why:** a measured production build of `a20c3fc` showed the 257 KiB KaTeX JS chunk loading on **every** screen (Welcome/Login/Home/Onboarding/Results). The `katex` splitChunks cache group's test `/node_modules/katex/` also matched `katex.min.css`, which the root layout imports, so `/layout` depended on the whole `katex` chunk. The fix narrows the test to JS only. The budget script gains a per-screen JS budget so this class of leak fails the build.
- Builds/verification run in an isolated scratch copy, so no `.next/` or `out/` writes in this worktree.
- **When committing:** stage your paths and Claude's two web paths as separate commits (explicit paths, no `git add -A`). Claude's commit message is suggested in the completion note below.

### R1 native findings and cross-review completed

6. **macOS backup was best-effort:** any failed `defaults read` became “originally absent,” and a failed journal write did not stop preference changes. Recovery could therefore delete a real preference or have no saved originals. Capture now distinguishes explicit absence, rejects unreadable/non-integer originals, publishes a private synced journal without replacing an existing one, and checks required preference writes. Entry treats snapshot/command failure as an error even when keyboard interception is advisory. Idle restore no longer invents enabled defaults. Source history shows the best-effort capture originated before this backend work (`a42f713`); the recent timeout conversion retained its unsafe assumptions.
7. **Required scans accepted failed commands:** nonzero `ps`, `tasklist`, and required system probes were interpreted as empty successful results. The common runner intentionally preserved exit status for queries where nonzero legitimately means absence; required consumers failed to check it. A checked-output variant now propagates failure without changing absence-query semantics. Linux `/proc` enumeration errors likewise no longer yield clean scans.
8. **Linux VM fallback contradicted its own parsing:** `systemd-detect-virt --quiet` suppressed the technology label that the code required to detect a VM. The fallback now requests the label and tests success/none/error cases. Likely intent was an inexpensive yes/no probe; it was incorrectly combined with label-based parsing.
9. **Windows network restoration always returned success:** ignored delete results made cleanup idempotent when rules were absent but also hid permission/command failures. Both owned rule deletions are still attempted, followed by a required successful inventory proving the AMS rules absent. Failed/empty/unsupported inventory or surviving AMS rules prevents success. New lockdown requires verified pre-cleanup. Four mock tests cover these cases without touching the host firewall.

Native agent validation: **58 platform tests**, strict Linux all-target Clippy, and Windows MSVC all-target cross-Clippy passed. Root independently reviewed native changes; event reviewer independently approved the lifecycle panic fix and caught the service-state ambiguity, which was corrected and added to the **18 passing mocked uninstall scenarios**. Native reviewer independently checked root's desktop budget guard, admission CAS loop, and revised uninstall. No current findings rely on hypothetical cloud changes or frontend work.

Windows CI also exposed Unix-only variables in the event store (`unused_mut` and unused `path` parameters under `-D warnings`); these conditional-compilation issues are being corrected before the final check. This was missed by Linux-only compilation of the desktop crate, while prior Windows cross-checks covered only platform-rs.

## Claude change notice: frontend bundle fix COMPLETE (uncommitted, this worktree)

**Codex: FYI only. These two files are Claude's, finished and verified. Please leave them as they are and keep them out of your Rust commits.**

Changed (uncommitted on `main`, 57 insertions / 2 changed lines):

1. `apps/web/next.config.mjs`: the `katex` cacheGroup test is narrowed to `/[\\/]node_modules[\\/]katex[\\/].*\.m?js$/` (JS only), with an explanatory comment.
2. `apps/web/scripts/check-size-budgets.mjs`: new **per-screen JS budget**. It sums every `<script src>` each exported page loads, excluding `noModule` polyfills, against a per-route map (`/` 600, `/login/` 680, `/home/` 960, `/session/onboarding/` 770, `/results/` 640, `/session/contest/` 1900 KiB; others `AMS_BUDGET_ROUTE_JS_KB`, default 460). Existing checks are unchanged.

Verified by Claude in an isolated scratch build (no writes to this worktree's `.next/` or `out/`):

- KaTeX JS now appears only in `/session/contest/page` (app-build-manifest). Initial JS per screen: Welcome 780→522 KiB (−33%), Login 849→590 (−31%), Home 1095→837 (−24%), Onboarding 927→669 (−28%), Results 810→552 (−32%), Contest 1664→1663 (unchanged; it needs KaTeX).
- **Zero visual change:** all CSS files are byte-identical, all 62 media/font files are byte-identical, and every screen links the same stylesheets.
- The new check **passes** on the fixed build (exit 0) and **fails on 10 of 11 screens** on the pre-fix build (exit 1). The old largest-chunk check stayed green on both, which is the blind spot this closes.

Not done (left for the user's decision): lazy per-language CodeMirror grammars (low-to-medium risk, touches the exam editor). The largest chunk is still 0.47/0.49 MB because of it.

Suggested separate commit (explicit paths only):

```
git add apps/web/next.config.mjs apps/web/scripts/check-size-budgets.mjs
git commit -m "perf(web): keep KaTeX off every screen but the contest, and budget each screen's JS

The katex splitChunks test also matched katex.min.css, which the root layout
imports, so /layout depended on the whole 257 KiB library and Welcome, Login,
Home, Onboarding and Results all parsed it. Narrow the test to JS. Initial JS
drops 24-33% on those screens; CSS and fonts are byte-identical.

check-size-budgets only checked the largest chunk, which stayed green through
the leak. Add a per-screen budget (scripts each page loads, minus noModule
polyfills); it fails 10 of 11 screens on the pre-fix build.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### R1 final validation and commit scope

- **189 Rust workspace tests passed**: desktop 52, core 39, helper 40, platform 58. Strict workspace all-target Clippy, Rust formatting, shell syntax, and diff checks passed. **18 mocked uninstall scenarios passed**.
- Windows-only event-store declarations are fixed without lint suppression. The reviewer compiled the actual event-store source as an isolated temporary library with Windows MSVC all-target Clippy: passed. Windows platform all-target Clippy and macOS helper all-target Clippy also passed. Repository manifests/lockfiles were not altered by these checks.
- Both fresh reviewers completed independent cross-review. Full desktop native builds and actual OS restoration/power-loss behavior still require hosted CI/native machines; this review does not claim live native verification.
- Unexpected concurrent edits appeared in `apps/web/next.config.mjs` and `apps/web/scripts/check-size-budgets.mjs`. Neither reviewer nor root authored them; they are explicitly excluded from this backend-only commit and left intact for their owner.
- All confirmed R1 findings above are fixed. User-authorized backend source, regression tests, and this log are ready for commit/push to main. No cloud changes, API payload changes, release tag, or installer publication.

## Claude change notice: removing Java from the contest editor (in progress, user-requested)

**Codex: heads-up. The bundle fix above is done (thanks for leaving it alone). The user then asked Claude to remove Java as a language. Frontend-only; it doesn't touch your Rust files.**

- Files Claude is editing: `apps/web/src/app/session/contest/editor-pane.tsx`, `.../components/language.ts`, `.../components/TerminalPanel.tsx` (the `LANGUAGE_META` Java entry only), `.../client.tsx` (the mock `allowed_languages` list at the dev-mock path only), and `apps/web/package.json` + `pnpm-lock.yaml` (dropping `@codemirror/lang-java`).
- **Kept on purpose:** `compiler-diagnostics.ts` still parses `javac` locations (your F7 code; generic and tested).
- **Why it's safe:** the live contest path hardcodes `allowed_languages: ["C++23"]` (`client.tsx:1009`, "cxxprobe judges C++ only"), so no real contest offers Java. Java appears only in the dev mock list and dead tables.
- Builds run in Claude's scratch copy. A completion note with verification and a suggested commit follows.

## Claude change notice: Java removal COMPLETE (uncommitted, this worktree). Codex, this is done; nothing for you to do

**Codex: Claude has finished both user-requested frontend changes. Thanks for keeping them out of `a6d5861`/`9d6bc1c`.** The worktree's only uncommitted changes are Claude's (plus this log).

**Java removed** (scripted edits, no formatter reflow; 48 lines deleted, 2 changed):

- `editor-pane.tsx`: dropped the `@codemirror/lang-java` import and the `Java17` branch of `resolveLanguageBundle` (any language without its own branch already falls back to C++).
- `components/language.ts`: removed the Java entries from `LANGUAGE_ID_MAP`, `WORKER_SUPPORTED_LANGUAGES`, `normalizeLanguageLabel` and `LANGUAGE_EXTENSIONS`, and removed `defaultJavaStarter` and its uses plus the `Main.java` special case in `questionFileName`.
- `components/TerminalPanel.tsx`: removed the `java17` entry of `LANGUAGE_META` (display-only; unknown IDs fall back to the raw string).
- `client.tsx`: the dev-mock `allowed_languages` is now `["C++17", "Python3"]`. The live path stays `["C++23"]`.
- `apps/web/package.json` + `pnpm-lock.yaml`: `@codemirror/lang-java` removed. The lockfile diff is 20 deletions, 0 additions, and only the `@codemirror/lang-java@6.0.2` and `@lezer/java@1.1.3` entries (regenerated `--lockfile-only --offline`, so nothing was re-resolved).
- **Kept:** `compiler-diagnostics.ts` `javac` parsing (your F7, generic and tested).

**Verified:**

- `tsc --noEmit` clean, `pnpm test` **395/395**.
- Isolated `next build` passes. The largest chunk is **489,649 → 448,860 bytes** (96% → 88% of budget). Contest screen JS is about 1.62 → 1.58 MB.
- `@lezer/java` is in 0 chunk source maps, and there are 0 occurrences of `Java17`/`Java 17`/`Main.java` in built chunks.
- All 14 size-budget checks pass (including the new per-screen ones).

**Suggested commits (explicit paths, separate from yours):**

```
git add apps/web/next.config.mjs apps/web/scripts/check-size-budgets.mjs
git commit   # message from the bundle-fix notice above

git add apps/web/src/app/session/contest/editor-pane.tsx apps/web/src/app/session/contest/components/language.ts apps/web/src/app/session/contest/components/TerminalPanel.tsx apps/web/src/app/session/contest/client.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "refactor(contest): drop Java, which no contest offers

The live contest path is C++ only (cxxprobe), so Java existed solely in a dev
mock list and dead tables, yet its 40 KB grammar was parsed on every contest
load. Remove the editor grammar, starter, Main.java filename rule, language-map
entries and the @codemirror/lang-java dependency. javac parsing in compiler
diagnostics stays: it is generic and tested.

Largest chunk 489,649 -> 448,860 bytes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## R2 — Resolve the two read-only review findings (user requested)

Both findings were confirmed against `9d6bc1c`. The user requested considering 3–5 options and choosing a recommended implementation. This pass changes only the local platform code and tests; concurrent Claude frontend edits are preserved.

### Linux entry: four options considered

| Option                                                                    | Decision                                                                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove the desktop-wide failure guard                                     | Rejected: would hide required recovery snapshot and native setup failures.                                                                            |
| Suppress every Linux setup error                                          | Rejected: would also waive mandatory keyboard/journal failures.                                                                                       |
| Probe for installed executables first                                     | Rejected as the complete fix: adds a check/use race and still mishandles unavailable services or optional command failures.                           |
| Scope error isolation to the existing best-effort KDE/X11 touchpad branch | **Selected:** preserves required setup checks and existing deadlines while preventing optional fallback failures from contaminating entry or restore. |

The existing `process_runner::optional` helper now encloses only the runtime KDE/X11 touchpad operations. Journaled GNOME preferences and required keyboard operations remain outside it. A small injected command executor makes this branch testable without native mutations. Regressions cover one available KDE tool with missing alternatives on entry/restore, preservation of required failures before/after optional work, and the actual requested xinput enable/disable arguments.

### Windows cleanup: four options considered

| Option                                                                 | Decision                                                                                                                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Tighten token/regex boundaries                                         | Rejected: still confuses text fragments and full names.                                                                                        |
| Parse localized netsh headers and values                               | Rejected: locale-sensitive, and descriptions can contain the same text.                                                                        |
| Enumerate firewall COM objects directly inside the app                 | Not selected: adds native bindings/threading handling and cannot use the subprocess hard deadline.                                             |
| Read structured COM rule names in an existing bounded PowerShell child | **Selected:** exact full-name comparisons, independent of display labels, no new Rust dependencies, with the same command/aggregate deadlines. |

The query reads `INetFwRule.Name` through `HNetCfg.FwPolicy2`, compares whole names case-insensitively, and serializes only matching names to JSON. Parsing requires a complete string array; malformed/truncated/failed queries remain errors. Both existing scoped deletion attempts still run. Similar names such as `AMS_PROCTOR_ALLOW (backup)` and descriptions no longer block recovery. Windows-only tests execute the production script with a fake COM data source for zero/one/multiple names, similarly named rules, descriptions, and query failure; they never inspect or mutate the machine's firewall.

Implementation references: [Microsoft firewall object enumeration](https://devblogs.microsoft.com/scripting/hey-scripting-guy-weekend-scripter-how-to-retrieve-enabled-windows-firewall-rules/), [INetFwRule properties](https://learn.microsoft.com/en-us/windows/win32/api/netfw/nn-netfw-inetfwrule), and [PowerShell 5.1 ConvertTo-Json](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/convertto-json?view=powershell-5.1). `-InputObject` is used to retain array shape instead of pipeline scalar unwrapping.

### R2 validation and scope

- **193 Rust workspace tests passed** (desktop 52, core 39, helper 40, platform 62). Strict workspace all-target Clippy, formatting, and diff checks passed.
- Windows MSVC all-target cross-Clippy passed, including compilation of the two new Windows-only PowerShell integration tests. Those tests cannot execute on this Linux host and await native CI; live desktop/firewall behavior is not claimed as tested.
- Final source review confirms the required entry guard remains present, optional isolation is limited to the runtime KDE/X11 touchpad branch, actual Windows owned names still cause an error, and uncertain inventories cannot become successful cleanup.
- Commit scope is the three platform source files plus this log. Claude's separate frontend/bundle/Java-removal changes remain untouched and unstaged. No API/cloud/dependency changes or native protection mutations were made by this pass.

## R3 — User-supplied performance review (2026-10-02, local only)

User requested all 16 attached findings be checked and fixed with subagents, followed by independent subagent review. **No commits or pushes are authorized for this pass.** Existing Claude changes (KaTeX chunk isolation, page budgets, Java grammar removal, associated package/lockfile changes) were present at the start and are preserved.

### Completed implementation — Home/request lifecycle (findings 1, 3, 4, parts of 12–13)

- Resume polling now depends on session/request identity and status, keeps the existing 3-second interval, skips overlapping requests, and invalidates outstanding responses on disposal. Identical server decisions preserve the session object and skip local-storage writes. Updated request metadata still reaches the UI.
- Readiness scans carry a generation number; only the current scan publishes its report. Closing/changing preflight or leaving Home invalidates older work. Overlapping baseline/preflight media probes share the in-flight camera/microphone checks, release successful streams immediately, and do not cache completed hardware results.
- Override and Help requests abort after 10 seconds, including response-body reads. Override failures still fall back to the unchanged base policy. Help does not mistake an aborted response body for an empty successful response.
- Only native process-constant `get_platform` and `plugin:app|version` calls are cached; concurrent readers share a promise and failures remain retryable. Live telemetry/enforcement is never cached. Login prefetches Home once after the candidate starts entering their handle.
- Home callbacks/card colors are stable; contest list/calendar are memoized. The calendar explicitly updates its “next contest” boundary so memoization cannot leave that label stale. Existing contest/proctoring refresh cadence is retained. Date formatters use a bounded cache. Settings mic visualization updates at most every 125 ms. Media permission rejection no longer creates an unhandled side promise, and late streams are stopped.
- Validation so far: 14 new focused regressions pass (cadence, non-overlap/disposal, identity preservation, media denial/late streams/shared probes, formatter reuse/bounds, native cache retry/isolation, stalled headers/body, base-policy filtering). Integrated web typecheck passes. Independent review pending below.

### Completed implementation — contest rendering (findings 5–9, submission portion of 12)

Implemented by `review_events_again`: stable focus-trap/mark/copy/question/expiry callbacks; memoized ProblemPane and QuestionRail; cached compiler parsing and statement/KaTeX rendering; bounded CodeMirror theme/preferences style modules; reuse of the editor's already-produced document string; geometry observation reconciles actual elements and unobserves replaced editors instead of forcing layout on text mutations. Submission rows reuse case results already returned by the list and update them when judging finishes. The three Run-only submission refreshes were confirmed redundant because runs are polled separately and excluded from submission lists, and were removed.

Per-keystroke crash-recovery writes, judging/proctoring cadence, backend payloads, and visual layout are unchanged. Subagent verification: 24 focused tests passed, including style identity, pending→terminal result merging, repeated text mutations without measurement, and replaced-editor release; typecheck passed. Independent cross-review is in progress; native implementation remains in progress.

### Completed implementation — native recorder and long-session overhead (findings 2, 10–11, 14–16)

Implemented by `review_native_again`, cross-reviewed by `review_events_again`:

- One bounded FIFO recorder thread handles event persistence and session-configuration barriers. Windows/native callbacks only attempt queue admission; their existing panic guards and rate limits remain. Frontend logging awaits queue capacity and then actual persistence, so a resolved promise still means the write completed. Queue rejection/pending counters and a bounded orderly-exit drain make failures visible.
- Close-app, helper-check, and helper-install commands run in background workers. Privileged installation has one independent slot that remains held even if the caller is cancelled; it does not occupy readiness's reserved worker.
- Upload batches are serialized once on the blocking reader and sent verbatim; append byte counts are reused for bounded recent-event accounting. Failed disk writes retain in-memory diagnostics while rejecting persistence acknowledgements.
- The append publication cache keeps only one Unix file/directory identity. Appends still reopen and inspect the actual file tail and perform data synchronization for every event. New/replaced/reopened files still synchronize their directory. Recovery, binding, quarantine, TLS/auth, and upload contracts remain unchanged.
- X11 watchdogs batch their existing read-only queries, reducing approximately 12 processes/second to 6 at the same 250/500 ms polling intervals. `/proc` scans avoid redundant strings/path copies. macOS releases the tap lock before reporting events.
- Native callback admission is deliberately asynchronous: an accepted native event may still be pending on the recorder if the process crashes immediately. It is not claimed durable at admission; frontend acknowledgements remain durable, pending/rejected counters expose queue state, and orderly shutdown attempts a 5-second drain. This is the explicit tradeoff required to remove disk waits from the low-level hook.
- Validation: 205 Rust workspace tests passed (desktop 62, core 39, helper 40, platform 64); strict all-target workspace Clippy and formatting passed. Windows platform all-target cross-Clippy passed. macOS cross-Clippy was attempted but this Linux environment lacks an Apple C toolchain/SDK (bundled SQLite compilation rejects `-arch`/`-mmacosx-version-min`); macOS execution/compilation is not claimed verified. No live firewall, desktop lockdown, privileged installation, or cloud upload was exercised. Real X11/Windows/macOS runtime validation remains a platform-CI/manual check.

### Independent review findings and corrections

1. **Saturated recorder admission:** an early implementation used nonblocking admission for configuration too, so a full queue could leave the old session binding. Changed async IPC/configuration to await FIFO capacity; hooks retain nonblocking admission. Added saturation/order/durability regressions.
2. **Disk-failure diagnostics:** preserving acknowledgement errors initially lost the previous bounded memory diagnostic. Restored that diagnostic without reporting the disk write successful; regression added.
3. **Closing preflight:** cancelling a strict scan without replacing it could leave Home stuck on checking. The shared scan effect now starts a fresh baseline on close; two tests execute the actual scan/effect with deferred, out-of-order responses and include a stale manual rescan during contest change.
4. **Stalled resume response body:** the existing shared API transport cleared its timeout after headers. With serialized polling, an endless body would hold the poll forever. Moved body consumption under the existing timeout/catch; added a body-timeout→later-poll-retry test and checked HTTP error semantics remain intact.
5. **Local timezone changes:** caching formatters could retain the old device zone. Cache invalidation now observes offset changes cheaply and refreshes timezone/locale on focus, visible-page re-entry, and language changes. Tests include different and equal-offset zones.

All corrections were independently re-reviewed; reviewers reported no remaining blocking findings in their scopes. Existing Claude frontend/bundle edits remain preserved.

### Browser verification

Disposable Chrome against this worktree on port 3010, with external requests blocked, passed five checks: fixed Home polling cadence/no repeated session-storage writes; per-keystroke recovery writes; stable editor style size over repeated question switches (20,626 bytes before and after); retained media-dialog action focus across background updates; no horizontal viewport overflow at 1280×800. Captured 1440×1000 and 1280×800 states, with no runtime exceptions.

An initial focus assertion encountered the existing critical camera-denied overlay, which correctly took priority. The ordinary-dialog check was isolated with a pending browser permission fixture; app proctoring policy was not altered. This is fixture validation, not a claim that native camera/proctoring passed.

Reproducible runner: `scripts/performance-review-capture.mjs` (pass this worktree's local dev-server URL). Current evidence: `/tmp/ams-r3-browser-evidence/2026-10-01T23-03-33-511Z/manifest.json`. The temporary port-3010 server was stopped for the production build; the pre-existing port-3000 app in the other worktree was left running.

### Final validation and handoff

- **412 web tests + 28 API-client tests + 205 Rust tests passed (645 total).**
- Production static build and all 14 size budgets passed; web build type validation and API-client typecheck passed. Strict Rust workspace Clippy, Windows platform cross-Clippy, Rust formatting, browser-runner syntax, and `git diff --check` passed.
- Independent subagents reviewed both implementation areas, and re-reviewed the corrections above. No remaining blocking source findings were reported. Native platform runtime/Apple-toolchain limits are explicitly recorded above.
- All 16 attached review items are addressed. Per-keystroke crash recovery remains intact. No backend server/cloud/API contract or visual-design changes were made.
- Changes are in `/home/user/AccessSoftware/ams-access-main`, **unstaged and uncommitted**. HEAD remains `2f49cf3`; **nothing was pushed**. Claude's pre-existing local code is retained in the working tree. Ready for Claude's next review here.

## R4 — Follow-up integration fixes (2026-10-02, local only)

The user authorized fixes for the two confirmed review findings, with subagent implementation followed by independent review. This pass remains uncommitted and unpushed; earlier local changes are preserved.

### Decisions and scope

- **Busy helper checks:** distinguish a successful `false` (installation is needed) from busy, failed, or unknown checks. Use bounded retries for the specific busy outcome and preserve warning/error outcomes otherwise. Increasing pool capacity or adding a dedicated worker would not correct the caller's error-to-missing conversion; indefinite retries could strand onboarding.
- **Unix signal shutdown:** move work out of the raw signal handler into normal execution context, share shutdown coordination with ordinary app exit, and drain accepted recorder work with a deadline. Directly draining inside a signal handler risks deadlock; synchronous native logging would restore the original performance problem; periodic flushing would still leave a termination gap.
- Implementation ownership: `fix_helper_busy` handles onboarding and tests; `fix_signal_drain` handles native shutdown and recorder tests. `review_events_again` independently reviews onboarding, with native cross-review to follow. No cloud, deployment, or privileged device changes are exercised by tests.

Implementation and validation results will be recorded below as each task completes. This section is not a claim that the fixes have passed review yet.

### Completed implementation — helper-status caller

`fix_helper_busy` extracted the actual onboarding helper workflow into `network-helper.ts`. It uses the strict bridge, permits installation only after an explicit boolean `false`, retries the known worker-busy error at most three checks (250/500 ms delays), and reports unknown/malformed/failed checks as warnings without installation. The post-install check follows the same bounded policy. Leaving the stage aborts retry delays and prevents later probes, installation attempts, progress updates, and stage advancement; an installer already launched natively cannot be cancelled by this frontend cleanup.

Parent review caught an older-WebKit compatibility issue in the initial cancellation guard. The final guard reads `signal.aborted` instead of requiring `AbortSignal.throwIfAborted`; the minimum supported macOS version remains unchanged. A regression exercises a signal without that method. Reference: [WebKit implementation history](https://bugs.webkit.org/show_bug.cgi?id=234127).

Agent validation: 52 related onboarding tests and web typecheck passed; the subsequent compatibility regression brings helper-only coverage to 19 passing tests. Independent reviewer `review_events_again` has the handoff; final integrated counts and review outcome follow below.

Independent helper review completed: `review_events_again` reported **no findings** after checking strict bridge wiring, actual native busy text, bounded retries, unknown responses, cancellation, old-WebKit compatibility, and the unchanged final entry gate. The reviewer independently reran all 19 helper regressions successfully. Parent validation also passed the complete **431-test web suite** and web typecheck. Real administrator dialogs were not exercised.

### Completed implementation — signal shutdown and terminal recorder drain

`fix_signal_drain` added `shutdown.rs`. The raw Unix handler only stores an atomic notification; a named thread performs ordinary-context cleanup. Signal exit and Tauri exit share a completion coordinator, so a competing exit waits for cleanup to finish rather than skipping an in-progress drain. Startup recorder initialization is serialized with shutdown to prevent creating a recorder after shutdown observed none.

Native input recovery runs before the five-second recorder drain; network recovery still runs if the drain times out. The terminal recorder marker closes receiver admission and consumes all accepted jobs, including jobs queued behind the marker, before acknowledging completion. Late native/IPC submissions are rejected. Existing window-destruction recovery remains an independent safety net and uses the same lifecycle mutex to prevent concurrent recovery with signal cleanup.

Automatic review rejected the initial combined rewrite and later removal of destruction-time recovery. The final scoped implementation makes the atomic-only handler boundary explicit and retains destruction recovery; both concerns were resolved without bypassing review. No action remains blocked.

Regression coverage includes a dedicated subprocess receiving actual SIGTERM, four queued records written and synced before exit, a handshake ensuring another SIGTERM arrives during cleanup with recorder work still blocked, concurrent-exit waiting, jobs accepted behind the shutdown marker, late admission rejection, and a stalled worker's bounded timeout. Tests use temporary files and fake platform recovery; no native keyboard/firewall APIs or administrator installation were exercised.

Independent native cross-review by `fix_helper_busy` reported **no findings**. Parent also reviewed shutdown ordering, startup/exit synchronization, recorder semantics, and the strengthened signal handshake. Targeted recorder/shutdown tests passed. Full workspace validation passed **209 Rust tests** (desktop 66, core 39, helper 40, platform 64); formatting passed. Strict Clippy and final source/status checks are pending below.

### R4 final validation and handoff

- **431 web tests and 209 Rust tests passed (640 total in this pass).** Includes 19 new helper regressions and four new native shutdown/recorder regressions.
- Web typecheck, strict Rust workspace/all-target Clippy (`--locked --offline -- -D warnings`), Rust formatting, and `git diff --check` passed.
- Independent frontend and native reviewers reported no remaining findings; the parent reviewed both integrations and the final tests. Compatibility and signal-test handshake corrections were included before final validation.
- Actual SIGTERM delivery and temporary-file persistence were tested on Linux. Real desktop/input/firewall recovery, administrator prompts, and native Windows/macOS execution were not exercised. A hung recorder still has the deliberate five-second drain limit; forced termination/power loss cannot guarantee persistence of queued native events.
- No new dependencies, cloud changes, deployment, commits, staging, or pushes. Earlier local work remains preserved; HEAD is still `2f49cf3`. Fixes and review evidence are ready for Claude's next review in this file.

### Publication authorization (2026-10-02)

The user now authorized committing and pushing this reviewed local batch to `main`, including the preserved Claude changes described in R3. A fresh `git fetch origin` confirmed local HEAD and `origin/main` both at `2f49cf3` (zero commits ahead/behind); no intervening remote-main commits were present. Publication will use a normal fast-forward push, preserving remote history.

## R5 — Worktree reconciliation and demo build (2026-10-02, local candidate)

User requested a careful branch/worktree review, subagent review, corrections, clean local commits, and a report of what is ready to push. The current source audit disproved the stale assumption that the UI remained absent from main: all old frontend differences match ancestor `a20c3fc`; native/API branch changes and the third Claude worktree patch are already present and improved on main. Details, preserved-backup references, and evidence are in [reconciliation-review.md](reconciliation-review.md).

- Created `reconcile/demo-ready-20261002` from published `b6d360b`; reconciled `c4c67ac` history using an audited `ours` merge to preserve newer implementations.
- Saved the old dirty checkout and its untracked evidence in stash snapshot `c344755f`, protected by `backup/pre-reconcile-ui-20261002`. The old checkout is detached and clean; ignored local configuration/scratch assets are preserved. No backup/captures are being published.
- Fixed configured Cargo output-directory handling in native helper staging and added five tests plus a desktop test command. Corrected the inaccurate advisory-network-policy comment. Added root README and a reproducible demo runbook.
- Replaced canonical checkout dependency symlinks with an independent frozen-lockfile install. Existing development API configuration was preserved as an ignored file, with no secret values logged or staged.
- Independent audits and final review reported no remaining findings. **673 tests passed**, along with type validation, strict Rust Clippy, formatting, production frontend export and all size budgets. Production browser performance checks passed 5/5; current Welcome verification passed 143 checks across 14 captures. The older P0 runner's obsolete welcome selector is documented as historical rather than used as a current regression gate.
- A Linux release `.deb` was built and inspected, with artifact and SHA-256 recorded in the reconciliation report. No installer or native desktop protection test was run. API hostname resolution timed out, so live sign-in/contest execution remains externally unverified; no cloud changes were attempted.
- Ready for local commit and user review before pushing. Earlier R3/R4 no-push statuses and publication authorization describe their own historical passes, not this candidate's current publication status.

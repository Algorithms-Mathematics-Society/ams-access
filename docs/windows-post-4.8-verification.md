# Windows follow-up after 4.8.0

The historical evidence below predates the combined follow-up commit. See
[combined verification](post-4.8-combined-verification.md) for the final Wi-Fi removal,
Mac fixes and current validation. Historical commit IDs below were squashed into
one commit for one main-branch CI run; Wi-Fi controls are now removed.

Reviewed 28 October 2026 against main `5286a4f4721849ff098681931f3717f7ba7640e1`. Do not move the 4.8.0 tag or bump the version during this work. No issue is automatically closed.

## Changes and automated evidence

- `978d31a`: retain server retry guidance alongside request IDs; invalid body waits no longer erase valid header guidance.
- `eabb615`: healthy approval polls wait 3–4 seconds after each response, spreading subsequent reads while keeping the immediate first read and existing failure backoff.
- `f2f8707`: repeated manual heartbeat retries share one pending request; a closed room ignores late results. Periodic heartbeats and authentication rechecks remain independent.

Full frontend suite: **1,192 tests passed, zero skips, across 134 files**. `pnpm --filter @ams/web typecheck` and `node scripts/check-versions.mjs` passed. This host has not performed native Windows acceptance or a real-session load rehearsal.

At 3,000 simultaneous approval waiters, the healthy polling floor allows at most 1,000 reads/second in steady state, before request time, with an expected rate around 857/second from the 3.5-second mean. The first read remains immediate. The synthetic test verifies dispersion, no overlap and teardown, not backend capacity. The manual-retry guard bounds repeated pending clicks, not arbitrary sequential clicks or independent periodic/auth recovery calls. Staging must verify the total load, mutations, database cost and judge queue against agreed budgets.

## Manual checks

Use the source commit, not the unchanged manifest version alone, to identify these unreleased fixes. Record artifact hash, Windows build/architecture, scaling, WebView2 version, API/portal revisions, network, tester and reviewer. Use disposable staging identities for fault injection. Never use production for an unapproved load run.

### #173: Installer and version

Reviewed existing official-download/checksum guidance, installer route and Settings version display. No new installer change was justified by this review.

- [ ] Download the organizer-approved Windows installer and checksum file from official Releases; compare Get-FileHash on campus Wi-Fi and hotspot copies.
- [ ] Clean-install, then upgrade from the last distributed build. Open Settings and record the version; launch each shortcut and confirm the same build.
- [ ] In a disposable profile, uninstall/reinstall and check for duplicate launch paths or stale helpers. Record Windows build, scaling, install route and artifact hash.

### #175: Exit, input and reconnect

Existing native restoration and Wi-Fi layout fixes are retained. f2f8707 additionally coalesces repeated contest Retry now requests and prevents late responses updating a closed room.

- [ ] Use visible Exit/Back and documented shortcuts from login, home, setup, failed entry, approval waiting, reconnect and contest, with the API reachable and blocked.
- [ ] At 150%/200% scaling, use only Tab/Shift+Tab/Enter/Escape to select a long Wi-Fi name, enter its password, Join and Retry.
- [ ] After exit, type in Notepad and check pointer, Windows shortcuts and networking. Reopen and confirm the saved draft remains.

### #178: Concurrent entry

eabb615 spreads healthy approval polls over 3–4 seconds instead of keeping every waiter synchronized at 3 seconds. The first check stays immediate. The 3,000-waiter test proves client scheduling bounds, not API capacity.

- [ ] Run login → setup → enter → edit/run for a baseline candidate, then repeat through a controlled slow-response period; recovery must retain the session.
- [ ] In approved staging, run at least 3,000 representative clients plus organizer reads and judging traffic; set latency/error budgets before starting.
- [ ] Reconcile attempted entrants against actual sessions and capture p50/p95/p99, timeouts, requests per candidate and judge queue depth. GUI success alone does not pass this issue.

### #179: Retry and rate limits

978d31a preserves Retry-After on diagnostic server errors and ignores invalid body waits. eabb615 staggers healthy approval polling. f2f8707 shares one pending manual heartbeat across repeated Retry now clicks. Regression tests include 3,000 waiters and 3,000 repeated clicks.

- [ ] With a delayed heartbeat, repeatedly click/keyboard-activate Retry now: only one manual request should remain pending; after it fails, another explicit Retry must work.
- [ ] On staging, return 503 with Retry-After: 20 plus a request_id for login/approval; verify the wait is respected and the diagnostic reference remains visible where shown.
- [ ] Leave approval pending, restore service, then exit/navigate away. Record request rate, CPU and memory; no catch-up burst or continuing polling after teardown.

### #187: Support and announcements

Reviewed the merged signed-out report flow, authenticated chat, public ServiceStatus surfaces and contest announcements. Existing component/status/announcement tests passed; no new messaging feature was added. Public service incidents and contest announcements are separate delivery paths.

- [ ] Stay signed out, fail a login, then Get help: send contact details and a problem, see Request sent, and verify the report in the organizer portal. Do not enter a password in the report.
- [ ] Publish a public service incident with next-update time/contact route; verify login, home, setup and contest. Separately publish a contest announcement and verify its in-contest acknowledgement on the organizer side.
- [ ] Disconnect/reconnect a candidate after updating the notice. Confirm the current stop/continue/postpone instruction, draft preservation and clear stale/offline status. Verify staff replies reach authenticated chat.

### #188: Content, Reference and practice

Reviewed the existing published-only Reference contract, revision refresh, offline retention and practice entry. Reference, heartbeat and content regressions passed. No new content/toolchain change was warranted; actual contest fixtures still need organizer verification.

- [ ] Edit an organizer Reference draft: two candidate accounts must still see only the published revision. Publish in an allowed window and compare both clients.
- [ ] While editing code, repeatedly open/close Reference with mouse and keyboard; check draft, cursor, scroll and timer. Disconnect, read the loaded copy, reconnect and verify the current published revision.
- [ ] Run official examples under each problem's configured judge toolchain and compare the statement/output. A late registrant must find and enter the approved practice contest.

### #189: Final rehearsal

This is an operational acceptance gate, not a standalone code defect. Retry/recovery fixes are recorded above; no rehearsal or fairness sign-off is claimed.

- [ ] Use the exact candidate build/API/portal combination for install → login → entry → run → disconnect → approval/resume → submit → Finish → exit.
- [ ] During representative load, practise the incident owner's decision and broadcast; verify the candidate instruction and organizer acknowledgement records.
- [ ] Review question exposure and replacement/reschedule policy, reconcile credentials/downloads, and record reviewer GO/NO-GO with every unresolved P0.

### #190: Windows audit tracker

Reviewed all eight remaining Windows issues against main 5286a4f and committed three bounded retry/recovery fixes. All 1,192 frontend tests passed without skips; TypeScript and manifest-version checks passed. Version remains 4.8.0; these commits are intended for the later 4.9.0 release.

- [ ] Record tested commit, Windows build/architecture, scaling, WebView2 version, installer/hash and tester/reviewer.
- [ ] Execute the short checklists on #173, #175, #178, #179, #187, #188 and #189; attach failures and retest evidence.
- [ ] Keep these issues open until your manual sign-off. Unit/simulation evidence does not certify native GUI behavior or production capacity.



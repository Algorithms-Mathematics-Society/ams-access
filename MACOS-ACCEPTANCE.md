# MAC-01–MAC-15 acceptance handoff

Owner for native verification: @Rasesh2005. These issues stay open until the
required GUI evidence is recorded. Linux unit tests and browser fixtures do not
establish macOS installation, permission, kiosk or hardware behavior. Record the
commit, app version, macOS version, architecture and installation route for each run.
Use synthetic contest accounts. Never include passwords or support capabilities.

## MAC-01 / #196: installation and identity

The release workflow now verifies the final Mac bundle before collecting it for
publication: expected version, bundle ID, CPU slice, Developer ID signing team,
strict signature verification and Gatekeeper assessment. A rejected check stops
publication. The four portable regression cases exercise rejection paths; actual
Apple signing/assessment still requires the macOS release runner.

GUI checklist:
- [ ] Download the intended release normally, keep Gatekeeper/quarantine intact,
      install into Applications and launch as a standard user.
- [ ] Repeat clean installation and upgrade on every advertised architecture.
- [ ] Open via Applications, Spotlight and an existing Dock shortcut; Settings
      must show the expected version and the same installed app must open.
- [ ] Opening directly from the DMG should give the existing move-to-Applications
      guidance. Do not use quarantine removal or ad-hoc signing to pass this test.
- [ ] Interrupt a download, retry through the official route and verify a usable
      final installer. Record any prompt or launch failure exactly.

Technical evidence, if needed: run `python3 scripts/verify-macos-release.py`
with `--app`, `--version`, `--arch` (`arm64` or `x86_64`) and `--team` matching the
release. It only inspects the bundle; it does not alter security settings.
Apple's verification guidance: https://developer.apple.com/library/archive/technotes/tn2206/

Scale: build-time validation adds no candidate requests or runtime polling.

## MAC-02 / #197: signed-out exit

Welcome and Login now show a Mac-only Quit button. It calls local native shutdown,
which retains the existing restoration path; no login or API request is needed.
Concurrent clicks are coalesced. Native refuses the idle action during an active
exam or an in-progress lifecycle transition. Windows/Linux/browser controls are
unchanged. Component regressions cover platform gating, duplicate clicks and
readable refusal. Native Cmd+Q/menu/window-close acceptance remains required.

GUI checklist:
- [ ] On Welcome and Login, turn connectivity off and click Quit; the app exits,
      Dock/menu bar/input work, and reopening is usable without signing in.
- [ ] Repeat with Cmd+Q, application-menu Quit and the window close control.
- [ ] From Home, setup failure, approval wait, active contest, reconnect and Finish,
      exercise each existing exit control; the correct confirmation is retained.
- [ ] Close a Reference/help modal and then exit; repeat three enter/exit cycles.
- [ ] Verify no duplicate finish submission, stranded fullscreen or required login
      after an offline/failed cleanup. Capture any restore guidance.

Scale: one cached platform lookup and one local IPC per click; no backend traffic.

## MAC-03 / #198: fullscreen and focus recovery

Timed-out AppKit dispatch now cancels work that has not begun. Previously a
queued operation could run after its caller timed out and started recovery.
Already-running native calls cannot be interrupted; a timeout still means
unverified, never successful. Three portable tests cover cancellation, single
execution and start/cancel races. Actual window transitions need a Mac.

GUI checklist:
- [ ] Enter from a normal window and a macOS fullscreen Space; verify one visible,
      usable contest window, with editor and dialogs above the correct surface.
- [ ] Trigger failed setup/entry, then Back to contests; Dock, menu bar, switching,
      window movement and fullscreen controls work again.
- [ ] Repeat rapid entry/cancel/exit three times; no late refocus or return to kiosk.
- [ ] Request a missing permission; its prompt or recovery guidance stays reachable.
- [ ] Connect an unsupported extra display; read the guidance, correct it, retry,
      and exit without a stranded black/off-screen window.

Scale: local atomic state per dispatched job; no backend requests or new polling.

## MAC-04 / #199: retired network-lockdown check and legacy cleanup

This issue was already closed for feature removal. It is not reopened here.
The fetched main still contains the old enforcement path; full removal is separate
work and must not be claimed shipped from this branch. This change only makes Mac
helper uninstall clear its existing scoped rules before stopping/deleting the
service. Failed cleanup retains the helper for recovery and reports the error.
It does not disable PF globally, flush other anchors or reintroduce enforcement.

GUI checklist (use a disposable Mac profile/device for legacy-helper cases):
- [ ] Upgrade from a build with the helper installed. Restore settings, uninstall
      the helper, then verify ordinary internet access and a clean app restart.
- [ ] Cancel the administrator prompt; the app stays usable and reports failure.
- [ ] With a recorded lockdown but unavailable helper, uninstall must fail visibly,
      not claim successful restoration. Restore the helper before retrying.
- [ ] On the eventual removal build, setup must not block on Network Lockdown or
      ask to install a network helper. Verify other firewall rules remain intact.

Validation: inspected the helper disable/marker lifecycle and native Rust formatting.
Native administrator/PF behavior requires Mac acceptance. No new polling or API load.

## MAC-05 / #200: contextual optional microphone permission

Mac startup now requests camera only. The optional microphone check asks native
TCC for audio permission when reached, waits for its result before opening audio,
and retains the existing continue-with-warning path on denial/timeout. Leaving
the stage before the response prevents late stream acquisition. Native waiting
runs off the main thread with a 60-second bound. Other OS permission paths retain
their existing behavior. Native TCC requires Mac CI and device verification.

GUI checklist:
- [ ] In a clean standard-user profile, launch: no unsolicited microphone prompt
      on Welcome/Login; camera permission remains available.
- [ ] Reach Microphone check, allow the prompt, and see audio activity. Deny in a
      separate clean profile: Continue without microphone remains available.
- [ ] Leave the stage while its prompt is open; answering later must not reopen
      audio, advance another page or leave a recording indicator on.
- [ ] Revoke camera/Accessibility permissions in System Settings, retry, then
      grant and reopen when prompted; recovery must be actionable, not a loop.
- [ ] Upgrade the official app in place and verify granted permissions, Settings
      links and optional-mic behavior. Do not reset TCC to manufacture success.

Scale: one local bounded native request per microphone-check attempt, no API traffic.

## MAC-06 / #201: input regression coverage

The existing Mac shortcut table is now exercised directly by portable tests,
without changing its decisions. Coverage protects typing, undo/redo, selection,
word navigation, editor Escape and the contest clipboard policy, while preserving
blocked system shortcuts. This is regression coverage, not evidence that native
trackpad/IME/modal behavior has passed. No new runtime polling or requests.

GUI checklist:
- [ ] Type, select, undo/redo, indent and navigate code with the built-in keyboard
      and an external one; verify the caret stays visible during scrolling.
- [ ] Test permitted copy/paste and denied external paste separately. No draft
      disappears when switching questions or returning from a modal.
- [ ] Use autocomplete/search Escape, then help/Reference/finish modal controls;
      keyboard focus returns to the expected control/editor. Record modal Escape
      behavior explicitly, including whether native restrictions intercept it.
- [ ] Scroll statement/editor/results with the trackpad, select text, and test
      an IME/input source required by participants on actual hardware.
- [ ] After exit, system shortcuts and normal trackpad gestures are restored.

## MAC-07 / #202: delayed work cannot own the next session

Mac desktop entry and exit now advance a generation. The delayed kiosk reapply
belongs to the generation that scheduled it, so exit/re-entry on the same window
cannot make old work valid again. This addresses a concrete lifecycle race; the
reported blackout's cause is still unconfirmed. Existing recovery journals and
single-instance ownership remain intact. No backend changes or additional timers.

GUI checklist:
- [ ] Enter, exit immediately, and re-enter repeatedly; no delayed focus jump,
      off-screen window or fullscreen change belongs to the previous session.
- [ ] Sleep/wake during a synthetic contest: the window is usable, server time
      remains authoritative, drafts survive and reconnect does not duplicate work.
- [ ] After ordinary exit, sleep/wake again; AMS must not seize desktop focus.
- [ ] On a disposable test device, terminate the process during a synthetic
      contest, relaunch and inspect restoration. Record exact reproduction steps,
      native logs and the screen state for any blackout; do not call it resolved
      merely because reopening works.
- [ ] Launch a second installed copy during the first session; it must not alter
      the first session's controls or restoration ownership.

Validation: source-level lifecycle review and Rust formatting. AppKit/sleep/crash
acceptance still requires native CI and hardware; no claim of blackout reproduction.

## MAC-08 / #203: nearby Wi-Fi discovery

Mac Wi-Fi previously listed saved networks only and ignored explicit Rescan.
It now reads CoreWLAN's nearby cache for status and performs a broadcast scan
only on Rescan, merging nearby and saved networks. Missing/redacted names produce
actionable guidance on an explicit scan. Names keep their whitespace. At most
256 scanned entries are read and native radio scans/password joins are serialized
with a non-blocking gate. Windows' recent association/retry UI is preserved.

GUI checklist:
- [ ] Disconnect in a synthetic contest; open Wi-Fi and Rescan. A nearby hotspot
      never saved on this Mac should appear, with its real security state.
- [ ] Enter a wrong password, then the right one; feedback remains visible and
      only verified status says Connected. Confirm API reconnect separately.
- [ ] Test long/Unicode/space-containing SSIDs and a saved network; no truncation
      or trimmed name is sent to the OS, and passwords do not appear in logs.
- [ ] Deny Location access or turn Wi-Fi off; read recovery guidance and retry.
      The app must remain exitable without claiming submissions were delivered.
- [ ] Repeated Rescan clicks and opening both offline/toolbar controls must not
      create simultaneous radio scans. Verify drafts and server receipt after recovery.

Validation: native source review plus existing Wi-Fi UI and parsing regressions.
CoreWLAN/Location/association require Mac CI and hardware. OS scan duration is not
cancellable; the gate prevents accumulating scans. No backend traffic is added.
Apple API: https://developer.apple.com/documentation/corewlan/cwinterface/scanfornetworks(withname:)

## MAC-09 / #204: bounded session watchdog lifetime

The Mac fallback focus watchdog now belongs to one desktop generation. Previously
rapid exit/re-entry inside its two-second sleep could keep old pollers alive,
adding process scans and main-thread dispatches each cycle. Stale generations
now stop at the next tick; queued refocus also checks ownership when executed.
The existing event-driven observers and two-second fallback frequency remain.
No server requests, higher polling rate or global animation changes are added.

GUI/performance checklist:
- [ ] Compare the previous release and this build on the same Mac, power mode,
      contest and data; record build/OS/architecture and Activity Monitor values.
- [ ] Repeat entry/exit ten times, including quick cycles; idle CPU/thread count
      should settle rather than gain another permanent watchdog each time.
- [ ] Run a 30-minute synthetic contest with typing, scrolling, modals and question
      changes. Record memory/CPU at start, 10, 20 and 30 minutes and after exit.
- [ ] Include a long statement, large draft, Reference content and reconnect;
      record stalls with their trigger and duration, not just “feels smoother”.
- [ ] Repeat with Reduce Motion enabled; ensure focus, buttons and readable
      loading/error states remain usable. No perpetual activity after exit.

Validation: lifecycle review and portable regression suite. No native performance
measurements or 3,000-participant production load qualification are claimed here.
This change reduces per-device stale work and adds no backend load.

## MAC-10 / #205: issued credentials and Mac paste verification

The current full-handle normalization and shared-device identity fixes are already
present. No authentication/backend behavior is changed here. A regression adds
Mail/Pages-style surrounding Unicode whitespace and full-length suffixed IDs,
while ensuring invisible interior characters and lookalike punctuation are not
silently converted into someone else's identity. Delivery/reissue/revocation
must be checked with organizer-owned synthetic accounts, not real credentials.

GUI checklist:
- [ ] Paste a full issued ID from Mail, including its suffix and surrounding
      spaces; verify the complete ID survives and signs into the intended account.
- [ ] Type the ID manually, edit in the middle, select/replace and paste; verify
      cursor behavior and that overlong/malformed IDs are not truncated into another ID.
- [ ] Use a synthetic issued slip, reissue its password, then verify the old one
      fails and the new one works. Check received email content with the organizer.
- [ ] Sign out on a shared Mac, sign in as a second synthetic candidate and verify
      identity, contests and support history belong to that candidate only.
- [ ] Simulate API unavailability, expired credentials and a revoked account;
      errors are distinct/actionable, retries do not duplicate requests, and login
      help remains usable without first signing in.

Validation: normalization, login identity/feedback and support regressions in the
web suite. Native paste/caret and real delivery/revocation remain manual acceptance.
No additional authentication requests, retry loops or backend costs are introduced.

## MAC-11 / #206: preflight warning consistency

Reviewed against the merged #172 work and MAC-05's contextual microphone prompt.
The final review already uses the native policy decision, preserves the blocking
reason, calls warnings advisory and rechecks entry before opening the workspace.
Added a regression that executes the Mac review: warning text stays exact,
Continue does not promise guaranteed entry, and a repaired pass removes stale
warning text. No additional runtime behavior or requests are introduced.

Rashesh's existing native evidence covers proxy warning/Continue and truthful
Home preflight wording on one Apple Silicon machine. It does not cover the full
permission matrix. Keep this audit open for the remaining native acceptance.

- [ ] Deny/revoke camera and Accessibility, repair via Settings and retry without reinstall.
- [ ] Check a busy/disconnected camera: blocked reason and preview agree.
- [ ] Deny optional microphone: warning remains advisory; final policy stays authoritative.
- [ ] Cancel/restart setup: no duplicate prompts or stale failures after repair.
- [ ] Record warning, blocked, repaired and ready screenshots with build and architecture.

## MAC-12 / #207: reconcile existing load evidence before more changes

The issue's original hash-only benchmark is no longer the whole local record.
`/home/ayush/work/ams/loadtest/data/entry-runs.csv` includes a later 1,000-client
Enter Contest run (4 workers, 20+40 pool): 1,000 admitted, zero shed 503s,
entry p95 11,850 ms and health p95 299 ms. `enter-contest-storm.js` performs
session creation, contest index and first statement once per participant, using
pre-issued tokens. This is stronger evidence than nonexistent-ID login traffic,
but does not measure a real Mac's login/setup flow or reconcile unique DB sessions.

The separate `contest1300-summary.json` records 11,700 iterations, 5,247 accepted
submissions, 6,449 accepted runs, zero submit 5xx/network failures and an API-answer
rate of 1. Its script uses pre-provisioned seats and concentrates on one problem.
Do not silently equate those counts with entry success. The aggregate duration
minimum is negative (-1552.44049 ms); timing provenance needs review before
reusing its percentiles as release evidence.

Artifact hashes at review time (no credentials or seat/token files copied):
- `data/entry-runs.csv`: `2e64c1b17c2c2dac1f6f0158dcbee3d06cae410d991ffc595916827b2b348ecf`
- `enter-contest-storm.js`: `6fbad436df861f10c8e200c18fe6c4ec8e83943b719df470af6f0e45b7ccfe49`
- `contest1300.js`: `b4c33edf8feea0c4fef3427df800ff3ac26e933a63905a9d47d103bed833dfca`
- `contest1300-summary.json`: `df578ae34bb40493184d59fdd943dafcb1aa8cc8a73409f9cfd00caca3dd11ca`

Keep MAC-12 open: partial server qualification exists, not complete native/load
acceptance. No duplicate production load test or server tuning change was made.
For the remaining rehearsal, agree explicit latency/error limits first and use
staging or separately approved production fixtures. Start with a small calibration,
then the required 3,000 synthetic candidates plus organizer reads, heartbeats and
representative judging. Record attempted entry IDs, unique sessions, first-problem
successes and retry duplicates, along with p50/p95/p99, queue depth and request rate.
Reconcile all attempts, including failures, against server records before cleanup.

- [ ] Record one Mac login → setup → entry → first-problem baseline per supported architecture.
- [ ] Correlate those clients with the calibrated load run and deployed API/client hashes.
- [ ] Inject a bounded service outage, restore, and verify identity/draft/timer continuity.
- [ ] Reconcile attempted entries and unique server sessions; investigate every mismatch.
- [ ] Attach metrics, thresholds, fixture cleanup and independent reviewer sign-off.

## MAC-13 / #208: approval polling obeys overload guidance

Existing login handling already enforces Retry-After and prevents duplicate
submits before rerender. Existing Mac evidence covers delayed-start polling,
confirmed 401 handling and Run 429 countdown; those mechanisms are preserved.
A remaining gap was approval polling: Home swallowed its error and always retried
on a three-second interval. The poller now receives the error, honors Retry-After,
backs off failures (6/12/24/30 seconds plus up to three seconds of jitter), and
schedules only after settlement. Long server waits are chunked to avoid JS timer
overflow. Success restores the existing three-second cadence; disposal invalidates
late responses and stops scheduling. The same shared Home code serves Mac and
other platforms; regression tests protect their normal cadence and single-flight behavior.

- [ ] Rapid mouse/keyboard Retry produces one pending request/mutation.
- [ ] Login 503 with Retry-After: 5 retains identity and shows the existing cooldown.
- [ ] Approval polling 429/503 with Retry-After: 20 sends no poll before 20 seconds;
      repeated outages back off, then recovery updates the decision without a burst.
- [ ] Navigate away while a poll is pending; no stale decision or new timer appears.
- [ ] Measure request rate/CPU/memory on native Mac through an idle wait and recovery.

Scale: at 3,000 pending clients, the unchanged healthy cadence has a theoretical
1,000 polls/second ceiling before response latency. Sustained failure backs off to
roughly 91–100 polls/second, with jitter. These are client bounds, not proof of
server capacity. Native resource measurements and the combined staging load gate
remain open; no production traffic was generated.

## MAC-14 / #209: reconnect and restoration consistency

MAC-08 already adds nearby Mac Wi-Fi discovery and retains the latest reconnect
feedback. Existing heartbeat/submission logic distinguishes local drafts from
server receipts; this audit does not replace it. Found and fixed a cleanup leak:
exitToHome left eight ten-second deadline timers alive even when restoration
finished immediately. Deadlines now clear on settlement, preserving step order,
timeout behavior and restore-pending guidance. The shared helper's existing
failure/hung-native regressions plus the new timer accounting test cover this.

Keep this broader audit open. Retiring Network Lockdown does not retire reconnect,
small-window usability, draft continuity or server-outage acceptance. The current
branch still has legacy enforcement; don't claim its removal is shipped.

- [ ] With a synthetic contest, test Wi-Fi loss separately from an API-only outage.
- [ ] Reconnect on the same network and a new approved hotspot, including wrong
      password/failed scan; Retry, Join and Exit stay reachable at high scaling.
- [ ] Verify selected problem, exact draft, session identity and authoritative timer.
- [ ] Confirm an accepted receipt with the server; reconnect alone is not submission success.
- [ ] Exit offline and repeat entry/exit: networking restores or pending recovery
      is shown, and settled steps leave no lingering deadline timers.

Scale: removes retained local timers; no added requests, radio scans or retries.
Native networking/window verification remains required, so no closure yet.

## MAC-15 / #210: Home recovery must stop after navigation

The merged work already prevents duplicate entry attempts, fast-paths active
resume, excludes terminal stored sessions and preserves server refusal reasons.
Rashesh has native evidence for early-entry recovery, active resume and terminated
session messaging. Those paths remain intact.

A remaining transition race was Home's desktop recovery interval: clearing the
interval did not invalidate its pending native query. A late answer could release
desktop/simple fullscreen after navigation to setup or the workspace. Home now
invalidates both the query continuation and delayed platform lookup on unmount;
late callbacks cannot navigate to recovery either. It still releases leftovers
while mounted and preserves a Mac user's native green-button fullscreen.
Tests execute the actual effect for both late-response races and normal recovery.

- [ ] Complete setup and rapidly repeat Enter: one session and workspace.
- [ ] Navigate Home → setup while a native query is delayed; it must not exit
      fullscreen or unlock the new session when the old query returns.
- [ ] Resume active/pending sessions; preserve the existing approval rules and
      exact destination. Terminated/completed sessions must not become Resume loops.
- [ ] Fail final readiness, retry, then restart once during setup and once after
      entry; successful checks/session/draft state follow the documented recovery route.
- [ ] Return to Home with genuine leftover lockdown; mounted recovery still works
      and incomplete restoration remains visible.

Scale: no additional polling or backend requests; the existing five-second local
check stays single-flight and its late work is invalidated. Keep the audit open
for repeated-entry/restart native acceptance, rather than closing on unit tests.

## MAC-16 / #211: organizer approval and identity isolation

Existing recovery epochs reject late approval responses after sign-out, session
replacement and approval consumption. The Home storage regressions exercise these
races; MAC-13's bounded polling remains unchanged. No second approval mechanism
was introduced. Organizer bulk operations and cross-account native acceptance
remain unverified; client unit tests cannot establish server authorization.

- [ ] Open three synthetic candidates and approve only A; B and C stay pending.
- [ ] Deny B, bulk-approve the intended remaining candidates, and verify the queue.
- [ ] Delay an approval response, sign out A and sign in B; no A redirect or draft.
- [ ] Repeat Resume after an interrupted response; one approval is consumed once.
- [ ] Compare each candidate's draft and submission receipts with the organizer.

Scale: retain the MAC-13 single-flight/backoff policy; qualify the combined
organizer and candidate workload at 3,000 participants before release.

## MAC-17 / #212: server clock after Mac sleep

A native wake event now requests an immediate heartbeat through the existing
single-flight path. This refreshes the server clock without trusting the Mac's
wall clock or waiting for the regular heartbeat interval. Late wake callbacks
after cleanup are ignored. Existing clock/window/extension handling is retained.

- [ ] With wrong Mac time/timezone, compare entry boundaries and timer to server.
- [ ] Sleep across a start or end boundary; wake online and verify current phase.
- [ ] Wake offline, reconnect, and verify server time/Finish state converge.
- [ ] Postpone or extend a synthetic contest; verify only its timer changes.

Scale: one wake-triggered heartbeat, using the existing in-flight guard; no new
polling interval. A whole-hall reconnect still requires staging capacity evidence.

## MAC-18 / #213: draft backup continuity

Fixed overlapping background saves: a slow request now holds one shared flight
across interval ticks and effect replacement. Cancelled responses cannot update
revision/cache state or disable a later effect. Local immediate draft writes are
unchanged. Tests execute the actual backup effect with deferred success/failure.

API companion commit `9e3b78c` on `fix/macos-draft-cors` adds PUT to the existing
CORS policy. Real middleware preflight tests pass for Mac, Windows and hosted-dev
origins, while an untrusted origin remains rejected. This needs API review, CI
and deployment; a client build alone cannot fix a rejected preflight.

- [ ] Edit different problems/languages; navigate away and back, compare exact text.
- [ ] With slow networking, verify one backup at a time in the network inspector.
- [ ] Verify OPTIONS then PUT succeeds on the deployed API from the packaged Mac.
- [ ] Disconnect, type, force-quit, restart and obtain re-entry approval; verify
      last confirmed local text. Test server restoration separately on synthetic data.
- [ ] Sleep/wake and repeat with CPU/memory pressure; keystrokes remain intact.

Scale: unchanged 45-second backup cadence, changed buffers only, serialized
problems and no overlapping batch. At 3,000 continuously editing clients one
changed problem per tick is about 67 PUTs/sec, plus preflights where uncached;
multiple changed problems increase that bound. Staging capacity is not measured.

## MAC-19 / #214: run output and judging diagnostics

Confirmed the existing engine fix: cxxprobe commit `155339b` serializes ordinary
case stdout/stderr, including empty output, and is included in released v1.0.0
(`d69bfa6`). The release has a Linux binary and checksum asset. Worker main
`cf3ba88` pins that version; its earlier `df4ae20` forwards manual-case output.
These are source/release facts, not proof that running judges were refreshed.

The client already has a separate behavior diagnostic view. Updated obsolete
copy claiming ordinary test output is never returned. Added real-renderer
regressions distinguishing returned text, empty output, omitted output, hidden
cases and failed behavior diagnostics/stderr. Existing stale-attempt selection
and request/idempotency tests remain in place.

- [ ] Verify the active judge binary version and checksum, not just the bootstrap pin.
- [ ] Run known AC, WA, CE, RE and TLE fixtures; check verdict, diagnostics and output.
- [ ] Run empty-output and multiline custom-input fixtures; empty is not missing.
- [ ] Select a failed behavior check; its diagnostic stays visible and readable.
- [ ] Switch attempts while a result is delayed; it must not replace the new selection.
- [ ] Simulate queue/service failure; show explicit failure, never fabricated output.

Release asset SHA-256: `22dd9cc810e454e74e64f0d24949260785eb91c5a6c287cd27af5a9beb54a9b0`.
API filtering must still keep hidden submission tests private. Worker companion `5d57560` on `fix/macos-output-contract` fixes one further gap:
missing/null output from older engines stays absent instead of becoming an empty
string. The existing worker suite exposed this regression; all 25 translation
checks pass after the fix, including explicit-empty/new-engine cases. No judge
rollout or live end-to-end output check was performed. No new polling or judge jobs.

## MAC-20 / #215: submission and Finish acceptance

Retained the current implementation: submission uses an in-flight guard and
persisted payload-scoped retry identity. Finish refuses while the submission
request is outstanding, but does not wait for judging after acceptance. Finish
and device-draft acknowledgements are separate; retries are bounded and an
unconfirmed Finish retains recovery rather than claiming success. Existing
submission-retry, submission-refresh and contest-confidence tests cover these
contracts. No new submission or auto-submit behavior was introduced.

- [ ] Double-click Submit on a synthetic solution; compare one server receipt.
- [ ] Lose its acknowledgement, retry unchanged text; retain the same submission.
- [ ] Change the source and submit again; confirm a distinct attempt.
- [ ] Click Finish with a pending Submit; it waits for acceptance, not judge completion.
- [ ] Drop the Finish reply and reconnect; confirm server state and truthful receipt.
- [ ] Cross the exact deadline offline and online; retain the local draft without
      inventing an accepted submission, and verify the organizer's final state.

Scale: no extra requests. Existing bounded retries need combined staging testing
with judge backlog, rather than treating client mocks as proof of 3,000-seat capacity.

## MAC-21 / #216: support and outage communication

Support integration is present: signed-out users send a one-way guest issue with
contact details; authenticated chat uses identity-scoped capabilities. Existing
help-request-modal and support-auth/poll tests cover that distinction and retries.
The contest workspace fetches announcement revisions through heartbeat, staggers
fetches, shows a mandatory modal and records acknowledgement. Its existing tests
cover acknowledgement and malformed/missing storage behavior.

Remaining scope gap: no announcement delivery was found on Home or onboarding,
and the workspace suppresses its announcement overlay once the finish receipt
owns the screen. The broad "all online candidates" requirement is therefore not
proven satisfied. Claude owns announcement implementation per the user's request;
this audit does not overwrite it or close this issue. Packaged client and deployed
API versions must also be checked, not inferred from merged branches.

- [ ] On Login, report inability to sign in without first signing in; verify receipt
      in the organizer inbox and contact details, with no unusable guest chat.
- [ ] In an authenticated session, send/retry a message, receive a reply and sign out.
- [ ] Publish a synthetic postponement while candidates are in Home, setup, contest
      and finish screens; record delivery failures for the announcement owner.
- [ ] Reconnect an offline candidate; verify the current notice and acknowledgement.
- [ ] Notice must explicitly say stop/continue, contact route and next update time.

Scale: existing revision-triggered single-flight fetching and support backoff are
retained. Test simultaneous delivery plus organizer actions at 3,000 seats.

## MAC-22 / #217: problem, reference and practice consistency

Preserved existing published-reference snapshots, contest-scoped modal state,
focus/background isolation and embedded offline C++ reference loader. Current
reference-sheet, reference-content, cppref and practice-entry tests cover those
client contracts. Source tests cannot verify a setter's actual published paper,
compiler flags or the live practice judge fleet. No content or policy was guessed.

- [ ] Compare each statement, sample, scoring rule and language with the published
      organizer version and actual worker compiler configuration.
- [ ] Open Reference, scroll/search, close and reopen; editor text, cursor and timer
      remain intact, and keyboard focus returns to the workspace.
- [ ] Open a different contest/account; no prior reference or modal state leaks.
- [ ] Disconnect after loading; bundled C++ reference remains usable with bounded
      fetches/cache, while missing assets produce an actionable error.
- [ ] Verify practice entry and a real judged sample. Practice does not schedule
      fleet warming; arrange an explicit approved warm window for rehearsal.

Scale: retain existing cache/bounded refresh behavior. Published-only authorization
needs API integration evidence; no production paper or fleet was changed.

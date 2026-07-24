# Windows production-readiness findings

This file uses the requested finding schema. “ABSENT” means no implementation was found in the repository that owns the relevant responsibility. Evidence without a repository prefix is in `ams-access`; evidence prefixed with `ams-golang/` or `cxxprobe/` is from the corresponding dependency repository. Framework defaults, intended architecture, observed wiring, and Windows-only behavior are explicitly distinguished.

### WIN-001 — Installation and launch require Administrator
Dimension: 1
Severity: P0
Evidence: apps/desktop/src-tauri/tauri.conf.json:39-41, apps/desktop/src-tauri/build.rs:25-31, apps/desktop/src-tauri/src/lib.rs:2241-2267, packages/core-rs/src/exam/mod.rs:200-205
Current: NSIS is per-machine, the PE manifest requests `requireAdministrator`, and startup attempts a `runas` relaunch. The readiness policy intentionally downgrades `windows_no_admin` to a warning even though it notes that firewall lockdown is unavailable.
Windows problem: A student without admin credentials cannot install or start the product. If an unelevated build is somehow launched, policy can allow it with warnings despite a missing firewall control.
Failure scenario: Ten minutes before a contest, a candidate on a parent-managed or university-managed laptop cannot satisfy UAC and never reaches the exam.
Fix direction: Define a supported per-user/no-admin deployment and move privileged controls behind an optional, preflighted service or redesign the strict policy to fail before exam day.
Effort: L (>3d)
Confidence: high
Verification: On clean Windows 10 and 11 standard-user accounts with no admin credentials, install both MSI and NSIS, launch, decline UAC, and record whether any supported exam path remains.

### WIN-002 — Windows artifacts have no Authenticode identity
Dimension: 2
Severity: P0
Evidence: apps/desktop/src-tauri/tauri.conf.json:35-38, .github/workflows/release.yml:131-143, .github/workflows/release.yml:145-177
Current: The Windows certificate thumbprint is null. Release provides Tauri updater-signing and Apple credentials, but no Windows signing certificate/signtool step. The configured timestamp URL cannot sign an artifact by itself.
Windows problem: The MSI, NSIS bootstrapper, and application executable are unsigned. Cold-start SmartScreen reputation is therefore absent, and the elevation dialog identifies an unknown publisher.
Failure scenario: Candidates see “Windows protected your PC” and an unknown-publisher UAC prompt, then abandon or are policy-blocked from running the exam client.
Fix direction: Authenticode-sign every Windows executable/installer with a production certificate and RFC3161 timestamp, then verify signatures as a release gate and build reputation before launch.
Effort: M (1-3d)
Confidence: high
Verification: Download the draft artifact on a clean Windows Sandbox/VM, run `Get-AuthenticodeSignature`, `signtool verify /pa /all <artifact>`, and record SmartScreen plus UAC publisher text.

### WIN-003 — MSI and NSIS ship without a defined product/upgrade contract
Dimension: 1
Severity: P1
Evidence: apps/desktop/src-tauri/tauri.conf.json:32-41, .github/workflows/release.yml:145-177
Current: Both MSI and NSIS are produced and uploaded. The repository does not select a canonical installer or document/test per-user/per-machine scope, upgrade, downgrade, repair, uninstall, data retention, or migration.
Windows problem: Installing one format over the other can create parallel registration/uninstall behavior; stale app-data and firewall/registry state are not covered by installer tests.
Failure scenario: A candidate installs the new MSI over last semester’s NSIS and launches the wrong binary or cannot cleanly uninstall it before the exam.
Fix direction: Select one supported Windows channel and codify install/upgrade/downgrade/uninstall semantics with clean-VM automated tests.
Effort: M (1-3d)
Confidence: high
Verification: On Win10/Win11 VMs, install vN via each format, upgrade to vN+1 same-format and cross-format, downgrade, repair, uninstall, then inspect installed products, files, app data, services, and firewall rules.

### WIN-004 — WebView2 bootstrap is not offline/proxy resilient
Dimension: 1
Severity: P0
Evidence: apps/desktop/src-tauri/tauri.conf.json:35-41, apps/desktop/src-tauri/Cargo.toml:42-45, apps/desktop/src-tauri/src/lib.rs:2342-2378
Current: The client requires WebView2, but Windows bundle config has no explicit fixed runtime or `webviewInstallMode`. The expected Tauri 2 default is a silent download bootstrapper; that is a framework-default inference, not verified repository behavior.
Windows problem: A WebView2-missing machine needs installer-time network access to Microsoft. Captive portals, proxies, TLS inspection, or offline exam staging can make installation succeed incompletely or fail.
Failure scenario: A candidate downloads the installer at college, but the silent WebView2 bootstrap is blocked by the campus proxy and the app never renders.
Fix direction: Choose and document an explicit WebView2 deployment mode appropriate to unmanaged machines, and test missing/outdated runtime plus offline/proxy failure UX.
Effort: M (1-3d)
Confidence: medium
Verification: Remove WebView2 from a disposable Windows VM, block internet or require an authenticated proxy, run both installers, and inspect installer logs and first launch.

### WIN-005 — No in-app update, rollout, or rollback mechanism
Dimension: 3
Severity: P1
Evidence: apps/desktop/src-tauri/Cargo.toml:17-48, apps/desktop/src-tauri/src/lib.rs:2283-2322, .github/workflows/release.yml:145-165
Current: Updater dependency, plugin, endpoints, client command, rollout policy, and rollback logic are ABSENT. Release may publish Tauri `.sig` sidecars, but no installed client consumes them.
Windows problem: A bad version cannot be halted or rolled back through the app, and an urgent fix requires candidates to manually reinstall. Conversely, no surprise auto-update occurs ten minutes before an exam.
Failure scenario: A Windows-only launch defect is discovered on exam morning and 500 candidates remain on a broken installed version with no controlled remediation.
Fix direction: Add a signed, staged update channel with explicit exam-window freeze, minimum-version policy, rollback, and failure-safe retention of the previous version.
Effort: L (>3d)
Confidence: high
Verification: Install vN, publish vN+1 and a deliberately bad vN+2 to a staging feed, exercise pre-exam freeze, signature rejection, interrupted update, and rollback.

### WIN-006 — Defender/EDR compatibility is an unmitigated release blocker
Dimension: 4
Severity: P0
Evidence: packages/platform-rs/src/windows/mod.rs:8-21, packages/platform-rs/src/windows/mod.rs:542-568, packages/platform-rs/src/windows/mod.rs:892-983, packages/platform-rs/src/windows/mod.rs:1230-1336, apps/desktop/src-tauri/tauri.conf.json:63-69
Current: An unsigned elevated binary installs a global low-level keyboard hook, enumerates and force-kills processes, changes registry policy and firewall rules, monitors clipboard updates, suppresses capture, and bundles helper binaries/resources. No Defender/third-party AV test, vendor submission, reputation plan, or candidate mitigation exists.
Windows problem: This is a dense cluster of heuristic malware/PUA signals. Quarantine, Controlled Folder Access, EDR process blocking, or hook denial can occur on unmanaged laptops without any allowed Defender exclusion.
Failure scenario: Defender quarantines the fresh release for 30 candidates as they launch, leaving no time or administrator support to recover.
Fix direction: Sign first, reduce/broker suspicious behavior, submit release candidates to Microsoft and major AV vendors, and gate shipping on multi-engine clean-VM testing.
Effort: L (>3d)
Confidence: high
Verification: Scan the exact signed MSI/NSIS and installed files with current Defender, run all lockdown controls under Defender and representative third-party AV/EDR, then submit false positives through vendor portals.

### WIN-007 — Keyboard hook reports success before installation succeeds
Dimension: 5
Severity: P0
Evidence: packages/platform-rs/src/windows/mod.rs:894-924, packages/platform-rs/src/windows/mod.rs:965-983, apps/desktop/src-tauri/src/lib.rs:641-649, packages/core-rs/src/exam/mod.rs:618-641
Current: `enable_keyboard_intercept` sets the active flag, spawns the hook thread, and immediately returns `active: true`. `SetWindowsHookExW` can then fail asynchronously and clear the flag, but the returned readiness result remains true; the readiness probe immediately calls disable.
Windows problem: Hook denial, AV interference, thread-start delay, or installation failure can pass the mandatory keyboard readiness check. The final lock can similarly race failure before `LOCKDOWN_ENGAGED` is recorded.
Failure scenario: The candidate enters a strict contest with Alt+Tab and Win-key switching available because readiness attested a hook that never installed.
Fix direction: Handshake hook installation and liveness back to the caller; fail closed on timeout and continuously surface hook death to the session gate.
Effort: M (1-3d)
Confidence: high
Verification: Instrument/force `SetWindowsHookExW` failure on Windows, invoke readiness and final lock, and confirm neither can return success before a real hook blocks a test keystroke.

### WIN-008 — Screenshot suppression failure is ignored
Dimension: 5
Severity: P0
Evidence: packages/platform-rs/src/windows/mod.rs:360-388, apps/desktop/src-tauri/src/lib.rs:1382-1402, apps/desktop/src-tauri/src/lib.rs:1467-1472
Current: `SetWindowDisplayAffinity` returns a boolean, but `lock_desktop` discards it. Lockdown success is based on the keyboard-hook result, not capture protection. Protection is applied once and is not revalidated.
Windows problem: Unsupported builds, compositor/API failure, higher-privilege capture, remote tools, or affinity loss can leave the exam visible to capture while the client reports lockdown engaged.
Failure scenario: Screen sharing remains active during a scored contest, yet the candidate and proctor receive no hard failure because keyboard lockdown succeeded.
Fix direction: Make capture capability an explicit readiness/session signal, monitor it, and define supported/fail-closed behavior with known limitations.
Effort: M (1-3d)
Confidence: high
Verification: On Win10 22H2/Win11, test Snipping Tool, PrintScreen, OBS Display/Window Capture, Teams/Zoom sharing, RDP, and a higher-integrity capture process; force affinity failure and confirm launch blocks.

### WIN-009 — Proctoring controls are detection-oriented and incomplete
Dimension: 5
Severity: P1
Evidence: packages/platform-rs/src/windows/mod.rs:31-155, packages/platform-rs/src/windows/mod.rs:1083-1103, packages/platform-rs/src/windows/mod.rs:1389-1420, apps/desktop/src-tauri/src/lib.rs:1412-1418, apps/web/src/app/session/contest/client.tsx:1648-1668
Current: The hook blocks common shortcuts and static process names; native focus loss, display topology, RDP, VM, capture-process, and clipboard metadata are monitored. The code explicitly admits Ctrl+Alt+Del/Win+L cannot be blocked. Clipboard is logged but not cleared, and camera acquisition accepts any `videoinput`; virtual-camera detection is ABSENT.
Windows problem: Static lists miss renamed/new tools, browser-based sharing, services, and virtual cameras. Secure-attention escape is unavoidable in user mode, and detection does not prevent a second device or privileged tampering.
Failure scenario: A candidate uses an unlisted virtual camera or renamed remote tool while the UI presents the session as secured.
Fix direction: Publish an honest threat model, add server/proctor response to detected loss, detect device/capture classes where reliable, and avoid claims of kiosk-grade prevention on unmanaged Windows.
Effort: L (>3d)
Confidence: high
Verification: Build an adversarial Windows matrix covering CAD, Win+L, Task Manager/UAC, mouse task switching, renamed tools, browser sharing, common virtual cameras, RDP, VMs, Miracast, hotplug, and clipboard read/write.

### WIN-010 — Production runtime authority is ambiguous across three judge paths
Dimension: 6
Severity: P0
Evidence: apps/web/src/app/session/contest/client.tsx:1404-1454, ams-golang/internal/worker/runner.go:1370-1522, ams-golang/internal/bridge/judge_conn.go:183-203, ams-golang/Dockerfile.judge:1-38, cxxprobe/src/sandbox/sandbox.cpp:275-346, cxxprobe/src/cases/cases.cpp:269-283
Current: The Windows client submits source to the Go API and displays returned `runtime_ms`. Three server-side timing models exist: the Go worker starts with elapsed wall time, may replace it with nsjail or `/usr/bin/time` CPU time, subtracts hard-coded per-language overhead, then rounds and adds an input-hash-derived value; the DMOJ bridge converts judge-reported seconds; and the intended cxxprobe engine reports cgroup CPU time plus monotonic wall time. No release/configuration manifest identifies which engine and metric is authoritative for a production attempt, and the Go repository does not invoke cxxprobe.
Windows problem: Execution is remote rather than dependent on candidate hardware, but Windows candidates still receive and may be ranked by a value whose semantics vary with the deployed judge path. The synthetic normalization in the Go worker is not measured runtime, while cxxprobe exposes separate CPU and wall metrics that the existing API collapses into one field.
Failure scenario: Two otherwise equivalent attempts are judged by different worker paths or versions, receive non-comparable `runtime_ms` values, and change a time-based rank with no audit trail explaining the engine or metric.
Fix direction: Make a pinned cxxprobe build the sole scored execution authority, define whether `runtime_ms` means cgroup CPU or monotonic wall time, remove synthetic timing manipulation, persist raw CPU/wall values plus engine/image/problem digests, and establish hardware/contention/retry calibration before runtime affects scoring.
Effort: L (>3d)
Confidence: high
Verification: Submit a golden workload through the public Go API, prove the attempt records the expected cxxprobe version/image/problem digest and raw CPU/wall metrics, then repeat across workers and controlled contention until variance is within a published scoring tolerance.

### WIN-011 — Client expiry uses mutable wall clock
Dimension: 6
Severity: P0
Evidence: apps/web/src/app/session/contest/components/hooks.ts:59-110, apps/web/src/app/session/contest/client.tsx:1572-1590, apps/desktop/src-tauri/src/lib.rs:1264-1289, packages/core-rs/src/exam/mod.rs:539-568
Current: The visible countdown and auto-submit calculate `end_at - Date.now()` every second. Clock skew is measured only when the probe returns a signal; an unmeasured clock is treated as passing. No Windows time-change or resume event is handled.
Windows problem: Manual/system clock jumps can make the client submit early or late. Sleep delays the interval until resume; server enforcement may protect the backend, but that implementation is not in scope.
Failure scenario: Windows time synchronization jumps forward during the last hour and the client immediately final-submits and unlocks the candidate.
Fix direction: Anchor client display to a server-derived epoch plus monotonic elapsed time, revalidate after resume/time change, and make server time authoritative for acceptance.
Effort: M (1-3d)
Confidence: high
Verification: During a staging contest, change Windows time ±10 minutes, toggle automatic time, sleep/hibernate, and resume; compare client countdown/submission with server acceptance timestamps.

### WIN-012 — Local answer buffer is written but never restored
Dimension: 9
Severity: P0
Evidence: apps/web/src/app/session/contest/client.tsx:94-99, apps/web/src/app/session/contest/client.tsx:921-978, apps/web/src/app/session/contest/client.tsx:1288-1317, apps/web/src/app/session/contest/client.tsx:1517-1569
Current: Failed saves mirror editor state into a session/question localStorage key. Contest load restores only server `/answers`; no reader for the local buffer exists. Final submit ignores the boolean result of `handleSave`, retries `/submit`, then unlocks even when save/submit is unconfirmed.
Windows problem: The UI calls work “saved locally,” but a crash/restart or final-submit failure cannot rehydrate that work into the editor or upload it. The buffer becomes stranded data.
Failure scenario: Wi-Fi drops during the final edits, time expires, the app unlocks with a warning, and the candidate’s last answer is neither submitted nor recoverable through the UI.
Fix direction: Implement versioned, authenticated local draft recovery and a durable outbox that reopens/retries before clearing the active session; never claim recovery without exercising it.
Effort: L (>3d)
Confidence: high
Verification: Edit offline, confirm local buffer exists, kill/restart the app, resume the same session, and verify byte-identical editor recovery and eventual server upload before/after expiry.

### WIN-013 — Transient offline resume clears the session pointer
Dimension: 9
Severity: P0
Evidence: apps/web/src/app/home/page.tsx:608-631, apps/web/src/app/home/page.tsx:662-714, apps/web/src/app/home/page.tsx:720-763
Current: Home reads the stored active session and validates it with the server. Any thrown fetch failure enters the catch path, which removes the stored active-session key and marks it invalid.
Windows problem: A temporary network outage during restart is treated as evidence that no resumable session exists. The only local pointer to the session is discarded precisely when offline recovery is needed.
Failure scenario: After an app crash on flaky Wi-Fi, reopening while still offline permanently removes the candidate’s resume affordance.
Fix direction: Distinguish network-unverifiable from server-invalid, retain encrypted/session-scoped metadata and drafts, and retry validation without destructive clearing.
Effort: M (1-3d)
Confidence: high
Verification: Start a session, terminate the app, disconnect network, relaunch, then reconnect and confirm the original session remains discoverable and resumable.

### WIN-014 — Firewall lockdown does not prove control of WebView2 traffic
Dimension: 10
Severity: P0
Evidence: packages/platform-rs/src/windows/mod.rs:1230-1264, apps/desktop/src-tauri/src/lib.rs:267-275, apps/web/src/app/session/onboarding/page.tsx:531-590
Current: Firewall rules target only `current_exe()` while the repository states submissions are issued by the embedded WebView2 via JS fetch. The frontend treats successful `netsh` command completion as proof that internet is secured.
Windows problem: WebView2 uses child processes, and the repository has no test proving that a rule scoped to the Tauri executable governs those child network connections. Windows Firewall block/allow precedence is also assumed in comments, not verified in code.
Failure scenario: The launch gate reports “Outbound traffic restricted,” but WebView2 or another process still reaches arbitrary destinations, invalidating the core anti-cheat control.
Fix direction: Define the intended egress threat model and verify WFP behavior end to end; route sensitive traffic through a controlled native broker or use enforceable child/package rules.
Effort: L (>3d)
Confidence: medium
Verification: During lockdown, use `Get-NetTCPConnection`, Windows Firewall logging, and packet capture to identify owning PIDs; attempt JS fetches to allowed/disallowed hosts and traffic from WebView2 child/browser processes.

### WIN-015 — IP snapshot lockdown is incompatible with proxies and address rotation
Dimension: 10
Severity: P0
Evidence: apps/desktop/src-tauri/src/lib.rs:1584-1609, packages/platform-rs/src/windows/mod.rs:1239-1312, apps/web/src/app/session/onboarding/support.ts:16-20
Current: The API hostname is resolved once before lock, and only those IP literals are allowed. No proxy endpoint, DNS refresh, service range, failover host, or address-rotation update is included.
Windows problem: Corporate/system proxies connect to proxy IPs, not the API IP. Cloud/CDN DNS can rotate or return different IPv4/IPv6 answers during a long exam, after which the app’s own API connection is blocked.
Failure scenario: The candidate passes setup, the Cloud Run address changes mid-contest, and all autosaves/submissions fail behind the app’s persistent block rule.
Fix direction: Replace one-time DNS pinning with a controlled proxy/broker or safely refreshed destination policy; explicitly support or reject authenticated proxies during preflight.
Effort: L (>3d)
Confidence: high
Verification: Lock down through an authenticated Windows system proxy, rotate the staging hostname’s A/AAAA answers, switch networks, and confirm saves/submissions remain reachable while disallowed egress stays blocked.

### WIN-016 — TLS trust differs between telemetry and submissions
Dimension: 10
Severity: P1
Evidence: apps/desktop/src-tauri/src/lib.rs:17-23, apps/desktop/src-tauri/src/lib.rs:244-305, apps/desktop/src-tauri/src/lib.rs:267-275
Current: Rust readiness/event calls trust only embedded Google roots. JS submissions use WebView2 and the Windows trust store. Corporate TLS interception can therefore break telemetry while submissions still work, or inspect submissions while Rust-side status appears pinned.
Windows problem: The security and availability model is inconsistent and produces partial failures that are hard to diagnose on proxied networks.
Failure scenario: Thirty corporate-proxy candidates can submit but all organizer event streams disappear, so operations cannot see focus/camera failures during the exam.
Fix direction: Unify transport ownership and trust policy for critical API calls, with explicit proxy behavior, pin rotation/kill-switch governance, and partial-failure telemetry.
Effort: L (>3d)
Confidence: high
Verification: Install a test MITM root and use a TLS-inspecting proxy; compare JS save/submit, Rust readiness, clock probe, and event-stream behavior and server visibility.

### WIN-017 — Windows paths and user settings are not safely preserved
Dimension: 7
Severity: P1
Evidence: packages/platform-rs/src/windows/mod.rs:457-516, packages/platform-rs/src/windows/mod.rs:570-577, packages/platform-rs/src/windows/mod.rs:1242-1249, apps/desktop/src-tauri/src/lib.rs:2128-2139
Current: Lockdown overwrites Task Manager, Win-key, Game Bar, and touchpad registry values, then deletes or forces them to enabled instead of restoring prior values. Firewall path conversion is lossy for non-Unicode-representable strings. Face paths manually mix separators and fall back to protected `C:\Windows\Temp`.
Windows problem: Existing accessibility/gaming/touchpad policy is destroyed; non-ASCII/custom install paths can produce a firewall rule for the wrong executable; protected fallback paths depend on elevation.
Failure scenario: After a crash or normal exam exit, a candidate’s pre-existing Game Bar/touchpad policy is changed, while another candidate’s Unicode install path never receives the intended firewall rule.
Fix direction: Snapshot and transactionally restore exact prior registry values; keep paths as UTF-16/OS path types and use Tauri known folders for every write.
Effort: M (1-3d)
Confidence: high
Verification: Preconfigure non-default registry values, install under a path with spaces and non-ASCII characters, lock/unlock/crash, and diff registry/firewall/path behavior byte for byte.

### WIN-018 — Multiple instances can dismantle each other’s lockdown
Dimension: 8
Severity: P0
Evidence: apps/desktop/src-tauri/src/lib.rs:2283-2463, packages/platform-rs/src/windows/mod.rs:1239-1241, packages/platform-rs/src/windows/mod.rs:1251-1295, packages/platform-rs/src/windows/mod.rs:1315-1336
Current: Single-instance enforcement is ABSENT. All instances use the same global firewall rule names; enabling begins by deleting existing rules, and any window destruction deletes all named rules.
Windows problem: A second launch can remove/recreate the first exam’s rules, and closing either instance removes firewall protection for the other. Registry restoration has the same shared-state conflict.
Failure scenario: A candidate launches the app twice and closes the spare window, silently restoring network access in the still-running scored session.
Fix direction: Enforce one instance per user/session and make OS changes owner-tokened/transactional so an instance can remove only state it created.
Effort: M (1-3d)
Confidence: high
Verification: Launch two elevated instances, start lockdown in one/both, close them in both orders, and continuously inspect firewall rules, registry values, hook behavior, and network reachability.

### WIN-019 — Startup firewall recovery races new lockdown
Dimension: 8
Severity: P0
Evidence: apps/desktop/src-tauri/src/lib.rs:2227-2238, packages/platform-rs/src/windows/mod.rs:1315-1336, apps/web/src/app/session/onboarding/page.tsx:531-597
Current: Startup spawns background deletion of stale firewall rules and immediately continues. There is no join/barrier before a new session can call `enable_network_lockdown`.
Windows problem: The recovery thread can delete newly created rules after launch reports success, especially on slow machines or when `netsh` is delayed by security software.
Failure scenario: A fast resume engages lockdown, then the startup cleanup thread finishes and removes it during the live exam.
Fix direction: Complete/reconcile stale-state recovery synchronously before accepting session commands and validate ownership/state after lock.
Effort: S (<1d)
Confidence: high
Verification: Add artificial `netsh` delay on a staging build or slow VM, immediately start a session, and poll `Get-NetFirewallRule` plus disallowed reachability for the first minute.

### WIN-020 — Abrupt termination leaves machine and session recovery incomplete
Dimension: 8
Severity: P1
Evidence: apps/desktop/src-tauri/src/lib.rs:2434-2451, packages/platform-rs/src/windows/mod.rs:518-540, apps/desktop/src-tauri/src/lib.rs:2197-2208
Current: Normal `WindowEvent::Destroyed` unlocks and removes rules. Unix signals have handlers; Windows has no console-control/crash handler. Registry/firewall recovery occurs only on a later app launch. No lid-close, shutdown, reboot, panic, or forced-kill session protocol exists.
Windows problem: `taskkill /F`, power loss, reboot, or process abort bypasses teardown, leaving firewall/registry changes until the user relaunches. Server-side session recovery is separate and can lose the local resume pointer per WIN-013.
Failure scenario: The app crashes, leaves the laptop network-restricted and Task Manager disabled, and the candidate cannot contact support without discovering that relaunch performs cleanup.
Fix direction: Use a crash-resilient owner/lease helper and startup marker with deterministic recovery; document a support escape and test Windows shutdown/restart-manager paths.
Effort: L (>3d)
Confidence: high
Verification: Force-kill, crash, power off, reboot, sign out, close lid, and terminate during each registry/firewall step; inspect state before and after relaunch.

### WIN-021 — Sensitive state is plaintext and same-user tamperable
Dimension: 11
Severity: P1
Evidence: apps/web/src/lib/candidate-auth.ts:1-18, apps/web/src/lib/candidate-auth.ts:38-72, apps/web/src/app/session/contest/client.tsx:1288-1307, apps/desktop/src-tauri/src/lib.rs:2128-2151
Current: Candidate JWT, mutable device ID, active-session metadata, and answer buffers live in WebView localStorage. Face PNGs are plaintext temp files and are not removed. Local proctoring logs are tamper-evident hashes without a server-held secret.
Windows problem: Any process under the same user can copy/modify WebView data and temp files while the app is closed; token and device ID can be moved together. Elevation does not make per-user storage trustworthy.
Failure scenario: A candidate copies local credentials/state to another profile or edits local drafts/identity metadata and the server cannot distinguish the original device solely from those values.
Fix direction: Store secrets in Windows credential protection, bind sessions to server-issued device keys, encrypt/authenticate drafts, and delete face/temp data under a documented retention policy.
Effort: L (>3d)
Confidence: high
Verification: Locate the WebView2 user-data folder and temp files, copy/edit them as the same user while app is closed, relaunch, and test token/device/session replay from a second Windows account/machine.

### WIN-022 — Broad global IPC magnifies any renderer compromise
Dimension: 11
Severity: P1
Evidence: apps/desktop/src-tauri/tauri.conf.json:12-30, apps/desktop/src-tauri/capabilities/main.json:1-23, apps/desktop/src-tauri/src/lib.rs:2283-2322, apps/web/src/app/session/contest/components/markdown.ts:51-108
Current: `window.__TAURI__` is global and the main window can invoke commands that alter firewall, kill applications, write face files, unlock the desktop, and exit/relaunch. Problem markdown is sanitized and release DevTools are omitted, which reduces but does not eliminate renderer compromise.
Windows problem: Any future XSS/supply-chain defect in the privileged renderer becomes native command access. CSP includes `unsafe-inline` and `wasm-unsafe-eval`.
Failure scenario: A malicious contest payload exploits a renderer bug and invokes `unlock_desktop` or changes network rules during an exam.
Fix direction: Remove global injection, minimize/scoped command permissions, validate command state/session server-side, and fuzz/test every untrusted rendering path.
Effort: L (>3d)
Confidence: high
Verification: In a staging build with DevTools, attempt command invocation from injected DOM/script contexts and verify capability/state checks deny unlock, firewall, process, and file mutations.

### WIN-023 — Real-hardware UI support is unverified
Dimension: 12
Severity: P1
Evidence: apps/desktop/src-tauri/tauri.conf.json:14-25, apps/web/src/app/home/components/SettingsPanel.tsx:573, apps/web/src/app/home/components/SessionReadinessModal.tsx:350-351, apps/web/src/app/session/contest/client.tsx:2551-2554
Current: The window starts at 1280×800 and live UI uses full viewport layouts; some panels impose 540–560 px minimum heights. Responsive rules and a selectable editor high-contrast theme exist, but no Windows forced-colors/per-monitor-DPI test suite or support matrix exists.
Windows problem: 125/150/200% scaling, 1366×768 laptops, per-monitor moves, text scaling, touch, high contrast, and large system fonts can clip mandatory buttons or editor/terminal content.
Failure scenario: At 150% scale on a 1366×768 laptop, the final lock-in or submit control is off-screen and cannot be reached during the timed exam.
Fix direction: Establish a Windows visual/keyboard accessibility matrix and remove fixed minimums that block critical controls; verify per-monitor DPI transitions and forced colors.
Effort: M (1-3d)
Confidence: medium
Verification: Run the installed app at 100/125/150/200% on 1366×768 and 4K mixed-DPI monitors with text scaling/high contrast, traverse every stage by keyboard, and hot-move/hotplug displays.

### WIN-024 — Windows ARM64 release support is ABSENT
Dimension: 13
Severity: P1
Evidence: .github/workflows/release.yml:13-28, .github/workflows/ci.yml:24-35
Current: Release builds only `x86_64-pc-windows-msvc`; CI's generic `windows-latest` also exercises x64. No `aarch64-pc-windows-msvc` artifact or Windows-on-ARM job exists.
Windows problem: Native ARM64 support claimed by the deployment target is not delivered. x64 emulation availability/performance and low-level hook/firewall/WebView2 behavior are unverified.
Failure scenario: An ARM64 candidate receives an x64-only installer that fails, performs poorly, or loses a native proctoring control under emulation.
Fix direction: Produce/test a native ARM64 bundle or explicitly narrow support, including ARM64 WebView2, installer, signing, and low-level hook validation.
Effort: M (1-3d)
Confidence: high
Verification: Build `aarch64-pc-windows-msvc`, install on physical Windows 11 ARM64 and target Windows 10 ARM64 hardware, and run the full native-control matrix; separately test the x64 artifact under emulation.

### WIN-025 — Release build is not a reproducible Windows gate
Dimension: 13
Severity: P1
Evidence: package.json:31-35, .github/workflows/release.yml:36-43, .github/workflows/ci.yml:79-103, .github/workflows/release.yml:131-177
Current: The repository requires Node `>=22.6.0`, but release pins Node 20. PR CI compiles/tests Rust against an empty frontend and never builds an installer. The first real Windows bundle occurs after a release tag, and unmatched artifact paths do not fail release.
Windows problem: Toolchain incompatibility, static-export failure, missing resources, or installer-generation defects can first appear in a release job; draft upload can succeed with missing Windows files.
Failure scenario: A release tag is cut for an exam and Windows produces no valid installer, while CI was green.
Fix direction: Pin one supported toolchain/lockfile, build Windows bundles before release tags, fail on missing artifacts, and record checksums/SBOM/tool versions.
Effort: M (1-3d)
Confidence: high
Verification: On a clean Windows VM following only repository documentation, build twice from the same commit, compare outputs/metadata, and confirm CI fails when MSI/NSIS files or resources are absent.

### WIN-026 — Live observability cannot identify Windows startup/crash cohorts
Dimension: 14
Severity: P1
Evidence: apps/desktop/src-tauri/src/lib.rs:315-346, apps/desktop/src-tauri/src/lib.rs:419-485, apps/web/src/app/session/contest/client.tsx:1722-1734, apps/desktop/src-tauri/src/lib.rs:2283-2326
Current: Once a session exists, JSONL events upload every five seconds with backoff, and the webview sends a fire-and-forget heartbeat every 60 seconds. Crash reporting, minidumps, startup/install telemetry, release/version cohort health, and centralized client exceptions are ABSENT.
Windows problem: Candidates who cannot install, launch, create a session, or survive a native crash are invisible. Heartbeat failures are swallowed and have no local health state.
Failure scenario: Thirty Windows candidates fail before session creation, while operations sees no event stream and assumes they never attempted to join.
Fix direction: Add privacy-reviewed startup/readiness/crash telemetry, release/OS/arch dimensions, heartbeat acknowledgement/health, and a live cohort dashboard with alert thresholds.
Effort: L (>3d)
Confidence: high
Verification: Simulate installer failure, WebView2 failure, startup panic, native crash, offline heartbeat, and event backlog; confirm each appears with version/OS/arch in an operator dashboard.

### WIN-027 — Proctoring spool is not session-partitioned or power-loss durable
Dimension: 9
Severity: P1
Evidence: apps/desktop/src-tauri/src/lib.rs:197-241, apps/desktop/src-tauri/src/lib.rs:338-346, apps/desktop/src-tauri/src/lib.rs:436-478
Current: All sessions append to two shared JSONL files and one shared offset file. Writes use `writeln!` without `sync_all`; state writes replace JSON directly without atomic temp/rename. Windows-specific ACL hardening is ABSENT.
Windows problem: Power loss can lose the last records or corrupt sync state. An offline prior session's unsent events can later be uploaded under whichever session ID arms the global uploader, mixing candidate/session evidence.
Failure scenario: After a crash and later resume/new contest, old proctoring events are attributed to the wrong live session while the final pre-crash events are missing.
Fix direction: Partition an atomic durable outbox by server session/run, authenticate records, fsync critical boundaries, rotate/retain safely, and set explicit Windows ACLs.
Effort: L (>3d)
Confidence: high
Verification: Generate events across two sessions with the first offline, crash/power-cut during JSONL and sync-state writes, then inspect server attribution, duplicates, gaps, ACLs, and recovery.

### WIN-028 — Windows heuristics fail open on command/probe errors
Dimension: 5
Severity: P1
Evidence: packages/platform-rs/src/windows/mod.rs:267-307, packages/platform-rs/src/windows/mod.rs:315-357, packages/platform-rs/src/windows/mod.rs:659-697, packages/platform-rs/src/windows/mod.rs:865-889
Current: Failed `tasklist`, `reg`, `systeminfo`, `sc`, or `netstat` calls commonly return empty/false/clean. `systeminfo` and service-state parsing rely on English substrings. VM fallback timeout also returns high-confidence not detected.
Windows problem: Localized Windows builds, disabled utilities, AV-blocked child processes, slow WMI/systeminfo, or parser changes turn “could not inspect” into “clean.”
Failure scenario: On a non-English or slow laptop, process/RDP/VM checks silently pass because helper output could not be parsed before entry.
Fix direction: Use native APIs where possible and represent probe failure as indeterminate/fail-closed, with locale-independent structured results and telemetry.
Effort: L (>3d)
Confidence: high
Verification: Test supported Windows display languages, block/rename command utilities, delay `systeminfo`, deny process access, and assert readiness reports indeterminate rather than clean.

### WIN-029 — Network readiness can pass when the exam API is unreachable
Dimension: 10
Severity: P1
Evidence: apps/desktop/src-tauri/src/lib.rs:1122-1242, apps/desktop/src-tauri/src/lib.rs:1245-1262, packages/core-rs/src/exam/mod.rs:237-242
Current: DNS success alone is considered reachable even when every TCP probe fails. If the requested host fails, successful Google connectivity replaces the primary result. Network is advisory for all profiles.
Windows problem: Captive portals, firewall/proxy rules, DNS-only access, or an AMS outage can present a healthy readiness result despite inability to save/submit.
Failure scenario: A candidate passes the final network stage on Google reachability but loses all exam API traffic once the timed contest begins.
Fix direction: Probe the exact authenticated API/save path through the same transport and proxy as submissions; distinguish internet, DNS, API, and judge health and gate appropriately.
Effort: M (1-3d)
Confidence: high
Verification: Allow DNS/Google but block the AMS API/TCP 443, require a captive portal, and confirm strict readiness blocks with an actionable API-specific result.

### WIN-030 — The cxxprobe question contract is not wired to the Go control plane
Dimension: 6
Severity: P0
Evidence: apps/web/src/app/session/contest/client.tsx:130-137, apps/web/src/app/session/contest/client.tsx:1119-1251, ams-golang/internal/handler/org/contests.go:391-550, ams-golang/internal/handler/org/cp.go:48-121, ams-golang/internal/handler/public/contests.go:215-274, cxxprobe/docs/content/architecture/folder-structure.mdx:10-60, cxxprobe/include/cxxprobe/problem.hpp:21-65, cxxprobe/include/cxxprobe/judge.hpp:55-76
Current: cxxprobe is the intended source of questions and evaluation semantics, using a file-backed `problem.yaml`, statement, tests, symbolic checks, and GTest behavior checker. v0.8.1 adds `cxxprobe serve`, whose REST/SSE API returns the same canonical `JudgeReport` JSON as the CLI. The observed product path still authors and serves questions from Go/Postgres/GCS and judges them through Go worker or DMOJ formats. No importer/exporter, compatibility package, problem digest, engine version, or golden cross-repository test connects the models. Go also advertises Python 3/Java 17 and non-code question types that cxxprobe v0.8.1 does not define.
Windows problem: The candidate can be shown a Go-stored question whose tests, limits, checker, language, or version differ from the cxxprobe source of truth. cxxprobe-only symbolic/behavior requirements may be silently omitted, and a post-start edit can change the evaluated problem unless an immutable published snapshot is introduced.
Failure scenario: An organizer validates revision A in cxxprobe, Go serves revision B from its database, and a Windows candidate is rejected by a checker or limit that does not match the statement they saw.
Fix direction: Define one versioned, content-addressed cxxprobe problem-bundle schema; implement its import/publication and result adapter in Go; persist the bundle digest on contest publication, session question snapshot, and every attempt. For the first production integration, use the canonical CLI JSON path inside the existing durable Go worker; do not introduce cxxprobe's current in-memory queue/SQLite service as a second production control plane. Explicitly narrow the first release to cxxprobe-supported C++ or design a separate versioned adapter for other languages/question types.
Effort: L (>3d)
Confidence: high
Verification: For a golden bundle using manual, symbolic, and behavior checks, compare direct `cxxprobe --json` output with an end-to-end public API submission; assert identical question digest, limits, enabled checks, verdicts, and immutable behavior after the source bundle is edited.

### WIN-031 — cxxprobe alone is not an adversarial-code security boundary
Dimension: 11
Severity: P0
Evidence: cxxprobe/docs/content/architecture/sandbox-internals.mdx:81-95, cxxprobe/README.md:48-65, cxxprobe/src/sandbox/sandbox.cpp:244-350, cxxprobe/src/compile/compile.cpp:7-63
Current: cxxprobe provides strong per-run resource accounting and containment through user/mount namespaces, cgroup v2, RLIMIT_CPU, monotonic wall deadlines, PID limits, and output caps. Compilation runs through that same sandbox with larger limits. Its own documentation explicitly states that there is no seccomp filter, network namespace, or filesystem overlay and that the child shares the host filesystem and network subject to normal permissions. It is documented as resource/process isolation, not a boundary against a determined adversary.
Windows problem: Windows candidates submit untrusted source to this remote service. A malicious submission that reaches worker credentials, problem assets, the network, or neighboring jobs can compromise contest confidentiality, availability, and verdict integrity even though the candidate machine itself remains isolated.
Failure scenario: A submission reads worker-visible files or uses outbound networking to exfiltrate hidden tests/credentials, then tampers with or disrupts subsequent judging.
Fix direction: Run each cxxprobe invocation inside a disposable least-privilege container or microVM with no service-account credentials, disabled egress, read-only/minimal filesystem mounts, seccomp/capability restrictions, per-job identity, and teardown; retain cxxprobe cgroups as the inner resource-control layer.
Effort: L (>3d)
Confidence: high
Verification: Execute an adversarial suite covering filesystem discovery/write, metadata-service access, DNS/TCP/UDP egress, ptrace/process inspection, namespace escape attempts, fork/output/memory bombs, and cross-job residue; require denial and clean worker state after every run.

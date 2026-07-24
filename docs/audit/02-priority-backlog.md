# Windows priority backlog

## Executive assessment

**Recommendation: NO-SHIP for a live scored Windows contest on unmanaged candidate laptops.**

The three-repository system contains substantial Windows lockdown, Go control-plane, and Linux evaluation work, but the production path is not yet a coherent release unit. `ams-access` is the Windows/web client, `ams-golang` is the API/control plane, and `cxxprobe` is the intended question/evaluation authority. The observed Go path does not invoke cxxprobe: it separately stores questions and can judge through an in-process/nsjail worker or DMOJ bridge. That makes problem identity, verdict semantics, language support, and `runtime_ms` ambiguous. cxxprobe's resource controls are strong, but its own documented sandbox is not an adversarial-code security boundary without an outer hardened worker. These server-side blockers sit alongside the original Windows blockers: admin-only launch, unsigned artifacts, untested WebView2/AV behavior, unproven WebView2 firewall control, global cleanup races, non-restored local drafts, and destructive offline resume.

Verified strengths that should be retained:

- Windows code uses hidden child processes to avoid console flashes (`packages/platform-rs/src/windows/mod.rs:8-21`).
- Strict Windows policy does fail closed on missing/extra displays and requires camera, keyboard lockdown, and RDP-server checks (`packages/core-rs/src/exam/mod.rs:243-262`, `packages/core-rs/src/exam/mod.rs:725-799`).
- A native foreground/fullscreen state machine, virtual-desktop guard, clipboard observer, injected-input rejection, sleep prevention, and crash-start registry cleanup exist (`apps/desktop/src-tauri/src/lib.rs:1382-1463`, `packages/platform-rs/src/windows/mod.rs:1106-1182`, `packages/platform-rs/src/windows/mod.rs:1389-1629`).
- Frontend saves are serialized/coalesced and retry with backoff; native proctoring events have a durable spool and retry uploader (`apps/web/src/app/session/contest/client.tsx:1319-1415`, `apps/desktop/src-tauri/src/lib.rs:315-346`, `apps/desktop/src-tauri/src/lib.rs:419-485`).
- Release DevTools are intentionally not compiled, and untrusted problem markdown is sanitized (`apps/desktop/src-tauri/Cargo.toml:17-23`, `apps/web/src/app/session/contest/components/markdown.ts:51-108`).
- The Go API already has candidate/session guards, idempotency and queue-state machinery, persisted per-test results, and idempotent score recomputation that can remain the control plane around a new cxxprobe adapter (`ams-golang/internal/handler/public/sessions.go:317-519`, `ams-golang/internal/worker/runner.go:1181-1207`, `ams-golang/internal/scoring/scoring.go:18-99`).
- cxxprobe already exposes a structured problem model, JSON result contract, cgroup CPU accounting, monotonic wall timing, and deterministic verdict precedence; these are the right primitives to promote to the authoritative evaluation contract (`cxxprobe/include/cxxprobe/problem.hpp:21-93`, `cxxprobe/cli/common/json_io.cpp:74-125`, `cxxprobe/src/sandbox/sandbox.cpp:275-346`, `cxxprobe/src/cases/cases.cpp:269-283`).

Those controls do not offset the P0 deployment, data-loss, timing, and enforcement gaps below.

## Top 10 by risk

1. **WIN-030 — cxxprobe is not wired to the Go question/judge path.** The system cannot prove that the displayed question and evaluated bundle are identical.
2. **WIN-010 — Three runtime authorities produce incompatible timing semantics.** A runtime-ranked contest cannot ship until one pinned cxxprobe metric is authoritative and auditable.
3. **WIN-031 — cxxprobe needs an outer adversarial sandbox.** Resource containment alone does not prevent filesystem/network access from hostile submissions.
4. **WIN-012 — Local answer buffer is never restored.** A network failure/crash can strand the candidate’s final work while the UI says it is safe locally.
5. **WIN-001 — Admin-only install and launch.** The stated unmanaged/no-admin population contains machines that can never enter.
6. **WIN-002 + WIN-006 — Unsigned, malware-like behavior.** SmartScreen/UAC distrust and Defender/EDR quarantine can block a large cohort simultaneously.
7. **WIN-014 + WIN-015 — Windows network lockdown is unproven and brittle.** WebView2 process ownership, proxies, and address rotation can either bypass lockdown or block submissions.
8. **WIN-007 — Keyboard hook false-positive success.** Mandatory readiness can attest a hook before Windows installs it.
9. **WIN-011 + WIN-013 — Client time/resume state is unsafe.** Clock jumps or a transient offline restart can prematurely submit or destroy recovery state.
10. **WIN-018 + WIN-019 — Global firewall lifecycle races.** A second instance or startup cleanup can silently remove live lockdown.

## Prioritized findings

### P0 — live-exam/session loss or integrity

| Rank | ID | Backlog outcome |
|---:|---|---|
| 1 | WIN-030 | Make a versioned, content-addressed cxxprobe bundle the single question/evaluation contract and integrate it through Go. |
| 2 | WIN-010 | Select one cxxprobe CPU/wall metric, pin the engine/image, persist raw timing provenance, and certify reproducibility. |
| 3 | WIN-031 | Put cxxprobe inside a disposable, credential-free, no-egress adversarial execution boundary. |
| 4 | WIN-012 | Restore and durably upload local drafts; make final-submit state truthful. |
| 5 | WIN-001 | Deliver a supported unmanaged/no-admin install and runtime design. |
| 6 | WIN-002 | Authenticode-sign and timestamp all Windows artifacts. |
| 7 | WIN-006 | Pass signed release candidates through Defender/AV/EDR qualification. |
| 8 | WIN-014 | Prove or redesign WebView2/firewall egress enforcement. |
| 9 | WIN-015 | Support proxies and dynamic destination changes without self-denial. |
| 10 | WIN-007 | Add synchronous keyboard-hook installation/liveness attestation. |
| 11 | WIN-011 | Replace mutable `Date.now()` expiry authority with server/monotonic anchoring. |
| 12 | WIN-013 | Preserve offline resume state and distinguish unavailable from invalid. |
| 13 | WIN-018 | Enforce single instance and owner-scoped OS mutations. |
| 14 | WIN-019 | Serialize startup cleanup before accepting a new lockdown. |
| 15 | WIN-008 | Gate and continuously verify capture protection. |
| 16 | WIN-004 | Make WebView2 installation deterministic under offline/proxy failure. |

### P1 — external production blocker

| Rank | ID | Backlog outcome |
|---:|---|---|
| 17 | WIN-027 | Partition and atomically persist the proctoring outbox by session. |
| 18 | WIN-026 | Add startup/crash/cohort observability before the first session exists. |
| 19 | WIN-009 | Publish/test the real Windows threat model, including unpreventable escapes and virtual cameras. |
| 20 | WIN-020 | Make registry/firewall cleanup crash/power-loss resilient. |
| 21 | WIN-025 | Align toolchains and build/test Windows installers before tags. |
| 22 | WIN-024 | Build/test native ARM64 or remove it from support claims. |
| 23 | WIN-029 | Probe the actual authenticated exam API path and gate it appropriately. |
| 24 | WIN-016 | Unify TLS/proxy behavior across Rust and WebView2 traffic. |
| 25 | WIN-021 | Protect local JWT/device/draft/face data with OS-backed controls. |
| 26 | WIN-022 | Reduce global IPC and command authority. |
| 27 | WIN-028 | Replace fail-open localized command parsing with native/indeterminate probes. |
| 28 | WIN-017 | Preserve registry settings and make paths Unicode-safe. |
| 29 | WIN-023 | Qualify DPI, small-screen, high-contrast, and keyboard UX. |
| 30 | WIN-005 | Add staged signed updates, exam freeze, and rollback. |
| 31 | WIN-003 | Select one installer and specify/test upgrade/uninstall semantics. |

### P2

No standalone P2 findings were retained. In this deployment, apparent polish/maintainability issues (for example, real-hardware layout and misleading platform presentation) can block a timed exam and are therefore included within P1 validation.

## Cross-repository implementation plan

This order is intentional: client work must not race ahead of an unsettled question/result contract, and Go integration must not treat cxxprobe's inner resource sandbox as the complete hostile-code boundary.

| Phase | Primary repository | Outcome and exit gate |
|---:|---|---|
| 0. Freeze authority | `cxxprobe` + product decision | Declare cxxprobe the source of truth for coding questions/evaluation. Decide whether the first production contract is C++-only; do not silently map Python/Java or Go-only question types into cxxprobe. Exit when the supported problem/language matrix and the authoritative timing metric are written and approved. |
| 1. Version the problem contract | `cxxprobe` | Publish a versioned, machine-validated bundle manifest covering statement, compiler standard/flags, limits, tests/answers, checker, symbolic rules, behavior tests, and content hashes. Stabilize/version the JSON result schema. Exit when golden bundles have canonical digests and backward-compatibility fixtures. |
| 2. Build the control-plane adapter | `ams-golang` | Import/publish cxxprobe bundles without independently redefining them; store immutable bundle/version/digest references; materialize the exact bundle for a job; invoke the pinned cxxprobe CLI inside the existing durable worker; map canonical JSON to attempts/test results; persist engine/image/problem digests and raw CPU/wall/memory values. Do not make v0.8.1 `cxxprobe serve` a second production queue/database until its auth, idempotency, recovery, and provenance gaps close. Exit when Pub/Sub redelivery is idempotent and direct CLI versus public API golden tests are identical. |
| 3. Harden and qualify execution | `ams-golang` deployment + `cxxprobe` | Place each cxxprobe run in a disposable credential-free, no-egress, minimal/read-only filesystem boundary with seccomp/capability controls. Pin every base/toolchain dependency, calibrate homogeneous workers, define retry/variance policy, and make DMOJ/legacy Go judging unavailable for scored cxxprobe contests. Exit after breakout, resource-abuse, cross-job-residue, and repeated-runtime tests pass. |
| 4. Expose immutable API semantics | `ams-golang` then `ams-access` | Candidate question responses and submission results carry the published problem digest and compatible schema version; sessions snapshot the published revision; the UI displays only supported languages and labels CPU/wall timing truthfully. Exit when an edit after contest publication cannot change an active session and incompatible clients fail before lockdown. |
| 5. Close candidate durability and Windows P0s | `ams-access` | Restore local drafts, make save/final-submit acknowledgement truthful, preserve offline resume, then close signing/install/WebView2/AV/hook/capture/network/single-instance gates. Exit with the signed exact Windows release passing the clean-machine and fault-injection matrix. |
| 6. Bind one releasable system | all three | Produce a release manifest containing Windows artifact hash/signature, web commit, Go API/worker image digests, cxxprobe version/binary hash, problem-bundle digests, migrations, and supported OS/architecture/language matrix. Exit only after a staging contest exercises those exact artifacts end to end. |

The implementation-grade design, contracts, platform matrix, rollout, and exit gates are in `docs/audit/03-cxxprobe-integration-plan.md`.

### Required contract tests

1. **Problem identity:** the digest returned to the Windows client equals the digest stored on the session and attempt and the digest materialized for cxxprobe.
2. **Semantic parity:** a golden manual/symbolic/behavior problem produces the same enabled checks, verdicts, timings, memory, and diagnostics via direct cxxprobe JSON and the public Go API.
3. **Immutability:** editing/re-publishing source after contest start creates a new digest and cannot change existing sessions or queued attempts.
4. **Delivery semantics:** duplicate Pub/Sub delivery, worker death, timeout, and retry cannot double-score, switch engine versions, or overwrite a terminal attempt.
5. **Isolation:** a submission cannot access network, metadata services, service credentials, hidden assets beyond its mounted problem, host processes, or residue from another job.
6. **Client compatibility:** an old Windows client or unsupported language receives an explicit pre-session incompatibility error, not a mid-exam judge failure.

## Dimension coverage

| Dimension | Current conclusion | Findings |
|---|---|---|
| 1. Install/distribution | Both MSI/NSIS exist; NSIS and app require admin; WebView2 behavior is implicit; upgrade/uninstall untested. | WIN-001, WIN-003, WIN-004 |
| 2. Signing/trust | Authenticode is ABSENT; cold SmartScreen/UAC trust is unacceptable. | WIN-002 |
| 3. Updates | In-app updater/rollback is ABSENT; manual reinstall only. | WIN-005 |
| 4. Antivirus/EDR | High-risk behavior exists; qualification/mitigation is ABSENT. | WIN-006 |
| 5. Windows proctoring | Many controls implemented, but hook/capture success and fail-open heuristics undermine claims; virtual-camera/unblockable gaps remain. | WIN-007, WIN-008, WIN-009, WIN-028 |
| 6. Timing | Client expiry uses mutable wall time. Server source now shows three incompatible timing authorities; cxxprobe has suitable monotonic/cgroup primitives but is not integrated or selected as production authority. | WIN-010, WIN-011, WIN-030 |
| 7. Filesystem/paths | Tauri app-data is used for logs, but registry state, Unicode firewall path, temp face files, and protected fallback are unsafe. | WIN-017, WIN-021 |
| 8. Process/lifecycle | Console flashes are suppressed and normal destroy cleans up; single instance and crash-safe ownership are absent/racy. | WIN-018, WIN-019, WIN-020 |
| 9. Crash/resume/durability | Server resume and local buffering exist, but destructive offline validation, no draft reader, and shared non-atomic spool make them unsafe. | WIN-012, WIN-013, WIN-020, WIN-027 |
| 10. Networking | Retries/timeouts exist, but readiness, proxy/TLS, IP snapshot, and firewall process ownership are not production-safe. | WIN-014, WIN-015, WIN-016, WIN-029 |
| 11. Local/security boundary | Release DevTools are omitted and markdown sanitized; global IPC and plaintext client state remain. Remotely, cxxprobe resource isolation needs an outer adversarial execution boundary. | WIN-021, WIN-022, WIN-031 |
| 12. Real hardware UI | Responsive fragments exist; DPI/forced-colors/small-screen behavior is unverified. | WIN-023 |
| 13. Build reproducibility | Tagged x64 artifact is scripted, but toolchains conflict, PRs do not bundle, and ARM64 is absent. | WIN-024, WIN-025 |
| 14. Observability | Session event spool/heartbeat exists; pre-session and crash cohort visibility is absent. | WIN-026, WIN-027 |

## Ship gate

Minimum IDs that must close before **any** live scored Windows contest:

`WIN-001, WIN-002, WIN-004, WIN-006, WIN-007, WIN-008, WIN-010, WIN-011, WIN-012, WIN-013, WIN-014, WIN-015, WIN-018, WIN-019, WIN-026, WIN-027, WIN-030, WIN-031`

Additionally:

- Close `WIN-024` before admitting Windows ARM64 candidates.
- Close `WIN-009` before marketing the client as preventative/kiosk-grade proctoring.
- Close `WIN-003`, `WIN-020`, and `WIN-025` before external paid production rollout, even if a tightly supervised pilot accepts manual operational workarounds.
- Do not enable non-C++ languages for a cxxprobe-authoritative contest until a versioned evaluation contract and equivalent isolation/verdict test suite exist for them.

## Cannot determine

These are blocked by missing deployed systems or real Windows execution. The exact verification step is also present on each finding.

1. **Deployed evaluation authority and fairness:** source is available, but the production binding is not. Obtain the live API/worker/judge image digests and configuration, determine whether Go worker, DMOJ, or cxxprobe produced each attempt, and run calibrated repeated workloads (`WIN-010`).
2. **Production problem lineage:** no inspected deployment manifest proves that organizer source, Go-stored question/testset, candidate payload, and executed bundle are byte-identical. Capture and compare content digests across the live path (`WIN-030`).
3. **Outer judge isolation:** cxxprobe documents the limits of its inner sandbox, but the production worker's surrounding identity, egress, mounts, metadata access, and teardown are unknown. Inspect the deployed workload and run the adversarial suite (`WIN-031`).
4. **SmartScreen/UAC reputation:** cannot be inferred from config. Download the exact release on clean, reputation-free Windows VMs and record UI; run `Get-AuthenticodeSignature` and `signtool verify /pa /all` (`WIN-002`).
5. **Defender/third-party AV outcome:** heuristic results depend on the exact signed bytes and current definitions. Scan and execute the release through every lockdown path (`WIN-006`).
6. **WebView2 bootstrap default/outcome:** config omits the mode. Remove WebView2, use offline/authenticated-proxy VMs, and exercise both installers (`WIN-004`).
7. **Windows Firewall rule precedence and owning process:** prove with firewall logging, `Get-NetTCPConnection`, and allowed/disallowed WebView2 fetches (`WIN-014`).
8. **Proxy, MITM, captive portal, DNS rotation:** requires controlled Windows network infrastructure and a staging API (`WIN-015`, `WIN-016`, `WIN-029`).
9. **Hook, capture, clipboard, VM/RDP, monitor-hotplug coverage:** the actual Win32 observer layer is not integration-tested. Run the adversarial matrix on Win10/Win11 x64 and ARM64 (`WIN-007`, `WIN-008`, `WIN-009`, `WIN-028`).
10. **Crash/power-loss OS state:** force kill/reboot/power cut during every registry/firewall transition and inspect recovery (`WIN-019`, `WIN-020`, `WIN-027`).
11. **Per-monitor DPI and accessibility:** test physical mixed-DPI monitors, 1366×768 laptops, forced colors, text scaling, and keyboard-only traversal (`WIN-023`).
12. **Installer upgrade/uninstall:** build two signed versions and execute same-format/cross-format upgrade, downgrade, repair, and uninstall on clean VMs (`WIN-003`).
13. **ARM64 compatibility:** no artifact/hardware run exists. Build native ARM64 and separately test x64 emulation on target devices (`WIN-024`).
14. **Deployed server guarantees:** source contains session guards, submission idempotency, resume flows, event handling, and score recomputation, but the live migration/config/version and fault behavior are not proven. Verify them against staging and production-like dependencies (`WIN-011`, `WIN-012`, `WIN-013`, `WIN-027`, `WIN-030`).

## Cross-repository release verification

Before the Windows hardware checklist, verify the server-side release candidate:

1. Record the `ams-access` commit, `ams-golang` API/worker image digests, cxxprobe version/binary SHA-256, database migration level, and every published problem-bundle digest.
2. Import and publish a golden cxxprobe bundle with manual, symbolic, and behavior checks; reject any unsupported schema or language before a contest can be scheduled.
3. Submit through the same HTTPS API used by the Windows client and assert direct-cxxprobe/API parity for problem digest, verdict, per-case CPU/wall/memory, enabled checks, diagnostics, and final score.
4. Redeliver the queue message, kill the worker during compile/test/final write, and retry on another worker; assert one terminal score and unchanged engine/problem digests.
5. Run the hostile-code isolation suite with worker credentials/metadata/network/test assets instrumented; assert no access, no egress, and no cross-job residue.
6. Run calibrated workloads across every worker class under idle and controlled contention; publish the allowed variance and disable runtime ranking if it is exceeded.

## Windows execution checklist

Run against the exact release candidate, not a debug build:

1. `pnpm install --frozen-lockfile`
2. `pnpm --filter @ams/desktop build`
3. Confirm both expected bundle paths exist under `target/<target>/release/bundle/{msi,nsis}` and record SHA-256 hashes.
4. `Get-AuthenticodeSignature <msi-or-exe> | Format-List *`
5. `signtool verify /pa /all /v <msi-or-exe>`
6. Install/launch as a standard user on clean Win10 22H2 and Win11 x64/ARM64, with WebView2 present, absent, outdated, offline, captive-portal, and authenticated-proxy states.
7. During lock, record `Get-NetFirewallRule -DisplayName 'AMS_PROCTOR*'`, `Get-NetTCPConnection`, Windows Firewall logs, owning PIDs, registry before/after, and disallowed/allowed reachability.
8. Exercise Alt+Tab, all Win-key combinations, CAD, Win+L, Task Manager, mouse switching, virtual desktops, sleep/hibernate, monitor hotplug/Miracast, OBS/Teams/Zoom/RDP, virtual cameras, clipboard, PrintScreen, and higher-integrity capture.
9. Run two app instances and close/kill them in both orders; repeat while delaying `netsh`.
10. Type unique unsaved content, disconnect, crash/power-cycle, relaunch offline, reconnect, resume, and verify byte-identical recovery plus final server state.
11. Change system time ±10 minutes, enable/disable automatic time, sleep/resume, and compare client countdown with server acceptance.
12. Repeat UI flow at 100/125/150/200% DPI, 1366×768 and 4K, mixed-DPI moves, high contrast, 200% text, and keyboard-only navigation.

## Open questions

Only answers that materially change priority are listed.

1. **Which judge path is live today: Go worker, DMOJ bridge, or an uninspected cxxprobe deployment?** This determines the immediate migration and rollback plan, but none is acceptable for runtime scoring without version/timing provenance (`WIN-010`).
2. **Is the first cxxprobe-authoritative release intentionally C++-only?** If not, define which engine owns Python/Java and how its problem/result/isolation contract remains version-compatible; do not infer parity (`WIN-030`).
3. **Does cxxprobe own only executable coding questions, or must follow-up/Markov/output-only/interactive types also be represented in its bundle?** This decides whether Go retains a separate explicitly versioned non-cxxprobe question domain (`WIN-030`).
4. **Where are production cxxprobe problem bundles stored, reviewed, signed/published, and retained?** The inspected engine checkout has no identifiable production contest bundle, so lineage cannot be closed by repository commit alone (`WIN-030`).
5. **What is the supported outer isolation platform for cxxprobe workers?** Container, gVisor, or microVM choice changes performance calibration and credential/network controls (`WIN-031`).
6. **Is “no admin rights guaranteed” non-negotiable?** If yes, WIN-001 requires architecture change; if every candidate can preflight admin credentials days early, it becomes an operational but still serious risk.
7. **Which Windows installer is the supported product, and what versions are already installed?** This determines upgrade/uninstall migration scope for WIN-003.
8. **Is a production Authenticode certificate available, and what is its reputation/issuance model?** This determines whether WIN-002 is a one-day pipeline task or a longer procurement/reputation program.
9. **Must authenticated corporate proxies/TLS inspection be supported or explicitly rejected at preflight?** The answer changes the design, not merely severity, of WIN-015/WIN-016.
10. **Which physical Windows 10/11 ARM64 devices are in the promised support set?** This determines whether x64 emulation can ever satisfy WIN-024 or a native artifact is mandatory.
11. **What is the accepted Windows proctoring threat model after Ctrl+Alt+Del/Win+L or app termination?** Without a defined server/proctor response, WIN-009 cannot be closed by client hooks alone.

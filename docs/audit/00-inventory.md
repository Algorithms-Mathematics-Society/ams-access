# Windows production-readiness inventory

Audit date: 2026-07-23
Scope: the Windows client and its server-side question/evaluation dependencies across three repositories, with production code treated as read-only:

- `/home/user/AccessSoftware/ams-access` — website and Tauri desktop/Windows client.
- `/home/user/AccessGolang/ams-golang` — Go API, persistence, queues, orchestration, and current judge adapters/workers.
- `/home/user/amsprobe/cxxprobe` — intended authoritative problem format and evaluation engine.

Repository snapshots inspected: `ams-access` local `main` at `3769026`, `ams-golang` feature branch at `e720c40`, and `cxxprobe` `main`/v0.8.1 at `3fe00c4` after a clean fast-forward pull on 2026-07-24. The adjacent `/home/user/AccessGolang/ams-golang-wt-min-instances` checkout is a separate worktree and was not treated as the primary source.
Host limitation: this audit was performed on Linux, not Windows.

## Evidence classification

- **Verified** means the behavior is directly present in one of the inspected repositories and is cited with a repository-qualified `path:line`.
- **Framework default** means the repository omits an option and behavior is expected from the locked Tauri version. It is not treated as verified until the resulting installer is exercised.
- **Windows verification required** means the relevant Win32 path could not be executed on this host.
- **ABSENT** means a search of the repository that owns the relevant responsibility found no implementation. The nearest controlling configuration or registration surface is cited.
- **Intended authority** records the architecture stated for the product. It is not considered deployed or integrated unless the call path is present in source and can be tied to a release artifact.

## Sampling strategy

I read all Windows-specific native code and the desktop release workflows, then sampled the frontend around session launch, lockdown, save/submit, crash/resume, countdown, networking, proctoring, and local storage. For the server path, I traced public and organizer question routes, submission creation, Pub/Sub dispatch, both Go judging paths, result persistence, and scoring. For `cxxprobe`, I read the problem schema, CLI/JSON contract, judge aggregation, sandbox timing/resource enforcement, security-boundary documentation, tests, and Linux release workflow. I did not review visual-only components or unrelated Go organization/email/chess features line by line. Depth remains concentrated on dimensions 4, 5, 6, and 9, with the server-side dependencies included where they determine the Windows candidate's outcome.

## Repository ownership and top-level layout

### System-of-record map

| Repository | Intended ownership | Observed implementation |
|---|---|---|
| `ams-access` | Candidate/organizer website and Windows desktop shell; it should display questions and results but not define judge semantics. | The contest UI fetches `/contests/{id}/questions`, posts source to `/sessions/{id}/submissions`, polls attempts/test results, and renders returned `runtime_ms` (`apps/web/src/app/session/contest/client.tsx:130-137`, `apps/web/src/app/session/contest/client.tsx:1119-1251`, `apps/web/src/app/session/contest/client.tsx:1404-1454`). |
| `ams-golang` | Control plane between clients and `cxxprobe`: authentication, contest/session state, immutable problem publication, queues, result persistence, scoring, and operations. | It currently owns database-backed question CRUD and testsets, exposes candidate submission APIs, and contains two judging implementations: an in-process worker/nsjail path and a DMOJ bridge (`ams-golang/cmd/api/main.go:145-195`, `ams-golang/cmd/api/main.go:204-241`, `ams-golang/internal/handler/org/contests.go:391-550`, `ams-golang/internal/worker/runner.go:841-1207`, `ams-golang/internal/bridge/dispatcher.go:118-280`, `ams-golang/Dockerfile.judge:1-38`). |
| `cxxprobe` | Authoritative coding-question bundle and evaluation semantics. | It defines `problem.yaml` plus statement/solution/checker/test files, manual/symbolic/GTest behavior checks, canonical JSON reports, Linux cgroup-v2 execution, and—since v0.8.x—a queued REST/SSE judging service over the same judge pipeline (`cxxprobe/docs/content/architecture/folder-structure.mdx:10-60`, `cxxprobe/include/cxxprobe/problem.hpp:21-65`, `cxxprobe/src/judge/judge_json.cpp:58-108`, `cxxprobe/docs/content/architecture/http-service.mdx:8-27`). |

The intended boundary is:

```text
cxxprobe problem bundle
        │ publish/version
        ▼
ams-golang API + immutable problem metadata + queue
        │ HTTPS questions/submissions/results
        ▼
ams-access web UI inside the Windows Tauri shell

Submission execution (intended): ams-golang worker/adapter ──► pinned cxxprobe engine
Submission execution (observed): ams-golang worker/nsjail OR Go bridge ──► DMOJ judge
```

No `cxxprobe` reference exists in the inspected `ams-golang` source, Dockerfiles, or module manifest. Therefore `cxxprobe` is recorded as the intended authority but is not yet on the verified request path. The inspected cxxprobe checkout contains the engine, scaffolding, HTTP service, and example-oriented documentation but no identifiable production AMS contest bundle, so the storage/publication location of real question bundles also remains unverified. The Go schema allows question types and languages outside cxxprobe's current contract: Go defaults contests to C++17, Python 3, and Java 17, while cxxprobe v0.8.1 accepts C++ submissions and defaults to C++23 on Linux (`ams-golang/internal/handler/org/contests.go:141-143`, `ams-golang/internal/handler/org/contests.go:393-459`, `cxxprobe/docs/content/architecture/http-service.mdx:149-159`, `cxxprobe/include/cxxprobe/problem.hpp:67-73`).

### `ams-access` layout

| Path | Ownership |
|---|---|
| `apps/desktop/` | Tauri desktop package. `package.json` exposes `tauri dev` and `tauri build`; `src-tauri/` owns native commands, bundling, icons, capabilities, and platform startup (`apps/desktop/package.json:1-18`, `apps/desktop/src-tauri/src/lib.rs:2190-2463`). |
| `apps/web/` | Next.js static-export candidate UI, including login, home/resume, onboarding, live contest, results, browser media, autosave, and API calls (`apps/web/next.config.mjs:1-11`, `apps/web/package.json:5-15`). |
| `packages/platform-rs/` | OS-specific lockdown implementation. Windows owns keyboard hooks, process scan/kill, registry, display/RDP/VM checks, capture affinity, clipboard monitoring, firewall commands, foreground observation, and DLL hardening (`packages/platform-rs/src/lib.rs:1-10`, `packages/platform-rs/src/windows/mod.rs:1-21`). |
| `packages/core-rs/` | Platform-neutral readiness policy and state machine (`packages/core-rs/src/exam/mod.rs:96-179`, `packages/core-rs/src/exam/mod.rs:409-486`). |
| `packages/network-helper/` | Privileged Unix helper; Windows builds a stub and Windows lockdown stays in the main process (`packages/network-helper/src/main.rs:10-22`, `apps/desktop/src-tauri/scripts/prepare-network-helper.mjs:19-37`). |
| `packages/api-client/` | Shared TypeScript readiness types, policy helpers, and organizer overrides (`packages/api-client/src/index.ts:39-78`, `packages/api-client/src/index.ts:176-242`). |
| `packages/shared-ui/` | Shared React UI primitives (`packages/shared-ui/package.json:1-16`). |
| `.github/workflows/` | CI and tagged release automation (`.github/workflows/ci.yml:23-126`, `.github/workflows/release.yml:1-177`). |
| `docs/`, `markdowns/`, `image/`, root HTML/PNG files | Design/reference/audit material, not runtime ownership. `docs/` is ignored by Git in this checkout (`.gitignore:53-56`). |

The Go backend and evaluation engine correctly remain outside the Cargo/pnpm workspaces: the Rust workspace contains the desktop and Rust packages (`Cargo.toml:1-8`), while the pnpm workspace contains `apps/*` and `packages/*` (`pnpm-workspace.yaml:1-3`). The separation is architectural, not missing source; end-to-end conclusions must use all three repositories.

## Tauri and bundle configuration

- **Major/version:** Tauri 2 is declared (`apps/desktop/src-tauri/Cargo.toml:17-24`); `Cargo.lock` resolves `tauri` 2.11.2 (`Cargo.lock:3524-3528`). The JS CLI resolves 2.11.1 (`pnpm-lock.yaml:621`).
- **Config:** `apps/desktop/src-tauri/tauri.conf.json`; generated platform schemas are ignored build output (`.gitignore:17-19`).
- **Window:** one `main` window, initial 1280×800, resizable, decorated, not initially fullscreen or topmost (`apps/desktop/src-tauri/tauri.conf.json:12-25`). Live lockdown sets fullscreen and always-on-top (`apps/desktop/src-tauri/src/lib.rs:1373-1380`).
- **Capabilities:** one local capability for `main`; it grants core defaults plus fullscreen/topmost/resizing/decorations, monitor enumeration, focus, minimize, title, hide, and show (`apps/desktop/src-tauri/capabilities/main.json:1-23`).
- **IPC exposure:** global Tauri injection is enabled (`apps/desktop/src-tauri/tauri.conf.json:12-14`), and 38 application commands are registered (`apps/desktop/src-tauri/src/lib.rs:2283-2322`).
- **CSP:** production permits self scripts plus `unsafe-inline` and `wasm-unsafe-eval`; connections are limited to self and `https://*.run.app`; objects are denied and framing is denied (`apps/desktop/src-tauri/tauri.conf.json:27-30`).
- **DevTools:** the release `devtools` Cargo feature is deliberately absent; debug builds still have DevTools (`apps/desktop/src-tauri/Cargo.toml:17-23`). No explicit context-menu suppression was found.
- **Updater:** ABSENT. There is no updater dependency/plugin/command among the desktop dependencies and builder registrations (`apps/desktop/src-tauri/Cargo.toml:17-48`, `apps/desktop/src-tauri/src/lib.rs:2283-2322`). `.sig` files may be collected during release, but no client consumes them (`.github/workflows/release.yml:145-165`).
- **Bundle targets:** `deb`, `rpm`, `appimage`, `dmg`, `msi`, and `nsis` are globally listed; Windows has both MSI and NSIS output (`apps/desktop/src-tauri/tauri.conf.json:32-41`).
- **Install mode:** NSIS is `perMachine` (`apps/desktop/src-tauri/tauri.conf.json:39-41`).
- **Elevation:** the Windows application manifest is `requireAdministrator` (`apps/desktop/src-tauri/build.rs:25-31`); startup also attempts a `runas` relaunch (`apps/desktop/src-tauri/src/lib.rs:2241-2267`).
- **Code signing:** `certificateThumbprint` is null (`apps/desktop/src-tauri/tauri.conf.json:35-38`), and the release job supplies Apple/Tauri updater keys but no Windows certificate or signtool step (`.github/workflows/release.yml:131-143`).
- **WebView2:** no `webviewInstallMode` is configured in the Windows bundle block (`apps/desktop/src-tauri/tauri.conf.json:35-41`). **Framework-default inference:** locked Tauri 2 is expected to use its silent download bootstrapper. This must be verified from the produced MSI/NSIS; it is not guaranteed by repository configuration.

## Build and release pipeline

### Developer commands

- Root `pnpm build` runs Turbo builds (`package.json:4-10`).
- Desktop `pnpm --filter @ams/desktop build` runs `tauri build` (`apps/desktop/package.json:5-11`).
- Tauri's `beforeBuildCommand` first builds/stages the network helper, then builds the Next static export (`apps/desktop/src-tauri/tauri.conf.json:6-10`).
- The helper script builds the current-host helper and copies it into bundle resources; Windows gets a stub (`apps/desktop/src-tauri/scripts/prepare-network-helper.mjs:19-50`).
- The frontend `prebuild` stages local TFJS/BlazeFace/MediaPipe assets, then `next build` creates the static export (`apps/web/package.json:5-15`, `apps/web/next.config.mjs:1-11`).

No clean-machine Windows build/runbook is present. The commands exist, but required toolchain/bootstrap knowledge is embodied in CI rather than documentation.

### CI

- Pull requests and `main` pushes run Rust on Ubuntu, Windows, and macOS (`.github/workflows/ci.yml:11-35`).
- Windows CI creates an empty frontend directory, builds/stages the helper, runs Clippy for the workspace, and runs `cargo test --workspace` (`.github/workflows/ci.yml:79-103`).
- The Windows CI job does **not** build MSI/NSIS installers or launch the app.
- Web tests run only on Ubuntu with Node 24 (`.github/workflows/ci.yml:104-126`).

### Tagged release

- A `v*` tag triggers x64 Windows (`x86_64-pc-windows-msvc`) plus Linux and macOS builds; there is no Windows ARM64 target (`.github/workflows/release.yml:3-28`).
- Release installs pnpm and Node 20, despite the root package requiring Node `>=22.6.0` (`.github/workflows/release.yml:36-43`, `package.json:31-35`).
- It installs dependencies, builds the web export with `NEXT_PUBLIC_API_URL`, checks size budgets, builds/stages the helper, and runs `pnpm tauri build --target ...` (`.github/workflows/release.yml:83-100`, `.github/workflows/release.yml:123-143`).
- It gathers MSI and NSIS artifacts plus Tauri `.sig` sidecars and uploads them to a draft GitHub release (`.github/workflows/release.yml:145-177`).
- No Windows Authenticode signing, signature verification, installer smoke test, clean-VM launch, upgrade test, uninstall test, SmartScreen test, or Defender scan exists in the workflow.

### Server and evaluation release path

- `ams-golang` publishes separate API, worker, bridge, and judge images. The in-process worker image builds nsjail from the moving upstream default branch, while the DMOJ image downloads a configurable tag whose default is `master`; neither image references a pinned `cxxprobe` artifact (`ams-golang/Dockerfile.worker:1-39`, `ams-golang/Dockerfile.judge:1-38`).
- The Go API persists question content/configuration in Postgres and test assets in GCS, then publishes submission attempts for asynchronous judging (`ams-golang/internal/handler/org/contests.go:391-550`, `ams-golang/internal/handler/org/cp.go:48-121`, `ams-golang/internal/db/migrations/007_cp_judge_runtime.sql:25-123`, `ams-golang/internal/handler/public/sessions.go:317-519`).
- `cxxprobe` v0.8.1 releases one x86_64 Linux CLI and checksum and tests Debug/Release builds on Ubuntu with GCC/Clang. The binary now includes the optional `serve` command by default, but it is still not consumed by either Go Dockerfile or a cross-repository compatibility gate (`cxxprobe/CMakeLists.txt:3-18`, `cxxprobe/.github/workflows/ci.yml:1-38`, `cxxprobe/.github/workflows/release-assets.yml:39-59`).
- There is no build manifest tying a Windows release, Go API/worker image digest, `cxxprobe` engine version, and immutable problem-bundle digest into one contest release.

## Native/OS behavior touchpoints

### Process creation and termination

- Hidden Windows console helpers wrap `tasklist`, `reg`, `systeminfo`, `sc`, `netstat`, `netsh`, and `taskkill` using `CREATE_NO_WINDOW` (`packages/platform-rs/src/windows/mod.rs:8-21`).
- Restricted processes are enumerated by parsing `tasklist` CSV and killed by PID/name/tree (`packages/platform-rs/src/windows/mod.rs:267-307`, `packages/platform-rs/src/windows/mod.rs:1352-1378`).
- A one-second kill shield repeatedly terminates restricted processes during lockdown (`packages/platform-rs/src/windows/mod.rs:542-568`).
- `explorer.exe` opens privacy settings, and `ShellExecuteW(..., "runas")` relaunches elevated (`packages/platform-rs/src/windows/mod.rs:197-251`).

### Filesystem and paths

- Proctoring JSONL and sync state use Tauri `app_data_dir()/proctoring`, falling back to `%TEMP%` through Rust's temp directory (`apps/desktop/src-tauri/src/lib.rs:197-241`, `apps/desktop/src-tauri/src/lib.rs:436-478`).
- Face PNGs use `%TEMP%\ams_faces`, with a fallback to `C:\Windows\Temp`, and are never deleted in the reviewed code (`apps/desktop/src-tauri/src/lib.rs:2128-2151`).
- Firewall rules stringify `current_exe()` with `to_string_lossy()` (`packages/platform-rs/src/windows/mod.rs:1239-1249`).

### Window, input, display, capture, and clipboard

- Fullscreen/topmost is applied at lock and reverted at unlock (`apps/desktop/src-tauri/src/lib.rs:1373-1380`, `apps/desktop/src-tauri/src/lib.rs:1475-1486`).
- A `WH_KEYBOARD_LL` hook blocks Win keys, PrintScreen, Alt+Tab/F4, Ctrl+Esc, Ctrl+Shift+Esc, and injected keystrokes (`packages/platform-rs/src/windows/mod.rs:892-983`, `packages/platform-rs/src/windows/mod.rs:1054-1104`).
- A virtual-desktop COM guard moves the exam window to the active virtual desktop (`packages/platform-rs/src/windows/mod.rs:1106-1182`).
- A 750 ms native foreground/fullscreen watchdog records and reacts to focus loss (`apps/desktop/src-tauri/src/lib.rs:1412-1463`).
- External displays use `SM_CMONITORS` and `QueryDisplayConfig`; RDP client/server and VM probes use environment, system metrics, processes, registry, CPUID, ACPI, `sc`, and `netstat` (`packages/platform-rs/src/windows/mod.rs:579-698`, `packages/platform-rs/src/windows/mod.rs:700-889`).
- Capture protection uses `SetWindowDisplayAffinity`; capture detection uses process and registry heuristics (`packages/platform-rs/src/windows/mod.rs:309-388`).
- Clipboard changes are observed through a message-only window and `WM_CLIPBOARDUPDATE`; metadata is logged, but content is neither read nor cleared (`packages/platform-rs/src/windows/mod.rs:1389-1420`, `packages/platform-rs/src/windows/mod.rs:1564-1629`).

### Registry, firewall, elevation, and DLL loading

- HKCU policies disable Task Manager and Win keys; Game Bar and precision-touchpad values are changed (`packages/platform-rs/src/windows/mod.rs:457-516`).
- Network lockdown creates process-scoped, globally named `netsh advfirewall` rules for the current executable and a one-time set of resolved IPs (`packages/platform-rs/src/windows/mod.rs:1230-1336`).
- Startup hardens DLL search and attempts stale registry/firewall recovery (`apps/desktop/src-tauri/src/lib.rs:2190-2239`).
- The PE manifest requires Administrator, and `/DEPENDENTLOADFLAG:0x1000` is added for MSVC Windows builds (`apps/desktop/src-tauri/build.rs:35-51`).

### Timers and clocks

- Native watchdog deadlines use Rust `Instant` (monotonic) (`packages/platform-rs/src/windows/mod.rs:927-960`, `apps/desktop/src-tauri/src/lib.rs:1425-1432`).
- Audit timestamps and clock-skew comparison use `SystemTime` (`apps/desktop/src-tauri/src/lib.rs:91-96`, `apps/desktop/src-tauri/src/lib.rs:1264-1289`).
- The contest countdown and auto-submit use browser `Date.now()` against server-provided `end_at` (`apps/web/src/app/session/contest/components/hooks.ts:59-110`).
- Program runtime is measured remotely, but three different semantics exist in source. The Go in-process worker begins with `time.Now`/`time.Since`, optionally replaces wall time with nsjail or `/usr/bin/time` CPU time, subtracts hard-coded language overhead, and then rounds/adds an input-derived value (`ams-golang/internal/worker/runner.go:1370-1522`). The DMOJ bridge accepts judge-reported seconds and converts them to milliseconds (`ams-golang/internal/bridge/judge_conn.go:183-203`). The intended `cxxprobe` engine uses `std::chrono::steady_clock` for wall time, `CLOCK_MONOTONIC` for its deadline, and cgroup `cpu.stat` for CPU time (`cxxprobe/src/sandbox/sandbox.cpp:275-346`, `cxxprobe/src/cases/cases.cpp:269-283`). Which path and metric produces production `runtime_ms` is not bound in the inspected repositories.

### Lifecycle and durability

- Normal Tauri window destruction unlocks Windows controls and deletes firewall rules (`apps/desktop/src-tauri/src/lib.rs:2434-2451`).
- There is no Windows console-control handler, close-request interlock, or single-instance plugin in the builder surface (`apps/desktop/src-tauri/src/lib.rs:2283-2463`).
- Startup recovery removes stale registry/firewall state (`packages/platform-rs/src/windows/mod.rs:518-540`, `apps/desktop/src-tauri/src/lib.rs:2227-2238`).
- Autosave writes the network request after mirroring to localStorage, with exponential retry (`apps/web/src/app/session/contest/client.tsx:1288-1384`, `apps/web/src/app/session/contest/autosave-timing.ts:6-24`).
- Resume metadata is stored in localStorage and server-validated from the home page (`apps/web/src/app/home/page.tsx:608-718`, `apps/web/src/app/home/page.tsx:720-763`).

## End-user runtime dependencies

Verified/inferred requirements on the candidate machine:

1. Windows 10/11 with the APIs used by the locked x64 binary. Only an x64 artifact is built (`.github/workflows/release.yml:17-21`).
2. Administrator consent/credentials at install and every application launch because both installer mode and PE manifest demand elevation (`apps/desktop/src-tauri/tauri.conf.json:39-41`, `apps/desktop/src-tauri/build.rs:25-31`).
3. Microsoft Edge WebView2 Evergreen Runtime. It is not shipped as a fixed runtime in config; bootstrap behavior is a Tauri-default inference (`apps/desktop/src-tauri/tauri.conf.json:35-41`).
4. Internet access during WebView2 bootstrapping if the inferred download-bootstrapper default is active.
5. Access to the configured `*.run.app` backend and Google connectivity canary. The fallback production API is hard-coded to Cloud Run (`apps/web/src/lib/api-base.ts:1-18`, `apps/web/src/app/session/onboarding/support.ts:10-20`).
6. Camera/microphone devices and OS privacy permission for proctored sessions (`apps/desktop/src-tauri/src/lib.rs:2342-2378`, `apps/web/src/app/session/contest/client.tsx:1592-1719`).

No local compiler, language runtime, Go runtime, Node runtime, Rust runtime, or `cxxprobe` binary is used by the installed exam client; code execution remains remote from the Windows candidate's perspective (`apps/web/src/app/session/contest/client.tsx:1404-1454`). `cxxprobe` itself requires Linux with cgroup v2 and a C++ compiler, so it belongs in the server worker image, not on the candidate's Windows machine (`cxxprobe/README.md:67-73`).

## Test inventory and Windows execution

- Rust policy tests cover strict Windows camera, display, RDP, keyboard, admin-warning, and clock behavior (`packages/core-rs/src/exam/mod.rs:1380-1434`, `packages/core-rs/src/exam/mod.rs:1463-1555`).
- Pure kiosk decision tests cover fullscreen drift, focus loss, lock/resume, and throttling (`packages/platform-rs/src/kiosk.rs:278-501`).
- Windows display retry resolution has unit tests (`packages/platform-rs/src/windows/mod.rs:1712-1749`).
- The actual Win32 observer/executor section identifies itself as thin and not unit-tested (`packages/platform-rs/src/windows/mod.rs:1632-1638`).
- Web unit tests cover countdown phases, autosave timing/coalescing, submission normalization, request aborts, presence tracking, auth, and theme behavior; their command is enumerated in `apps/web/package.json:9-15`.
- Rust tests run on `windows-latest`; web tests run only on Ubuntu (`.github/workflows/ci.yml:24-35`, `.github/workflows/ci.yml:101-126`).
- Go tests cover candidate/session guards, submission policy, bridge end-to-end behavior, and worker integration in source, but no test invokes a `cxxprobe` artifact or validates cxxprobe JSON/problem compatibility.
- `cxxprobe` has unit/integration coverage for problem configuration, sandbox execution, CPU limits, and the problem pipeline on Ubuntu; it does not exercise the Go API, Postgres/GCS materialization, Pub/Sub redelivery, or Windows client (`cxxprobe/.github/workflows/ci.yml:1-38`, `cxxprobe/tests/integration/problem_pipeline_test.cpp:1-260`).
- There are no installer, WebView2 bootstrap, UAC, Authenticode, SmartScreen, Defender, proxy, DPI, monitor-hotplug, sleep/resume, power-loss, ARM64, or real keyboard-hook integration tests.
- There is no cross-repository golden test proving that the exact question shown in `ams-access`, persisted/published by `ams-golang`, and evaluated by `cxxprobe` has one immutable identity and identical verdict semantics.

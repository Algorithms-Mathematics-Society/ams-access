# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`ams-access` is the **Tauri exam shell** — a cross-platform desktop app that wraps a Next.js web UI and enforces exam lockdown (keyboard grab, process scanning, VM detection, async proctoring). It is one of four repos in the broader AMS contest platform; the Go API, judge workers, Next.js contestant frontend, and infrastructure live in separate repos (`contest-platform`, `contest-web`, `infra`).

## Monorepo layout

Turborepo (pnpm workspaces) manages JS packages; Cargo workspace manages Rust crates.

```
apps/desktop/          Tauri app — src-tauri/ is the Rust entry point, lib.rs defines all Tauri commands
apps/web/              Next.js 15 (App Router) — served inside the Tauri webview
packages/api-client/   @ams/api-client — re-exports Tauri invoke(); wrappers not yet fully typed
packages/shared-ui/    @ams/shared-ui — React components shared between web and shell
packages/core-rs/      Rust — ExamSession state machine (15-stage), auth stub, encryption stub
packages/platform-rs/  Rust — OS-specific lockdown (linux/, windows/, macos/) via cfg_if
```

`platform-rs` compiles only the module matching the build target OS. `core-rs` is OS-agnostic and re-exported from `lib.rs`.

The Tauri `beforeDevCommand` and `beforeBuildCommand` in `apps/desktop/src-tauri/tauri.conf.json` automatically start/build the Next.js app, so you don't need to run the web app separately when working on the desktop.

## Commands

All commands run from repo root unless noted.

```bash
pnpm dev              # start everything (Tauri + Next.js hot reload)
pnpm build            # build all packages in dependency order
pnpm lint             # typecheck + ESLint across all JS/TS packages
pnpm typecheck        # tsc --noEmit across all JS/TS packages
pnpm clean            # wipe all build artifacts + node_modules

# Rust only
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all

# Single package (JS)
pnpm --filter @ams/web dev
pnpm --filter @ams/web build
```

No test framework is configured (no Jest/Vitest/cargo test setup). Pre-commit hooks only run formatters and type checkers.

## Environment variables

Create `apps/web/.env.local` for local development:

```
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-project-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

CI release builds require `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and six `APPLE_*` secrets for macOS notarization (macOS builds currently disabled in release.yml pending signing setup).

## Pre-commit hooks

Husky runs on every commit:

- `lint-staged` — runs `tsc-files --noEmit` on staged `.ts/.tsx`, `prettier --write` on staged code/config/markdown
- If any `.rs` files are staged: `cargo fmt --all -- --check` then `cargo clippy --workspace --all-targets -- -D warnings`

Clippy warnings are treated as errors (`-D warnings`). Fix them before committing.

## Key architectural constraints

- `@ams/api-client` wraps `@tauri-apps/api/core`'s `invoke()`. All communication from the web UI to native Rust goes through this package — never import `@tauri-apps/api` directly from `apps/web`.
- `platform-rs` uses `cfg_if!` for compile-time OS selection. Adding a new OS capability requires matching stubs in all three platform modules to keep the workspace compiling on CI (which builds all platforms).
- Tauri `frontendDist` points to `apps/web/out` — Next.js must be built with static export (`output: 'export'`) for production builds. Dev uses `devUrl: http://localhost:3000`.
- `core-rs/exam` owns the `ExamSession` 15-stage pipeline (SessionIsolation → FullscreenSecure → MonitorDetection → KeyboardLockdown → EnvironmentValidation → RestrictedApps → VmDetection → CameraInit → FaceCalibration → PresenceVerification → AudioVerification → NetworkValidation → IntegrityConfirmation → LockInCountdown → ContestLaunch). Lockdown logic in `platform-rs` is invoked by `core-rs`, not called directly from Tauri commands.
- The setup hook in `lib.rs` handles Linux-specific keyboard crash recovery on startup (restores GSettings from `/tmp/ams_access_kb_backup` if the app crashed mid-session) and webkit2gtk permission auto-allow. The window destroy hook calls `disable_keyboard_intercept` on all platforms.

## Tauri commands (apps/desktop/src-tauri/src/lib.rs)

All commands are registered in `lib.rs` via `tauri::generate_handler![]`:

| Command | Description |
|---|---|
| `scan_processes` | Dispatches to platform-rs; Linux reads `/proc`, Windows uses `tasklist /CSV`, macOS uses `ps` |
| `detect_virtualization` | Checks DMI/cpuinfo/CPUID (Linux), systeminfo+registry (Windows), system_profiler (macOS) |
| `enable_keyboard_intercept` | Linux: GSettings (GNOME only, backs up to `/tmp/ams_access_kb_backup`). Windows/macOS: **stub** |
| `disable_keyboard_intercept` | Restores saved GSettings. Windows/macOS: **stub** |
| `lock_desktop` | Sets window always-on-top + fullscreen, calls platform lockdown |
| `unlock_desktop` | Reverses lock_desktop |
| `check_network_stability` | TCP round-trip to host:443, returns latency/jitter/quality metric |
| `get_platform` | Returns OS, arch, family |
| `get_security_environment` | Returns display server, LD_PRELOAD status, ptrace scope (Linux); defaults on others |
| `save_face_image` | Decodes base64 image, writes to `/tmp/ams_faces` (Linux/macOS) or `%TEMP%\ams_faces` (Windows) |
| `log_violation` | Appends to in-memory `OnceLock<Mutex<Vec<ViolationEntry>>>` |
| `get_violation_log` | Returns the in-memory violation list (lost on crash; backend flush not yet implemented) |

## Web UI pages (apps/web/src/app/)

| Route | Status | Notes |
|---|---|---|
| `/` | Implemented | Email/password login form with Supabase auth |
| `/home` | Implemented | Contest dashboard; queries Supabase RPC `get_invited_contests` |
| `/session/onboarding` | Implemented | Animated 15-stage checklist wired to Tauri commands via `@ams/api-client` |
| `/session/contest` | Stubbed | `page.tsx` wraps a stub `client.tsx` in Suspense; no content yet |

Face detection on the onboarding page uses `@mediapipe/tasks-vision` (primary) and `@tensorflow-models/blazeface` (fallback).

## Implementation status

**Fully implemented:**
- Linux: process scanning, VM detection, display server detection (X11/Wayland/compositor)
- Linux: GSettings keyboard intercept with crash recovery (GNOME-based DEs — Ubuntu, Pop!_OS, Fedora Workstation, Zorin; detected via `XDG_CURRENT_DESKTOP`)
- Linux: ptrace scope check, LD_PRELOAD injection check
- `core-rs`: full 15-stage `ExamSession` pipeline with `StageStatus` (Pending/Checking/Pass/Warn/Fail) and `EnvironmentReport`
- Web UI: login, home/contest dashboard, 15-stage onboarding flow, face detection

**Stubbed / not yet implemented:**
- `core-rs/src/auth/mod.rs` — empty; session token validation reserved for Phase 2
- `core-rs/src/encryption/mod.rs` — empty; reserved for Phase 2
- Windows keyboard intercept — **fully implemented** via `WH_KEYBOARD_LL` low-level hook in `packages/platform-rs/src/windows/mod.rs`; blocks Win/PrintScreen/Alt+Tab/Alt+F4/Ctrl+Esc/Esc
- macOS keyboard intercept — returns `active: true` but does nothing (needs `CGEventTap`)
- Violation flushing to backend — in-memory only, lost on crash
- Contest page UI (`/session/contest`)
- CSP in `tauri.conf.json` is `null` — needs configuration before production

## Branch and commit conventions

```
main        always deployable
releases    merge main here when tagging
feat/*      squash-merge to main via PR
hotfix/*    branch from main, merge back immediately
```

Commit scopes: `feat(shell)`, `feat(shell/linux)`, `feat(shell/windows)`, `feat(shell/macos)`, `feat(shell/core)`, `chore`, `fix`. See `plan.md` for full scope list.

## UI design system

All UI work in `apps/web` and `packages/shared-ui` follows this visual language:

**Palette**

- Background: `#030816` | Cards: `#071124` | Secondary surfaces: `#0C1830`
- Accent violet: `#A855F7` | Highlight: `#C084FC` | Deep: `#7E22CE`
- Text: `#F5F7FA` / `#A7B0C0` / `#64748B`
- Success `#22C55E` | Warning `#F59E0B` | Error `#EF4444` | Info `#38BDF8`

**Gradients**

- CTA: `linear-gradient(135deg, #7E22CE 0%, #A855F7 45%, #C084FC 100%)`
- Ambient glow: `radial-gradient(ellipse, rgba(168,85,247,0.12), transparent)`
- No rainbow gradients.

**Borders / shadows**

- Default border: `rgba(255,255,255,0.06)` | Focus: `rgba(168,85,247,0.55)`
- Glow shadow: `0 0 20px rgba(168,85,247,0.18)` — layered, not flat

**Typography** — Inter / Satoshi / IBM Plex Sans. Thin weight, wide tracking on headings. "ACCESS" logo: airy luxury spacing.

**Components** — border-radius 12–18px, matte translucent inputs, weighty buttons with hover lift, layered dark card gradients, backdrop-blur sparingly.

**Motion** — `cubic-bezier(0.22, 1, 0.36, 1)`, 220–450ms. Slow and weighty. No bounce.

**Proctoring / camera UI** — elegant face-centering overlays, soft violet guide brackets, no raw debug visuals, green stability indicators should feel calm. Frame as "system alignment", not surveillance.

Overall feel: premium secure infrastructure software. Cinematic, restrained, futuristic.

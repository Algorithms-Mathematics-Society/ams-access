# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`ams-access` is the **Tauri exam shell** — a cross-platform desktop app that wraps a Next.js web UI and will eventually enforce exam lockdown (keyboard grab, process scanning, VM detection, async proctoring). It is one of four repos in the broader AMS contest platform; the Go API, judge workers, Next.js contestant frontend, and infrastructure live in separate repos (`contest-platform`, `contest-web`, `infra`).

## Monorepo layout

Turborepo (pnpm workspaces) manages JS packages; Cargo workspace manages Rust crates.

```
apps/desktop/          Tauri app — src-tauri/ is the Rust Tauri entry point
apps/web/              Next.js 15 (App Router) — served inside the Tauri webview
packages/api-client/   @ams/api-client — TypeScript wrappers around Tauri invoke()
packages/shared-ui/    @ams/shared-ui — React components shared between web and shell
packages/core-rs/      Rust — exam session state machine, auth, encryption
packages/platform-rs/  Rust — OS-specific lockdown (linux/, windows/, macos/) via cfg_if
```

`platform-rs` compiles only the module matching the build target OS. `core-rs` is OS-agnostic and re-exported from `lib.rs`.

The Tauri `beforeDevCommand` and `beforeBuildCommand` in `apps/desktop/src-tauri/tauri.conf.json` automatically start/build the Next.js app, so you generally don't need to run the web app separately when working on the desktop.

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

## Pre-commit hooks

Husky runs on every commit:

- `lint-staged` — runs `tsc-files --noEmit` on staged `.ts/.tsx`, `prettier --write` on staged code/config/markdown
- If any `.rs` files are staged: `cargo fmt --all -- --check` then `cargo clippy --workspace --all-targets -- -D warnings`

Clippy warnings are treated as errors (`-D warnings`). Fix them before committing.

## Key architectural constraints

- `@ams/api-client` wraps `@tauri-apps/api/core`'s `invoke()`. All communication from the web UI to native Rust goes through this package — never import `@tauri-apps/api` directly from `apps/web`.
- `platform-rs` uses `cfg_if!` for compile-time OS selection. Adding a new OS capability requires matching stubs in all three platform modules to keep the workspace compiling on CI (which builds all platforms).
- Tauri `frontendDist` points to `apps/web/out` — Next.js must be built with static export (`output: 'export'`) for production builds. Dev uses `devUrl: http://localhost:3000`.
- `core-rs/exam` will own the `ExamSession` state machine (Idle → Verifying → Active → Suspended → Ended). Lockdown logic in `platform-rs` is invoked by `core-rs`, not called directly from Tauri commands.

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

## Current state (Phase 1 scaffold)

The repo is scaffolded but mostly stubbed. `core-rs` modules (`auth`, `exam`, `encryption`) and `platform-rs` OS modules exist as empty or stub files. Tauri commands (`ping`, `get_platform_info`) and lockdown logic are not yet wired up. Phase 1 goal: app launches on all 3 platforms, loads web UI, no lockdown.

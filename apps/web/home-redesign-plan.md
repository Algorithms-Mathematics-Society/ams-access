# Home Redesign (Phase 2a-pre) — Implementation Plan

> Subagent-driven, sequential. LAYOUT/restyle only — the settled design is tokenized in 2a, not here.

**Goal:** Restructure `home/page.tsx` (overview view) + its panels into the mockup's 3-column "Contestant Command Hub" shell (top bar · static nav rail · center session-code+contests · right System Integrity Hub), **without touching any state/logic/wiring**.

**Mockups (read these):** `/home/user/Downloads/Contestant Hub Final Dark.png` (PRIMARY — home renders dark) · `/home/user/Downloads/Contestant Hub Final Light.png` (LAYOUT reference only — ignore its colors).

## Global Constraints (bind EVERY task — repeat to each subagent)

1. **RESTYLE-ONLY.** Never modify state, `useEffect`, handlers, data fetching, the `readiness`/validate/contest wiring, or the platform advisory/conditional logic (`onResolve` on `platform`, etc.). Only JSX structure + styling change. If a change would alter behavior, stop and report.
2. **Preserve the JS-prop theme system.** Keep the `theme` prop threading and `c = getThemeColors(theme)` usage intact. Do NOT replace it with CSS classes or the canonical `@/lib/theme` module — 2a does that later.
3. **NO hardcoded mockup hex.** Use existing tokens (`--theme-*`, `--surface-*`, `--text-*`, `--color-accent-*`, the `c.*` colors, `--theme-dot`/verdict/indicator tokens). For new structure with no token yet, use **dark-pinned values consistent with the existing obsidian set** (match neighboring `c.*` / `--surface-*`), NEVER the mockup's cream/grey. Status dots/labels derive from real `status`, not a literal green.
4. **Home renders DARK only** (not themed until 2a) — match the DARK mockup. Ignore the light mockup's colors.
5. Build green: `pnpm --filter @ams/web build`. Explicit-path `git add` only (never `git add -A`). Prettier/tsc pre-commit hooks run — expected.
6. Decisions: search = **decorative** (non-interactive placeholder); rail = **static expanded** (drop hover/pin collapse behavior); integrity rail = **home/overview only**; the 2 rail buttons = `onPracticeRun` + `onSettingsRedirect`/`onResolve`; **NO 4th "Security Logs" nav** (keep 3 nav items, SecurityOperationsLog stays under Diagnostics); profile/sign-out → top-right, rail-bottom = avatar + pill.

---

### Task 1: 3-column shell — top bar, static rail, center/right structure, profile relocation

**File:** Modify `src/app/home/page.tsx` (the render shell + `NAV_ITEMS`/sidebar region + overview grid + header).
**Scope (structure + style only; all state/handlers untouched):**

- **New full-width top bar** above the rail+content: brand `Λ ACCESS` (lift the logo mark out of the sidebar) at left; a **decorative, non-interactive search field** centered (a styled, disabled/readOnly input or div — no handler, no state); **profile** at right = `{name} | {studentEmail}` + the avatar circle (relocate the sign-out/profile out of the rail bottom — keep the `handleSignOut` wired to a control here, e.g. the avatar/menu).
- **Left rail → static expanded:** remove the collapsible hover/pin behavior (no `sidebarExpanded`/`sidebarHovered`-driven width/opacity); render labels always visible. Keep the 3 `NAV_ITEMS` and `activeNav` switching exactly. Rail bottom = avatar `A` + the pill placeholder (per mockup).
- **Center/right overview grid:** center column = title **"Contestant Command Hub"** + subtitle **"Authenticated Profile: {email}"** (copy change only; keep the email binding), then the SESSION CODE card slot (Task 2) and CONTESTS slot (Task 3). Right column = the System Integrity Hub slot (Task 4). Keep the existing `[1fr_360px]`-style grid but reposition to the mockup's proportions; integrity rail stays on overview only.
- Leave `SessionActionsPanel`/`ContestsPanel`/`ReadinessWidget` rendering in place for now (Tasks 2–4 restyle their internals); this task lands the shell around them.
  **Constraints:** all global constraints. Do not remove any handler/state even if the collapse behavior is dropped — neutralize the collapse _rendering_, but if removing `sidebarExpanded` state risks breaking refs, just force it permanently `true` instead.
  **Acceptance:** build green; `activeNav` still switches views; sign-out still works (handler wired to the relocated control); no state/effect removed; screenshot of `/home` matches the dark mockup's shell. Report what you changed and confirm zero logic edits.

### Task 2: SESSION CODE card (lift invite-code + Validate)

**Files:** `src/app/home/components/SessionActionsPanel.tsx` (+ wherever Task 1 placed its center slot).
**Scope:** Restyle the invite-code input + **Validate** button into the mockup's standalone **SESSION CODE** card (eyebrow label "SESSION CODE", input "Enter invite code", primary Validate button). Keep `onInviteCodeSubmit`/`inviteCode`/`inviteCodeBusy`/`inviteCodeStatus`/`inviteSuccessMsg` wiring byte-for-byte. **Preserve the active-session RESUME affordance** (when `activeSession` exists) — render it as a conditional banner/card above CONTESTS; do NOT drop it because the mockup shows the no-active-session state. Keep `onResume`/`resumeBusy`/`resumeVerification`/refresh wiring.
**Acceptance:** build green; validate + resume + refresh all still fire their handlers; screenshot matches; zero logic edits.

### Task 3: CONTESTS list restyle

**Files:** `src/app/home/components/ContestsPanel.tsx`, `ContestCards.tsx`.
**Scope:** Restyle the contests section header ("CONTESTS (n)") and each contest card to the mockup (title, `date · status · n Questions`, the top-right status chip). Keep `contests` data, `onPreflight` readiness-gating, and the loading state wiring intact. The chip color derives from the contest's real status/verdict token, not a raw hex.
**Acceptance:** build green; clicking a contest still triggers `onPreflight`; screenshot matches; zero logic edits.

### Task 4: System Integrity Hub (right rail)

**Files:** `src/app/home/components/ReadinessPanel.tsx` (`ReadinessWidget`).
**Scope:** Restyle the readiness widget into the mockup's **SYSTEM INTEGRITY HUB**: eyebrow header, then one clean row per item (label + state word e.g. "SECURE" + status dot) for `network/camera/mic/vm/keyboard/platform/restrictedApps`, then the **two action buttons** pinned at the bottom (`onPracticeRun` + `onSettingsRedirect`/`onResolve`). The state word + dot color come from each row's real `status` (`ok`→secure/`--theme-dot`, `fail`→error token, `checking`→pending) — NOT a literal green. **Do NOT touch** the `platform` advisory `onResolve` conditional or any readiness computation.
**Acceptance:** build green; rows reflect real `readiness.*` status; the platform advisory path still works; buttons fire their handlers; screenshot matches; zero logic edits.

---

## After all tasks

Controller runs the final whole-branch review (restyle-only confirmation + no-logic-touched + theme-prop intact) and a dark-mode screenshot diff against the mockup. Light mode + tokenization is **2a**, not here.

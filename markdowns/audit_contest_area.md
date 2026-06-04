# AMS Access — Contest Area Audit

**Date:** 2026-06-01 · **Auditor:** Antigravity (multi-perspective)  
**Scope:** `apps/web/src/app/home/page.tsx` (4 828 lines) + `apps/web/src/app/session/contest/client.tsx` (2 204 lines) + `globals.css`

---

## Audit Lenses

| Lens                       | Focus                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| **Senior Engineer (SE)**   | Architecture, correctness, security, maintainability                 |
| **Latency Engineer (LE)**  | Rendering perf, network round-trips, timer precision, bundle weight  |
| **High-Agency UI/UX (UX)** | Interaction quality, feedback clarity, accessibility, cognitive load |

Severity scale: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low

---

## Part 1 — Pre-Flight Readiness Modal (`SessionReadinessModal`, lines 4163–4596)

### SE-1 · Scan progress is cosmetic, not data-driven 🟠

**Root cause:** `scanProgress` increments via a fixed `setInterval(+4, 80ms)` independent of the real `readinessReport`. The animated console logs are hardcoded with fake latency strings (`"STABLE (22ms)"`, `"RESOLVED (1080p)"`).

The UI says "ARMED" when it reaches 100, but the actual readiness check (`runSessionReadiness`) is a completely separate async call happening in the parent. The modal has no idea when the real scan is done — it just races a fake counter.

**Risk:** A candidate can hit "PROCEED TO SESSION" before the real scan has finished if `readinessReport` arrives before the 2-second fake scan ends. Conversely, the scan can say "ARMED" even when the report hasn't resolved yet.

**Fixes compared:**

| Fix           | Approach                                                                                       | Pro                                 | Con                                        |
| ------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------ |
| **A**         | Drive progress from `readinessReport` arrival events                                           | Truthful                            | Requires report to emit incremental events |
| **B ✅ Best** | Remove fake interval; show spinner until `readinessReport !== null`, then display real results | Simple, honest, zero race condition | Loses animated terminal theatre            |
| **C**         | Keep fake animation but block "PROCEED" until both fake-done AND report-arrived                | Minimal change                      | Still deceptive, wastes up to 2s           |

**Best fix:** Option B. Remove the `progressInterval` and `logTemplates` timers. Show a loading spinner until `readinessReport` is non-null. Render all checks from real data. Telemetry text can still be stylised but must pull values from `readinessReport.checks`.

---

### SE-2 · `calculateReadinessScore` allows joining with a broken camera 🔴

**Root cause (lines 4659–4682):**

```ts
if (!cameraOk && !micOk) {
  score -= 25;
} else if (!cameraOk) {
  score -= 8;
} // comment says "92% Ready"!
```

Only 8 points deducted for a missing camera. `canProceed` only checks `readinessReport?.decision === "allowed"`. If the backend allows joining without camera, the UI presents the session as ready. The comment documents the bug: _"Exactly 92% Ready when only camera is disconnected!"_

**Risk:** Candidates enter proctored sessions without a live camera feed, defeating the entire security model.

**Fixes compared:**

| Fix           | Approach                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **A**         | Hard-block proceed if `readiness.camera === "fail"` regardless of score                                                                                               |
| **B ✅ Best** | `canProceed = readinessReport?.decision === "allowed" && readiness.camera !== "fail" && readiness.network !== "fail"` — enforce two non-negotiable checks client-side |
| **C**         | Raise camera deduction to 100 so score never hits threshold                                                                                                           | Fragile magic number |

**Best fix:** Option B — explicit guard on the two hard requirements. Clear and explicit, doesn't rely on score arithmetic.

---

### SE-3 · `useEffect` dep array misses `readiness`, causes stale log text 🟡

At line 4257:

```ts
useEffect(() => { ... }, [contestId, isRescanning, readinessReport]);
```

`readiness` (the individual check states) is not in the dep array, but the log templates read `readiness.network`, `readiness.mic`, etc. When only `readiness` changes (not `readinessReport`), the console logs are stale.

**Best fix:** Add `readiness` to the dep array, or derive log text exclusively from `readinessReport.checks` (already in deps).

---

### LE-1 · Progress animation fires at 80ms = 12.5fps, conflicts with 60fps paint 🟡

The `setInterval(80ms)` driving `scanProgress` triggers re-renders at ~12.5/s while the browser paints at 60fps. Each state update causes a React reconciliation pass on the entire modal subtree.

**Best fix:** Use `requestAnimationFrame` with `Date.now()` elapsed time to drive progress smoothly, or remove the fake progress entirely per SE-1 Option B.

---

### UX-1 · "RESOLVE FAILED CHECKS" button is a dead end 🔴

When checks fail, the proceed button renders "RESOLVE FAILED CHECKS" but `onClick` calls `handleProceed`, which returns early because `!canProceed`. The user clicks a button and nothing happens — no feedback, no navigation.

**Fixes compared:**

| Fix           | Approach                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------- | ------------ |
| **A**         | Change button to call `onSettingsRedirect()` when `!canProceed`                                                      |
| **B ✅ Best** | Two separate buttons: a disabled/greyed "PROCEED" + an active amber "FIX ISSUES →" that calls `onSettingsRedirect()` |
| **C**         | Tooltip on the disabled proceed button                                                                               | Easy to miss |

**Best fix:** Option B. A user must never click a button and feel nothing happen.

---

### UX-2 · "ABORT" label on close button is hostile 🟡

The close/dismiss button is labelled `ABORT`. In exam context this reads as "abort my session" rather than "close this preflight dialog". Candidates may fear clicking it.

**Best fix:** Rename to `[ CANCEL ]` or `[ CLOSE ]`. Reserve "ABORT" for session termination.

---

## Part 2 — Contest Listing (`ContestsPanel` + Card Components, lines 1761–1948)

### SE-4 · `now` ticker runs unconditionally regardless of contest states 🔵

```ts
const id = setInterval(() => setNow(Date.now()), 1000);
```

Fires every second even when all contests are `ACTIVE` or `ENDED`, forcing re-renders of the entire `ContestsPanel` subtree.

**Best fix:**

```ts
const hasScheduled = contests.some((c) => c.status === "SCHEDULED");
useEffect(() => {
  if (!hasScheduled) return;
  const id = setInterval(() => setNow(Date.now()), 1000);
  return () => clearInterval(id);
}, [hasScheduled]);
```

---

### SE-5 · `ScheduledContestCard` re-renders on every second tick 🟡

Receives `now` as a prop and computes `startsIn`/`phase` inline. Every 1-second tick re-renders every card. With many contests, this is O(n) re-renders per second.

**Best fix:** Wrap with `React.memo`. Move `phase` computation to a stable `useMemo`. The card's visual output only changes when `phase` changes, which is at most once every few minutes.

---

### SE-6 · 20-minute verification window is a magic number on the client 🟠

```ts
const windowOpen = start - 20 * 60 * 1000; // line 944
```

Duplicated in the invite code status message. If the backend changes this window, both locations fall out of sync.

**Best fix:** Have the API return `verification_window_minutes` per contest. Use that value client-side. Fall back to 20 if not present.

---

### LE-2 · `loadContests` has no request deduplication 🟡

Rapid "Refresh" clicks fire concurrent fetch calls. No in-flight guard exists.

**Best fix:**

```ts
const contestsLoadInFlight = useRef(false);
async function loadContests(...) {
  if (contestsLoadInFlight.current) return;
  contestsLoadInFlight.current = true;
  try { ... } finally { contestsLoadInFlight.current = false; }
}
```

---

### UX-3 · Empty contest state uses jargon nobody understands 🟠

Renders `0_SCHEDULED_CONTESTS_REGISTERED` — machine-speak. A contestant who just entered their invite code feels lost.

**Fixes compared:**

| Fix           | Copy                                                                        |
| ------------- | --------------------------------------------------------------------------- | --------- |
| **A**         | `No upcoming contests found.` — Plain, generic                              |
| **B ✅ Best** | `No contests yet. If you have an invite code, enter it above.` — Actionable |
| **C**         | Keep machine label for "brand aesthetic"                                    | Confusing |

---

### UX-4 · Disabled CTA button on `too_early` looks broken 🟡

Shows `"Verification opens 12m 44s"` but is `disabled` with no visual treatment to indicate "wait, not broken". Looks identical to a permanently disabled control.

**Best fix:** Render outlined/muted style with live countdown label. Add `title="Verification has not opened yet"` for hover context.

---

## Part 3 — Live Contest Session (`client.tsx`)

### SE-7 · Camera status polling writes 5 state updates per second 🟠

```ts
const interval = setInterval(updateCameraStatus, 1000);
```

`updateCameraStatus` calls `setFaceStatus`, `setProctoringOk`, `setFaceGraceActive`, `setFaceGraceCountdown`, and `setSoftBlockActive` on every tick — 5 potential re-renders/s on the entire contest layout.

**Fixes compared:**

| Fix           | Approach                                                                             |
| ------------- | ------------------------------------------------------------------------------------ | ----------------------------------- |
| **A**         | Use `useRef` for intermediate values, only `setState` on actual change               |
| **B ✅ Best** | Compare new derived status with ref-cached previous value; skip setState when stable |
| **C**         | Increase interval to 2000ms                                                          | Blunter, misses quick state changes |

**Best fix (B):**

```ts
const prevCameraOkRef = useRef<boolean | null>(null);
const updateCameraStatus = () => {
  const cameraOk = cameraStream?.active && isVideoRendering(video);
  if (cameraOk === prevCameraOkRef.current) return;
  prevCameraOkRef.current = cameraOk;
  setFaceStatus(cameraOk ? "ok" : "away");
  setProctoringOk(cameraOk && blockedApps.length === 0);
};
```

---

### SE-8 · Process scan interval fires when Tauri is unavailable 🟡

When Tauri is absent (web-only/dev mode), `scan()` silently catches and returns, but the `setInterval(5000ms)` still fires for the entire session lifetime — dead timer overhead.

**Best fix:** Check `window.__TAURI__?.core` once at mount. Skip the interval entirely if not present.

---

### SE-9 · `handleSave` swallows all errors silently 🟠

```ts
try {
  await fetch(...); // save answer
} catch {}
setSaved(true); // always shows "SAVED" even on network failure
```

The UI shows `[ SAVED ]` regardless of whether the POST succeeded. Candidates believe their work is safe when it is not.

**Best fix:** Return `Promise<boolean>` from `handleSave`. Show `[ SAVE FAILED ]` in red with a retry affordance on failure.

---

### SE-10 · Editor tab labels are hardcoded C++ fiction 🟡

```ts
const label = t === "html" ? "main.cpp" : t === "css" ? "order_book.h" : "test_cases.txt";
```

The actual editor is HTML/CSS/JS but tabs say `.cpp`, `.h`, `.txt`. Creates cognitive dissonance.

**Best fix:** Use real labels `index.html`, `style.css`, `script.js`, or make them configurable per question via API.

---

### SE-11 · `handleSubmit` doesn't check if save succeeded before submitting 🟠

`handleSave` has no return value, so `await handleSave()` in `handleSubmit` cannot detect failure. The session can be submitted with unsaved edits.

**Best fix:** Make `handleSave` return `Promise<boolean>`. In `handleSubmit`:

```ts
const saved = await handleSave();
if (!saved) {
  setSaveError("Final save failed. Resolve before submitting.");
  return;
}
```

---

### LE-3 · Preview iframe rebuilds entire srcdoc every debounce tick 🟡

`buildPreview` injects full HTML/CSS/JS into a srcdoc. The iframe tears down and rebuilds its entire document — JS context, DOM, styles — on every 600ms debounce tick.

**Fixes compared:**

| Fix           | Approach                                                                |
| ------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| **A**         | `postMessage` for incremental CSS patches                               | Complex                                  |
| **B ✅ Best** | Increase debounce to 900ms + ensure `sandbox="allow-scripts"` on iframe | Simple improvement now                   |
| **C**         | Use `contentDocument.write()` via iframe ref                            | Avoids full navigation; CodePen approach |

**Best fix now:** Option B. Option C is the production-quality path for v2.

---

### LE-4 · Heartbeat fetch has no `keepalive` — drops on tab unload 🟡

```ts
fetch(`.../${sessionId}/heartbeat`, { method: "POST" }).catch(() => {});
```

Browser may cancel this on tab close. Missing `keepalive: true`.

**Best fix (one line):** `fetch(url, { method: "POST", keepalive: true }).catch(() => {});`

---

### UX-5 · Face soft-block blur is too weak — editor text is still readable 🟡

`backdropFilter: "blur(12px)"` — at 12px, text in the editor remains legible through the overlay.

**Best fix:** `blur(32px) brightness(0.3)` plus a solid semi-opaque background layer before the blur element.

---

### UX-6 · "[ RAISE EXCEPTION ]" support button is developer jargon 🟡

Contestants under exam stress will not connect "raise exception" to "I need help".

**Best fix:** Rename to `[ REQUEST SUPPORT ]` or `[ HELP / ISSUE ]`.

---

### UX-7 · Submit double-confirm pattern is fragile and anxiety-inducing 🟠

The confirm text (`CONFIRM? CLICK AGAIN`) appears inline in the header with no cancel affordance and no spatial link to the button. Users who misclick feel trapped.

**Fixes compared:**

| Fix           | Approach                                                                        |
| ------------- | ------------------------------------------------------------------------------- |
| **A**         | Full modal dialog for submit confirmation                                       |
| **B ✅ Best** | Anchored popover/card below the submit button with "Confirm" + "Cancel" buttons |
| **C**         | 3-second countdown with cancel before submitting                                |

**Best fix:** Option B — anchored card, spatially linked, explicitly cancellable.

---

### UX-8 · Raw `<textarea>` editor — no line numbers or syntax highlighting 🟠

For an HTML/CSS/JS contest, contestants have zero visual structure. Error messages citing "line 23" are meaningless without line numbers.

**Best fix:** Integrate **CodeMirror 6** (~45KB gzipped for HTML/CSS/JS modes). Provides line numbers, syntax highlighting, bracket matching, and proper Tab handling within the Tauri webview.

This is the single highest-impact UX improvement in the contest area.

---

## Part 4 — Settings & Diagnostics

### SE-12 · `runSecurityScan` fires on every Settings tab mount 🟡

`SettingsPanel` unmounts/remounts on each nav tab switch, re-triggering 5 parallel Tauri invocations.

**Best fix:** Lift `securityScan` state to `HomePage` and run once on mount. Pass results as props.

---

### SE-13 · `SecurityOperationsLog` uses hardcoded fake timestamps 🟡

```ts
setLogs(baseLogs.map((l, i) => `[04:${12 + i}:02] ${l}`));
```

Timestamps are always `04:12:02`, `04:13:02`... regardless of actual time. If a proctor notices, trust is broken.

**Best fix:** Use `new Date().toLocaleTimeString()` for all base log timestamps on mount.

---

### LE-5 · Log array uses index keys — re-keys all entries on each shift 🔵

`key={i}` on log divs causes all entries to re-key when the oldest entry is shifted out. Use a stable unique key (timestamp string) instead of array index.

---

### UX-9 · Settings sub-tabs have no active indicator beyond background 🔵

Active tab is only distinguished by background colour change — no left-border, no weight change. Subtle on dark theme.

**Best fix:** Add 3px left-border in `c.accent` on active tab, matching the main sidebar pattern.

---

## Part 5 — Cross-Cutting Architecture

### SE-14 · `home/page.tsx` is a 4,828-line monolith 🟠

Entire home screen — 12+ components, 4 modal types, all business logic — in one file. Maximises merge conflicts, prevents unit testing, triggers full-file recompilation on any change.

**Best fix (incremental extraction):**

1. `SessionReadinessModal` + `PreflightCheckItem` → `components/SessionReadinessModal.tsx`
2. `ContestsPanel` + card components → `components/ContestsPanel.tsx`
3. `SettingsPanel` → `components/SettingsPanel.tsx`
4. `DiagnosticsPanel` → `components/DiagnosticsPanel.tsx`

---

### SE-15 · localStorage keys are scattered raw strings 🔵

`"ams_active_session"`, `"ams_device_id"`, etc. are raw string literals in both files.

**Best fix:** `constants/storage-keys.ts`:

```ts
export const STORAGE_KEYS = {
  ACTIVE_SESSION: "ams_active_session",
  UNLOCKED_CONTESTS: "ams_unlocked_contests",
  DEVICE_ID: "ams_device_id",
  USER_EMAIL: "ams_user_email",
  THEME: "ams_theme",
} as const;
```

---

### LE-6 · `getThemeColors(theme)` called inline in every render of every component 🟡

Returns an object of CSS variable strings. Called 20+ times per render cycle across the app.

**Best fix:** Since the function already just returns `"var(--theme-text)"` strings, use CSS variables directly in `style` props. No function call needed.

---

### UX-10 · No keyboard navigation — entire app is mouse-only 🔴

- No `aria-label` on most interactive elements
- No `role="dialog"` / `aria-modal="true"` on any of the 4 modal overlays
- Focus is not trapped in modals — Tab escapes the overlay
- All inputs have `outline: "none"` — no visible focus rings
- Face proctoring soft-block is not announced to screen readers

Fails WCAG 2.1 AA. Also blocks power-user keyboard workflows.

**Best fix priorities:**

1. Add `role="dialog"` + `aria-modal="true"` + `aria-labelledby` to all 4 modals
2. Implement focus trapping (use `focus-trap-react` or manual implementation)
3. Restore `:focus-visible` outlines (don't show on click, only on keyboard)
4. Add `aria-live="polite"` region for proctoring status changes

---

## Summary Score Card

| Area                         | SE Health | LE Health | UX Health |
| ---------------------------- | --------- | --------- | --------- |
| Pre-flight Modal             | 🟡        | 🟡        | 🔴        |
| Contest Cards                | 🟡        | 🟠        | 🟠        |
| Live Contest Session         | 🔴        | 🟠        | 🟠        |
| Settings / Diagnostics       | 🟡        | 🔵        | 🔵        |
| Architecture / Cross-cutting | 🟠        | 🟡        | 🔴        |

---

## Top 5 Fixes by Impact (Ranked)

| #   | Finding                                                     | Why It Wins                                      |
| --- | ----------------------------------------------------------- | ------------------------------------------------ |
| 1   | **SE-2** — Hard-block proceed on missing camera             | Security model is defeated without this          |
| 2   | **SE-9** — Show real save failure in `handleSave`           | Silent data loss with no user warning            |
| 3   | **UX-8** — Integrate CodeMirror 6 editor                    | Highest quality-of-life gain for contestants     |
| 4   | **UX-10** — Keyboard nav + ARIA on modals                   | Accessibility compliance + power-user experience |
| 5   | **SE-1** — Tie progress animation to real `readinessReport` | Correctness of the most critical user flow       |

---

## Best Practices to Enforce Going Forward

1. **No magic numbers in timing/scoring** — extract to named constants with business-rule comments
2. **All async actions must surface errors** — no empty `catch {}` in user-facing flows
3. **Components > 300 lines get extracted** — enforce with ESLint `max-lines` rule
4. **Every modal requires `role="dialog"` + focus trap** — add to PR checklist
5. **localStorage access via `STORAGE_KEYS` constants** — no raw strings
6. **Camera/mic: hard-required, never soft** — policy enforced client-side regardless of backend leniency
7. **All heartbeat/beacon fetches use `keepalive: true`** — prevents silent data loss on tab close

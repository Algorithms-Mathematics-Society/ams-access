# Contest Area Redesign — Implementation Plan

> Subagent-driven, **sequential**. Restyle/re-parent only — 2a tokenizes the settled structure
> later. Highest-risk file in the app; the discipline below is non-negotiable.

**Goal:** Restructure `apps/web/src/app/session/contest/client.tsx` (+ the editor chrome) into the
v1.2 mockup's contest layout (top bar · collapsible question rail · problem panel · editor panel ·
terminal panel · fixed camera tile · status bar) **without altering any timer / submission /
question-render / proctoring behavior.**

**Mockups (read these):**
`/home/user/Downloads/CONTEST AREA - Dark v1(2).png` (PRIMARY — v1.2, contest renders dark) ·
`/home/user/Downloads/CONTEST AREA - Dark v1.png` (expanded-rail reference) ·
`/home/user/Downloads/CONTEST AREA - Light v1.png` (LAYOUT reference only — ignore its colors).

## Key facts established in the brainstorm (bind every task)

- **Every mockup affordance is backed by existing state.** No new behavior is required anywhere.
  Collapse=`sidebarCollapsed`, split %=`problemPaneWidth`, tabs=`problemTab`/`terminalTab`,
  language=`selectedLanguage`+`handleLanguageChange`, file tabs=`questionFiles`+`addEditorFile`+
  `pendingCloseFileId`, question nav=`activeQ`+`switchQuestion`, timer=`CountdownBadge`/
  `useCountdown`/`onExpiry`.
- **There are ZERO LOGIC-TOUCHING items.** If any task tempts an implementer toward altering
  countdown, submission, render-filtering, or proctoring logic — STOP and report, do not implement.
- **The editor is CodeMirror 6, not Monaco** (`editor-pane.tsx`). "monaco-dark"/"monaco-light" are
  theme _labels_. CodeMirror internals + the `__TAURI__` clipboard keymap (`editor-pane.tsx:586,612`)
  are **out of scope** — Tasks touch only the chrome (file tabs, language, Run/Submit, terminal) in
  `client.tsx`.
- **Native bridge call-sites must stay byte-identical** (all `window.__TAURI__?.core.invoke(...)`):
  `log_proctoring_event` (1810, 2788, 2894), `log_violation` (3047, 3068, 3091, 3144, 3184),
  `configure_event_stream` (2867), `unlock_desktop` (2624), `getCurrentWindow()` (2617).

## Global Constraints (repeat verbatim to every subagent)

1. **RESTYLE / RE-PARENT ONLY.** Never modify state, `useEffect`, handlers, refs, data fetching, or
   any proctoring/timer/submission logic. JSX structure + styling only. A change that would alter
   behavior → stop and report.
2. **Keep all handler/state/ref bindings byte-identical.** When moving an element, move its
   `onClick`/`ref`/`value`/`disabled`/bindings verbatim. Re-parent the subtree; never rewrite it.
3. **NO hardcoded mockup hex.** Use existing tokens (`--theme-*`, `--surface-*`, `--text-*`,
   `--color-accent-*`, verdict/indicator tokens, `VERDICT_COLORS`). New structure with no token →
   **dark-pinned placeholders matching the neighbouring obsidian set** (the file already uses
   `#0F0F0F`/`#1F1F1F`/`rgba(255,255,255,0.05)` etc.), NEVER the mockup's cream/grey. Status
   colors derive from real state, not literals. **Zero net-new distinct hex** vs. what the region
   already uses.
4. **Contest renders DARK only** (not themed until 2a) — match the v1.2 dark mockup. The light
   mockup shows light LAYOUT only; ignore its colors.
5. **CodeMirror internals + clipboard keymap untouched.** Editor chrome only.
6. **Do NOT remove `cameraCollapsed`** (vestigial state; removing it is a logic edit → 2a debt).
   **Preserve the `isRunSubmission` RUN-hiding invariant** in the Attempts renderer (lines 86–108).
7. Build green: `pnpm --filter @ams/web build`. Explicit-path `git add` only (never `git add -A`;
   a parallel session may be editing). Prettier/tsc pre-commit hooks run — expected.

## Review discipline (per task)

`/code-review` after each task against: **SAFE-RESTYLE** (free) / **STRUCTURAL — handlers re-parented
intact** / **no LOGIC-TOUCHING**. Two gate types:

- **Screenshot-primary** (Tasks 1–5, 7): correctness is visible in a dark screenshot vs the mockup.
  The re-parents in these (rail/terminal/status) additionally get the binding-intact review.
- **Runtime-primary** (Task 6): a screenshot of the moved camera shows a black box whether the
  stream is live or dead — it renders identically broken or working. The screenshot confirms
  **position only**. The real gate is the runtime check (below). This is THE gate, not a supplement.

---

### Task 1 — Body shell + top bar

**File:** `client.tsx` (the `<header>` ~3800–3996 and the body `<div>` shell ~3998).
**Scope:** `EVALUATION` brand mark (left), centered `CountdownBadge` (logic untouched — move the
existing element, keep `endAt`/`onExpiry`), exit/sign-out control at right (keep its
`getCurrentWindow`/`unlock_desktop` binding). Lay out the 3-column flex and establish the
positioning context (`position: relative` on the body) that the fixed camera tile in Task 6 anchors
to. Don't restyle the rail/panels yet (Tasks 2–5) — land the chrome around them.
**Gate:** screenshot of `/session/contest` top bar + shell matches v1.2; build green; report zero
logic edits + that `CountdownBadge`/exit bindings are verbatim.

### Task 2 — Question rail

**File:** `client.tsx` `<aside>` (~4001–4208).
**Scope:** `QUESTIONS (n)` header + collapse chevron, `2 / 6 SOLVED` + segmented progress bar, the
question rows (number, solved dot, title, status chip) and the collapsed letter-badge form. Keep
`sidebarCollapsed`/`setSidebarCollapsed`, `switchQuestion`, `activeQ`, `questionStatusMap`,
`attempted/accepted/remaining` counts.
**Gate:** screenshot (expanded + collapsed) matches; rail still collapses; clicking a row still
switches question; build green; zero logic edits.

### Task 3 — Problem panel

**File:** `client.tsx` problem column.
**Scope:** `Problem` header + `35%` label (reads `problemPaneWidth`), the
Statement/Examples/Visualization/Information tab bar, `PROBLEM A` eyebrow + title + rendered body.
Keep `problemTab`/`setProblemTab`, the markdown/section render path, and the split-resize handle
(`handleProblemSplitMouseDown`).
**Gate:** screenshot matches; tabs still switch sections; split-drag still resizes; build green;
zero logic edits.

### Task 4 — Editor chrome

**File:** `client.tsx` editor header/toolbar (around the file-tab + language + Run/Submit region).
**Scope:** `Editor` label, file tabs + `+` (`addEditorFile`) + `×` close-confirm
(`pendingCloseFileId`), `Language ▾` (`handleLanguageChange`), `Saved` indicator, and the
sliders / ▷ Run / ✈ Submit toolbar (keep `isRunning`/run + submit handler bindings + `disabled`
guards). **CodeMirror component and clipboard keymap untouched.**
**Gate:** screenshot matches; add/close file, language switch, Run, Submit all still fire their
handlers; build green; zero logic edits.

### Task 5 — Terminal panel

**File:** `client.tsx` terminal/output region.
**Scope:** Output / Compiler output / Attempts tab bar + collapse chevron, `OUTPUT` body. Keep
`terminalTab` and the three real renderers. **Preserve the `isRunSubmission` RUN-hiding invariant**
in the Attempts renderer (RUN attempts must never appear under Attempts).
**Gate:** screenshot matches; all three tabs render their real content; RUN attempts stay hidden
from Attempts; build green; zero logic edits.

### Task 6 — Camera tile decouple (RUNTIME-PRIMARY gate)

**File:** `client.tsx` — move the camera `<div>` (`~4210`) OUT of `<aside>` to a fixed/absolute
bottom-left sibling of the body.
**Scope:**

- **Re-parent the camera subtree verbatim** — `<video ref={cameraVideoRef}>`, the `handleToggleMedia`
  cam/mic buttons, all bindings move unchanged. The re-attach effect (2958) must still fire on mount
  to re-bind `srcObject` — do NOT move or alter any of the camera effects (2880, 2958, 2969) or
  `stopStream`/getUserMedia logic; they stay where they are.
- **Render the tile at ONE fixed location, unconditionally** (presence-gated only by the existing
  `display: (cameraStream ?? cameraError) ? "flex" : "none"`). Never place it inside a
  `sidebarCollapsed ? A : B` branch that swaps its parent.
- **Drop the in-tile `sidebarCollapsed` reads** (the `!sidebarCollapsed &&` toggle row, the
  `display: sidebarCollapsed ? none : block` on the video, the `52/150` height, the collapsed-dot
  branch) → always-full presentation per v1.2.
- Add a **separate background-merge `<div>`** behind the camera that animates with the rail
  (collapses/expands with `sidebarCollapsed`), so the "merges from the sidebar" visual is a
  background element, not the camera itself.
- **Do NOT remove `cameraCollapsed`.**
  **Gate — RUNTIME-PRIMARY (this is THE gate):** run the dev server and verify in-browser:
  1. camera feed renders **LIVE** at the new bottom-left position after the re-parent (not a black
     box — confirm actual video);
  2. mic toggle + camera toggle still work (`handleToggleMedia`);
  3. collapse/expand the rail repeatedly — the feed **never blinks/re-mounts**;
  4. proctoring events still emit (no console errors from the presence/log effects).
     Screenshot confirms position only. Plus the binding-intact code review (ref/handler/effect
     bindings verbatim, re-parent is the one move that could drop the ref).

### Task 7 — Bottom status bar

**File:** `client.tsx` proctoring footer (`~6091`).
**Scope:** the status-icon strip (shield / camera / wifi / lock / save) + `Q2/6 · 2 attempted ·
2 accepted · 4 remaining · Evaluation` + `Access` wordmark. Keep `online`/`blockedApps`/proctoring
status bindings; icons derive from real state.
**Gate:** screenshot matches; status icons reflect real state; build green; zero logic edits.

---

## Reaching the screenshotable state (verified path for the end-of-branch visual pass)

The full contest chrome only renders after a real contest + session loads. Data flow:
`API_URL = resolveApiBase()` ← `NEXT_PUBLIC_API_URL` (`apps/web/.env.local`, currently the Cloud
Run test backend `https://ams-api-test-...run.app`); `contestId` ← URL `?contestId=`; the app
self-creates a session via `POST /sessions` with `authHeaders()` = `Authorization: Bearer
<candidate token>` + `X-Device-Id`. `lockGate` passes automatically in a browser (the
`is_lockdown_engaged` invoke throws → `catch` → `setLockGate("ok")`).

**⚠️ This is NOT runnable in the build sandbox:** egress to the backend is blocked here
(`curl … → HTTP 000`) and there is no candidate token. So the visual pass runs in the user's dev
env, where the backend is reachable. Per-task code gates (build + binding review + diff) are the
in-sandbox gates; the "matches mockup" check is deferred to this path.

**Turnkey steps (user dev env):**

1. `pnpm --filter @ams/web dev` → http://localhost:3000 (ensure `NEXT_PUBLIC_API_URL` reaches a
   live backend with a seeded contest).
2. Provide a candidate token — either OTP-login a candidate at `/login`, or inject directly:
   `localStorage.setItem("ams_candidate_token", "<valid candidate JWT>")` +
   `localStorage.setItem("ams_user_email", "<candidate email>")`.
   (`ams_device_id` auto-generates; `contestId` comes from the URL.)
3. Navigate to `http://localhost:3000/session/contest?contestId=<seeded-contest-id>`
   (add `&mode=dry-run` for the unlocked practice variant). Allow the camera prompt.
4. Full chrome renders → screenshot against `CONTEST AREA - Dark v1(2).png` and walk the
   `contest-redesign-visual-checklist.md` items (one block per task).

localStorage keys (from `src/constants/storage-keys.ts` + `candidate-auth.ts`):
`ams_candidate_token`, `ams_user_email`, `ams_device_id`, `ams_active_session`, `ams_theme`.

## Deferred features (explicitly NOT built in this redesign)

- **Collapsible terminal panel.** The v1.2 mockup shows a collapse chevron on the terminal tab
  bar, but there is no `terminalCollapsed` state today (the panel is a fixed `height: 30%`). This
  is new _behavior_, not new-UI-over-existing-state, so Task 5 OMITS the chevron and restyles
  chrome only. If built later it needs its own decision: default state? persistence? interaction
  with the editor/terminal split and the three terminal renderers + the `isRunSubmission`
  invariant? Queue alongside 2a.

## After all tasks

Final whole-branch review: restyle-only confirmation, no-logic-touched, every `__TAURI__` invoke
call-site intact, `isRunSubmission` invariant preserved, `cameraCollapsed` left in place, zero
net-new hex, CodeMirror internals untouched, dark screenshots match v1.2. Light mode + tokenization
is **2a**, not here.

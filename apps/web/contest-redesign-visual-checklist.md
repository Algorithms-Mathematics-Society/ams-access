# Contest Redesign — Deferred Visual-Pass Checklist

> Per-task expected visual results, accumulated as each chrome task lands. The end-of-branch
> screenshot pass verifies THESE specific items against `CONTEST AREA - Dark v1(2).png` (PRIMARY),
> `CONTEST AREA - Dark v1.png` (expanded rail), each attributable to its task — so any visual flaw
> traces to one task, not a stack of seven. Per-task code gates (build-green + binding-intact
> review + diff read) already ran and passed; only the cosmetic "matches mockup" check is deferred.
>
> **How to reach the screenshotable state:** see `contest-redesign-plan.md` › "Reaching the
> screenshotable state" (verified path to full contest chrome).

## Task 1 — Top bar + body shell ✅ code-gated (b5c6a9a)

Expected vs current, against v1.2:

1. Top bar is full-width, ~48px tall (was 52px), dark `#0F0F0F`, 1px bottom hairline.
2. Left cluster: `Λ` gradient logo mark · vertical divider · contest title rendered as an
   uppercase, letter-spaced wordmark (real `{contest?.title}` binding, styled like the mockup's
   "EVALUATION" label).
3. Center: timer pill is **optically centered** in the bar (3-col grid `1fr auto 1fr`), shows a
   spinning `⟳` (Loader2) + the countdown time in a subtle pill (`rgba(255,255,255,0.05)` bg).
   At the critical threshold it still switches to the tinted/urgent treatment (unchanged logic).
4. Right cluster: support (lifebuoy) + exit (door) icons, **flush-right**, muted grey; exit hovers
   red. (Mockup shows only the exit door; support retained but subtle.)
5. Below the header the 3-column body region begins; nothing inside the rail/panels changed yet.

## Task 2 — Question rail ✅ code-gated (9f4b614)

Expected vs current, against v1.2 (expanded = `Dark v1.png`, collapsed = `Dark v1(2).png`):

1. Rail header: `QUESTIONS (n)` eyebrow + collapse chevron (`<` expanded / `>` collapsed).
2. Below it: `{accepted} / {total} SOLVED` (uppercase, accent color) + a **segmented progress bar**
   — one thin segment per question, each colored by that question's real status
   (`questionStatusMap[q.id].color`). The old "attempted · accepted · remaining" text line is gone.
3. Expanded rows: `A. <title>` (letter prefix) + a small **status dot at the right edge** (color
   from real status). The old `[number][center-dot][title][text-chip]` layout and the shortLabel
   chip are gone. Active row keeps the accent-highlight background + accent text.
4. Collapsed rail: narrow ~52px strip, vertical **letter badges** A–F (was numbers), active letter
   highlighted; same per-status border/bg/color.
5. Inactive letter label uses `--text-dim` (token restored in review — not a literal).

## Task 3 — Problem panel ✅ code-gated (26aa50b)

Expected vs current, against v1.2 (middle column):

1. Header row: `Problem` label (left) + live `{problemPaneWidth}%` (right), 44px tall.
2. Tab bar: 44px tall, left-aligned to the header label (18px pad), active tab underlined in accent.
   **Only the real tabs appear** — Statement / Examples / Constraints, and only when >1 has content
   (`availableProblemTabs`). The mockup's "Visualization / Information" are NOT present (not real
   tabs in this app) — their absence is correct, not a miss.
3. Body: `PROBLEM A` eyebrow (now uppercase + tracked) · bold title · rendered statement
   (`.pb-body` HTML unchanged — DOMPurify path intact).
4. The drag-to-resize separator between problem + editor still works (its % feeds the header label).
   Light restyle only — structure was already close to the mockup.

## Task 4 — Editor chrome ✅ code-gated (473b63b)

Expected vs current, against v1.2 (editor header, two rows):

1. Row 1: `Editor` label · file tab(s) as **rounded chips** (`B.cpp ×`, 28px tall, 6px radius) +
   `+` add-file · `Language` + `C++17 ▾` select · `● Saved` indicator (dot, was a check icon).
2. Row 2 (44px, unified `#0F0F0F` bg): right-aligned cluster — settings/sliders icon (opens the
   editor-theme menu), **icon-only ▷ Run** button (34×34, label text removed), and the primary
   **`Submit`** button (was "Submit Solution").
3. Close-confirm popover on the tab `×` still appears (anchored under the chip) and still works.
4. Run disabled when `isRunning || !sessionId`; Submit disabled when `saving || isSubmitting`;
   their loading/failed label+icon states unchanged (verified guards byte-identical).
5. The CodeMirror editor below is unchanged.

## Task 5 — Terminal chrome ✅ code-gated (800a6d3)

Expected vs current, against v1.2 (bottom-right terminal):

1. Tab bar: `Output` (active) · `Compiler output` · `Attempts` — active tab now heavier
   (fontWeight 600 active / 500 inactive), accent underline on active. Tab labels stay mixed-case.
2. Body eyebrow reads `OUTPUT` (all-caps, wider tracking) above "Run your code to see stdout and
   stderr." (empty-state).
3. **No collapse chevron** — deliberately omitted (collapsible terminal deferred as a separate
   feature; see plan "Deferred features"). Its absence is correct, not a miss.
4. Populated states (run-result verdict cards, Attempts list + expansion, test-results) are
   unchanged from before — not in the mockup, logic fenced off (incl. the RUN-hiding invariant).

## Task 6 — Camera decouple ✅ code-gated (387180123) · ⚠️ RUNTIME check pending (your env)

**Visual (screenshot):**

1. Camera is a **full ~220px video box at bottom-left**, in BOTH rail states (expanded AND
   collapsed) — never a dot/two-icon form. Cam/mic toggle row + status label always visible.
2. A background panel behind the camera **animates width with the rail** (52px collapsed /
   220px expanded) — the "merges from the sidebar" effect. The camera itself does not move/resize.
3. Tile only appears once the stream (or a camera error) exists (presence-gated).

**Visual-pass fixes (f2bf2a9, presentation-only — stream byte-untouched, re-verified):**

- Camera tile is now a clean video box with the cam/mic toggles **overlaid top-right on the
  video** (no separate toggle bar, no text label) — matches the mockup containerization.
- **Problem text no longer scrolls under the camera** — the problem `<article>` gained
  `padding-bottom: 178px` reserving the tile's footprint (fixes the "Note"-covered overlap in the
  collapsed rail state).
- Camera health preserved without a truncating label. Tile fixed at 150px; bg-merge matched to 152px.

**Visual pass 2 (1809a4e — presentation/a11y only, stream byte-untouched):**

- **Camera health, every-modality** (replaces the color-only border + static title):
  - Healthy = clean box, no chip. Problem = bottom-left chip with **shape + text** (non-color):
    ⚠ `AlertTriangle` **only** on `cameraError` → "Camera issue"; neutral `VideoOff` → "Off" for
    intentional toggle-off; spinner → "Starting…".
  - Announced via a content-based `role="status" aria-live="polite"` region; healthy renders
    "Camera active" so "Starting…" announces its resolution (doesn't stick). Border now static.
  - **To verify:** trigger a camera fault (unplug/deny mid-session) → ⚠ "Camera issue" chip appears
    AND a screen reader announces it; toggle camera off → neutral "Off" (no ⚠).
- **Collapsed-rail strip (Arrow 3):** the collapsed rail now reads as a defined strip — subtle
  elevated bg (`#111111`) + visible `#1F1F1F` right divider; the letter badge sits inside it, not
  floating.
- **Top-bar exit cluster (Arrow 4):** support + exit icons vertically aligned (exit wrapper
  flex-centered).

**Rail redesign (a9d3d1c — Sidebar-open.png / Sidebar.png; presentation-only, stream untouched):**

- **Camera docked-expanded / absent-collapsed:** expanded rail → camera at the rail bottom (220px,
  divider above, toggles overlaid top-right); collapsed rail → **no camera** (hidden via
  `display:none`, NOT unmounted — stream keeps running). This is a CSS display toggle only.
- **Progress bar is binary:** green segment per _solved_ (accepted) question, gray otherwise.
- **Row dots active-first:** the viewed question's dot is **purple** (accent) even if solved;
  non-active solved = green; unsolved = gray. All token-driven.
- **Collapsed strip:** defined container (from visual pass 2) with letter badges A–F, active in an
  accent pill; the redundant background-merge div was removed (no more collapsed-strip artifact).
- **RUNTIME re-check (your env, confirmation not risk-gate — display toggle can't tear down a
  mounted stream):** feed live expanded → collapse/expand 5× → `videoElements` stays 1,
  `currentTime` keeps advancing, no blink; camera absent (not black) when collapsed.

**RUNTIME-PRIMARY (must run in dev env with a live camera — a screenshot shows a black box either
way, so these are the real gate):** 4. Feed renders **LIVE** at the new bottom-left position (actual video, not black). 5. Camera toggle + mic toggle both work (`handleToggleMedia`). 6. Collapse/expand the rail 5× — the feed **never blinks / re-mounts**. 7. Proctoring events still emit — no console errors from the presence/log effects.
(Code review confirmed: single `<video ref>`, effects untouched, re-attach fires on mount.)

## Task 7 — Bottom status bar ✅ code-gated (06e8ca7 + a11y fix 54fd2ad)

Expected vs current, against v1.2 (full-width footer):

1. Left: a compact **icon-only** strip — shield (Secure/Action needed) · face · wifi
   (Connected/Reconnecting) · save (Saved/Saving/Not saved) · keyboard. Text labels removed
   (icon-only per mockup); state exposed to screen readers via visually-hidden live regions.
2. Right: `Q{n}/{total} · {attempted} attempted · {accepted} accepted · {remaining} remaining ·
Evaluation` (counts are real bindings; "Evaluation" is a copy label) · divider · `Access`.
3. **A11y (verify with a screen reader / axe if doing the pass):** face "away" shows a small
   **alert dot** (non-color cue) AND announces "center your face in the camera"; Secure/Connection/
   Saved changes are announced (content-based live regions); keyboard exposed as "Keyboard locked".
4. Mockup-faithful minors shipped as-is: footer title → "Evaluation", save icon = dot, Run icon-only.

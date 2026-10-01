# AMS Access — Final Design Audit (Desktop Exam App)

**Author:** Senior Design Engineer review · **Scope:** the candidate-facing desktop app only
(`ams-access/apps/web`) — Welcome → Login → Home → 15-stage Onboarding → Contest IDE → Results,
plus shared modals and loading shells.
**Lens:** what I would fix before I'd let this ship to a real, high-stakes proctored contest.
**Not in scope:** the org/admin web app, the Go backend, app logic. This is purely visual,
hierarchy, motion, and interaction.

---

## 0. The thesis (read this first)

This product is a **proctored, high-stakes instrument**. A candidate spends 2–3 hours inside it
under stress. The design job is not "look cool" — it is **calm, precise, and trustworthy**, the way
a good cockpit or lab instrument is. Everything should feel deliberate and quiet, with drama
reserved for exactly two moments: **the lock-in countdown** and **the verdict**.

The foundation is genuinely good and I want to be clear about that:

- **Token system exists** (`globals.css`): obsidian surfaces, a single violet accent driven from one
  RGB triplet, a radius scale, a type scale, an elevation ramp, verdict colors, one authoritative
  focus ring, reduced-motion handling. This is more discipline than most products ship with.
- **The typeface pairing is a real choice, not a default.** JetBrains Mono for data/system/instrument
  text and Inter for human guidance is *meaningful* here — mono = "the machine is watching/measuring,"
  sans = "we're talking to you." Lean into it harder and it becomes a signature.

The problem is **drift and discipline**, not direction:

1. **The tokens exist but the screens don't use them.** Hard-coded `#64748b`, `#475569`, `#94a3b8`,
   `#7c3aed`, `#8b5cf6`, radius `2px/5px/10px`, font sizes `10/15/16/20/22/26px`, and a dozen
   transition timings all bypass the system. The result reads as several people's work, not one.
2. **Hover is missing on ~40% of interactive elements** (Back-to-Home, Load Breakdown, problem rows,
   leaderboard rows, several modal buttons). On a desktop/Tauri app with a real cursor, missing hover
   feels broken, not minimal.
3. **The two drama moments are flat.** The lock-in countdown and the submit verdict — the two times a
   candidate's heart rate actually changes — currently render as silent data updates.
4. **One risk worth naming:** near-black + a single bright violet glow is *also* the current
   AI-default look. The welcome screen in particular leans on stacked radial blooms + a gradient
   pill, which is the templated answer. The fix isn't to abandon violet — it's to **spend violet with
   restraint** (candidate actions only) and let semantic colors own system state, so the accent means
   something.

The rest of this document is: **(1) cross-cutting system fixes** that pay off on every screen, then
**(2) a screen-by-screen audit** with current values → issue → exact recommended values.

---

## 1. Cross-cutting system (fix these once, everywhere improves)

### 1.1 Radius — collapse the one-offs to the scale
Tokens define `--radius-sm: 6px`, `--radius-md: 8px`, `--radius-lg: 12px`, `--radius-pill: 999px`.
In the wild I found `2px` (onboarding info boxes, camera/video frames, countdown), `5px` (verdict
badge, results buttons), `10px` (contest cards), `4px` (expanded rows), `7px` (avatar, status dots).

**Rule going forward:**
- Inputs, buttons, cards, dropdowns → `--radius-md` (8px).
- Badges, chips, tags, small status pills, icon buttons → `--radius-sm` (6px).
- Modals, the stage frame, hero cards → `--radius-lg` (12px).
- Dots, avatars-as-circles, fully-round pills → `--radius-pill`.
- **Kill `2px` entirely.** It is the single biggest "unfinished" tell in the onboarding flow — sharp
  corners on dark cards read as a wireframe.

### 1.2 Type scale — three off-scale sizes are doing real damage
Scale is `11 / 12 / 13 / 14 / 19 / 24px`. Screens use `10, 15, 16, 17, 20, 22, 26, 28, 30, 44px`.
Some of those large display sizes are legitimately needed (countdown, page titles, contest hero
timer) — **the scale is missing a display tier.** Add it rather than letting every screen invent one:

```
--text-2xl: 30px;   /* contest hero timer, results rank */
--text-3xl: 44px;   /* lock-in countdown, the one true display size */
```
Then: retire `10px` (→ `11px` floor for labels), `15px`/`16px` (→ `14px` body or `19px` subtitle),
`20px`/`22px` (→ `19px` or `24px`), `26px`/`28px` (→ `24px` `--text-xl`). Reserve `30px`/`44px` for
the two display moments only.

### 1.3 Color drift — map the gray zoo to the muted tiers
Tokens already define `--text-soft: 0.72`, `--text-dim: 0.58`, `--text-faint: 0.45`. The screens use
slate hex (`#64748b`, `#475569`, `#94a3b8`, `#cbd5e1`) which is a *cooler, bluer* gray than the
neutral white-alpha tiers — so muted text subtly shifts hue between screens.

| Found | Replace with | Tier |
|---|---|---|
| `#475569`, `#64748b` | `rgba(255,255,255,0.58)` | `--text-dim` |
| `#94a3b8` | `rgba(255,255,255,0.72)` | `--text-soft` |
| `#cbd5e1`, `#e2e8f0` | `#ffffff` / `--text-soft` | primary / soft |
| `#7c3aed`, `#8b5cf6`, `#9333ea` | `rgb(var(--accent-rgb))` ramp | accent |

Pick **one**: either fully commit to the white-alpha tiers (my recommendation — neutral grays read
calmer on obsidian) or formally adopt the slate ramp as tokens. Do not keep both.

### 1.4 Transitions — define a 3-step palette, stop hand-rolling timings
I counted `100, 120, 150, 200, 220, 250, 280, 300, 400, 500, 600ms` and four easings. Define:

```
--transition-fast:     120ms ease;                          /* hover, color, bg */
--transition-standard: 240ms cubic-bezier(0.22,1,0.36,1);   /* layout, reveal, nav */
--transition-slow:     600ms cubic-bezier(0.22,1,0.36,1);   /* enter/exit, drama */
```
`--ease-cinematic` already exists — route everything through these three.

### 1.5 Hover — make it a non-negotiable
Every clickable element gets a visible resting → hover delta on a real pointer. Default patterns:
- **Ghost/secondary button:** bg `transparent → rgba(255,255,255,0.06)`, border `0.10 → 0.18`,
  text `--text-soft → #fff`, `--transition-fast`.
- **Primary (accent) button:** bg `accent → accent @ +8% lightness`, `translateY(-1px)`, soft accent
  shadow. `:active { translateY(0) scale(0.98) }`.
- **Rows (cards, table rows, list items):** bg `→ rgba(255,255,255,0.03)`, border `→ 0.12`.
- **Icon buttons** already do this well via `.ic-btn` — use that pattern as the template.

### 1.6 Focus & a11y floor
The single authoritative `:focus-visible` ring is correct and present. Gaps to close:
- The `<select>` language dropdown, the CodeMirror surface, video/canvas elements, and several
  inline-styled buttons need to inherit it (some use `outline:none` without a replacement).
- **Tap targets:** several controls are 30–38px. Min **40px** height for primary controls; the
  login submit (40px) is the floor, not the ceiling.
- **Color is never the only signal.** Footer proctoring status and verdict badges rely on hue alone —
  add an icon/shape (see §5.7, §5.5). ~8% of male candidates are red/green colorblind; "AC green vs
  WA red" is exactly the worst case.
- **Contrast:** `--text-faint` (0.45 ≈ #737373 on #0F0F0F) is ~3.1:1 — fine for decorative labels,
  **fails AA for any body copy.** Never use faint for sentences; dim (0.58) is the body-muted floor.

---

## 2. Welcome / launch screen (`app/page.tsx` → `/login` redirect; styles `.welcome-*`)

> Note: `app/page.tsx` currently just redirects to `/login`; the rich `.welcome-*` styles in
> `globals.css` are the animated launch screen. Audited as the brand entry point.

**Current state.** Full-bleed `#030610` canvas, three stacked radial violet glows on an 8s breathe
loop, centered SVG mark with drop-shadow bloom, wordmark Inter **200 weight / 0.60em tracking / 26px**,
a gradient CTA pill (`linear-gradient(140deg,#5e18b0,#9333ea,accent-light)`, `14px 64px` padding,
radius 10px, 10.5px/0.32em uppercase label, multi-layer glow + `translateY(-3px) scale(1.018)` hover).
Staggered fade-in choreography on corners/logo/tagline/footer.

**What's genuinely good.** The page-load choreography and the hairline gradient rule are tasteful.
The thin-weight, wide-tracked wordmark is a real type statement and the most premium thing in the app.

**Issues.**
1. **It's the AI-default look in its purest form** — near-black + stacked bright-violet blooms +
   gradient CTA. Three overlapping glows (`welcome-glow-primary/secondary/rim` + logo glow) is "spend
   boldness everywhere," the opposite of restraint.
2. **CTA label is 10.5px** on a button with 64px horizontal padding — a huge button whispering. The
   label is the call to action; it should be legible.
3. **Canvas is `#030610`** — a blue-black that exists nowhere else (the app is `#0F0F0F` neutral
   obsidian). Another one-off background.
4. **The gradient pill** competes with the wordmark for "hero." Two heroes = no hero.

**Recommendations.**
- **Cut one glow.** Keep `welcome-glow-secondary` (the tight hotspot under the mark) + the logo bloom;
  drop `welcome-glow-primary` or `welcome-glow-rim`. Chanel rule: remove one accessory.
- **Make the wordmark the sole hero.** Let the mark + thin-weight wordmark carry the screen; demote
  the CTA to a quieter, confident button: solid `--surface-2` fill, 1px accent border, **13px/0.18em**
  label (not 10.5px), keep the lift-on-hover but drop the heavy multi-glow to a single
  `0 8px 24px rgb(var(--accent-rgb)/0.25)`.
- **Normalize the canvas to `--surface-0` (#0B0B0E)** so the entry matches the rest of the app; keep
  the violet strictly in the glow, not the base.
- Net effect: the violet now *means* "AMS," because it isn't smeared across every surface.

---

## 3. Login (`app/login/page.tsx` + `.login-*`)

**Layout.** Two-pane grid `44% / 1fr`. Left = brand pane (`#141414`), right = form (`#0F0F0F`).
Root font is JetBrains Mono. Left pane hidden below 720px.

### 3.1 The primary button is dressed as a secondary one — **highest-priority fix on this screen**
`.login-submit` (the single most important control in the app's funnel) currently renders as an
**outline/ghost** button: `background: obsidian-raised`, `color: accent`, `1px accent border`,
`11px uppercase`, fills to solid accent only **on hover**.

- **Issue:** resting state reads as a secondary action. The 11px uppercase label is tiny for the hero
  CTA. A first-time, stressed candidate scans for "the button to press" and finds a faint outline.
- **Recommendation:** make it solid by default —
  `background: var(--color-accent-base); color:#fff; border:1px solid var(--color-accent-base);`
  label **13px**, weight 700, keep uppercase + 0.04em tracking, `min-height: 44px`, radius
  `--radius-md`. Hover → `+6% lightness` + `translateY(-1px)` + `0 4px 14px rgb(var(--accent-rgb)/0.3)`;
  active → `scale(0.98)`. Disabled stays as-is (muted, `not-allowed`).

### 3.2 Inputs
`.login-input`: `12px` mono, padding `11px 13px`, radius 8px, bg `#0A0A0A`, focus border accent@0.45.
- **Issue:** 12px is below comfortable for a field a user types an email/password into; label is
  `11px/0.08em uppercase` which is good. The mono-everywhere choice makes the email field feel like a
  terminal command, which is on-brand but borderline for the password dots.
- **Recommendation:** input text → **13px**; increase padding to `12px 14px` (44px total height to
  match the button); keep mono (it's a deliberate, defensible choice here). Add a subtle
  `background:#0D0D0D` on focus (already present) — good.

### 3.3 Secondary links ("Forgot password?", "Can't sign in? Get help")
Currently **inline-styled** underlined text buttons (`color: accent`, `padding:0`, `font:inherit`).
- **Issue:** inline styles bypass the system; tap targets are text-height only (~16px); two underlined
  accent links sit at equal weight with no hierarchy.
- **Recommendation:** promote to a `.login-textlink` class: `--text-xs`, `--text-dim` color,
  accent on hover with underline appearing on hover (not at rest), `padding: 6px 2px` for a real
  hit area. "Get help" is the rarer action — keep it visually lighter than "Forgot password?".

### 3.4 The `#141414` left pane
- **Issue:** one-off surface (everything else is `#0F0F0F`/`#1F1F1F`/surface ramp).
- **Recommendation:** use `--surface-1` (#131318) for the brand pane and `--surface-0` for the form
  pane, so the split reads as the elevation ramp, not two arbitrary grays.

### 3.5 Brand pane content (good, keep)
"Your contest. **Made fair.**" headline (22px/700, accent `em`) + three feature rows with iconed
chips is well-judged, calm, and on-message. Only nit: feature description copy is `11px/--text-faint`
— bump to `--text-xs` (12px) `--text-dim` for AA legibility (it's a full sentence).

---

## 4. Home dashboard (`app/home/page.tsx` + `home/components/*`)

The control center: collapsible sidebar (nav + profile + sign-out), header, and panels (Contests,
Session Actions, Readiness, Settings, Diagnostics, Security log) + two modals.

### 4.1 Sidebar
- **Nav items** (40px tall, radius 8px, gap **2px**, active = 3px left bar + accent-tint fill,
  weight 400→500 on active). Issues: 2px gap is cramped; the 400→500 weight swap on active causes a
  sub-pixel text reflow; non-active items have **no hover**. Fix: gap → **6px**; add hover bg
  `rgba(255,255,255,0.04)` (the `.home-nav-btn` class already does this — ensure every item uses it);
  keep weight constant and signal active with the left bar + fill only (no reflow); left bar **3→4px**,
  seated at `left:0`.
- **Profile row & avatar:** avatar gradient is hard-coded `#7c3aed→#8b5cf6` — **off the accent token**;
  border/bg only appear when expanded → abrupt. Fix: drive gradient from `--accent-rgb`/
  `--accent-light-rgb`; make border always-present `1px solid transparent` and fade color in to avoid
  layout shift.
- **Sign-out:** good `.ic-btn`-style hover, but hover color jumps to full `#ef4444` which is heavy for
  a routine action. Fix: hover text `rgba(239,68,68,0.75)`, add `1px` transparent→`rgba(239,68,68,0.2)`
  border; gap 10→8px.

### 4.2 Header
36/24px asymmetric vertical padding; title 24px/**600**/`-0.015em`; subtitle 13px/`--text-muted` with
a bold mono email.
- **Issues:** negative tracking on a 24px title slightly muddies it; title weight 600 is light for the
  page's primary heading; the bold-mono email competes with the title.
- **Recommendations:** title → **700**, tracking `0` (or `+0.005em`); even the vertical padding to
  `28px/24px`; email → mono **500** (not bold) so the title clearly wins the hierarchy; explicit
  `background: var(--surface-0)` on the header to avoid scroll bleed; nudge border to `0.08`.

### 4.3 Contest cards (`ContestCards.tsx`)
Radius **10px** (off-scale), `1px` base border → accent@0.35 on hover, **3px** colored left rail,
hero timer **30px** mono, primary action button.
- **Issues:** 10px radius; ended/unavailable state only dims to `0.85` (reads like a bug, not
  "disabled"); long titles have no truncation; the hero timer at 30px mono is loud; action button is
  full-width and its icon doesn't animate.
- **Recommendations:** radius → `--radius-lg` (12px) for the hero card, rail **3→2px**; ended opacity
  `0.85 → 0.6`; title `max-width:100%; overflow:hidden; text-overflow:ellipsis`; hero timer
  `30 → 26px`, `line-height:1.1`, label rendered in the same mono+uppercase for unity; on the CTA add
  `Play` icon `translateX(2px)` on hover and a loading state for async entry.

### 4.4 Panels, inputs, readiness, settings, diagnostics
Recurring, fixable patterns (full element-by-element list lives in the working notes; the systemic
fixes):
- **Section labels** are `10–11px` at mixed weights/tracking and mixed slate colors → standardize to
  **11px / 600 / 0.1em / `--text-faint`** everywhere (it's a label, faint is acceptable for 2–3 words).
- **Buttons** vary (`96px` min-width, `180px` fixed, `9px 16px` vs `10px 18px`) and text reflows on
  state change ("Validate"→"Checking") → use `width:auto; padding:0 16px; min-width:` only where the
  label changes length; pad to a **40px** min-height; one `transition: --transition-fast`.
- **Readiness checklist item:** `font-weight:550` (doesn't exist → silently falls back) → **500**;
  min-height 48→44px; the "Resolve" action is a **danger** variant for a routine fix → make it
  **secondary**.
- **Settings tabs:** active fill uses full `accentLight` (bright, eye-straining for a settings sidebar)
  → drop to `rgb(var(--accent-rgb)/0.08)`; left bar 3→2px; keep weight constant.
- **Camera preview** uses `aspect-ratio:1.6` (arbitrary) → `16/9`; **mic level bar** 8→12px tall with
  `transition: width 100ms linear` so it reads as a live meter; sliders use browser-default thumbs →
  style track/thumb with `accent-color`.
- **Modals (`SessionReadinessModal`, `ResolveModal`):** ensure backdrop `rgba(0,0,0,0.6)` + fade-in,
  `max-width: 560px`, focus trap, `--elevation-3`. (Shared modal recommendation in §6.)

---

## 5. Onboarding — the 15-stage readiness flow (`session/onboarding/page.tsx`)

This is the highest-leverage screen in the whole app: it's the first deep impression, it's where
trust is won or lost, and it contains the app's two drama moments. It is currently **functionally
excellent and visually the least finished** — the most `2px` radii, hard-coded grays, and ad-hoc
inline button styles live here.

### 5.1 The stage frame
480px max-width card, `36px 40px` padding, **`1px rgba(255,255,255,0.06)`** border, radius 12px,
heavy `0 24px 60px` shadow, `transition: all 300ms ease`.
- **Issues:** the border at 0.06 alpha is ~1.1:1 on `#0F0F0F` — effectively invisible, so the card has
  no edge; generic `ease` instead of cinematic.
- **Recommendations:** border → `rgba(255,255,255,0.12)` (`--theme-border-strong`); shadow → map to
  `--elevation-3`; `transition: --transition-standard`.

### 5.2 The progress stepper — **redesign, don't tweak**
15 bars, **4px** tall, 4px gap, colors pass/warn/checking/pending where pending is `rgba(255,255,255,
0.06)` (invisible). The code *computes* five semantic phase groups (Workspace Lockdown / System Checks
/ Media / Identity / Finalizing) **but never renders them.**
- **Issue:** 15 undifferentiated 4px ticks is noise, not progress. A candidate can't tell "where am I
  / how much is left / what's this phase about." The single most impactful visual change in onboarding.
- **Recommendation:** render the phases. Group the ticks into the five labeled clusters with a small
  uppercase phase label and a gap between groups; current phase tick becomes a **28×28** numbered cell
  (pass = green outline + check, checking = white outline + pulse, pending = `0.04` fill). Pending tick
  color → `rgba(255,255,255,0.15)` minimum. This converts a progress bar into a *map*.

### 5.3 Per-stage consistency (applies to stages 1–13)
- Stage headers are **17px** (off-scale) → **19px** (`--text-lg`).
- Info boxes / video frames / network box all use **`borderRadius:2px`** → `--radius-sm` (6px).
- Hard-coded `#A8A8A8 / #64748b / #71717a / #eab308` → `--text-dim` / `--text-faint` /
  `--color-indicator-warn` (#f59e0b). The lone `#eab308` warning yellow is a different hue from the
  token warn color — it visibly clashes when two warnings show at once.
- **Inline button styles everywhere** (Open Settings / Re-check / Skip / Try again) with no hover,
  no focus, hard-coded colors → introduce one `buttonStyle(variant)` helper (primary/secondary/danger)
  used by every stage so a candidate sees one button language across all 15 steps.
- Camera previews are **240×160 on stage 8 but 220×165 on stage 10** for no reason → unify to 240×160.

### 5.4 Stage 9 — Face calibration (drama moment #1)
The most complex stage; currently reads clinical (small 11px mono metrics in a server-log grid, a 3px
lock-progress bar, `transition: width 80ms linear`, no celebration on capture).
- **Recommendations:** lift the live metric to a **`--text-base` label + 18px value** two-up grid
  (Tracking / Progress) instead of a log dump; lock bar **3→6px**, radius-sm, `transition: width 200ms
  cubic-bezier`; on successful capture, a brief border-pulse + the existing flash (keep) + the audio
  cue, so the success registers visually as well as audibly; the crosshair guide should subtly
  pulse while a face is tracked rather than sit static.

### 5.5 Stage 14 — Lock-in countdown (drama moment #2) — **biggest emotional miss**
Today: a `240×100` box, **`2px`** radius, `1px@0.06` border (invisible), 44px number that just
updates, 5 static fill bars. It's the threshold into a locked, monitored exam — it should feel like a
launch, and right now it feels like a loading spinner.
- **Recommendations:**
  - Frame **320×140**, `--radius-lg`, visible `2px` border, a soft radial glow behind the number.
  - Number **44px → keep at the new `--text-3xl`**, add `text-shadow` glow and a per-tick
    `scale(1.0→1.12→1.0)` pulse on cinematic easing.
  - **Color urgency:** white at 5–3, **shift to `--color-error` at ≤2s**, with the glow/box-shadow
    color following. This is the one place urgency color is *earned*.
  - Fill bars: animate each (`height` shrink + fade) as it elapses, with a `0 0 8px` glow on lit bars.
  - Respect `prefers-reduced-motion` (the global rule already neutralizes this — verify the pulse
    degrades to a simple color step).

### 5.6 Stages 10–13 polish
Audio threshold line `rgba(255,255,255,0.15)` is too faint → `0.25`/`--theme-border-strong` with a
small bg chip behind the "−24dB threshold" label; network latency value uses off-scale `20px` and
hard-coded quality color → scale value + tokenized verdict colors; integrity grid `rowGap:10px` is
tight → 12–16px.

---

## 6. Contest IDE — the exam screen (`session/contest/client.tsx`, `editor-pane.tsx`, `VerdictBadge`)

The screen a candidate lives in for hours. Density, legibility, and the verdict moment dominate.

### 6.1 Top bar + countdown timer
48px bar, centered 28×28 circular-progress timer, mono digits.
- **Issues:** the ring is too subtle at rest (low-opacity violet on near-black); urgency is signaled by
  **color alone** with a barely-perceptible `opacity 1→0.45` pulse; ring color transition (600ms) and
  ring sweep (1s) are desynced; no explicit expired/frozen state.
- **Recommendations:** define explicit thresholds — **nominal (>6m)** accent, **warning (≤6m)** amber,
  **critical (≤1m)** red + a **scale(0.98) shape pulse** (shape change beats opacity on dark) + a
  containing pill with tinted bg, **expired (0)** muted + frozen full ring + a small lock glyph.
  Sync ring color and sweep to one duration. Raise bar to 52px so the timer breathes.

### 6.2 Problem-nav sidebar
Collapsible 52/220px. Question status badges **hard-code** `#22c55e/#ef4444/...` instead of the
`--verdict-*` tokens (drift risk); collapsed mode shrinks status to a 7px dot with glow only when
active; active-item border at accent@0.30 is barely visible.
- **Recommendations:** route every status color through `--verdict-*`; collapsed status dot **9px** +
  always-on `0 0 6px currentColor`; active border → accent@0.5 **or** a 2px left edge.

### 6.3 Problem statement pane
26px/700 title at `line-height:1.2` (tight for wrapping titles); splitter affordance is five 3px dots
at 0.32 alpha (nearly invisible); no body line-height set; no loading skeleton.
- **Recommendations:** title `line-height 1.3`; **set `pb-body-editorial { line-height:1.65 }`** and
  style inline `<code>` (mono, 12px, `rgb(var(--accent-rgb)/0.08)` bg, 2px 4px pad, radius 3px) — this
  is what makes CP statements actually readable; replace splitter dots with a 2px/16px bar that
  thickens + brightens on hover (`title="Drag to resize"`); add a 4-line shimmer skeleton while the
  statement loads.

### 6.4 Editor chrome — **Run vs Submit hierarchy is the key fix**
Both are 40px; Submit is filled accent (good), Run is outline (good) — but weights (500 vs 600) and
sizes are close enough that under stress they look peer.
- **Recommendations:** widen the visual gap — **Run** stays a quiet outline (transparent bg, 1px
  neutral border, `--text-soft`); **Submit** is unmistakably dominant (solid accent, white,
  `translateY(-1px)` + accent shadow on hover, `scale(1.02)`). Add disabled tooltips ("Enter code
  first" / "Saving…"). Save indicator is too easy to miss mid-flow → add a persistent 6px dot in the
  editor corner (green saved / amber dirty / red error) with an error tooltip. Language `<select>`
  has no focus ring → wrap and apply the global ring; render the current language in mono.

### 6.5 CodeMirror surface
Line-height **1.7** (loose for dense CP code), selection `accent@0.26` (hard to see), active line
`accent@0.045` (invisible), gutter text `#475569` (low contrast), solid non-blinking caret.
- **Recommendations:** line-height **1.5** for dark themes (keep 1.7 for High Contrast); selection
  → `accent@0.40`; active line → `accent@0.08` or a 2px left edge; gutter `#475569 → #64748b`
  (or `--text-dim`); offer a blink-cursor toggle in settings; lift autocomplete tooltip bg to
  `--surface-2` with a 6px radius and clear selected-item highlight.

### 6.6 The verdict moment (drama moment, contest screen) + VerdictBadge
- **The result currently arrives silently** — badge text just changes. This is the single most
  emotionally charged interaction in a contest. Recommendation: on transition to a terminal verdict,
  **scale the badge 1.0→1.1** + `0 0 12px` glow in the verdict color over 300ms cinematic; AC gets a
  gentle `1→1.05→1` celebratory pulse; pending RUNNING shows a 12px spinner + elapsed counter, not
  static text.
- **VerdictBadge contrast (a11y):** `CE #a78bfa` (~4:1) and `IE #94a3b8` (~3.5:1) are borderline/fail
  for <14px text; **`UNATTEMPTED rgba(255,255,255,0.18)` is invisible** (~1:1). Fix: brighten CE/IE,
  set unattempted to `#64748b`/`--text-dim`. Add an **icon per verdict** (✓ / ✗ / clock / ⚡ / ⚠) so
  it's not color-only, and `aria-label` the full label. Radius `5px → 6px`. Provide a static
  CSS-var tint fallback alongside `color-mix()`.

### 6.7 Submissions & test results
Dense attempt rows; verdict chip blends into muted text; redundant "Evaluated" badge eats width;
expanded detail bg `#0a0a0a` is indistinguishable from the `#0F0F0F` pane; no sample-vs-hidden test
distinction.
- **Recommendations:** move the **verdict chip to the left edge** of each row (most important info
  first), make it the row's visual anchor; drop "Evaluated" (the verdict implies it); expanded bg →
  `#111` or a 2px accent left-edge; pass/fail test rows colored green/red with a small "Hidden" tag;
  `font-variant-numeric: tabular-nums` on all runtime/memory so columns align.

### 6.7b Footer proctoring trust strip
36px, 10px text, 6px status dots, **color-only** status.
- **Recommendations:** text **10→11px**, dots **6→8px** with a glow on critical states, and an
  **icon beside each** (shield / wifi / lock / save) so colorblind candidates and glance-reading both
  work; "Reconnecting…" gets a spinner + a fallback "Offline" after ~10s; animate status transitions
  (200ms color fade) so "Saving…→Saved" is noticed.

### 6.8 Contest modals (face soft-block, media warning, time's-up, support)
Arbitrary z-indices (`9998/9999/99999`); inconsistent border hues (violet vs amber); **the time's-up
overlay is non-dismissible** (traps a candidate if auto-submit can't reach the network); extreme
backdrop blur/brightness can disorient.
- **Recommendations:** a `--modal-z-*` stack scale; unify proctoring-modal borders to accent (reserve
  amber strictly for "you can still proceed" warnings); give the time's-up overlay a manual
  "Back to home"/"Check status" path that's always usable and raise its low-contrast secondary button
  (`bg 0.06→0.08`, text → `#cbd5e1`); dial blur back (`32→16px`, brightness `0.3→0.5`).

---

## 7. Results + shared components (`results/page.tsx`, `HelpRequestModal`, loading shells)

### 7.1 The results reveal — make it feel earned
- **Summary banner** (rank/score/solved/penalty) sits on `accent@0.08` — too faint to read as "this
  is your result." Fix: tint → `0.12`, border → `0.30`, add `--elevation-1`, and a one-time
  `slideDown + fade` reveal (`--transition-slow`). The four stat cells over-emphasize Rank (28px
  accent vs 24px white) — **unify to 24px/700/white** and signal Rank by position/order, not a special
  color (accent on a number reads as a link).
- **Header:** title 22px/600 → **24px/700** (`--text-xl`, display weight); off-token slate label →
  `--text-faint`.

### 7.2 Tables (problem breakdown + leaderboard)
Faint `0.04` borders (→ `0.07`), `#475569` headers (→ `--text-dim`), no row hover, no striping, the
**"YOU" marker is plain inline text** not a badge, and current-user row bg is hard-coded purple.
- **Recommendations:** add row hover (`rgba(255,255,255,0.018)`) and a subtle odd-row stripe; promote
  "YOU" to a real chip (accent tint bg, 1px accent border, 9px/700 uppercase); drive the is-me row bg
  from `--accent-rgb`; verdict dots already `role="img"` + label — good, keep; use `tabular-nums`.

### 7.3 Empty / locked / error / loading states
- **Locked (embargo) screen:** title 600→**700**; off-token grays → dim; add button hover.
- **Error screen:** add an error glyph beside the message + a `slideDown` entrance; primary button
  hard-codes `#7c3aed` → `--color-accent-deep`; secondary needs hover.
- **Loading shells (home/onboarding/contest/results):** **all are text-only with no spinner** — the
  most "unfinished" tell on app cold-start. Add the existing `.login-spinner` keyframe as a 28–32px
  ring tinted per route (accent for contest, white for onboarding, soft for home), a gentle text
  pulse, and a `fadeIn`. Unify the three different label colors to an intentional ramp.

### 7.4 HelpRequestModal (shared)
Backdrop `rgba(7,10,16,0.72)` (near-opaque) → `0.55`; content bg `#0d1117` (GitHub's color, off-system)
→ `--surface-1`; no entrance animation → `scale(0.92→1) + fade` on cinematic; `--elevation-3` shadow;
inputs should use mono (per the global input rule) and get an explicit focus bg shift; the two footer
buttons are `flex:1` equal-width so "Cancel" looks as important as "Send to organizer" → ghost button
`flex:0 1 auto`, primary `flex:1`; add hover + disabled (`opacity .6`) states; make the success
reference-ID `user-select:all` (copyable) with a small label.

---

## 8. Priority matrix — what I'd ship, in order

**P0 — before any real contest (trust + a11y + the funnel):**
1. Login: make the submit button a real primary (solid, 13px). (§3.1)
2. Onboarding: render the **phase-grouped stepper** + kill all `2px` radii + tokenize grays. (§5.2–5.3)
3. Lock-in countdown redesign (drama #1). (§5.5)
4. Contest: verdict-moment animation + **VerdictBadge contrast/icons + visible UNATTEMPTED** (a11y).
   (§6.6)
5. Contest: timer urgency states (not color-only); footer status icons (colorblind). (§6.1, §6.7b)
6. Time's-up modal: add an always-usable escape path. (§6.8)
7. Add hover states to every interactive element app-wide. (§1.5)
8. Loading shells: add spinners. (§7.3)

**P1 — production polish:**
9. Run/Submit hierarchy + persistent save indicator. (§6.4)
10. CodeMirror legibility (line-height, selection, active line, gutter). (§6.5)
11. Problem-statement readability (body line-height + inline code). (§6.3)
12. Results reveal animation + table hover/stripes + "YOU" badge. (§7.1–7.2)
13. Home: sidebar/nav hover + active-state reflow fix + card radius/timer. (§4.1, §4.3)
14. Shared modal system (backdrop, scale-in, elevation, focus trap). (§6.8, §7.4)

**P2 — system hardening (do once, in `globals.css`):**
15. Adopt the radius/type/color/transition rules in §1 and migrate screens off one-off values.
16. Welcome screen restraint pass (cut a glow, quiet the CTA, normalize canvas). (§2)
17. Settings/diagnostics control standardization. (§4.4)

---

## 9. Closing

The bones are strong: a real token system, a meaningful type pairing, an existing focus/motion floor.
What separates this from "ships at Google/Apple" is **discipline and two moments of theater.**
Discipline = the screens must actually consume the tokens they were given, and every clickable thing
must answer the cursor. Theater = the lock-in countdown and the verdict are the only two places a
candidate's pulse moves, and both currently pass in silence — give those two moments real motion and
spend your boldness there, while keeping everything around them quiet. Do the P0 list and this stops
reading as "a capable internal tool" and starts reading as "a product I trust with my exam."

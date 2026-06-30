# AMS Access — Frontend "Finished Product" Upgrade Plan + Dual Theme

**Scope:** the candidate desktop app only (`apps/web`): Welcome → Login → Home → 15‑stage
Onboarding → Contest IDE → Results, plus shared modals/loading shells.
**Goal:** stop reading as "a capable internal tool in testing," start reading as "a premium product
I trust with my high‑stakes exam" — and ship **two** first‑class themes: a refined **dark** (escape
the AI‑default look) and a new **light** (cream + rich purple pastel).

This builds on the existing `final-design.md` dark‑mode audit (excellent, element‑level) rather than
repeating it. Where this doc says "see FD §x," that's the deep per‑element list.

---

## 0. What separates "finished" from "testing build" (the lens)

Three things, repeatedly, across every screen:

1. **Discipline beats decoration.** Premium UI isn't more effects — it's the _same_ radius, spacing,
   type, and color everywhere, used with restraint. The app already has a real token system; the
   screens just don't all consume it. Hard‑coded `#475569`, `2px` radii, and a dozen one‑off button
   styles are the single biggest "unfinished" tell.
2. **Every clickable thing answers the cursor.** On a desktop/Tauri app with a real pointer, missing
   hover ≈ broken. ~40% of interactive elements have no resting→hover delta today.
3. **Theater is spent in exactly two places.** The lock‑in countdown and the verdict are the only two
   moments a candidate's pulse moves. Both currently pass in silence. Spend boldness there; keep
   everything else quiet.

**Research anchors (verified, cited):**

- Lockdown shell = full‑screen, chrome‑stripped, can't leave to other apps. _(Proctorio, 3‑0)_
- Pre‑exam readiness is a real gated flow: auto background compat check → cam/mic grants →
  screen‑share → face photo → ID; "unplug extra monitors" is a hard gate. _(Mettl, Proctorio, 3‑0)_
- In‑exam chrome convention: **timer top‑right**, **question palette top‑center**, **section switch
  top‑left**. _(Mettl, 3‑0)_ — our timer is top‑center; see §Contest.
- Identity verify + room scan belong in the readiness flow. _(Honorlock, 3‑0)_
- WCAG AA: **4.5:1** normal text, **3:1** large text (≥18px or ≥14px bold), **3:1** for UI
  components/graphics & focus indicators. _(WebAIM, 3‑0)_ — this governs both palettes below.
- A 10‑tier lightness scale spans ~1:1→11.7:1 vs white — use graded tiers for surfaces/text.
  _(accessiblepalette.com, 2‑0)_

**Credible design guidance (from reputable sources; verification rate‑limited, treat as strong
priors, not gospel):**

- Dark backgrounds should sit ~**8–14% lightness**, _not_ pure black, with a **2–4° hue shift** for
  character; near‑black range **#0A0A0A–#161616**. _(colorarchive, muz.li, devpalettes)_
- Dark elevation by **+4–8% luminance per tier** (lighter as it rises), not by drop shadow.
  _(colorarchive, muz.li — Material tonal elevation)_
- **Desaturate accents ~15–30%** in dark; saturated hues "vibrate" / read neon on near‑black; the
  accent should also shift **lighter** in dark. _(colorarchive, devpalettes, fourzerothree)_
- Cream+violet light references: "Lavender Fog" `#F3F0FF/#FAF8FF + #E9E3FF/#D6CCFF`; premium high‑key
  light `#FAFAFA bg / #F0F4FF surface / #1A1A2E text / #6C63FF accent`. _(designyourway, colorfyi)_

---

## 1. The two color systems (the headline deliverable)

### 1.1 How theming actually works here (and why light mode is ~80% built)

`getThemeColors()` returns **CSS‑var references** (`var(--theme-bg)`, …), not literal colors. There's
a `:root`/`.dark` block defining `--theme-*`, but **no `.light` block**, and `home/page.tsx` (and
peers) hard‑pin dark via `document.documentElement.className = "dark"`. So light mode =

1. author a `.light` token block (below),
2. stop force‑pinning dark + persist the choice,
3. wire the existing `setTheme` toggle to set `className` + `localStorage`.

**Caveat that gates everything:** components that hard‑code `#0F0F0F`, `#475569`, `#7c3aed`, etc.
will **not** flip — they'll show dark patches in light mode. So **tokenize first, theme second**
(§2.1). This is the same discipline fix that improves dark mode, so it pays double.

### 1.2 Refined DARK palette — escape "near‑black + one bright violet"

The current accent `#A855F7` (purple‑500) is the neon, magenta‑leaning violet that _is_ the
AI‑default. Two moves fix the whole mood: (a) give the obsidian a faint **violet undertone** so the
accent looks integrated, not pasted on; (b) split the accent into a **calmer fill** + a **pastel
lavender** for text/highlights, and reserve bright violet for small accents.

```css
.dark {
  color-scheme: dark;

  /* Accent: violet‑500 fill (calmer than purple‑500), lavender‑300 for text/highlight */
  --accent-rgb: 139 92 246; /* #8B5CF6  fills, focus, scrollbar */
  --accent-light-rgb: 196 181 253; /* #C4B5FD  pastel lavender — text, active labels, glows */

  /* Surfaces — obsidian with a faint 260° violet undertone; tonal elevation (+~5% luminance/tier) */
  --theme-bg: #0d0c12; /* page  (was #0F0F0F neutral) */
  --theme-sidebar-bg: #16151c; /* nav / rails */
  --theme-card-bg: #16151c; /* cards / panels */
  --theme-inner-bg: #1f1e27; /* inset / inputs */
  --theme-border: rgba(255, 255, 255, 0.07);
  --theme-border-strong: rgba(255, 255, 255, 0.14);

  --theme-text: #f4f2f7; /* not pure #fff — a hair warm, less glare over hours */
  --theme-text-muted: rgba(244, 242, 247, 0.6);
  --theme-text-muted-strong: rgba(244, 242, 247, 0.8);

  --theme-accent: #8b5cf6; /* fill */
  --theme-accent-light: rgb(139 92 246 / 0.14); /* tint bg: chips, active rows */
  --theme-accent-border: rgb(139 92 246 / 0.34);
  --theme-accent-text: #c4b5fd; /* accent text on dark = pastel lavender */
  --theme-console-text: rgba(244, 242, 247, 0.74);

  /* Depth via layered shadow (kept) — paired with the luminance step above */
  --theme-shadow: 0 2px 6px rgba(0, 0, 0, 0.34), 0 10px 28px rgba(0, 0, 0, 0.3);
  --theme-shadow-hover: 0 14px 38px rgb(139 92 246 / 0.16);
  --theme-dot: #34d399; /* emerald‑400, slightly desaturated vs #22c55e */
}
/* keep :root mirroring .dark so SSR first paint matches */
```

Surface ramp (override the `:root` `--surface-*` inside `.dark` too, so they share the undertone):
`--surface-0:#0B0A0F; --surface-1:#15141B; --surface-2:#1E1D26;`

**Contrast notes (dark):** `#C4B5FD` on `#0D0C12` ≈ 9:1 (AAA). White on `#8B5CF6` fill ≈ 3.6:1 → use
button labels at **≥14px/600** (qualifies as large text, 3:1) or darken the fill to `#7C3AED` for
small‑label buttons. `--theme-text-muted` 0.60 ≈ 4.8:1 (AA body ✓); never go below 0.58 for
sentences.

### 1.3 New LIGHT palette — cream + rich purple pastel

Cream (warm off‑white) surfaces, **plum‑ink** text (not pure black — warmer, ties to the hue), and a
**rich purple** that's deep enough to hit AA on cream. Pastels (`#C4B5FD`, `#DDD6FE`) are for tints,
chips, and illustration — never body text on cream (they'd fail AA).

```css
.light {
  color-scheme: light;

  /* In light, the brand reads richer/darker so it survives on cream */
  --accent-rgb: 124 58 237; /* #7C3AED  fills, focus */
  --accent-light-rgb: 167 139 250; /* #A78BFA  decorative pastel only */

  /* Cream surface ramp — warm, low‑chroma; cards lift via warm‑white + soft shadow */
  --theme-bg: #f6f2ea; /* page — cream */
  --theme-sidebar-bg: #fbf8f2; /* rail — slightly lighter cream */
  --theme-card-bg: #ffffff; /* cards pop clean on cream */
  --theme-inner-bg: #f0eadd; /* inset / inputs — deeper cream */
  --theme-border: rgba(60, 42, 90, 0.12);
  --theme-border-strong: rgba(60, 42, 90, 0.22);

  --theme-text: #231b30; /* deep plum‑ink */
  --theme-text-muted: rgba(35, 27, 48, 0.62);
  --theme-text-muted-strong: rgba(35, 27, 48, 0.82);

  --theme-accent: #7c3aed; /* fill: white text ≈ 5.0:1 AA ✓ */
  --theme-accent-light: rgb(124 58 237 / 0.1); /* pale violet wash: active rows/chips */
  --theme-accent-border: rgb(124 58 237 / 0.28);
  --theme-accent-text: #6d28d9; /* accent text on cream ≈ 6.5:1 AA ✓ */
  --theme-console-text: rgba(35, 27, 48, 0.74);

  /* In light, shadows DO read — use soft, warm, low‑alpha (depth, not grime) */
  --theme-shadow: 0 1px 2px rgba(60, 40, 90, 0.06), 0 10px 28px rgba(60, 40, 90, 0.08);
  --theme-shadow-hover: 0 16px 36px rgba(124, 58, 237, 0.14);
  --theme-dot: #16a34a;
}
```

Light surface ramp: `--surface-0:#F6F2EA; --surface-1:#FFFFFF; --surface-2:#F0EADD;`

**Contrast notes (light):** text `#231B30` on cream ≈ 13:1 (AAA). Accent text `#6D28D9` ≈ 6.5:1 (AA✓).
Muted 0.62 ≈ 4.6:1 (AA body ✓). White on `#7C3AED` fill ≈ 5.0:1 (AA✓ for any size).

### 1.4 Semantic + verdict colors must become theme‑aware

Today `--verdict-*`, `--color-success/warn/error/info` live once in `:root` at **dark‑tuned**
brightness (`#22c55e`, `#f59e0b`, `#ef4444`, `#38bdf8`). On cream those are too light → AA fail.
Override them per theme:

| Token          | Dark                  | Light (darker for cream) |
| -------------- | --------------------- | ------------------------ |
| success / AC   | `#34D399`             | `#15803D`                |
| warn / TLE     | `#FBBF24`             | `#B45309`                |
| error / WA     | `#F87171`             | `#DC2626`                |
| info / RUNNING | `#60A5FA`             | `#2563EB`                |
| RE             | `#FB923C`             | `#C2410C`                |
| MLE            | `#FDBA74`             | `#9A3412`                |
| CE             | `#C4B5FD`             | `#7C3AED`                |
| IE / NONE      | `#CBD5E1` / `#94A3B8` | `#475569` / `#64748B`    |

Always pair color with an **icon/shape** (✓ ✗ ⏱ ⚡ ⚠ ●) — ~8% of men are red/green colorblind and
"AC green vs WA red" is the worst case. _(WCAG 1.4.1 + WebAIM)_

---

## 2. Cross‑cutting upgrades (do once, every screen improves)

### 2.1 Tokenize (the unlock for both themes) — **first task**

Sweep `apps/web` for hard‑coded values and replace with tokens:

- Grays `#475569 #64748b #94a3b8 #cbd5e1` → `--theme-text-muted{,-strong}` / `--text-dim`.
- Backgrounds `#0F0F0F #0A0A0A #141414 #0d1117 #030610` → `--theme-bg / --surface-* / --theme-inner-bg`.
- Violets `#7c3aed #8b5cf6 #9333ea` → `--theme-accent` / `rgb(var(--accent-rgb)/…)`.
- Radii `2px 5px 10px` → `--radius-sm/md/lg`. **Kill `2px` entirely** (the #1 wireframe tell).
- Semantic/verdict literals → the tokens in §1.4.
  Grep helpers: `rg -n '#[0-9a-fA-F]{6}|border-radius:\s*2px|rgba\(255,255,255'` over `src/`.

### 2.2 Hover floor (FD §1.5) — every interactive element gets a resting→hover delta

Ghost btn: bg `transparent→rgba(text,0.06)`, border `0.10→0.18`. Primary: `+6% L` + `translateY(-1px)`

- accent shadow; `:active scale(.98)`. Rows: bg→`rgba(text,0.03)`. One `--transition-fast` everywhere.

### 2.3 Focus + tap targets (FD §1.6)

The one `:focus-visible` ring exists — make `<select>`, CodeMirror, canvas/video, and inline‑styled
buttons inherit it (some use `outline:none` with no replacement). Min **40px** height for primary
controls.

### 2.4 Motion + depth

Route all transitions through `--transition-fast/standard/slow` (kill the 11 hand‑rolled timings).
Dark depth = surface step + hairline + layered shadow (already defined as `--elevation-1/2/3`); light
depth = soft warm shadow. Respect `prefers-reduced-motion` (global rule exists — verify each new
animation degrades to a color/opacity step).

### 2.5 Typography

The Inter (human) + JetBrains Mono (machine) pairing is a real signature — lean in. Standardize to the
scale (`--text-2xs…3xl`); retire off‑scale `10/15/16/17/20/22/26/28px`. Section labels everywhere →
**11px / 600 / 0.1em / uppercase / `--text-faint`**. Reserve `30/44px` for the two display moments.

---

## 3. Page by page, section by section

For each: **current → what reads "testing" → change/upgrade/add**. Element‑level lists are in
`final-design.md`; this is the prioritized, theme‑aware version.

### 3.1 Welcome / launch (`app/page.tsx` + `.welcome-*`) — FD §2

- **Reads testing:** three stacked radial violet blooms on `#030610` (a one‑off blue‑black) + a tiny
  10.5px CTA label on a huge pill = "AI‑default hero." Two heroes (wordmark + gradient pill).
- **Change:** normalize canvas to `--theme-bg`; **cut one glow** (keep the tight hotspot + logo
  bloom). Make the thin‑weight wordmark the sole hero.
- **Upgrade:** demote CTA to a confident quiet button — solid `--surface-2`, 1px accent border, label
  **13px/0.18em** (not 10.5px), single `0 8px 24px rgb(var(--accent-rgb)/0.25)` glow, keep the lift.
- **Add:** light‑mode variant — cream canvas, the bloom becomes a soft `#A78BFA` radial at low alpha;
  wordmark in plum‑ink. **Net:** violet now _means_ "AMS" because it isn't smeared everywhere.

### 3.2 Login (`app/login/page.tsx` + `.login-*`) — FD §3 (funnel‑critical)

- **Reads testing:** the single most important control — `.login-submit` — renders as a **ghost
  outline** (accent text on raised bg) that only fills on hover; 11px uppercase label. A stressed
  first‑timer scans for "the button" and finds a faint outline.
- **Change (highest priority on this screen):** make it a **real primary** — `background:var(--theme-accent);
color:#fff; border:1px solid var(--theme-accent);` label **13px/700/uppercase/0.04em**,
  `min-height:44px`, `--radius-md`; hover `+6% L + translateY(-1px) + accent shadow`; active `scale(.98)`.
- **Upgrade:** inputs → 13px text, `12px 14px` padding (44px tall to match button); keep mono (on‑brand).
  Two‑pane split uses the elevation ramp (`--surface-1` brand pane / `--surface-0` form) not `#141414`.
  Promote "Forgot password?" / "Get help" to a `.login-textlink` class (real 6px hit area, underline
  on hover only, "Get help" visually lighter).
- **Add:** light mode — cream form pane, warm‑white brand pane, plum text; the brand headline
  "Your contest. **Made fair.**" keeps accent on "Made fair."

### 3.3 Home dashboard (`app/home/page.tsx` + `home/components/*`) — FD §4

- **Reads testing:** sidebar nav had no hover + a 400→500 weight swap that sub‑pixel‑reflows text;
  avatar gradient hard‑coded `#7c3aed→#8b5cf6` (off‑token); contest card radius `10px` (off‑scale),
  ended state only dims to `0.85` (looks like a bug), no title truncation; header title weight 600 is
  light and the bold‑mono email competes with it.
- **Change:** nav gap `2→6px`, constant weight, active = 4px left bar + `--theme-accent-light` fill
  only (no reflow), every item uses `.home-nav-btn` hover. Header title → **700 / tracking 0**, email →
  mono **500**. _(Note: the collapsible rail with hover‑expand + pin we just built already lands much
  of this — keep it, apply the weight/gap fixes.)_
- **Upgrade:** contest hero card radius → `--radius-lg`, rail `3→2px`, ended opacity `→0.6`, title
  ellipsis, hero timer `30→26px`, CTA gets a `Play` icon `translateX(2px)` on hover + async loading
  state. Avatar gradient from `--accent-rgb/--accent-light-rgb`.
- **Add:** light mode — cards `#FFFFFF` on cream with `--theme-shadow`; readiness dots use the
  theme‑aware semantic tokens. Settings tabs active fill drops to `rgb(var(--accent-rgb)/0.08)` (the
  full `accentLight` is eye‑straining for a settings rail).

### 3.4 Onboarding — 15‑stage readiness flow (`session/onboarding/page.tsx`) — FD §5 (**highest leverage**)

The first deep impression and home of both drama moments; currently the _least visually finished_
(most `2px` radii, most hard‑coded grays, most ad‑hoc inline buttons).

- **Change — render the phase‑grouped stepper (biggest single win):** the code already computes 5
  semantic phases (Workspace Lockdown / System Checks / Media / Identity / Finalizing) but renders 15
  undifferentiated 4px ticks. Group them into 5 labeled clusters; the current tick becomes a **28×28
  numbered cell** (pass = green outline+check, checking = white outline+pulse, pending = `0.15` fill,
  _not_ the invisible `0.06`). This turns a progress _bar_ into a _map_ — matches the research
  convention that proctoring flows are explicit, sequenced gates _(Mettl/Honorlock)_.
- **Upgrade — per‑stage consistency:** stage headers `17→19px`; all `borderRadius:2px → --radius-sm`;
  one `buttonStyle(variant)` helper (primary/secondary/danger) replacing every inline button so all 15
  steps share one button language; unify camera previews to `240×160`; the lone `#eab308` warning →
  `--color-warning`.
- **Add — Drama #1, Stage 9 Face calibration:** lift live metrics to a 2‑up `label + 18px value`
  (Tracking / Progress) instead of a server‑log dump; lock bar `3→6px` w/ cinematic ease; border‑pulse
  - flash + audio cue on capture so success registers.
- **Add — Drama #2, Stage 14 Lock‑in countdown (biggest emotional miss):** frame `240×100 → 320×140`,
  `--radius-lg`, visible border, radial glow behind the number; number at `--text-3xl` with a per‑tick
  `scale(1→1.12→1)` pulse + glow; **shift white→`--color-error` at ≤2s** (the one place urgency color
  is earned); animate each fill bar as it elapses. This is the threshold into a locked, monitored exam
  — it should feel like a launch, not a spinner.

### 3.5 Contest IDE — the exam screen (`session/contest/client.tsx`, `editor-pane.tsx`, `VerdictBadge`) — FD §6

The screen they live in for hours; density, legibility, and the verdict dominate.

- **Reads testing:** verdict arrives **silently** (badge text just changes); timer urgency is
  color‑only with a barely‑perceptible opacity pulse; question status badges hard‑code `#22c55e/#ef4444`
  (off the verdict tokens); `UNATTEMPTED rgba(255,255,255,0.18)` is invisible (~1:1, a11y fail); Run
  vs Submit look like peers under stress; CodeMirror line‑height 1.7 is loose for dense CP code,
  selection `accent@0.26` hard to see.
- **Change — the verdict moment (the one emotional payload):** on transition to a terminal verdict,
  **scale badge 1.0→1.1 + `0 0 12px` glow** in the verdict color over 300ms cinematic; AC gets a gentle
  `1→1.05→1` celebratory pulse; RUNNING shows a 12px spinner + elapsed counter, not static text.
- **Change — VerdictBadge a11y:** brighten `CE/IE`, set `UNATTEMPTED → --text-dim` (visible), add a
  **per‑verdict icon** + `aria-label`, route every status through `--verdict-*` (theme‑aware per §1.4).
- **Upgrade — timer urgency states (not color‑only):** nominal `>6m` accent, warning `≤6m` amber,
  critical `≤1m` red **+ a `scale(.98)` shape pulse** (shape beats opacity on dark) + tinted pill,
  expired = muted frozen ring + lock glyph; sync ring color and sweep to one duration. _(Convention is
  timer top‑right per Mettl; ours is centered — acceptable, but make it unmistakable.)_
- **Upgrade — Run/Submit hierarchy:** Run = quiet outline; Submit = unmistakably dominant (solid
  accent, white, lift + accent shadow on hover, `scale(1.02)`); add a **persistent save dot** (green
  saved / amber dirty / red error) in the editor corner. CodeMirror: line‑height **1.5**, selection
  `accent@0.40`, active line `accent@0.08` or 2px left edge, gutter `--text-dim`.
- **Upgrade — problem statement readability:** body `line-height:1.65`; style inline `<code>` (mono
  12px, `rgb(var(--accent-rgb)/0.08)` bg, 2px 4px pad, radius 3px); replace the near‑invisible 5‑dot
  splitter with a 2px/16px bar that thickens on hover; add a 4‑line shimmer skeleton while loading.
- **Add — safety:** the time's‑up overlay is **non‑dismissible** — give it an always‑usable "Back to
  home / Check status" path (a candidate must never be trapped if auto‑submit can't reach the network).
  Replace arbitrary z‑indices `9998/9999/99999` with the `--modal-z-*` scale.
- **Add — footer trust strip:** text `10→11px`, dots `6→8px` + glow on critical, **an icon beside each**
  (shield / wifi / lock / save) so colorblind + glance‑reading both work; "Reconnecting…" gets a spinner
  - "Offline" fallback after ~10s.
- **Light mode:** the IDE is the one place a candidate may _prefer_ dark for hours — keep dark as the
  default for the exam screen even when the app is in light mode (offer it, don't force light here).

### 3.6 Results + shared (`results/page.tsx`, `HelpRequestModal`, loading shells) — FD §7

- **Reads testing:** the result **banner sits on `accent@0.08`** — too faint to read as "this is your
  result"; Rank is over‑emphasized (28px accent — reads like a link); tables have `0.04` borders, no
  hover, no stripe; "YOU" is plain inline text; **all four loading shells are text‑only, no spinner**
  (the most "unfinished" cold‑start tell).
- **Change — make the reveal feel earned:** banner tint `0.08→0.12`, border `→0.30`, `--elevation-1`,
  one‑time `slideDown+fade` (`--transition-slow`); unify the four stat cells to `24px/700/white`,
  signal Rank by order not color.
- **Upgrade — tables:** row hover `rgba(text,0.018)` + subtle odd‑row stripe; promote "YOU" to a real
  accent chip; is‑me row bg from `--accent-rgb`; `font-variant-numeric:tabular-nums` on all
  runtime/memory/score columns.
- **Add — loading shells:** the `.login-spinner` keyframe as a 28–32px ring tinted per route (accent
  for contest, white for onboarding, soft for home) + gentle text pulse + `fadeIn`.
- **Upgrade — HelpRequestModal:** backdrop `0.72→0.55`; content `#0d1117`(GitHub) → `--surface-1`;
  `scale(.92→1)+fade` entrance, `--elevation-3`; Cancel = ghost `flex:0 1 auto`, primary `flex:1`;
  success reference‑ID `user-select:all` (copyable).

---

## 4. Step‑by‑step implementation order

**Phase 0 — System (1 PR, no visual risk):** §2.1 tokenize sweep + §2.4 transitions + §2.5 type/label
standardization + kill `2px`. _Everything downstream depends on this and it's what unlocks light mode._

**Phase 1 — Dual theme (1 PR):**

1. Add the `.light` block (§1.3) + dark refresh (§1.2) + theme‑aware semantic/verdict overrides (§1.4)
   to `globals.css`; add light `--surface-*`.
2. Remove the forced‑dark `useEffect` in `home/page.tsx` (and any peer); read saved theme on mount,
   set `document.documentElement.className`, persist to `localStorage` on toggle.
3. Wire the existing `setTheme` (Settings + the toggle) to flip the class. Verify each screen in both
   themes (the tokenize pass makes this mechanical). Keep the **exam IDE dark by default**.
4. Verify contrast: run the §1 hex through a checker; fix any < AA muted tiers.

**Phase 2 — P0 trust + funnel + a11y:** Login primary button (§3.2) → Onboarding phase stepper +
tokenize (§3.4) → Lock‑in countdown (drama #1) → Verdict moment + VerdictBadge a11y (§3.5) → timer
urgency + footer icons → time's‑up escape path → app‑wide hover floor (§2.2) → loading spinners.

**Phase 3 — Production polish:** Run/Submit + save dot → CodeMirror legibility → statement readability
→ Results reveal + tables → Home card/sidebar polish → shared modal system → Welcome restraint pass.

---

## 5. Sources

Verified (adversarial 3‑0 / 2‑0): Proctorio lock‑down (full‑screen shell, monitor gate) ·
support.mettl.com (in‑exam chrome, system‑check sequence) · honorlock.com (identity + room scan) ·
webaim.org/articles/contrast (WCAG AA 4.5/3/3:1) · accessiblepalette.com (10‑tier lightness).
Strong priors (verification rate‑limited): colorarchive.org · muz.li · devpalettes.com ·
fourzerothree.in (dark‑mode lightness/elevation/desaturation) · designyourway.net · colorfyi.com
(cream+violet light palettes). Internal: `apps/web/final-design.md`, `apps/web/src/app/globals.css`.

```

```

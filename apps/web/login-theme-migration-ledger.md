# Login-screen theme migration — dark-value change ledger (Phase 1, slice 2)

Honest record of every `.login-*` color site migrated to a `--theme-*` token. Dark is **byte-exact
except where a row is marked DRIFT or INTENDED-IMPROVEMENT** (mirrors the results-slice convention in
`results-theme-migration-ledger.md`). Light ratios are measured WCAG (composited over the actual
surface), not computed. Text thresholds: 4.5 (body) / 3.0 (≥18.66px bold). 33 sites total.

New tokens added (`:root` dark = identity, `.light` = cream-safe):
`--theme-error-bg`, `--theme-border-error`, `--theme-warn-text`, `--theme-text-faintest`.

## IDENTITY — dark unchanged, flips in light (15 sites)

| Site                       | Old (dark)               | → Token                 | Light value            | Light ratio  |
| -------------------------- | ------------------------ | ----------------------- | ---------------------- | ------------ |
| login-root bg              | `#0f0f0f`                | `--theme-bg`            | `#f6f2ea`              | — (surface)  |
| login-root text            | `#ffffff`                | `--theme-text`          | `#231b30`              | 14.8:1       |
| login-left border          | `rgba(255,255,255,0.05)` | `--theme-border`        | `rgba(60,42,90,0.12)`  | — (border)   |
| login-rule bg              | `rgba(255,255,255,0.05)` | `--theme-border`        | ↑                      | —            |
| login-input text           | `#ffffff`                | `--theme-text`          | `#231b30`              | 13.78:1      |
| login-submit:disabled bg   | `#1f1f1f`                | `--theme-card-bg`       | `#ffffff`              | — (surface)  |
| login-error border         | `rgba(239,68,68,0.25)`   | `--theme-border-error`  | `rgba(185,28,28,0.30)` | — (border)   |
| login-error bg             | `rgba(239,68,68,0.06)`   | `--theme-error-bg`      | `rgba(220,38,38,0.07)` | — (tint)     |
| login-error text           | `#fca5a5`                | `--theme-error-text`    | `#b91c1c`              | 5.79:1       |
| login-sso-wrap border      | `rgba(255,255,255,0.05)` | `--theme-border`        | `rgba(60,42,90,0.12)`  | —            |
| login-modal-tag (warn)     | `#fbbf24`                | `--theme-warn-text`     | `#b45309`              | 5.02:1       |
| login-modal-title          | `#ffffff`                | `--theme-text`          | `#231b30`              | 16.52:1      |
| login-brand-footer (decor) | `rgba(255,255,255,0.12)` | `--theme-text-faintest` | `rgba(35,27,48,0.20)`  | 1.52:1 decor |

## INTENDED-IMPROVEMENT — dark ratio went UP, fixes a pre-existing low value (3 sites)

| Site             | Old → New (dark)                       | Old→New dark ratio | Verdict                                            |
| ---------------- | -------------------------------------- | ------------------ | -------------------------------------------------- |
| login-brand-sub  | `0.28w` → `--theme-text-muted` (0.45w) | **2.50 → 4.51**    | was **sub-AA (2.50)** — now clears 4.5; light 5.17 |
| login-form-title | `0.9w` → `--theme-text` (#fff)         | 15.89 → 19.65      | title crisper; light 14.8                          |
| login-modal-body | `#888` → `--text-dim` (0.58w)          | 5.22 → 6.76        | normalized; light 5.17                             |

## DRIFT — deliberate but not identity; cosmetic, flagged for your eyeball at 1.3 (15 sites)

| Site                                  | Old → New (dark)                              | Δ           | Note                                                                                                                                                                                       |
| ------------------------------------- | --------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| login-logo-name                       | `0.75w` → `--theme-text-muted-strong` (0.70w) | 10.63→9.35  | the three `--color-text-dim` labels unified to one tier; **hierarchy preserved** (stays above 0.58 siblings)                                                                               |
| login-brand-headline (24/700)         | `0.75w` → 0.70w                               | 10.63→9.35  | ↑ same; large-text, AA3 ✓                                                                                                                                                                  |
| login-brand-feature-label             | `0.75w` → 0.70w                               | 10.63→9.35  | ↑ same                                                                                                                                                                                     |
| login-input bg                        | `#0a0a0a` → `--theme-inner-bg` (#0f0f0f)      | surface     | input bg +1 step lighter; imperceptible                                                                                                                                                    |
| **login-input border**                | `0.08w` → `--theme-border` (0.05w)            | border      | ⚠️ **the one CHANGE on the funnel** — matches the **shipped** results row-5 decision (results was 0.07→0.05; login is 0.08→0.05, Δ marginally larger). One-token revert if you dislike it. |
| login-input:focus bg                  | `#0d0d0d` → `--theme-bg` (#0f0f0f)            | surface     | focus bg +2 levels; imperceptible                                                                                                                                                          |
| login-sso-btn border                  | `0.08w` → `--theme-border` (0.05w)            | border      | same consolidation as input border                                                                                                                                                         |
| login-sso-btn:hover border            | `0.18w` → `--theme-border-strong` (0.12w)     | border      | hover edge                                                                                                                                                                                 |
| login-modal border                    | `0.08w` → `--theme-border-strong` (0.12w)     | border      | modal edge **more** defined (stronger)                                                                                                                                                     |
| login-modal-close border              | `0.1w` → `--theme-border-strong` (0.12w)      | border      | slight                                                                                                                                                                                     |
| login-modal-close text                | `#d8b4fe` → `--theme-accent-text` (#c4b5fd)   | 10.48→10.03 | tiny hue shift to the accent token                                                                                                                                                         |
| login-modal-close:hover border        | `0.2w` → `--theme-accent-border` (0.3 accent) | border      | hover now accent-tinted (matches app ghost-button convention)                                                                                                                              |
| login-modal-close:hover text          | `#aaa` → `--theme-text-muted-strong` (0.70w)  | 7.97→9.35   | brighter hover                                                                                                                                                                             |
| login-dev-btn border (dev-only)       | `0.04w` → `--theme-border` (0.05w)            | border      | dev builds only                                                                                                                                                                            |
| login-dev-btn:hover border (dev-only) | `0.08w` → `--theme-border-strong` (0.12w)     | border      | dev builds only                                                                                                                                                                            |

## INTENTIONAL-LITERAL — not migrated, by design (2 sites)

| Site              | Literal            | Why kept                                                                                                               |
| ----------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| login-submit text | `#fff`             | White-on-accent is correct in **both** themes (dark `#8B5CF6` 3.81:1 bold ✓ / light `#7C3AED` 5.7:1 ✓) — must not flip |
| login-modal-bg    | `rgba(0,0,0,0.88)` | Backdrop scrim; a dark scrim is standard under modals in light themes too                                              |

## Summary

- **15 IDENTITY** (dark byte-exact) + **3 IMPROVEMENT** (all ratios up, one fixed a sub-AA 2.50) +
  **15 DRIFT** (14 cosmetic borders/surfaces, 1 funnel item = input border 0.08→0.05) + **2 LITERAL**.
- **The one item to actually eyeball:** `login-input` / `sso-btn` border `0.08→0.05`. It matches the
  **already-shipped** results row-5 decision (consolidate one-off border alphas onto `--theme-border`).
  Single-token revert to a dedicated `--theme-border-input` (0.08 dark / cream light) if you want parity.
- All migrated **text** sites pass AA in light (measured). No light value ships below threshold.

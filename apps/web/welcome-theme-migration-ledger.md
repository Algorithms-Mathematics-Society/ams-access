# Welcome-screen theme migration — dark-value change ledger (Phase 1, slice 3)

Every `.welcome-*` color site. Welcome had **no orphan tokens** — all sites were raw literals (the
earlier "16" count included a `#EDF0F7` inside a comment; **15 real sites**). Text sits directly on
the canvas bg (`--theme-bg`), so light ratios are measured on cream `#F6F2EA`. Same convention as the
login/results ledgers. No new tokens needed (reuses login-slice + existing tokens).

## IDENTITY — dark byte-exact, flips in light (3 sites)

| Site                 | Old (dark)        | → Token                    | Light     | Light ratio       |
| -------------------- | ----------------- | -------------------------- | --------- | ----------------- |
| status-dot bg        | `#22c55e`         | `--theme-dot`              | `#15803d` | 4.49:1 (3:1 UI ✓) |
| status-dot shadow ×2 | `0 0 2px #22c55e` | `0 0 2px var(--theme-dot)` | ↑         | dot edge          |

## INTENDED-IMPROVEMENT — dark ratio UP, fixes pre-existing low slate (5 sites)

| Site                 | Old → New (dark)           | Old→New dark ratio | Light | Note                                                    |
| -------------------- | -------------------------- | ------------------ | ----- | ------------------------------------------------------- |
| byline (9px)         | `#475569` → `--text-dim`   | **2.61 → 6.86**    | 4.96  | was **sub-AA (2.61)**                                   |
| session-hint (8px)   | `#6b7280` → `--text-dim`   | 4.10 → 6.86        | 4.96  | (also avoids the faint→3.64 cream fail caught pre-edit) |
| mono-tag--accent     | `#71717a` → `--text-dim`   | 4.10 → 6.86        | 4.96  | slate → token                                           |
| tagline (10px)       | `#64748b` → `--text-dim`   | 4.16 → 6.86        | 4.96  | slate → token                                           |
| wordmark (32px hero) | `#f4f4f6` → `--theme-text` | 18.02 → 19.80      | 14.8  | crisper hero; light = plum-ink                          |

## DRIFT — deliberate, cosmetic (1 site)

| Site                | Old → New (dark)                   | Note                                                                                   |
| ------------------- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| welcome-root canvas | `#0a0a0a` → `--theme-bg` (#0f0f0f) | +1 step lighter; normalizes the entry canvas to the app bg (plan §3.1). Light = cream. |

## DECORATIVE — sub-AA by design, in BOTH themes (2 sites)

| Site                    | Old → New                                          | Dark / Light ratio | Note                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mono-tag (8.5px corner) | `rgba(255,255,255,0.3)` → `--text-faint`           | 2.61 / 3.64        | corner micro-label; already sub-AA in shipping dark — terminal-aesthetic whisper, not body copy. **Flagged: bump to `--text-dim` if you want AA on the corner tags.** |
| legal (8px fine-print)  | `rgba(255,255,255,0.13)` → `--theme-text-faintest` | 1.38 / 1.50        | legal fine print; intentionally faint                                                                                                                                 |

## INTENTIONAL-LITERAL — not migrated, by design (4 sites)

| Site               | Literal                                         | Why                                                                                                             |
| ------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| welcome-cta text   | `#ffffff`                                       | white-on-accent correct in both themes (must not flip)                                                          |
| status-dot glow ×3 | `rgba(34,197,94,0.9)` ×2, `rgba(34,197,94,0.4)` | decorative green halo; reads as a glow in both themes (dark dot `#15803d` center + green halo on cream is fine) |

## Summary

- **3 IDENTITY + 5 INTENDED-IMPROVEMENT** (incl. byline fixed from sub-AA 2.61) **+ 1 DRIFT** (canvas
  normalize) **+ 2 DECORATIVE** (sub-AA by design) **+ 4 LITERAL**.
- All **content** text passes AA in light (measured). Two decorative whispers (corner mono-tag, legal)
  stay sub-AA by design — same treatment as the login brand-footer. Flag if you want them bumped.
- The pre-edit ledger caught `session-hint → --text-faint` = 3.64:1 (cream); corrected to `--text-dim`.

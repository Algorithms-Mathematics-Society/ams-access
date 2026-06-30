# Results-screen theme migration — dark-value change ledger (slice 1)

Honest record that **dark mode was NOT left pixel-unchanged** by slice 1. Each row is a dark
rendering that changed when a raw literal was migrated to a `--theme-*` token. Ratios are WCAG
contrast on the results page background (`--surface-0` = `#0B0B0E`).

| #   | Element                                                                  | Old value                                  | New value (dark)                                | Old → New ratio        | Verdict                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "Show/Hide" toggle                                                       | `#475569`                                  | `--theme-text-faint` = `rgba(255,255,255,0.45)` | 2.59 → **4.52**        | **INTENDED-IMPROVEMENT** — was below the 3:1 affordance floor; now passes                                                                                                                 |
| 2   | Primary text (headings, "Leaderboard", my-name)                          | `#e2e8f0`                                  | `--theme-text` = `#ffffff`                      | 15.94 → **19.65**      | **INTENDED-IMPROVEMENT** — kills the slate "gray zoo"; ratio up                                                                                                                           |
| 3   | Secondary text (score/time/memory, other names)                          | `#94a3b8`                                  | `--theme-text-muted-strong` = 70% white         | 7.67 → **9.70**        | **INTENDED-IMPROVEMENT** — normalized; ratio up                                                                                                                                           |
| 4   | Muted labels (rank, solved, penalty, attempts, language, section labels) | `#64748b`                                  | `--theme-text-muted` = 45% white                | 4.13 → **4.52**        | **INTENDED-IMPROVEMENT** — old value was **below AA (4.13)**; now clears 4.5                                                                                                              |
| 5   | Table / card hairline borders (×5)                                       | `rgba(255,255,255,0.07)` (×4), `0.06` (×1) | `--theme-border` = `rgba(255,255,255,0.05)`     | 1.16 / 1.13 → **1.10** | ⚠️ **ACCIDENTAL-DRIFT** — borders slightly fainter. Decorative hairlines (no 3:1 requirement), so **no AA impact**, but it _is_ an unintended cosmetic change. **FLAGGED, not reverted.** |
| 6   | Banner stat value                                                        | `#ffffff`                                  | `--theme-text` = `#ffffff`                      | 19.65 → 19.65          | identity — no change                                                                                                                                                                      |
| 7   | My-rank accent / "Load Breakdown"                                        | `var(--color-accent-light)` = `#C084FC`    | `--theme-accent-text` (dark = `#C084FC`)        | 7.44 → 7.44            | identity — no change in dark                                                                                                                                                              |

## Summary

- **Rows 1–4: intended improvements.** All ratios went up; row 4 actually fixed a pre-existing
  sub-AA value (4.13). Row 1 fixed a sub-3:1 control affordance.
- **Row 5: the one accidental drift.** Borders dropped 1.16→1.10 because the slice mapped `0.07`/`0.06`
  onto the existing `--theme-border` (`0.05`). These are decorative hairlines (WCAG 1.4.11 exempts
  borders that aren't the sole boundary of a control), so there's no AA consequence — but the change
  was not deliberate. **Not auto-reverted** (reverting would either reintroduce a raw literal or require
  changing the shared `--theme-border` dark value, which other screens consume). Flagged for a decision:
  leave as-is (recommended — flips correctly, cosmetic), or introduce a dedicated `--theme-border-soft`
  token if exact dark-border parity is wanted.
- **Rows 6–7: identity** — listed for completeness; nothing changed.

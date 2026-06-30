# Help-modal theme migration — dark-value change ledger (Phase 1, slice 4 — final free screen)

Every `.help-*` color site (shared `HelpRequestModal`). Modal card bg = `var(--surface-1)` (dark
`#131318` / light `#ffffff`), input bg = `--theme-inner-bg`. 11 sites: 9 migrated, 2 kept. First slice
authored under the codified `--text-faint` rule — the placeholder was mapped to `--text-dim` **by the
rule, not by post-hoc rediscovery**.

## IDENTITY — dark byte-exact, flips in light (2 sites)

| Site                    | Old (dark)               | → Token                 | Light                 |
| ----------------------- | ------------------------ | ----------------------- | --------------------- |
| help-btn-ghost border   | `rgba(255,255,255,0.12)` | `--theme-border-strong` | `rgba(60,42,90,0.22)` |
| help-btn-ghost:hover bg | `rgba(255,255,255,0.06)` | `--theme-hover`         | `rgba(35,27,48,0.05)` |

## INTENDED-IMPROVEMENT (2 sites)

| Site                    | Old → New (dark)              | Dark ratio  | Light    | Note                                                                                      |
| ----------------------- | ----------------------------- | ----------- | -------- | ----------------------------------------------------------------------------------------- |
| help-input text         | `#e2e8f0` → `--theme-text`    | ~17 → 19.17 | 13.78    | crisper input text                                                                        |
| help-input::placeholder | `--text-faint` → `--text-dim` | 4.52 → 6.81 | **4.83** | **rule-applied:** faint was sub-AA on cream; dim passes even on deeper inner-bg `#f0eadd` |

## DRIFT — deliberate, cosmetic (5 sites)

| Site                        | Old → New (dark)                                         | Note                                                      |
| --------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| help-input bg               | `rgba(255,255,255,0.04)` → `--theme-inner-bg` (#0f0f0f)  | overlay → solid inset; light = `#f0eadd`                  |
| help-input border           | `rgba(255,255,255,0.1)` → `--theme-border-strong` (0.12) | +0.02                                                     |
| help-input:focus bg         | `rgba(255,255,255,0.07)` → `--theme-card-bg` (#1f1f1f)   | focus lift                                                |
| help-btn-ghost:hover border | `rgba(255,255,255,0.2)` → `--theme-accent-border`        | accent-tinted hover — matches shipped `results-btn-ghost` |
| help-btn-ghost:hover text   | `#ffffff` → `--theme-text`                               | brighten-on-hover; light flips to `#231b30`               |

## INTENTIONAL-KEEP — not migrated, by design (2 sites)

| Site                  | Literal                         | Why                                                                                                                                                                                                   |
| --------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| help-btn-primary bg   | `--color-accent-deep` (#7c3aed) | **AA-critical:** white-on-`#8B5CF6` (`--theme-accent` dark) = **4.23 (<4.5)** at 13px/600; the deeper `#7c3aed` keeps white-label at **5.7:1 in both themes**. Same as shipped `results-btn-primary`. |
| help-btn-primary text | `#ffffff`                       | white-on-accent, both themes                                                                                                                                                                          |

Note: the modal backdrop scrim `rgba(7,10,16,0.55)` lives **inline in `HelpRequestModal.tsx`** (out of
this CSS slice); a dark scrim is correct under a modal in both themes — left as-is.

---

## Results screen — VALIDATED, zero edits (Phase 1 free-screen set complete)

Results was fully migrated in **slice 1** (`results-theme-migration-ledger.md`, committed #10/#11). Its
only two remaining literals are the same deliberate keep as help:

| Site                     | Literal                         | Verdict                                              |
| ------------------------ | ------------------------------- | ---------------------------------------------------- |
| results-btn-primary bg   | `--color-accent-deep` (#7c3aed) | KEEP (deep accent keeps white-label AA, both themes) |
| results-btn-primary text | `#ffffff`                       | KEEP (white-on-accent)                               |

**Free-screen set (welcome / login / results / help) is now fully tokenized.** Next: 1.1 toggle/FOUC
→ 1.2 route gating → 1.3 both-mode screenshots (login input-border drift gets its eyeball there).

# Theme tier-mapping rules — apply to EVERY slice (Phase 1 + the Phase 2 sweep)

Derived from a systematic failure that bit twice (login `brand-sub`, welcome `session-hint`): both
mapped to `--text-faint`, both sub-AA on cream, both caught only at the pre-edit ledger. Not
coincidence — `--text-faint` is a legible dark tier that is **structurally sub-AA on light**.

## Measured tier ratios on light (cream `#F6F2EA` / white card `#FFFFFF`)

| Tier                                | Light value           | On cream | On card | Body AA (4.5)? |
| ----------------------------------- | --------------------- | -------- | ------- | -------------- |
| `--theme-text`                      | `#231b30`             | 14.8     | 16.5    | ✓              |
| `--theme-text-muted-strong`         | `rgba(35,27,48,0.82)` | ~9.3     | ~9.3    | ✓              |
| `--text-dim` / `--theme-text-muted` | `rgba(35,27,48,0.65)` | **4.96** | ~5.2    | ✓ (floor)      |
| `--text-faint`                      | `rgba(35,27,48,0.55)` | **3.64** | 3.76    | ✗ **FAILS**    |
| `--theme-text-faintest`             | `rgba(35,27,48,0.20)` | 1.5      | —       | decor only     |

## THE RULE

1. **Any text a user is meant to read** (labels, hints, links, input text, body, captions that carry
   words) → **`--text-dim` minimum** on light. Never `--text-faint`.
2. **`--text-faint` is reserved for DECORATIVE-only** — ornament that carries no readable information
   (pure visual texture). If it says words a user might read, it is not decorative.
3. **`--theme-text-faintest`** → legal fine-print / quiet-by-role whispers only.
4. **Disabled controls are exempt** (WCAG 1.4.3) — `--text-faint` on a `:disabled` label is fine.
5. **Decide by ROLE, not size.** An 8px label that says "System ready" is information; bump it. An
   8px ornament glyph is not.

## Audit of existing `--text-faint` usages (free screens)

| Site                    | Renders           | Verdict                                                   |
| ----------------------- | ----------------- | --------------------------------------------------------- |
| `welcome-mono-tag`      | "System ready"    | **bumped → --text-dim** (information)                     |
| `login-textlink--quiet` | "Get help" link   | **bumped → --text-dim** (latent light fail, pre-existing) |
| `login-dev-btn`         | dev sign-in label | **bumped → --text-dim** (readable, dev-only)              |
| `help-input`            | user-typed text   | **bump in help slice → --text-dim**                       |
| `login-submit:disabled` | disabled button   | **left** — disabled, exempt                               |

## Carry-forward to the Phase 2 sweep (home / onboarding / contest)

Before mapping any literal to `--text-faint` in those screens, apply rule #1. The heavy screens use
JS-prop ternaries with authored light values — re-check those light values against this table too;
the same faint-on-cream trap applies to inline `theme === "light" ? <faint> : ...` branches.

### The JS-ternary screens carry a WORSE version of the trap — measure every light hex

In the free screens, a bad mapping flows through a **token** (`--text-faint`), so one ledger pass
catches every site at once. In home/onboarding/contest the light values are **raw hexes authored
inside ternaries** (`theme === "light" ? "#xxxxxx" : "#yyyyyy"`) by the prior pass — **no token
indirection**, so there is no single chokepoint to audit. And the prior pass authored those light
values from **arithmetic, not a measured checker** (the reason this whole effort exists). Therefore:

- **RULE for 2a/2b/2c:** run **every** light-branch hex through the contrast checker **individually**
  during migration, against its actual composited background. One failing ternary will not announce
  itself.
- **Do NOT assume `authored == AA`.** A deliberately-written light ternary is exactly as likely to be
  sub-AA as an accidental one — deliberateness was never measured. "It was written on purpose" is not
  evidence it passes.
- Prefer **collapsing the ternary onto a token** (per the 2a unification) so future audits regain the
  single chokepoint — but the migrating value must still be measured before it lands.

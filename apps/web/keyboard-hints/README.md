# Astryx keyboard hints — 2026-10-02

Replaced text-only shortcut hints with the installed Astryx Kbd component, following its modifier-combination template and accessibility labels.

- Setup exit: compact keycaps beside the desktop action and within the narrow-screen footer. Added aria-keyshortcuts to the existing exit button.
- Contest Workspace: separate left/right and up/down keycaps grouped by Width and Height, rather than depicting arrow alternatives as a simultaneous chord.
- Existing Markov editor cancel hint: Escape keycap with readable “to cancel” text. This component is not currently imported by a page; its source is typechecked, but no routed runtime verification is claimed.

The setup binding is explicitly Control + Shift + Q, so the display uses `ctrl`, not platform-adaptive `mod`; it must not advertise Command on macOS for a handler that requires Control. All shortcut/native handlers remain unchanged. No new keyboard shortcuts or backend changes.

Verification: 27 browser checks passed across 1280, 390 and 320px onboarding and desktop/narrow contest menus. Checked keycaps, spoken names, menu bounds and the real Ctrl+Shift+Q handler against disposable native stubs. No actual native unlock or server operations were executed. Typecheck passed. Visually inspected the desktop exit hint and narrow workspace menu. Initial harness incorrectly applied an onboarding wheel-scroll assertion to the contest menu; the corrected final run scopes that assertion to onboarding only.

- [Browser evidence](browser/2026-10-01T19-37-29-116Z/manifest.json)
- [Typecheck](validation/typecheck.log)
- [Official Astryx component catalog](https://astryx.atmeta.com/components)

## Follow-up: spelled-out setup keys

Per user preference, setup exit now shows **Ctrl**, **Shift**, **Q** in separate token-styled keycaps instead of Astryx's modifier glyphs. The small local SetupExitShortcut uses Astryx Stack and theme tokens with native kbd content because the installed Kbd component does not offer custom modifier labels. Arrow and Escape hints still use Astryx Kbd. Spoken labels and the Control+Shift+Q binding are unchanged. Typecheck and all 27 browser checks passed again, including the visible text assertion at desktop/narrow widths.

[Updated browser evidence](browser/2026-10-01T19-40-47-423Z/manifest.json).

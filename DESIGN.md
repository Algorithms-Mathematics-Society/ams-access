# Access design system

Current implementation reference, refreshed 19 October 2026. Scope: the candidate
desktop app in `apps/web` and its packaged icons. This describes the implemented
UI; it is not a proposal or a claim of native-platform certification.

## Overview

Access is a focused coding-assessment workspace. Navigation, instructions,
readiness findings, code and results take priority over decorative treatment.
Use Astryx 0.1.8 components and the existing Geist typography. Preserve the
assessment, recovery, permission and accessibility behavior when changing UI.

The authoritative implementation sources are:

- `apps/web/src/theme/accessTheme.ts`: palette, typography, radius, motion and component overrides.
- `apps/web/src/theme/build-theme.mjs`: theme compilation and compatibility adapters.
- `apps/web/src/app/globals.css`: layer order, legacy aliases and shared page rules.
- `apps/web/src/components/AccessLogo.tsx` and its CSS module: all app branding.
- [Candidate UI guide](apps/web/UI.md): routes, interactions, checks and development.
- [Brand asset notes](apps/web/public/brand/README.md): artwork provenance and icon generation.

Do not edit generated `accessTheme.css`, `access.js`, theme declaration files,
`fallback.css` or `compatibility.css` by hand. Run `pnpm theme:build` after changing
the canonical theme and inspect the generated diff for unrelated drift.

## Colors

The UI supports a saved light/dark preference, falling back to the operating
system. These values come from the canonical theme; use semantic variables in
components instead of copying palette literals.

| Role              | Light                 | Dark      |
| ----------------- | --------------------- | --------- |
| Body              | `#fafafa`             | `#0a0a0a` |
| Card              | `#ffffff`             | `#121212` |
| Surface / popover | `#f5f5f5` / `#ffffff` | `#1a1a1a` |
| Muted surface     | `#eeeeee`             | `#202020` |
| Primary text      | `#171717`             | `#f5f5f5` |
| Secondary text    | `#5b5b5b`             | `#aaaaaa` |
| Border            | `#dedede`             | `#303030` |
| Emphasized border | `#858585`             | `#767676` |
| Accent            | `#7c3aed`             | `#a78bfa` |
| Success           | `#15803d`             | `#4ade80` |
| Warning           | `#946800`             | `#fbbf24` |
| Error             | `#b91c1c`             | `#f87171` |

Primary actions use inverted neutral surfaces. Purple remains a UI accent for
focus, compact active markers and the Submit variant; it is not a logo color.
Success, warning and error describe actual state and must also have a text label.
An unavailable readiness probe must not be presented as passed.

The October 2026 spire brand is strictly black on light backgrounds and white on
dark backgrounds. `AccessLogo` uses the original Geist letter outlines and
spire artwork; `AccessMark` is the compact standalone spire. Both use CSS masks
with fixed monochrome brand tokens. Never draw a substitute triangle, tint the
mark purple, stretch it, outline it, rotate it or add gradients/glows/shadows.
The native icon uses a black tile with the white spire.

The startup intro is the one motion exception: the spire grows downward from
its fixed apex, settles at its original proportions and appears above the
outlined Access wordmark and supplied tagline. It uses white on black in both
themes, then reveals the saved-theme Welcome screen. This sequence belongs only
to startup, never routine route changes or the assessment workspace.

## Typography

Geist Sans is the body and heading family, with Arial/sans-serif fallbacks.
Geist Mono is for code and appropriate technical values. Fonts are supplied by
`geist` in the root layout. The theme starts from a 14px base with a 1.2 scale;
headings use semibold. Prefer Astryx `Heading` and `Text` roles rather than
inventing per-page font sizes. The supporting and small overrides are 12px.

The brand wordmark is artwork, not tracked uppercase interface text. Never
render it below a 24px cap height; use the standalone mark when space is tight.
The mark's minimum is 16px. Preserve the SVG aspect ratios and built-in clear
space: one base-leg width, 24 of the mark's 104 units, on each side. The shared
horizontal header logo is 180px wide (about 26.2px wordmark cap height). Keep
its built-in clear space and existing page gutters; do not add logo-only margins.

Use readable labels and wrap long contest names and diagnostics. Keep detailed
compiler output and source code in monospaced, independently scrollable regions.
When font weight changes during rerender, use individual font properties; do not
combine a `font` shorthand with `fontWeight`, `fontSize` or `lineHeight`.

## Layout

Use existing Astryx `AppShell`, `TopNav`, `SideNav`, `Layout`, `HStack` and `VStack`
patterns. Spacing comes from `--spacing-*`; common gaps and padding are 8, 12,
16, 24 and 40px. Flexible children need `minWidth: 0`. Use normal document flow,
bounded content widths and reachable scroll regions instead of fixed-height
screens that cut off actions.

- Welcome and Login use a bounded 1120px frame with clamped 16–40px outer gutters.
- The dashboard has a 280px navigation/calendar panel, flexible contest content
  and a roughly 320px readiness region. Below its 1024px navigation breakpoint,
  navigation becomes a drawer and the calendar moves into the main flow.
- Device setup keeps the introduction, checks, progress and exit action reachable
  in short windows. Its header can wrap without losing the shortcut or theme control.
- The contest workspace keeps problem, editor and output regions independently
  usable; existing resize, collapse and saved-layout behavior owns their geometry.
- Results keep attempt context, verdicts and individual checks distinct. A result
  from an older attempt must not appear to belong to the current run.

Check narrow widths (320/390px), typical desktop windows (1280/1440px), short
heights, long labels and keyboard navigation when a layout changes. The desktop
assessment flow still requires the installed app; responsive browser rendering
does not establish mobile assessment support.

## Elevation & Depth

Use neutral surface changes and restrained borders for grouping. Existing
`--shadow-low`, `--shadow-med` and `--shadow-high` serve actual elevation such as
overlays. Do not add background glows, glass panels or dramatic shadows to app
branding. Use a visible focus ring rather than decorative elevation to indicate
keyboard focus.

## Shapes

The theme derives a 3px inner radius, 6px element radius and 9px container radius.
Use their semantic tokens. Preserve the supplied icon geometry; generic app
container radii do not authorize changing the spire or its wordmark. Dense rows
belong in lists/tables, not additional nested cards.

## Components

| Component / concern | Implemented rule                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branding            | Welcome, Login, Home and Device setup use `AccessLogo`; the contest top bar uses `AccessMark`. No legacy Access SVG/PNG sources remain in public assets.                                          |
| Theme               | `lib/theme.ts` owns saved preference and HTML classes; `theme-bridge-core.ts` synchronizes Astryx attributes. `AccessThemeProvider` follows that state.                                           |
| Theme changes       | `withoutThemeTransition` temporarily applies `theme-changing` through two animation frames, covering the provider update; rapid toggles cancel older cleanup. Hover transitions return afterward. |
| Route policy        | `theme-dark-lock-core.ts` is the policy source. Its current locked-route list is empty; do not describe the contest/setup screens as permanently dark.                                            |
| Initial paint       | Root initialization applies preference, route policy and Astryx attributes before content. Theme controls use a neutral server/first-client state.                                                |
| Calendar            | A stable loading status hydrates first; the calendar mounts using the device's locale, timezone and current date. Keep local date keys and agenda times consistent.                               |
| Forms               | Retain field labels, password visibility, validation messages, keyboard focus and organizer-issued credential instructions.                                                                       |
| Readiness           | Keep pass, advisory, unavailable, blocked and in-progress states separate. Display actual scan ownership and freshness.                                                                           |
| Setup               | Keep contest context, twelve checks, phase progress, permission recovery and exit/restoration behavior.                                                                                           |
| Contest             | Preserve draft recovery, sample/custom test cases, attempt history, countdown, battery/charging status, camera status, Help and finish-review behavior.                                           |
| Overlays            | Preserve dialog labels, focus handling, Escape behavior and security-overlay priority. Ordinary dialogs must not steal focus from mandatory security overlays.                                    |
| Icons               | Use the existing Lucide/Astryx action icons; product branding always comes from the shared brand assets.                                                                                          |

Routine motion uses the theme's 120/200/320ms duration values and existing easing.
Respect reduced motion. Theme switching changes the complete palette together;
do not animate individual text and backgrounds through unreadable combinations.

## Do's and Don'ts

- Reuse the shared brand component and house components before adding custom markup.
- Update this document and the UI guide when shipped patterns or behavior change.
- Keep semantic labels, tab order, one main landmark, contrast and visible focus.
- Use mounted client UI for device-local information that cannot match a static export.
- Preserve native security, media ownership and recovery semantics during visual work.
- Do not suppress hydration warnings to conceal mismatched calendar or account content.
- Do not treat historical screenshots, fixture runs or old test totals as current validation.
- Do not introduce new settings, dependencies or broad visual changes to fix a local UI defect.

Camera settings retain observed device-list states independently of permission/capture state. Explicit camera choice is shared across setup and contest; unavailable or hidden devices must not be shown as verified. Preview readiness and sustained frame-progress guidance describe capture behavior without making a face verdict. Keep device operations independently bounded and preserve audio when switching video. See the candidate UI guide for recovery behavior and remaining installed-build validation.

Linux keyboard setup checks are temporary native probes with restoration before completion. Show aggregate capability separately from individual shortcut enforcement: individual rows remain “Not individually verified.” Keep one pending probe, discard late results after navigation, and provide warning/continuation according to contest policy after the presentation deadline. A successful settings check must not imply gesture prevention, complete shortcut coverage, or Cinnamon support.

macOS requires Location access during camera setup so the candidate can reconnect
using nearby Wi-Fi networks. Keep the permission row, System Settings and safe
relaunch actions outside the contest kiosk; the contest picker gives Settings
guidance without requesting permission. Only relaxed development builds may skip
this setup gate, with a visible note. Windows and Linux have no Location step.

Network-helper warnings use explicit retry or policy-aware warning continuation. Recovery feedback reports verified state: fulfilled commands without a successful pending-state query are insufficient to declare everything restored. Keep desktop and network recovery claims separate when their outcomes differ.

Published contest references use an ordinary in-app overlay, below mandatory
security/network and expiry flows. Keep the workspace mounted and background
controls inert, with focus restored only on ordinary dismissal. Reference content
is bounded plain text from the existing authenticated contest payload, with a
fast, reduced-motion-aware opening transition and no network work on open.

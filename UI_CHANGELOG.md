# Astryx UI update

## 2026-10-19

- Fixed incremental Windows builds retaining the old embedded executable icon:
  Cargo now tracks the ICO and the Windows resource, NSIS installer and
  uninstaller explicitly select it. MSI and MSIX retain the shared generated
  icon sources. Previously built installers must be rebuilt.
  Rebuilt the Windows release EXE, NSIS setup EXE and MSI; verified all six ICO
  images in both executables and an exact ICO match in the MSI Icon table.
  Updated desktop regression checks passed 17 tests with one skipped.
- Consolidated current visual rules in `DESIGN.md` and route/development guidance
  in `apps/web/UI.md`; replaced superseded standalone UI guidance with pointers
  and marked historical reviews as archival. Browser runners, fixtures, evidence,
  functional tests, CI and packaging checks are retained.
- Replaced the old triangle branding with the supplied spire and Geist wordmark
  across Welcome, Login, Home, Device setup and the contest header. Regenerated
  native icon assets and added browser/touch icons. Removed obsolete logo files
  and their unused CSS.
- Kept the brand black/white in both themes. Palette changes temporarily suppress
  per-element transitions until document and provider state settle; rapid toggles
  and failure cleanup have regression coverage.
- Fixed calendar hydration across server/browser locale and timezone differences:
  a stable loading status renders first, then device-local calendar content mounts.
- Removed the result-tab `font` shorthand conflict with dynamic `fontWeight`.
- Disabled persistent Webpack caching only in development after reproducing
  cache-buffer memory failures with `dev:hosted`. Production caching, chunk
  splitting, assessment rules and native security behavior are unchanged.

Validation performed locally: TypeScript, focused theme/config/date/calendar
tests, icon-file decoding, source inventory and browser checks of the affected
branding, calendar hydration and setup-entry surfaces. The repaired hosted dev
server stayed responsive beyond the reproduced failure interval. A subsequent
verification passed all 557 web tests serially, TypeScript, version consistency,
74 local documentation links and the production export with every size budget.
The build used process-local `CIRCLE_NODE_TOTAL=2` to limit worker concurrency.
Desktop script tests passed 15 checks with one skipped; all 97 proposed cleanup
paths remain. Native installers and live assessment behavior were not retested.
Changes remain subject to normal review and release validation.

## 2026-10-01

- Applied the neutral Astryx theme with restrained purple accents across Welcome, Login, Home, Settings and Device.
- Added dashboard calendar/navigation, clearer contest states, responsive layouts and consistent readiness/help dialogs.
- Improved keyboard focus, tab semantics, single main landmarks, credential guidance and proctoring disclosure.
- Corrected stale scan headlines and local support reports: seven matching checks, actual native app version or unknown, and scan timestamps/status.
- Restored shared preflight log typography and transition tokens, removed obsolete Login styles and wired the five home presentation tests into the regular suite.
- Retained the earlier frontend connection diagnostics and platform-specific recovery messaging required by these pages. No backend, API-client, native desktop or platform source changes are included.

Historical publication validation covered TypeScript, regression tests, production
export and browser presentation. Those earlier totals and captures describe that
snapshot, not the current branch. Native enforcement and live API behavior need
their own validation. Historical review artifacts and check runners remain
available; the current design and UI guides supersede their visual instructions.

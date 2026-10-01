# Astryx UI update

## 2026-10-01

- Applied the neutral Astryx theme with restrained purple accents across Welcome, Login, Home, Settings and Device.
- Added dashboard calendar/navigation, clearer contest states, responsive layouts and consistent readiness/help dialogs.
- Improved keyboard focus, tab semantics, single main landmarks, credential guidance and proctoring disclosure.
- Corrected stale scan headlines and local support reports: seven matching checks, actual native app version or unknown, and scan timestamps/status.
- Restored shared preflight log typography and transition tokens, removed obsolete Login styles and wired the five home presentation tests into the regular suite.
- Retained the earlier frontend connection diagnostics and platform-specific recovery messaging required by these pages. No backend, API-client, native desktop or platform source changes are included.

Validation: 344 tests and TypeScript passed on the publication worktree. The identical frontend source also passed production export, 369 browser assertions, and three WebKit route renders during the UI review. Export size was 6.99 MB against a 45 MB budget; the largest JS chunk was 0.46 MB against 0.49 MB.

Review snapshots, screenshots, detailed local logs and internal evidence archives are intentionally excluded from this publication. Independent source and visual reviews were completed before publication; the original local working tree retains those records.

Known limits: microphone monitoring retains its existing behavior across Settings tabs and stops on unmount; native network probing remains disabled. Fixture checks do not establish live API availability or certify native OS lockdown behavior. The previously observed API connectivity outage and onboarding dry-run hydration issue were not resolved by this UI work.

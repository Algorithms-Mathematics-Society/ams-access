# Dashboard UI — accepted review

Latest app-page follow-up: [Pre-contest onboarding](../onboarding-ui/README.md) — Astryx setup screens, reviewed scrolling/recovery states, and production hydration correction.

Latest update: **[Claude review resolutions](../../../claude-review-resolution.md)** — confirmed defects corrected, 344 tests and 369 browser assertions passed, with independent source/visual review.

Previous update: **[Welcome Astryx review](welcome-review.md)** — template-guided hero layout with stronger typography, a compact preparation guide and preserved navigation. [Login review](login-review.md) · [Device review](device-review.md) · [Settings review](settings-review.md).

Completed 2026-09-30. The app is served at **http://localhost:3000** with hot reload; the existing native desktop process remains running.

[Change log](CHANGELOG.md) · [Review](review.md) · [Page-wise execution plan](../../../exectuion-page-wise.md)

## Original dashboard validation

Latest validation is recorded in [Claude review resolutions](../../../claude-review-resolution.md). The figures below are retained from the first dashboard slice.

| Check | Result |
| --- | --- |
| Existing regression suite | 339 passed |
| TypeScript / production export | Passed |
| Static export budget | 6.87 MB / 45 MB |
| Largest JS chunk budget | 0.45 MB / 0.49 MB |
| Browser interaction/layout assertions | 60 passed |
| Screenshots | 29 across 1440×1000, 1280×800, 800×700, 390×844, and 900×500 |
| Enabled text contrast samples | 392 passed; minimum measured 6.51:1 |
| Protected source comparisons | 20 passed against the subagent's pre-edit snapshot |
| Native WebKitGTK 2.52.6 | Exported dashboard rendered at 1280×800 and 800×700 without horizontal page overflow |

[Accepted browser manifest](evidence/2026-09-30T14-38-41-049Z/manifest.json) · [Source review](validation/source-review.json) · [Native results](native/results.json) · [Build log](validation/build.log) · [Tests](validation/tests.log)

### Visual evidence

- [Desktop dashboard](evidence/2026-09-30T14-38-41-049Z/1440x1000-dashboard.png)
- [Narrow dashboard](evidence/2026-09-30T14-38-41-049Z/390x844-dashboard.png)
- [Long text](evidence/2026-09-30T14-38-41-049Z/1280x800-long.png)
- [Short preflight](evidence/2026-09-30T14-38-41-049Z/900x500-short-preflight.png)
- [Narrow preflight](evidence/2026-09-30T14-38-41-049Z/390x844-preflight-blocked.png)
- [Recovery dialog](evidence/2026-09-30T14-38-41-049Z/900x500-short-recovery.png)
- [Native WebKit dashboard](native/dashboard-0.png)

## Reproduce

Use Node 24. After building, serve `apps/web/out` on local port 4319, then run from the repository root:

```sh
node scripts/dashboard-ui-verify.mjs http://127.0.0.1:4319
WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 /usr/bin/python3 apps/web/dashboard-ui/native/probe.py
```

The browser runner installs fixtures only into a disposable browser and blocks non-local HTTP traffic. Search/clear are verified not to fetch contests. Native evidence uses an ephemeral WebKit view of the real export, with fixture data and without a Tauri bridge; it verifies rendering, not native permissions or lockdown behavior. No test messages are sent to an organizer.

Contrast sampling composites solid backgrounds and checks visible enabled text after animations settle. It is not a full accessibility certification; disabled controls and focus-ring contrast rely on the established Astryx theme and component behavior.

## Review provenance and limits

Three requested subagents completed discovery and initial audit work, then hit the session usage limit. The primary agent completed implementation and final review. There is no independent final subagent sign-off.

The production fixture runs report only the existing `NotAllowedError: Permission denied` camera/microphone rejections (34 across this run), also documented in P0/P1. No new application exception type appeared. Native camera/firewall/close-app actions were not executed during this UI review; their source handlers and entry gates were preserved.

Settings and Device panel internals, other routes, and the pending results-availability reconciliation remain outside this pass. Home retains its existing dark-lock policy.

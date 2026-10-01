# Contest page review — 2026-10-02

Completed the requested subagent-driven review and fixed verified frontend defects. The existing Astryx layout, restrained accent, backend contracts, judging behavior and native protections are preserved.

## Confirmed defects and changes

1. **Latest edits could miss their save when switching problems during an in-flight request.** The previous coordinator deferred a live `doSave` ref, so a queued A save could execute against B. The new bounded queue captures the question/file/source closure and coalesces only pending jobs for the same question. Browser testing holds A's PUT, edits A again, switches and edits B, then verifies separate correct A/B writes.
2. **Recovery ignored local-only questions and discarded scratch tabs.** Startup now checks every question, restores the complete buffered workspace and active tab, and retains scratch buffers after an acknowledged save. Recovery still respects newer server revisions. Acknowledging an older write updates the buffer revision baseline without clearing newer edits. Restored unsaved work enters autosave. File switches snapshot outgoing work before changing the active file.
3. **Malformed buffered files could break startup.** Invalid/duplicate file data is rejected; missing active-file references fall back to a valid file; invalid revision values cannot poison subsequent requests.
4. **Wide-screen resizing had a dead range.** A 680px CSS maximum prevented the pane from following its percentage-based divider. Removed that conflicting cap and prevented flex shrink from silently changing the requested width. At 2560px the tested keyboard step now moves the actual pane from 896px to 906px.
5. **Output resizing could squeeze the code area to 50px on a short desktop.** The maximum now accounts for measured editor toolbars/notices and reserves 120px for code in the tested 1024×600 state. The minimum also respects the output panel's actual CSS minimum, removing a second dead range near the lower bound.
6. **Preferences and Workspace menus could overlap; theme selection lost focus.** Outside pointer/focus and viewport resize dismiss the panels without stealing focus. Theme selection, Reset and Escape restore focus to the preferences trigger. Security overlays retain priority.

## Review ownership

The behavior audit and draft-saving/recovery implementation were delegated to `/root/contest_audit_behavior`. The primary agent independently inspected those changes, implemented UI fixes, and ran the real-handler browser and production WebKit checks. The delegated agent completed its targeted tests and self-review; its additional browser-review turn was interrupted by an agent usage limit, so the primary agent completed that verification. No second-agent final visual sign-off is claimed.

## Accepted verification

- **390 unit tests passed**, including nine new save-queue/recovery/corrupt-buffer cases.
- Typecheck and isolated production build passed; bundle budgets passed. The build did not overwrite the live development `.next` directory.
- **140 Chrome checks**: 14 targeted audit checks, 59 workspace-tools checks, and 67 confidence regressions. Accepted runs have no runtime exceptions.
- **32 production WebKitGTK captures/checks**, across 1280×800 dark/light preference, 1024×600, 390×844 and 320×640. Checked hydration, scrolling, panel/dialog bounds, editor area, focus, dark-lock, and reachable preferences controls.
- Visually inspected short-desktop output sizing, the production desktop workspace and narrow scrolled preferences. Layout remains aligned and controls remain reachable.
- Scope hash comparison: **80 protected files unchanged**, covering native/API-client/API helper sources. Six existing contest source files changed and two helper/test files were added. The package test command and audit runners/documentation were updated.

The recovery regression now holds its mock PUT pending before checking that recovered work is not labelled server-saved, then acknowledges it and checks the saved label. Its old fixed delay allowed the newly working autosave to complete before that assertion. Development captures attempted during HMR briefly remained on Loading without fixture API requests; those failed attempts are retained, and stable reruns passed. The final isolated production runs passed.

These tests use disposable browser fixtures, mocked responses and pending media/native calls. They verify frontend behavior, not real backend availability, physical-camera behavior or native lockdown. No real contest submission or support message was sent.

## Evidence

- [browser manifest](browser/2026-10-01T19-02-18-038Z/manifest.json)
- [tools-regression manifest](tools-regression/2026-10-01T18-55-49-897Z/manifest.json)
- [confidence-regression manifest](confidence-regression/2026-10-01T18-58-43-102Z/manifest.json)
- [Production WebKit results](native/production/results.json)
- [Test output](validation/tests.log) · [Typecheck](validation/typecheck.log) · [Build](validation/build.log)
- [Isolated build](validation/isolated-build.json) · [Source scope](validation/source-scope.json)

The app remains available through the existing local development server on port 3000.

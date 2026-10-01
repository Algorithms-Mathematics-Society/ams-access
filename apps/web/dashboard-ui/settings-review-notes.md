# Settings UI independent review

Scope: presentation within the existing Settings destination of `/home/`. No API, backend, native-policy, or contest-entry changes.

## Baseline findings

- Hardware used fixed two-column grids, long tab labels, and dense camera controls without responsive layout budgets.
- Camera metadata displayed initial/fallback resolution and frame rate as if measured.
- A placeholder theme control exposed unfinished implementation copy.
- Permissions labeled every non-passing readiness state as denied, including checks still in progress; notifications were unconditionally marked allowed.
- Missing restricted-process telemetry rendered specific example apps as cleared.
- Security metadata used binary success/error colors even when evidence was missing and mixed platform-specific claims.
- About displayed a hardcoded old version instead of current release metadata.
- The restore action already had correct platform-aware failure handling and must retain it, including the manual Linux command.

## Review requirements

- Preserve all media capture constraints, camera retry handling, stream and audio cleanup, readiness updates, and security logging.
- Preserve telemetry refresh callbacks and explicit native recovery commands exactly.
- Use actual Astryx component interfaces and accessible tab relationships; verify arrow focus, Enter selection, selector navigation, and slider keyboard operation.
- Use neutral or pending treatment for missing evidence; do not assert permissions, clean process scans, or measured camera data without results.
- Preserve last scan timestamps and identify loading/error/stale state clearly.
- Keep restore button disabled while working; show full failure message and selectable manual command without overflow.
- Retain all existing legal routes; remove the stale hardcoded release version (or use actual release metadata).
- Verify layouts at desktop and narrow widths, including long device/process names, all four tabs, media errors, and recovery failures.

The companion `validation/settings-source-review.cjs` compares the original handlers/effects and 258 protected source files against the snapshot taken before this Settings task. Browser and native-render checks are recorded by the main verification runner.

## Source review outcome

- The 28 AST and source checks pass. Of 258 protected source files, 257 retain their pre-task hashes; DashboardShell has one explicitly checked Settings-only header wrapping condition. Normalizing exactly that condition restores its original hash, so no other shared-shell change is accepted.
- The original camera, microphone, speaker, telemetry refresh, and manual recovery handlers are unchanged, including retry and cleanup effects.
- Native HTML `disabled` is replaced by Astryx `isDisabled` with the same expressions; the scan callback is forwarded unchanged to the extracted security section.
- Camera statistics now display only active-track measurements. Unknown measurements say “Not reported.”
- Permissions distinguish checking from failed checks; desktop notification permissions are explicitly not asserted.
- Restricted apps list actual scan findings and shows a neutral state before results are available.
- Review corrected two platform presentation issues: Windows command support no longer implies a completed successful check, and Linux ptrace status is only shown on Linux.
- All legal links retain their original destinations. The stale version string and unfinished theme placeholder are removed.

Browser geometry, interaction, contrast, media-fixture and native-render results are recorded separately. The source review does not claim access to real cameras or production security results.

- Final audit also verifies camera refresh enumeration, speaker confirmation, and Selector/Slider connections to the original state setters.
- All four tab panel IDs remain mounted, with inactive shells hidden and content mounted only for the selected tab. A quiet notice makes the existing microphone monitor visible while viewing other Settings tabs; its Manage action returns focus to the original microphone control.

- Narrow screenshot review identified the header action squeezing Settings description into six lines at 320px. The scoped header flex-basis now allows the diagnostic button to wrap below the description; Home and Device keep their exact original flex value.

- Narrow permission rows now place the status beside the label, allowing the explanatory description to use the entire row width. The rich label uses a span-based Astryx Stack to keep the library’s inline label wrapper valid.

## Final production visual review

Independently inspected production evidence `settings-evidence/2026-09-30T17-20-05-679Z`: Hardware at 1280×800, Permissions at 320×700, and the long camera option menu at 320×700. Desktop camera regions remain aligned; the narrow header and permissions rows retain readable full-width text; the camera menu fits within the viewport and wraps long names within a bounded three-line label. No remaining visual blockers found in these inspected states. The production manifest records 122 passing checks, 35 captures, and no failures.

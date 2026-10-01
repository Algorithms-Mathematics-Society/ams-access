# Independent contest presentation review

Baseline: `review-baselines/contest-ui-baseline` (working tree immediately before this migration, not git HEAD).

## Behavior-sensitive seams

- Keep the camera `<video>` mounted across rail collapse and any responsive rearrangement. Hide with CSS; preserve `cameraVideoRef`, `muted`, `playsInline`, `autoPlay`, stream owner, toggle confirmation and blocked-state conditions.
- Keep the `EditorPane` dynamic import at module scope. Preserve current code, question/file identity, language, theme, readOnly and change callback. Layout collapse must not replace/unmount the editor.
- Preserve every autosave, clock/expiry, API/native operation, security gate, media check and timer. Source audit checks all existing lifecycle hooks and business helper bodies against baseline.
- The existing horizontal splitter callback assumes a 220px expanded or 52px collapsed rail and viewport-aligned shell. Keep those dimensions unless separately reviewing and testing a UI-only geometry correction.
- Preserve sanitized `problemBodyHtml`, its sample-copy click handler and allowed clipboard registration. Do not swap the existing sanitization pipeline for a new Markdown renderer.
- Preserve run/submit disabled guards and support-send/cancel guards. Make tooltips available for disabled actions through stable surrounding semantics.
- Mandatory face/app blocks retain nondismissible behavior and focus refs. Native Dialog conversion for optional confirmations needs Escape/cancel/focus-return checks, and must not fight existing focus traps.
- Retain original attempt verdict/filter logic and scope to the active question. Empty, loading, error and pending states must remain truthful.

## Visual verification required

- Desktop 1920, 1440, 1280/1024; compact 768/390/320 layout where supported. No page-level horizontal overflow, clipped controls or inaccessible scroll regions.
- Problem/Editor/Terminal boundaries, text scaling, minimum editor area and terminal collapse. Splitter drag geometry and persisted width.
- Long title/file labels, many files/questions, empty lists, statement examples/constraints and copy feedback.
- Real editor keystrokes, question and file switch with draft preservation, terminal collapse without editor remount, camera collapse without video remount.
- Dialog open/cancel/Escape, focus trap and return; pending/failed final submission; support loading/error/success.
- Footer connection/save/camera/face states and timer urgency remain readable without relying solely on color.
- Use synthetic media in durable evidence; live preview may contain a real camera feed.

Automated source comparison is necessary but does not prove native lockdown, camera hardware or live judging behavior. Browser fixtures must be labeled as such.

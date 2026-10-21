# Linux face detection: known issue and verification

Tracking: [issue #143](https://github.com/Algorithms-Mathematics-Society/ams-access/issues/143).
Partial mitigation: [PR #145](https://github.com/Algorithms-Mathematics-Society/ams-access/pull/145).
Status as of 21 October 2026: **unresolved on the affected machine**.

## Observed behavior

The camera preview can open while face/presence detection remains at
“starting.” A later reproduction reaches “Face detection unavailable” during
“Position your face,” with the existing manual-proctor-review action visible.
Reaching that failure state is not proof that face verification works.

## What PR #145 changes

- Bounds camera/microphone acquisition and preview readiness, with cleanup of
  late grants and support for retrying after a timeout.
- Shares detector backend initialization and falls back to CPU when WASM
  startup fails or does not settle within its deadline.
- Invalidates pending WASM initialization so a late completion cannot replace
  the working CPU backend.
- Bounds asset verification, model loading, and inference; disposes late
  models and prevents overlapping inference on a still-busy detector.
- Cleans up onboarding detector ownership and delayed stage advancement.

Model integrity checks, normal face verification, camera session ownership,
and the existing explicit manual-proctor-review path are preserved. The PR
does not change touchpad/keyboard runtime policy or establish the exact cause
of the affected machine's detector failure.

## Evidence and limits

Local validation passed 603 web tests, 18 desktop script tests, 244 Rust tests,
TypeScript, Clippy, formatting, and the production web build/size budgets.
An installed TensorFlow engine regression verifies that delayed WASM startup
cannot replace CPU after fallback. Mocked face predictions test presence
decisions; they are not hardware or real-model verification.

The PR's original head also passed all nine GitHub CI jobs, including the
three-platform Rust and packaging checks, MSIX, and Debian installation.
These checks do not validate a real Linux face scan. Updated PR checks remain
authoritative after synchronization with main.

## Follow-up required before closing #143

1. Record the affected distro, desktop/session type, app version, and exact
   build/commit. Establish whether it is development mode, a newly built
   installer, or an older installed release.
2. Capture the actual failing phase and error: preview readiness, runtime
   import, WASM/CPU startup, model integrity, model loading, or inference.
   The generic fallback message alone does not distinguish them.
3. Verify the bundled model and WASM assets load in the affected WebKit
   runtime, and that CPU fallback can execute the actual face model.
4. Complete a real face scan and capture on Linux. Verify the transition into
   presence checks and the contest without losing the shared camera stream.
5. Verify camera loss/retry and unavailable-detector behavior without
   fabricating successful verification or changing the manual-review policy.

Keep #143 open until these checks establish a working affected-machine scan.
Link diagnostic errors without attaching credentials or raw identity images.

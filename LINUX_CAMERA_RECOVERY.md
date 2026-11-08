# Linux camera setup and contest-preview recovery

The reported symptom occurs in development builds and AppImage: camera setup can
fail, or the contest opens without a camera preview. The fixes address six
reproduced code failures. They do not establish the cause on the affected hardware.

## Confirmed failures and repairs

- Contest preview awaited `video.play()` before starting its frame deadline, then
  awaited it again. A pending playback promise bypassed all retry handling. The
  contest now uses the same bounded preview helper as setup: playback is requested
  without blocking, and only decoded frames establish readiness. Failure returns
  to the existing bounded recovery path; no camera/proctor policy is waived.
- Camera selection and automatic recovery could both request a video stream.
  The recovery could replace the selected camera with the previous/default device
  and orphan the selected live track. Selection now owns the complete shared
  pending acquisition until preference persistence and adoption settle. Release,
  rejection and superseding selection retain generation checks and late-grant
  disposal. Cleanup must leave no orphan capture.

- Face-scan preview failure retries reused a live but non-delivering camera handle.
  Only preview-failure retries now release that exact stream before reopening;
  detector/no-face retries keep a working camera.

- Face-check model loading and review status panels covered an otherwise working
  camera with opaque full-tile overlays. Status now remains outside the video;
  detection, retry, manual review and entry authorization requirements are unchanged.

- Presence verification started its three-sample budget before a decoded video
  frame was available. It now waits for bounded preview readiness before sampling;
  preview/model failure still records unknown, never a fabricated pass.
- A timed-out presence inference can continue running. Its detector is now disposed
  only after the actual inference settles, not when the waiting deadline expires.

Setup stages already use the bounded preview helper; setup retry behavior remains
covered. Camera-session ownership fixes are shared across setup and the contest.
These shared fixes also apply to Windows and macOS, so their media regression
checks remain relevant.

## Linux permissions

The Linux handler previously allowed every WebKit permission request. The repair
restricts grants to camera/microphone capture and device information on the trusted
app/development top-level origin, and refuses new popup WebViews. The installed
WebKit API does not expose the requesting frame origin. The URI check is therefore
not per-frame origin verification; the existing navigation and frame CSP boundaries
remain part of the protection. OS device access is still required.

## Automated evidence and limits

Registered tests cover never-settling playback, delayed frames, deadlines, racing
selection/recovery, rejected selection and release during acquisition. They do not
open a physical camera or certify WebKit/GStreamer capture.

No API polling or backend requests are added. Acquisition is single-flight and
existing contest retries remain bounded. This work does not change the production
API, AWS resources, desktop settings, installed media packages or device permissions.

## Installed acceptance still required

Use both the development build and the exact candidate AppImage. Record the commit,
distro, desktop/session (Wayland/X11), WebKitGTK/GStreamer versions and camera model
class; omit serial numbers, images, credentials and raw candidate logs.

1. Enter camera setup, permit capture and verify an advancing preview.
2. Continue through face scan and into an ordinary contest; verify preview and
   monitoring continue without an extra camera open.
3. Repeat setup/contest entry and exit; confirm the camera indicator turns off on exit.
4. Unplug/replug the selected camera, then select another camera during recovery.
   Confirm the selected device wins and the old device stops.
5. Deny device access, retry, and test another application holding the camera.
   Failure must remain visible and required camera policy must still block entry.
6. Suspend/resume and test a slow-starting camera. A stalled preview must reach a
   bounded failure/retry, not remain in an indefinite spinner.
7. Verify the app's camera/microphone and device listing still work, while untrusted
   navigation and unsupported permission requests remain denied.

An AppImage plugin-presence check is packaging evidence only, not capture evidence.

## Windows parity

The three camera fixes are shared code, not Linux-only branches. Windows uses the
same decoded-frame deadline, single pending selection transaction, exact selected
camera ownership and preview-failure retry. The Windows native media-origin
allowlist is unchanged. Linux now limits permission types and top-level origins,
but its older WebKit API cannot provide Windows' requesting-origin evidence.

Repeat the installed setup/contest, device-switch, unplug/replug, permission-denial
and exit checks on Windows. Also verify the Windows team lobby preserves camera
ownership into the workspace, and voice clones/teardown do not stop the proctor's
microphone or camera. Automated shared tests and native policy tests are evidence
for code behavior; neither platform's real camera behavior is certified here.

## Validation of this patch

- Registered web suite:147 test files passed, zero failures/skips.
- Native app library:104 tests passed, including Linux and Windows media policies.
- Cargo check and formatting checks passed.
- TypeScript and production build passed; all size gates passed.
- Contest JavaScript1.84MB/1.86MB; onboarding0.76MB/0.78MB.
- Independent Sol correctness/adversarial review found no remaining blocker.
- Initial native run could not bind localhost test sockets in the sandbox; the
  rerun with socket access passed all104 tests.
- Physical camera/AppImage and installed Windows acceptance remain pending.

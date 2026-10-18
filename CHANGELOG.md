# AMS Access 3.0.0

Released 19 October 2026.

AMS Access 3.0.0 brings together the contest workspace, draft recovery,
readiness, and desktop protection improvements developed throughout the 2.x
releases, through 2.4.5. Installers are available for Windows x64, Linux x64,
and macOS on Apple Silicon and Intel.

## New since the latest published release, 2.4.4

- Identity photographs are now attempted every half hour while the exam paper
  is open, in addition to the start and end captures. A failed capture does
  not block entry or interrupt the exam; missing frames remain visible to
  invigilators rather than being presented as successful captures.
- The application and its native helper now report version 3.0.0. This
  milestone includes the improvements below, which first landed in earlier
  2.x releases; it does not introduce a new backend protocol.

## Contest workspace and recovery improvements included in 3.0.0

- Run custom test cases and inspect sample output beside the verdict, with
  clearer case tabs, submission feedback, and explanations of behaviour checks.
- Navigate questions more clearly, resize the workspace smoothly, and use
  the editor's normal macOS shortcuts.
- Keep drafts on the device, report failed local writes honestly, and retain
  drafts and device identity when signing out.
- Recover contest loading in place and re-check a timed-out run instead of
  starting another run. Network outages show a recovery overlay.
- Handle clock changes without permanently ending the contest, and keep the
  countdown visible below a MacBook's notch.
- Recover a disconnected and reconnected camera, detect frozen frames, share
  pending camera and microphone requests, and release media when its owner exits.
- Respect the app theme during the session and provide a camera preview control.

## Readiness and desktop improvements included in 3.0.0

- Improve network diagnostics, IPv6 scope handling, telemetry timeouts, and
  reporting of probes that are unavailable or did not complete.
- Treat network egress lockdown and restricted applications according to the
  readiness policy, with advisory findings reported without incorrectly
  blocking entry.
- Improve Linux lockdown lifecycle recovery, helper handling, package
  dependencies, and Debian installation checks.
- Improve macOS readiness probes and physical-machine detection, restore
  trackpad gestures promptly after the exam, and run the privileged network
  helper only while it is needed.
- Improve Windows keyboard-hook lifecycle and diagnostics, recovery ownership,
  capture-protection reporting, and supervised WebView2 firewall coverage.
- Revoke expired candidate access, clear in-memory authentication on sign-out,
  and preserve login handles containing digits or underscores.

## Installation and compatibility

- **Windows:** choose the `.msi` or `-setup.exe` installer. These installers
  are unsigned, so SmartScreen may show "Windows protected your PC". See the
  [Windows installation guide](https://github.com/Algorithms-Mathematics-Society/ams-access/blob/v3.0.0/WINDOWS-INSTALL.md)
  for verification and installation steps. The installer may request
  administrator permission; ordinary application launches use the normal
  user account unless built with the supervised firewall option.
- **Linux:** choose `.deb`, `.rpm`, or `.AppImage`. Run the graphical
  application as your normal desktop user; privileged network operations use
  the separate helper. Desktop protection support varies by environment.
- **macOS:** choose `aarch64.dmg` for Apple Silicon or `x64.dmg` for Intel.
  Both builds are signed and notarized. Camera and microphone permissions
  must be granted when requested.
- This desktop release continues to use the existing **v2 exam backend** at
  `https://api.amsaccess.com`. The 3.0.0 version does not require a new API
  generation or a client-side data migration.
- There is no automatic updater. Install the appropriate 3.0.0 package to
  upgrade. Previously published installers remain available if a rollback is
  needed, subject to the server's minimum-client-version policy.
- Microsoft Store submission is a separate workflow and is not included in
  these installer downloads.

## Verify your download

SHA-256 manifests are attached as `SHA256SUMS-<target>.txt`, one for each of
the four build targets. Place the manifest beside the corresponding
download and run:

```sh
# Linux
sha256sum --ignore-missing -c SHA256SUMS-x86_64-unknown-linux-gnu.txt

# macOS on Apple Silicon (use x86_64-apple-darwin for Intel)
shasum -a 256 -c SHA256SUMS-aarch64-apple-darwin.txt
```

On Windows, run `certutil -hashfile <installer> SHA256` and compare the
result with `SHA256SUMS-x86_64-pc-windows-msvc.txt`. Obtain the expected hash
through a separate trusted channel when possible.

[Changes since published 2.4.4](https://github.com/Algorithms-Mathematics-Society/ams-access/compare/v2.4.4...v3.0.0)
· [Cumulative changes since 2.0.0](https://github.com/Algorithms-Mathematics-Society/ams-access/compare/v2.0.0...v3.0.0)

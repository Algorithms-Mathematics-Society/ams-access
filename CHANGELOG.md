# AMS Access 4.0.1

## Linux recovery and setup fixes

- Practice onboarding now loads its platform policy without requiring a contest.
- Recorder binding completes within its advisory deadline before network lockdown; session-binding failures remain visible with a working exit.
- Failed camera selection preserves the previous working camera and preference, including overlapping switches.
- Settings offers an explicit, confirmed discard of stale keyboard recovery records while preserving current desktop settings and unrelated recovery obligations.
- GNOME coverage no longer reports success after partial failure or deadline expiry; writable checks are cached per operation and Ubuntu Dock recovery includes its schema.
- Linux startup ownership failures display a native dialog, and owned state directories are tightened to private permissions.
- Narrow Settings navigation fits 320px displays.

## Included team changes

Preserves the nine team commits shipped in v4.0.0 and adds `74c1f2a`, `e212716`, and `677d2cf`: face-position guidance and improved webcam phone detection/evidence reporting.

## Validation scope

See [the release record](release-v4.0.1.md) for exact source, artifact checks and Phase G acceptance. Fixture checks do not certify physical cameras, every Linux desktop, or production backend capacity.

---

# AMS Access 4.0.0

## Linux setup and recovery

- Bounded camera listing, acquisition, preview and face-scan recovery, with a retry or explicit manual-review route when verification cannot complete.
- Camera and display continuation follows organizer policy. Review requests and accepted camera/display warnings are recorded against the session.
- Secure-entry failure releases desktop ownership; retries wait for pending startup and cleanup, including failed restoration. Successful entry transfers ownership to the contest.
- Camera choices persist across Settings, onboarding and the contest. Existing saved choices migrate to one store; a missing selected camera requires reconnecting or choosing another device instead of silently selecting an infrared sensor. Preview recovery retains camera hotplug handling without reopening cameras after intentional exit.
- KDE uses discovered live shortcut controls and separately restores modifier-only Meta. GNOME changes preserve prior overrides and retain unresolved restoration records. Cinnamon shortcut control remains unsupported.
- Linux network recovery serializes apply/restore operations and uses the saved session token on startup. Single-instance ownership protects another running session.
- Linux packages declare media and authorization prerequisites, validate bundled resources, and include tested installer lifecycle hooks.

## Included team changes

Includes all nine commits by `aezyus` from `f94f02d` through `3288672`, preserving their Git history:

- Camera pickers in setup and the contest, with camera warnings shown without taking away the editor.
- A single camera warning banner driven by the sample that actually detects the condition, and flagged-frame evidence.
- OS-reported battery information; no invented browser battery readings.
- Clearer update messaging and recovery exits from blocking overlays.
- Windows-key release handling to prevent subsequent typing from becoming stuck.

## Rehearsal fixes

- Removed the random post-start admission wait so candidates do not lose additional time against the server deadline. Backend burst-capacity acceptance remains required.
- Formatting now waits within a bounded parser budget before applying indentation, including code beyond the initial viewport.
- Hidden dialogs no longer prevent Escape from closing editor preferences; visible priority dialogs retain keyboard ownership.
- Supervised Windows runtime staging removes only its verified link and preserves unrelated replacement paths.

## Installation and validation

- Windows x64: MSI or EXE; unsigned builds may show SmartScreen warnings. [Installation guide](https://github.com/Algorithms-Mathematics-Society/ams-access/blob/v4.0.0/WINDOWS-INSTALL.md).
- Linux x64: DEB, RPM or AppImage; run as your ordinary desktop user. Package availability is not certification of every distro, compositor or camera.
- macOS: Apple Silicon or Intel DMG, subject to successful signing/notarization and platform build checks; package minimum macOS 12.
- The existing backend remains `https://api.amsaccess.com`; no new server protocol or data migration is introduced here.
- Each build target attaches a SHA256SUMS manifest. Match the installer filename and hash before installation.

Historical note: v4.0.0 was published externally on 22 October 2026; Phase G acceptance was incomplete at publication. Local browser fault fixtures do not certify actual backend delivery, desktop/firewall restoration, physical cameras, or unsupported Linux desktop configurations. See `linux-execution.md` and `release-v4.0.0.md` for evidence and outstanding acceptance.

---

# AMS Access 3.1.1

## Startup animation

- Added a brief Welcome intro using the supplied Access animation as a reference,
  with the spire growing downward from its fixed apex above the original Geist
  wordmark and “Let the work speak.” tagline.
- The intro lasts about 1.8 seconds and plays once per app document. Returning
  to Welcome through in-app navigation does not replay it; a full reload does.
- **Skip intro** ends playback and restores keyboard focus to **Enter workspace**.
  Reduced-motion preferences bypass the intro, including changes made during
  playback. A timeout prevents a missing animation event from blocking entry.
- The animation uses local SVG/CSS artwork. No video, external media or new
  animation dependency is bundled. Direct login, home and assessment routes
  do not mount the intro.
- Updated design, UI and artwork documentation, and added six startup lifecycle
  regression tests to the web suite.

## Installation and compatibility

- **Windows x64:** choose the `.msi` or `-setup.exe` installer. These are unsigned;
  SmartScreen may show "Windows protected your PC". See the
  [Windows installation guide](https://github.com/Algorithms-Mathematics-Society/ams-access/blob/v3.1.1/WINDOWS-INSTALL.md).
  MSI files may show the generic Windows Installer icon in Explorer; the
  installed app and shortcuts use Access branding.
- **Linux x64:** choose `.deb`, `.rpm` or `.AppImage` and run the app as your
  normal desktop user.
- **macOS:** choose the Apple Silicon or Intel `.dmg` for your device. The release
  workflow signs and notarizes these builds; availability depends on successful
  platform builds and notarization.
- This release uses the existing v2 exam backend at `https://api.amsaccess.com`.
  It does not introduce a new backend protocol or client data migration.
- There is no automatic updater. Install the 3.1.1 package to upgrade. Older
  installers retain their original icons; use a newly built 3.1.1 installer.
- Microsoft Store/MSIX submission remains a separate workflow.

## Verify your download

Release builds attach `SHA256SUMS-<target>.txt` for each completed build target.
Place the manifest beside the matching downloads:

```sh
# Linux
sha256sum --ignore-missing -c SHA256SUMS-x86_64-unknown-linux-gnu.txt

# macOS on Apple Silicon (use x86_64-apple-darwin for Intel)
shasum -a 256 -c SHA256SUMS-aarch64-apple-darwin.txt
```

On Windows, run `certutil -hashfile <installer> SHA256` and compare with
`SHA256SUMS-x86_64-pc-windows-msvc.txt`. Obtain the expected checksum through
a separate trusted channel when possible.

[Changes since 3.1.0](https://github.com/Algorithms-Mathematics-Society/ams-access/compare/v3.1.0...v3.1.1)
· [Previous release notes](https://github.com/Algorithms-Mathematics-Society/ams-access/blob/v3.1.0/CHANGELOG.md)

# AMS Access 4.4.0

## Contest reference sheets

- Open the organizer-published, read-only reference sheet from the contest toolbar. The sheet is preloaded with contest data, so opening it makes no network request and adds no polling.
- Keep the editor draft, cursor, contest timer and sheet reading position while opening and closing. Keyboard focus stays inside the sheet and returns to the toolbar when closed.
- Match both themes, respect reduced motion and support small windows and older WebViews. Required contest and security dialogs take priority.
- Load only published content for candidates; skip reference content on readiness, onboarding and results requests. Refresh contest metadata when entry crosses the scheduled start.

## Sign-in

- Match the printed credentials with a Login ID field and clearer instructions. Passwords start hidden and can be revealed for checking.

## Organizer setup and validation

The companion website supports saving drafts, previewing and publishing one reference sheet per contest. Deployment requires the additive API migration and updated organizer website. Saved drafts are never included in candidate responses.

The panel was stress-tested in Chromium and Linux WebKitGTK with maximum-length content, both themes and repeated opening/closing. Native Windows, macOS, KDE, Cinnamon and Hyprland device certification is outside that browser validation. This release also includes the preceding 4.3.0 changes listed below.

---

# AMS Access 4.3.0

## Changing network without leaving the exam

- A wifi button sits beside the battery in the contest top bar. The joined network is marked and sorted first, secured networks expand a password field inline, open ones join on click.
- The same control is inside the offline dialog, with "Retry now" to force a heartbeat rather than waiting out the poll. That dialog is a native modal, so the top bar cannot be clicked through it; the control has to come to where the problem is stated.
- A candidate whose connection died could not reach the system picker at all on macOS: the kiosk hides the menu bar and the exam window cannot be moved, minimised or closed. The only remaining move was holding the power button.
- Native scan and connect on all three platforms. macOS uses `networksetup`, not the private `airport` binary macOS 14 removed. Windows parses `netsh` by the shape of its output rather than its labels, because it prints in the display language, and writes a profile to a temp file when joining a new network so the password never sits on a command line.

## Leaving a dead network

- After twenty seconds offline the dialog offers "Exit to change network". It releases the desktop and the network lockdown while keeping the session and its recovery record, so a candidate rejoins and comes straight back in without finishing the exam.

## macOS

- Apple Intelligence is turned off for the sitting and restored afterwards. Writing Tools rewrite and proofread in any standard text field and the Siri handoff answers from ChatGPT; neither was covered by disabling Siri's voice trigger.

## Validation scope

CI is green on Linux, macOS and Windows including bundle smoke. The wifi picker's native paths compile and are unit-tested at the parsing layer, but have not been exercised against a real wireless interface on any platform; the control renders nothing when the platform cannot list networks. The Apple Intelligence toggle has not been run on a Mac.

---

# AMS Access 4.2.0

## Sign-in and recovery

- Keep startup feedback visible while checking the app version and saved sign-in.
- Explain the handle suffix, focus missing credentials, and keep optional metadata storage failures from blocking sign-in.
- Preserve a fresh sign-in when older credentials remain in storage after a failed write.
- Keep cached contest notices visible during search and report unavailable recovery data clearly.

## Assessment responsiveness

- Prevent obsolete requests from restoring invalidated cache entries or overwriting another session's submissions.
- Serialize submission refreshes and retain selected testcase results across equivalent updates.
- Cover response-body loading with the session-creation request deadline.
- Avoid repeated array copying when grouping attempts and repeated filtering when displaying them.

## Help and presentation

- Preserve pending help requests and receipts across closing and reopening, validate email, and distinguish unconfirmed delivery from rejection.
- Balance the header logo and replace redundant copy with clearer next actions.

## Validation

793 frontend tests passed, along with production TypeScript validation, static export and size budgets. Isolated browser checks covered both themes and narrow/desktop layouts. These checks do not certify physical devices or live assessments; release CI validates platform builds separately.

---

# AMS Access 4.1.0

## macOS kiosk

- The exam window can no longer be resized, minimised or closed during a contest, and its frame is held to the screen it is on. Hiding the Dock, raising the window level and pinning to every Space all assumed the window already filled the screen; none of them stopped a candidate dragging a corner and reading another document beside the exam.
- The original style mask and frame are restored on a normal exit. A window already in native fullscreen is left alone, because AppKit owns its frame there.

## Second screens

- Displays are counted every ten seconds for the whole paper, not once at the door inside the readiness scan. Connecting a monitor after entry was previously invisible.
- A second screen raises a banner that outranks every other camera warning and is flagged for review. Reported once per change, so two hours on two screens is one flag.

## Proctoring evidence reaches the server

- Presence anomalies, suspected phones, leaving the exam window, copying the statement and external pastes into the answer editor are now uploaded. All of them were detected before and stopped on the candidate's own machine, so `proctor.violations` was empty for every contest the platform had run.
- Only confirmed anomalies are sent, each once per run; routine presence samples stay local. A detector that fails to start is recorded as a device problem rather than counted against the candidate.
- The queue is flushed every thirty seconds. Previously only a network recovery sent one, so a candidate whose connection never faltered finished with every flag still in their browser.

## Phone detection

- The detector is fed a frame at its own input width instead of the 128px presence canvas, where a phone survived as roughly a dozen pixels and could not reach any score threshold.
- The acting threshold is 0.35 rather than the sample-page 0.5, and near misses are kept so a non-detection can be told apart from a detector that never loaded.
- A detection shows the candidate a banner saying the frame will be flagged, and sends a thumbnail for human review.

## Framing

- A face slumped low or running past a frame edge is now off-centre. The old ellipse put the bottom of "ok" at y=0.98, so the nudge never fired for the posture it exists to catch.

## Validation scope

CI is green on Linux, macOS and Windows, including bundle smoke on all three. The macOS window changes are compiled and bundled but have not been exercised on a real contest; second-screen detection uses Tauri's monitor enumeration and behaves the same on all three platforms.

---

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

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

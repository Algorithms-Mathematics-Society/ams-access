# AMS Access 3.1.0

## Branding and UI

- Updated Welcome, Login, Home, Device setup and the contest header to the
  supplied monochrome Access spire and Geist wordmark.
- Regenerated native app icons, Windows Store tiles, browser favicon and Apple
  touch icon. Windows builds now refresh the executable's embedded icon when
  artwork changes; installer and uninstaller icons use the same source.
- Fixed theme switching briefly showing mismatched text and background colors.
- Fixed dashboard calendar hydration when the build and device use different
  locales or timezones.
- Fixed the React font-style warning when switching contest result tabs.

## Development and documentation

- Disabled persistent Webpack caching in development to avoid the reproduced
  cache-buffer allocation crash with `pnpm dev:hosted`. Production caching and
  chunk splitting are unchanged.
- Consolidated current design rules in `DESIGN.md` and route/development
  guidance in `apps/web/UI.md`. Superseded plans point to these guides;
  historical evidence, browser review tools, fixtures, tests and CI are retained.

## Installation and compatibility

- **Windows x64:** choose the `.msi` or `-setup.exe` installer. These are unsigned;
  SmartScreen may show "Windows protected your PC". See the
  [Windows installation guide](https://github.com/Algorithms-Mathematics-Society/ams-access/blob/v3.1.0/WINDOWS-INSTALL.md).
  MSI files may show the generic Windows Installer icon in Explorer; the
  installed app and shortcuts use Access branding.
- **Linux x64:** choose `.deb`, `.rpm` or `.AppImage` and run the app as your
  normal desktop user.
- **macOS:** choose the Apple Silicon or Intel `.dmg` for your device. The release
  workflow signs and notarizes these builds; availability depends on successful
  platform builds and notarization.
- This release uses the existing v2 exam backend at `https://api.amsaccess.com`.
  It does not introduce a new backend protocol or client data migration.
- There is no automatic updater. Install the 3.1.0 package to upgrade. Older
  installers retain their original icons; use a newly built 3.1.0 installer.
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

[Changes since 3.0.0](https://github.com/Algorithms-Mathematics-Society/ams-access/compare/v3.0.0...v3.1.0)
· [Previous release notes](https://github.com/Algorithms-Mathematics-Society/ams-access/blob/v3.0.0/CHANGELOG.md)

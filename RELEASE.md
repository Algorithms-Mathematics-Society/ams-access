# Releasing AMS Access

## The version

One number, declared once, in `Cargo.toml` under `[workspace.package]`.
Everything else follows it:

- `apps/desktop/src-tauri/tauri.conf.json` **must not declare a version.**
  Tauri's config silently overrides the crate version, which is how the
  workspace sat at `0.1.0` while the installers said `1.1.0` for several
  releases without anyone noticing.
- the three `package.json` files must match.

`pnpm check:versions` enforces both and runs in CI.

To cut a release: bump `[workspace.package] version`, run
`node scripts/check-versions.mjs`, fix the manifests it names, commit, then
push a `v<version>` tag.

## What ships

| Platform | Artifacts                   | Signed               |
| -------- | --------------------------- | -------------------- |
| Windows  | `.msi`, `-setup.exe`        | **No** — see below   |
| Linux    | `.deb`, `.rpm`, `.AppImage` | n/a                  |
| macOS    | —                           | not built; see below |

### Windows is unsigned

There is no code-signing certificate, so:

- SmartScreen shows **"Windows protected your PC"** and hides the Run button
  behind _More info_.
- The installer requests administrator. `build.rs` sets
  `requireAdministrator` in the manifest, and the app genuinely needs it — the
  network lockdown installs a firewall rule.

An unsigned executable demanding elevation is, from a candidate's point of
view, indistinguishable from malware. That is why the release body publishes
SHA-256 sums for every artifact and tells people to check them. Candidates
should be sent the hash through a channel other than the download link.

Fixing this needs either an OV/EV certificate or Azure Trusted Signing. Both
are a `signtool` step plus repo secrets in `release.yml`; neither is set up.

### macOS is not built

Notarization fails with `403 — A required agreement is missing or has
expired`. An unnotarized `.dmg` is worse than no `.dmg`: Gatekeeper refuses to
open it and the candidate cannot run the app at all.

`bundle.targets` still lists `dmg`/`macOS` and Tauri filters by host, so
`pnpm build:mac-dev` works locally for development. To restore macOS releases,
accept the agreement in App Store Connect and revert one commit: the two
`macos-latest` matrix rows and the _Import Apple certificate_ step, both
removed from `release.yml` with a comment pointing here.

## There is no auto-updater

Deliberate. A proctored client that can silently change itself between the
readiness check and the contest is a liability — the binary that passed the
checks would not be the one sitting the exam.

`TAURI_SIGNING_PRIVATE_KEY` used to be set in CI. It did nothing: there is no
`plugins.updater` block in `tauri.conf.json`, so no signature was ever
produced and the `*.sig` upload globs matched nothing while looking like they
worked. All of it is gone.

Version skew is handled server-side instead. The desktop sends
`X-AMS-Client-Version`; the API refuses anything below its
`AMS_MIN_CLIENT_VERSION` with `426 Upgrade Required` and a download URL, so a
candidate on an old build gets a sentence telling them what to install rather
than a login screen that fails for no stated reason.

## Before tagging

CI already runs these on every non-draft PR, so a green PR is the real
precondition:

- `pnpm test` — guard tests across every package, including the Rust/TypeScript
  readiness-policy parity fixture.
- `cargo test --workspace`, `cargo clippy --workspace -- -D warnings`,
  `cargo fmt --check`.
- **`bundle-smoke`** — a real `tauri build` on Linux, Windows and macOS that
  asserts an installer came out. macOS is included even though it is not
  released: it is the only job that compiles `platform-rs/src/macos/mod.rs`.

That job exists because packaging breakage used to surface only after a tag
was pushed. v1.0.3, v1.0.4 and v1.1.0 all shipped broken that way.

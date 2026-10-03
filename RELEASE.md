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

| Platform | Artifacts                   | Signed                   |
| -------- | --------------------------- | ------------------------ |
| Windows  | `.msi`, `-setup.exe`        | **No** — see below       |
| Linux    | `.deb`, `.rpm`, `.AppImage` | n/a                      |
| macOS    | `.dmg` (arm64 + Intel)      | signed **and notarized** |

### Windows is unsigned

There is no code-signing certificate, so:

- SmartScreen shows **"Windows protected your PC"** and hides the Run button
  behind _More info_. This is the only prompt left.
- The app **no longer requests administrator.** `build.rs` manifests it
  `asInvoker`; only `netsh advfirewall` ever needed elevation, and contests do
  not rely on the OS-level network lockdown. `AMS_FIREWALL=1` at build time
  restores both the firewall and a UAC prompt on every launch.

An unsigned executable is, from a candidate's point of view, hard to tell from
malware. That is why the release body publishes SHA-256 sums for every
artifact and tells people to check them. Candidates should be sent the hash
through a channel other than the download link.

No certificate is being bought — that is settled. The Microsoft Store build
avoids the warning entirely, because Microsoft signs it; see
`apps/desktop/msix/README.md`. The signing scaffolding in `release.yml` stays
inert unless secrets appear.

### The API host is not configurable, deliberately

`resolveApiBase()` returns `https://api.amsaccess.com` from its own constant,
that constant is the only origin the release CSP allows, and
`csp-allows-api-base.test.mjs` checks the two agree.

**Do not set `NEXT_PUBLIC_API_URL` in `release.yml`.** Next bakes
`NEXT_PUBLIC_*` at build time and `resolveApiBase()` prefers the environment,
so a repository secret silently overrides all three. That is what shipped in
v2.0.0: a secret predating the move off Cloud Run, a dead host in every
installer, and "Cannot reach the exam server" on a healthy API. Tests missed
it because they run without the secret, and `tauri dev` missed it because
`devCsp` is permissive.

### macOS needs a live Apple agreement

macOS is in the release matrix: two `macos-latest` rows (Apple Silicon, and
Intel cross-compiled on the same runner because GitHub retired the `macos-13`
Intel runners — a job pinned to that label queues 24h and cancels the whole
run, which killed v1.0.3 and v1.0.4).

It was parked for a while because notarization returned `403 — A required
agreement is missing or has expired`, and an unnotarized `.dmg` is worse than
none: Gatekeeper refuses to open it, so the candidate cannot run the app at
all. **That 403 is an Apple-account state, not a code problem.** Apple
publishes new Program License Agreement versions periodically and notarization
stops until someone accepts the new one in App Store Connect.

Before tagging a release that includes macOS, check the agreement is live —
it takes one command on any Mac and costs nothing:

```
xcrun notarytool history --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_PASSWORD"
```

A 403 there means the agreement needs accepting at
<https://developer.apple.com/account> and in App Store Connect → Business →
Agreements. Anything else means notarization will work.

`fail-fast: false` means a blocked Apple account costs a red macOS job rather
than the whole release: the Linux and Windows artifacts still build and
upload.

**The six secrets this needs** are already set on the repository:
`APPLE_CERTIFICATE` (base64 `.p12` holding a **Developer ID Application**
certificate — not "Mac App Distribution", which cannot notarize),
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD` (an **app-specific** password from appleid.apple.com; the
account password fails with an unhelpful 401) and `APPLE_TEAM_ID`.

`bundle.targets` lists `dmg`/`macOS` and Tauri filters by host, so
`pnpm build:mac-dev` works locally regardless of any of this.

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

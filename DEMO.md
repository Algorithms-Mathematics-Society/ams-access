# Demo and build runbook

Run from the current repository checkout. Use [DESIGN.md](DESIGN.md) and the
[candidate UI guide](apps/web/UI.md) for the current UI, branding and verification
boundaries. Old machine-specific checkout paths and review captures are not
development prerequisites.

## Prepare once

Use Node.js 24 (the repository requires at least 22.6), pnpm 10.30.3, and Rust with Cargo. Native Linux builds also need the GTK/WebKit/system libraries listed in [CI](.github/workflows/ci.yml).

```sh
pnpm install --frozen-lockfile
```

Install dependencies in this checkout. Do not symlink its `node_modules` to another worktree. `CARGO_TARGET_DIR` may point at a shared Cargo cache; helper staging now resolves Cargo's actual output directory.

## Run the desktop app during development

```sh
pnpm --filter @ams/desktop dev
```

This prepares the helper and starts one Next.js server on port 3000 through Tauri. Do not start a second web server on that port. The desktop app is the product; a browser preview cannot demonstrate native lockdown or helper integration.

The ignored `apps/web/.env.local` can contain `NEXT_PUBLIC_DEV_API_URL=https://api.amsaccess.com` for a development rehearsal. The existing local setting was preserved during reconciliation. Credentials and environment files are not committed. Packaged Tauri origins use the production API target independently of this development override.

## Build a Linux demo installer

```sh
pnpm --filter @ams/desktop exec tauri build --bundles deb
```

The build prepares the native helper, exports the production frontend, checks its size budgets, compiles the release app, and creates a Debian installer. Find it under Cargo's `target_directory`, in `release/bundle/deb/`; the default is `target/release/bundle/deb/`. `cargo metadata --no-deps --format-version 1 --locked` reports the configured directory.

Install/run the package on the intended demo device before rehearsal. A complete live exam requires a reachable API, an organizer-provided test account and assignment, and the applicable native permissions/helper installation. Building a package does not verify those external prerequisites. Do not enable `NEXT_PUBLIC_AMS_RELAX_GATING` for a live demonstration or distribution build.

## Inspect the production UI without changing native controls

After the desktop build (or `pnpm --filter @ams/web build`), serve the exact static export:

```sh
python3 -m http.server 3010 --bind 127.0.0.1 --directory apps/web/out
```

Open `http://127.0.0.1:3010/`. Port 3010 intentionally avoids the app's port-3000 development API routing. This preview uses the production API for real sign-in; it does not simulate successful authentication or native readiness.

For an editable browser preview, use `pnpm --filter @ams/web dev:hosted` on port
3001, or `pnpm dev:hosted` from `apps/web`. This does not start the native app.
Development output uses `.next-dev`; production uses `.next` and `out`. Persistent
Webpack caching is disabled in development to avoid large cache-pack buffer
allocations; production caching is unchanged.

Use the regular tests and focused checks in [apps/web/UI.md](apps/web/UI.md).
Standalone browser capture/check runners remain in `scripts/`, with their fixture
helpers and evidence documentation. They are optional tools, use Linux Chrome
paths, and may encode assumptions from earlier UI snapshots; inspect them before
using their results as a current gate. Browser
presentation checks do not establish native enforcement, real login, or judged
submission correctness. A `mock-contest-dev` URL is not a supported demo mode.

## Verify source before handoff

```sh
pnpm --filter @ams/web test
pnpm --filter @ams/web typecheck
pnpm --filter @ams/api-client test
pnpm --filter @ams/desktop test
cargo test --workspace --locked
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
```

Record the commit, package SHA-256, and actual checks performed. Windows/macOS packaging and native enforcement need their own platform validation; Linux evidence does not certify them.

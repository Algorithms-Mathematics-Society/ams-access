# Demo and build runbook

Use the reconciled source described in [reconciliation-review.md](reconciliation-review.md). On this machine its checkout is `/home/user/AccessSoftware/ams-access-main`. Historical screenshot and task-verification documents describe earlier builds; this is the current runbook.

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

For repeatable UI regression evidence without a live backend, run in a second terminal:

```sh
AMS_THEME_EVIDENCE_DIR=/tmp/ams-demo-evidence node scripts/performance-review-capture.mjs http://127.0.0.1:3010
```

The existing runner uses an isolated headless Chrome profile with browser fixtures and blocks external HTTP. It checks Home polling, editor draft recovery/style reuse, dialog focus, and resize behavior, and saves screenshots plus a manifest. It requires `/usr/bin/google-chrome`. These are fixture-based UI checks, not proof of native enforcement, real login, or judged submissions. The fixtures are not included in the packaged app. A `mock-contest-dev` URL alone is not a supported demo mode.

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

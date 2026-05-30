# Testing Audit

Date: 2026-05-30
Repo: ams-access

## Scope

Spawned five focused testing passes: unit, integration, E2E/app-flow, manual QA, and performance. Consolidated their fixes, reviewed the combined diff, and reran the relevant gates from the root workspace.

## Fixes Applied

### Unit Testing

- Added focused Rust readiness-policy unit tests in packages/core-rs/src/exam/mod.rs.
- Covered the all-pass strict contest path.
- Covered a custom optional network requirement that warns without blocking.

### Integration Testing

- Fixed noninteractive web lint/typecheck scripts in apps/web/package.json.
  - Replaced deprecated interactive next lint behavior with next typegen && tsc --noEmit.
  - Added Next route type generation before tsc so clean checkouts do not depend on stale .next/types output.
- Added @ams/web as a workspace dependency of @ams/desktop in apps/desktop/package.json and pnpm-lock.yaml.
  - This gives Turbo the missing build ordering so root builds do not run the web build and Tauri beforeBuildCommand against the same .next directory at the same time.
- Disabled doctests for the Tauri bridge library in apps/desktop/src-tauri/Cargo.toml.
  - The crate has no doctests and cargo test --workspace was failing in rustdoc while resolving workspace externs for the Tauri static/cdylib/rlib target.
- Ignored TypeScript incremental metadata with \*.tsbuildinfo and disabled web incremental tsc to prevent stale tracked tsbuildinfo from referencing missing generated Next files.

### E2E / App Flow Testing

- Added apps/web/src/pages/\_app.tsx as a minimal Pages Router shim so Next static export emits the pages manifest expected during export.
- Made useSearchParams() null-safe in apps/web/src/app/session/contest/client.tsx.
- Verified route rendering through static build and local route probes from the E2E pass.

### Manual QA

- Improved login accessibility in apps/web/src/app/page.tsx.
  - Associated login labels with inputs.
  - Marked login errors as role=alert.
  - Added an accessible name to the error dismiss button.
  - Added dialog semantics and title association for the SSO modal.
- Improved home/settings accessibility in apps/web/src/app/home/page.tsx.
  - Associated the session code label with its input.
  - Added accessible names for camera selection and test-tone gain controls.
- Improved contest/support accessibility in apps/web/src/app/session/contest/client.tsx.
  - Added accessible names for the answer editor and custom support issue textarea.

### Performance Testing

- Hardened apps/web/scripts/check-size-budgets.mjs.
  - Validates budget environment variables as positive numbers.
  - Fails clearly if out/ is missing.
  - Fails clearly if no JS chunks are present.
  - Always checks the largest JS chunk instead of silently skipping that budget.

## Verification Run

- pnpm --filter @ams/web build: passed.
  - Static export out/: 1.97 MB / 45.00 MB.
  - public/mediapipe/: 0.00 MB / 40.00 MB.
  - Largest JS chunk: 0.28 MB / 0.34 MB.
- cargo test --workspace: passed.
  - core-rs: 5 tests passed.
  - Tauri/platform crates: no unit tests, doctest issue resolved.
- pnpm build: passed.
  - Web export passed.
  - Desktop Tauri build passed.
  - Bundles produced: deb, rpm, AppImage.
- pnpm typecheck: passed.
- pnpm lint: passed.

## Notes And Residual Risks

- Local toolchain still warns because Node is v18.19.1 while package.json requires Node >=20. The final gates passed in this environment, but CI/developer machines should use Node 20+ to match the declared engine.
- Local pnpm is 9.15.9 while packageManager declares pnpm@10.30.3. The final gates passed, but lockfile and install behavior should be validated with pnpm 10 in CI.
- No Playwright/Cypress suite exists, so E2E coverage is route/build probing rather than full browser interaction automation.
- Tauri desktop packaging is now verified locally, but real camera/microphone/lockdown behavior still needs physical-device manual testing.
- Turbo warned that @ams/desktop#build has no matching output files in turbo.json; build succeeds, but cache outputs could be tightened later.

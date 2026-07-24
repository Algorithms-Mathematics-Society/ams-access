# cxxprobe integration plan

Plan date: 2026-07-24
Baseline: `cxxprobe` v0.8.1 at `3fe00c4`; `ams-access` local `main` at `3769026`; `ams-golang` Phase 2a work starts from `main` at `950d09b`.
Scope: integrate cxxprobe as the authoritative C++ problem/evaluation engine behind the existing Go control plane, with one remote contract for Windows, Linux, and macOS clients. This document is a plan, not evidence that the integration has shipped.

Implementation status (2026-07-24): Phase 0, the cxxprobe-owned portion of
Phase 1, Phase 2a, Phase 2b, and Phase 2c are committed on the three repositories'
`main` branches. The server-side Phase 2d candidate projection, Phase 2e
ams-access client switch, and Phase 2f disposable PostgreSQL qualification are
implemented in the current uncommitted working trees. Evidence and remaining
gates are in
[`04-phase-0-1-cxxprobe-completion.md`](04-phase-0-1-cxxprobe-completion.md),
[`05-phase-2a-go-foundation-completion.md`](05-phase-2a-go-foundation-completion.md),
[`06-phase-2b-bundle-import-completion.md`](06-phase-2b-bundle-import-completion.md),
[`07-phase-2c-public-contract-snapshot-completion.md`](07-phase-2c-public-contract-snapshot-completion.md),
[`08-phase-2d-candidate-projection-completion.md`](08-phase-2d-candidate-projection-completion.md),
[`09-phase-2e-candidate-client-completion.md`](09-phase-2e-candidate-client-completion.md),
and
[`10-phase-2f-postgresql-qualification-completion.md`](10-phase-2f-postgresql-qualification-completion.md).
Go now verifies, persists, snapshots, and serves only schema-v2 public bytes
through strict session-owner APIs. ams-access now consumes that projection only
after session binding, strictly verifies metadata/content/assets, and presents a
C++23 editor while keeping Phase 3 judging visibly disabled. Migrations 001–042
now pass real PostgreSQL 16.14 fresh, rollback, constraint, immutability, and
concurrency tests. Phase 2 still needs qualification on the exact deployed
PostgreSQL major, staging GCS, and cross-platform desktop qualification. Phase 3
scored cxxprobe routing remains unimplemented.

## Decision summary

1. **Keep cxxprobe server-side on Linux.** Production candidates on Windows, Linux, and macOS must not install or execute cxxprobe. Every client continues to submit through the Go HTTPS API.
2. **Use the cxxprobe CLI JSON contract for the first production integration.** A Go worker executes one pinned cxxprobe process for one durable Go attempt. The exact initial command is:

   ```text
   /opt/cxxprobe/bin/cxxprobe test problem <slug> \
     --dir <immutable-contest-root> \
     --submission <attempt-source.cpp> \
     --json
   ```

   The Go implementation must use an argument-vector API such as `exec.CommandContext`, never construct a shell command from a slug or path.

3. **Keep Go as the single control plane.** Go continues to own authentication, contest/session state, attempt idempotency, Pub/Sub delivery, retries, durable results, scoring, and client APIs.
4. **Use `cxxprobe serve` initially for problem-authoring/prejudge experiments, not as a second production queue.** v0.8.1's REST API and CLI share the same canonical `JudgeReport` JSON (`cxxprobe/docs/content/architecture/http-service.mdx:95-98`). That makes HTTP a future transport option without changing the result parser.
5. **Make problem and engine identity immutable.** Every published contest question and attempt records a content digest, contract version, cxxprobe version/commit, binary or image digest, and resolved toolchain identity.
6. **Treat cxxprobe's sandbox as the inner resource sandbox.** Untrusted submissions also run inside a disposable, credential-free, no-egress outer boundary. cxxprobe explicitly has no seccomp filter, network namespace, or filesystem overlay (`cxxprobe/docs/content/architecture/sandbox-internals.mdx:87-95`).
7. **Make the first release explicitly C++-only.** cxxprobe v0.8.1 accepts only `cpp` through its service and defaults to C++23 (`cxxprobe/docs/content/architecture/http-service.mdx:149-159`, `cxxprobe/include/cxxprobe/problem.hpp:67-73`). Python, Java, interactive, output-only, and Go-specific question types stay on a separately named legacy path or remain unavailable; they must never be silently translated into the cxxprobe contract.

## Why CLI first

| Option                           | What it gives us                                                                                                        | Production issue today                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Decision                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Go worker invokes CLI            | One existing durable queue/database; process boundary; exact canonical JSON; easiest attempt-level timeout and cleanup. | Per-attempt process startup; Go must manage bundle materialization and parsing.                                                                                                                                                                                                                                                                                                                                                                                            | **First production path.**                                |
| Go calls `cxxprobe serve`        | Built-in bounded worker pool, health, metrics, REST/SSE, and the same judge pipeline.                                   | v0.8.1 has no auth; defaults to `0.0.0.0`; uses an in-memory queue/local event bus plus SQLite; creates its own submission ID; and does not store Go attempt idempotency, engine digest, or problem digest (`cxxprobe/docs/content/architecture/http-service.mdx:29-36`, `cxxprobe/docs/content/architecture/http-service.mdx:71-75`, `cxxprobe/docs/content/architecture/http-service.mdx:149-165`, `cxxprobe/server/repository/sqlite_submission_repository.cpp:22-31`). | Authoring/dev now; reassess after the sidecar gate below. |
| Go links libcxxprobe through cgo | Avoids process/HTTP overhead.                                                                                           | C++ ABI/lifetime/crash handling crosses into the Go worker; a library fault can take down the consumer; packaging is more complex.                                                                                                                                                                                                                                                                                                                                         | Do not use for the first integration.                     |

If `serve` is exercised before its production gate, bind it to `127.0.0.1`, keep the developer UI off, place it behind the trusted Go worker, and never expose it to a candidate network. v0.8.1 otherwise defaults to a public bind and permissive CORS (`cxxprobe/cli/commands/serve_cmd.hpp:21-28`, `cxxprobe/server/middleware/cors_middleware.cpp:5-9`).

## Target architecture

```text
cxxprobe source bundle
  problem.yaml + statement + tests/answers + checker + symbolic/behavior files
                    │
                    │ validate, normalize, hash, publish once
                    ▼
           immutable object storage
                    │ bundle_digest + manifest
                    ▼
ams-golang API ── Postgres contest/session/attempt snapshot ── Pub/Sub job
                    │
                    ▼
       disposable Linux judge boundary
       ┌─────────────────────────────────────────────────────────┐
       │ trusted broker: fetch bundle/source, verify SHA-256     │
       │ no-secret execution cell: pinned cxxprobe CLI + g++    │
       │ parse canonical JSON, copy bounded report out, destroy  │
       └─────────────────────────────────────────────────────────┘
                    │ one transactional terminal result
                    ▼
       ams-golang candidate/organizer APIs
                    │
          identical HTTPS/JSON contract
           ┌────────┼────────┐
           ▼        ▼        ▼
        Windows   Linux    macOS
        Tauri     Tauri    Tauri
```

There must be no direct client-to-cxxprobe route and no secret test/checker/solution asset in the candidate question payload.

## Responsibility boundary

| Concern                     | Authoritative owner | Required rule                                                                                                                                                                                                     |
| --------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Executable coding semantics | `cxxprobe`          | `problem.yaml`, compiler standard/flags, limits, manual tests/answers, checker, symbolic rules, behavior checker, statement/starter/reference files.                                                              |
| Contest metadata            | `ams-golang`        | Question UUID, order, points, visibility, schedule, invites, session state, and mapping to one published cxxprobe bundle digest. Go must not independently restate judge limits or tests for a cxxprobe question. |
| Candidate experience        | `ams-access`        | Render the public projection, edit source, submit/save, and display returned structured results. It never evaluates locally.                                                                                      |
| Attempts and delivery       | `ams-golang`        | Attempt ID, idempotency key, status transition, durable queue, retry/reaper, final score, and audit trail.                                                                                                        |
| Resource measurement        | `cxxprobe`          | Per-case CPU time from cgroups, monotonic wall time, peak memory, exit code, and case verdict. Go stores these values without synthetic adjustment.                                                               |
| Hostile-code boundary       | judge deployment    | No credentials/metadata/egress, minimal mounts, seccomp/capability policy, resource quotas, and complete per-job destruction in addition to cxxprobe's inner sandbox.                                             |

## Contract 1: published problem bundle

### Bundle identity

Add a versioned publication manifest generated by cxxprobe, tentatively `bundle-manifest.json`. The manifest—not archive timestamps or compression bytes—defines identity:

```json
{
  "contract_version": 1,
  "problem_slug": "two-sum",
  "cxxprobe_schema_version": 1,
  "files": [{ "path": "problems/two-sum/problem.yaml", "size": 421, "sha256": "..." }],
  "bundle_sha256": "..."
}
```

Canonicalization rules must be part of the contract:

- paths are UTF-8, relative, slash-separated, normalized, unique, and sorted bytewise;
- no absolute path, `..`, empty component, device name, symlink, hard link, socket, or special file;
- file size, total expanded size, file count, and path length are bounded;
- each file digest is SHA-256; `bundle_sha256` is the SHA-256 of canonical manifest content with that field omitted;
- permissions and archive mtimes do not affect identity;
- case-only path collisions are rejected so authoring on Linux cannot become ambiguous on Windows/macOS tooling;
- unknown manifest/schema versions fail publication.

The cxxprobe repository should own a machine-readable command such as `cxxprobe bundle validate <dir> --json` and a deterministic fixture suite. Until that exists, Go may prototype the wrapper, but the contest cannot be marked production-cxxprobe because two repositories would still be defining validity.

### Publication flow

1. Organizer uploads or selects a source bundle.
2. Go stores it in a quarantine location, safely extracts it, and invokes the pinned cxxprobe validator.
3. Validation runs reference/manual, symbolic, and behavior checks and rejects a problem with no meaningful enabled checks. It records the resolved compiler, flags, limits, and schema compatibility.
4. Go uploads the immutable validated bundle under a content-addressed key, for example `cxxprobe/bundles/sha256/<digest>.tar.zst`, and stores the manifest separately.
5. Publishing a contest snapshots the digest and public projection. Editing source creates a new digest; it never mutates an existing object or an active contest/session.
6. Only the statement, starter code, supported language, public limits, and digest reach candidates. Answers, reference solution, private tests, and checkers remain worker-only.

Required Go records, names to be finalized in the migration:

- `problem_bundles`: digest, contract/schema version, storage URI, manifest JSON, validation state, created/published timestamps;
- contest-question publication: `judge_engine='cxxprobe'`, bundle digest, public projection, points/order;
- session-question snapshot: bundle digest copied at session creation/start;
- attempt: bundle digest copied when the attempt is created, never looked up dynamically later.

## Contract 2: judge job and invocation

The durable Go job must carry or resolve these immutable fields:

```json
{
  "contract_version": 1,
  "attempt_id": "uuid",
  "submission_kind": "SUBMIT",
  "judge_engine": "cxxprobe",
  "problem_slug": "two-sum",
  "problem_bundle_sha256": "...",
  "language": "cpp",
  "source_sha256": "...",
  "engine_version": "0.8.1",
  "engine_commit": "3fe00c4"
}
```

Worker rules:

1. Atomically claim the existing Go attempt and preserve current redelivery/idempotency guards.
2. Fetch bundle and source through a trusted broker, recompute both digests, and reject mismatches as infrastructure errors before execution.
3. Materialize an attempt-specific directory. Never share a writable problem tree between attempts.
4. Execute the pinned CLI with a parent deadline slightly larger than the maximum cxxprobe compile + case wall budget. Capture stdout and stderr separately with hard byte limits.
5. Parse exactly one JSON object from stdout even when the CLI exits 1 for `FAIL` or 2 for `ERROR`; exit code alone is not the verdict. Reject unknown required fields, unknown status/verdict strings, wrong returned slug, truncated JSON, or oversized diagnostics.
6. Store terminal result and score in one database transaction guarded so a duplicate delivery cannot overwrite a terminal attempt.
7. Remove the entire execution cell. Failed cleanup quarantines the worker; it must not accept another job.

Build cxxprobe from the exact tagged source/commit into the worker image. For the CLI path, build with `CXXPROBE_BUILD_SERVER=OFF` and tests disabled in the runtime stage to reduce dependencies, but run cxxprobe's complete test suite in the builder/CI stage. Record the source commit, binary SHA-256, worker image digest, compiler binary/package version, libc/glibc baseline, and resolved flags. Do not download `latest` during an image build.

## Contract 3: result envelope and verdict mapping

cxxprobe v0.8.1 already emits manual cases with `verdict`, `exit_code`, `cpu_time_ms`, `wall_time_ms`, and `peak_memory_bytes`; symbolic checks and behavior cases are separate; compile reports include `ok`, exit code, and diagnostics (`cxxprobe/src/judge/judge_json.cpp:19-108`). Go should store the raw canonical report plus a versioned AMS envelope rather than flattening away those distinctions.

```json
{
  "contract_version": 1,
  "attempt_id": "uuid",
  "judge_engine": "cxxprobe",
  "engine_version": "0.8.1",
  "engine_commit": "3fe00c4",
  "engine_binary_sha256": "...",
  "worker_image_digest": "sha256:...",
  "problem_bundle_sha256": "...",
  "source_sha256": "...",
  "public_verdict": "AC",
  "failure_kind": null,
  "raw_report": {}
}
```

Mapping order is deterministic and tested with golden reports:

| cxxprobe outcome                                                                                                             | Go public verdict                                        | Structured detail                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solution compile ran and `ok=false`                                                                                          | `CE`                                                     | `failure_kind=SUBMISSION_COMPILE`; retain bounded compiler diagnostics.                                                                                                                     |
| cxxprobe `overall=ERROR`, invalid/missing bundle, behavior-checker compile failure, malformed report, or worker/tool failure | `IE`                                                     | Distinguish `PROBLEM_CONFIG`, `CHECKER_COMPILE`, `ENGINE_PROTOCOL`, `WORKER_TIMEOUT`, `BUNDLE_DIGEST`, and other operational causes. Never blame the candidate for an infrastructure error. |
| Manual case `TLE`, `MLE`, `OLE`, or `RE`                                                                                     | Same public verdict                                      | Preserve every case, applying cxxprobe's result order rather than recomputing it in Go.                                                                                                     |
| Manual case `WA`                                                                                                             | `WA`                                                     | `failure_kind=MANUAL_CHECK`.                                                                                                                                                                |
| Symbolic status `FAIL`                                                                                                       | `WA` for scoring/API compatibility                       | `failure_kind=SYMBOLIC_CHECK`; expose safe check messages, not hidden patterns unless explicitly public.                                                                                    |
| Behavior status `FAIL`                                                                                                       | `WA` for scoring/API compatibility                       | `failure_kind=BEHAVIOR_CHECK`; expose safe GTest case names/messages according to problem policy.                                                                                           |
| All enabled checks pass                                                                                                      | `AC`                                                     | Full report retained.                                                                                                                                                                       |
| `SKIPPED` because nothing meaningful ran                                                                                     | `IE` during judging; publication should have rejected it | `failure_kind=EMPTY_PROBLEM`.                                                                                                                                                               |

For multiple manual failures, keep every per-case verdict and use an explicitly tested aggregate precedence compatible with cxxprobe's own case semantics. Do not make SQL query order choose the final verdict accidentally.

### Timing and memory

- Store per-case `cpu_time_ms`, `wall_time_ms`, and `peak_memory_bytes` verbatim.
- Keep legacy `runtime_ms` temporarily as the maximum manual-case CPU time and document that compatibility rule in the API schema.
- Keep legacy `memory_kb` as `ceil(max peak_memory_bytes / 1024)`.
- Add explicit attempt-level `max_cpu_time_ms`, `max_wall_time_ms`, and `max_peak_memory_bytes`; do not subtract language overhead, round for presentation before storage, or add input-derived jitter.
- Do not rank candidates by runtime until homogeneous worker hardware, warm-up policy, contention limits, and repeated-run variance have passed a published calibration gate.

The current Go verdict set already contains `AC`, `WA`, `TLE`, `MLE`, `RE`, `CE`, `OLE`, `IE`, and `SKIPPED` (`ams-golang/internal/db/migrations/007_cp_judge_runtime.sql:85-123`), so the first adapter can preserve public compatibility while adding structured cxxprobe detail and provenance.

## Go implementation work packages

### G1 — Schema and configuration

- Add a migration after the current migration head (`037`) for problem bundles, publication/session/attempt digests, result envelope/raw JSON, engine provenance, wall/CPU/memory fields, and failure kind.
- Add `CXXPROBE_ENABLED`, binary path, expected version/commit/hash, bundle bucket/prefix, execution deadline, stdout/stderr limits, and worker isolation mode to `internal/config/config.go`.
- Validate production configuration at startup. A version/hash mismatch makes the worker unhealthy; it must not silently fall back to the Go runner or DMOJ.

### G2 — Problem import/publication

- Add a cxxprobe-specific package, for example `internal/judge/cxxprobe`, for manifests, validation, JSON protocol types, and golden fixtures.
- Extend organizer coding-problem routes under `internal/handler/org/` to import, validate, publish, and select an immutable cxxprobe bundle.
- Keep existing Go UUIDs for API relationships but derive judge semantics only from the selected bundle.
- Prevent active contest/session mutation and reject unsupported language/question combinations before scheduling.

### G3 — Worker adapter

- Route attempts by the snapshotted `judge_engine` in `internal/worker/runner.go`, delegating cxxprobe execution to the new adapter instead of adding more logic to the existing large runner.
- Reuse the existing durable Pub/Sub attempt and transaction/idempotency behavior.
- Store raw and projected results atomically. The legacy Go/nsjail and DMOJ paths must not be reachable for a scored `judge_engine=cxxprobe` attempt.
- Add the pinned cxxprobe build to the worker Dockerfile/build pipeline and emit a machine-readable startup provenance log/metric.

### G4 — Public and organizer APIs

- Candidate question responses include `judge_engine`, `problem_bundle_sha256`, contract version, language=`cpp`, public limits, and starter content.
- Attempt responses add structured `judge` data while retaining current fields during migration.
- Organizer/prejudge responses expose full safe diagnostics and provenance; candidate responses redact private test inputs/answers, hidden symbolic patterns, checker source, filesystem paths, and internal diagnostics.
- API and worker reject a submitted digest that differs from the session snapshot. The server remains authoritative even if an old client omits the digest.

## cxxprobe implementation work packages

### C1 — Versioned machine contracts

- Add `report_schema_version` to canonical JSON without breaking current consumers.
- Add deterministic bundle validate/manifest output and fixtures for normalization, unsafe archives, unknown schema, and content digest stability.
- Emit resolved compiler, standard/flags, limits, and engine version in a machine-readable validation/result provenance block.
- Specify maximum diagnostics/report sizes and which fields are safe for candidate display.

### C2 — Integration fixtures

Maintain small committed problems covering:

- successful manual + symbolic + behavior checks;
- `CE`, `WA`, `TLE`, `MLE`, `OLE`, and `RE`;
- symbolic and behavior-only failure;
- invalid checker/problem config;
- Unicode paths, spaces, case collisions, large output, process trees, and cleanup.

The cxxprobe CLI fixture output and Go public API projection must be tested together in CI.

### C3 — Future HTTP sidecar gate

`cxxprobe serve` may replace per-job process launch only after all of these exist and pass fault injection:

- trusted-service authentication or strictly enforced loopback Unix-domain transport;
- caller-supplied idempotency key/attempt ID with conflict semantics;
- durable queue recovery after crash, including queued source recovery;
- engine, bundle, source, and schema provenance in repository/API records;
- clean problem-revision reload or immutable one-revision-per-process deployment;
- bounded request/source/report sizes, non-permissive production CORS, TLS/proxy boundary, and graceful drain deadline;
- distributed behavior compatible with Go retries and one terminal score.

Until then, the service's UI is an authoring/debug tool. The documented in-memory queue, SQLite, and local event bus remain single-machine components, even though interfaces for future replacements exist (`cxxprobe/docs/content/architecture/http-service.mdx:54-76`).

## Outer execution security

cxxprobe needs cgroup v2 delegation and Linux user/mount namespaces (`cxxprobe/README.md:72-78`). The deployment must therefore be proven, not assumed, on the chosen container/microVM runtime.

Required model:

1. A trusted broker with the minimum object-store permission fetches the immutable bundle and source, verifies hashes, then places only those bytes into an attempt staging area.
2. The execution cell has no service-account token, cloud metadata route, secret volume, Docker/container socket, writable host path, or outbound network. DNS is also unavailable.
3. Root filesystem is read-only; writable locations are size-bounded tmpfs or attempt-specific scratch. Problem inputs/checkers are read-only. The submission must not be able to enumerate other private problems.
4. Drop capabilities, apply a reviewed seccomp/LSM policy, isolate PID/network/mount/IPC/user namespaces, set cgroup CPU/memory/PID/I/O quotas outside cxxprobe, and avoid a privileged container.
5. Limit compiler and report output, total job wall time, disk/inodes, open files, and process count. Kill the whole outer cell on deadline.
6. Destroy the cell and scratch after the bounded result is copied out. Never reuse a writable cell across candidates.

Run an architecture spike on the real deployment platform to determine which outer boundary supports cxxprobe's nested namespace/cgroup requirements. Compare a dedicated ephemeral VM or microVM with the approved container runtime; do not select gVisor/Kata/Firecracker solely on paper. The gate is a passing adversarial suite and operational recovery, not the product name.

Adversarial tests must attempt metadata/cloud credentials, DNS/Internet, localhost/host services, filesystem traversal, `/proc`/host PID access, fork bombs, large files/output, signals, compiler abuse, lingering processes, and cross-attempt residue.

## Windows, Linux, and macOS plan

### Shared candidate contract

All three desktop clients use the same Go endpoints and payload types. They show the same statement/starter revision and bundle digest, accept only advertised languages, and render the same verdict/check/timing structure. Shared TypeScript fixtures must deserialize the exact Go response on every OS. No candidate OS receives a compiler, private tests, checker, reference solution, or cxxprobe binary.

| Area                   | Windows                                                                                     | Linux                                                                                  | macOS                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Candidate judging      | Remote Go API only; no WSL requirement.                                                     | Remote Go API only; do not run cxxprobe on the candidate host even though Linux could. | Remote Go API only; no local Linux VM requirement.                              |
| Author problem testing | WSL2 or a supported Linux VM/container; never define canonical results from native Windows. | Native supported route with cgroup v2/user namespaces.                                 | Supported Linux VM/container; never define canonical results from native macOS. |
| Desktop release        | Signed MSI/NSIS, WebView2 and firewall/CSP API reachability, clean Win10/11 E2E.            | AppImage/deb/rpm as supported, X11/Wayland and privileged-helper/network-lockdown E2E. | Signed/notarized DMG, ATS/TLS and camera/screen permission E2E.                 |
| Judge UI               | Display public verdict, check category, CPU/wall/memory labels; redact private details.     | Identical.                                                                             | Identical.                                                                      |
| Compatibility gate     | Preflight rejects an API/contract version mismatch before lockdown.                         | Same.                                                                                  | Same.                                                                           |

Platform-specific lockdown code must allow the Go API and object endpoints the API actually uses; it must never allow a direct cxxprobe host. The Windows firewall/CSP work remains a separate P0 because a correct server judge is useless if the desktop blocks save/submit or permits unintended egress.

### Organizer/developer workflow

- Linux CI is the canonical bundle validation and evaluation environment.
- Windows developers use WSL2; macOS developers use the project-provided Linux VM/container workflow. Local results are advisory until the identical pinned CI image validates the digest.
- Publish one supported toolchain image and command; do not let each OS's native compiler define expected output or timing.

## Rollout sequence

Each phase is separately reviewable and must meet its exit gate before the next production-enabling phase.

### Phase 0 — freeze the contract

- Approve C++-only scope, public verdict mapping, CPU/wall semantics, problem storage, and outer-isolation target.
- Pin cxxprobe v0.8.1/`3fe00c4` for the integration baseline. A later upgrade is a deliberate compatibility change.
- Exit: written decisions, golden fixture list, and no unresolved authority between Go fields and cxxprobe fields.

### Phase 1 — cxxprobe contract additions

- Implement schema version/provenance and deterministic bundle validation in cxxprobe.
- Produce immutable golden bundles and reports.
- Exit: repeated builds/exports produce the same bundle digest; old/new parser compatibility tests pass.

### Phase 2 — Go import and persistence

- Add migrations, configuration, quarantine validation, content-addressed storage, publication snapshot, and APIs.
- Status: Phase 2a/2b import and immutable bundle binding are implemented;
  Phase 2c freezes judge identity at session and attempt boundaries; and the
  Phase 2d work independently rehashes the public allowlist, persists
  immutable statement/starter/asset bytes, freezes projection identity and
  display metadata per session, and exposes strict authenticated question and
  asset APIs. Phase 2e switches ams-access to those session-bound APIs, verifies
  the exact projection and every raster asset before rendering, and locks the
  cxxprobe editor to C++23. Phase 2f executes the complete migration chain and
  its failure/concurrency paths on disposable PostgreSQL 16.14, and closes the
  database races and incomplete-projection states found by that qualification.
  Qualification on the exact deployed PostgreSQL major, staging object storage,
  and Windows/Linux/macOS desktop validation remain before this phase can close
  operationally.
- Exit: a post-publication edit produces a new digest and cannot affect an existing session or attempt.

### Phase 3 — Go worker adapter

- Build the pinned CLI into the worker, execute it per job, map/store the report, and add provenance/metrics.
- Exit: direct CLI and public API golden results match; duplicate delivery and worker death still create one terminal score.

### Phase 4 — isolation qualification

- Select and implement the outer execution cell; run breakout, residue, resource, and load tests.
- Exit: no credentials, metadata, egress, hidden assets, host processes, or prior-attempt files are reachable; cleanup and quarantine behavior pass.

### Phase 5 — shadow and pilot

- Feature-flag cxxprobe for new C++ contests only.
- Run non-scoring shadow comparisons against the current judge using representative accepted/wrong/timeout/crash submissions. Differences are classified, never automatically averaged or hidden.
- Run organizer prejudge and an internal staging contest on the exact release manifest.
- Exit: expected differences are documented; no unexplained verdict or digest mismatch; capacity and runtime variance pass.

### Phase 6 — cross-platform client release

- Add the structured API/UI contract, preflight compatibility, redaction, and metrics labels in `ams-access`.
- Execute Windows, Linux, and macOS desktop smoke/fault tests against the same staging contest.
- Exit: all three clients submit byte-identical source/digest contracts and show equivalent results; exact signed/notarized artifacts are recorded.

### Phase 7 — controlled cutover

- New eligible contests snapshot `judge_engine=cxxprobe`; legacy contests stay pinned to their original engine.
- Never switch engine version, image digest, compiler, or bundle digest during an active contest. Rollback means stopping new starts and preserving/replaying attempts on their originally pinned environment—not silently using another judge.
- Exit: release manifest, dashboards, runbook, rollback drill, and on-call alerts are complete.

## Test matrix

| Layer                  | Required tests                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cxxprobe unit/contract | Problem schema, canonical manifest/digest, JSON schema version, every verdict/check type, diagnostics bounds, CLI exit-code/report combinations.                        |
| Go unit                | Strict JSON decoder, verdict/failure mapping, timing/memory projection, redaction, unknown version/status, slug/digest mismatch.                                        |
| Go integration         | Upload→validate→publish→session snapshot→submit→Pub/Sub→CLI→transaction→candidate response.                                                                             |
| Delivery faults        | Duplicate message, process crash during compile/case/report/DB commit, timeout, nack/redelivery, reaper race, stale worker version.                                     |
| Security               | Traversal/symlink/archive bombs, metadata/credential/network access, cross-problem/cross-attempt reads, fork/output/disk bombs, lingering processes.                    |
| Fairness/capacity      | Repeated calibrated runs, cold/warm compiler cache, idle/contention, each worker class, burst queue, max-size source/bundle/report.                                     |
| Client contract        | Shared TypeScript fixtures plus Windows/Linux/macOS save, submit, polling/resume, result rendering, incompatibility preflight, offline/reconnect.                       |
| Release                | Worker image and cxxprobe binary hash verification; exact problem digest; Windows signing, macOS signing/notarization, Linux package smoke; end-to-end staging contest. |

## Observability and operations

Every attempt log/metric should include attempt ID, contest ID, engine/version/commit, worker image digest, bundle digest, source digest, queue latency, judge duration, public verdict, failure kind, cleanup outcome, and retry count. Do not log source, secret tests, expected answers, full diagnostics, or candidate tokens by default.

Required alerts:

- engine/binary hash mismatch or unsupported report schema;
- bundle/source digest mismatch;
- rising `IE`, checker/config error, or worker timeout rate;
- queue age/capacity and stuck attempts;
- outer-cell cleanup/quarantine failure;
- runtime/memory distribution shift by worker image/hardware class;
- direct CLI versus API golden canary mismatch.

The release manifest binds:

- `ams-access` commit and per-OS artifact hashes/signatures;
- Go API and worker commits/image digests plus migration level;
- cxxprobe tag, commit, binary SHA-256, result/bundle schema versions;
- compiler/toolchain and base-image digests;
- every contest problem-bundle digest;
- supported OS/architecture/language/API matrix.

## Definition of done

cxxprobe integration is production-ready only when all statements below are true:

1. A candidate-visible digest equals the session, attempt, fetched, and executed bundle digest.
2. The Go worker uses the pinned cxxprobe artifact and cannot fall back to another engine for that attempt.
3. Direct CLI and end-to-end API results match for all golden manual/symbolic/behavior fixtures.
4. Raw cxxprobe report and complete engine/problem/source provenance are durable and queryable.
5. Duplicate delivery, crash, retry, and reaper races yield one immutable terminal attempt and score.
6. The hostile-code suite cannot reach credentials, metadata, network, host paths/processes, hidden unrelated assets, or prior attempts.
7. Timing is stored without synthetic manipulation; runtime ranking is disabled unless its calibration gate passes.
8. Windows, Linux, and macOS candidates use the same versioned remote API and pass release-candidate E2E tests without installing cxxprobe.
9. Active contests cannot change bundle, engine, compiler, or worker image identity.
10. The exact cross-repository release manifest has passed a staging contest and rollback drill.

## Decisions still required before implementation

1. Is the first cxxprobe-backed product deliberately limited to executable C++ questions, and which Go-only question types remain separate?
2. Which object store/prefix and retention policy own immutable production bundles?
3. Are hidden symbolic patterns and GTest failure messages organizer-only or selectively candidate-visible?
4. Which outer execution technology passes cxxprobe's namespace/cgroup needs on the real worker platform without privileged containers?
5. Is runtime informational only, or does any contest rank/score by it? The latter requires a substantially stronger calibration policy.
6. Will bundle validation/manifest generation be added to cxxprobe before the Go importer, as recommended, or temporarily live in Go with a planned hand-back?
7. What exact compatibility window will the Go parser support when cxxprobe advances beyond result schema version 1?

The first implementation command should begin only after Phase 0 decisions are recorded. The smallest safe first code slice is C1's versioned result/bundle contract plus golden fixtures, followed by G1/G2; changing candidate UI or routing scored attempts before those identities exist would create another ambiguous judge path.

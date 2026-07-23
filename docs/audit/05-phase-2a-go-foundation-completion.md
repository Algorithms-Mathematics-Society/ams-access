# Phase 2a Go foundation completion record

Completion date: 2026-07-24
Go baseline: clean `main` at `950d09b`, matching `origin/main`, before this
work
cxxprobe baseline: the uncommitted Phase 0/1 working tree derived from v0.8.1
at `3fe00c404cd3565dc3d18e3f51ffbebde54aba30`
Repository state: all implementation remains local and uncommitted; no push was
performed

## Completion statement

The Phase 2a protocol and persistence foundation is complete. Go can strictly
parse the corrected cxxprobe problem-bundle manifest and invoke the validator
through a bounded, shell-free process boundary. Migration 038 defines durable
import state, immutable validated bundle records, exact engine/archive/storage
identity, and DRAFT-only question binding. Configuration is inert by default
and fails closed when explicitly enabled with incomplete or malformed pins.

This is intentionally not all of Phase 2. No upload/import API, archive
extractor, GCS publication operation, live database migration, public problem
projection, session snapshot, attempt snapshot, or cxxprobe judge routing was
enabled.

## Subagent-driven workstreams

1. **Go storage/schema audit:** mapped current CP tables, migrations, GCS
   behavior, question/session/attempt mutability, and API timeout constraints.
2. **Go protocol adapter:** implemented strict schema-v1 parsing, typed process
   errors, bounded execution, fake-process tests, and the real cxxprobe golden
   fixture.
3. **Persistence/config foundation:** implemented migration 038, DB-level
   immutability and DRAFT guards, disabled-by-default pinned configuration, and
   startup validation.
4. **cxxprobe prerequisite repair:** added digest-covered resolved execution
   data and hard-link rejection before Go froze its parser.

The primary integration pass reviewed the combined changes, added a real
cxxprobe-to-Go integration test, and ran complete C++ and Go validation.

## cxxprobe contract correction

The Phase 2 audit caught two Phase 1 acceptance gaps before persistent Go data
depended on them:

- `problems[].execution.compiler` and `problems[].execution.limits` were added
  to the canonical bundle manifest and therefore to `bundle_sha256`.
- Multiply linked regular files are rejected using `fstat()` link-count checks
  both before and after hashing, including when the second link is outside the
  bundle tree.

The corrected schema-v1 golden digest is:

```text
5c2115f6bdbcc10b460946c3009f32df0f0fd35ed840eaa4560ec8fb62cd3ce9
```

Schema v1 remains uncommitted and unpublished, so correcting it in place does
not require a compatibility migration. If any external schema-v1 manifest is
published before these changes are committed, the contract must instead be
bumped before release.

## Strict Go protocol boundary

The new `internal/judge/cxxprobe` package owns only the cxxprobe machine
boundary. It does not reproduce cxxprobe's canonical JSON hashing algorithm.
The pinned C++ validator remains authoritative.

The parser enforces:

- exact contract `cxxprobe.problem-bundle`, schema version 1, `valid=true`, and
  SHA-256 algorithm;
- lowercase 64-character bundle and file digests;
- exactly one problem with the expected slug;
- all required resolved compiler and positive limit fields;
- count and overflow-safe total-byte consistency;
- strictly bytewise sorted, unique, normalized relative UTF-8 paths;
- control-character, traversal, backslash, ASCII case-collision,
  Windows-reserved-name/punctuation, and trailing-dot/space rejection; and
- exactly one JSON object, while allowing additive fields within schema v1.

The process adapter invokes this argument vector directly:

```text
cxxprobe bundle validate <materialized-directory> --json
```

No shell command is constructed. Stdout, stderr, and runtime are bounded.
Exit 0 must carry a coherent successful manifest; exit 2 must carry the
versioned `valid=false` rejection envelope. Other exits, malformed/truncated or
multiple JSON objects, timeouts, cancellation, startup failures, and output
overflow are separately typed failures.

Primary files:

- `ams-golang/internal/judge/cxxprobe/manifest.go`
- `ams-golang/internal/judge/cxxprobe/validator.go`
- `ams-golang/internal/judge/cxxprobe/manifest_test.go`
- `ams-golang/internal/judge/cxxprobe/validator_test.go`
- `ams-golang/internal/judge/cxxprobe/validator_integration_test.go`
- `ams-golang/internal/judge/cxxprobe/testdata/bundle_manifest_v1.golden.json`

## Persistence foundation

`038_cxxprobe_problem_bundles.sql` adds:

- `problem_bundle_imports`, with durable `PENDING`, `VALIDATING`, `VALIDATED`,
  `REJECTED`, and `FAILED` states;
- insert-only `problem_bundles` records protected against update, delete, and
  truncate;
- composite organization/contest/question foreign keys;
- lowercase digest, manifest contract/schema, object path, status, timestamp,
  and provenance checks;
- both JSONB and the exact validated manifest text, cross-checked for semantic
  equality;
- archive digest/size and storage bucket/object/generation identity;
- validation engine name/version/commit/dirty/binary digest identity; and
- legacy-default `contest_questions` cxxprobe binding fields.

Database triggers reject binding, rebinding, or unbinding a cxxprobe bundle
after the owning contest leaves `DRAFT`. Existing questions remain
`judge_engine='legacy'`; the migration alone does not route any attempt to
cxxprobe.

Primary files:

- `ams-golang/internal/db/migrations/038_cxxprobe_problem_bundles.sql`
- `ams-golang/internal/db/migration_038_test.go`

## Fail-closed configuration

`CXXPROBE_ENABLED` defaults to false. When enabled, Go requires:

- a normalized absolute cxxprobe binary path;
- exact semantic version, 40-character lowercase commit, and 64-character
  lowercase binary SHA-256 pins;
- a valid secret bundle bucket and normalized content-addressed prefix; and
- positive bounded validator timeout/stdout/stderr settings.

Malformed numeric settings and misspelled enablement values such as `tru` fail
closed. The worker performs cxxprobe-specific validation at startup without
requiring API-only candidate authentication secrets.

Primary files:

- `ams-golang/internal/config/config.go`
- `ams-golang/internal/config/validate.go`
- `ams-golang/internal/config/config_cxxprobe_test.go`
- `ams-golang/cmd/worker/main.go`

## Validation evidence

| Check | Result |
|---|---|
| cxxprobe full build | Passed |
| cxxprobe CTest | 193 registered, 159 passed, 34 environment skips, 0 failures |
| Corrected cxxprobe bundle/CLI focus | 18/18 passed |
| Independent corrected manifest SHA-256 recomputation | Matched |
| Go full test suite | `go test ./...` passed |
| Go static analysis | `go vet ./...` passed |
| Go full build | `go build ./...` passed |
| Focused Go protocol/config/schema tests | Passed |
| Real cxxprobe CLI to Go golden-manifest integration | Passed |
| Go formatting and both repository whitespace checks | Passed |

The real boundary test materialized the same four-file golden bundle, invoked
the newly built cxxprobe CLI, parsed it through Go, and deep-compared the
result with the committed Go golden manifest.

The 34 cxxprobe skips still require cgroup/user-namespace facilities not
delegated to this development container. They must run on the intended Linux
judge worker. Go caches and compiler temporary files were redirected to
`/dev/shm` because the persistent filesystem was full.

No live PostgreSQL service or image is available on this host, so migration
038 was embedded and contract-tested but not applied to a real database. A
clean PostgreSQL migration run, second-pass idempotency check, constraint/FK
exercise, concurrency test, and rollback test remain required in CI/staging.

## Remaining Phase 2 work

1. Freeze one archive transport and its compressed/upload limits.
2. Add quarantine object creation and a durable asynchronous import worker;
   do not perform a potentially 512 MiB validation inside the API's 25-second
   request deadline.
3. Safely extract into a fresh private directory while independently bounding
   entries, expanded bytes, paths, links, devices, depth, and case collisions.
4. Verify archive bytes, the pinned cxxprobe binary SHA-256, engine identity,
   and validator output before publication.
5. Publish the secret bundle with a create-only GCS generation precondition at
   the digest-derived object key, then transactionally record and bind it only
   to the matching DRAFT question.
6. Add session-question and attempt bundle snapshots so later DRAFT edits can
   never affect an existing session or attempt.
7. Define an explicit public-file projection/starter designation. The current
   manifest has no public allowlist, so Go must not guess public files or expose
   everything except known secrets.
8. Run migration 038 and its transactional/concurrency tests on clean
   PostgreSQL before enabling the feature flag.

The next implementation slice is Phase 2b: quarantine plus safe asynchronous
validation and create-only content-addressed storage. Public projection and
scored attempt routing remain blocked until their separate contracts and
snapshots are implemented.

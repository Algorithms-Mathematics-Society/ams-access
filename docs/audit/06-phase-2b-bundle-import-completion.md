# Phase 2b cxxprobe bundle import completion record

Completion date: 2026-07-24
Go baseline: clean `main` at
`777e6f70413451a1480393db237c5aa6ab3ffa8a`, matching `origin/main`, before
this work
cxxprobe baseline: clean `main` at
`1d70631e49c123b7280f55131a09a11632118e09`, matching `origin/main`, before
this work
ams-access baseline: local `main` at
`3769026c0d6832f5816f32a3ac9d0b87a86f2631`
Repository state: Phase 2b implementation and this record remain local and
uncommitted at the time of writing; no commit, push, deployment, or live
service mutation was performed by the Phase 2b implementation lanes

## Completion statement

The Phase 2b organizer bundle-intake and asynchronous import slice is complete
in code.

When the disabled-by-default cxxprobe feature is explicitly enabled with all
required pins and storage settings, an organization-scoped API can issue a
short-lived create-only upload ticket, bind the uploaded GCS generation to one
durable import job, and expose a sanitized status projection. A separate
database-polling worker can safely materialize the uploaded tar.gz, verify the
pinned cxxprobe executable, invoke the authoritative bundle validator,
construct a deterministic canonical archive, publish it under the manifest
digest with a create-only precondition, and transactionally bind the immutable
bundle to the matching DRAFT question.

This is not a production-release claim and it does not complete all of Phase
2. No ams-access upload UI, public problem projection, session-question
snapshot, attempt bundle snapshot, scored-attempt routing, cxxprobe judging
adapter, worker deployment, live PostgreSQL exercise, or live GCS/browser
exercise was implemented or validated in this slice.

## Subagent-driven workstreams

1. **Archive and importer safety:** froze the tar.gz transport, implemented
   bounded private extraction, deterministic canonical repacking, pinned engine
   verification, and create-only canonical publication.
2. **Immutable storage boundary:** added signed create-only quarantine intake,
   generation-pinned reads and deletes, SHA-256/CRC32C verification, and exact
   adoption of a pre-existing canonical object.
3. **Durable job state:** added migration 039 and a lease/CAS repository for
   claim, renewal, retry, rejection, failure, scoped status, and transactional
   finalization.
4. **Organizer API:** added three narrowly scoped routes for ticket creation,
   upload completion, and import status.
5. **Dedicated import worker:** composed the repository, storage, importer,
   validator, and identity verifier into a crash-recoverable standalone
   process.
6. **cxxprobe identity prerequisite:** added a versioned machine-readable
   engine identity command and build-time provenance checks to cxxprobe.

The primary integration pass reviewed the combined files, hardened tar
termination and implicit-node limits, tightened the API body limit, and ran
the combined Go validation suite.

## Frozen archive transport and safety contract

Phase 2b accepts one archive transport:

```text
media type: application/gzip
format:     one gzip member containing one POSIX USTAR/PAX tar archive
extension:  .tar.gz
```

The schema-v1 default bounds are:

| Resource | Limit |
|---|---:|
| Compressed archive | 544 MiB (`570425344` bytes) |
| Decompressed tar stream | 544 MiB |
| Physical tar headers | 8,192 |
| Explicit and implicit filesystem nodes | 8,192 |
| Regular files | 4,096 |
| One regular file | 64 MiB |
| Total regular-file bytes | 512 MiB |
| Relative path | 512 bytes |
| One path component | 255 bytes |
| Path depth | 32 components |

The decompressed allowance includes 32 MiB beyond the regular-file total for
tar headers, PAX paths, padding, and structural overhead. The independent node
bound prevents a small file count with many unique parent components from
amplifying into an unbounded directory tree.

Materialization requires a normalized absolute, real, private, empty
directory. The importer creates a fresh `0700` workspace and extraction root,
creates regular files exclusively as `0600`, and removes the complete
workspace on success, cancellation, or error.

The reader rejects:

- zero, one, or more than two tar terminator blocks; exactly two zero blocks
  are required;
- a second gzip member, trailing compressed payload, or trailing tar data;
- malformed or truncated gzip/tar streams and non-POSIX tar number encoding;
- GNU, sparse, link, device, FIFO, socket, extended-attribute, and unsupported
  PAX entries;
- absolute, volume-qualified, backslash, dot, parent, empty-component,
  invalid-UTF-8, control-character, Windows-reserved, and trailing-dot/space
  paths;
- duplicate entries, file/directory prefix conflicts, and ASCII
  case-collisions; and
- any configured compressed, decompressed, header, node, file, byte, path, or
  depth limit violation.

On a materialization failure, partial output is cleared before the error is
returned. Go does not provide a portable `O_NOFOLLOW` equivalent on every
target, so the implementation also relies on its freshly created private root,
link-entry rejection, exclusive creation, `Lstat` checks, file identity
checks, and content digest verification. The import worker remains a trusted
server-side Linux component; this extractor is not intended to process
archives in a candidate-controlled local directory.

After cxxprobe validates the materialized tree, Go writes a deterministic
canonical tar.gz containing exactly the manifest-listed files:

- files are bytewise sorted;
- paths, sizes, and SHA-256 values are revalidated while reading;
- file mode is fixed to `0600`;
- uid/gid, owner names, and timestamps are fixed;
- gzip metadata and compression level are fixed; and
- the emitted bytes are independently counted and hashed with SHA-256 and
  CRC32C.

The cxxprobe `bundle_sha256` remains the semantic problem identity. The
canonical archive SHA-256 is a separate transport-byte identity.

Primary files:

- `ams-golang/internal/judge/cxxprobe/archive.go`
- `ams-golang/internal/judge/cxxprobe/archive_test.go`
- `ams-golang/internal/judge/cxxprobe/importer.go`
- `ams-golang/internal/judge/cxxprobe/importer_test.go`

## Engine identity contract

cxxprobe now exposes:

```text
cxxprobe identity --json
```

The successful output is exactly one versioned JSON object followed by a
newline:

```json
{
  "contract": "cxxprobe.engine-identity",
  "schema_version": 1,
  "name": "cxxprobe",
  "version": "0.9.0",
  "commit": "<40-character-lowercase-git-commit>",
  "dirty": false
}
```

The values are embedded at build time. A build with `commit="unknown"` must be
marked dirty, and production Go rejects every dirty or unpinned identity.
Existing `cxxprobe --version` output remains unchanged.

Go requires exact version, commit, and independently calculated binary
SHA-256 pins. Each verification hashes one bounded regular executable before
and after invoking `identity --json` directly without a shell. The importer
performs this verification before and after bundle validation and rejects a
provenance change.

These checks detect ordinary replacement and in-place mutation. There remains
a narrow portable `os/exec` path-replacement race, so production must mount
the released cxxprobe binary from a trusted read-only filesystem and pin the
artifact hash independently.

Primary cxxprobe files:

- `cxxprobe/cli/commands/identity_cmd.cpp`
- `cxxprobe/cli/commands/identity_cmd.hpp`
- `cxxprobe/cli/main.cpp`
- `cxxprobe/CMakeLists.txt`
- `cxxprobe/cli/CMakeLists.txt`
- `cxxprobe/tests/integration/identity_cli_test.cpp`
- `cxxprobe/docs/content/architecture/ams-integration-contract.mdx`
- `cxxprobe/docs/content/cli-reference.mdx`

Primary Go files:

- `ams-golang/internal/judge/cxxprobe/identity.go`
- `ams-golang/internal/judge/cxxprobe/identity_test.go`
- `ams-golang/internal/judge/cxxprobe/validator.go`
- `ams-golang/internal/judge/cxxprobe/validator_test.go`

## Immutable GCS boundary

The quarantine bucket and final bundle bucket are required to be distinct.
All object operations use normalized relative names, positive generations,
bounded sizes, and the frozen `application/gzip` media type.

The API signs a V4 PUT for a random quarantine key:

```text
<CXXPROBE_QUARANTINE_PREFIX>/<upload-uuid>/archive.tar.gz
```

The signature binds the exact:

- `Content-Type: application/gzip`;
- `Content-Length`;
- `X-Goog-If-Generation-Match: 0`;
- `X-Goog-Meta-Ams-Archive-Format: tar.gz`; and
- `X-Goog-Meta-Ams-Archive-Size`.

The completion endpoint inspects the resulting size, type, metadata, and
positive generation, but deliberately does not trust those attributes as a
SHA-256 attestation. The asynchronous worker reads that exact generation with
transparent decompression disabled and verifies size, SHA-256, and CRC32C
before extraction.

Canonical publication uses GCS `DoesNotExist`, streams through independent
size/SHA-256/CRC32C checks, and records only the committed generation returned
by GCS. Its key is:

```text
<CXXPROBE_BUNDLE_PREFIX>/<manifest-bundle-sha256>.tar.gz
```

If a concurrent create wins, the importer does not overwrite it. It resolves
the existing object and adopts it only after an exact generation-pinned
byte-identity verification. Quarantine cleanup likewise deletes only the
claimed generation, so it cannot remove a replacement object with the same
name.

Primary files:

- `ams-golang/internal/storage/gcs.go`
- `ams-golang/internal/storage/gcs_immutable_test.go`

## Durable upload and import state

Migration 039 extends the Phase 2a persistence foundation with
`problem_bundle_uploads` and lease/retry fields on
`problem_bundle_imports`.

Upload tickets have only these durable states:

```text
ISSUED -> CONSUMED
ISSUED -> EXPIRED
```

Each ticket binds organization, contest, question, expected problem slug,
expected archive SHA-256 and size, content type, quarantine bucket/object,
requester, and an expiry of no more than one hour. Consumption additionally
binds the exact positive GCS generation and one import ID.

The upload and import rows use deferred circular foreign keys over their full
scope and byte identity. A transaction cannot commit a consumed ticket and
import that disagree on UUID, scope, slug, hash, size, content type, object,
or generation. Parent contest/question deletion can remove the pair together,
while one-sided orphaning is rejected.

Import jobs retain the Phase 2a terminal states and add crash-recoverable
execution data:

```text
PENDING -> VALIDATING -> VALIDATED
                      -> REJECTED
                      -> FAILED
VALIDATING --expired lease--> VALIDATING by a new claimant
VALIDATING --transient--> PENDING
```

Claims atomically select one due PENDING job or one stale VALIDATING job using
`FOR UPDATE SKIP LOCKED`. Every worker mutation is guarded by the import ID,
lease token, attempt number, state, and unexpired lease. A stale worker cannot
finalize, requeue, reject, or fail work after losing its lease.

Retries use deterministic exponential backoff from five seconds to five
minutes. The default retry budget is five attempts and the configured range is
one through twenty. Exhausted jobs become FAILED. Stored organizer-facing
error codes and messages are bounded and sanitized.

Finalization is one PostgreSQL transaction that:

1. locks the owning contest and question;
2. proves the contest is still DRAFT and the worker still owns the lease;
3. stores the exact successful manifest text plus semantic JSONB, typed
   contract/schema/digest/slug fields, archive identity, and engine provenance;
4. inserts an immutable question-scoped bundle, or reuses an existing
   `(question_id, bundle_sha256)` row only after exact semantic and storage
   identity comparison; and
5. binds the question to `judge_engine='cxxprobe'`, bundle ID, digest, and
   problem slug.

The prior global uniqueness of one storage generation per `problem_bundles`
row is removed because the same content-addressed canonical object may back
multiple question-scoped immutable records.

Primary files:

- `ams-golang/internal/db/migrations/039_cxxprobe_bundle_import_jobs.sql`
- `ams-golang/internal/db/migration_039_test.go`
- `ams-golang/internal/judge/cxxprobe/import_repository.go`
- `ams-golang/internal/judge/cxxprobe/import_repository_test.go`

## Organizer API contract

The organization-authenticated routes are:

```text
POST /org/contests/{id}/questions/{qid}/bundle-uploads
POST /org/contests/{id}/questions/{qid}/bundle-uploads/{uploadID}/complete
GET  /org/contests/{id}/questions/{qid}/bundle-imports/{importID}
```

All three fail closed when cxxprobe is disabled or required dependencies are
unavailable. Every lookup is scoped by organization, contest, and question.
Upload issue and consumption require the contest to remain DRAFT and recheck
that condition under row locks.

The first POST accepts exactly one JSON object:

```json
{
  "expected_problem_slug": "two-sum",
  "expected_archive_sha256": "<64-lowercase-hex>",
  "expected_archive_size": 12345
}
```

The complete HTTP request body, including trailing whitespace, is limited to
4,096 bytes. Unknown fields, multiple JSON values, invalid UTF-8/control
characters, an untrimmed or over-255-byte slug, a non-lowercase SHA-256, and
an out-of-range size are rejected. A successful response contains only the
upload ID, signed URL, required signed headers, expected size, and expiry.

The completion POST is idempotent. A new successful consumption returns
`202` with `status="PENDING"`; a previously consumed ticket returns `200` with
the same import ID and `status="EXISTING"`. `EXISTING` is an API idempotency
marker, not a durable import state. Missing, expired, mismatched, or
concurrently changed uploads fail without creating a second import.

The status GET returns only organizer-safe state, attempts, retry schedule,
sanitized terminal error, semantic bundle digest/slug, bound bundle ID, and
timestamps. It excludes quarantine identity, storage paths, raw manifests,
private file lists, engine filesystem paths, and internal diagnostics.

Primary files:

- `ams-golang/cmd/api/main.go`
- `ams-golang/internal/handler/org/bundle_imports.go`
- `ams-golang/internal/handler/org/bundle_imports_test.go`

## Dedicated import worker flow

Phase 2b adds the standalone process:

```text
ams-golang/cmd/bundle-import-worker
```

It is intentionally separate from the existing scored-attempt worker. On
startup it:

1. validates the fail-closed cxxprobe configuration;
2. initializes PostgreSQL and GCS;
3. creates a bounded `hostname/process-uuid` worker identity;
4. constructs the pinned validator, importer, repository, and storage
   boundaries; and
5. verifies the cxxprobe executable before the first database poll.

The runner processes at most one claim at a time. It renews the lease
periodically at one third of the configured duration, cancels import work on
lease loss, stops and joins the periodic renewer, and synchronously refreshes
the lease before any final database transition. Graceful cancellation leaves
the VALIDATING lease to expire and be reclaimed; it does not publish a false
terminal state.

Per claim, the worker:

1. resolves and compares the exact quarantine object generation;
2. invokes the generation-pinned importer;
3. classifies coherent archive/problem invalidity as REJECTED;
4. classifies storage integrity, engine identity/protocol/configuration, and
   internal consistency faults as fail-closed FAILED outcomes;
5. requeues selected process, timeout, storage, network, and destination I/O
   failures as transient, subject to the attempt budget;
6. finalizes a successful manifest, canonical object, and question binding
   under lease CAS; and
7. only after a committed terminal database state, best-effort deletes the
   exact quarantine generation with a separate bounded cleanup context.

Organizer-facing errors are generic and bounded; detailed process paths or
private engine diagnostics are not copied into the status response. Cleanup
failure is logged and leaves the named generation for operational
reconciliation rather than undoing an already committed terminal state.

Primary files:

- `ams-golang/cmd/bundle-import-worker/main.go`
- `ams-golang/internal/judge/cxxprobe/import_worker.go`
- `ams-golang/internal/judge/cxxprobe/import_worker_test.go`

## Fail-closed configuration

`CXXPROBE_ENABLED` still defaults to false. When enabled, the existing Phase
2a binary/version/commit/hash, final bucket/prefix, and validator bounds are
required, plus:

| Setting | Default and enforced range |
|---|---|
| `CXXPROBE_QUARANTINE_BUCKET` | required; must differ from final bucket |
| `CXXPROBE_QUARANTINE_PREFIX` | `cxxprobe/quarantine/v1`; normalized relative prefix |
| `CXXPROBE_ARCHIVE_MAX_BYTES` | 544 MiB; positive and no larger than 544 MiB |
| `CXXPROBE_UPLOAD_URL_TTL_SECONDS` | 600; 60 through 900 |
| `CXXPROBE_IMPORT_LEASE_SECONDS` | 600; validator timeout + 60 through 3,600 |
| `CXXPROBE_IMPORT_POLL_SECONDS` | 5; 1 through 60 |
| `CXXPROBE_IMPORT_MAX_ATTEMPTS` | 5; 1 through 20 |

Malformed numbers, unsafe prefixes, an identical quarantine/final bucket, and
an import lease too short for the configured validator timeout all fail
startup validation.

Primary files:

- `ams-golang/internal/config/config.go`
- `ams-golang/internal/config/validate.go`
- `ams-golang/internal/config/config_cxxprobe_test.go`

## Windows, Linux, and macOS impact

There are no candidate desktop or ams-access runtime changes in Phase 2b.
cxxprobe remains server-side on Linux.

| Area | Windows | Linux | macOS |
|---|---|---|---|
| Candidate judging | No change; remote Go API only, with no cxxprobe or WSL requirement. | No change; remote Go API only, even though cxxprobe is a Linux binary. | No change; remote Go API only, with no local Linux VM requirement. |
| Organizer upload UI | Not implemented. A future shared UI must use the same scoped API and known-size file flow. | Same. | Same. |
| Canonical validation | Performed only by the pinned server-side Linux import worker. | Same canonical server environment. | Same canonical server environment. |
| Private assets | Never introduced into a candidate payload by this slice. | Same. | Same. |

Browser JavaScript cannot directly set `Content-Length`; it is a
user-agent-controlled forbidden header. The future ams-access uploader must
send a known-size `Blob` or `File`, avoid blindly trying to set that returned
header, and prove that the browser-generated request still satisfies the
signed size and GCS CORS contract on Windows, Linux, and macOS.

## Validation evidence

| Check | Result |
|---|---|
| cxxprobe repository hooks on focused identity files | Passed |
| cxxprobe Conan/CMake build | Passed |
| New cxxprobe identity CLI integration tests | 2/2 passed |
| cxxprobe release-style explicit commit/dirty override build check | Passed |
| cxxprobe scoped whitespace check | Passed |
| Go archive/importer/repository focused tests | Passed |
| Go organizer handler and API package tests | Passed |
| Go race tests for cxxprobe, database repository, and organizer handler paths | Passed |
| Go vet on cxxprobe, database, organizer/API, and standalone worker paths | Passed |
| Standalone bundle import worker build | Passed |
| Go exact-tree full test suite | `go test -p=2 ./...` passed |
| Go exact-tree full static analysis | `go vet -p=2 ./...` passed |
| Go exact-tree full build | `go build -p=2 ./...` passed |
| Go formatting and repository whitespace checks | Passed |

Focused commands included:

```text
go test ./internal/db ./internal/judge/cxxprobe
go test ./internal/handler/org ./cmd/api
go test ./cmd/bundle-import-worker ./internal/judge/cxxprobe
go test -race ./internal/judge/cxxprobe ./internal/db
go test -race ./internal/handler/org
go vet ./internal/judge/cxxprobe ./internal/db ./internal/handler/org ./cmd/api
go vet ./internal/judge/cxxprobe ./cmd/bundle-import-worker
go build -o /tmp/phase2b-bundle-import-worker ./cmd/bundle-import-worker
go test -p=2 ./...
go vet -p=2 ./...
go build -p=2 ./...
```

The exact-tree combined checks used warmed Go caches under `/dev/shm` because
the persistent development filesystem was full. The reduced package
parallelism did not skip packages or change test selection.

Unit and fake-boundary coverage includes archive terminators, node
amplification, late-failure cleanup, malicious paths and entry types,
deterministic repacking, exact executable identity, provenance changes,
generation mismatch, create collision adoption/rejection, signed upload
headers, immutable read/write/delete conditions, request/body/scope
validation, concurrent completion CAS, stale lease cancellation, retry
classification, sanitized errors, transition ordering, and
finalize-before-delete behavior.

No live PostgreSQL server, live GCS bucket, service-account signing path, or
real browser upload was used. The tests prove the local contracts and fake
boundary behavior; they do not prove cloud IAM, CORS, GCS signature handling,
PostgreSQL runtime semantics, or deployment lifecycle.

## Remaining live and release gates

1. **PostgreSQL migration:** apply migrations 038 and 039 to a clean
   disposable PostgreSQL database; run the migration twice through the real
   migration runner; exercise rollback expectations, constraints, triggers,
   indexes, and parent cascades.
2. **Exact upload/import identity:** prove that the deferred circular foreign
   keys commit for a valid consumed ticket/import pair and reject every
   mismatched scope, slug, hash, size, object, or generation.
3. **Database concurrency and recovery:** run real concurrent upload-complete
   transactions, `FOR UPDATE SKIP LOCKED` claims, stale-lease reclamation,
   lease-loss races, DRAFT transition races, retry exhaustion, worker crash,
   and finalization rollback tests.
4. **GCS and IAM:** use a private staging quarantine bucket and separate final
   bucket to prove service-account `signBlob`/signed-URL permissions,
   least-privilege read/create/delete access, create-only
   `x-goog-if-generation-match`, exact generation reads/deletes, CRC32C and
   SHA-256 mismatch behavior, collision adoption, retention, lifecycle, and
   orphan reconciliation.
5. **Browser/CORS upload:** validate a real known-size `Blob`/`File` PUT
   through GCS CORS in the supported WebView/browser on Windows, Linux, and
   macOS. Confirm the user-agent-controlled Content-Length satisfies the
   signature without frontend code attempting to set a forbidden header.
6. **cxxprobe release artifact:** commit and release the identity command,
   build cxxprobe from the exact release commit, record version/commit/binary
   SHA-256, reject dirty/unknown builds, and mount that exact binary read-only
   in the worker image.
7. **Worker deployment and lifecycle:** package and deploy
   `cmd/bundle-import-worker` in a runtime that remains available for database
   polling; configure health, logs/metrics, graceful drain, restart behavior,
   bounded scratch capacity, quarantine cleanup alerts, and recovery from
   retained terminal objects.
8. **End-to-end import:** run API ticket -> browser PUT -> completion ->
   asynchronous claim -> validation -> canonical publication -> transactional
   DRAFT binding -> status polling against real PostgreSQL and GCS, including
   maximum-size and adversarial archives.
9. **Public projection:** define an explicit manifest-backed public
   statement/starter allowlist and redaction contract. Phase 2b must not guess
   which bundle files are safe or expose all files except known secrets.
10. **Session and attempt immutability:** add session-question and attempt
    bundle snapshots so a later DRAFT edit cannot affect an existing session
    or attempt.
11. **Scored judging:** implement the separate Phase 3 cxxprobe attempt
    adapter, immutable source/bundle verification, result envelope, verdict
    mapping, outer Linux execution boundary, and duplicate-delivery terminal
    transaction.
12. **Cross-platform client release:** only after the public API contract
    exists, add the shared ams-access UI and run Windows, Linux, and macOS
    upload, polling, resume, redaction, offline/reconnect, and compatibility
    tests against the same staging contest.

Phase 2b therefore establishes a safe, disabled-by-default organizer import
path and the durable immutable bundle binding needed by later phases. It does
not make cxxprobe-backed questions candidate-visible or judge scored attempts.

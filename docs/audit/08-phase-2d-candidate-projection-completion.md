# Phase 2d candidate projection completion record

Completion date: 2026-07-24

Baselines before this uncommitted slice:

- cxxprobe `main` was refreshed from `56ac877` to the upstream v0.10.0 release
  commit `60f57ea`; the release commit itself changes only `CHANGELOG.md` and
  `CMakeLists.txt`.
- ams-golang `main` was `66839a1`, exactly matching `origin/main`.
- ams-access `main` was `48a1cee`, exactly matching `origin/main`.

Record-time state: Phase 2d implementation and this record were still local and
uncommitted when verification completed. No deployment, live database migration,
live object-storage mutation, or client release was performed.

## Completion statement

Phase 2d implements the server-side candidate-publication boundary promised by
Phase 2c. A schema-v2 cxxprobe import now independently reads and rehashes only
the manifest's explicit public statement, optional C++ starter, and supported
raster assets. Go persists those exact bytes in immutable PostgreSQL projection
rows, binds their independent projection digest to the contest question, freezes
the identity and display metadata at session start, and serves them only through
strict session-owner APIs.

This does not enable scored cxxprobe judging. The existing RUN/SUBMIT barrier
still returns `409 CXXPROBE_JUDGING_UNAVAILABLE` before attempt persistence or
Pub/Sub publication. It also does not yet switch ams-access from the legacy
contest-question endpoint; that client integration is the next product slice.

## Exact producer-consumer golden

cxxprobe v0.10.0 now owns a complete schema-v2 golden manifest at:

```text
cxxprobe/tests/fixtures/bundle_manifest_v2.golden.json
```

The producer unit test reconstructs the fixture bundle, runs the real cxxprobe
bundle validator, and deep-compares its complete ordered JSON output with that
golden. Its canonical bundle digest is:

```text
620c9971335896b972e4be3b34a5f13d701e88728776d4d694a6592e60ca3b31
```

The same bytes are pinned in the Go consumer at:

```text
ams-golang/internal/judge/cxxprobe/testdata/bundle_manifest_v2.golden.json
```

Both files currently have SHA-256
`dc505d7597d4d66a337f56f66000018409856e61cac831d57646eaacdd6c4302`.
Go parses that producer output and asserts the exact two-asset ordering and
media types. A future combined CI job should continue to regenerate/copy or
byte-compare the two repository fixtures so drift cannot be merged separately.

## Import-time public projection

`ExtractCandidateProjection` accepts candidate publication only for manifest
schema v2 with a non-null statement and resolved standard exactly `c++23`.
Schema v1 remains parser/validator compatible as a private bundle contract,
but the question-publication importer now permanently rejects it because that
workflow cannot bind a candidate question without an explicit projection.

For every selected public file Go:

- resolves the exact path from the cxxprobe manifest rather than inferring by
  name or directory;
- opens a regular file beneath the private materialization root;
- checks the manifest size before and after reading;
- rehashes the bytes with SHA-256 and compares the manifest digest;
- validates statement/starter UTF-8 and control characters;
- validates asset extension, declared media type, and PNG/JPEG/WebP magic; and
- refuses files that change while being read.

The Go publication bounds are intentionally stricter than the producer's
general bundle bounds:

| Public material   | Go bound |
| ----------------- | -------: |
| Statement         |    2 MiB |
| Starter           |    1 MiB |
| One asset         |    8 MiB |
| Entire projection |   16 MiB |
| Assets            |       64 |

The independent `ams.candidate-question-projection` schema-1 digest covers the
bundle digest, problem name, language, C++ standard, limits, statement metadata,
starter metadata, and ordered asset metadata. Finalization reparses the
manifest and rehashes every in-memory public byte again before it starts a
database transaction, closing accidental or malicious handoff mutation.

Private tests, answers, checker inputs, reference solutions, canonical archive
location, validated manifest text, and engine filesystem paths are never fields
of the candidate projection.

## Migration 042 and atomic persistence

`042_cxxprobe_candidate_projections.sql` adds:

- immutable `problem_bundle_public_projections` rows with statement/starter
  content, exact byte lengths and SQL-side SHA-256 checks;
- immutable `problem_bundle_public_assets` rows with binary content, media
  metadata, exact byte lengths and SQL-side SHA-256 checks;
- projection ID and digest fields on `contest_questions` with an exact composite
  foreign key to bundle, question, contest, bundle digest, and projection digest;
- projection ID/digest plus frozen candidate-visible metadata on
  `session_question_snapshots`; and
- update/delete/truncate rejection triggers on both projection tables while
  restoring the existing session-snapshot immutability triggers after backfill.

Finalization writes the validated import, immutable problem bundle, public
projection, every asset, and the DRAFT question binding in one transaction.
Create-only collisions are adopted only after exact field/content comparison;
different projection or asset bytes produce `ErrImportConflict`. Asset row count
is checked before the question can bind.

SQL cannot reconstruct public bytes safely from a private object archive.
Migration 042 therefore aborts if a database already contains a cxxprobe-bound
question or session snapshot. The recovery is explicit re-import/rebinding while
the contest is DRAFT, not a guessed or partial backfill.

## Session snapshot and authenticated APIs

Session creation now freezes, in the same transaction as the new session:

- judge engine, bundle ID/digest, problem slug, projection ID/digest;
- order, title, points, question type;
- legacy description and HTML/CSS/JS starters; and
- legacy time/memory limits.

The new read-only endpoints are:

```text
GET /sessions/{id}/questions
GET /sessions/{id}/questions/{questionID}/assets/{assetID}
```

The question response contract is
`ams.candidate-question-projection`, schema version 1. Each question has common
snapshot metadata plus exactly one discriminated `legacy` or `cxxprobe` branch.
The cxxprobe branch carries bundle/projection digests, `cpp`, `c++23`, public
limits, inline statement/starter, and asset metadata with same-host URLs.

Both handlers require a valid candidate identity in context and an exact
case-insensitive match to `sessions.candidate_email` even when the broader
CandidateAuth rollout mode is `soft`. They then apply the existing idle, device,
and resume guards. Missing identity is `401`; wrong owner is `403`.

Asset lookup joins the complete session-frozen projection identity and serves
only bytes from `problem_bundle_public_assets`. It rechecks length and SHA-256
before writing and returns exact media type with `private, no-store`,
`X-Content-Type-Options: nosniff`, content length, safe inline disposition, and
a digest ETag. Candidate handlers do not query `problem_bundles`, validated
manifests, storage locations, or private archives.

The existing unauthenticated `/contests/{id}/questions` compatibility endpoint
still serves the legacy contest-question shape and does not expose cxxprobe
projection bytes. ams-access currently calls that route; its switch to the new
session endpoint and later compatibility-route retirement are explicitly next.

## Validation evidence

| Check                                                   | Result                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| cxxprobe v0.10.0 full rebuild                           | Passed                                                                                          |
| cxxprobe complete registered suite                      | 206 tests passed; 33 expected environment-dependent sandbox/cgroup tests skipped; zero failures |
| Exact producer schema-v2 golden                         | Passed; complete ordered JSON deep comparison                                                   |
| Producer/consumer golden byte identity                  | Passed; identical file SHA-256                                                                  |
| Go focused importer/repository/migration/handler suites | Passed                                                                                          |
| Go focused race suites                                  | Passed                                                                                          |
| Go complete uncached suite                              | `go test -count=1 -p=2 ./...` passed                                                            |
| Go static analysis                                      | `go vet ./...` passed                                                                           |
| Go full build                                           | `go build -p=2 ./...` passed                                                                    |
| Go/cxxprobe whitespace checks                           | Passed                                                                                          |

Go caches, temporary build files, and the cxxprobe build remained under
`/dev/shm` because the persistent filesystem has little free space.

No live PostgreSQL server or disposable container image was available, so
migration 042 was embedded and contract-tested but not executed through the real
migration runner. No staging GCS generation, candidate browser, or desktop
artifact was exercised.

## Next steps and unchanged gates

1. Apply migrations 038 through 042 to a clean disposable PostgreSQL database
   and test preflight failures, exact foreign keys, digest checks, immutability,
   parent cascades, rollback, and concurrent finalization/session creation.
2. Exercise generation-pinned quarantine import and candidate projection against
   staging GCS, including corrupt/collision/private-file adversarial cases.
3. Update the shared ams-access candidate client to fetch
   `/sessions/{id}/questions`, render the cxxprobe branch/assets, and preserve
   legacy rendering; then run shared fixtures on Windows, Linux, and macOS.
4. Keep cxxprobe server-side on Linux for every candidate OS. No client should
   install cxxprobe, a compiler, private tests, or checker material.
5. Implement Phase 3's dedicated cxxprobe attempt adapter, bounded report parser,
   source/bundle verification, provenance/result transaction, and outer Linux
   isolation before removing the scored-attempt barrier.

Phase 2d therefore completes the code-level server boundary for sanitized
candidate bytes. It is not a production release and does not complete live
infrastructure qualification, client integration, or judging.

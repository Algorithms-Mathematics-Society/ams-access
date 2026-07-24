# Phase 2c public contract and identity snapshot completion record

Completion date: 2026-07-24
Go baseline: clean `main` at
`777e6f70413451a1480393db237c5aa6ab3ffa8a`, matching `origin/main`, before
the uncommitted Phase 2b and Phase 2c work
cxxprobe baseline: clean `main` at
`1d70631e49c123b7280f55131a09a11632118e09`, matching `origin/main`, before
the uncommitted Phase 2b and Phase 2c work
ams-access baseline: local `main` at
`3769026c0d6832f5816f32a3ac9d0b87a86f2631`
Repository state: all Phase 2c implementation and this record remain local and
uncommitted; no commit, push, deployment, live database mutation, live object
storage mutation, or client release was performed

## Completion statement

Phase 2c completes two prerequisites for later candidate delivery and judging:

1. cxxprobe bundle schema v2 defines an explicit, digest-covered public
   allowlist while keeping all problem files private by default.
2. Go freezes the selected judge engine and exact cxxprobe bundle identity at
   session creation and attempt creation, and fails closed instead of routing a
   cxxprobe attempt through the legacy worker before Phase 3.

This is a contract and identity-foundation milestone, not completion of Phase
2 and not a client or judging release. Go still has to read the allowlisted
files from the generation-pinned canonical bundle, revalidate their bytes,
persist a sanitized public projection, and expose that projection through a
candidate session API. No ams-access runtime/UI change was made. The existing
legacy worker behavior was deliberately left unchanged, and no cxxprobe scored
attempt can be created or published yet.

## Subagent-driven workstreams

Three bounded implementation lanes were integrated and validated together:

1. **cxxprobe schema-v2 producer:** added the explicit public configuration,
   private-by-default rules, canonical manifest projection, security checks,
   deterministic fixtures, documentation, and producer tests while preserving
   schema-v1 output.
2. **Go schema-v2 consumer:** added strict public-object parsing, downgrade and
   unknown-field protection, schema-v2 golden coverage, import compatibility,
   and migration 040 so validated v1 and v2 manifests can coexist.
3. **Go immutable identity boundary:** added migration 041, transactional
   session-question capture, exact attempt identity, scope strengthening,
   immutability guards, and the pre-Phase-3 fail-closed routing barrier.

The primary integration pass reviewed the combined shared trees, tightened
unknown-engine behavior to allow only `legacy`, strengthened snapshot deletion
semantics, and reran the focused and repository-wide Go gates after migrations
040 and 041 were both present.

## Schema-v1 compatibility

Schema v1 remains a supported private manifest contract. Its canonical golden
fixture and semantic bundle digest are unchanged:

```text
5c2115f6bdbcc10b460946c3009f32df0f0fd35ed840eaa4560ec8fb62cd3ce9
```

A schema-v1 problem must not contain a `public` member, including `null`.
Therefore an old manifest cannot accidentally opt into candidate publication.
Go continues to parse v1 for import and immutable identity purposes, but v1
does not authorize any candidate-visible bundle bytes.

## Schema-v2 public projection contract

Problem configuration version 2 adds an explicit `public` allowlist. Omission
is private: placing a file in the bundle, naming it `problem.md`, or placing it
under a directory called `public` does not by itself make it candidate-visible.
The canonical v2 manifest always emits a complete object with these three
members:

```json
{
  "public": {
    "statement": "a-problem/problem.md",
    "assets": [
      {"path": "a-problem/public/diagram.png", "media_type": "image/png"}
    ],
    "starter": {"path": "a-problem/public/main.cpp", "language": "cpp"}
  }
}
```

An absent statement or starter is represented by explicit `null`; an absent
asset list is represented by `[]`. This makes an empty public projection
explicit and prevents permissive inference by downstream consumers.

The producer and Go parser enforce that:

- every public path names an exact file already covered by the canonical
  manifest and its bundle digest;
- asset and starter paths are beneath the problem's `public/` directory;
- the statement and starter are bounded valid UTF-8 text;
- the starter is a lowercase `.cpp` path with language exactly `cpp`;
- assets are strictly bytewise sorted, unique, bounded in count and size, and
  limited to validated PNG, JPEG, or WebP media;
- one file cannot hold multiple public roles, including ASCII case-folded
  aliases; and
- public files cannot overlap private tests, answers, checker inputs,
  reference solutions, or other execution resources.

Unknown fields inside the v2 `public` object fail closed in Go. Schema v1 with
a public object and schema v2 without the complete public object are both
rejected. Additive top-level manifest fields remain compatible under the
existing versioned parsing rule.

The corrected schema-v2 golden fixture digest is:

```text
620c9971335896b972e4be3b34a5f13d701e88728776d4d694a6592e60ca3b31
```

That value identifies the current v2 golden fixture; it is not a universal
digest for all schema-v2 bundles.

Primary cxxprobe files include:

- `cxxprobe/include/cxxprobe/problem.hpp`
- `cxxprobe/include/cxxprobe/bundle.hpp`
- `cxxprobe/src/problem/problem.cpp`
- `cxxprobe/src/bundle/bundle.cpp`
- `cxxprobe/tests/unit/problem_config_test.cpp`
- `cxxprobe/tests/unit/bundle_test.cpp`
- `cxxprobe/docs/content/architecture/ams-integration-contract.mdx`

## Go parser and migration 040

Go now accepts bundle manifest schema versions 1 and 2 and applies strict,
version-specific public rules. It does not recompute cxxprobe's canonical
digest; the C++ producer remains authoritative, while Go validates structure,
paths, file membership, roles, media types, ordering, bounds, and downgrade
behavior before import can finalize.

Migration `040_cxxprobe_manifest_v2.sql` widens the existing import and bundle
schema-version constraints from v1-only to `(1, 2)`. It does not add a public
projection table or candidate API and does not reinterpret an existing v1
record as v2.

Primary Go files include:

- `ams-golang/internal/judge/cxxprobe/manifest.go`
- `ams-golang/internal/judge/cxxprobe/manifest_public.go`
- `ams-golang/internal/judge/cxxprobe/manifest_v2_test.go`
- `ams-golang/internal/judge/cxxprobe/validator_v2_test.go`
- `ams-golang/internal/judge/cxxprobe/import_v2_test.go`
- `ams-golang/internal/judge/cxxprobe/testdata/bundle_manifest_v2.golden.json`
- `ams-golang/internal/db/migrations/040_cxxprobe_manifest_v2.sql`
- `ams-golang/internal/db/migration_040_test.go`

## Immutable identity snapshots and migration 041

Migration `041_cxxprobe_session_attempt_snapshots.sql` makes executable problem
identity exact and durable:

- the contest-question bundle foreign key now includes `problem_slug` as well
  as bundle ID, question ID, contest ID, and bundle SHA-256;
- `session_question_snapshots` captures every contest question uniformly,
  storing `judge_engine='legacy'` with null cxxprobe fields or
  `judge_engine='cxxprobe'` with the complete exact bundle identity;
- preflights reject historical session/contest/question scope corruption,
  cross-contest answers, slug mismatches, and historical cxxprobe-bound
  attempts that would otherwise be assigned false provenance;
- existing valid contest sessions are backfilled before attempt identity is
  made non-null;
- `submission_attempts` stores judge engine, bundle ID, bundle SHA-256, and
  problem slug, with exact foreign keys back to the owning session snapshot;
- triggers prevent session-snapshot mutation and attempt identity mutation;
  deleting the owning session may still perform its database-owned cascade;
  and
- `contest_answers` must refer to a question in that exact session snapshot,
  closing the prior independent-FK cross-contest scope hole.

Session creation now inserts the session and all question identities in one
transaction under a per-contest/candidate advisory lock. Attempt creation
resolves the requested problem only through that immutable session snapshot
and copies identity with `INSERT ... SELECT` rather than consulting the current
contest-question row.

Routing is deliberately fail closed. Only a snapshot whose judge engine is
exactly `legacy` may continue to the existing worker path. `cxxprobe`, an
unknown engine, or an empty engine cannot create or publish new work. A
cxxprobe RUN or SUBMIT receives `409 CXXPROBE_JUDGING_UNAVAILABLE` before rate
guards, attempt insertion, transaction commit, or Pub/Sub publication. Phase 3
must add the dedicated cxxprobe adapter before that barrier can be removed.

Primary Go files include:

- `ams-golang/internal/db/migrations/041_cxxprobe_session_attempt_snapshots.sql`
- `ams-golang/internal/db/migration_041_test.go`
- `ams-golang/internal/handler/public/sessions.go`
- `ams-golang/internal/handler/public/cxxprobe_snapshots_test.go`

## Validation evidence

| Check | Result |
|---|---|
| cxxprobe Conan/CMake build | Passed |
| cxxprobe complete registered suite | 206 tests passed; 33 environment-dependent sandbox/cgroup tests skipped normally; zero failures |
| Schema-v1 golden digest regression | Passed; digest unchanged |
| Schema-v2 producer and golden digest coverage | Passed |
| Go schema-v1/v2 parser, validator, importer, and migration contracts | Passed |
| Go focused database/public-handler tests with migrations 040+041 | Passed uncached |
| Go focused database/public-handler race tests | Passed |
| Go exact-tree full suite | `go test -p=2 ./...` passed |
| Go exact-tree static analysis | `go vet ./...` passed |
| Go exact-tree build | `go build -p=2 ./...` passed |
| Go formatting and repository whitespace checks | Passed |

The focused Phase 2c commands included:

```text
go test -count=1 -p=2 ./internal/db ./internal/handler/public
go test -race -p=2 ./internal/db ./internal/handler/public
go test -p=2 ./...
go vet ./...
go build -p=2 ./...
```

Go caches and temporary build files were placed under `/dev/shm` because the
persistent development filesystem was full. No packages or tests were skipped
by that cache relocation.

No live PostgreSQL server or local PostgreSQL container image was available.
Migrations 040 and 041 were embedded and contract-tested but were not executed
against a real database. No live GCS bucket or browser/client path was used.

## Remaining Phase 2 and release gates

1. **Exact cross-repository producer golden:** invoke the built cxxprobe
   schema-v2 producer from the Go integration suite and byte/deep-compare its
   actual JSON with the Go golden. The two repositories currently have matching
   contract fixtures and digest tests, but this exact executable boundary is a
   release gate.
2. **Live PostgreSQL:** apply migrations 038 through 041 to a clean disposable
   database through the real runner and exercise preflights, backfill, exact
   foreign keys, update/delete/truncate guards, parent cascades, concurrent
   session creation, and transaction rollback behavior.
3. **Live GCS and projection bytes:** exercise the Phase 2b generation-pinned
   import against staging GCS, then read every allowlisted file from the exact
   canonical generation, verify its digest/type/size again, and prove private
   files cannot enter the projection.
4. **Sanitized projection persistence and API:** add a durable, bundle-bound
   public projection and candidate session endpoint that serves only approved
   statement/starter/assets with bounded content and stable media semantics.
   This is the remaining Phase 2 product slice; it is not implemented here.
5. **Phase 3 routing:** implement the dedicated cxxprobe attempt adapter,
   immutable source/bundle verification, bounded report parsing, result and
   provenance persistence, outer Linux isolation, retry/idempotency behavior,
   and terminal scoring transaction before enabling the current barrier.
6. **Cross-platform client qualification:** only after the sanitized session
   API exists, integrate the shared ams-access client and validate Windows,
   Linux, and macOS rendering, submission, polling, resume, redaction,
   compatibility, offline/reconnect, signing, and packaging paths.

Phase 2c therefore proves the public contract shape and freezes identity at
the database/API boundary. It does not yet deliver public bytes, complete Phase
2, enable cxxprobe judging, or complete any desktop client release.

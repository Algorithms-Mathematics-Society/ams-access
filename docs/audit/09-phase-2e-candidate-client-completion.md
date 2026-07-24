# Phase 2e candidate client completion record

Completion date: 2026-07-24

Baselines before this uncommitted slice:

- cxxprobe `main` is the refreshed v0.10.0 release commit `60f57ea`.
- ams-golang `main` is `66839a1`, with the uncommitted Phase 2d projection work
  described in `08-phase-2d-candidate-projection-completion.md`.
- ams-access `main` is `48a1cee`.

Record-time state: Phase 2d/2e implementation and this record were still local
and uncommitted when verification completed. No deployment, live database
migration, live object-storage mutation, or desktop release was performed.

## Completion statement

Phase 2e switches the shared ams-access candidate contest client from the
unauthenticated contest-question compatibility path to the strict session-owned
candidate projection introduced in Phase 2d. The client now establishes or
resumes a candidate session first, requests `/sessions/{id}/questions` with the
candidate authorization and device identity, validates the exact discriminated
legacy/cxxprobe contract, independently rehashes public text and projection
metadata, downloads each declared raster asset through the authenticated
session route, and verifies its media type, byte count, file signature, and
SHA-256 before rendering it from a local Blob URL.

For a cxxprobe question the editor is fixed to the server-advertised `cpp` /
`c++23` contract and uses the exact public starter filename and content. Phase 3
judging remains deliberately unavailable: Run and Submit are visibly disabled
with an explanatory notice, and both handlers reject a cxxprobe question before
any attempt is queued. Legacy questions retain their existing editing and
judging path.

This is a code-level client integration, not a production release. Live
PostgreSQL/GCS qualification, a complete dependency-backed Next build, real
browser/Tauri smoke testing, and Windows/Linux/macOS release-candidate testing
remain open gates.

## Subagent-driven audit inputs

Three independent read-only audits preceded implementation:

1. The archive/session lane found that the old client fetched public contest
   questions in parallel with session creation and tolerated session failure.
   The implemented order is now token precheck, create/reuse session, strict
   authenticated projection fetch, verified asset fetch, then saved-answer load.
2. The job/contract lane required an exact `legacy` versus `cxxprobe`
   discriminant, `C++23` display mapped to wire language `cpp`, strict unknown
   field handling at trust boundaries, and exact asset identity.
3. The storage/render lane identified that the response needed canonical
   statement, starter, and asset paths so Markdown could resolve only declared
   files. It also required authenticated Blob-backed raster rendering and URL
   cleanup.

The audits also agreed that client-side judging must not be enabled until the
Phase 3 worker adapter and isolation gates exist.

## Go contract completion

`internal/handler/public/candidate_questions.go` now includes the canonical
public paths already stored by Phase 2d:

- `statement.path`;
- optional `starter.path`; and
- every `asset.path`.

The query and row hydration read those paths directly from the immutable public
projection tables. Completeness validation rejects a missing path instead of
guessing a filename or basename. Existing statement/starter/asset length and
digest checks remain in force. Handler tests assert the paths in the emitted
JSON response.

This is an additive schema-1 response detail needed for safe relative Markdown
resolution. It does not expose a private archive path, storage URI, test path,
answer path, checker source, reference solution, or worker filesystem path.

## Strict client projection boundary

`candidate-question-projection.ts` owns the client-side trust boundary. It
accepts only:

- contract `ams.candidate-question-projection` at schema version 1;
- the exact requested session ID and well-formed UUID identities;
- bounded safe integers and lowercase SHA-256 values;
- normalized relative slash-separated public paths;
- exactly one `legacy` or `cxxprobe` branch;
- cxxprobe language `cpp`, standard `c++23`, and a code question type;
- a starter beneath the same public problem root with a lowercase `.cpp`
  filename; and
- asset IDs, paths, media types, and URLs that are unique and exactly bound to
  the active session, question, and asset.

It rejects unexpected envelope/question/branch fields and an explicit set of
private-material names. It also rejects absolute paths, schemes, backslashes,
query strings, fragments, percent-encoded path tricks, traversal, case-only
asset collisions, and basename inference.

The same publication bounds used by Go are enforced before allocation:

| Public material   | Client bound |
| ----------------- | -----------: |
| Statement         |        2 MiB |
| Starter           |        1 MiB |
| One asset         |        8 MiB |
| Entire projection |       16 MiB |
| Assets            |           64 |

Statement and starter UTF-8 byte lengths and SHA-256 values are recomputed. The
independent projection digest is also recomputed from Go-compatible canonical
JSON rather than trusted from the response.

## Authenticated asset rendering

Asset requests use the exact URL from the validated projection with candidate
authorization, device identity, `cache: no-store`, omitted ambient credentials,
redirect rejection, and a bounded abort timer. Before a response becomes
renderable the client checks:

- successful status;
- exact declared raster media type;
- `Content-Length` when present;
- actual bounded byte length;
- PNG, JPEG, or WebP magic; and
- SHA-256 equality.

Only then is a Blob URL created. A failed multi-asset load revokes any URLs
already created. Question replacement and component teardown also revoke every
URL owned by the prior projection.

Markdown image lookup receives the canonical statement path and the verified
asset set. Only an exact normalized relative path to a declared asset resolves;
unapproved images are replaced with their alt text or an unavailable marker.
`srcset` and `sizes` are stripped. Links in cxxprobe-authored Markdown have their
navigation attributes removed so the desktop shell cannot be used as an
unexpected external-navigation channel. The legacy Markdown path is unchanged.

## Session, language, and UI behavior

The contest bootstrap now fails closed when there is no candidate token or no
usable session ID. It no longer falls back to the unauthenticated
`/contests/{id}/questions` routes. Mock-question bypass is restricted to an
explicit dry-run together with relaxed gating.

Saved cxxprobe source is adopted only when its wire language is `cpp`;
otherwise the immutable public starter is used. The visible language is locked
to `C++23`, maps back to wire ID `cpp`, and cannot be changed by the selector or
handler. The exact server-provided starter filename is used for the main editor
tab.

Because the Phase 3 worker does not yet exist, cxxprobe Run and Submit controls
are disabled and explain that the candidate can review and edit starter code.
Handler-level guards provide defense in depth if a control is invoked outside
the normal UI. Autosave remains available so client editing can be exercised
without pretending that scored execution is ready.

## Validation evidence

| Check                                     | Result                               |
| ----------------------------------------- | ------------------------------------ |
| Go candidate handler focused test         | Passed                               |
| Go complete uncached suite                | `go test -count=1 -p=2 ./...` passed |
| Strict standalone projection TypeScript   | Passed with zero diagnostics         |
| Phase 2e TS/TSX syntax/transform parse    | 6 files, zero diagnostics            |
| Projection contract and asset tests       | 5 passed                             |
| Complete registered ams-access unit suite | 95 passed; zero failures             |
| Repository-local formatting               | Passed for all Phase 2e web files    |

The unit suite used Node v22.23.1, satisfying the repository's Node >=22.6
requirement. Its module-type warnings are pre-existing packaging warnings and
did not affect the results.

The complete Next typecheck/build was not available in this checkout: the
workspace has no `apps/web/node_modules` links (including `next` and `tsc`), and
the persistent filesystem had about 26 MiB free. Installing the full dependency
graph would have risked unrelated package/lock changes and exhaustion. The new
standalone trust-boundary module was nevertheless checked with TypeScript 5.9.3,
and every touched TS/TSX source was parsed independently. This limitation must
remain a release gate, not be treated as a pass.

## Cross-platform effect and remaining gates

Windows, Linux, and macOS clients continue to use one remote Go HTTPS contract.
No candidate platform installs or executes cxxprobe, a compiler, private tests,
answers, checker material, or a reference solution. Blob-backed raster assets
and the C++23 editor mapping are shared TypeScript behavior, but no platform
artifact was built or exercised in this slice.

Next work, in order:

1. Run migrations 038 through 042 against disposable PostgreSQL and exercise
   the authenticated projection/asset endpoints against staging object storage.
2. Restore a clean Node 22/pnpm workspace and pass full Next typecheck, build,
   browser tests, CSP tests, and Tauri smoke tests.
3. Run the same projection fixture and offline/reconnect/asset-failure cases on
   Windows, Linux, and macOS release candidates.
4. Implement Phase 3's dedicated cxxprobe worker adapter, pinned engine/toolchain
   provenance, bounded canonical report parser, digest verification, atomic
   result persistence, and outer Linux isolation.
5. Enable cxxprobe Run/Submit only after the Phase 3, isolation, staging, and
   cross-platform gates pass; do not silently fall back to the legacy judge.

Phase 2e therefore completes the candidate-side code path for authenticated,
verified public cxxprobe questions while preserving an honest hard boundary at
judging. It does not close production qualification or enable scoring.

Follow-up (2026-07-24): the representative disposable PostgreSQL portion of the
first next step is complete on PostgreSQL 16.14. Staging object storage and the
exact deployed PostgreSQL-major run remain open. See
[`10-phase-2f-postgresql-qualification-completion.md`](10-phase-2f-postgresql-qualification-completion.md).

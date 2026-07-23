# Phase 0/1 cxxprobe completion record

Completion date: 2026-07-24
Implementation baseline: `cxxprobe` v0.8.1, clean `main` at
`3fe00c404cd3565dc3d18e3f51ffbebde54aba30` before the changes below
Repository state: implementation is present in the local, uncommitted
`cxxprobe` working tree; no commit or push was performed

## Completion statement

Phase 0 and the contract work owned by cxxprobe in Phase 1 are complete. The
authority boundary, transport choice, bundle identity, result schema, engine
provenance, and resolved execution metadata are frozen and implemented. The
result is a versioned CLI-first contract that the Go control plane can consume
without independently redefining C++ evaluation semantics.

This does **not** make the complete AMS production path ready. The Go import and
attempt adapter, immutable object-storage publication, hostile-code outer
sandbox, production runtime validation, and Windows/Linux/macOS desktop
consumption remain later phases.

A Phase 2 boundary audit found two omissions in the first Phase 1 pass: the
bundle manifest did not yet expose the resolved compiler/limits required by
the written acceptance criteria, and multiply linked regular files were not
rejected. Both were repaired before the Go parser was frozen. Resolved
execution data is now digest-covered, and hard links are rejected using file
descriptor link-count checks before and after hashing. The corrected golden
digests and test totals below supersede the initial completion values.

## Subagent-driven workstreams

Three bounded workstreams were developed independently and then integrated and
validated together:

1. **Judge-report contract:** schema version, engine build provenance, resolved
   compiler/limit metadata, CMake provenance injection, and serialization tests.
2. **Bundle contract:** deterministic manifest and SHA-256 identity, path and
   filesystem safety validation, CLI command, unit fixtures, and CLI integration
   coverage.
3. **Architecture contract:** explicit cxxprobe/Go/client ownership boundaries,
   CLI-first transport, sandbox boundary, stable verdict/resource semantics, and
   Phase 1 acceptance criteria.

The primary integration pass reviewed the combined diff, ran repository-wide
format/lint hooks, built all targets, ran all registered tests, independently
recomputed a manifest digest, and built the recommended server-disabled CLI
configuration.

## Phase 0 decisions frozen

- cxxprobe is the authoritative owner of C++ problem validity and judging
  semantics.
- `ams-golang` remains the authoritative control plane for authentication,
  contests, attempts, idempotency, delivery, retries, scoring, and client APIs.
- `ams-access` consumes the remote Go API on Windows, Linux, and macOS; candidate
  devices do not run cxxprobe and never receive secret tests or checkers.
- The first integration invokes one pinned cxxprobe CLI process per durable Go
  worker job. `cxxprobe serve` is not introduced as a second production queue.
- A published artifact contains exactly one direct-child problem directory and
  is identified by a deterministic manifest SHA-256.
- cxxprobe's inner sandbox is not treated as the entire hostile-code boundary.
  Production still requires a disposable, credential-free, no-egress outer
  worker boundary.
- The first integrated language is explicitly C++ only.

The normative contract is in
`cxxprobe/docs/content/architecture/ams-integration-contract.mdx`.

## Phase 1 implementation

### Versioned judge report and provenance

Canonical judge JSON now contains these stable top-level fields before the
existing result data:

```json
{
  "report_schema_version": 1,
  "engine": {
    "name": "cxxprobe",
    "version": "0.8.1",
    "commit": "3fe00c404cd3565dc3d18e3f51ffbebde54aba30",
    "dirty": true
  },
  "execution": {
    "compiler": {
      "cxx": "g++",
      "std_flag": "-std=c++23",
      "flags": [],
      "extra_sources": []
    },
    "limits": {
      "memory_bytes": 268435456,
      "cpu_time_ms": 5000,
      "wall_time_ms": 10000,
      "max_pids": 64
    }
  }
}
```

The actual values are resolved from the problem and build rather than assumed
by the Go layer. CMake automatically embeds the source commit and dirty state,
supports validated reproducible-build overrides, and rejects malformed commit
overrides. An unknown commit is conservatively reported as dirty.

Primary files:

- `cxxprobe/include/cxxprobe/judge.hpp`
- `cxxprobe/src/judge/judge.cpp`
- `cxxprobe/src/judge/judge_json.cpp`
- `cxxprobe/tests/unit/judge_json_test.cpp`
- `cxxprobe/CMakeLists.txt`

### Deterministic problem-bundle contract

The new machine command is:

```text
cxxprobe bundle validate <contest-dir> --json
```

It loads the existing contest/problem schemas, requires exactly one
direct-child problem, requires an enabled check, verifies all referenced files,
and emits an ordered canonical manifest with:

- contract name and schema version;
- validation status;
- normalized, sorted paths;
- per-file byte length and SHA-256;
- file count and total bytes;
- the single resolved problem identity; and
- `bundle_sha256`.

`bundle_sha256` is SHA-256 over the compact canonical manifest JSON with only
the self-digest field omitted. Validation rejects symlinks, non-regular files,
invalid UTF-8, absolute/traversal/unsafe paths, Windows-reserved components,
ASCII case collisions, nested `problem.yaml` files, multiple problem
directories, and configured file/count/size/depth bounds. File reads use
no-follow semantics where the platform exposes them.

Primary files:

- `cxxprobe/include/cxxprobe/bundle.hpp`
- `cxxprobe/src/bundle/bundle.cpp`
- `cxxprobe/cli/commands/bundle_cmd.cpp`
- `cxxprobe/cli/commands/bundle_cmd.hpp`
- `cxxprobe/tests/unit/bundle_test.cpp`
- `cxxprobe/tests/integration/problem_pipeline_test.cpp`

The corrected golden fixture digest is
`5c2115f6bdbcc10b460946c3009f32df0f0fd35ed840eaa4560ec8fb62cd3ce9`.
The unit suite also includes the standard SHA-256 `abc` known vector.

### Documentation and CLI integration

- Added the AMS integration contract and Phase 1 gates to the cxxprobe
  architecture documentation and navigation.
- Added `bundle validate` syntax, output, hashing rules, and exit behavior to
  the CLI reference.
- Registered the new library source, CLI command, unit tests, and integration
  test in CMake.

## Validation evidence

Validation was performed after the three workstreams were integrated and again
after repository format hooks changed task files.

| Check | Result |
|---|---|
| Full CMake/Ninja build | Passed; all 88 build steps/targets completed |
| Full CTest registration | 193 tests, 0 failures |
| Tests executed on this host | 159 passed |
| Environment-limited tests | 34 skipped due unavailable delegated cgroup/user-namespace facilities |
| Bundle unit group | 17/17 passed |
| Bundle unit plus CLI integration focus | 18/18 passed |
| New bundle CLI integration test | Passed |
| Repository pre-commit hooks | Passed on all files, including clang-format and cmake-format |
| `git diff --check` | Passed |
| Direct `bundle validate --json` smoke test | Passed |
| Independent canonical JSON SHA-256 recomputation | Matched emitted digest exactly |
| Server-disabled CLI-only build | Passed with `CXXPROBE_BUILD_SERVER=OFF` and tests off |

The corrected direct smoke fixture emitted
`afe0d704db72a6b03bf87c7ea04df838513ffec74c8db186117d2daa92647278`;
removing only `bundle_sha256`, compact-serializing the remaining JSON, and
hashing it independently produced the same value.

The 34 skipped tests are sandbox/runtime tests that require Linux host
facilities not delegated to this development container. They are not reported
as passes. Before production, the complete sandbox and pipeline suites must run
without skips on the intended cgroup-v2 judge worker image.

The cxxprobe documentation production build was not run because the available
host Node.js is 18 while the current Next.js documentation toolchain requires
Node.js 20.9 or newer. The documentation source was covered by repository hooks;
the production docs build remains a release-environment check.

## Remaining work and gates

1. **Go bundle import/publication:** execute the validator, verify and persist
   its manifest, publish immutable bytes, and bind a question version to the
   digest.
2. **Go result adapter:** invoke the pinned CLI using an argument vector, parse
   only supported report schema versions, persist the raw bounded report plus
   normalized result fields, and preserve attempt idempotency.
3. **Judge deployment:** add the outer no-secret/no-egress boundary, verify
   bundle and engine digests before execution, constrain output, and destroy the
   execution cell after every job.
4. **Client/API projection:** expose only public problem data and stable result
   fields through Go, then exercise the same contract from Windows, Linux, and
   macOS clients.
5. **Release identity:** perform the normal cxxprobe version/tag/reproducible
   artifact flow. The working implementation intentionally reports a dirty
   v0.8.1-derived build until that occurs.
6. **Production qualification:** run the complete runtime suite with no sandbox
   skips and the docs build on the supported release toolchain.

The next implementation slice should be the Go bundle import and persistence
path, followed by the durable per-attempt CLI adapter. Candidate UI routing and
scored production traffic should wait until those identities and the outer
worker boundary are enforced.

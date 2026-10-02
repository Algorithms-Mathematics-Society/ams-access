# Worktree reconciliation — 2026-10-02

## Source decision

Canonical checkout: `/home/user/AccessSoftware/ams-access-main`.
Candidate branch: `reconcile/demo-ready-20261002`, based on fetched `origin/main` at `b6d360b`. No newer remote-main commit existed when reconciliation started. The initial reconciliation pass ended without publishing; the user subsequently authorized a final independent review and push to main (see the publication review below).

The reported two undeployed worktrees were an outdated description of source state. The Astryx redesign and subsequent native/web fixes had already been published in `a2d3640`, `a20c3fc`, `a6d5861`, `9d6bc1c`, `2f49cf3`, and `b6d360b`. Main was clean. The old dirty checkout still represented an earlier UI snapshot.

| Source                                                  | Review result                                                                                                                                | Reconciliation decision                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `main` / `origin/main`, `b6d360b`                       | Current UI, native recovery/event fixes, performance work and follow-up integration fixes                                                    | Retain current implementations                                                             |
| `fix/dev-api-target-and-network-diagnostics`, `c4c67ac` | Unique history contains `5d7137f` API diagnostics and `5202a15` Linux recovery; functional changes already incorporated and hardened on main | Record an `ours` history merge after content review; do not reapply old implementations    |
| Old effective frontend/shared UI                        | 184 files identical to main; all 21 differing files exactly match main ancestor `a20c3fc`; no old-only runtime files                         | Preserve main's fixes; no UI overlay                                                       |
| Old calendar review document                            | Only a trailing blank line differs                                                                                                           | Preserve main copy                                                                         |
| Old `linux-fixes.md`                                    | Historical review document, retained in merged parent history                                                                                | Recover with `git show c4c67ac:linux-fixes.md`; do not present old issue status as current |
| Claude worktree `4b91da4`                               | Clean; identical patch ID to main ancestor `98dac74`                                                                                         | No unique work to merge; leave this historical worktree untouched                          |

Independent reviews by `review_events_again` (frontend) and `fix_signal_drain` (native/API/history) used the review-agent skill. Neither found a missing runtime change. Importing old copies would undo fixed helper-install error handling, Home polling/scan cancellation, response-body timeouts, editor performance, native recovery safeguards, and intentional Java removal.

## Preserved local work

Before changing the old checkout, its tracked/untracked work was saved with `git stash push --include-untracked`. A named local branch protects the stash commit and its parents:

- Backup reference: `backup/pre-reconcile-ui-20261002`
- Snapshot: `c344755fd0ef2393d2c5026f4738e352fdac8f8e`
- Original source branch remains available at `c4c67ac`.

The stash includes the old UI changes and local review captures/baselines. About 209 MB of old-only evidence was identified; it is not application source and will not be added to the publication branch. Previously ignored scratch files remain local. The ignored development API setting was copied to the canonical checkout without logging its value. No credentials or environment files are staged.

To inspect the saved work without disturbing the demo checkout:

```sh
git show --stat backup/pre-reconcile-ui-20261002
git diff backup/pre-reconcile-ui-20261002^1 backup/pre-reconcile-ui-20261002
git ls-tree -r --name-only backup/pre-reconcile-ui-20261002^3
```

The old Next.js process was stopped before archiving. The old checkout is now clean and will be detached at the final reconciled commit, so it cannot accidentally publish from its stale branch.

## Corrections and reproducibility

1. Preserved the old branch's truthful network-policy comment: the initial Network readiness check is advisory; the final onboarding network gate applies platform policy. No enforcement policy changed.
2. Fixed helper staging to use Cargo metadata's `target_directory` rather than hardcoded `repoRoot/target`, including both host and macOS-slice paths. Five regressions cover configured/default paths, invalid metadata/failures, and execution of the actual preparation script with a simulated Cargo cache. Existing macOS helper resources remain unchanged during Linux staging.
3. Replaced cross-worktree dependency symlinks with an independent frozen-lockfile install in the canonical checkout. Dependencies were available offline; no lockfile update was needed.
4. Added [DEMO.md](DEMO.md) and a root README as current entry points. Production UI inspection and fixture evidence are explicitly separated from native/live-backend verification.

## Final validation

- Independent final source/provenance review by `review_events_again`: **no findings**. The reviewer also independently reran all five helper-staging tests.
- Fresh locked dependency installation passed. Production Next.js export, type validation, and all 14 size budgets passed.
- **673 automated tests passed:** web 431, API client 28, helper staging 5, Rust workspace 209. API-client typecheck, Rust formatting, strict workspace/all-target Clippy, and diff checks passed.
- Production-export browser checks passed: all five performance/lifecycle checks, with no JavaScript exceptions; Welcome checks passed 143 assertions across 14 screenshots. Parent visually inspected the Home capture.
- The historical P0 capture runner still expects the pre-redesign `.welcome-root` selector and timed out on the current welcome page. That is a baseline-harness mismatch, not an application failure; the current Welcome runner passed. This runbook uses the current performance runner, not P0 as a current-product gate.
- Native **release** build and Debian packaging passed. Package metadata and bundled executable/helper contents were inspected; it was not installed and native protection controls were not exercised.

Local installer:
`/home/user/AccessSoftware/demo-builds/reconciled-20261002/AMS Access_2.0.9_amd64.deb`

SHA-256:
`c3d99db4e65e08f5d6f8aa18ba445bb8e24b4c69787a5d38c4929f861c174fca`

Build log: `/home/user/AccessSoftware/demo-builds/reconciled-20261002/build.log`.
Performance evidence: `/tmp/ams-reconciliation-browser/2026-10-02T16-51-28-079Z/manifest.json`.
Welcome evidence is under `/tmp/ams-reconciliation-welcome/`.
Production UI preview: `http://127.0.0.1:3010/`, served from the canonical checkout's `apps/web/out`.

**Live-demo limitation:** the read-only `https://api.amsaccess.com/` check timed out during DNS resolution from this machine. Real sign-in, assignment retrieval, judging, and end-to-end native enforcement are not claimed verified. Backend/DNS access and a prepared exam account are still required for that rehearsal. Windows/macOS builds need their own platform validation.

The initial reconciliation pass performed no deployment, privileged installation, cloud changes, or push. The backup reference stays local; only the reviewed reconciliation history is intended for main.

## Publication review — 2026-10-02

The user authorized a second subagent review, correction of confirmed defects, and publication to `main`. The review target was `2fede0a` against freshly fetched `origin/main` at `b6d360b`; no intervening remote commits existed.

- `final_packaging_review`: **no findings** after inspecting the complete merge diff, Cargo target resolution, platform staging branches, and Tauri/CI/release call sites. Independently reran all five helper-staging tests and checked real locked Cargo metadata.
- `final_reconcile_review`: **no findings** after checking the complete diff, preserved stash and branch provenance, API routing, runbook, installer hash and browser manifests. Confirmed no identified unique application work was lost.
- Parent checks: all five helper tests passed, release manifests agree on 2.0.9, merge diff has no whitespace errors, both app worktrees were clean, and the installer hash remains the value recorded above.
- No additional source fixes were required. The earlier 673-test, production-build and browser results still apply to unchanged application source; they were not represented as rerun in this follow-up. This follow-up changes review documentation only.

Publication uses a normal fast-forward push, preserving remote history. Native execution, Windows/macOS validation and live API verification remain the limitations stated above. The existing installer was built from `2fede0a`; this documentation-only follow-up does not change its application source.

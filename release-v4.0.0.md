# v4.0.0 candidate and Phase G acceptance

## Source reconciliation

Desktop source: `Algorithms-Mathematics-Society/ams-access`, branch `release/v4.0.0`.
Team baseline: `3288672`, including all nine `aezyus` commits since `85ef18e`.
Linux review baseline: `c519bd6`, including the four A–F/review commits and follow-up entry/camera fixes.
Website: `Algorithms-Mathematics-Society/amsaccess`, separate clean checkout based on `f692351`. Original dirty checkouts are preserved.

Merge decisions: retain bounded device operations and exact camera selection, migrate the team's preference key, keep their Stage 8/contest camera picker features, retain all warning/battery/Windows typing improvements, and use required desktop-resource recovery with a failed-cleanup latch. Retain both branches' regression test lists. No organizer policy or contest timing defaults were silently changed.

## Acceptance record

- [x] Team commits fetched and reconciled; source manifests set to 4.0.0.
- [x] Exact tag-to-manifest release gate added; releases remain drafts.
- [x] Combined web suite: 695 passing tests; web typecheck passed.
- [x] Web production build and size budgets passed (22.01 MB static export).
- [ ] Local browser fault rehearsal.
- [x] Native suites: 117 platform, 43 core, 48 helper, 89 desktop; formatting/Clippy passed. Installer mocks: 9 post-install and 24 pre-remove; 14 artifact validator tests passed.
- [ ] Fresh CI-built installers tied to immutable commit, size and SHA-256; Linux payload and container install/remove validation.
- [ ] Installed Linux desktop/camera/helper/packet acceptance across declared supported configurations.
- [ ] Real nonproduction roster: login → checks → capture/review → entry → Run → Submit → Finish → verified restoration, with backend evidence for retry/idempotency/token restart.
- [ ] Admission delay and clock fairness approved against the actual backend/contest configuration.
- [ ] Website exact-artifact requirement/evidence registration and public download verification after publication.

No nonproduction roster or endpoint was supplied or discovered in the candidate repository. Local fixture tests are appropriate for fault injection; production API is not a substitute. These fixtures cannot establish actual judge processing or native desktop restoration. Do not mark the remaining acceptance items complete from unit tests or historical v3 packages.

The live website was checked read-only: `amsaccess.com` redirects to `www.amsaccess.com`, and `app.amsaccess.com/api/releases/latest` serves published v3.4.0 with platform assets/hashes. Its release lookup excludes drafts, so preparing v4.0.0 need not switch public downloads before acceptance.

# v4.0.1 release and Phase G acceptance

Status: preparing the follow-up to public v4.0.0. Do not overwrite the published v4.0.0 tag or assets. Phase G remains open until its actual acceptance evidence is recorded.

## Source scope

- Review repairs: `24f9ade`, including practice policy, recorder ordering, visible entry errors, atomic camera switching, keyboard recovery, GNOME coverage, startup feedback and mobile Settings layout.
- Team history: all nine commits included in v4.0.0 plus `74c1f2a`, `e212716`, and `677d2cf`, merged without squashing their history.
- Version authority: Cargo workspace 4.0.1; desktop, web and API-client manifests must agree; Tauri must not override it.

## Evidence and limits

Before the latest team merge: 703 web, 18 desktop JavaScript, 3 API-client and 306 native tests passed. Strict workspace Clippy passed. Production browser fixtures passed 102 Settings layout assertions and four practice-flow assertions. These fixtures do not establish installed runtime or physical-device acceptance.

Local backend contract checks cover authoritative timing, duplicate open/finish, run/submit isolation, cooldown and duplicate worker-result idempotency. A shared local Moto S3/SQS service was exercised by separate API-style clients and actual worker adapters. Real judge and integrated API-to-worker execution are still being collected in an isolated KVM guest; no production roster or credentials are used.

## Completion checklist

- [x] Integrated-source tests (718 web, 18 desktop JavaScript, 3 API-client), typecheck and production build.
- [ ] Native tests, formatting and strict Clippy on final source.
- [ ] Four platform builds; independently verify all installer hashes and manifests.
- [ ] Exact Linux package installation/removal and installed startup/ownership checks.
- [ ] Real API → queue → worker → judge → result persistence rehearsal.
- [ ] Installed camera, desktop restoration and required-policy acceptance on supported environments.
- [ ] Synchronized-start/backend capacity acceptance or explicitly documented remaining limitation.
- [ ] Publish the verified follow-up and update website download metadata to actual assets.

Do not convert incomplete checks into passes based on unit tests, browser fixtures or older installer evidence.

## Team/release recheck

On 22 October, remote desktop main was `677d2cf`; all three commits beyond the v4.0.0 source are ancestors of this branch. Public v4.0.0 still resolves to source `092897b` (annotated tag `cef1ab7`); all eleven live asset IDs and SHA-256 digests match the earlier verified candidate. No v4.0.1 tag existed at this check. A fetch reported an unrelated historical `v0.10.3-shell-alpha` tag mismatch; no tag was force-updated. Website main advanced to `14799e2` and is being integrated separately.

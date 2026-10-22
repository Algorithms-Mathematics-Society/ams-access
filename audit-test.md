# October 21 practice contest — incident briefing

Scope: October 21 Ascent chat reports, source inspection and isolated reproductions. This file records the incident; implementation priorities and checklists are in [linux-execution.md](linux-execution.md). The complete earlier audit and its evidence are preserved in [the local incident archive](reports/linux-review/archive/audit-before-review.md). Historical “fixed on main” labels describe their original snapshot, not current release acceptance.

## Main incident

The strongest cross-platform explanation for login/entry failures is synchronized client work hitting constrained backend capacity, amplified by retries and restart-driven login. The source mechanisms were confirmed; the contribution of server saturation remains probable until deployment metrics/logs establish it. Linux changes do not resolve backend capacity, admission timing or submission guarantees.

| Incident family                                | Evidence and confidence                                                                                                                       | What remains to establish                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Login and entry timeouts                       | Synchronized startup requests, expensive authentication and short client deadlines confirmed in the audited source; outage magnitude probable | Actual server/DB/worker metrics, deployment topology and staging capacity rehearsal              |
| Linux touchpad/keyboard                        | Historical touchpad disabling and incomplete desktop adapters source-confirmed                                                                | Installed pointer preservation, live shortcut/gesture coverage and exact crash restoration       |
| No-face scan and camera recovery               | Missing no-face exit, error classification and request ownership gaps confirmed; affected-machine detector cause unresolved                   | Affected Ubuntu/Mint capture/model evidence and real camera/IR device trials                     |
| Arch/Wayland Settings freeze                   | October 21 report confirmed; entire-renderer freeze not reproduced                                                                            | Distinguish UI freeze from a pending device request; record WebKit/GStreamer/session diagnostics |
| Multi-display and policy guidance              | Client continuation/final-policy inconsistencies confirmed                                                                                    | Installed platform-specific policy/waiver behavior                                               |
| Contest output, timing, submission and support | UI/source and chat findings retained in the detailed audit                                                                                    | Backend idempotency, timing agreement, visible feedback and organizer communication rehearsal    |

Mint reports establish keyboard/face-capture symptoms, not its desktop environment or touchpad loss. Do not infer GNOME, Cinnamon, driver or portal causes without inventory. A successful mock test is not evidence that a reporter's machine is fixed.

## Current disposition

A–F implementation and a subsequent review have addressed local deadline/recovery, policy, camera, desktop and packaging defects. The review itself found entry regressions that the original green suites did not cover. [linux-review.md](linux-review.md) records those findings, chosen repairs, tests and limitations. Previous package builds demonstrate only their captured source snapshot; the newer review fixes require new artifacts.

Phase G update (22 October): v4.0.0 was published externally at 04:03 UTC. All eleven public asset identities, sizes and SHA-256 digests still match the independently verified draft. The published tag remains at `092897b`; those bytes are preserved. Review repairs and all twelve team commits through `677d2cf` are integrated in the v4.0.1 follow-up. Integrated source passes 718 web, 18 desktop JavaScript, 3 API-client and 306 native tests, typecheck, strict Clippy and the production web build. Production browser fixtures pass 102 Settings layout checks and four practice-flow checks. All ten source CI jobs passed. The authorized v4.0.1 draft build (`39730820957`) passed all four platforms, and all seven installers/four manifests passed independent hash verification. The public website still serves v4.0.0; see [release-v4.0.1.md](release-v4.0.1.md) for exact new-artifact runtime evidence and limits.

The earlier 12 backend contracts ran against stale local Python source `f48d7065`; they cannot certify current deployment behavior. The current backend checkout is isolated at remote main `df1b0f9`. Worker remote main is `e6d07c0`; its deployment script pins official cxxprobe v0.14.0, not the stale local v0.10 checkout. The checksum-verified v0.14.0 binary successfully judged correct, incorrect and packaged submissions through the real worker in an isolated KVM guest. The full local API-to-worker-to-result rehearsal passed on current source with the concurrent-submit repair `c40e758`: login, open, Run, Submit, duplicate callback and Finish produced exactly two completed jobs and two AC results. The API endpoint layer used TestClient; storage, queue and judge were real isolated services. This evidence does not establish production capacity or physical-device acceptance.

The incident is **not closed**. Release gates remain: affected-device reproduction, supported desktop/camera acceptance, exact native restoration, helper crash/network-change recovery, backend capacity and end-to-end rehearsal. Do not mark Phase G complete from automated or container checks alone.

## Evidence policy

- **Confirmed:** source mechanism or controlled reproduction proves the stated behavior.
- **Probable:** mechanism is supported, but the link to the reported incident lacks runtime evidence.
- **Unverified:** requires the named device, environment, server record or packet-level check.

Detailed historical logs/captures are local evidence under ignored `reports/`; they are not application assets or automatically staged release files. The dangerous fixture patch was moved outside the product repository. No production service or host desktop/firewall was used as a test target.

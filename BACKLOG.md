# Backlog

Work that is deliberately not done, and why. Everything here was found during
an audit, decided on, and left — so the *next* audit finds a decision instead
of rediscovering it as a bug. That has already happened once: the items below
were all reported as defects in a round where they were choices.

Anything dormant in the codebase should have an entry here. If it does not,
it is a loose end rather than a decision.

## Server-side identity capture

Today the face snapshot taken during onboarding is written to
`%TEMP%\ams_faces` (`/tmp/ams_faces` off Windows), used on-device to confirm
the camera can see one correctly framed face, and deleted when the session
ends — and again at the next launch, which covers the crash case. It is never
uploaded. There is no endpoint that receives it and nobody reviews it, and the
privacy page and onboarding copy both say so plainly.

That means **identity is only as strong as live presence monitoring**: the
periodic BlazeFace checks during the exam do reach the server as proctoring
events, but there is no enrolment image to compare a disputed session against.

To do it properly: `POST /participant/sessions/{uid}/identity-capture` into S3
via `services/storage.py` (`put_object`, and `problem_asset_key`'s
content-hash addressing as the pattern for the key), surfaced in the
invigilation console, with the local copy deleted after a confirmed upload.
That needs a retention window and consent copy decided first — it is new
biometric PII on our servers, which the current design deliberately avoids.

## Screen-capture detection

`check_screen_sharing`, `detect_screen_capture_active`,
`detect_active_screen_share` and `get_screen_capture_permitted_apps` are
implemented in `platform-rs` and registered as Tauri commands, and **nothing
calls them**. That is the decision, not an oversight.

The mitigation ships instead of the detector: `apply_capture_protection` sets
`WDA_EXCLUDEFROMCAPTURE` on the exam window, so a recording or a shared screen
captures a black rectangle. A detector would add false positives — Game Bar,
accessibility tools, legitimate conferencing left running — into a violation
feed whose value depends on an invigilator being able to trust every row. And
it would not close the real hole either way: a candidate pointing a second
device at their screen is invisible to both.

Remote desktop *is* covered, separately and at the entry gate, by the
`remote_server` readiness check.

Revisit if a contest is ever sat somewhere the blackout does not apply.

## macOS

Dormant, not dropped — pending the Apple developer agreement. The release
matrix skips it; CI's `bundle-smoke` still builds it, because that is the only
thing compiling `platform-rs/src/macos/mod.rs` and dropping it from both would
let that code rot until the agreement lands. Keep the `APPLE_*` secrets.

## Windows firewall builds

The default Windows build runs unelevated and raises no firewall, which is
right for contestants installing at home. `AMS_FIREWALL=1` produces the
elevating build for a supervised lab, and `network-gate.ts` is what tells the
two apart: a build that never asked to elevate enters with egress open and the
fact recorded, while one that asked and was refused (`windows_no_admin`) still
blocks. If a lab deployment ever happens, that is the flag and that is the
module to read first.

## Device-key-signed readiness reports

`deliver_readiness_report` posts the evaluated entry-gate report to
`/participant/contests/{uid}/readiness-reports`, and the server records it
without enforcing it — the client gates locally. The report is therefore only
as trustworthy as the client that sent it, which is fine while it is an
invigilation aid and not fine if it ever becomes a gate.

Signing it with a per-device key would make it evidence rather than a claim.
Worth doing before any decision is made to enforce readiness server-side.

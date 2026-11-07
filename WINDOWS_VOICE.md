# Windows team voice: security and acceptance

Scope: Windows 10/11 packaged Access, issues #299, #300 and #301 under #294.
This is an implementation/verification plan, not a native certification or a
claim that 400 concurrent users have been tested. macOS and Linux rollout are
outside this slice.

## Changes and trust boundaries

The desktop CSP permits `wss://api.amsaccess.com` alongside the existing HTTPS
API. Development retains its existing localhost WebSocket exception. No wildcard
WebSocket destinations, remote frames, external scripts, or media URLs are added.
ICE traffic is separate from CSP and must still obey Windows lockdown.

`packages/platform-rs/src/windows/firewall_policy.rs` blocks the complement of
the configured destination IPs. Onboarding currently supplies the API hostname
only. Arbitrary teammate IPs therefore cannot be assumed reachable. The Windows
voice engine must use `iceTransportPolicy: "relay"`. A configured TURN endpoint
and a reviewed fixed destination allowlist are release prerequisites. Do not
learn firewall exceptions from SDP, ICE candidates or untrusted room messages;
do not turn off lockdown or permit all WebView traffic to make voice work.

This branch does not add TURN infrastructure, endpoints or firewall exceptions.
A TURN hostname in credentials alone does not make that host reachable under the
existing API-only lockdown. DNS/IP changes and IPv4/IPv6 must be tested with the
chosen deployment before release. Both the private WebView2 runtime and native
process rules must retain their existing restrictions and verified cleanup.

The existing Windows WebView2 permission handler in `apps/desktop/src-tauri/src/lib.rs`
autoallows camera/microphone requests by kind, without checking the requesting
origin. This change does not broaden it. Origin restriction remains a security
review item before the voice release; restrictive frame/navigation policy is
not a substitute for checking the origin at the permission boundary.

The API also accepts the participant token in the WebSocket URL. Local Uvicorn
protocol source logs handshake paths including query strings by default. API
issue [#79](https://github.com/Algorithms-Mathematics-Society/ams-api/issues/79)
tracks verified application/proxy log redaction as a release blocker. No real
production logs were inspected and no actual credential exposure is asserted.

## Media, authentication and limits

- Borrow the current proctor microphone by cloning its audio track. Muting or
  leaving voice must not disable/stop the proctor-owned original or its camera.
  If no microphone exists, acquire audio only and own/release that capture.
- Request only audio. Do not record, persist or send audio to the API. Do not log
  participant query tokens, TURN credentials, or raw signaling payloads.
- Auth generation changes, leaving the contest, permission failure and terminal
  server close must invalidate pending promises as well as existing resources.
- `replaced` and close 4411 are terminal; 4401/4403/4410 are also terminal. Rejoin
  from an old session must not fight the replacement.
- At most four remote peer connections per participant; bound message size,
  candidate queues, retry attempts and timers. No per-peer HTTP polling.
- For 3,000 clients, a 25-second heartbeat is about 120 messages/second in each
  direction. A three-to-five-second team poll ranges from600 to1000 HTTP requests/second
  (about750/s at a four-second mean) before hidden-window backoff; 304 responses still require authentication and server work.
  Hidden-window backoff and nonoverlap reduce load but do not certify capacity.
- API PR78 caps new credential expiry at scheduled round end. Existing relay
  allocations may outlive credential expiry. Client media teardown must be
  verified separately, including early contest closure and auth revocation.

## Required Windows evidence (pending)

Record installer version/commit, Windows version, WebView2 version, network,
team size, expected/actual result, and sanitized diagnostics. Do not put tokens
or audio recordings in issue attachments.

| Scenario                           | Acceptance                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Solo contest                       | No voice capture or ongoing team polling after confirmed non-team response; ordinary exam behavior unchanged.                           |
| Team lobby and workspace           | Voice opens only in the server voice window and survives the lobby-to-workspace handoff; #293 remains a separate prerequisite.          |
| Permission denied / OS privacy off | Visible recovery instructions; Retry after enabling mic works without leaving an extra capture open.                                    |
| Five members                       | Every member hears the other four, never another team; status reflects actual connection.                                               |
| Mute / per-member volume           | Outbound cloned track is disabled immediately; proctor camera/mic remains usable; volume affects only intended peer.                    |
| Autoplay / device change           | Blocked playback has a user-action recovery; unsupported output selection is explained; unplug does not loop requests.                  |
| Symmetric NAT / relay only         | Selected candidate pair is relay; UDP and TCP/TLS fallback tested under real Windows lockdown.                                          |
| Flap / sleep / network change      | One bounded reconnect sequence, no duplicate sockets or microphone streams; no automatic retry on terminal codes.                       |
| Replaced tab / session             | Old client receives replaced or4411 and releases voice without reconnecting.                                                            |
| Logout / end / unmount             | All owned audio tracks, remote audio elements, peer connections, event handlers and timers stop; late async grants cannot restart them. |
| Early end / revoked membership     | Record actual server/client behavior; do not treat initial socket authentication or credential expiry as revocation enforcement.        |
| Exit recovery                      | Existing Windows firewall/proctor cleanup still restores the prior device state.                                                        |

## Automated proof and rollout

Run `node --test --experimental-strip-types
apps/web/src/lib/csp-allows-api-base.test.mjs apps/web/src/lib/api-base.test.mjs`
from the repository root. The existing web test command already includes both
files. These checks assert exact origin allowance and preserve release frame,
object and media restrictions; they do not test WebView2 or firewall behavior.

Engine/UI branches add separate lifecycle and malformed-input regressions.
Require CI (including Windows Rust compilation), real Windows small-team tests,
and reviewer/attack-agent findings to be resolved before release. After functional
checks, separately schedule a short 400-concurrent-user capacity exercise and
measure CPU, memory, signaling rate, relay bandwidth and disconnect rate. The
actual event is approximately100 people for three hours; no 12-hour full-load
exercise or paid infrastructure is provisioned by this work.

## Implementation record — 7 November 2026

- Issue299 / PR303: `feat/windows-voice-engine-299`, bounded relay-only engine.
- Issue300 / draft PR304: `feat/windows-voice-ui-300`, stacked on enginePR303.
- Issue301 / PR302: `fix/windows-voice-security-301`, exactWSS CSP and this guide.
- Combined validation: `feat/windows-team-voice-integration` at `6e859d9`.
  This branch combines the workstreams for verification; do not merge it in
  addition to the individual PRs without reconciling duplicate commits.

Final combined checks: 1,249 web tests passed with zero failures/skips; 46 focused
checks passed; actual web TypeScript checking and changed-file formatting passed.
The source-wiring test is supplementary, not mounted React evidence. Two Sol
implementers, a Sol correctness reviewer and a separate Sol adversarial reviewer
participated. Review fixes cover end-capped renewal, same-member replacement,
queued stale signaling, audio-only SDP, microphone loss, and polling recovery.

No merges, production deployments or AWS resource creation were performed.
Pre-contest lobby#293, native Windows/TURN acceptance, server token-log redaction
(API#79), permission-origin hardening and capacity verification remain open.

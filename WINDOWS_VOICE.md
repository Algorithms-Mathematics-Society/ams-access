# Desktop team voice: Windows and Linux security and acceptance

Scope: Windows 10/11 and Linux x86_64 native Access, lobby #293 and voice issues
#299, #300 and #301 under #294. The filename is retained for existing links.
This is an implementation/verification plan, not a native certification or a
claim that 400 concurrent users have been tested. macOS, mobile and browser
team-room rollout remain outside this slice.

## Changes and trust boundaries

The desktop CSP permits `wss://api.amsaccess.com` alongside the existing HTTPS
API. Development retains its existing localhost WebSocket exception. No wildcard
WebSocket destinations, remote frames, external scripts, or media URLs are added.
ICE traffic is separate from CSP and must still obey native lockdown.

`packages/platform-rs/src/windows/firewall_policy.rs` blocks the complement of
the configured destination IPs. Onboarding currently supplies the API hostname
only. Arbitrary teammate IPs therefore cannot be assumed reachable. The shared
voice engine must use `iceTransportPolicy: "relay"`. A configured TURN endpoint
and a reviewed fixed destination allowlist are release prerequisites. Do not
learn firewall exceptions from SDP, ICE candidates or untrusted room messages;
do not turn off lockdown or permit all WebView traffic to make voice work.

This branch does not add TURN infrastructure, endpoints or firewall exceptions.
A TURN hostname in credentials alone does not make that host reachable under the
existing API-only lockdown. DNS/IP changes and IPv4/IPv6 must be tested with the
chosen deployment before release. Both the private WebView2 runtime and native
process rules must retain their existing restrictions and verified cleanup.

Windows WebView2 grants camera/microphone only to approved requesting origins.
Linux grants capture/device information only for a trusted top-level app/development
origin and denies popup WebViews; its older API has no requesting-frame origin,
so existing navigation and frame CSP restrictions remain necessary.

API/proxy credential-log redaction was deployed and verified with synthetic
credentials on 7 November2026 (API6dd27d99). This is historical deployment evidence,
not permission to print real tokens or assume future logging changes remain safe.

## Linux runtime and relay prerequisites

The same lobby, explicit muted Join, mute/leave, part selection and error controls
are enabled for the Linux x86_64 native WebView. Onboarding uses the native OS result;
rendering requires Tauri plus a supported desktop platform hint. Web, macOS, Android
and ambiguous Linux/ARM hints remain excluded. No extra polling owner is introduced.

If RTCPeerConnection is missing, voice must report unavailable without acquiring
a microphone or presenting a successful voice connection. The lobby and assigned
workspace remain usable independently. Unsupported output-device selection remains
feature-detected; use system audio output settings when the selector is absent.

Local inspection found WebKitGTK 2.54.2 with its WebRTC setting default false and no
`webrtcbin` GStreamer element. The native runtime now explicitly enables supported
WebKit WebRTC settings; capture working alone does not prove WebRTC support.

Debian packages declare `gstreamer1.0-plugins-bad` (WebRTC, DTLS and SRTP) and
`gstreamer1.0-nice` (ICE) alongside the existing base/good plugins (Opus and RTP).
Fedora RPMs declare `gstreamer1-plugins-bad-free` and `libnice-gstreamer1` alongside
base/good. These are runtime plugin packages; installing only libnice or the
GStreamer bad shared-library package does not supply the required factories.
Package names/plugin files were checked against the official
[Debian bad plugin file list](https://packages.debian.org/bookworm/amd64/gstreamer1.0-plugins-bad/filelist),
[Debian ICE plugin file list](https://packages.debian.org/bookworm/amd64/gstreamer1.0-nice/filelist),
[Fedora bad-free package](https://packages.fedoraproject.org/pkgs/gstreamer1-plugins-bad-free/gstreamer1-plugins-bad-free/fedora-43.html)
and [Fedora libnice plugin package](https://packages.fedoraproject.org/pkgs/libnice/libnice-gstreamer1/).

Linux builders install those plugins. `scripts/check-linux-rtc-media.sh` loads the
WebRTC/ICE/DTLS/SRTP/Opus/RTP factories and executes a finite synthetic Opus/RTP
encode/decode pipeline without microphone, speaker or network access. Clean Debian
and Fedora install jobs run the same check with recommended/weak dependencies off;
the inspection tools are installed separately after the application dependencies.
This proves plugin loading and the codec path, not a negotiated WebRTC connection.

AppImage retains `bundleMediaFramework: true`, as required by
[Tauri media packaging](https://tauri.app/distribute/appimage/). Artifact validation
requires the WebRTC, ICE, DTLS, SRTP, Opus, RTP and RTP-manager plugin files as well
as camera support. The current [Tauri GStreamer bundler](https://github.com/tauri-apps/linuxdeploy-plugin-gstreamer/blob/master/linuxdeploy-plugin-gstreamer.sh)
copies all files from the builder plugin directory, so those plugins must be
installed before bundling. File presence does not establish plugin loadability, host audio
integration or WebKit support. A clean supported desktop must still run the actual
AppImage and complete a real relay call under lockdown before release. Builders
must fail if linuxdeploy omits a required plugin; host-installed plugins must not
be treated as evidence that the AppImage contains them.

Linux's helper allows approved destination IPs, limits resolvers to DNS ports and
drops other destinations. Onboarding currently supplies the API host only. A
separate TURN server must be added through reviewed fixed approved destination
configuration; SDP/ICE messages must never expand that allowlist. No firewall
rules are relaxed by this UI change. TURN provisioning/DNS/TLS and actual relay
connectivity under lockdown remain pending on both platforms.

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
  direction. The single shared lobby/voice poll runs every three to five seconds
  while visible: 600–1,000 HTTP requests/second (about 750/s at a four-second
  mean) before hidden-window backoff; 304 responses still require authentication
  and server work. Hidden windows use a 15-second interval (about 200/s).
  Hidden-window backoff and nonoverlap reduce load but do not certify capacity.
- API PR78 caps new credential expiry at scheduled round end. Existing relay
  allocations may outlive credential expiry. Client media teardown must be
  verified separately, including early contest closure and auth revocation.

## Lobby entry and allocation

Only native Windows and Linux x86_64 sessions use this lobby. The existing setup authorization,
readiness, identity capture, secure-session start and lockdown verification run
before the setup handoff. A one-shot authenticated team lookup then permits a
published team or an explicitly unpublished team to reach the room before the
contest start. A confirmed non-team response retains ordinary entry behavior;
unknown lookup failures retain the setup wait. Direct workspace entry still
requires the completed handoff and matching server authorization acknowledgement.

The server owns waiting, discussion, choosing and locked phases, voice availability,
claim/release results and automatic allocation. The room does not optimistically
assign ownership. Claim conflicts refresh the projection. Locked allocation and
exactly one `holder_is_me` mapping enable an explicit Go to your part action.
The loader requests only that mapped problem label; the existing pending-session
and authenticated paper endpoints still prevent early editor access. Display
names are never ownership identifiers.

A single controller supplies both lobby and voice state through the workspace
transition. Requests have an eight-second deadline, never overlap, and schedule
again after completion. In addition to the intervals above, allow for initial
entry, explicit mutations/conflict refreshes, one wake per server phase
deadline and a fresh GET whenever the window becomes visible. A visibility wake
bypasses ETag even when queued behind an in-flight request, so sleep can reanchor
the server clock. Solo and terminal authorization responses stop polling. Authentication
changes and unmount stop the owner and fence late responses. Only the bounded
team/member/part projection is retained; no history or integration payload grows
in memory. Countdown anchors use the response's server time plus monotonic elapsed
time, including across unchanged ETag responses.

Voice stays in the common room shell while paper loads and the workspace opens;
there is no second voice-only team poll. Transient board failures keep entry
closed while retaining the current authorized workspace buffer and statement
assets; recovering the same locked assignment does not reinstall older drafts. The lobby also retains camera monitoring,
session heartbeat and mandatory security overlays. Voice still needs an explicit
Join action. The roster API has no stable member UID for correlating signaling
peers, so speaking/mute/connection feedback remains in the peer controls rather
than being inferred from roster names. This leaves the per-member voice-state
criterion of #293 incomplete; do not close the issue on this implementation.

## Required Windows and Linux evidence (pending)

Record installer version/commit, Windows version, WebView2 version, network,
team size, expected/actual result, and sanitized diagnostics. Do not put tokens
or audio recordings in issue attachments.

| Scenario                           | Acceptance                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Solo contest                       | No voice capture or ongoing team polling after confirmed non-team response; ordinary exam behavior unchanged.                           |
| Team lobby and workspace           | Voice opens only in the server voice window and survives the secured lobby-to-workspace handoff without duplicate sockets or capture.   |
| Permission denied / OS privacy off | Visible recovery instructions; Retry after enabling mic works without leaving an extra capture open.                                    |
| Five members                       | Every member hears the other four, never another team; status reflects actual connection.                                               |
| Mute / per-member volume           | Outbound cloned track is disabled immediately; proctor camera/mic remains usable; volume affects only intended peer.                    |
| Autoplay / device change           | Blocked playback has a user-action recovery; unsupported output selection is explained; unplug does not loop requests.                  |
| Symmetric NAT / relay only         | Selected candidate pair is relay; UDP and TCP/TLS fallback tested under real Windows and Linux lockdown.                                |
| Flap / sleep / network change      | One bounded reconnect sequence, no duplicate sockets or microphone streams; no automatic retry on terminal codes.                       |
| Replaced tab / session             | Old client receives replaced or 4411 and releases voice without reconnecting.                                                           |
| Logout / end / unmount             | All owned audio tracks, remote audio elements, peer connections, event handlers and timers stop; late async grants cannot restart them. |
| Early end / revoked membership     | Record actual server/client behavior; do not treat initial socket authentication or credential expiry as revocation enforcement.        |
| Exit recovery                      | Existing Windows firewall/proctor cleanup still restores the prior device state.                                                        |

## Automated proof and rollout

Run `node --test --experimental-strip-types
apps/web/src/lib/csp-allows-api-base.test.mjs apps/web/src/lib/api-base.test.mjs`
from the repository root. The existing web test command already includes both
files. These checks assert exact origin allowance and preserve release frame,
object and media restrictions; they do not test WebView2 or firewall behavior.

The registered web suite includes lobby parsing, request scheduling, claim conflict,
server-clock countdown, locked ownership and existing setup/voice lifecycle
regressions. Mocked requests do not establish native behavior or production
capacity.
Require CI (including Windows Rust compilation), real Windows small-team tests,
and reviewer/attack-agent findings to be resolved before release. After functional
checks, separately schedule a short 400-concurrent-user capacity exercise and
measure CPU, memory, signaling rate, relay bandwidth and disconnect rate. The
actual event is approximately 100 people for three hours; no 12-hour full-load
exercise or paid infrastructure is provisioned by this work.

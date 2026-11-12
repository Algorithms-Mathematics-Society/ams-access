# Linux native team voice runtime: implementation boundary

WebKitGTK 2.54.2 on the inspected Linux host exposes no `RTCPeerConnection`, even
after its `enable-webrtc` setting is enabled. The installed GStreamer WebRTC,
ICE, DTLS, SRTP, and Opus plugins do not add that JavaScript API. Team voice
therefore remains unavailable in this build. This document records the
implementable Linux path; it does not enable the UI or certify a call.
Upstream [WebKitGTK 2.54 release notes](https://webkitgtk.org/2026/09/16/webkitgtk-2.54-highlights.html#multimedia-improvements)
describe WebRTC being disabled during its backend transition.

## Runtime choice

The desktop dependency graph uses `gtk 0.18`, `webkit2gtk 2.0.2`, and
`glib 0.18.5` ([Cargo.lock](../Cargo.lock)). Current
[`gstreamer 0.25.4`](https://docs.rs/crate/gstreamer/0.25.4) and
[`gstreamer-webrtc 0.25.4`](https://docs.rs/crate/gstreamer-webrtc/0.25.4)
use GLib 0.22. The [gtk-rs project](https://github.com/gtk-rs/gtk-rs-core)
warns that mixing incompatible core GLib crate versions requires care.
[`gstreamer 0.21.3`](https://docs.rs/crate/gstreamer/0.21.3) matches GLib 0.18
but dates from 2023. Do not add current GStreamer bindings directly to the
Tauri crate or pin the new media implementation to that historical branch.

Build an unprivileged Linux voice sidecar as a **separate Cargo workspace with
its own lockfile**, using a supported GStreamer Rust binding release and
`gstreamer`, `gstreamer-webrtc`, and `gstreamer-sdp`. Bundle its executable
with Tauri's Linux artifacts. The parent launches a fixed bundled path with
private stdin/stdout pipes. The process uses the candidate's normal user and
desktop audio permissions; the existing privileged network helper never runs
media code. Do not open a localhost listener or add network exceptions.
GStreamer's `webrtcbin` on this host exposes `ice-transport-policy=relay`.

The sidecar owns one bounded session, up to four peer `webrtcbin` connections,
native microphone capture, Opus encode/decode, and native playback. The browser
cannot pass its proctor-owned `MediaStreamTrack` into GStreamer. Open a separate
audio-only device source (first test the desktop's PulseAudio/PipeWire path),
and ensure voice mute/stop never changes the proctor's stream. Confirm concurrent
capture and speaker behavior on the supported desktop matrix. Output selection
must be disabled or implemented against native devices; browser `setSinkId` is
not a sidecar control.

## Parent and wire contract

Keep the existing frontend's authenticated WebSocket, room projection,
credential refresh, terminal close behavior, and bounded signaling queue.
Introduce a media transport seam in
[`team-voice-engine.ts`](../apps/web/src/lib/team-voice-engine.ts) for browser
RTCPeerConnection on Windows and native peer operations on Linux. Select the
native path only after a Tauri capability command reports a healthy bundled
sidecar. A missing sidecar, missing factories, or failed media startup must
continue to display unavailable before acquiring the voice microphone.

Register narrow Linux-only commands in
[`lib.rs`](../apps/desktop/src-tauri/src/lib.rs), with a dedicated parent module
for the sidecar lifecycle. The commands accept a session handle/generation,
peer ID, bounded SDP or ICE, TURN settings, mute, volume, and stop. Validate the
calling main WebView and trusted app/development origin in the parent. The
sidecar has **no participant bearer token**, HTTP client, or API WebSocket;
the parent forwards only validated voice inputs. Use length-prefixed or bounded
newline JSON frames on the private pipes, with a maximum frame size, version,
request ID, and typed operation. Keep stdout protocol-only. Never log SDP,
ICE, TURN usernames/passwords, or participant tokens.

Preserve the current limits: at most four peers, 48,000 SDP bytes, 96 ICE
candidates per direction per peer across the entire peer lifetime (24 initial
plus three restart allowances), 4,096 candidate bytes, 16 descriptions per
peer without a restart reset, 128 queued signaling messages, and finite
retry/deadline behavior. The
parent and sidecar should both enforce peer/session bounds and reject stale
generations. Require one audio m-line with Opus and `sendrecv`; reject data/video
and malformed descriptions. Set relay-only ICE in each native peer and accept
TURN destinations only through the existing reviewed relay IP allowlist.
Credential expiry closes native sessions; credentials or ICE must never add
firewall destinations. Stop the sidecar on sign-out, contest end, page exit,
WebView destruction, process shutdown, or crash recovery. On sidecar EOF or
timeout, close pipes, kill/reap the child, and report unavailable.

## Packaging and proof

The separate Rust workspace needs Linux GStreamer development libraries in
builders and the corresponding runtime libraries/plugins in DEB, RPM, and
AppImage. Update `prepare:helper`, release and CI build steps,
`tauri.conf.json` sidecar packaging, artifact inspection, and clean-install
checks. Verify the bundled binary resolves every library on clean target
systems. Current plugin-file and synthetic Opus/RTP checks cover prerequisites
only.

Run `python3 scripts/check-linux-native-rtc.py` on a Linux builder with
PyGObject and Gst/GstWebRTC/GstSdp introspection. It uses two local synthetic
audio peers, relay-only ICE with no TURN credentials or candidate exchange,
and checks one `sendrecv` Opus m-line in both offer and answer plus stable
signaling. It returns both pipelines to NULL and has a 15-second outer deadline.
On the inspected host (GStreamer 1.28.9), it passed. This proves native SDP
negotiation independently of WebKit; it does not test the Rust sidecar,
microphone, speaker, ICE, TURN, DTLS, network lockdown, or packaged artifacts.

Release acceptance still requires an actual packaged Linux-to-peer call with
two participants: muted join and unmute, both-way audio, four-peer upper bound,
relay-only ICE through the reviewed TURN destination under active lockdown,
credential renewal/expiry, output and input device failure, sign-out and
terminal replacement, process crash cleanup, and DEB/RPM/AppImage checks on
clean supported desktops. At 3,000 participants, retain the existing bounded
polling and signaling limits and verify server/TURN load in staging; local
client tests cannot establish that capacity.

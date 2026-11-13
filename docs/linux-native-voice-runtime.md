# Linux native team voice

Linux team voice uses the bundled `ams-linux-voice-worker` process instead of
WebKit's `RTCPeerConnection`. WebKitGTK 2.54 disables that browser feature during
its backend transition. Windows continues to use WebView2's browser WebRTC path.
The two paths share the existing authenticated team WebSocket and room lifecycle.

## Build and run

`pnpm --filter @ams/desktop prepare:helper` builds the native worker from
`packages/linux-voice-worker/Cargo.lock` and stages it at
`apps/desktop/src-tauri/helpers/ams-linux-voice-worker`. The existing desktop dev
and bundle commands call this preparation step. Linux builders need GStreamer
core, base and bad-plugin development libraries, plus the runtime WebRTC,
libnice, Opus, DTLS/SRTP and PulseAudio plugins. No privileged helper runs media.
DEB/RPM dependencies and AppImage media bundling cover the installed runtime;
CI validates the package contents and clean-install dependencies.

The worker has a separate Cargo workspace because current GStreamer bindings
use GLib 0.22 while the Tauri GTK stack uses GLib 0.18. Its executable is a
Linux-only Tauri resource; Windows and macOS do not build or launch it. Debug
builds use the staged helper; release builds resolve the packaged resource.
No binary is committed to source control.

The app probes the actual worker before enabling Linux voice. Missing resources
or media plugins fail closed. The worker owns one microphone capture, starts
muted, and never changes the proctor camera/audio stream. Output uses the system
PulseAudio/PipeWire default device. Member/master volume and mute controls work
through native commands; browser speaker selection and browser input metering
are not exposed for the native path. Real microphone, speaker and acoustic
behavior still require device acceptance.

## Boundaries and cleanup

- Only the trusted main app WebView can call the bridge. The worker is launched
  at a fixed resource path with private stdin/stdout pipes, never a shell or
  localhost listener. Participant bearer tokens stay in the frontend.
- IPC frames are bounded to 64 KiB; the frontend allows at most 32 pending
  commands, and the parent serializes worker requests. Worker operations have
  bounded deadlines. SDP promises time out after five seconds; the parent
  watchdog kills/reaps a worker after an eight-second request deadline.
- Each session permits at most four peers. SDP is audio-only with Opus, at most
  48,000 bytes and 16 descriptions per peer. ICE candidates are at most 4,096
  bytes and 96 per direction across a peer lifetime. Restarts do not refill
  those budgets. Sender Opus bitrate is 32 kbps per peer.
- Production peers use relay-only ICE. Reviewed TURN destinations are
  `turn.amsaccess.com` and `43.204.79.244`; ports 3478/5349 and TLS-only 443 are
  allowed. Incoming candidates, including SDP-embedded candidates, must name
  the reviewed relay IP. STUN-only entries are omitted from native requests;
  this does not enable direct peer traffic. TCP URL transport is preserved.
- Credential expiry tears down peers. TURN server additions are capped at three
  refreshes per peer to prevent native server-list growth. With the API's
  default four-hour TTL, this covers the planned three-hour event; longer
  sessions or a shorter configured TTL require rejoining after the cap.
- Sign-out, voice closure, intentional leave and teardown stop native capture.
  Main-page reload stops it natively. A five-second **local IPC** keepalive
  renews a 15-second monotonic lease; renderer loss cannot leave capture running
  indefinitely. No HTTP/WebSocket polling was added for this lease.
- App/window destruction and process shutdown kill/reap the worker. Unexpected
  EOF, deadline failure and fatal worker errors notify the UI; intentional stop
  suppresses the failure notice. Stale session and peer work cannot resurrect
  replaced media.

## Verification

Run from the repository root:

```sh
cargo test --manifest-path packages/linux-voice-worker/Cargo.toml --locked
cargo clippy --manifest-path packages/linux-voice-worker/Cargo.toml --all-targets --locked -- -D warnings
cargo run --manifest-path packages/linux-voice-worker/Cargo.toml --locked -- --self-test
cargo test -p ams-access linux_voice:: --lib
node --test apps/web/src/lib/team-voice-native.test.mjs apps/web/src/lib/team-voice-engine.test.mjs
```

The worker self-test uses the production peer/description/media paths with
synthetic sources, dummy sinks and local ICE. It requires local UDP sockets;
a sandbox that forbids them cannot run this test. It proves decoded audio in
both directions, without using a microphone, speaker, TURN credential or
external server. Synthetic transport is selectable only by the dedicated
`--self-test` CLI, not by the app's IPC protocol. Handler tests include browser
Opus payload 111, multiline SDP, rejected malformed payloads and TLS 443.

Before release, test the actual packaged Linux artifact with a Windows client
on different home networks under contest lockdown: relay-only bidirectional
speech, muted join, Ctrl+Shift+M with editor focus, volume, microphone/device
failure, network recovery, expiry, logout and camera continuity. Run the clean
Ubuntu/Fedora/AppImage package gates. Synthetic local audio, mocked browser
calls and compilation do not certify those native acceptance results.

The change introduces no additional production API polling or team broadcast.
Existing bounded signaling and four-peer mesh limits remain. The local tests
are not a 3,000-participant capacity claim; server/TURN burst measurements are a
separate staging gate.

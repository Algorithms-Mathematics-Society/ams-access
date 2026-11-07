# Windows media-origin verification

The Windows WebView2 camera/microphone callback grants requests only from
`http://tauri.localhost` (the current window's default HTTP custom scheme), plus
the exact configured `build.devUrl` origin in debug builds. HTTPS is a different
origin and is not implicitly trusted. Explicit default HTTP port 80 is the same
origin. Request paths do not affect this decision. Release builds cannot grant
the development origin. Any future `useHttpsScheme` change must update this
policy deliberately.

The callback checks the requesting frame's `PermissionRequested` URI, denies
media before reading it, and grants only after successful URI retrieval, UTF-16
decoding and policy validation. The COM URI allocation is freed on both success
and failure. Other permission kinds and other platforms retain existing behavior.
This does not authorize navigation, additional frames or network destinations.

## Automated evidence

The actual `windows_media_origin.rs` policy tests pass in debug and release in a
Linux harness using the same `url` parser exposed by `tauri::Url`: bundled origin,
route/default-port equivalence, development origin, wrong scheme/host/port,
credentials, suffix spoofing, encoded authority and malformed URI rejection.
These pure tests do not execute the Windows callback or certify native behavior.
Windows-target compilation and native verification remain separate gates.

## Required native Windows checks

On a Windows machine with WebView2, record app version, Windows version,
WebView2 version, device model and debug/release mode for each result:

1. In an installed release, open the bundled camera onboarding stage and enable
   the microphone stage. Confirm live streams work when Windows privacy allows
   the app; stop/restart each stream to check recovery.
2. Disable camera and microphone access in Windows privacy settings separately.
   Confirm each stage reports denial and cannot obtain a stream. Re-enable the
   setting, retry the stage and confirm recovery without reinstalling the app.
3. In a controlled native callback test, request media from a remote origin,
   suffix-spoofed host, credentialed URL, alternate port and HTTPS bundled host.
   Confirm DENY. Include an untrusted frame request and verify the requesting
   frame URI is evaluated independently of the trusted top-level page. Do not
   loosen production CSP, navigation or frame policy to run these checks.
4. Simulate URI getter HRESULT failure, null URI and invalid UTF-16 in a native
   callback test. Confirm DENY remains set, no allocation leaks and no crash.
5. In debug, confirm only the configured development origin works. In release,
   confirm that same development origin is denied.

No native Windows run is claimed by the Linux policy test results. This local
permission decision adds no requests, retries, polling or backend/judge load at
3,000 concurrent participants; it creates no new capacity gate.

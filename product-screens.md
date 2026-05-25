# AMS Access Product Screens

This document defines what should exist on the main user-facing screens of the AMS Access desktop shell. The guiding principle is simple: the app should help a contestant understand whether their machine, identity, permissions, and session are ready for a locked exam.

---

## Home Screen

The home screen is the contestant's pre-session dashboard. It should be calm, clear, and action-oriented.

### Primary Goals

- Show the contestant whether they are signed in and ready.
- Show contests/sessions they can join.
- Surface machine readiness before they enter lockdown.
- Provide fast access to settings, diagnostics, and sign out.

### Must Have

- Signed-in user identity
  - Name or email.
  - Organization, if available.
  - Role/status such as contestant, invited, or registered.

- Available sessions / contests
  - Upcoming contests.
  - Live contests.
  - Past or completed contests.
  - Contest title.
  - Organization name.
  - Start and end time.
  - Session status: `Not started`, `Open`, `Live`, `Ended`, `Locked`.
  - Eligibility status: `Invited`, `Registered`, `Needs approval`, `Unavailable`.

- Primary session actions
  - Join session.
  - Resume active session.
  - Enter invite/session code.
  - Refresh sessions.

- Readiness summary
  - Camera status.
  - Microphone status.
  - Network status.
  - Restricted apps status.
  - Keyboard lockdown availability.
  - Platform support status.
  - VM/security status.

- Active warning area
  - Camera unavailable.
  - Microphone unavailable.
  - Restricted app detected.
  - Unsupported OS/display server.
  - Network unstable.
  - App update required.

- Navigation
  - Home.
  - Settings.
  - Diagnostics.
  - Sign out.

### Should Have

- Session countdown
  - Time until next contest starts.
  - Time remaining if contest is already live.

- Last readiness check
  - Timestamp of last device/security scan.
  - Button to run checks again.

- App/system summary
  - App version.
  - OS name and architecture.
  - Online/offline state.

- Contest detail preview
  - Duration.
  - Number of questions/problems.
  - Rules summary.
  - Proctoring requirement summary.

### Nice To Have

- Download/export diagnostic report.
- Contact support link or support code.
- Maintenance or system status notice.
- Update prompt when a newer signed release is available.

---

## Join Session Flow

The join flow should validate the contestant before starting the heavy lockdown sequence.

### Must Have

- Session code input
  - Manual invite/session code entry.
  - Paste support.
  - Clear validation errors.

- Session validation
  - Check that the code exists.
  - Check that the user is invited/registered.
  - Check contest timing.
  - Check whether the session was already started elsewhere.

- Session preview
  - Contest title.
  - Organization.
  - Start/end time.
  - Duration.
  - Proctoring requirements.
  - Lockdown requirements.

- Entry decision
  - Continue to readiness checks.
  - Resume existing session.
  - Cancel/back to home.

### Should Have

- Explain why joining is blocked
  - Contest has not started.
  - Contest has ended.
  - User is not invited.
  - Session already active on another device.
  - App version is too old.

- Persist last entered code locally for convenience, unless security policy forbids it.

---

## Settings Screen

Settings should be a pre-exam control room, not a generic preference dump.

### Primary Goals

- Let the user test hardware before entering a session.
- Show permission and platform readiness.
- Expose account/session controls.
- Provide diagnostics for support.

### Must Have

- Account section
  - Signed-in email/name.
  - Organization.
  - Sign out.
  - Refresh auth/session.

- Device section
  - Camera test entry.
  - Microphone test entry.
  - Speaker/audio output test.
  - Camera device picker.
  - Microphone device picker.

- Permissions section
  - Camera permission status.
  - Microphone permission status.
  - Notification permission status, if used.
  - Recheck permissions.

- Security readiness section
  - Restricted apps scan.
  - VM detection.
  - Display/monitor check.
  - Keyboard lockdown check.
  - Network lockdown availability.
  - Environment checks such as display server, ptrace scope, and injection status on Linux.

- Network section
  - API reachability.
  - CDN/model asset reachability.
  - Latency.
  - Jitter.
  - Connection quality label.

- Diagnostics section
  - App version.
  - Build/channel.
  - OS and architecture.
  - Tauri/webview version if available.
  - Export diagnostic report.
  - Copy support summary.

- Recovery section
  - Restore keyboard shortcuts.
  - Unlock desktop if a previous session crashed.
  - Clear temporary face calibration data.

### Should Have

- Accessibility section
  - Reduced motion.
  - Larger text option.
  - Accommodation mode status, if backend-approved.

- Update section
  - Check for updates.
  - Current version.
  - Update required notice.

- Privacy/data section
  - What is captured during proctored sessions.
  - Local temporary data location.
  - Clear local temporary data.

### Nice To Have

- Theme option, limited to dark/default and high-contrast.
- Keyboard shortcut reference.
- Local logs viewer.

---

## Camera Test

The camera test should confirm that the app can open the camera and that the contestant is visible enough for onboarding.

### Must Have

- Live camera preview.
- Camera permission request/status.
- Camera device selector.
- Retry camera access.
- Clear error states:
  - Permission denied.
  - No camera found.
  - Camera busy/in use.
  - Camera opened but no frames received.
  - Unsupported webview/media backend.

- Basic quality checks
  - Frame stream active.
  - Minimum resolution.
  - Brightness estimate.
  - Face present.
  - Face centered.

- Success state
  - Camera ready.
  - Selected device name.
  - Last checked timestamp.

### Should Have

- Face alignment overlay.
- Lighting guidance.
- Button to capture a test frame.
- Save only temporary local test frame, if needed.
- Stop camera stream when leaving the test.

### Nice To Have

- Blur/background detection warning.
- Multiple faces detected warning.
- Camera FPS estimate.

---

## Microphone Test

The microphone test should verify that the app can access audio input and detect a usable signal.

### Must Have

- Microphone permission request/status.
- Microphone device selector.
- Live input level meter.
- Retry microphone access.
- Clear error states:
  - Permission denied.
  - No microphone found.
  - Microphone busy/in use.
  - No audio signal detected.

- Basic quality checks
  - Input stream active.
  - Noise floor.
  - Voice/signal detected.
  - Clipping warning.

- Success state
  - Microphone ready.
  - Selected device name.
  - Last checked timestamp.

### Should Have

- Short guided test: "Speak for 3 seconds."
- Ambient noise warning.
- Muted input detection.
- Stop microphone stream when leaving the test.

### Nice To Have

- Audio device troubleshooting hints.
- Optional playback of recorded sample, if privacy policy allows.

---

## Speaker / Audio Output Test

This is lower priority than camera and microphone, but useful for announcements or future assessment media.

### Must Have

- Play test sound.
- User confirmation: heard / did not hear.
- Output error handling.

### Should Have

- Volume warning if system output appears muted, when detectable.
- Browser/webview autoplay-safe interaction design.

---

## Network Test

The network test should tell the contestant whether they can reliably reach required AMS services.

### Must Have

- API reachability check.
- CDN/model asset reachability check.
- Latency measurement.
- Jitter measurement.
- Quality label: `Excellent`, `Good`, `Fair`, `Poor`, `Unreachable`.
- Retry button.

### Should Have

- Show exact host checks.
- Warn if VPN/proxy is detected, when available.
- Explain if network lockdown cannot be enabled.

---

## Security Readiness Test

This test should mirror the onboarding security stages without forcing the user into lockdown yet.

### Must Have

- Restricted app scan.
- VM/virtualization check.
- Multi-monitor check.
- Display server check.
- Keyboard lockdown availability check.
- Firewall/network lockdown capability check.
- Local environment check:
  - Linux `LD_PRELOAD`.
  - Linux ptrace scope.
  - Linux desktop/session type.

### Should Have

- List restricted apps by friendly name.
- Button to rescan after closing apps.
- Show whether each check is blocking or warning-only.

---

## Diagnostics Report

Diagnostics should help support debug issues without exposing unnecessary personal data.

### Must Have

- App version.
- OS, architecture, desktop/session type.
- Webview/media capability summary.
- Camera permission/result summary.
- Microphone permission/result summary.
- Network test summary.
- Security readiness summary.
- Recent local errors.

### Should Have

- Export as JSON.
- Copy support summary.
- Redact tokens, emails where appropriate, and secrets.

---

## Suggested Implementation Priority

1. Home session list and join/resume actions.
2. Camera test.
3. Microphone test.
4. Network test.
5. Restricted apps/security readiness summary.
6. Settings page with device, permissions, account, and diagnostics sections.
7. Diagnostics export.
8. Recovery tools.
9. Updates and integrity checks.
10. Accessibility/accommodation controls.

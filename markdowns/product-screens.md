# AMS Access Contestant Hub Requirements

This document defines the functional user-facing requirements for the Contestant Hub in the AMS Access desktop shell.

These blocks may appear across Home, Settings, Diagnostics, and Security Logs. Each block must expose a real user action, real status, or clear blocked reason; avoid decorative panels that do not affect the contestant's next step.

---

## 1. Signed-in Identity

Shows who is using the client and which organization context applies.

- **Name/Email**: Verified contestant account email, such as `candidate@institution.edu`.
- **Organization**: Hosting or sponsoring organization when available.
- **Role/Status**: Contestant state, such as `Contestant`, `Registered`, or `Needs Approval`.

---

## 2. Available Sessions

Lists contests available to the signed-in contestant.

- **Upcoming Contests**: Sessions scheduled for the future with countdowns.
- **Live Contests**: Active sessions that can be joined when eligibility and readiness pass.
- **Completed Contests**: Ended sessions, locked or available for review depending on backend policy.
- **Contest Title**: Clear contest name.
- **Start/End Time**: Local time display with duration.
- **Eligibility Status**: Invited, registered, needs approval, or blocked.

---

## 3. Session Actions

Actions that move the contestant into or back into a session.

- **Join Session**: Starts the secure 15-stage onboarding sequence for live contests.
- **Resume Active Session**: Recovers a previously interrupted or ongoing contest.
- **Enter Session/Invite Code**: Manual session registration for private or ad-hoc events.
- **Refresh Sessions**: Fetches the latest invited sessions from the API and reports failures.

---

## 4. Readiness Status

Summarizes whether the device can safely enter a locked session.

- **Camera**: Permission and video device availability.
- **Microphone**: Permission and audio input availability.
- **Network**: Reachability, latency, and jitter.
- **Restricted Apps**: Background process scan for blocked apps such as OBS, Discord, and remote access tools.
- **Keyboard Lockdown**: Platform capability for system hotkey control.
- **Platform Support**: Supported OS and display/session environment.
- **VM/Security Check**: Hypervisor, injection, and local security checks.

---

## 5. Blocking Warnings

Highly visible warning states displayed in the readiness summary area if any check fails.

- **Camera Unavailable**: Prompt when no video frames are received or access is denied.
- **Mic Unavailable**: Alert if no audio input device is detected or permission is blocked.
- **Restricted App Detected**: Lists conflicting active processes that MUST be closed.
- **Unsupported OS**: Alerts if operating outside of supported Linux/Windows environments.
- **Network Unstable**: Flags high latency, high jitter, or host packet drop.
- **App Update Required**: Triggered when a new secure client update is mandated.
- **Session Not Open Yet**: Block indicator if attempting to enter a scheduled event before the start time.
- **User Not Invited/Approved**: Status blocking join action due to missing credentials.

---

## 6. Pre-Session Checklist

Manual controls to rerun checks and repair readiness issues.

- **Run Readiness Checks**: Explicit trigger to run all 7 telemetry scans.
- **View Failed Checks**: Expands warning elements to view details about failing blocks.
- **Fix/Retry Failed Checks**: Triggers selective process scans and media permission requests.
- **Last Check Timestamp**: Local time of the last scan.

---

## 7. Contest Preview

Session metadata shown before locked entry.

- **Contest Name**: Formal title of the chosen session.
- **Organization**: Sponsoring institution title.
- **Duration**: Total permitted time limit (e.g. `90 Minutes`).
- **Rules Summary**: Outline of acceptable candidate behavior.
- **Proctoring Requirements**: Specifies active monitoring types, such as video, microphone, or screen checks.
- **Lockdown Requirements**: Lists system limits (hotkey lock, single monitor check, process scanner).

---

## 8. During Contest Access

Controls for entry, resume, and crash recovery.

- **Continue to Onboarding**: Triggers the fullscreen transition and media permission gates.
- **Resume Contest**: Bypasses complete onboarding to return directly to an active contest.
- **Return after Crash/Reconnect**: Restores the local session ID and returns to the contest workspace after backend validation.

---

## 9. Support/Diagnostics

Support data for troubleshooting local setup issues.

- **App Version**: Current client release, such as `0.1.0`.
- **OS/Device Summary**: Architecture and display platform identifier, such as `x86_64-linux (wayland)`.
- **Network Status**: Shows exact host ping latency, RTT times, and jitter.
- **Export Diagnostic Report**: Exports system, network, and error records in redacted JSON format.
- **Copy Support Code**: Generates a temporary diagnostic identifier if backend support-code generation exists.

---

## 10. Account Controls

- **Refresh Session**: Re-authenticates JWT and fetches invited sessions.
- **Sign Out**: Purges local storage tokens and returns to the lock screen.

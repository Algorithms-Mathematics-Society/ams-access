# Windows checks for Shubh: issues 173–176

Use the intended release artifact after the code changes have been merged and
CI has passed. Record its exact version, commit, filename and SHA-256. Repeat on
every supported Windows build, install route, network and scaling row. This is a
test plan, not a claim that the device tests have run.

## #173: delivery, upgrade and installed version

1. Download the organizer-approved artifact from the official release on campus
   Wi-Fi, then mobile hotspot. Record size, elapsed time, failures and checksum.
   Verify an approved fallback copy against the same manifest. Both copies must
   identify the same intended artifact; a shared chat filename is insufficient.
2. On a disposable Windows profile, install as a candidate would. Record actual
   SmartScreen/UAC and WebView2 prerequisites. A per-machine installer may ask for
   administrator approval; an ordinary default app launch should not.
3. Upgrade from the last distributed version with synthetic saved drafts and
   preferences. Launch every existing shortcut. Settings must report the intended
   installed version, and the saved state must survive.
4. Uninstall/reinstall in the disposable profile. Check installed-app entries,
   shortcuts and helper/process state for duplicate or stale installations.
5. Compare the app's update notice, official download page and contest release
   policy. No untested last-minute version change should be needed to start.

Attach timings, integrity record, redacted installer logs and Settings screenshot.

## #174: lockdown and cleanup

Use the intended standard/supervised build and its actual contest policy. Default
Windows builds leave OS firewall lockdown off; do not label that intentional
policy a failed privileged helper. If the supervised/elevated path is supported,
test it separately and record which build/policy was used.

1. Capture baseline keyboard, Task Manager/desktop policy, networking and owned
   firewall/process state. Deny the privilege prompt on the applicable path,
   verify a legible failure, then retry successfully.
2. Enter a synthetic contest. Check required restrictions and prove AMS API,
   draft saving, heartbeat and submission traffic remain permitted.
3. In separate runs, fail setup partway through, cancel setup, sign out, exit
   normally and terminate the app forcibly. Verify baseline desktop/input/network
   restoration after each. Forced termination may need relaunch recovery; record
   that behavior rather than assuming cleanup can run after process death.
4. Relaunch after interrupted cleanup. Recovery must say when restoration is
   incomplete; retry must finish it, and repeated recovery must be harmless.
5. Race Exit/Restore with pending entry. A late entry response must not reapply
   restrictions after the candidate has left.

Attach before/during/after native state and redacted logs, plus any failed row.

## #175: exit, reconnect, keyboard and scaling

For each row below, test the visible exit action and documented keyboard exit.
Repeat with the API unreachable. Restoration must not wait for a login or upload.

| Screen state | Required outcome |
| --- | --- |
| Sign-in and Home | Predictable way out; ordinary desktop/input usable. |
| Setup and failed entry | Exit/cancel restores any acquired controls. |
| Approval waiting | Exit remains reachable; late approval cannot relock. |
| Reconnect overlay | Exit remains reachable while the server is unavailable. |
| Running contest | Intentional shortcut restrictions retain a documented safe exit. |

At small viewport and high scaling, use only the keyboard to select a long SSID,
enter its password, Join, Retry and exit. Nothing may clip outside the reconnect
dialog, lose focus behind it or steal exam focus. After exit, type normal text and
exercise pointer, Alt+Tab, Windows-key shortcuts and desktop interaction. In
particular, a released Windows key must not leave ordinary letters acting as
Windows-key chords.

Attach the screen-state/exit matrix, scaling screenshots and restored-input video.

## #176: login, reissue and delivery

Use synthetic accounts only. The server/portal changes require a separate staged
rollout: portal request IDs first, then API migration `f4b091c2e673` and API code.
See `ams-api/docs/credential-reissue.md`. Existing portal tabs must reload after
rollout. Do not run destructive database tests against production.

1. Sign in with the bare ID, full `@access` handle, full
   `@access.amsaccess.com` handle, capitals and surrounding whitespace. These must
   resolve to the same intended account. A 64-character ID with suffix must paste
   fully. Internal spaces, punctuation, unknown domains and overlong IDs must not
   silently turn into another valid ID. Use intentionally different synthetic
   accounts to verify this.
2. Test a genuinely wrong password, an old password after reissue, a revoked
   account, network loss and server overload. Credential errors must remain
   distinct from connectivity/busy feedback, without automatic login storms.
3. Reissue once. The old password must fail; the new one must work. Reissue keeps
   existing signed sessions and assessment work, matching the existing policy.
   Check that policy explicitly on staging.
4. Interrupt a reissue response, then retry with the same request ID. If the first
   request committed, expect 409 explaining it already completed, with no second
   rotation and no password replay. Only a later explicit new request should
   rotate again. Repeat with simultaneous duplicate requests and with an older
   request ID replayed after a newer reissue.
5. Verify accepted registrations against issuance and mail-delivery records.
   Simulate delayed/bounced mail on staging. Exercise the identity-verified
   printed-slip fallback, with one authoritative instruction and a clear support
   path for anyone missing credentials.

Never attach real passwords, tokens or unredacted credential dialogs. An
independent reviewer should sign off the complete matrix before these acceptance
issues are marked verified.

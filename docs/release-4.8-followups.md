# Final v4.8.0 follow-ups

## Implemented

- #277: remove active-toolbar Leave and Contest info; remove ServiceStatus from login, help, Home, setup, gate and contest, including its polling reader. Keep Help, Finish review, reference, local connectivity and recovery exits.
- #265: the Home advisory list uses the same report population as the summary, naming every non-passing check and showing details or an unverified fallback.
- #245: use reqwest 0.13's default rustls-platform-verifier rather than two exclusive ISRG roots. Certificate and hostname validation remain enabled. A CA trusted by the OS (including an administrator-installed campus CA) is now trusted by native uploads, as it already was by webview requests. There is no accept-invalid retry.
- #244: remove speculative device-mismatch/idle-timeout branches. Existing API eligibility, finish, approval and resume enforcement remains authoritative. No idle timeout or new binding rule is introduced.
- #242: create/reuse the pending session and finish native readiness before waiting. At T=0, navigate once without another entry write/scan. The room's authenticated server check still withholds the paper if postponed, ended or no longer eligible. Unexpected navigation away while waiting releases prepared controls. A late entrant runs normal preparation immediately, with no artificial delay.

## Validation and scale

135 web test files, TypeScript and 14 native source-safety tests pass locally. Entry tests execute the actual finalization callback, cover timeout/late completion cleanup, and simulate 3,000 prepared candidates with zero repeated session/readiness calls at T=0. This does not eliminate the room's question/session reads or prove backend capacity. Native CI and packaged acceptance remain required. Local production build is blocked fetching the MediaPipe asset because this sandbox cannot resolve storage.googleapis.com.

Removing status UI removes its endpoint polling entirely. Entry preparation adds no timer/polling or retry loop. Clipboard, approval and manual-retry bounds from the preceding combined commit remain in effect.

The deployed API must include the existing `get_session` / `reconcile_pending` path
that promotes an eligible pending session at the server start time. This is already
implemented in ams-api; verify the deployed revision before release. The client
no longer compensates for an old API by reopening every session at the bell.

## GUI and staging checks

- [ ] #277: at laptop size and 150%/200% scaling, use keyboard-only Help, reference and Finish review (Back/Finish). No Leave or Contest info in the active toolbar; no service-status banners/dialogs on any screen. Disconnect: Check Again/Exit Contest still work; drafts survive exit/resume. Contest announcements still arrive.
- [ ] #265: produce advisory display, remote sharing, clock and unavailable-microphone results. Each counted warning names the check and describes the problem; rerun checks and confirm stale rows disappear. Blocking checks remain blocking.
- [ ] #245: on Mac and Windows, verify a native readiness report and proctor event actually arrive at the API, not merely that web login works. Test a normal valid chain and a different OS-trusted CA in staging; reject expired, wrong-host and untrusted self-signed chains. Record the production chain before an event (`openssl s_client -connect api.amsaccess.com:443 -servername api.amsaccess.com -verify_hostname api.amsaccess.com -verify_return_error`). Never disable validation to recover connectivity.
- [ ] #244: valid session, unauthorized participant, finished attempt and approved/rejected resume all show the API's actual outcome. Long offline periods must not invent a client-side idle lockout.
- [ ] #242: finish setup early; verify session/readiness appear before the bell and the screen waits. At T=0 enter once with no extra create/readiness POST. Check late entry, failed-preparation Retry, Exit while waiting, cancellation, postponed start and removed eligibility. The last two must expose no questions. The server clock remains authoritative.
- [ ] Run an approved staging hall of 3,000 clients and compare writes before/at T=0, read QPS, API/database latency and errors. No live production rehearsal has been performed here.

Leave issues open until native GUI/staging evidence is attached. Do not publish the release until the exact source commit passes main CI and every platform release build/checksum check succeeds.

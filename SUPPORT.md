# Participant support chat

Implemented across the `feature/participant-support-chat` branches of `ams-access`,
`ams-api`, and `amsaccess`. The candidate app is a static export: persistence and
staff authorization live in the API, not a Next.js route in this repository.

## Flow

1. Use **Get help** on Login/Home or **Help** in the assessment.
2. Enter email, phone, name, and the issue. No participant login is required.
   An organization code is optional for a single-organization deployment and
   required to route a request when more than one organization exists.
3. The contact details and original query are stored atomically. The query appears
   as the first chat message. Staff see it under **Support** on the main dashboard.
4. Both sides can send plain-text messages. Open conversations poll every four
   seconds while visible, using bounded history pages. Staff can resolve/reopen.

A random 256-bit capability grants participant access to exactly one thread.
Only its SHA-256 hash is stored in the database. The client stores the capability
and pending send identifiers in session storage, never in URLs. A support
capability grants no account, contest, credential reset or timer authority.
Contact details are explicitly unverified. Staff use existing signed portal
sessions and organization participant-data roles; interns cannot access support.

The participant's session-storage receipt survives dialog closure, navigation
and reload in that window. It is removed by **Forget chat / new request**, or
when the browser/app window's storage session ends. This is not cross-device or
email-based recovery. Confirmed conversations remain on the server. If storage
is blocked, a warning explains that only the mounted in-memory access remains.
Support requests and messages retain their UUID when retrying an uncertain send.
The API rejects conflicting reuse and serializes sends and issue resolution.

During an assessment, chat uses the existing ordinary ContestOverlay, yields to
mandatory security/network/expiry overlays and preserves the editor and exam
clock. **Report a device incident with diagnostics** retains the previous
contest-scoped reporting workflow. New chat does not upload automatic device
telemetry or passwords.

## Deployment

Apply `ams-api` migration `f14d8c2a907b` and deploy its support endpoints before
releasing the matching admin portal and candidate app. No new environment
variables, realtime infrastructure or runtime dependencies are introduced.
Older server deployments return a visible failure; there is no false delivery
acknowledgement or fallback to a one-way incident.

The API bounds messages at 4000 characters, reads at 100 messages/page and inbox
pages at 50 issues. Creation is bounded at 100 requests/hour per observed source
address, and sending at 60 messages/minute per conversation. These database
limits are shared across workers. Deploy the public endpoint behind the existing
trusted ingress with request/body limits; forwarded headers from clients are
not trusted. A shared proxy/NAT may share the creation bound. Do not use the
support form as a source of verified identity.

## Validation

Candidate automated tests cover guest forms, capability isolation, safe retries,
receipt recovery, storage failures, pagination, resolved history and alternate
contest overlay hosting. Browser fixtures exercise narrow/desktop forms and
chat, lost acknowledgements, incoming replies, reopen and resolution. Admin
unit tests cover proxy authentication/path validation, per-thread draft recovery
and reply/history response validation. Browser fixtures cover inbox/reply/
resolution and narrow/desktop layouts. Fixtures do not prove API integration.

The candidate production static export, typecheck and size budgets pass. The
backend pure suite, lint and type checks pass; migration upgrade/downgrade/
upgrade was exercised against scratch PostgreSQL in single-user mode. Real
multi-connection API/database tests remain to run on a scratch Postgres because
this sandbox prohibits server sockets. The admin full build/typecheck requires
restoring the repository's already-declared missing CodeMirror dependencies.
Packaged desktop lockdown/focus acceptance remains a separate native check.

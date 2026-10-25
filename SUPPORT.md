# Participant support chat

Implemented across the `feature/participant-support-chat` branches of `ams-access`,
`ams-api`, and `amsaccess`. The candidate app is a static export: persistence and
staff authorization live in the API, not a Next.js route in this repository.

## Flow

1. Logged-out **Get help** asks for email, phone, name and the issue. It sends a
   one-way report to `POST /support/issues`, then shows confirmation. No
   organization code or conversation access is requested or returned.
2. Signed-in **Help** asks only for a message. The authenticated participant and
   contest supply contact and organization context to
   `POST /participant/support/conversations`.
3. Staff see both kinds of issue under **Support** on the main dashboard. Guest
   issues are contact-only: staff follow up by email or phone and cannot send
   an unreadable chat reply. Signed-in issues support plain-text conversation.
4. Signed-in conversations poll every four seconds while visible, using bounded
   history pages. Staff can resolve/reopen issues.

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
is blocked, access remains only in the mounted chat; navigating away, reloading
or closing it may lose access, as its warning explains.
Support requests and messages retain their UUID when retrying an uncertain send.
The API rejects conflicting reuse and serializes sends and issue resolution.
Late acknowledgements clear only their own saved operation, preserving newer
conversations and pending messages opened from another help surface. Resolved
threads keep unconfirmed messages visible for retry: committed messages can be
acknowledged; an uncommitted message requires staff to reopen the issue or a new
request.
Signing out or changing participant tokens clears signed-in conversation access.
Guest request drafts use separate storage and contain no chat capability.

During an assessment, chat uses the existing ordinary ContestOverlay, yields to
mandatory security/network/expiry overlays and preserves the editor and exam
clock. **Report a device incident with diagnostics** retains the previous
contest-scoped reporting workflow. New chat does not upload automatic device
telemetry or passwords.

## Deployment

Apply `ams-api` migrations through `3b4e8a2c1d90` and deploy its support endpoints
before releasing the matching admin portal and candidate app. The migration
adds `chat_enabled`, preserving existing conversations while marking new guest
issues as one-way. Private read/reply routes also enforce this flag.
For multi-organization deployments, set server-side `AMS_SUPPORT_ORGANIZATION_SLUG`
to the receiving inbox's existing organization slug (production SSM parameter:
`/ams/prod/support_organization_slug`). A sole organization is used automatically.
Ambiguous or invalid routing returns 503. Participants never enter this setting.
Older server deployments return a visible failure without false delivery confirmation.

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
backend pure suite, lint and support type checks pass. Real
API/database tests remain to run on a scratch Postgres because
this sandbox prohibits server sockets. The admin full build/typecheck requires
restoring the repository's already-declared missing CodeMirror dependencies.
Packaged desktop lockdown/focus acceptance remains a separate native check.

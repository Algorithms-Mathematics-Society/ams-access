# Windows retry request ownership: #179 and #182

Base: `26081ad`, the remote main observed during this work. Scope is client request
ownership; this is not a full Windows or concurrent-roster acceptance result.

## Fixed defects

Login checked only React's `loading` state. Multiple submit handlers could run
before a rerender and each send a login request. A synchronous ref now owns the
attempt before it starts. An error releases it for an explicit retry; success
retains it through navigation. The existing monotonic server-directed cooldown
still applies to button and keyboard submissions.

Home's organizer-approval creation had no request guard. Repeated callbacks could
each send the approval mutation while the first was pending. A synchronous guard
now permits one pending creation, releases in `finally`, and retains the existing
epoch/session check that suppresses a response arriving after sign-out.

## Regression and scale evidence

The actual page handlers execute in controlled test harnesses. Before the fixes,
an initial invocation followed by 1,000 invocations while its response was held
open produced 1,001 transport calls in each path. Both tests failed on that count.
After the fixes, each path produces one call. Explicit retry after a settled
failure is accepted, successful login cannot send another request before
navigation, and a stale approval response writes no session state and leaves no
stuck request lock.

All 104 web test files pass, including the new cases. Web TypeScript, formatting,
version consistency at 4.7.0, and `git diff --check` pass. No runtime dependencies,
timers, queues, automatic retries, native changes or server calls were added by
the guards. They use constant memory per mounted page. This synthetic burst
measures duplicate suppression, not server capacity, Windows input or an actual
1,000-candidate rehearsal. No production load was generated.

## Shubh's Windows verification

1. On the intended build, delay the login response in a staging fixture. Rapidly
   click Sign in and press Enter. Count one pending login POST, not one per event.
2. Return a network failure. An explicit retry must work. Return a real 503/429
   with supported Retry-After guidance; button and keyboard submissions must
   respect the existing cooldown. Successful login must navigate once.
3. Delay organizer-approval creation, then activate its action repeatedly. Count
   one pending creation POST and reconcile with one intended request on the API.
4. Fail that request, retry explicitly, and confirm the controls recover.
5. Sign out or leave Home before a pending approval completes. Its late response
   must not restore the previous participant/session, redirect, or leave a stuck
   request guard. Repeat with another synthetic participant.
6. Retain the broader #179 idle-resource/polling measurements and #182 approval,
   expiry and identity-isolation matrix. Attach build IDs, redacted request traces,
   counts and reviewer sign-off before closing those acceptance gates.

## Other reviewed report

#185's behaviour-check diagnostics already have an explicit rendering path in
current `ResultsPanel`: failed `kind: behavior` rows display `checker_message`
and stderr. The current worker emits exactly that kind. No duplicate UI rewrite
was made; verify this path with actual returned fixtures in the intended packaged
build. API/worker deployment order and other judging acceptance remain separate.

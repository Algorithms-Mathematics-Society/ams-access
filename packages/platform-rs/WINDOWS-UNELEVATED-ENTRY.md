# Windows contest entry without elevation

Ordinary Windows EXE builds support contest entry as the signed-in desktop user.
Readiness and native desktop activation are separate steps: passing readiness does
not waive a failure of required keyboard or full-screen protection.

## Registry controls

On a fresh unelevated entry, AMS Access does not attempt the registry policies
for Task Manager, Game DVR/Game Bar, or three-/four-finger touchpad gestures.
Windows can deny access to these policy keys even under HKCU. Their absence is
reported as `registry_lockdown_advisory`, with `registry_status` set to
`skipped_unelevated`; it is not silently described as full registry lockdown.
Keyboard interception, full-screen/always-on-top setup, and the other required
readiness checks continue to apply. This does not make Task Manager or capture
controls equivalent to an elevated session.

Elevated, unpackaged builds continue applying the existing crash-safe registry
transaction. MSIX builds continue skipping virtualized registry writes.
Firewall behavior is unchanged: the default build does not install firewall
rules, and optional firewall builds retain their separate advisory handling.

## Recovery is still required

Unelevated entry must first restore any existing app-owned registry journal.
Inaccessible/corrupt journals, restoration failures, or conflicting external
edits remain errors; original snapshots are neither deleted nor replaced to
allow entry. A previous elevated session may require an elevated recovery
attempt before returning to ordinary unelevated use.

## Verification boundaries

Regression tests use fake registry values and temporary journals, not host
registry policies or real keyboard lockdown. Qualify the rebuilt EXE on a
standard-user Windows account, including successful entry/exit, required-hook
failure, stale elevated journals, and restoration. The production frontend and
Rust code are embedded in the EXE, so an existing executable must be rebuilt.

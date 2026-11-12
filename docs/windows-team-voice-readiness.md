# Windows team voice readiness

The Windows integration is based on the team-lobby UI branch (PR #389). It
adapts the shared fixes from PR #385 without enabling macOS or changing native
Windows permissions, firewall configuration, or AWS resources.

## Included fixes

- Browser timer receiver fix is inherited from #389 (#386).
- Failed peer connections attempt ICE restart at most three times per failure
  sequence, spaced 15 seconds apart. A successful connection resets the retry
  count, but never replenishes the fixed lifetime signaling allowance (#333).
- Each peer admits at most 96 outgoing and 96 incoming ICE candidates over its
  lifetime (initial 24 plus allowance for three retries). The 16-description
  cap is not reset. A remote restart gets the same allowance as a local one.
  Exhaustion requires leaving/rejoining voice; it does not allocate another peer
  or silently fall back to direct transport. Four peers remain the maximum.
- Initial connection cannot be unmuted through the shortcut or toolbar (#367).
- Ctrl+Shift+M follows the typed letter, with non-ASCII layout fallback (#365).
- The media-toggle warning suspends voice interaction (#368).
- Join/Leave render from state when the voice window closes/reopens (#373).

## Scope and load

No new polls, microphone captures, or WebSocket sessions are introduced for peer
recovery. Relay-only policy, 32 kbps audio cap, 48 KB SDP cap, bounded outgoing
queue and existing signaling pacing remain. The larger lifetime ICE allowance
is bounded to 384 incoming and 384 outgoing candidates across four peers; it is
not a claim that a reconnect burst at 3,000 participants has passed staging.
Measure that burst alongside existing team polling before a large event.

## Required Windows acceptance (not yet executed)

Use the actual Windows installer on two devices on different home networks,
then repeat with four teammates. Record Windows/WebView2/app versions and whether
the normal or supervised installer is used. Keep the required contest security
policy enabled; do not disable lockdown to obtain a passing audio result.

1. Enter the published team contest and verify Join, initial muted state, and
   bidirectional speech after deliberately unmuting. Confirm relay candidates.
2. Check microphone denial/retry, speaker selection, camera/proctor continuity,
   and the mute shortcut with the editor focused.
3. Trigger the media-toggle warning: clicking voice controls or pressing the
   shortcut must not change mute state behind it.
4. Interrupt one network, restore it, and verify peer audio recovery without
   duplicate microphone capture or unbounded retries. Test terminal failure too.
5. Leave intentionally, close/reopen the voice window, then join explicitly.
   Confirm no stale disabled Join and no unexpected automatic microphone capture.
6. Exit/end the contest and verify media/signaling cleanup and security restoration.

Repository CI can check Windows compilation and packaging. Linux mocks and a
Chromium preview cannot certify native WebView2 permissions, real ICE/TURN audio,
or supervised firewall behavior. Retain #301 and #323 until those checks pass.

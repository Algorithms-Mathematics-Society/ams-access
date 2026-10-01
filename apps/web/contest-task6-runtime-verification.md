# Task 6 Camera Decouple — Runtime Verification (run on your dev machine)

The re-parent moved the **visible** camera tile out of the question rail to a fixed bottom-left
element. The one real risk is that the moved `<video ref={cameraVideoRef}>` fails to bind/keep the
stream — and **a dead feed looks identical to a live one in a still frame**. This script gives you
the live-vs-dead tell for each check, grounded in the actual code.

Visual (layout) checklist lives separately: `apps/web/contest-redesign-visual-checklist.md`
(Task 6 block). This doc is the CAMERA-INTEGRITY runtime gate.

---

## The one devtools helper (paste in Console; reuse for every check)

```js
// Returns the live state of the visible camera element.
window.cam = () => {
  const vids = document.querySelectorAll("video");
  const v = document.querySelector("video");
  const s = v && v.srcObject;
  const vt = s && s.getVideoTracks && s.getVideoTracks()[0];
  const at = s && s.getAudioTracks && s.getAudioTracks()[0];
  return {
    videoElements: vids.length, // MUST stay 1 (a 2nd = remount)
    hasStream: !!s,
    streamActive: s && s.active, // MUST be true
    readyState: v && v.readyState, // MUST be 4 (HAVE_ENOUGH_DATA) when on
    paused: v && v.paused, // MUST be false when on
    currentTime: v && +v.currentTime.toFixed(2), // MUST advance between calls when live
    videoTrackEnabled: vt && vt.enabled, // cam toggle flips this
    audioTrackEnabled: at ? at.enabled : "(no audio track)", // mic toggle flips this
  };
};
cam();
```

**The core live-vs-dead tell:** call `cam()`, wait ~2s, call `cam()` again.

- **LIVE** → `currentTime` has **increased**, `streamActive:true`, `readyState:4`, `paused:false`,
  `videoElements:1`.
- **DEAD/FROZEN** → `currentTime` **unchanged** across the 2s (a frozen frame can still be visible!),
  or `hasStream:false`, or `streamActive:false`, or `readyState:0`.

---

## Load steps — TWO modes

### Mode A · Browser dev — covers checks 1–4 (the re-parent integrity gate). No backend/token.

1. From repo root: `pnpm --filter @ams/web dev` → http://localhost:3000
2. Open **`http://localhost:3000/session/contest?contestId=mock-contest-dev`**
   (`mock-contest-dev` is a built-in offline contest — full chrome, 2 questions, NO backend, NO
   session, NO token. `lockGate` auto-passes in the browser.)
3. **Allow the camera** when prompted. The tile is presence-gated, so it appears once the stream
   exists (or a camera error occurs). Run `cam()` in the Console.

> Run/Submit are disabled in mock mode (no session) — expected; irrelevant to the camera gate.

### Mode B · Tauri desktop shell — needed only for check 5 (real proctoring events).

`pnpm --filter @ams/desktop dev`, go through onboarding into a contest. Proctoring emits through
the Rust bridge only in this shell (see check 5).

---

## The ordered checks (Mode A unless noted)

### 1. Feed renders LIVE at bottom-left (not a black/frozen box)

- **PASS:** a live self-view in the ~220px bottom-left tile. Confirm it's live, not a frozen frame:
  **wave your hand** — motion is real-time; the image is **mirrored** (move right → image moves
  right, `transform: scaleX(-1)`); your **camera hardware LED is on**. Then the devtools tell:
  `cam()` twice, 2s apart → **`currentTime` advanced**, `streamActive:true`, `readyState:4`,
  `videoElements:1`.
- **FAIL:** black box, or a static image whose `currentTime` **does not advance**, or
  `hasStream:false`/`streamActive:false`, or `videoElements` ≠ 1.

### 2. Mic toggle works (icon state + ACTUAL mute)

- Click the mic button in the tile.
- **PASS:** icon flips Mic ↔ MicOff (red when off). The actual-mute tell: `cam().audioTrackEnabled`
  is **`false`** when muted and **`true`** when on. (The button sets `audioTrack.enabled` — the icon
  alone is not proof; the track flag is.)
- **FAIL:** icon flips but `audioTrackEnabled` stays the same (mute not applied), or the console
  errors, or the whole feed drops.

> If `audioTrackEnabled` reads `(no audio track)`, mic capture wasn't requested this run — start with
> mic enabled or note it; the video-integrity checks are unaffected.

### 3. Cam toggle works

- Click the camera button.
- **PASS:** icon flips Video ↔ VideoOff; when off the **feed goes black/frozen** and
  `cam().videoTrackEnabled` is **`false`**; when back on it's `true` and the feed resumes live
  (`currentTime` advances again). Crucially, `videoElements` stays **1** and `hasStream` stays
  **true** through both toggles — the track is disabled, the stream is NOT torn down.
- **FAIL:** `hasStream:false` after toggling (stream destroyed), or a **new camera permission prompt**
  appears (re-acquire), or `videoElements` becomes 2, or the feed never resumes.

### 4. Collapse/expand the rail 5× — feed never blinks / re-acquires / goes black ← the headline gate

- Toggle the question-rail collapse chevron (top of the left rail) **five times**, watching the
  camera tile the whole time. Before you start, note `cam().currentTime`.
- **PASS:** the feed stays **continuously live** through every collapse/expand — no black flash, no
  flicker. The camera LED **never blinks off/on**. **No new permission prompt.** After the 5 cycles,
  `cam()` shows `videoElements:1`, `hasStream:true`, and `currentTime` has kept **advancing
  monotonically** (never reset toward 0). The tile stays a full 220px box in both rail states (the
  background panel behind it is what resizes, not the camera).
- **FAIL (this is the risk the whole task exists to kill):** any black flash on collapse; the LED
  blinking; a permission re-prompt; `currentTime` **resetting toward 0** (= stream re-acquired);
  `videoElements` momentarily 2 (= remount). If you see any of these, STOP — this blocks merge.

### 5. Proctoring events still emit (needs Mode B — Tauri shell)

Camera proctoring is **stream-based**: the presence sampler binds `cameraStream` to its **own
detached `<video>`** (not the visible tile — code comment: "sampling is independent of the camera
panel"), so the re-parent cannot structurally break it, and the code review confirmed the
presence/re-attach/status effects are byte-untouched. Emission goes through Tauri:
`log_proctoring_event` / `log_violation` via `window.__TAURI__.core.invoke(...)`.

- **In the Tauri desktop shell (Mode B):** the easiest event to force on demand is a **focus loss** —
  **alt-tab / click away from the window**. That fires `log_violation { kind: "focus_loss" }`
  immediately (no wait).
  - **PASS:** you see the event in the **terminal running `pnpm --filter @ams/desktop dev`** (the
    Rust bridge logs the `log_violation`/`log_proctoring_event` call), and/or the backend records it
    (`proctor_events` / Firestore + Cloud Logging, if your backend is wired). Presence samples
    (`log_proctoring_event`, kind = presence status) also fire on a 30–90s timer.
  - **FAIL:** no event logged on focus loss, or console/Rust errors from the presence/log effects.
- **In browser dev (Mode A):** `window.__TAURI__` is absent, so these invokes are **no-ops by design
  — you will NOT see proctoring events**, and that is expected, not a failure. To prove the _sampler_
  runs without the Tauri shell, temporarily add `console.log("presence tick", kind)` inside
  `logPresence` in `client.tsx` (the presence `useEffect`, ~line 2901), reload, and confirm it fires
  every 30–90s while the feed is live — then remove the line. (The reliable proxy is still checks 1–4:
  a live `cameraStream` is the same stream the sampler reads.)

---

## Verdict

- **Checks 1–4 all PASS** → the re-parent is sound; the camera pipeline survived. This is the
  merge-blocking gate and it's fully verifiable in Mode A (browser dev, mock contest).
- **Check 5** confirms proctoring emission end-to-end; run it in Mode B when convenient. By
  construction (stream-based sampler, effects untouched) it should pass if 1–4 do.
- Any FAIL in 1–4 → **blocks merge**; capture the `cam()` output at the failure and report it.

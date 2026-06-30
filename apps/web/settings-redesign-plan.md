# Settings Redesign (Phase 2a-pre) — Implementation Plan

> Subagent-driven, sequential. LAYOUT/restyle only over the EXISTING tabbed SettingsPanel. Tokenize = 2a.

**Goal:** Restyle `home/components/SettingsPanel.tsx` (an already-tabbed panel: hardware/permissions/security/about) to the "Settings v2" mockup — header + Run Full Diagnostic, underline tab bar, the Camera Validation Capture card, and the Audio/Speaker 2-up + theme placeholder — WITHOUT touching the camera/mic/speaker/security hardware logic.

**Mockup:** `/home/user/Downloads/Settings v2 — Dark.png` (PRIMARY; home renders dark). Light = `.light` in 2a, ignore mockup light colors.

## Global Constraints (bind every task)

1. RESTYLE-ONLY. Never modify state, effects, handlers, or hardware/permission logic — especially `startCameraTest` + the camera-release-race handling, `getUserMedia`, `toggleMicMonitor` + `AudioContext`, the speaker test-tone, `runSecurityScan`/`refreshTelemetry`, device enumeration, `onSecurityEvent`. Only JSX structure + styling.
2. Preserve the JS-prop theme system (`theme` prop / `getThemeColors` / the `theme === "light" ? … : …` ternaries + `setTheme`). No `@/lib/theme`, no CSS-class swap.
3. NO NEW hardcoded hex. Reuse the file's existing token/`theme`-derived colors; new surfaces use dark values consistent with the existing set (the file's many pre-existing `theme===` hexes are the 2a backlog — don't ADD). Match the DARK mockup.
4. Decisions: "Run Full Diagnostic" wires to an EXISTING action (`refreshTelemetry(true, "run-full-diagnostic")` or `runSecurityScan(true)` — pick the existing "re-run everything" one); theme bar = NON-WIRED placeholder; NO 4th nav (rail is shell-level, untouched here).
5. Build green: `pnpm --filter @ams/web build`. Explicit-path `git add src/app/home/components/SettingsPanel.tsx`.

### Task S1: Header + tab bar + Camera Validation Capture card

Restyle the "Settings" header with a top-right **Run Full Diagnostic** button (wired to the existing full-scan/refresh action — do NOT invent new orchestration). Restyle the tab bar to the mockup's underline-active tabs (the 4 labels already exist). Restyle the Hardware-tab **Camera Validation Capture** card: corner-bracket viewfinder ("CAPTURE DISCONNECTED" empty state) + `CAPTURE DEVICE` dropdown + `Initialize Capture Feed` (primary) / `Re-scan devices` + helper text. Keep all camera wiring (`startCameraTest`, device list, `cameraBusy`/`cameraError`, the release-race handling) byte-for-byte.
**Acceptance:** build green; camera test + device enumeration + Run-Full-Diagnostic action all fire existing handlers; tabs switch; no logic touched; matches mockup.

### Task S2: Audio + Speaker cards (2-up) + theme placeholder

Restyle "Audio Microphone Calibration" (Monitor Audio Feed + INPUT LEVEL meter + "REALTIME … dB · NOMINAL") and "Speaker Acoustic Output Test" (TEST TONE GAIN slider + Play / Clear Signal) into the mockup's side-by-side cards. Add the bottom **theme placeholder bar** ("THEME CHANGE TOGGLE OR SOMETHING") as a NON-WIRED placeholder (real toggle = 2a). Keep all mic/speaker wiring (`toggleMicMonitor`, `micLevel`, `speakerVolume`, Play test-tone) byte-for-byte.
**Acceptance:** build green; mic monitor + speaker test + gain slider still fire existing handlers; theme bar is a visual placeholder only; no logic touched; matches mockup.

## After both tasks

Controller dark-mode screenshot of /home → Settings tab vs mockup; restyle-only confirmation. Light + tokenize = 2a.

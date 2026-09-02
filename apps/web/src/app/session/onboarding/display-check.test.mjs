// What the display scan means for a candidate.
//
// The bug: `availableMonitors` is a module-level export of
// `@tauri-apps/api/window`, not a method on the object `getCurrentWindow()`
// returns. It was called as `win.availableMonitors()`, which threw
// `undefined is not a function` — and the caller turned that into an empty
// array. On Windows an empty array is fail-closed, so every candidate was
// held at "Could not verify your display setup" by a call that had never
// worked on any platform.
//
// Four type declarations asserted the method existed, which is why the
// compiler never objected. They now describe the real shape, so tsc catches a
// repeat. These cover the other half: that a failure to measure and a measured
// zero never collapse into each other again.

import test from "node:test";
import assert from "node:assert/strict";

import { decideDisplayCheck, displayCheckPasses } from "./display-check.ts";

const one = [{ name: "Primary" }];
const two = [{ name: "Primary" }, { name: "HDMI-1" }];
const base = { monitors: one, isWindows: true, override: false };

test("one screen on Windows passes", () => {
  const out = decideDisplayCheck(base);
  assert.equal(out.kind, "single");
  assert.ok(displayCheckPasses(out));
});

test("an unperformable scan on Windows holds the candidate", () => {
  const out = decideDisplayCheck({ ...base, monitors: null });
  assert.equal(out.kind, "indeterminate");
  assert.ok(!displayCheckPasses(out));
});

test("a scan that worked and found nothing is NOT a failure to verify", () => {
  // The heart of it. `[]` means we asked; `null` means we could not. Folding
  // these together is what turned a broken call into a hard block.
  assert.equal(decideDisplayCheck({ ...base, monitors: [] }).kind, "single");
  assert.equal(decideDisplayCheck({ ...base, monitors: null }).kind, "indeterminate");
});

test("two screens block on Windows", () => {
  const out = decideDisplayCheck({ ...base, monitors: two });
  assert.equal(out.kind, "multi_blocked");
  assert.ok(!displayCheckPasses(out));
});

test("two screens are only advisory off Windows", () => {
  const out = decideDisplayCheck({ ...base, monitors: two, isWindows: false });
  assert.equal(out.kind, "multi_warned");
  assert.ok(displayCheckPasses(out));
});

test("an unperformable scan off Windows does not trap the candidate", () => {
  // macOS and Linux treat the display check as advisory, so a scan that could
  // not run must not become a wall there.
  const out = decideDisplayCheck({ ...base, monitors: null, isWindows: false });
  assert.equal(out.kind, "single");
  assert.ok(displayCheckPasses(out));
});

test("an organizer waiver clears a Windows multi-display block", () => {
  const out = decideDisplayCheck({ ...base, monitors: two, override: true });
  assert.equal(out.kind, "multi_warned");
  assert.ok(displayCheckPasses(out));
});

test("an organizer waiver also clears an unverifiable scan", () => {
  // The invigilator has looked at the machine; the probe has not.
  const out = decideDisplayCheck({ ...base, monitors: null, override: true });
  assert.ok(displayCheckPasses(out));
});

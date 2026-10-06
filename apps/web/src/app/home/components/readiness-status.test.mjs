import test from "node:test";
import assert from "node:assert/strict";

import {
  readinessStatusForOutcome,
  nativeCheckFallback,
  hasNativeBridge,
} from "./readiness-status.ts";

// The report has four outcomes. The UI had three, and the collapse lost two
// distinctions that matter to a candidate staring at a readiness modal.
//
// github.com/.../issues/40: keyboard lockdown failed on a tiling WM, the log
// said so, and the modal showed "Checking..." for ever.

test("a passing check is ok", () => {
  assert.equal(readinessStatusForOutcome("pass"), "ok");
});

test("a blocking failure is fail", () => {
  assert.equal(readinessStatusForOutcome("fail"), "fail");
});

test("an advisory warning is not reported as a failure", () => {
  // It used to be. An advisory check reading "Needs action" tells a candidate
  // to fix something that was never going to stop them entering.
  assert.equal(readinessStatusForOutcome("warn"), "warn");
});

test("a probe this machine cannot run is not reported as still checking", () => {
  // The bug in #40. `unknown` means the answer will never arrive, so showing
  // "Checking..." is a promise the scan cannot keep.
  const status = readinessStatusForOutcome("unknown");
  assert.equal(status, "unavailable");
  assert.notEqual(status, "checking");
});

// ── the browser case ──────────────────────────────────────────────────────
//
// Keyboard lockdown, VM detection, restricted apps and platform support are
// native probes. In a browser they do not exist, exactly as keyboard lockdown
// does not exist on a tiling window manager — so "4 checks need attention"
// was advice nobody could act on, and it buried the checks that had run.

test("without a native bridge the native-only checks are unavailable, not failed", () => {
  assert.equal(nativeCheckFallback(false), "unavailable");
});

test("with a native bridge present a failed scan still fails closed", () => {
  // The packaged app always has the bridge. If the scan throws there,
  // something is genuinely wrong and we cannot prove the machine is clean —
  // so this must stay "fail" and must never inherit the browser relaxation.
  assert.equal(nativeCheckFallback(true), "fail");
});

test("the bridge is detected by the invoke function, not merely the global", () => {
  // A `__TAURI__` that exists but carries no `core.invoke` cannot run a probe,
  // so treating its presence as "native available" would fail closed on a
  // machine that has no native layer at all.
  assert.equal(hasNativeBridge({}), false);
  assert.equal(hasNativeBridge({ __TAURI__: {} }), false);
  assert.equal(hasNativeBridge({ __TAURI__: { core: {} } }), false);
  assert.equal(hasNativeBridge({ __TAURI__: { core: { invoke: () => {} } } }), true);
});

// ── the dev entry path must be impossible in a shipped build ───────────────
//
// Entry in a browser depends on the native bridge being absent. A packaged
// Tauri build always has it, so these pin the only thing that keeps the dev
// affordance out of a real contest.

test("a packaged build is never treated as a dev session", () => {
  const packaged = { __TAURI__: { core: { invoke: () => {} } } };
  assert.equal(hasNativeBridge(packaged), true, "entry must still require a readiness report");
});

test("a browser is treated as a dev session", () => {
  assert.equal(hasNativeBridge({}), false);
});

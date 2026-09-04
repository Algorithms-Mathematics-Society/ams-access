// What the manual recovery card says when it could not put everything back.
//
// It said, on every platform: "Some settings could not be restored
// automatically. Relaunch AMS Access, it re-runs recovery on startup, or
// restart your Mac."
//
// Both halves are wrong on Linux, which is the platform with the worst
// stranding behaviour. Relaunching re-runs KEYBOARD recovery only
// (`recover_keyboard_if_crashed`); the firewall is untouched, because Linux
// has no startup reconciliation. And the machine is not a Mac. This is the
// only recovery affordance in the product, and on the platform that needs it
// most it gave instructions that cannot work.

import test from "node:test";
import assert from "node:assert/strict";

import { manualRecoveryCommand, recoveryFailureMessage } from "./recovery-message.ts";

test("Linux is never told to restart a Mac", () => {
  for (const p of ["linux", "LINUX"]) {
    assert.doesNotMatch(recoveryFailureMessage(p), /mac/i);
  }
});

test("Linux is not told that relaunching re-runs the recovery that matters", () => {
  // Relaunching does re-run keyboard recovery, but the firewall is what a
  // stranded candidate is stuck behind, and nothing at startup touches it.
  const message = recoveryFailureMessage("linux");
  assert.doesNotMatch(message, /relaunch/i);
});

test("Linux gets a command that actually clears the rules", () => {
  const command = manualRecoveryCommand("linux");
  assert.match(command, /iptables/);
  assert.match(command, /AMS_PROCTOR/);
  // IPv6 too: the helper builds both chains whenever the stack is present, so
  // clearing only v4 leaves half the lockdown in place.
  assert.match(command, /ip6tables/);
});

test("macOS may still be told to restart, because there it is true", () => {
  // macOS DOES flush pfctl on next launch (`recover_lockdown_if_crashed` plus
  // the startup thread), so relaunching is genuine advice there.
  const message = recoveryFailureMessage("macos");
  assert.match(message, /relaunch/i);
  assert.equal(manualRecoveryCommand("macos"), null);
});

test("Windows is told to relaunch and given no shell command", () => {
  const message = recoveryFailureMessage("windows");
  assert.match(message, /relaunch/i);
  assert.doesNotMatch(message, /mac/i);
  assert.equal(manualRecoveryCommand("windows"), null);
});

test("every Windows label shape is recognised, not just the bare one", () => {
  // `get_platform` reports windows_no_admin / windows_msix /
  // windows_no_firewall. A bare equality check silently drops all three, which
  // is the documented invariant in markdowns/CLAUDE.md.
  for (const p of ["windows_no_admin", "windows_msix", "windows_no_firewall"]) {
    assert.doesNotMatch(recoveryFailureMessage(p), /mac/i);
    assert.equal(manualRecoveryCommand(p), null);
  }
});

test("an unknown platform gets advice that is true everywhere", () => {
  for (const p of [null, "", "freebsd"]) {
    const message = recoveryFailureMessage(p);
    assert.doesNotMatch(message, /mac/i, `leaked Mac copy for ${p}`);
    assert.ok(message.length > 0);
    assert.equal(manualRecoveryCommand(p), null);
  }
});

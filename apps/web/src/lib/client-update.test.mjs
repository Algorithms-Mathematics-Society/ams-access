import { test } from "node:test";
import assert from "node:assert/strict";
import { belowMinimum, minorUpgradeAvailable, parseMajorMinor } from "./client-update.ts";

test("a newer minor release prompts", () => {
  assert.equal(minorUpgradeAvailable("3.1.2", "3.2.0"), true);
  assert.equal(minorUpgradeAvailable("3.1.9", "3.2.1"), true);
});

test("a patch says nothing", () => {
  // The whole point: interrupting a thousand candidates over a patch is how
  // a prompt that matters gets dismissed without being read.
  assert.equal(minorUpgradeAvailable("3.1.2", "3.1.9"), false);
  assert.equal(minorUpgradeAvailable("3.2.1", "3.2.1"), false);
});

test("a newer major prompts, an older one does not", () => {
  assert.equal(minorUpgradeAvailable("3.9.9", "4.0.0"), true);
  // A client ahead of the server's published version is not out of date.
  assert.equal(minorUpgradeAvailable("4.0.0", "3.9.9"), false);
  assert.equal(minorUpgradeAvailable("3.2.0", "3.1.0"), false);
});

test("unparseable versions never prompt", () => {
  // Silence is the safe direction: a candidate about to sit an exam must not
  // be blocked by a version string nobody can read.
  assert.equal(minorUpgradeAvailable("", "3.2.0"), false);
  assert.equal(minorUpgradeAvailable("3.1.2", ""), false);
  assert.equal(minorUpgradeAvailable("dev", "3.2.0"), false);
  assert.equal(minorUpgradeAvailable("3.1", "3.2.0"), false);
});

test("a pre-release is read by its numbers", () => {
  assert.deepEqual(parseMajorMinor("3.2.0-rc.1"), { major: 3, minor: 2 });
  assert.equal(minorUpgradeAvailable("3.1.2", "3.2.0-rc.1"), true);
});

test("only a build below the server's minimum is below it", () => {
  assert.equal(belowMinimum("3.1.2", "3.2.0"), true);
  assert.equal(belowMinimum("3.2.0", "3.2.1"), true);
  assert.equal(belowMinimum("3.2.0", "3.2.0"), false);
  assert.equal(belowMinimum("3.10.0", "3.9.0"), false);
  assert.equal(belowMinimum("4.0.0", "3.9.9"), false);
  // As on the server: a pre-release of the minimum predates it.
  assert.equal(belowMinimum("3.2.0-rc.1", "3.2.0"), true);
  assert.equal(belowMinimum("3.2.0", "3.2.0-rc.1"), false);
});

test("an unparseable or unset minimum never blocks", () => {
  assert.equal(belowMinimum("3.1.2", ""), false);
  assert.equal(belowMinimum("dev", "3.2.0"), false);
});

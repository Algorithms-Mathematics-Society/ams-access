import assert from "node:assert/strict";
import test from "node:test";

import { decidePresence, isPresencePass, presenceMessage } from "./presence-check.ts";

const ok = { status: "presence_ok", faces: 1, thumbnail: null };
const missing = { status: "face_missing", faces: 0, thumbnail: "data:image/jpeg;base64,x" };
const many = { status: "multiple_faces", faces: 2, thumbnail: "data:image/jpeg;base64,x" };

test("a candidate visible in every frame is present", () => {
  assert.equal(decidePresence([ok, ok, ok]), "present");
});

test("nobody in frame is absent, not present", () => {
  // The whole reason this module exists: the stage it replaces returned the
  // equivalent of "present" here, on a timer, with the camera covered.
  assert.equal(decidePresence([missing, missing, missing]), "absent");
});

test("one dropped frame out of three still counts as present", () => {
  // People blink, lean out of shot, and adjust their chair. A single bad
  // sample must not warn, or the warning means nothing by the tenth contest.
  assert.equal(decidePresence([ok, missing, ok]), "present");
});

test("losing the majority of frames is absent", () => {
  assert.equal(decidePresence([ok, missing, missing]), "absent");
});

test("a second person in a single frame outranks a clean majority", () => {
  // Stepping out of shot once is ordinary; someone else appearing once is
  // exactly what this check is for, so it must not be averaged away.
  assert.equal(decidePresence([ok, many, ok]), "multiple");
});

test("multiple faces wins even when every other frame was unreadable", () => {
  assert.equal(decidePresence([null, many, null]), "multiple");
});

test("frames the detector could not read at all are unknown, not absent", () => {
  // A null sample is a failure to measure. Recording it as absence would
  // blame the candidate for a broken video element.
  assert.equal(decidePresence([null, null, null]), "unknown");
});

test("no samples at all is unknown", () => {
  assert.equal(decidePresence([]), "unknown");
});

test("unreadable frames are discarded rather than counted against the candidate", () => {
  // One good frame and two unreadable ones is a majority of *what was
  // measured*, so it passes.
  assert.equal(decidePresence([ok, null, null]), "present");
});

test("only a clear presence is recorded as a pass", () => {
  assert.equal(isPresencePass("present"), true);
  for (const verdict of ["absent", "multiple", "unknown"]) {
    assert.equal(isPresencePass(verdict), false, verdict);
  }
});

test("every verdict has a message that does not blame the candidate", () => {
  for (const verdict of ["present", "absent", "multiple", "unknown"]) {
    const message = presenceMessage(verdict);
    assert.ok(message.length > 0, verdict);
    assert.ok(!/fail|denied|rejected/i.test(message), `${verdict}: ${message}`);
  }
});

test("a non-passing verdict always tells the candidate they may continue", () => {
  // Decision 7 — onboarding records and warns, it never ejects. If this ever
  // stops being true the wording has to change with it.
  for (const verdict of ["absent", "unknown"]) {
    assert.match(presenceMessage(verdict), /may continue/, verdict);
  }
});

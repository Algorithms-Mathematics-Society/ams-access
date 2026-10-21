import assert from "node:assert/strict";
import test from "node:test";

import {
  PRESENCE_EVIDENCE_MAX_MS,
  PRESENCE_EVIDENCE_MIN_MS,
  nextPresenceEvidenceDelay,
  presenceUnavailableEvent,
} from "./presence-evidence.ts";

test("no-stream evidence cadence stays within the presence sampling window", () => {
  assert.equal(nextPresenceEvidenceDelay(0), PRESENCE_EVIDENCE_MIN_MS);
  assert.equal(nextPresenceEvidenceDelay(0.5), 60_000);
  assert.equal(nextPresenceEvidenceDelay(1), PRESENCE_EVIDENCE_MAX_MS);
  assert.equal(nextPresenceEvidenceDelay(-10), PRESENCE_EVIDENCE_MIN_MS);
  assert.equal(nextPresenceEvidenceDelay(10), PRESENCE_EVIDENCE_MAX_MS);
  assert.equal(nextPresenceEvidenceDelay(Number.NaN), 60_000);
});

test("no-stream evidence states the missing measurement without claiming a face result", () => {
  const event = presenceUnavailableEvent("contest-a");
  assert.deepEqual(event, {
    kind: "presence_unavailable",
    detail: "periodic presence check unavailable: no camera stream",
    payload: { contest_id: "contest-a", reason: "no_camera_stream" },
  });
  assert.equal("faces" in event.payload, false);
  assert.equal("thumbnail" in event.payload, false);
});

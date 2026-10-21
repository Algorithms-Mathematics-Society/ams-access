import assert from "node:assert/strict";
import test from "node:test";

import { buildFaceReviewEvent, createFaceReviewRequest } from "./face-review.ts";

test("manual face review has one canonical, truthful event identity", () => {
  assert.deepEqual(buildFaceReviewEvent(false), {
    kind: "face_verification_fallback",
    detail: "Candidate requested manual proctor review after the face calibration check.",
    payload: {
      stage: 8,
      stage_key: "face_calibration",
      outcome: "manual_review_requested",
      face_verified: false,
      review_required: true,
      dry_run: false,
    },
  });
  assert.equal(buildFaceReviewEvent(true).payload.dry_run, true);
});

test("review diagnostics preserve the reason and allowlist only non-sensitive fields", () => {
  const event = buildFaceReviewEvent(false, {
    reason: "scan_deadline",
    elapsed_ms: 45_021,
    video_ready_state: 4,
    frame_width: 640,
    frame_height: 480,
    image_data: "data:image/png;base64,secret",
    device_id: "camera-serial",
    file_path: "/private/face.png",
  });
  assert.equal(event.payload.reason, "scan_deadline");
  assert.equal(event.payload.face_verified, false);
  assert.deepEqual(
    Object.keys(event.payload).sort(),
    [
      "dry_run",
      "elapsed_ms",
      "face_verified",
      "frame_height",
      "frame_width",
      "outcome",
      "reason",
      "review_required",
      "stage",
      "stage_key",
      "video_ready_state",
    ].sort()
  );
  assert.equal("image_data" in event.payload, false);
  assert.equal("device_id" in event.payload, false);
  assert.equal("file_path" in event.payload, false);
});

test("a review request is accepted once per onboarding visit", () => {
  const review = createFaceReviewRequest();
  assert.equal(review.isRequested(), false);
  assert.equal(review.request(), true);
  assert.equal(review.isRequested(), true);
  assert.equal(review.request(), false);
});

test("persistence waits for a request and requires a session identity", async () => {
  const review = createFaceReviewRequest();
  let writes = 0;
  await review.persist("session-a", async () => {
    writes += 1;
  });
  assert.equal(writes, 0);
  review.request();
  await assert.rejects(
    review.persist("  ", async () => {
      writes += 1;
    }),
    /requires a session/
  );
  assert.equal(writes, 0);
});

test("a pending persistence write is shared and an acknowledgement is deduplicated", async () => {
  const review = createFaceReviewRequest();
  review.request();
  let writes = 0;
  let resolveWrite;
  const gate = new Promise((resolve) => {
    resolveWrite = resolve;
  });
  const write = async () => {
    writes += 1;
    await gate;
  };

  const first = review.persist("session-a", write);
  const concurrent = review.persist("session-a", write);
  assert.equal(first, concurrent);
  await Promise.resolve();
  assert.equal(writes, 1);
  resolveWrite();
  await first;
  await review.persist("session-a", write);
  assert.equal(writes, 1);
});

test("a rejected persistence write can be retried without poisoning the session", async () => {
  const review = createFaceReviewRequest();
  review.request();
  let attempts = 0;
  await assert.rejects(
    review.persist("session-a", async () => {
      attempts += 1;
      throw new Error("spool unavailable");
    }),
    /spool unavailable/
  );
  await review.persist("session-a", async () => {
    attempts += 1;
  });
  assert.equal(attempts, 2);
});

test("acknowledgement is scoped to the session", async () => {
  const review = createFaceReviewRequest();
  review.request();
  const sessions = [];
  await review.persist("session-a", async () => {
    sessions.push("a");
  });
  await review.persist("session-b", async () => {
    sessions.push("b");
  });
  assert.deepEqual(sessions, ["a", "b"]);
});

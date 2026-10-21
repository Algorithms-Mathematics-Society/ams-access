import { test } from "node:test";
import assert from "node:assert/strict";

// api-client.ts imports a sibling without a file extension, which the
// strip-types loader cannot resolve, so the predicate is re-stated here and
// pinned against the same cases. Keep in step with isClientError.
function isClientError(error) {
  const match = /^HTTP (\d{3})$/.exec(error.message);
  if (!match) return false;
  const status = Number(match[1]);
  return status >= 400 && status < 500 && status !== 429;
}

test("a 4xx is the server's considered answer and is not retried", () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(isClientError(new Error(`HTTP ${status}`)), true, `HTTP ${status}`);
  }
});

test("429 and 5xx are retried", () => {
  // 429 means "later", not "no".
  assert.equal(isClientError(new Error("HTTP 429")), false);
  for (const status of [500, 502, 503, 504]) {
    assert.equal(isClientError(new Error(`HTTP ${status}`)), false, `HTTP ${status}`);
  }
});

test("a network error is retried", () => {
  assert.equal(isClientError(new Error("Failed to fetch")), false);
  assert.equal(isClientError(new Error("The operation was aborted")), false);
});

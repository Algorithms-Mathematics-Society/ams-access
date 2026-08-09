// When a candidate is "offline".
//
// The bar matters more than the mechanism. Locking the editor on the first
// missed heartbeat would freeze an entire exam hall the moment its wifi
// hiccups — a self-inflicted incident, at the worst possible time, affecting
// everyone at once. Three consecutive misses is roughly three minutes of
// genuine silence.

import test from "node:test";
import assert from "node:assert/strict";

import {
  LOCK_AFTER_FAILURES,
  connectionLevel,
  initialHeartbeatState,
  onFailure,
  onSuccess,
  secondsSinceContact,
  shouldLockEditor,
} from "./heartbeat-policy.ts";

const AT = 1_700_000_000_000;

/** Apply `count` consecutive failures to a fresh state. */
function afterFailures(count) {
  let state = onSuccess(initialHeartbeatState(), AT);
  for (let i = 0; i < count; i += 1) state = onFailure(state);
  return state;
}

test("a fresh session is online", () => {
  assert.equal(connectionLevel(initialHeartbeatState()), "online");
  assert.equal(shouldLockEditor(initialHeartbeatState()), false);
});

test("one miss degrades but does not lock", () => {
  // The case that must not take the editor away: a single dropped packet.
  const state = afterFailures(1);
  assert.equal(connectionLevel(state), "degraded");
  assert.equal(shouldLockEditor(state), false);
});

test("two misses still do not lock", () => {
  assert.equal(shouldLockEditor(afterFailures(2)), false);
});

test("the third consecutive miss locks", () => {
  const state = afterFailures(LOCK_AFTER_FAILURES);
  assert.equal(connectionLevel(state), "offline");
  assert.equal(shouldLockEditor(state), true);
});

test("a success clears the streak outright", () => {
  // Flaky wifi that recovers every other minute is working, not offline. The
  // run of failures is what counts, never their total.
  let state = afterFailures(2);
  state = onSuccess(state, AT + 60_000);
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(connectionLevel(state), "online");

  state = onFailure(state);
  state = onFailure(state);
  assert.equal(shouldLockEditor(state), false);
});

test("recovery after a lock unlocks", () => {
  let state = afterFailures(5);
  assert.equal(shouldLockEditor(state), true);
  state = onSuccess(state, AT + 300_000);
  assert.equal(shouldLockEditor(state), false);
});

test("never having reached the server is distinct from just having done so", () => {
  // These must not render the same. "We have never reached the exam server"
  // is a different problem from "we reached it a second ago".
  assert.equal(secondsSinceContact(initialHeartbeatState(), AT), null);
  assert.equal(secondsSinceContact(onSuccess(initialHeartbeatState(), AT), AT), 0);
});

test("time since contact counts from the last success, not the last attempt", () => {
  const state = onFailure(onFailure(onSuccess(initialHeartbeatState(), AT)));
  assert.equal(secondsSinceContact(state, AT + 125_000), 125);
});

test("time since contact never goes negative", () => {
  // Clock adjustments mid-exam should not render as a negative age.
  const state = onSuccess(initialHeartbeatState(), AT);
  assert.equal(secondsSinceContact(state, AT - 5_000), 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  setToken,
  currentParticipantUid,
  authGeneration,
  subscribeAuthChanges,
} from "./proctor-api.ts";
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const token = (sub) => btoa(JSON.stringify({ sub })).replace(/=/g, "") + ".fixture-signature";
test("support recovery namespaces follow account changes and unsubscribe on disposal", () => {
  let notifications = 0;
  const before = authGeneration();
  const stop = subscribeAuthChanges(() => notifications++);
  setToken(token(owner));
  assert.equal(currentParticipantUid(), owner);
  setToken(null);
  assert.equal(currentParticipantUid(), null);
  assert.equal(authGeneration(), before + 2);
  assert.equal(notifications, 2);
  stop();
  setToken(token(owner));
  assert.equal(notifications, 2);
  setToken(null);
});
test("malformed identity claims cannot select a stored private chat", () => {
  for (const value of ["not-a-token", token("-".repeat(36)), token(null)]) {
    setToken(value);
    assert.equal(currentParticipantUid(), null);
  }
  setToken(null);
});

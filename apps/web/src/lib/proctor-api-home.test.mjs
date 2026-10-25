import test from "node:test";
import assert from "node:assert/strict";
import { noteListServerTime, serverNow } from "./proctor-api.ts";

test("a contest list carrying server_time anchors the clock to the server", () => {
  const hourAhead = Date.now() + 3_600_000;
  assert.equal(
    noteListServerTime([{ uid: "c", server_time: new Date(hourAhead).toISOString() }]),
    true
  );
  assert.ok(Math.abs(serverNow() - hourAhead) < 1_000);
});

test("a list without server_time, or an empty one, leaves the clock alone", () => {
  const before = serverNow();
  assert.equal(noteListServerTime([{ uid: "c" }]), false);
  assert.equal(noteListServerTime([]), false);
  assert.ok(Math.abs(serverNow() - before) < 1_000);
});

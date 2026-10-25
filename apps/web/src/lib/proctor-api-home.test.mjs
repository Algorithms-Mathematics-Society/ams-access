import test from "node:test";
import assert from "node:assert/strict";
import {
  getMyContestSession,
  noteListServerTime,
  ProctorApiError,
  serverNow,
} from "./proctor-api.ts";

test("the contest session lookup is null for no session or a server without the route", async (t) => {
  for (const [status, body] of [
    [404, { detail: { error: "NO_SESSION" } }],
    [404, { detail: "Not Found" }],
    [405, { detail: "Method Not Allowed" }],
  ]) {
    t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status }));
    assert.equal(await getMyContestSession("c"), null);
  }
  t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 401 }));
  await assert.rejects(
    getMyContestSession("c"),
    (error) => error instanceof ProctorApiError && error.status === 401
  );
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify({ uid: "s1", status: "submitted" }))
  );
  assert.equal((await getMyContestSession("c")).uid, "s1");
});

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

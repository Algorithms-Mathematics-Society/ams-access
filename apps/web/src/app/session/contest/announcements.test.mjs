// Delivering a postponement to someone mid-exam.
//
// On 24 October candidates competed for hours after the round was postponed,
// some to the end. The failure that matters here is not "the modal looked
// wrong"; it is an announcement that silently never appeared. So these tests
// assert the absences as hard as the behaviour: nothing is auto-dismissed,
// nothing is hidden by a broken store, and a malformed payload shows nothing
// rather than something half-read.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ackKey,
  nextToShow,
  readAnnouncement,
  readAnnouncements,
  rememberAck,
  shouldFetch,
  wasAcked,
} from "./announcements.ts";

function store(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
    size: () => data.size,
  };
}

function announcement(over = {}) {
  return {
    uid: "a1",
    title: "Round 1 is postponed",
    body: "Your work is saved. Wait for an invigilator.",
    created_at: "2026-10-24T14:52:00Z",
    acknowledged: false,
    ...over,
  };
}

test("the text is fetched only when the revision actually moves", () => {
  assert.equal(shouldFetch(0, 1), true, "the first announcement must arrive");
  assert.equal(shouldFetch(3, 4), true);
  assert.equal(shouldFetch(4, 4), false, "no refetch on an unchanged revision");
  // A server reporting a lower number must not start a refetch loop.
  assert.equal(shouldFetch(9, 4), false);
  assert.equal(shouldFetch(0, 0), false);
});

test("a nonsense revision is never treated as news", () => {
  for (const bad of [undefined, null, "4", 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 2]) {
    assert.equal(shouldFetch(0, bad), false, `${String(bad)} should not trigger a fetch`);
  }
});

test("a malformed announcement is dropped rather than half-read", () => {
  assert.equal(readAnnouncement(null), null);
  assert.equal(readAnnouncement({}), null);
  assert.equal(readAnnouncement(announcement({ uid: "" })), null);
  assert.equal(readAnnouncement(announcement({ title: "   " })), null);
  assert.equal(readAnnouncement(announcement({ body: "" })), null);
  assert.equal(readAnnouncement(announcement({ created_at: "not a date" })), null);
  assert.equal(readAnnouncement(announcement({ title: "x".repeat(300) })), null);
  assert.equal(readAnnouncement(announcement({ body: "x".repeat(9_000) })), null);
});

test("an oversized body is rejected before a code-point array is built", () => {
  // The guard must bound the work, not do the work and then complain.
  const original = Array.from;
  let allocations = 0;
  Array.from = (...args) => {
    allocations += 1;
    return original.apply(Array, args);
  };
  try {
    assert.equal(readAnnouncement(announcement({ body: "x".repeat(50_000) })), null);
    assert.equal(allocations, 0, "rejected on UTF-16 length, before Array.from");
  } finally {
    Array.from = original;
  }
});

test("a valid announcement survives intact", () => {
  const parsed = readAnnouncement(announcement());
  assert.equal(parsed.uid, "a1");
  assert.equal(parsed.title, "Round 1 is postponed");
  assert.equal(parsed.acknowledged, false);
});

test("acknowledged is only true when the server says exactly true", () => {
  assert.equal(readAnnouncement(announcement({ acknowledged: "yes" })).acknowledged, false);
  assert.equal(readAnnouncement(announcement({ acknowledged: 1 })).acknowledged, false);
  assert.equal(readAnnouncement(announcement({ acknowledged: true })).acknowledged, true);
});

test("a list drops only the bad rows, and is bounded", () => {
  const rows = [announcement({ uid: "a" }), { junk: true }, announcement({ uid: "b" })];
  assert.deepEqual(
    readAnnouncements(rows).map((r) => r.uid),
    ["a", "b"],
  );
  assert.deepEqual(readAnnouncements("not a list"), []);

  const many = Array.from({ length: 200 }, (_, i) => announcement({ uid: `a${i}` }));
  assert.equal(readAnnouncements(many).length, 50);
});

test("announcements are shown oldest first, so the story reads forwards", () => {
  const s = store();
  const rows = [
    announcement({ uid: "late", created_at: "2026-10-24T15:10:00Z", title: "Postponed" }),
    announcement({ uid: "early", created_at: "2026-10-24T14:50:00Z", title: "Delayed" }),
  ];
  assert.equal(nextToShow(rows, s, "sess").uid, "early");
});

test("an acknowledged announcement does not come back", () => {
  const s = store();
  const rows = [announcement()];
  assert.equal(nextToShow(rows, s, "sess").uid, "a1");

  rememberAck(s, "sess", "a1");
  assert.equal(wasAcked(s, "sess", "a1"), true);
  assert.equal(nextToShow(rows, s, "sess"), null);
});

test("the server's own acknowledgement is honoured without local memory", () => {
  const s = store();
  assert.equal(nextToShow([announcement({ acknowledged: true })], s, "sess"), null);
});

test("acknowledgement is remembered per session, not globally", () => {
  const s = store();
  rememberAck(s, "sess-a", "a1");
  assert.equal(wasAcked(s, "sess-a", "a1"), true);
  assert.equal(wasAcked(s, "sess-b", "a1"), false);
  assert.match(ackKey("sess-a", "a1"), /^ams_contest_ack:sess-a:a1$/);
});

test("a broken store never hides an announcement", () => {
  // The failure direction matters. Showing a postponement twice is an
  // annoyance; hiding one is the thing that happened on 24 October.
  const broken = {
    getItem() {
      throw new Error("storage disabled");
    },
    setItem() {
      throw new Error("quota exceeded");
    },
    removeItem() {},
  };
  assert.equal(wasAcked(broken, "sess", "a1"), false);
  assert.doesNotThrow(() => rememberAck(broken, "sess", "a1"));
  assert.equal(nextToShow([announcement()], broken, "sess").uid, "a1");
});

test("nothing is ever dismissed on a timer", () => {
  // There is no API here that retires an announcement by itself. If one is
  // ever added, this test is the place that should stop it: a candidate who
  // stepped away must still find the postponement waiting for them.
  const exported = Object.keys({
    ackKey,
    nextToShow,
    readAnnouncement,
    readAnnouncements,
    rememberAck,
    shouldFetch,
    wasAcked,
  });
  for (const name of exported) {
    assert.doesNotMatch(name, /expire|timeout|dismiss|auto/i);
  }
});

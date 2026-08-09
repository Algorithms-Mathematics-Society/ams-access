// Which copy of a candidate's work wins.
//
// There was a `writeLocalAnswerBuffer` that nothing ever read, while the UI
// promised "your work is saved locally". On restart the room restored from
// the server draft only, so anything the network had not accepted was gone —
// which is precisely the case the buffer existed for.
//
// The rule here is revision-ordered, not time-ordered, and that is the point:
// the buffer's timestamp comes from a clock the candidate controls, so
// trusting it would let a backdated buffer overwrite accepted work.

import test from "node:test";
import assert from "node:assert/strict";

import { activeContent, bufferKey, chooseRestore, clear, read, write } from "./answer-buffer.ts";

function makeStore(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const answer = (overrides = {}) => ({
  language: "cpp23",
  files: [{ id: "main", name: "main.cpp", content: "int main() {}" }],
  activeFileId: "main",
  savedAtMs: 1_700_000_000_000,
  revision: 4,
  ...overrides,
});

const draft = (overrides = {}) => ({
  source: "int main() {}",
  language: "cpp23",
  client_revision: 4,
  ...overrides,
});

// ── storage ───────────────────────────────────────────────────────────────

test("a buffer round-trips", () => {
  const store = makeStore();
  write(store, "sess", "A", answer());
  assert.deepEqual(read(store, "sess", "A"), answer());
});

test("buffers are scoped per session and per problem", () => {
  assert.notEqual(bufferKey("s1", "A"), bufferKey("s1", "B"));
  assert.notEqual(bufferKey("s1", "A"), bufferKey("s2", "A"));
});

test("clearing removes only that problem", () => {
  const store = makeStore();
  write(store, "sess", "A", answer());
  write(store, "sess", "B", answer());
  clear(store, "sess", "A");
  assert.equal(read(store, "sess", "A"), null);
  assert.notEqual(read(store, "sess", "B"), null);
});

test("a corrupt buffer reads as absent rather than throwing", () => {
  // Truncated by a crash mid-write, or hand-edited. It must not stop the room
  // from loading.
  const store = makeStore({ [bufferKey("sess", "A")]: "{not json" });
  assert.equal(read(store, "sess", "A"), null);
});

test("a buffer missing its files reads as absent", () => {
  const store = makeStore({ [bufferKey("sess", "A")]: JSON.stringify({ language: "cpp23" }) });
  assert.equal(read(store, "sess", "A"), null);
});

test("a store that throws does not propagate", () => {
  // Private mode, or a full quota. Typing must not stop.
  const hostile = {
    getItem() {
      throw new Error("nope");
    },
    setItem() {
      throw new Error("quota");
    },
    removeItem() {
      throw new Error("nope");
    },
  };
  assert.doesNotThrow(() => write(hostile, "s", "A", answer()));
  assert.equal(read(hostile, "s", "A"), null);
  assert.doesNotThrow(() => clear(hostile, "s", "A"));
});

test("the active tab's content is what gets compared", () => {
  const multi = answer({
    files: [
      { id: "main", name: "main.cpp", content: "primary" },
      { id: "scratch", name: "scratch.cpp", content: "notes" },
    ],
    activeFileId: "scratch",
  });
  assert.equal(activeContent(multi), "notes");
});

test("a missing active tab falls back to the first", () => {
  assert.equal(activeContent(answer({ activeFileId: "deleted" })), "int main() {}");
});

// ── which copy wins ───────────────────────────────────────────────────────

test("a buffer ahead of the server is unsaved work and wins", () => {
  // The case the whole module exists for: the network dropped, the candidate
  // kept typing, the app died.
  assert.equal(chooseRestore(answer({ revision: 7 }), draft({ client_revision: 4 })), "buffer");
});

test("a buffer behind the server is stale and loses", () => {
  // They worked on another machine, or the same draft was saved elsewhere.
  assert.equal(chooseRestore(answer({ revision: 2 }), draft({ client_revision: 5 })), "server");
});

test("identical content at the same revision announces nothing", () => {
  // The common case — a clean save. Telling the candidate their work was
  // "restored" every time they reopen a problem would make the message
  // meaningless when it matters.
  assert.equal(chooseRestore(answer(), draft()), "same");
});

test("different content at the same revision means the write was in flight", () => {
  const buffered = answer({
    files: [{ id: "main", name: "main.cpp", content: "typed after the last save" }],
  });
  assert.equal(chooseRestore(buffered, draft()), "buffer");
});

test("a backdated buffer cannot overwrite accepted work", () => {
  // Timestamps come from a clock the candidate controls, so they are not used
  // to break ties. A far-future `savedAtMs` behind on revision still loses.
  const backdated = answer({ revision: 1, savedAtMs: 9_999_999_999_999 });
  assert.equal(chooseRestore(backdated, draft({ client_revision: 3 })), "server");
});

test("no buffer falls back to the server", () => {
  assert.equal(chooseRestore(null, draft()), "server");
});

test("no server draft uses whatever is local", () => {
  // First problem opened after an offline start.
  assert.equal(chooseRestore(answer(), null), "buffer");
});

test("neither copy is an empty editor, not an error", () => {
  assert.equal(chooseRestore(null, null), "none");
});

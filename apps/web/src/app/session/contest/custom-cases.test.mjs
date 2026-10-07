import test from "node:test";
import assert from "node:assert/strict";

import { newCase, sendable, canRun, toWire, MAX_CUSTOM_CASES } from "./custom-cases.ts";

test("a fresh case is empty and unjudged", () => {
  const c = newCase();
  assert.equal(c.input, "");
  assert.equal(c.expected, null);
});

test("ids are unique, so React keys do not collide", () => {
  const ids = new Set(Array.from({ length: 50 }, () => newCase().id));
  assert.equal(ids.size, 50);
});

test("a case with no input is dropped rather than sent", () => {
  const cases = [
    { id: "a", input: "", expected: null },
    { id: "b", input: "5", expected: null },
  ];
  assert.deepEqual(
    sendable(cases).map((c) => c.id),
    ["b"]
  );
});

test("nothing to run when every case is blank", () => {
  assert.equal(canRun([{ id: "a", input: "", expected: null }]), false);
  assert.equal(canRun([]), false);
});

test("expected output is omitted when unjudged, not sent as empty", () => {
  // "" is a legitimate expected output. Sending it for an unjudged case
  // would judge the program against printing nothing.
  const [wire] = toWire([{ id: "a", input: "1", expected: null }]);
  assert.equal("expected" in wire, false);
});

test("an empty expected output is still judged", () => {
  const [wire] = toWire([{ id: "a", input: "1", expected: "" }]);
  assert.equal(wire.expected, "");
});

test("labels are positional over the sendable cases only", () => {
  const wire = toWire([
    { id: "a", input: "", expected: null },
    { id: "b", input: "x", expected: null },
    { id: "c", input: "y", expected: "z" },
  ]);
  assert.deepEqual(
    wire.map((w) => w.label),
    ["Case 1", "Case 2"]
  );
});

test("the cap matches what the API enforces", () => {
  assert.equal(MAX_CUSTOM_CASES, 20);
});

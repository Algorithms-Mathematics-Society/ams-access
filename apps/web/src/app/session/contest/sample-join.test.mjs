import { test } from "node:test";
import assert from "node:assert/strict";
import { exampleFor, sampleOrdinals } from "./sample-join.ts";

const EXAMPLES = [
  { label: "1", input: "2 3\n", output: "5\n" },
  { label: "2", input: "10 20\n", output: "30\n" },
];

test("a labelled case finds its own example", () => {
  assert.equal(exampleFor({ label: "2" }, 0, EXAMPLES), EXAMPLES[1]);
});

test("a named label beats position", () => {
  const named = [
    { label: "tiny", input: "1\n", output: "1\n" },
    { label: "big", input: "99\n", output: "99\n" },
  ];
  assert.equal(exampleFor({ label: "big" }, 0, named), named[1]);
});

test("an unlabelled case falls back to its position", () => {
  assert.equal(exampleFor({}, 1, EXAMPLES), EXAMPLES[1]);
});

test("a case past the end pairs with nothing rather than the wrong one", () => {
  // The judge ran four samples and the statement shows two: the projection
  // has drifted. An expected output from the wrong case is worse than none,
  // because a candidate will believe it.
  assert.equal(exampleFor({}, 3, EXAMPLES), null);
  assert.equal(exampleFor({ label: "7" }, 3, EXAMPLES), null);
});

test("no examples at all is not an error", () => {
  assert.equal(exampleFor({ label: "1" }, 0, undefined), null);
  assert.equal(exampleFor({ label: "1" }, 0, []), null);
});

test("ordinals count samples only, skipping rules and behaviour checks", () => {
  const cases = [
    { kind: "io" },
    { kind: "symbolic" },
    { kind: "io" },
    { kind: "behavior" },
    { kind: "io" },
  ];
  // The second sample is still example two even with a rule sitting between.
  assert.deepEqual(sampleOrdinals(cases), [0, -1, 1, -1, 2]);
});

test("a missing kind counts as a sample, as it does everywhere else", () => {
  assert.deepEqual(sampleOrdinals([{}, {}]), [0, 1]);
});

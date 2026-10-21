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

// A custom case is `kind: "io"` like a sample, so before the contest room
// stopped handing it the statement's examples it matched one by position and
// rendered that example's answer as "Expected" -- for input the candidate had
// typed themselves. These pin the join the custom path now relies on.
test("a custom case joins its own stand-in example by label, not position", () => {
  const own = [
    { label: "Case 1", input: "7\n", output: undefined },
    { label: "Case 2", input: "8\n", output: "8\n" },
  ];
  // "Case 2" is at position 1; passing position 0 proves the label wins.
  assert.equal(exampleFor({ label: "Case 2" }, 0, own), own[1]);
});

test("a custom case with no expected output offers nothing to compare against", () => {
  const own = [{ label: "Case 1", input: "7\n", output: undefined }];
  const joined = exampleFor({ label: "Case 1" }, 0, own);
  assert.equal(joined?.input, "7\n");
  // ResultsPanel renders Expected only when it is non-null, so undefined here
  // is what keeps the block off screen.
  assert.equal(joined?.output, undefined);
});

test("a custom case never reaches the statement's examples", () => {
  // What the contest room now passes for a custom run: the candidate's own
  // cases, never EXAMPLES. A label that matches nothing and a position past
  // the end must both come back empty rather than borrowing an answer.
  assert.equal(exampleFor({ label: "Case 9" }, 9, []), null);
  assert.equal(exampleFor({ label: "Case 9" }, 9, undefined), null);
});

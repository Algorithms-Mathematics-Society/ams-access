import { test } from "node:test";
import assert from "node:assert/strict";
import { samplesAsCustomCases } from "./samples-as-cases.ts";
import { MAX_CUSTOM_CASES } from "./custom-cases.ts";

test("worked examples become judged cases", () => {
  const cases = samplesAsCustomCases([
    { label: "1", input: "2 3\n", output: "5\n" },
    { label: "2", input: "10 20\n", output: "30\n" },
  ]);
  assert.equal(cases.length, 2);
  assert.deepEqual(
    cases.map((c) => [c.input, c.expected]),
    [
      ["2 3\n", "5\n"],
      ["10 20\n", "30\n"],
    ]
  );
});

test("an empty expected output is an expectation, not a missing one", () => {
  // A problem whose correct answer is to print nothing is a real problem, and
  // `null` means unjudged. Collapsing the two would silently stop checking it.
  const [only] = samplesAsCustomCases([{ input: "0\n", output: "" }]);
  assert.equal(only.expected, "");
});

test("a problem with no worked examples falls through to an ordinary run", () => {
  // Behaviour-checked problems ship no samples at all. Returning an empty
  // array would be refused by the API, which reads a present `custom_cases`
  // key as "run only these" -- so the Run button would do nothing.
  assert.equal(samplesAsCustomCases([]), null);
  assert.equal(samplesAsCustomCases(undefined), null);
  assert.equal(samplesAsCustomCases(null), null);
});

test("an example with no usable input is skipped, not sent as rubbish", () => {
  const cases = samplesAsCustomCases([
    { label: "1", input: "ok\n", output: "fine\n" },
    { label: "2", output: "orphan\n" },
  ]);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].input, "ok\n");
});

test("an example with no expected output runs unjudged", () => {
  const [only] = samplesAsCustomCases([{ input: "5\n" }]);
  assert.equal(only.expected, null);
});

test("the API's cap is respected", () => {
  const many = Array.from({ length: MAX_CUSTOM_CASES + 7 }, (_, i) => ({
    input: `${i}\n`,
    output: `${i}\n`,
  }));
  assert.equal(samplesAsCustomCases(many).length, MAX_CUSTOM_CASES);
});

test("ids are stable, so a re-run does not look like different cases", () => {
  const first = samplesAsCustomCases([{ label: "a", input: "1\n", output: "1\n" }]);
  const second = samplesAsCustomCases([{ label: "a", input: "1\n", output: "1\n" }]);
  assert.deepEqual(
    first.map((c) => c.id),
    second.map((c) => c.id)
  );
});

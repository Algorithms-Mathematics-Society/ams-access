import test from "node:test";
import assert from "node:assert/strict";

import { MAX_CASE_CHARS, MAX_SOURCE_CHARS, attemptLimitError } from "./attempt-limits.ts";

test("code within the limits passes", () => {
  assert.equal(attemptLimitError("int main() {}"), null);
  assert.equal(attemptLimitError("x".repeat(MAX_SOURCE_CHARS), [{ input: "1" }]), null);
});

test("empty or whitespace-only code is refused", () => {
  assert.match(attemptLimitError(""), /empty/);
  assert.match(attemptLimitError("  \n\t"), /empty/);
});

test("code over the server's limit is refused", () => {
  assert.match(attemptLimitError("x".repeat(MAX_SOURCE_CHARS + 1)), /too large/);
});

test("too many custom cases are refused", () => {
  const cases = Array.from({ length: 21 }, () => ({ input: "1" }));
  assert.match(attemptLimitError("code", cases), /20 cases/);
});

test("an oversized custom input or expected output is refused", () => {
  const big = "x".repeat(MAX_CASE_CHARS + 1);
  assert.match(attemptLimitError("code", [{ input: big }]), /per case/);
  assert.match(attemptLimitError("code", [{ input: "1", expected: big }]), /per case/);
});

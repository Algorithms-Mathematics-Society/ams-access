import { test } from "node:test";
import assert from "node:assert/strict";
import { ruleLanguage, shortChip } from "./rule-language.ts";

test("the judge's own label never reaches a candidate", () => {
  // Exactly the strings in the screenshot that prompted this.
  assert.equal(ruleLanguage("must_include: std::bit_cast").chip, "Must use std::bit_cast");
  assert.equal(ruleLanguage("must_not_include: \\bmemcpy\\s*\\(").chip, "Must not use memcpy");
  assert.equal(
    ruleLanguage("must_not_include: reinterpret_cast").chip,
    "Must not use reinterpret_cast"
  );
});

test("a setter's own sentence wins over anything generated", () => {
  const written = ruleLanguage(
    "must_not_include: \\bmemcpy\\s*\\(",
    "Copy the bytes yourself; memcpy is the exercise."
  );
  assert.equal(written.sentence, "Copy the bytes yourself; memcpy is the exercise.");
  // The chip stays short either way -- a tab strip is not a paragraph.
  assert.equal(written.chip, "Must not use memcpy");
});

test("a generated sentence is a sentence", () => {
  assert.equal(
    ruleLanguage("must_include: std::bit_cast").sentence,
    "Your solution must use std::bit_cast."
  );
});

test("a pattern too strange to read is not mangled into nonsense", () => {
  const odd = ruleLanguage("must_not_include: ^(?:a|b)+$");
  assert.equal(odd.chip, "Must not use");
  assert.ok(odd.sentence.includes("source rule"));
});

test("a label that is not a rule is left as the setter named it", () => {
  assert.equal(ruleLanguage("no raw loops").chip, "no raw loops");
});

test("chips are trimmed, not reflowed", () => {
  assert.equal(
    shortChip("Must not use something_extremely_long_here"),
    "Must not use something_ex…"
  );
  assert.equal(shortChip("Case 1"), "Case 1");
});

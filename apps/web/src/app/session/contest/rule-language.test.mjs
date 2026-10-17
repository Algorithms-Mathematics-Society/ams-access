import { test } from "node:test";
import assert from "node:assert/strict";
import { behaviourLanguage, ruleLanguage, shortChip } from "./rule-language.ts";

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

test("a GTest name becomes the sentence it started as", () => {
  // Exactly the strings in the screenshot that prompted this.
  assert.equal(
    behaviourLanguage("PokemonRAII.ConstructionAcquiresAndDestructionReleases").chip,
    "Construction acquires and destruction releases"
  );
  assert.equal(
    behaviourLanguage("PokemonRAII.MoveConstructorTransfersOwnership").chip,
    "Move constructor transfers ownership"
  );
});

test("the suite prefix is dropped — every check in a problem shares it", () => {
  assert.equal(
    behaviourLanguage("PokemonRAII.MoveAssignmentReleasesOld").chip,
    "Move assignment releases old"
  );
  // No suite at all is still fine.
  assert.equal(behaviourLanguage("HandlesEmptyInput").chip, "Handles empty input");
});

test("an acronym stays a word", () => {
  assert.equal(behaviourLanguage("Pokemon.HandlesZeroHP").chip, "Handles zero HP");
  assert.equal(behaviourLanguage("Suite.RAIIHolderReleases").chip, "RAII holder releases");
});

test("underscored names work the same way", () => {
  assert.equal(behaviourLanguage("suite.copy_is_deleted").chip, "Copy is deleted");
});

test("the setter's own sentence wins for the detail pane", () => {
  const described = behaviourLanguage(
    "PokemonRAII.MoveAssignmentReleasesOld",
    "The moved-from object must release the hp it owned."
  );
  assert.equal(described.sentence, "The moved-from object must release the hp it owned.");
  // ...but the chip stays short either way.
  assert.equal(described.chip, "Move assignment releases old");
});

test("an unreadable label is passed through rather than blanked", () => {
  assert.equal(behaviourLanguage("").chip, "Behaviour check");
  assert.equal(behaviourLanguage("...").chip, "...");
});

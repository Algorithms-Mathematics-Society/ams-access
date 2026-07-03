import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { deriveSubmitButton } from "./submit-button.ts";

const BOOLS = [false, true];
const ERRORS = [null, "Submission failed with HTTP 500"];
const allStates = () => {
  const out = [];
  for (const isSubmitting of BOOLS)
    for (const submissionError of ERRORS)
      for (const hasSession of BOOLS)
        for (const editorEmpty of BOOLS)
          out.push({ isSubmitting, submissionError, hasSession, editorEmpty });
  return out;
};

test("label set is exactly {Submit, Submitting, Submit Failed} — never a save label", () => {
  const allowed = new Set(["Submit", "Submitting", "Submit Failed"]);
  for (const s of allStates()) {
    const v = deriveSubmitButton(s);
    assert.ok(allowed.has(v.label), `label ${v.label} not allowed for ${JSON.stringify(s)}`);
    assert.ok(!/sav/i.test(v.label), `save-language leaked into label for ${JSON.stringify(s)}`);
  }
});

test("precedence: isSubmitting wins over submissionError; error shows Submit Failed", () => {
  assert.equal(
    deriveSubmitButton({
      isSubmitting: true,
      submissionError: "x",
      hasSession: true,
      editorEmpty: false,
    }).label,
    "Submitting"
  );
  assert.equal(
    deriveSubmitButton({
      isSubmitting: false,
      submissionError: "x",
      hasSession: true,
      editorEmpty: false,
    }).label,
    "Submit Failed"
  );
});

test("disabled ⇔ isSubmitting || !hasSession || editorEmpty (all 16 combos)", () => {
  for (const s of allStates()) {
    const expected = s.isSubmitting || !s.hasSession || s.editorEmpty;
    assert.equal(deriveSubmitButton(s).disabled, expected, JSON.stringify(s));
  }
});

test("spinner icon iff submitting", () => {
  for (const s of allStates()) {
    assert.equal(deriveSubmitButton(s).icon === "spinner", s.isSubmitting, JSON.stringify(s));
  }
});

// PROVEN-SENSITIVE decoupling guard: the module SOURCE must contain no save-state
// identifiers. Adding a save field to SubmitButtonState (or reading saveError etc.)
// makes this fail and names the leak.
const SAVE_IDENTIFIERS = /\b(saving|saveError|hasUnsavedChanges|savedLocallyOnly|saveInFlight)\b/;

test("module source contains no save-state identifiers (decoupled by construction)", () => {
  const src = readFileSync(new URL("./submit-button.ts", import.meta.url), "utf8");
  const hit = src.match(SAVE_IDENTIFIERS);
  assert.equal(hit, null, `save identifier "${hit?.[0]}" leaked into submit-button.ts`);
});

test("sensitivity fixture: the detector bites on a save field", () => {
  assert.ok(SAVE_IDENTIFIERS.test("saving: boolean;"), "detector must flag a saving field");
  assert.ok(SAVE_IDENTIFIERS.test("state.saveError"), "detector must flag saveError reads");
});

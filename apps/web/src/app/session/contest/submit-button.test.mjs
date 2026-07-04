import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { deriveSubmitButton } from "./submit-button.ts";

const BOOLS = [false, true];
const ERRORS = [null, "Submission failed with HTTP 500"];
const S = (over = {}) => ({
  isSubmitting: false,
  submissionError: null,
  hasSession: true,
  editorEmpty: false,
  judgingPending: false,
  ...over,
});
const allStates = () => {
  const out = [];
  for (const isSubmitting of BOOLS)
    for (const submissionError of ERRORS)
      for (const hasSession of BOOLS)
        for (const editorEmpty of BOOLS)
          for (const judgingPending of BOOLS)
            out.push({ isSubmitting, submissionError, hasSession, editorEmpty, judgingPending });
  return out;
};

test("label set is exactly {Submit, Submitting, Judging…, Submit Failed} — never a save label", () => {
  const allowed = new Set(["Submit", "Submitting", "Judging…", "Submit Failed"]);
  for (const s of allStates()) {
    const v = deriveSubmitButton(s);
    assert.ok(allowed.has(v.label), `label ${v.label} not allowed for ${JSON.stringify(s)}`);
    assert.ok(!/sav/i.test(v.label), `save-language leaked into label for ${JSON.stringify(s)}`);
  }
});

test("precedence: isSubmitting wins over submissionError; error shows Submit Failed", () => {
  assert.equal(
    deriveSubmitButton(S({ isSubmitting: true, submissionError: "x" })).label,
    "Submitting"
  );
  assert.equal(deriveSubmitButton(S({ submissionError: "x" })).label, "Submit Failed");
});

test("precedence: isSubmitting wins over judgingPending", () => {
  assert.equal(
    deriveSubmitButton(S({ isSubmitting: true, judgingPending: true })).label,
    "Submitting"
  );
});

test("precedence: judgingPending wins over submissionError", () => {
  assert.equal(
    deriveSubmitButton(S({ judgingPending: true, submissionError: "x" })).label,
    "Judging…"
  );
});

test("disabled ⇔ isSubmitting || judgingPending || !hasSession || editorEmpty (all 32 combos)", () => {
  for (const s of allStates()) {
    const expected = s.isSubmitting || s.judgingPending || !s.hasSession || s.editorEmpty;
    assert.equal(deriveSubmitButton(s).disabled, expected, JSON.stringify(s));
  }
});

test("spinner icon iff submitting or judgingPending", () => {
  for (const s of allStates()) {
    assert.equal(
      deriveSubmitButton(s).icon === "spinner",
      s.isSubmitting || s.judgingPending,
      JSON.stringify(s)
    );
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

import test from "node:test";
import assert from "node:assert/strict";

import { saveErrorAfterEdit } from "./save-edit-state.ts";
import { deriveSaveIndicator } from "./save-indicator.ts";

test("SAFETY: an edit preserves a prior save failure (sticky, not cleared by typing)", () => {
  const failure = "Save failed. Check your connection and retry before submitting.";
  assert.equal(
    saveErrorAfterEdit(failure),
    failure,
    "a non-empty failure string must SURVIVE an edit — clearing it would repaint a" +
      " genuine 'Not saved' warning to a benign 'Saving…' the moment the candidate types"
  );
});

test("an edit introduces no spurious error when there was none", () => {
  assert.equal(saveErrorAfterEdit(null), null);
});

test("integration: the preserved error still renders as NOT-saved after an edit", () => {
  const failure = "Save failed — your work is saved locally and will retry automatically.";
  const afterEdit = saveErrorAfterEdit(failure);
  const indicator = deriveSaveIndicator({
    saveError: afterEdit,
    saving: false,
    // an edit sets hasUnsavedChanges true, but error must win regardless
    hasUnsavedChanges: true,
  });
  assert.equal(indicator.icon, "error");
  assert.equal(indicator.label, "Couldn't save — retrying");
});

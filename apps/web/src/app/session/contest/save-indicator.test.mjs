import test from "node:test";
import assert from "node:assert/strict";

import { deriveSaveIndicator } from "./save-indicator.ts";

const S = (over = {}) => ({ saveError: null, saving: false, hasUnsavedChanges: false, ...over });

test("SAFETY: 'All changes saved' ONLY when no error, not saving, nothing unsaved", () => {
  // The one and only state that may claim saved.
  const saved = deriveSaveIndicator(S());
  assert.equal(saved.label, "All changes saved");
  assert.equal(saved.icon, "saved");

  // Every state with ANY of error/saving/unsaved set must NOT read as saved.
  for (const over of [
    { saveError: "boom" },
    { saving: true },
    { hasUnsavedChanges: true },
    { saveError: "boom", saving: true },
    { saveError: "boom", hasUnsavedChanges: true },
    { saving: true, hasUnsavedChanges: true },
    { saveError: "boom", saving: true, hasUnsavedChanges: true },
  ]) {
    const ind = deriveSaveIndicator(S(over));
    assert.notEqual(ind.icon, "saved", `icon must not be 'saved' for ${JSON.stringify(over)}`);
    assert.notEqual(
      ind.label,
      "All changes saved",
      `label must not be saved for ${JSON.stringify(over)}`
    );
  }
});

test("a failed/timed-out save surfaces a distinct NOT-saved state (error wins over everything)", () => {
  const ind = deriveSaveIndicator(
    S({ saveError: "Save failed", saving: true, hasUnsavedChanges: true })
  );
  assert.equal(ind.label, "Couldn't save — retrying");
  assert.equal(ind.icon, "error");
});

test("precedence: saving beats unsaved; each maps to its icon", () => {
  assert.equal(deriveSaveIndicator(S({ saving: true })).icon, "loading");
  assert.equal(deriveSaveIndicator(S({ saving: true })).label, "Saving…");
  assert.equal(deriveSaveIndicator(S({ hasUnsavedChanges: true })).icon, "pending");
  assert.equal(deriveSaveIndicator(S({ hasUnsavedChanges: true })).label, "Saving…");
});

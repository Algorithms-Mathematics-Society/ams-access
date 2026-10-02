import test from "node:test";
import assert from "node:assert/strict";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo } from "@codemirror/commands";
import { DEFAULT_EDITOR_PREFERENCES, editorPreferenceExtensions, parseEditorPreferences } from "./editor-preferences.ts";
import { editorLockExtensions } from "./editor-lock.ts";

test("missing, corrupt and non-object preferences retain readable defaults", () => {
  for (const value of [null, "invalid", "null", "[]", "42", '"text"']) {
    assert.deepEqual(parseEditorPreferences(value), DEFAULT_EDITOR_PREFERENCES);
  }
});

test("valid font size and explicit wrap-off survive storage round trips", () => {
  for (let fontSize = 12; fontSize <= 20; fontSize++) {
    const preferences = { fontSize, wordWrap: false };
    assert.deepEqual(parseEditorPreferences(JSON.stringify(preferences)), preferences);
  }
});

test("each invalid preference falls back independently without coercion", () => {
  for (const fontSize of [0, 11, 21, 1000000, 13.5, "16", null]) {
    assert.deepEqual(parseEditorPreferences(JSON.stringify({ fontSize, wordWrap: false })), { fontSize: 13, wordWrap: false });
  }
  for (const wordWrap of [0, 1, "false", null]) {
    assert.deepEqual(parseEditorPreferences(JSON.stringify({ fontSize: 18, wordWrap })), { fontSize: 18, wordWrap: true });
  }
});

test("preference changes preserve edited text, selection and undo/redo history", () => {
  const compartment = new Compartment();
  let state = EditorState.create({
    doc: "int n = 1;",
    selection: EditorSelection.cursor(9),
    extensions: [history(), compartment.of(editorPreferenceExtensions(DEFAULT_EDITOR_PREFERENCES))],
  });
  state = state.update({ changes: { from: 8, to: 9, insert: "100" }, selection: EditorSelection.cursor(11) }).state;
  state = state.update({ effects: compartment.reconfigure(editorPreferenceExtensions({ fontSize: 20, wordWrap: false })) }).state;
  assert.equal(state.doc.toString(), "int n = 100;");
  assert.equal(state.selection.main.head, 11);
  const target = { get state() { return state; }, dispatch(transaction) { state = transaction.state; } };
  assert.equal(undo(target), true);
  assert.equal(state.doc.toString(), "int n = 1;");
  assert.equal(redo(target), true);
  assert.equal(state.doc.toString(), "int n = 100;");
});

test("presentation changes cannot unlock a read-only editor", () => {
  const compartment = new Compartment();
  let state = EditorState.create({ doc: "answer", extensions: [editorLockExtensions(true), compartment.of(editorPreferenceExtensions(DEFAULT_EDITOR_PREFERENCES))] });
  for (const wordWrap of [false, true]) {
    state = state.update({ effects: compartment.reconfigure(editorPreferenceExtensions({ fontSize: 18, wordWrap })) }).state;
    assert.equal(state.readOnly, true);
    assert.equal(state.facet(EditorView.editable), false);
    assert.equal(state.doc.toString(), "answer");
    const classes = state.facet(EditorView.contentAttributes).filter((value) => typeof value === "object").map((value) => value.class || "").join(" ");
    assert.equal(classes.includes("cm-lineWrapping"), wordWrap);
  }
});

test("equivalent preferences reuse bounded style modules across editor recreations", () => {
  const entries = new Set();
  for (let fontSize = 12; fontSize <= 20; fontSize++) {
    for (const wordWrap of [false, true]) {
      const extension = editorPreferenceExtensions({ fontSize, wordWrap });
      entries.add(extension);
      assert.equal(editorPreferenceExtensions({ fontSize, wordWrap }), extension);
    }
  }
  assert.equal(entries.size, 18);
  for (const fontSize of [0, 100, 100000, NaN, Infinity]) {
    assert.equal(editorPreferenceExtensions({ fontSize, wordWrap: true }),
      editorPreferenceExtensions(DEFAULT_EDITOR_PREFERENCES));
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { Compartment, EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { indentMore, deleteCharBackward, toggleComment } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { editorLockExtensions } from "./editor-lock.ts";

function editorTarget(readOnly) {
  const lock = new Compartment();
  let state = EditorState.create({
    doc: "int value = 1;",
    selection: EditorSelection.cursor(4),
    extensions: [cpp(), lock.of(editorLockExtensions(readOnly))],
  });
  return {
    lock,
    get state() { return state; },
    dispatch(transaction) { state = transaction.state; },
    reconfigure(value) { state = state.update({ effects: lock.reconfigure(editorLockExtensions(value)) }).state; },
  };
}

test("locked editor blocks edit commands as well as DOM input", () => {
  const target = editorTarget(true);
  const initial = target.state.doc.toString();
  assert.equal(target.state.facet(EditorView.editable), false);
  assert.equal(target.state.readOnly, true);
  for (const command of [indentMore, deleteCharBackward, toggleComment]) {
    assert.equal(command(target), false);
    assert.equal(target.state.doc.toString(), initial);
  }
});

test("unlock restores editing without discarding current text or selection", () => {
  const target = editorTarget(false);
  indentMore(target);
  const edited = target.state.doc.toString();
  const cursor = target.state.selection.main.head;
  target.reconfigure(true);
  assert.equal(indentMore(target), false);
  assert.equal(target.state.doc.toString(), edited);
  assert.equal(target.state.selection.main.head, cursor);
  target.reconfigure(false);
  assert.equal(target.state.facet(EditorView.editable), true);
  assert.equal(indentMore(target), true);
  assert.notEqual(target.state.doc.toString(), edited);
});

test("locked editor still permits external draft synchronization", () => {
  const target = editorTarget(true);
  const transaction = target.state.update({ changes: { from: 0, to: target.state.doc.length, insert: "restored answer" } });
  target.dispatch(transaction);
  assert.equal(target.state.doc.toString(), "restored answer");
  assert.equal(target.state.readOnly, true);
});

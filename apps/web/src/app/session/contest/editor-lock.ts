import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Preserve selection/copy while preventing both typing and editing commands. */
export function editorLockExtensions(readOnly: boolean): Extension[] {
  return [EditorView.editable.of(!readOnly), EditorState.readOnly.of(readOnly)];
}

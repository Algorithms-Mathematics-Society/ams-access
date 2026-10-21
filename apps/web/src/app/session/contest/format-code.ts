/**
 * Re-indent the editor's contents.
 *
 * Indentation only. This walks the document with the language's own
 * indentation rules -- the same ones that place the cursor when you press
 * Enter -- and rewrites the leading whitespace of each line. It does not
 * insert line breaks, touch spacing around operators, or reorder anything.
 *
 * That restraint is the point. A candidate has one shot at a problem under
 * time pressure, and a formatter that rewrites their code has to be perfect
 * or it is worse than none at all. Changing only leading whitespace cannot
 * change what the program does, cannot lose a character, and is undoable in
 * one keystroke because it is a single transaction.
 *
 * It also costs nothing to ship. clang-format proper means a WASM blob that
 * has to be downloaded at build time, pinned, bundled as a Tauri resource
 * and kept inside the size budget -- all so the exam machine can reach it
 * offline. This is already in the editor.
 */

import { indentRange, indentUnit } from "@codemirror/language";
import { ChangeSet, EditorState } from "@codemirror/state";
import type { ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/**
 * Four spaces, because that is what the starter files are written in.
 *
 * CodeMirror defaults to two. Left at the default, formatting a starter
 * would silently restyle every setter's skeleton on the way into the pane,
 * which is a change nobody asked for and the first thing a candidate sees.
 */
export const CONTEST_INDENT_UNIT = "    ";

/**
 * Access specifiers sit at the class's own level.
 *
 * The grammar's indentation treats `public:` as a statement inside the class
 * body and pushes it in a level, which is not how C++ is written anywhere --
 * not in the starter files, not by clang-format's default, not in the
 * standard library. Left alone, formatting would restyle every skeleton into
 * something that reads as wrong to anyone who writes C++.
 *
 * Whitespace only, like the rest of this module.
 */
const ACCESS_SPECIFIER = /^([ \t]*)(public|private|protected)[ \t]*:/;

function outdentAccessSpecifiers(state: EditorState): ChangeSpec[] {
  const unit = CONTEST_INDENT_UNIT.length;
  const changes: ChangeSpec[] = [];
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    const match = ACCESS_SPECIFIER.exec(line.text);
    if (!match) continue;
    const indent = match[1];
    // Only when there is a whole level to give back, and only spaces: a file
    // indented with tabs is one this has no business rewriting.
    if (indent.length < unit || indent.includes("\t")) continue;
    changes.push({ from: line.from, to: line.from + unit, insert: "" });
  }
  return changes;
}

/** Indentation changes for a whole document, grammar rules plus the one
 *  correction above, composed so they land as a single undo step. */
function formatChanges(state: EditorState): ChangeSet {
  const indented = indentRange(state, 0, state.doc.length);
  const after = state.update({ changes: indented }).state;
  const fixes = outdentAccessSpecifiers(after);
  if (fixes.length === 0) return indented;
  return indented.compose(ChangeSet.of(fixes, after.doc.length));
}

/**
 * Re-indent a whole document in one transaction.
 *
 * Returns false when nothing needed changing, so a caller can stay quiet
 * rather than announce work it did not do.
 */
export function formatView(view: EditorView): boolean {
  const changes = formatChanges(view.state);
  if (changes.empty) return false;
  view.dispatch({
    changes,
    // Named so history groups it as one undo step, and so the change is
    // distinguishable from typing in anything that inspects user events.
    userEvent: "format",
  });
  return true;
}

/**
 * The same, for text with no editor attached -- a starter file on its way
 * into the pane. Builds a throwaway state so the indentation rules come from
 * the same grammar the editor will use.
 */
export function formatSource(source: string, languageExtensions: Extension[]): string {
  if (!source.trim()) return source;
  try {
    const state = EditorState.create({
      doc: source,
      extensions: [indentUnit.of(CONTEST_INDENT_UNIT), languageExtensions],
    });
    const changes = formatChanges(state);
    if (changes.empty) return source;
    return state.update({ changes }).state.doc.toString();
  } catch {
    // A grammar that cannot parse the file is not a reason to withhold it.
    // Hand back exactly what came in.
    return source;
  }
}

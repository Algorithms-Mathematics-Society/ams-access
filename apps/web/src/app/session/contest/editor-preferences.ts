import { Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export type EditorPreferences = { fontSize: number; wordWrap: boolean };
export const EDITOR_PREFERENCES_KEY = "ams:contest-editor-preferences:v1";
export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = { fontSize: 13, wordWrap: true };
export const EDITOR_FONT_SIZES = [12, 13, 14, 15, 16, 17, 18, 19, 20];

/** Stored presentation preferences are untrusted and never affect editor content. */
export function parseEditorPreferences(serialized: string | null): EditorPreferences {
  try {
    const value: unknown = serialized ? JSON.parse(serialized) : null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_EDITOR_PREFERENCES };
    const stored = value as Record<string, unknown>;
    return {
      fontSize: typeof stored.fontSize === "number" && EDITOR_FONT_SIZES.includes(stored.fontSize) ? stored.fontSize : 13,
      wordWrap: typeof stored.wordWrap === "boolean" ? stored.wordWrap : true,
    };
  } catch {
    return { ...DEFAULT_EDITOR_PREFERENCES };
  }
}

/** Reconfigure this compartment; never rebuild the editor for visual preferences. */
export function editorPreferenceExtensions(preferences: EditorPreferences): Extension[] {
  return [
    Prec.highest(EditorView.theme({ "&": { fontSize: `${preferences.fontSize}px` } })),
    ...(preferences.wordWrap ? [EditorView.lineWrapping] : []),
  ];
}

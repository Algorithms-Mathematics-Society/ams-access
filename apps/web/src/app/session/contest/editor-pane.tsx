"use client";

import { useEffect, useMemo, useRef } from "react";
import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  snippetCompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  toggleComment,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  HighlightStyle,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

type EditorPaneProps = {
  activeQ: number;
  activeTab: string;
  currentCode: string;
  onCodeChange: (value: string) => void;
  editorTheme: ContestEditorThemeId;
  selectedLanguage: string;
};

export const CONTEST_EDITOR_THEMES: Array<{ id: ContestEditorThemeId; label: string }> = [
  { id: "ams-terminal", label: "AMS Terminal" },
  { id: "monaco-dark", label: "VS Code Dark+" },
  { id: "monaco-light", label: "VS Code Light" },
  { id: "high-contrast", label: "High Contrast" },
];

export type ContestEditorThemeId =
  | "ams-terminal"
  | "monaco-dark"
  | "monaco-light"
  | "high-contrast";

type ContestEditorTheme = {
  label: string;
  dark: boolean;
  surface: string;
  text: string;
  fontSize: string;
  line: string;
  gutter: string;
  gutterText: string;
  gutterActive: string;
  activeLine: string;
  selection: string;
  cursor: string;
  focus: string;
  tooltip: string;
  tooltipText: string;
  selected: string;
  selectedText: string;
  muted: string;
  search: string;
  input: string;
  inputBorder: string;
  button: string;
  buttonBorder: string;
  keyword: string;
  typeName: string;
  functionName: string;
  variableName: string;
  string: string;
  number: string;
  comment: string;
  operator: string;
};

const cppKeywordCompletions: Completion[] = [
  "alignas",
  "alignof",
  "auto",
  "bool",
  "break",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "constexpr",
  "continue",
  "decltype",
  "default",
  "delete",
  "do",
  "double",
  "else",
  "enum",
  "explicit",
  "false",
  "float",
  "for",
  "friend",
  "if",
  "inline",
  "int",
  "long",
  "namespace",
  "new",
  "nullptr",
  "private",
  "protected",
  "public",
  "return",
  "short",
  "signed",
  "sizeof",
  "static",
  "struct",
  "switch",
  "template",
  "this",
  "throw",
  "true",
  "try",
  "typedef",
  "typename",
  "using",
  "void",
  "while",
].map((label) => ({ label, type: "keyword" }));

const cppStdCompletions: Completion[] = [
  { label: "cin", type: "variable", detail: "std::istream" },
  { label: "cout", type: "variable", detail: "std::ostream" },
  { label: "cerr", type: "variable", detail: "std::ostream" },
  { label: "vector", type: "class", detail: "std::vector<T>" },
  { label: "array", type: "class", detail: "std::array<T, N>" },
  { label: "string", type: "class", detail: "std::string" },
  { label: "pair", type: "class", detail: "std::pair<T, U>" },
  { label: "tuple", type: "class", detail: "std::tuple" },
  { label: "map", type: "class", detail: "std::map<K, V>" },
  { label: "unordered_map", type: "class", detail: "std::unordered_map<K, V>" },
  { label: "set", type: "class", detail: "std::set<T>" },
  { label: "unordered_set", type: "class", detail: "std::unordered_set<T>" },
  { label: "queue", type: "class", detail: "std::queue<T>" },
  { label: "priority_queue", type: "class", detail: "std::priority_queue<T>" },
  { label: "deque", type: "class", detail: "std::deque<T>" },
  { label: "stack", type: "class", detail: "std::stack<T>" },
  { label: "sort", type: "function", apply: "sort(v.begin(), v.end())", detail: "<algorithm>" },
  {
    label: "stable_sort",
    type: "function",
    apply: "stable_sort(v.begin(), v.end())",
    detail: "<algorithm>",
  },
  {
    label: "reverse",
    type: "function",
    apply: "reverse(v.begin(), v.end())",
    detail: "<algorithm>",
  },
  {
    label: "lower_bound",
    type: "function",
    apply: "lower_bound(v.begin(), v.end(), x)",
    detail: "<algorithm>",
  },
  {
    label: "upper_bound",
    type: "function",
    apply: "upper_bound(v.begin(), v.end(), x)",
    detail: "<algorithm>",
  },
  {
    label: "binary_search",
    type: "function",
    apply: "binary_search(v.begin(), v.end(), x)",
    detail: "<algorithm>",
  },
  { label: "min", type: "function", detail: "std::min" },
  { label: "max", type: "function", detail: "std::max" },
  { label: "swap", type: "function", detail: "std::swap" },
  { label: "gcd", type: "function", detail: "std::gcd" },
  { label: "lcm", type: "function", detail: "std::lcm" },
  { label: "abs", type: "function", detail: "std::abs" },
  {
    label: "accumulate",
    type: "function",
    apply: "accumulate(v.begin(), v.end(), 0LL)",
    detail: "<numeric>",
  },
  { label: "iota", type: "function", apply: "iota(v.begin(), v.end(), 0)", detail: "<numeric>" },
  {
    label: "next_permutation",
    type: "function",
    apply: "next_permutation(v.begin(), v.end())",
    detail: "<algorithm>",
  },
  {
    label: "prev_permutation",
    type: "function",
    apply: "prev_permutation(v.begin(), v.end())",
    detail: "<algorithm>",
  },
  { label: "push_back", type: "method", apply: "push_back()", detail: "container method" },
  { label: "emplace_back", type: "method", apply: "emplace_back()", detail: "container method" },
  { label: "begin", type: "method", apply: "begin()", detail: "container method" },
  { label: "end", type: "method", apply: "end()", detail: "container method" },
  { label: "size", type: "method", apply: "size()", detail: "container method" },
  { label: "empty", type: "method", apply: "empty()", detail: "container method" },
];

const cppSnippetCompletions: Completion[] = [
  snippetCompletion(
    "int main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n\n  ${}\n  return 0;\n}",
    { label: "main", type: "snippet", detail: "fast C++ main" }
  ),
  snippetCompletion("for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n  ${}\n}", {
    label: "fori",
    type: "snippet",
    detail: "indexed for loop",
  }),
  snippetCompletion("for (auto &${x} : ${container}) {\n  ${}\n}", {
    label: "fore",
    type: "snippet",
    detail: "range for loop",
  }),
  snippetCompletion("vector<${int}> ${v}(${n});", {
    label: "vec",
    type: "snippet",
    detail: "vector declaration",
  }),
  snippetCompletion("pair<${int}, ${int}> ${p};", {
    label: "pair",
    type: "snippet",
    detail: "pair declaration",
  }),
  snippetCompletion("sort(${v}.begin(), ${v}.end());", {
    label: "sortv",
    type: "snippet",
    detail: "sort vector",
  }),
  snippetCompletion("auto it = lower_bound(${v}.begin(), ${v}.end(), ${x});", {
    label: "lb",
    type: "snippet",
    detail: "lower_bound iterator",
  }),
  snippetCompletion("while (${t}--) {\n  ${}\n}", {
    label: "tcases",
    type: "snippet",
    detail: "test case loop",
  }),
  snippetCompletion("const long long INF = 4e18;", {
    label: "infll",
    type: "snippet",
    detail: "long long infinity",
  }),
  snippetCompletion(
    "queue<${int}> q;\nvector<int> dist(${n}, -1);\ndist[${src}] = 0;\nq.push(${src});\nwhile (!q.empty()) {\n  int u = q.front();\n  q.pop();\n  for (int v : adj[u]) {\n    if (dist[v] != -1) continue;\n    dist[v] = dist[u] + 1;\n    q.push(v);\n  }\n}",
    { label: "bfs", type: "snippet", detail: "BFS template" }
  ),
  snippetCompletion(
    "auto dfs = [&](auto&& self, int u, int p) -> void {\n  ${}\n  for (int v : adj[u]) {\n    if (v == p) continue;\n    self(self, v, u);\n  }\n};",
    { label: "dfs", type: "snippet", detail: "recursive DFS lambda" }
  ),
];

const cppCompletionOptions = [
  ...cppSnippetCompletions,
  ...cppKeywordCompletions,
  ...cppStdCompletions,
];

function cppContestCompletionSource(context: CompletionContext) {
  const token = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*|/);
  if (!token || (token.from === token.to && !context.explicit)) return null;

  return {
    from: token.from,
    options: cppCompletionOptions,
    validFor: /^[A-Za-z_][A-Za-z0-9_]*$/,
  };
}

const contestEditorThemes: Record<ContestEditorThemeId, ContestEditorTheme> = {
  "ams-terminal": {
    label: "AMS Terminal",
    dark: true,
    surface: "#0F0F0F",
    text: "#e2e8f0",
    fontSize: "13px",
    line: "1.7",
    gutter: "#0b0b0b",
    gutterText: "#475569",
    gutterActive: "#111111",
    activeLine: "rgba(168, 85, 247, 0.045)",
    selection: "rgba(168, 85, 247, 0.26)",
    cursor: "#c084fc",
    focus: "rgba(168,85,247,0.3)",
    tooltip: "#111111",
    tooltipText: "#dbeafe",
    selected: "rgba(168, 85, 247, 0.2)",
    selectedText: "#ffffff",
    muted: "#64748b",
    search: "#111111",
    input: "#0F0F0F",
    inputBorder: "#334155",
    button: "#1F1F1F",
    buttonBorder: "#334155",
    keyword: "#c084fc",
    typeName: "#7dd3fc",
    functionName: "#facc15",
    variableName: "#e2e8f0",
    string: "#86efac",
    number: "#fca5a5",
    comment: "#64748b",
    operator: "#a5b4fc",
  },
  "monaco-dark": {
    label: "VS Code Dark+",
    dark: true,
    surface: "#1e1e1e",
    text: "#d4d4d4",
    fontSize: "13px",
    line: "1.7",
    gutter: "#1e1e1e",
    gutterText: "#858585",
    gutterActive: "#2a2d2e",
    activeLine: "#2a2d2e",
    selection: "#264f78",
    cursor: "#aeafad",
    focus: "#007acc",
    tooltip: "#252526",
    tooltipText: "#cccccc",
    selected: "#04395e",
    selectedText: "#ffffff",
    muted: "#858585",
    search: "#252526",
    input: "#3c3c3c",
    inputBorder: "#007acc",
    button: "#0e639c",
    buttonBorder: "#1177bb",
    keyword: "#569cd6",
    typeName: "#4ec9b0",
    functionName: "#dcdcaa",
    variableName: "#9cdcfe",
    string: "#ce9178",
    number: "#b5cea8",
    comment: "#6a9955",
    operator: "#d4d4d4",
  },
  "monaco-light": {
    label: "VS Code Light",
    dark: false,
    surface: "#ffffff",
    text: "#1f1f1f",
    fontSize: "13px",
    line: "1.7",
    gutter: "#f3f3f3",
    gutterText: "#237893",
    gutterActive: "#e8f2ff",
    activeLine: "#f3f8ff",
    selection: "#add6ff",
    cursor: "#000000",
    focus: "#007acc",
    tooltip: "#f8f8f8",
    tooltipText: "#1f1f1f",
    selected: "#d6ebff",
    selectedText: "#000000",
    muted: "#616161",
    search: "#f3f3f3",
    input: "#ffffff",
    inputBorder: "#007acc",
    button: "#e5e5e5",
    buttonBorder: "#c8c8c8",
    keyword: "#0000ff",
    typeName: "#267f99",
    functionName: "#795e26",
    variableName: "#001080",
    string: "#a31515",
    number: "#098658",
    comment: "#008000",
    operator: "#000000",
  },
  "high-contrast": {
    label: "High Contrast",
    dark: true,
    surface: "#000000",
    text: "#ffffff",
    fontSize: "13px",
    line: "1.7",
    gutter: "#000000",
    gutterText: "#ffffff",
    gutterActive: "#1a1a1a",
    activeLine: "#1a1a1a",
    selection: "#f38518",
    cursor: "#ffffff",
    focus: "#ffffff",
    tooltip: "#000000",
    tooltipText: "#ffffff",
    selected: "#094771",
    selectedText: "#ffffff",
    muted: "#d7d7d7",
    search: "#000000",
    input: "#000000",
    inputBorder: "#ffffff",
    button: "#000000",
    buttonBorder: "#ffffff",
    keyword: "#ffff00",
    typeName: "#00ffff",
    functionName: "#00ff00",
    variableName: "#ffffff",
    string: "#ffcc66",
    number: "#00ffff",
    comment: "#7ca668",
    operator: "#ffffff",
  },
};

const editorThemeCompartment = new Compartment();
const languageCompartment = new Compartment();

/**
 * Returns the CodeMirror language extension + matching autocomplete for a given
 * contest language label. Autocomplete lives here (not in createEditorExtensions)
 * so that switching languages cleanly replaces both in a single compartment dispatch.
 */
function resolveLanguageBundle(language: string): Extension[] {
  if (language === "Python3") {
    return [python(), autocompletion({ activateOnTyping: true, maxRenderedOptions: 14 })];
  }
  if (language === "Java17") {
    return [java(), autocompletion({ activateOnTyping: true, maxRenderedOptions: 14 })];
  }
  // Default: C++ (covers C++17, C++20, and any unknown language)
  return [
    cpp(),
    autocompletion({
      override: [cppContestCompletionSource],
      activateOnTyping: true,
      maxRenderedOptions: 14,
    }),
  ];
}

function createContestEditorTheme(themeId: ContestEditorThemeId): Extension {
  const theme = contestEditorThemes[themeId] ?? contestEditorThemes["ams-terminal"];
  return [
    EditorView.theme(
      {
        "&": {
          height: "100%",
          minWidth: "0",
          backgroundColor: theme.surface,
          color: theme.text,
          fontSize: theme.fontSize,
        },
        ".cm-scroller": {
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          lineHeight: theme.line,
        },
        ".cm-content": {
          padding: "15px 19px",
          caretColor: theme.cursor,
        },
        ".cm-line": {
          padding: "0",
        },
        ".cm-gutters": {
          backgroundColor: theme.gutter,
          color: theme.gutterText,
          borderRight: `1px solid ${theme.gutterActive}`,
        },
        ".cm-lineNumbers .cm-gutterElement": {
          minWidth: "31px",
          padding: "0 10px 0 0",
        },
        ".cm-activeLineGutter": {
          backgroundColor: theme.gutterActive,
          color: theme.text,
        },
        ".cm-activeLine": {
          backgroundColor: theme.activeLine,
        },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor: theme.selection,
        },
        ".cm-cursor": {
          borderLeftColor: theme.cursor,
        },
        "&.cm-focused": {
          outline: `1px solid ${theme.focus}`,
          outlineOffset: "-1px",
        },
        ".cm-foldGutter .cm-gutterElement": {
          color: theme.muted,
          cursor: "pointer",
        },
        ".cm-tooltip": {
          backgroundColor: theme.tooltip,
          border: `1px solid ${theme.inputBorder}`,
          color: theme.tooltipText,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "12px",
        },
        ".cm-tooltip-autocomplete ul li[aria-selected]": {
          backgroundColor: theme.selected,
          color: theme.selectedText,
        },
        ".cm-completionDetail": {
          color: theme.muted,
        },
        ".cm-search": {
          backgroundColor: theme.search,
          color: theme.text,
          borderTop: `1px solid ${theme.inputBorder}`,
        },
        ".cm-search input": {
          backgroundColor: theme.input,
          color: theme.text,
          border: `1px solid ${theme.inputBorder}`,
          outline: "none",
        },
        ".cm-button": {
          backgroundImage: "none",
          backgroundColor: theme.button,
          border: `1px solid ${theme.buttonBorder}`,
          color: theme.text,
        },
      },
      { dark: theme.dark }
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: theme.keyword },
        { tag: [tags.typeName, tags.className, tags.namespace], color: theme.typeName },
        {
          tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
          color: theme.functionName,
        },
        { tag: [tags.variableName, tags.propertyName], color: theme.variableName },
        { tag: [tags.string, tags.character], color: theme.string },
        { tag: [tags.number, tags.bool, tags.null], color: theme.number },
        { tag: tags.comment, color: theme.comment, fontStyle: "italic" },
        { tag: [tags.operator, tags.punctuation], color: theme.operator },
      ]),
      { fallback: true }
    ),
  ];
}

/// Tell the native keyboard hook whether bare Escape should be swallowed.
/// While the editor is focused Escape must reach CodeMirror (dismiss
/// autocomplete, close search, cancel selection); everywhere else it stays
/// blocked so it cannot interact with system UI. No-op outside Tauri.
function setNativeEscapeBlocked(blocked: boolean) {
  type TauriGlobal = {
    core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  };
  const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  void tauri?.core.invoke("set_escape_blocked", { blocked }).catch(() => {});
}

function createEditorExtensions(
  onCodeChange: (value: string) => void,
  editorTheme: ContestEditorThemeId,
  language: string
): Extension[] {
  return [
    EditorView.domEventHandlers({
      focus: () => {
        setNativeEscapeBlocked(false);
      },
      blur: () => {
        setNativeEscapeBlocked(true);
      },
    }),
    lineNumbers(),
    foldGutter(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    // Language extension + its autocomplete — swapped via compartment on language change
    languageCompartment.of(resolveLanguageBundle(language)),
    keymap.of([
      { key: "Mod-/", run: toggleComment },
      indentWithTab,
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    EditorView.lineWrapping,
    editorThemeCompartment.of(createContestEditorTheme(editorTheme)),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onCodeChange(update.state.doc.toString());
    }),
  ];
}

export default function EditorPane({
  activeQ,
  activeTab,
  currentCode,
  onCodeChange,
  editorTheme,
  selectedLanguage,
}: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onCodeChangeRef = useRef(onCodeChange);
  const applyingExternalUpdateRef = useRef(false);
  // Ref so the init effect can read the current language without being in its
  // dep array (which would destroy and recreate the editor on every language change).
  const selectedLanguageRef = useRef(selectedLanguage);

  useEffect(() => {
    onCodeChangeRef.current = onCodeChange;
  }, [onCodeChange]);

  useEffect(() => {
    selectedLanguageRef.current = selectedLanguage;
  }, [selectedLanguage]);

  // Extensions are created once — language and theme are reconfigured via compartments.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const extensions = useMemo(
    () =>
      createEditorExtensions(
        (value) => {
          if (!applyingExternalUpdateRef.current) onCodeChangeRef.current(value);
        },
        editorTheme,
        selectedLanguage
      ),
    []
  );

  // Recreate the editor when the active question or file tab changes.
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: currentCode, extensions }),
    });
    viewRef.current = view;

    // Seed the correct language on recreation — the memoised extensions carry the
    // language from mount time; subsequent question/tab switches need the current one.
    view.dispatch({
      effects: languageCompartment.reconfigure(resolveLanguageBundle(selectedLanguageRef.current)),
    });

    return () => {
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
      // The destroyed view never fires blur — re-arm Escape blocking so a
      // tab switch or page exit can never leave Escape passing through.
      setNativeEscapeBlocked(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQ, activeTab, extensions]);

  // Reconfigure theme without recreating the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editorThemeCompartment.reconfigure(createContestEditorTheme(editorTheme)),
    });
  }, [editorTheme]);

  // Reconfigure language (+ its autocomplete) without recreating the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartment.reconfigure(resolveLanguageBundle(selectedLanguage)),
    });
  }, [selectedLanguage]);

  // Sync external content changes (e.g. switching tabs) into the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const existing = view.state.doc.toString();
    if (existing === currentCode) return;

    applyingExternalUpdateRef.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: currentCode },
    });
    applyingExternalUpdateRef.current = false;
  }, [currentCode]);

  return (
    <div
      ref={containerRef}
      className="contest-editor-pane contest-editor-pane--codemirror"
      aria-label={`${activeTab} ${selectedLanguage} editor`}
      data-active-question={activeQ}
      data-active-file={activeTab}
    />
  );
}

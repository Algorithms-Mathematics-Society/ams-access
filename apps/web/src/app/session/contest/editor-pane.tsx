"use client";

import type { KeyboardEvent, RefObject, UIEvent } from "react";

type EditorPaneProps = {
  activeQ: number;
  activeTab: "html" | "css" | "js";
  currentCode: string;
  lineNumbers: number[];
  lineNumberGutterRef: RefObject<HTMLDivElement | null>;
  onCodeChange: (value: string) => void;
  onEditorScroll: (event: UIEvent<HTMLTextAreaElement>) => void;
  onEditorTabKey: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

export default function EditorPane({
  activeQ,
  activeTab,
  currentCode,
  lineNumbers,
  lineNumberGutterRef,
  onCodeChange,
  onEditorScroll,
  onEditorTabKey,
}: EditorPaneProps) {
  return (
    <div className="contest-editor-pane">
      <div
        ref={lineNumberGutterRef}
        aria-hidden="true"
        className="contest-editor-gutter"
      >
        {lineNumbers.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <textarea
        aria-label={`${activeTab.toUpperCase()} answer editor with line numbers`}
        key={`${activeQ}-${activeTab}`}
        value={currentCode}
        onChange={(event) => onCodeChange(event.target.value)}
        onKeyDown={onEditorTabKey}
        onScroll={onEditorScroll}
        spellCheck={false}
        className="contest-editor-textarea"
      />
    </div>
  );
}

import { type Dispatch, type SetStateAction } from "react";
import dynamic from "next/dynamic";
import { Play, Loader2, Send, Check, Plus, X, Settings2 } from "lucide-react";
import { CONTEST_EDITOR_THEMES, type ContestEditorThemeId } from "../editor-pane";
import { type ContestMeta } from "./questions";
import { type SubmitButtonView } from "../submit-button";

// Module-scope so identity + the lazy chunk stay stable across renders (same
// target module as before the move — only the relative import path changed).
const EditorPane = dynamic(() => import("../editor-pane"), {
  ssr: false,
  loading: () => <div style={{ flex: 1, background: "#0F0F0F", borderTop: "1px solid #1F1F1F" }} />,
});

export type EditorFile = {
  id: string;
  name: string;
  content: string;
};

export interface EditorPanelProps {
  editorFiles: EditorFile[];
  activeFileId: string;
  pendingCloseFileId: string | null;
  setPendingCloseFileId: Dispatch<SetStateAction<string | null>>;
  setQuestionActiveFile: Dispatch<SetStateAction<Record<string, string>>>;
  currentQId: string;
  removeEditorFile: (fileId: string) => void;
  addEditorFile: () => void;
  selectedLanguage: string;
  handleLanguageChange: (newLanguage: string) => void;
  contest: ContestMeta | null;
  themeMenuOpen: boolean;
  setThemeMenuOpen: Dispatch<SetStateAction<boolean>>;
  editorTheme: ContestEditorThemeId;
  handleEditorThemeChange: (value: string) => void;
  isRunning: boolean;
  sessionId: string | null;
  triggerRun: () => Promise<void>;
  judgingUnavailableReason: string | null;
  submitButton: SubmitButtonView;
  isSubmitting: boolean;
  isEditorEmpty: boolean;
  handleSubmitSolution: () => Promise<void>;
  submissionError: string | null;
  saveError: string | null;
  activeQ: number;
  activeFile: EditorFile | null;
  currentCode: string;
  handleCodeChange: (value: string) => void;
}

export function EditorPanel({
  editorFiles,
  activeFileId,
  pendingCloseFileId,
  setPendingCloseFileId,
  setQuestionActiveFile,
  currentQId,
  removeEditorFile,
  addEditorFile,
  selectedLanguage,
  handleLanguageChange,
  contest,
  themeMenuOpen,
  setThemeMenuOpen,
  editorTheme,
  handleEditorThemeChange,
  isRunning,
  sessionId,
  triggerRun,
  judgingUnavailableReason,
  submitButton,
  isSubmitting,
  isEditorEmpty,
  handleSubmitSolution,
  submissionError,
  saveError,
  activeQ,
  activeFile,
  currentCode,
  handleCodeChange,
}: EditorPanelProps) {
  const runDisabled = isRunning || !sessionId || Boolean(judgingUnavailableReason);
  const submitDisabled = submitButton.disabled || Boolean(judgingUnavailableReason);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
        boxShadow: "none",
      }}
    >
      {/* Editor Tabs & Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid #1F1F1F",
          background: "#0F0F0F",
          padding: "0 12px",
          gap: "6px",
          flexShrink: 0,
          height: "38px",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            color: "#64748b",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            fontWeight: 600,
            marginRight: "14px",
          }}
        >
          Editor
        </span>
        {editorFiles.map((file) => {
          const isActive = activeFileId === file.id;
          const isScratch = !file.id.endsWith(":main");
          const pendingClose = pendingCloseFileId === file.id;
          return (
            <div
              key={file.id}
              style={{
                display: "flex",
                alignItems: "center",
                border: `1px solid ${isActive ? "rgba(255,255,255,0.08)" : "transparent"}`,
                background: isActive ? "#1F1F1F" : "transparent",
                borderRadius: "6px",
                height: "28px",
                flexShrink: 0,
                position: "relative",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setPendingCloseFileId(null);
                  setQuestionActiveFile((prev) => ({ ...prev, [currentQId]: file.id }));
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: isScratch ? "0 4px 0 10px" : "0 12px",
                  background: "transparent",
                  border: "none",
                  color: isActive ? "#ffffff" : "#475569",
                  fontSize: "11px",
                  fontWeight: 600,
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: "pointer",
                  height: "100%",
                  maxWidth: "160px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={file.name}
              >
                {file.name}
              </button>
              {isScratch && !pendingClose && (
                <button
                  type="button"
                  aria-label={`Close ${file.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingCloseFileId(file.id);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "16px",
                    height: "16px",
                    marginRight: "6px",
                    border: "none",
                    background: "transparent",
                    color: "#475569",
                    fontSize: "12px",
                    lineHeight: 1,
                    cursor: "pointer",
                    borderRadius: "8px",
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "#475569";
                  }}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              )}
              {isScratch && pendingClose && (
                <div
                  role="dialog"
                  aria-label={`Close ${file.name}`}
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    right: "4px",
                    zIndex: 20,
                    width: "190px",
                    padding: "10px",
                    border: "1px solid rgba(245,158,11,0.28)",
                    borderRadius: "8px",
                    background: "#111111",
                    boxShadow: "0 14px 34px rgba(0,0,0,0.38)",
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 8px",
                      fontSize: "11px",
                      color: "#cbd5e1",
                      fontFamily: "Inter, system-ui, sans-serif",
                      lineHeight: 1.35,
                    }}
                  >
                    Close this scratch file?
                  </p>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                    <button
                      type="button"
                      aria-label="Cancel close"
                      title="Cancel"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingCloseFileId(null);
                      }}
                      style={{
                        width: "32px",
                        height: "32px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "1px solid rgba(148,163,184,0.18)",
                        borderRadius: "6px",
                        background: "transparent",
                        color: "#94a3b8",
                        cursor: "pointer",
                      }}
                    >
                      <X size={14} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      aria-label="Confirm close"
                      title="Close file"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingCloseFileId(null);
                        removeEditorFile(file.id);
                      }}
                      style={{
                        width: "32px",
                        height: "32px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "1px solid rgba(34,197,94,0.3)",
                        borderRadius: "6px",
                        background: "rgba(34,197,94,0.1)",
                        color: "#86efac",
                        cursor: "pointer",
                      }}
                    >
                      <Check size={14} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={addEditorFile}
          aria-label="Create new C++ file tab"
          title="Create new C++ file tab"
          style={{
            width: "32px",
            height: "32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid #1F1F1F",
            borderRadius: "6px",
            background: "#0F0F0F",
            color: "#94a3b8",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Plus size={14} strokeWidth={2} />
        </button>
        <div style={{ flex: 1 }} />
        {/* Save state intentionally lives ONLY in the footer trust strip (save icon
            + LED + live region) — no duplicate indicator crowding the Submit area. */}
      </div>

      {/* Execution control strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          gap: "0",
          height: "44px",
          background: "#0F0F0F",
          borderBottom: "1px solid #1F1F1F",
          flexShrink: 0,
        }}
      >
        {/* Language sits at the start of the execution row — opposite Run/Submit,
            not stacked above them — since it's an input to what those buttons do. */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            color: "#64748b",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            whiteSpace: "nowrap",
          }}
        >
          Language
          <select
            aria-label="Programming language"
            value={selectedLanguage}
            onChange={(e) => handleLanguageChange(e.target.value)}
            style={{
              height: "32px",
              border: "1px solid #1F1F1F",
              borderRadius: "var(--radius-sm)",
              background: "#0F0F0F",
              color: "var(--text-soft)",
              fontSize: "12px",
              // The current language reads as instrument/system text.
              fontFamily: "'JetBrains Mono', monospace",
              padding: "0 9px",
              cursor: "pointer",
            }}
          >
            {(contest?.allowed_languages?.length ? contest.allowed_languages : ["C++17"]).map(
              (lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              )
            )}
          </select>
        </label>
        <div style={{ flex: 1 }} />
        {/* Settings group */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setThemeMenuOpen((open) => !open)}
            aria-label="Editor settings"
            title="Editor settings"
            style={{
              width: "34px",
              height: "34px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(148,163,184,0.18)",
              borderRadius: "var(--radius-sm)",
              background: "rgba(148,163,184,0.06)",
              color: "#94a3b8",
              cursor: "pointer",
            }}
          >
            <Settings2 size={15} strokeWidth={1.9} />
          </button>
          {themeMenuOpen && (
            <div
              role="menu"
              aria-label="Editor theme"
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 8px)",
                zIndex: 30,
                width: "210px",
                padding: "8px",
                border: "1px solid rgba(148,163,184,0.16)",
                borderRadius: "8px",
                background: "#111111",
                boxShadow: "0 16px 40px rgba(0,0,0,0.38)",
              }}
            >
              <p
                style={{
                  margin: "2px 4px 8px",
                  color: "#64748b",
                  fontSize: "11px",
                  fontFamily: "Inter, system-ui, sans-serif",
                  fontWeight: 600,
                }}
              >
                Editor theme
              </p>
              {CONTEST_EDITOR_THEMES.map((theme) => {
                const active = editorTheme === theme.id;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => handleEditorThemeChange(theme.id)}
                    style={{
                      width: "100%",
                      minHeight: "32px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      padding: "0 8px",
                      border: "none",
                      borderRadius: "6px",
                      background: active ? "rgb(var(--accent-rgb) / 0.12)" : "transparent",
                      color: active ? "#d8b4fe" : "#cbd5e1",
                      fontSize: "12px",
                      fontFamily: "Inter, system-ui, sans-serif",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span>{theme.label}</span>
                    {active && <Check size={13} strokeWidth={2} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {/* Separator: settings | primary actions */}
        <div
          style={{
            width: "1px",
            height: "22px",
            background: "rgba(255,255,255,0.08)",
            margin: "0 12px",
            flexShrink: 0,
          }}
        />
        {/* Primary actions group: Run + Submit */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            type="button"
            onClick={() => void triggerRun()}
            disabled={runDisabled}
            title={
              judgingUnavailableReason ??
              "Runs your code against the sample tests only — does not count toward your score."
            }
            aria-label="Run on judge"
            style={{
              width: "34px",
              height: "34px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0",
              border: `1px solid ${runDisabled ? "rgba(148,163,184,0.14)" : "rgba(148,163,184,0.22)"}`,
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              color: runDisabled ? "rgba(203,213,225,0.48)" : "#cbd5e1",
              cursor: runDisabled ? "not-allowed" : "pointer",
              opacity: runDisabled ? 0.75 : 1,
              transition:
                "background 150ms ease, border-color 150ms ease, color 150ms ease, transform 120ms ease",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (runDisabled) return;
              e.currentTarget.style.background = "rgba(148,163,184,0.16)";
              e.currentTarget.style.borderColor = "rgba(203,213,225,0.34)";
            }}
            onMouseLeave={(e) => {
              if (runDisabled) return;
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "rgba(148,163,184,0.22)";
              e.currentTarget.style.transform = "scale(1)";
            }}
            onMouseDown={(e) => {
              if (!runDisabled) e.currentTarget.style.transform = "scale(0.98)";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            {isRunning ? (
              <Loader2
                size={15}
                strokeWidth={2}
                style={{ animation: "spin 0.8s linear infinite" }}
              />
            ) : (
              <Play size={15} strokeWidth={2} />
            )}
          </button>
          <button
            type="button"
            onClick={handleSubmitSolution}
            disabled={submitDisabled}
            title={
              judgingUnavailableReason ??
              (isSubmitting
                ? "Submitting…"
                : !sessionId
                  ? "Waiting for your session…"
                  : isEditorEmpty
                    ? "Write some code to submit"
                    : "Submit your solution for scoring")
            }
            style={{
              height: "40px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              padding: "0 22px",
              border: `1px solid ${submitDisabled ? "rgb(var(--accent-rgb) / 0.24)" : "var(--color-accent-base)"}`,
              borderRadius: "var(--radius-md)",
              background: submitDisabled
                ? "rgb(var(--accent-rgb) / 0.14)"
                : "var(--color-accent-base)",
              color: submitDisabled ? "rgba(255,255,255,0.58)" : "#ffffff",
              fontSize: "13px",
              fontWeight: 600,
              fontFamily: "Inter, system-ui, sans-serif",
              cursor: submitDisabled ? "not-allowed" : "pointer",
              opacity: submitDisabled ? 0.82 : 1,
              boxShadow: "none",
              transition:
                "background-color var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast)",
            }}
            onMouseEnter={(e) => {
              if (submitDisabled) return;
              // Dominant: lighten + lift + accent glow so Submit never reads
              // as a peer of the quiet outline Run button.
              e.currentTarget.style.background =
                "color-mix(in srgb, var(--color-accent-base), #fff 12%)";
              e.currentTarget.style.borderColor = "var(--color-accent-light)";
              e.currentTarget.style.transform = "translateY(-1px) scale(1.02)";
              e.currentTarget.style.boxShadow = "0 4px 14px rgb(var(--accent-rgb) / 0.35)";
            }}
            onMouseLeave={(e) => {
              if (submitDisabled) return;
              e.currentTarget.style.background = "var(--color-accent-base)";
              e.currentTarget.style.borderColor = "var(--color-accent-base)";
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "none";
            }}
            onMouseDown={(e) => {
              if (!submitDisabled) e.currentTarget.style.transform = "translateY(0) scale(0.98)";
            }}
            onMouseUp={(e) => {
              if (!submitDisabled) e.currentTarget.style.transform = "translateY(-1px) scale(1.02)";
            }}
          >
            {submitButton.icon === "spinner" ? (
              <Loader2
                size={15}
                strokeWidth={2}
                style={{ animation: "spin 0.8s linear infinite" }}
              />
            ) : (
              <Send size={15} strokeWidth={2} />
            )}
            {submitButton.label}
          </button>
        </div>
        {/* end primary actions group */}
      </div>

      {judgingUnavailableReason && (
        <div
          role="status"
          style={{
            padding: "6px 12px",
            borderBottom: "1px solid rgba(245,158,11,0.2)",
            color: "#fcd34d",
            background: "rgba(245,158,11,0.06)",
            fontSize: "11px",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          {judgingUnavailableReason}
        </div>
      )}

      {submissionError && (
        <div
          role="status"
          style={{
            padding: "6px 12px",
            borderBottom: "1px solid rgba(239,68,68,0.2)",
            color: "#fca5a5",
            background: "rgba(239,68,68,0.06)",
            fontSize: "11px",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          {submissionError}
        </div>
      )}

      {saveError && (
        <div
          role="status"
          style={{
            padding: "6px 12px",
            borderBottom: "1px solid rgba(239,68,68,0.2)",
            color: "#fca5a5",
            background: "rgba(239,68,68,0.06)",
            fontSize: "11px",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          {saveError}
        </div>
      )}

      {/* Editor Textarea */}
      <EditorPane
        activeQ={activeQ}
        activeTab={activeFile?.name ?? "main.cpp"}
        currentCode={currentCode}
        onCodeChange={handleCodeChange}
        editorTheme={editorTheme}
        selectedLanguage={selectedLanguage}
        problemId={currentQId}
      />
    </div>
  );
}

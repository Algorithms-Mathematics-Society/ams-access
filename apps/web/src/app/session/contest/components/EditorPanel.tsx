import type { DiagnosticNavigation } from "../compiler-diagnostics";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import dynamic from "next/dynamic";
import { Play, Send, Check, Plus, X, Settings2 } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Card } from "@astryxdesign/core/Card";
import { Banner } from "@astryxdesign/core/Banner";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Switch } from "@astryxdesign/core/Switch";
import { DEFAULT_EDITOR_PREFERENCES, EDITOR_FONT_SIZES, EDITOR_PREFERENCES_KEY, parseEditorPreferences, type EditorPreferences } from "../editor-preferences";
import { CONTEST_EDITOR_THEMES, type ContestEditorThemeId } from "../editor-pane";
import { type ContestMeta } from "./questions";
import { type SubmitButtonView } from "../submit-button";

// Module-scope so identity + the lazy chunk stay stable across renders (same
// target module as before the move — only the relative import path changed).
const EditorPane = dynamic(() => import("../editor-pane"), {
  ssr: false,
  loading: () => (
    <VStack gap={3} align="center" justify="center" role="status" style={{ flex: 1, minHeight: 0, background: "var(--color-background-surface)" }}>
      <Spinner size="sm" />
      <Text type="supporting" color="secondary">Loading editor…</Text>
    </VStack>
  ),
});

export type EditorFile = {
  id: string;
  name: string;
  content: string;
};

export interface EditorPanelProps {
  diagnosticNavigation?: DiagnosticNavigation | null;
  editorFiles: EditorFile[];
  activeFileId: string;
  pendingCloseFileId: string | null;
  setPendingCloseFileId: Dispatch<SetStateAction<string | null>>;
  setQuestionActiveFile: Dispatch<SetStateAction<Record<string, string>>>;
  currentQId: string;
  onSelectFile: (fileId: string) => void;
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
  readOnly: boolean;
  draftStatusLabel?: string;
  lastSubmissionLabel?: string;
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
  diagnosticNavigation,
  editorFiles,
  activeFileId,
  pendingCloseFileId,
  setPendingCloseFileId,
  onSelectFile,
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
  readOnly,
  draftStatusLabel = "Save status unavailable",
  lastSubmissionLabel = "Not submitted",
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
  const [preferences, setPreferences] = useState<EditorPreferences>(DEFAULT_EDITOR_PREFERENCES);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [preferencesStorageUnavailable, setPreferencesStorageUnavailable] = useState(false);
  useEffect(() => {
    try { setPreferences(parseEditorPreferences(localStorage.getItem(EDITOR_PREFERENCES_KEY))); }
    catch { setPreferencesStorageUnavailable(true); }
    setPreferencesLoaded(true);
  }, []);
  useEffect(() => {
    if (!preferencesLoaded) return;
    try {
      localStorage.setItem(EDITOR_PREFERENCES_KEY, JSON.stringify(preferences));
      setPreferencesStorageUnavailable(false);
    } catch { setPreferencesStorageUnavailable(true); }
  }, [preferences, preferencesLoaded]);
  const closeSettings = () => {
    setThemeMenuOpen(false);
    document.getElementById("contest-editor-settings-trigger")?.focus();
  };

  useEffect(() => {
    if (!themeMenuOpen) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Higher-priority overlays own focus; never restore behind one.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      setThemeMenuOpen(false);
      document.getElementById("contest-editor-settings-trigger")?.focus();
    };
    const dismissOutside = (event: Event) => {
      const target = event.target as Node;
      if (!document.getElementById("contest-editor-themes")?.contains(target) &&
          !document.getElementById("contest-editor-settings-trigger")?.contains(target)) setThemeMenuOpen(false);
    };
    const resized = () => setThemeMenuOpen(false);
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", dismissOutside);
    window.addEventListener("focusin", dismissOutside);
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", dismissOutside);
      window.removeEventListener("focusin", dismissOutside);
      window.removeEventListener("resize", resized);
    };
  }, [themeMenuOpen, setThemeMenuOpen]);

  const settingsTriggerBottom = themeMenuOpen && typeof document !== "undefined" ? document.getElementById("contest-editor-settings-trigger")?.getBoundingClientRect().bottom ?? 0 : 0;
  const settingsTop = `clamp(var(--spacing-4), calc(${settingsTriggerBottom}px + var(--spacing-2)), calc(100dvh - var(--spacing-10) * 8))`;

  const runDisabled = readOnly || isRunning || !sessionId || Boolean(judgingUnavailableReason);
  const submitDisabled = readOnly || submitButton.disabled || Boolean(judgingUnavailableReason);

  const activeFileName = activeFile?.name ?? "main.cpp";
  const isScratchActive = Boolean(activeFile && !activeFile.id.endsWith(":main"));
  const pendingFile = editorFiles.find((file) => file.id === pendingCloseFileId && !file.id.endsWith(":main"));

  return (
    <VStack gap={0} role="region" aria-label="Code editor" style={{ position: "relative", flex: 1, minHeight: 0, minWidth: 0, borderBottom: "var(--border-width) solid var(--color-border)", background: "var(--color-background-surface)" }}>
      <HStack gap={2} align="center" paddingInline={4} paddingBlock={2} style={{ flexShrink: 0, borderBottom: "var(--border-width) solid var(--color-border)" }}>
        <Text type="supporting" weight="medium" color="secondary">Files</Text>
        <HStack gap={1} align="center" role="group" aria-label="Editor files" style={{ flex: 1, minWidth: 0, overflowX: "auto", paddingBlock: "var(--spacing-1)" }}>
          {editorFiles.map((file) => {
            const isActive = activeFileId === file.id;
            const isScratch = !file.id.endsWith(":main");
            return (
              <HStack key={file.id} gap={0} align="center" style={{ flexShrink: 0, borderRadius: "var(--radius-element)", background: isActive ? "var(--color-background-muted)" : "transparent" }}>
                <Button
                  label={file.name}
                  {...{ title: file.name }}
                  variant="ghost"
                  size="sm"
                  aria-pressed={isActive}
                  onClick={() => {
                    setPendingCloseFileId(null);
                    onSelectFile(file.id);
                  }}
                  style={{ maxWidth: "calc(var(--spacing-10) * 4)", color: isActive ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}
                >
                  <Text type="code" maxLines={1}>{file.name}</Text>
                </Button>
                {isScratch && (
                  <IconButton label={`Close ${file.name}`} isDisabled={readOnly} variant="ghost" size="sm" icon={<X size={14} aria-hidden="true" />} onClick={(e) => {
                    e.stopPropagation();
                    setPendingCloseFileId(file.id);
                  }} />
                )}
              </HStack>
            );
          })}
        </HStack>
        <IconButton label="Create new C++ file tab" {...{ title: "Add a scratch file" }} variant="ghost" isDisabled={readOnly} icon={<Plus size={16} aria-hidden="true" />} onClick={addEditorFile} />
      </HStack>

      <HStack gap={3} align="center" justify="between" wrap="wrap" paddingInline={4} paddingBlock={3} style={{ flexShrink: 0, borderBottom: "var(--border-width) solid var(--color-border)" }}>
        <HStack gap={2} align="center">
          <label htmlFor="contest-language"><Text type="supporting" color="secondary">Language</Text></label>
          <select
            id="contest-language"
            aria-label="Programming language"
            value={selectedLanguage}
            disabled={readOnly}
            onChange={(e) => handleLanguageChange(e.target.value)}
            style={{ minWidth: 0, height: "var(--spacing-8)", paddingInline: "var(--spacing-2)", border: "var(--border-width) solid var(--color-border)", borderRadius: "var(--radius-element)", background: "var(--color-background-surface)", color: "var(--color-text-primary)", fontFamily: "inherit", fontSize: "var(--font-size-sm)" }}
          >
            {(contest?.allowed_languages?.length ? contest.allowed_languages : ["C++17"]).map((lang) => <option key={lang} value={lang}>{lang}</option>)}
          </select>
        </HStack>
        <HStack gap={2} align="center" wrap="wrap">
          <VStack gap={0}>
            <IconButton id="contest-editor-settings-trigger" label="Editor settings" {...{ title: "Editor settings" }} variant="ghost" aria-expanded={themeMenuOpen} aria-controls="contest-editor-themes" icon={<Settings2 size={16} aria-hidden="true" />} onClick={() => setThemeMenuOpen((open) => !open)} />
            {themeMenuOpen && (
              <Card id="contest-editor-themes" role="group" aria-label="Editor preferences" padding={4} style={{ position: "fixed", top: settingsTop, right: "var(--spacing-4)", zIndex: 30, width: "calc(var(--spacing-10) * 8)", maxWidth: "calc(100vw - var(--spacing-8))", maxHeight: `calc(100dvh - ${settingsTop} - var(--spacing-4))`, overflowY: "auto", border: "var(--border-width) solid var(--color-border)", boxShadow: "var(--shadow-high)" }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeSettings(); } }}>
                <VStack gap={4}>
                  <HStack gap={2} justify="between" align="center">
                    <Text type="label" weight="semibold">Editor preferences</Text>
                    <IconButton label="Close editor preferences" variant="ghost" size="sm" icon={<X size={14} aria-hidden="true" />} onClick={closeSettings} />
                  </HStack>
                  <VStack gap={3}>
                    <HStack justify="between" align="center" gap={3}>
                      <label htmlFor="contest-editor-font-size"><Text type="supporting">Font size</Text></label>
                      <select id="contest-editor-font-size" value={preferences.fontSize} onChange={(event) => setPreferences((previous) => ({ ...previous, fontSize: Number(event.target.value) }))} style={{ height: "var(--spacing-8)", paddingInline: "var(--spacing-2)", border: "var(--border-width) solid var(--color-border)", borderRadius: "var(--radius-element)", background: "var(--color-background-surface)", color: "var(--color-text-primary)", fontFamily: "inherit", fontSize: "var(--font-size-sm)" }}>
                        {EDITOR_FONT_SIZES.map((size) => <option key={size} value={size}>{size} px</option>)}
                      </select>
                    </HStack>
                    <Switch label="Wrap long lines" labelPosition="start" labelSpacing="spread" value={preferences.wordWrap} onChange={(wordWrap) => setPreferences((previous) => ({ ...previous, wordWrap }))} />
                  </VStack>
                  <VStack gap={1} style={{ borderTop: "var(--border-width) solid var(--color-border)", paddingTop: "var(--spacing-3)" }}>
                    <Text type="supporting" color="secondary">Editor theme</Text>
                    {CONTEST_EDITOR_THEMES.map((theme) => (
                      <Button key={theme.id} label={theme.label} variant="ghost" size="sm" aria-pressed={editorTheme === theme.id} onClick={() => { handleEditorThemeChange(theme.id); closeSettings(); }} endContent={editorTheme === theme.id ? <Check size={14} aria-hidden="true" /> : undefined} style={{ justifyContent: "space-between" }} />
                    ))}
                  </VStack>
                  <VStack gap={2} style={{ borderTop: "var(--border-width) solid var(--color-border)", paddingTop: "var(--spacing-3)" }}>
                    <Text type="supporting" color="secondary">{preferencesStorageUnavailable ? "Preferences apply for this visit. Device storage is unavailable." : "Preferences are remembered on this device."}</Text>
                    <Button label="Reset editor preferences" variant="ghost" size="sm" onClick={() => { setPreferences({ ...DEFAULT_EDITOR_PREFERENCES }); handleEditorThemeChange("ams-terminal"); closeSettings(); }} style={{ alignSelf: "start" }} />
                  </VStack>
                </VStack>
              </Card>
            )}
          </VStack>
          <Button
            label="Run"
            aria-label={`Run ${activeFileName} on sample tests`}
            variant="secondary"
            icon={isRunning ? <Spinner size="sm" /> : <Play size={14} aria-hidden="true" />}
            isDisabled={runDisabled}
            onClick={() => void triggerRun()}
            {...{ title: judgingUnavailableReason ?? "Runs your code against the sample tests only — does not count toward your score." }}
          />
          <Button
            label={submitButton.label}
            aria-label={`${submitButton.label} ${activeFileName} for scoring`}
            variant="primary"
            icon={submitButton.icon === "spinner" ? <Spinner size="sm" /> : <Send size={14} aria-hidden="true" />}
            isDisabled={submitDisabled}
            onClick={handleSubmitSolution}
            {...{ title: judgingUnavailableReason ?? (isSubmitting ? "Submitting…" : !sessionId ? "Waiting for your session…" : isEditorEmpty ? "Write some code to submit" : "Submit your solution for scoring") }}
          />
        </HStack>
      </HStack>

      <VStack gap={1} paddingInline={4} paddingBlock={2} style={{ flexShrink: 0, borderBottom: "var(--border-width) solid var(--color-border)" }}>
        <Text type="supporting" color="secondary" style={{ overflowWrap: "anywhere" }}>
          Run and Submit use {activeFileName} only.{isScratchActive ? " Scratch file selected." : ""}
        </Text>
        <HStack gap={3} wrap="wrap" align="start" role="status" aria-live="polite" aria-atomic="true">
          <Text type="supporting" style={{ overflowWrap: "anywhere" }}>Draft: {draftStatusLabel}</Text>
          <Text type="supporting" color="secondary" style={{ overflowWrap: "anywhere" }}>Last submission: {lastSubmissionLabel}</Text>
        </HStack>
      </VStack>

      {judgingUnavailableReason && <Banner status="warning" container="section" title={judgingUnavailableReason} role="status" />}
      {submissionError && <Banner status="error" container="section" title={submissionError} role="status" />}
      {saveError && <Banner status="error" container="section" title={saveError} role="status" />}

      {/* Keep the lazy editor at a stable position and pass through its original
          props: presentation changes must not remount CodeMirror or lose drafts. */}
      <EditorPane
        diagnosticNavigation={diagnosticNavigation}
        fileId={activeFileId}
        activeQ={activeQ}
        activeTab={activeFile?.name ?? "main.cpp"}
        currentCode={currentCode}
        onCodeChange={handleCodeChange}
        editorTheme={editorTheme}
        selectedLanguage={selectedLanguage}
        problemId={currentQId}
        readOnly={readOnly}
        preferences={preferences}
      />

      {pendingFile && <Card role="dialog" aria-labelledby="close-scratch-title" padding={5} style={{ position: "absolute", top: "calc(var(--spacing-10) + var(--spacing-3))", right: "var(--spacing-4)", zIndex: 20, width: "calc(var(--spacing-10) * 8)", maxWidth: "calc(100% - var(--spacing-8))", border: "var(--border-width) solid var(--color-border)" }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setPendingCloseFileId(null); } }}>
        <VStack gap={5}>
          <VStack gap={2}>
            <Heading level={2} id="close-scratch-title">Close scratch file?</Heading>
            <Text color="secondary" style={{ overflowWrap: "anywhere" }}>This removes {pendingFile?.name} and its contents from this problem’s editor.</Text>
          </VStack>
          <HStack gap={2} justify="end" wrap="wrap">
            <Button label="Cancel" aria-label="Cancel close" variant="secondary" onClick={(e) => { e.stopPropagation(); setPendingCloseFileId(null); }} />
            <Button label="Close file" aria-label="Confirm close" isDisabled={readOnly} variant="destructive" onClick={(e) => {
              e.stopPropagation();
              setPendingCloseFileId(null);
              if (pendingFile && !readOnly) removeEditorFile(pendingFile.id);
            }} />
          </HStack>
        </VStack>
      </Card>}
    </VStack>
  );
}

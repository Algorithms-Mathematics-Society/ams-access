import type { CompilerDiagnostic } from "../compiler-diagnostics";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { ChevronUp, ChevronDown } from "lucide-react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Button } from "@astryxdesign/core/Button";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Badge } from "@astryxdesign/core/Badge";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Banner } from "@astryxdesign/core/Banner";
import {
  isPendingSubmissionStatus,
  type RunAttempt,
  type SubmissionAttemptRecord,
} from "../submission-state";
import { CustomCasesPanel } from "./CustomCasesPanel";
import type { CustomCase } from "../custom-cases";
import { VerdictBadge } from "@/lib/VerdictBadge";
import { isPublicSample, outputText } from "../execution-output";
import type { VerdictCode } from "@/lib/verdict";

// Used only by the Attempts list's language chip — moved here verbatim
// (module scope) since this was its sole call site in client.tsx.
const LANGUAGE_META = {
  c: {
    ext: "c",
    name: "C",
    starter: `#include <stdio.h>

int main() {
    // Write your C solution here
    return 0;
}`,
  },
  cpp17: {
    ext: "cpp",
    name: "C++17",
    starter: `#include <iostream>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    // Write your C++17 solution here
    return 0;
}`,
  },
  cpp20: {
    ext: "cpp",
    name: "C++20",
    starter: `#include <iostream>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    // Write your C++20 solution here
    return 0;
}`,
  },
  python3: {
    ext: "py",
    name: "Python 3",
    starter: `import sys

def solve():
    # Write your Python 3 solution here
    pass

if __name__ == '__main__':
    solve()`,
  },
  pypy3: {
    ext: "py",
    name: "PyPy 3",
    starter: `import sys

def solve():
    # Write your PyPy 3 solution here
    pass

if __name__ == '__main__':
    solve()`,
  },
};

// A test row is a "sample" test (expected/got may be shown) only when it is not
// flagged hidden by any of the indicators the Attempts UI already recognizes.
// Hidden/fallback tests show verdict only — never expected/got.
const isSampleTestRow = isPublicSample;

function SampleOutput({ label, value }: { label: string; value: unknown }) {
  return (
    <VStack gap={2} style={{ minWidth: 0 }}>
      <Text type="supporting" weight="medium">
        {label}
      </Text>
      <pre
        style={{
          margin: 0,
          padding: "var(--spacing-3)",
          borderRadius: "var(--radius-element)",
          border: "var(--border-width) solid var(--color-border)",
          background: "var(--color-background-body)",
          color: "var(--color-text-primary)",
          fontFamily: "var(--font-family-mono)",
          fontSize: "var(--font-size-sm)",
          whiteSpace: "pre",
          overflowX: "auto",
          tabSize: 4,
        }}
      >
        {outputText(value)}
      </pre>
    </VStack>
  );
}

type RunStatusView = {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: "error" | "pending" | "loading" | "dot";
} | null;

export interface TerminalPanelProps {
  /** The candidate's own cases for the active problem, and how to change
   *  and run them. Rendered here rather than beside the editor so the cases
   *  and the output they produced stay in one place. */
  runMode: "all" | "custom";
  customCases: CustomCase[];
  onCustomCasesChange: (next: (previous: CustomCase[]) => CustomCase[]) => void;
  onRunCustom: () => void;
  /** Editing is locked (session ended, or the heartbeat said so). */
  readOnly: boolean;
  /** Why judging is unavailable, if it is. Disables Run custom with a reason. */
  judgingUnavailableReason: string | null;
  compilerDiagnostic?: CompilerDiagnostic | null;
  onJumpToCompilerError?: () => void;
  outputHeightPercent?: number;
  runSourceChanged?: boolean;
  terminalCollapsed: boolean;
  setTerminalCollapsed: Dispatch<SetStateAction<boolean>>;
  shouldShowRunProgress: boolean;
  runResult: RunAttempt | null;
  isRunning: boolean;
  runTimedOut: boolean;
  runResultAttemptId: string | null;
  runSampleTests: any[] | null;
  runError: string | null;
  isEditorEmpty: boolean;
  submissionsList: SubmissionAttemptRecord[];
  /** The active problem's label. The Attempts list is scoped to one problem,
   *  so the empty state has to say which — otherwise a candidate who has
   *  submitted on A and switched to B reads "no attempts" as lost work. */
  problemLabel: string;
  loadingSubmissions: boolean;
  expandedAttemptId: string | null;
  toggleExpandAttempt: (attemptId: string) => void;
  testResults: Record<string, any[]>;
  testResultFilter: "all" | "failed" | "passed";
  setTestResultFilter: Dispatch<SetStateAction<"all" | "failed" | "passed">>;
  latestAttempt: SubmissionAttemptRecord | null;
  latestAttemptTests: any[] | null | undefined;
  latestAttemptPending: boolean;
  latestAttemptPassed: number;
  latestAttemptFirstFailed: any | null;
  runStatus: RunStatusView;
  runMetrics: string;
  runProgressSteps: string[];
  runProgressPhase: number;
  terminalUnread: boolean;
}

export function TerminalPanel({
  runMode,
  customCases,
  onCustomCasesChange,
  onRunCustom,
  readOnly,
  judgingUnavailableReason,
  compilerDiagnostic,
  onJumpToCompilerError,
  outputHeightPercent = 34,
  runSourceChanged = false,
  terminalCollapsed,
  setTerminalCollapsed,
  shouldShowRunProgress,
  runResult,
  isRunning,
  runTimedOut,
  runResultAttemptId,
  runSampleTests,
  runError,
  isEditorEmpty,
  submissionsList,
  problemLabel,
  loadingSubmissions,
  expandedAttemptId,
  toggleExpandAttempt,
  testResults,
  testResultFilter,
  setTestResultFilter,
  latestAttempt,
  latestAttemptTests,
  latestAttemptPending,
  latestAttemptPassed,
  latestAttemptFirstFailed,
  runStatus,
  runMetrics,
  runProgressSteps,
  runProgressPhase,
  terminalUnread,
}: TerminalPanelProps) {
  const [activeTab, setActiveTab] = useState<"all" | "custom">("all");
  useEffect(() => {
    if (isRunning) setActiveTab(runMode);
  }, [isRunning, runMode]);
  const runIsCustom = runMode === "custom";
  const showRunOutput = activeTab === runMode;
  const showRunPane = showRunOutput && Boolean(runResult || isRunning || runError || runTimedOut);
  // Compiler messages follow the run when there is one, and otherwise fall back
  // to the last submission -- the precedence the Compiler output tab used before
  // the two output tabs were folded into this one pane.
  const compilerText = runResult
    ? (runResult.compile_output ?? null)
    : (latestAttempt?.compile_output ?? null);
  const compilerIsError = runResult
    ? runResult.status === "CE"
    : (latestAttempt?.final_verdict ?? latestAttempt?.status) === "CE";

  // Attempts-list filter (ALL / FAILED / PASSED). Judged attempts split on the
  // final verdict; still-judging attempts only appear under ALL.
  const attemptMatchesFilter = (sub: SubmissionAttemptRecord) => {
    if (testResultFilter === "all") return true;
    if (sub.status === "QUEUED" || sub.status === "RUNNING") return false;
    const verdict = sub.final_verdict ?? sub.status;
    return testResultFilter === "passed" ? verdict === "AC" : verdict !== "AC";
  };

  return (
    <VStack
      className="contest-terminal-panel"
      gap={0}
      role="region"
      aria-label="Test results and custom cases"
      style={{
        height: terminalCollapsed ? "var(--spacing-10)" : `${outputHeightPercent}%`,
        minHeight: terminalCollapsed ? "var(--spacing-10)" : "calc(var(--spacing-10) * 3)",
        flexShrink: 0,
        minWidth: 0,
        background: "var(--color-background-surface)",
        overflow: "hidden",
      }}
    >
      <HStack
        gap={2}
        align="center"
        paddingInline={3}
        style={{
          flexShrink: 0,
          minHeight: "var(--spacing-10)",
          borderBottom: "var(--border-width) solid var(--color-border)",
        }}
      >
        <HStack gap={2} align="center" style={{ flex: 1, minWidth: 0 }}>
          <Text type="supporting" weight="medium">
            Test Results
          </Text>
          {submissionsList.length > 0 && <Badge label={submissionsList.length} variant="neutral" />}
          {runResult?.status === "CE" && <Badge label="CE" variant="error" />}
        </HStack>
        <IconButton
          label={
            terminalCollapsed
              ? terminalUnread
                ? "Expand output panel — output updated"
                : "Expand output panel"
              : "Collapse output panel"
          }
          {...{ title: terminalCollapsed ? "Expand output panel" : "Collapse output panel" }}
          variant="ghost"
          size="sm"
          aria-expanded={!terminalCollapsed}
          aria-controls="contest-output-body"
          onClick={() => setTerminalCollapsed((c) => !c)}
          icon={
            terminalCollapsed ? (
              <ChevronUp size={16} aria-hidden="true" />
            ) : (
              <ChevronDown size={16} aria-hidden="true" />
            )
          }
          style={{
            color: terminalUnread ? "var(--color-text-primary)" : "var(--color-text-secondary)",
          }}
        />
        {terminalCollapsed && terminalUnread && (
          <Text type="supporting" weight="medium">
            New
          </Text>
        )}
      </HStack>
      <VStack gap={0} style={{ display: terminalCollapsed ? "none" : "flex", flexShrink: 0 }}>
        <TabList
          value={activeTab}
          onChange={(value) => setActiveTab(value as "all" | "custom")}
          size="sm"
          hasDivider
          role="tablist"
          aria-label="Test result sections"
        >
          {(
            [
              { value: "all", label: "All Cases" },
              { value: "custom", label: "Custom" },
            ] as const
          ).map((tab) => (
            <Tab
              key={tab.value}
              value={tab.value}
              label={tab.label}
              id={`contest-output-tab-${tab.value}`}
              role="tab"
              ref={(node) => {
                node?.removeAttribute("aria-current");
              }}
              aria-selected={activeTab === tab.value}
              aria-controls="contest-output-body"
            />
          ))}
        </TabList>
      </VStack>
      <VStack
        gap={0}
        role="tabpanel"
        aria-labelledby={`contest-output-tab-${activeTab}`}
        tabIndex={0}
        id="contest-output-body"
        style={{
          display: terminalCollapsed ? "none" : "flex",
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowWrap: "anywhere",
        }}
      >
        {activeTab === "custom" && (
          <CustomCasesPanel
            cases={customCases}
            onChange={onCustomCasesChange}
            onRun={onRunCustom}
            isRunning={isRunning}
            readOnly={readOnly}
            runDisabledReason={judgingUnavailableReason}
          />
        )}
        {showRunOutput && runResult && runSourceChanged && (
          <Banner
            status="warning"
            container="section"
            title="Code changed since this run"
            description="These results belong to the earlier code. Run the active file again to check your changes."
          />
        )}
        {((activeTab === "all" && latestAttempt) || (showRunOutput && runStatus)) && (
          <HStack
            gap={3}
            align="center"
            justify="between"
            wrap="wrap"
            paddingInline={4}
            paddingBlock={2}
            style={{ borderBottom: "var(--border-width) solid var(--color-border)" }}
          >
            {activeTab === "all" && latestAttempt && (
              <HStack
                gap={2}
                align="center"
                {...{ title: "Last submitted attempt — not the current draft or sample run" }}
              >
                <Text type="supporting" color="secondary">
                  Last submission
                </Text>
                {(() => {
                  const latestCode = (latestAttempt.final_verdict ??
                    latestAttempt.status) as VerdictCode;
                  return (
                    <VerdictBadge
                      key={`${latestAttempt?.id ?? ""}-${String(latestCode)}`}
                      variant="chip"
                      code={latestCode}
                      reveal
                    />
                  );
                })()}
              </HStack>
            )}
            {showRunOutput && runStatus && (
              <HStack gap={2} align="center" wrap="wrap" role="status" aria-live="polite">
                {runStatus.icon === "loading" && <Spinner size="sm" />}
                <Text type="supporting" weight="medium">
                  {runIsCustom ? "Custom run" : "Sample run"}: {runStatus.label}
                </Text>
                {runMetrics && (
                  <Text type="supporting" color="secondary" hasTabularNumbers>
                    {runMetrics}
                  </Text>
                )}
              </HStack>
            )}
          </HStack>
        )}
        {showRunOutput && shouldShowRunProgress && (
          <HStack
            gap={2}
            align="center"
            wrap="wrap"
            paddingInline={4}
            paddingBlock={2}
            role="status"
            aria-live="polite"
            style={{
              background: "var(--color-background-muted)",
              borderBottom: "var(--border-width) solid var(--color-border)",
            }}
          >
            {isRunning && <Spinner size="sm" />}
            {runProgressSteps.map((step, index) => (
              <HStack key={step} gap={2} align="center">
                <Text
                  type="supporting"
                  color={index === runProgressPhase ? "primary" : "secondary"}
                  weight={index === runProgressPhase ? "semibold" : "normal"}
                  aria-current={index === runProgressPhase ? "step" : undefined}
                >
                  {step}
                </Text>
                {index < runProgressSteps.length - 1 && (
                  <Text type="supporting" color="secondary" aria-hidden="true">
                    →
                  </Text>
                )}
              </HStack>
            ))}
          </HStack>
        )}
        {showRunPane && (
          <VStack gap={0} style={{ borderBottom: "var(--border-width) solid var(--color-border)" }}>
            <VStack gap={3} padding={4}>
              {/* Keep the original sample/hidden test masking and branch order. */}
              {!isRunning && runResult?.status !== "CE" && runSampleTests && (
                <VStack gap={0}>
                  {runSampleTests.length === 0 ? (
                    <Text color="secondary">No sample tests to run for this problem.</Text>
                  ) : (
                    runSampleTests.map((tr: any, idx: number) => {
                      const isAC = tr.verdict === "AC";
                      // A custom case is the candidate's own input, so there
                      // is nothing of the problem's to withhold -- its output
                      // always shows. cxxprobe emits stdout for every custom
                      // case and for no other kind, which is what makes this
                      // safe to key on.
                      const isCustom = tr.stdout_text != null || tr.stderr_text != null;
                      const isSample = isCustom || isSampleTestRow(tr);
                      const testNumber = tr.test_number ?? tr.testcase_no ?? idx + 1;
                      const expected = tr.expected ?? tr.expected_output ?? tr.answer ?? null;
                      const got =
                        tr.stdout_text ??
                        tr.got_output ??
                        tr.got ??
                        tr.actual ??
                        tr.output ??
                        tr.stdout ??
                        null;
                      return (
                        <VStack
                          key={`run-sample-${testNumber}-${idx}`}
                          gap={2}
                          paddingBlock={3}
                          style={{ borderBottom: "var(--border-width) solid var(--color-border)" }}
                        >
                          <HStack gap={3} align="center" wrap="wrap">
                            <Text type="label" weight="medium">
                              {isCustom
                                ? (tr.label ?? `Case ${testNumber}`)
                                : `${isSample ? "Sample" : "Test"} ${testNumber}`}
                            </Text>
                            {/* An unjudged custom case has no verdict at all
                                -- the candidate gave no expected output. A
                                badge there would invent a result. */}
                            {tr.verdict ? (
                              <VerdictBadge variant="chip" code={tr.verdict as VerdictCode} />
                            ) : isCustom ? (
                              <Text type="supporting" color="secondary">
                                not checked
                              </Text>
                            ) : (
                              <VerdictBadge
                                variant="chip"
                                code={(isAC ? "AC" : "Failed") as VerdictCode}
                              />
                            )}
                            {tr.runtime_ms != null && (
                              <Text type="supporting" color="secondary" hasTabularNumbers>
                                {tr.runtime_ms}ms
                              </Text>
                            )}
                            {!isSample && (
                              <Text type="supporting" color="secondary">
                                Output details hidden
                              </Text>
                            )}
                          </HStack>
                          {isSample && tr.checker_message && (
                            <Text type="supporting" color="secondary">
                              {tr.checker_message}
                            </Text>
                          )}
                          {!isAC && isSample && (expected != null || got != null) && (
                            <VStack gap={3}>
                              <SampleOutput label="Expected output" value={expected} />
                              <SampleOutput label="Actual output" value={got} />
                            </VStack>
                          )}
                          {isAC && isSample && got != null && String(got).length > 0 && (
                            <SampleOutput label="Actual output" value={got} />
                          )}
                          {/* An unchecked custom case falls through both
                              branches above (no verdict, so neither AC nor
                              not-AC); its output is the only thing the
                              candidate asked for. */}
                          {isCustom && !tr.verdict && (
                            <SampleOutput label="Output" value={got ?? ""} />
                          )}
                          {isCustom && tr.stderr_text ? (
                            <SampleOutput label="Errors" value={tr.stderr_text} />
                          ) : null}
                        </VStack>
                      );
                    })
                  )}
                </VStack>
              )}
              {isRunning ? (
                <Text color="secondary">Running…</Text>
              ) : runResult?.status === "CE" ? (
                <Text color="secondary">Compilation failed — messages below.</Text>
              ) : runTimedOut ? (
                <Banner
                  status="warning"
                  title="Run is taking longer than expected"
                  description="It may still be queued. Try Run again."
                />
              ) : runResultAttemptId &&
                runSampleTests === null &&
                runResult &&
                !isPendingSubmissionStatus(runResult.status) ? (
                <Text color="secondary">Loading sample results…</Text>
              ) : runSampleTests && runSampleTests.length > 0 ? (
                runResult?.stdout ? (
                  <Text
                    type="code"
                    color="secondary"
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {runResult.stdout}
                  </Text>
                ) : null
              ) : runResult?.stdout ? (
                <Text
                  type="code"
                  color="secondary"
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {runResult.stdout}
                </Text>
              ) : runResult?.stderr ? (
                <Text
                  type="code"
                  style={{
                    color: "var(--color-text-orange)",
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {runResult.stderr}
                </Text>
              ) : runResult ? (
                <Text color="secondary">No output.</Text>
              ) : runError ? (
                <Banner status="error" title={runError} />
              ) : (
                <Text color="secondary">
                  {isEditorEmpty
                    ? "Write code to prepare a run."
                    : "Run your code to see stdout and stderr."}
                </Text>
              )}
            </VStack>
            {compilerText && (
              <VStack
                gap={2}
                style={{
                  borderTop: "var(--border-width) solid var(--color-border)",
                  paddingTop: "var(--spacing-3)",
                }}
              >
                <Text type="supporting" color="secondary">
                  {runResult
                    ? "Compiler messages from this run"
                    : "Compiler messages from your last submission"}
                </Text>
                {compilerDiagnostic && (
                  <VStack
                    gap={2}
                    padding={3}
                    style={{
                      background: "var(--color-background-body)",
                      borderRadius: "var(--radius-element)",
                    }}
                  >
                    <Text weight="medium" style={{ overflowWrap: "anywhere" }}>
                      {compilerDiagnostic.message}
                    </Text>
                    <HStack gap={2} align="center" wrap="wrap">
                      <Text
                        type="supporting"
                        color="secondary"
                        style={{ overflowWrap: "anywhere" }}
                      >
                        {compilerDiagnostic.filename} · line {compilerDiagnostic.line}
                        {compilerDiagnostic.column ? `, column ${compilerDiagnostic.column}` : ""}
                      </Text>
                      {onJumpToCompilerError && (
                        <Button
                          label={`Go to line ${compilerDiagnostic.line}`}
                          variant="secondary"
                          size="sm"
                          onClick={onJumpToCompilerError}
                        />
                      )}
                    </HStack>
                    {!onJumpToCompilerError && (
                      <Text type="supporting" color="secondary">
                        This location cannot be matched to the current file and code version.
                      </Text>
                    )}
                  </VStack>
                )}
                <Text
                  type="code"
                  style={{
                    color: compilerIsError
                      ? "var(--color-text-red)"
                      : "var(--color-text-secondary)",
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {compilerText}
                </Text>
              </VStack>
            )}
          </VStack>
        )}
        {activeTab === "all" && (
          <VStack gap={4} padding={4}>
            <HStack gap={3} align="center" justify="between" wrap="wrap">
              <Text type="supporting" color="secondary" weight="medium">
                {problemLabel ? `Attempts · ${problemLabel}` : "Attempts"}
              </Text>
              <SegmentedControl
                label="Filter attempts and tests"
                value={testResultFilter}
                onChange={(value) => setTestResultFilter(value as "all" | "failed" | "passed")}
                size="sm"
              >
                <SegmentedControlItem value="all" label="All" />
                <SegmentedControlItem value="failed" label="Failed" />
                <SegmentedControlItem value="passed" label="Passed" />
              </SegmentedControl>
            </HStack>
            {latestAttempt && (
              <VStack
                gap={3}
                paddingBlock={3}
                style={{ borderBottom: "var(--border-width) solid var(--color-border)" }}
              >
                <HStack gap={3} align="center" wrap="wrap">
                  <VerdictBadge
                    variant="full"
                    code={(latestAttempt.final_verdict ?? latestAttempt.status) as VerdictCode}
                  />
                  <Text type="supporting" color="secondary">
                    Attempt #{latestAttempt.attempt_no}
                  </Text>
                </HStack>
                <HStack gap={3} wrap="wrap">
                  <Text type="supporting" color="secondary">
                    {latestAttemptTests
                      ? `${latestAttemptPassed} / ${latestAttemptTests.length} passed`
                      : latestAttemptPending
                        ? "Judging in progress"
                        : "Loading test results"}
                  </Text>
                  <Text type="supporting" color="secondary">
                    Score: {latestAttempt.score ?? "N/A"}
                  </Text>
                  <Text type="supporting" color="secondary">
                    {latestAttempt.runtime_ms != null
                      ? `${latestAttempt.runtime_ms}ms`
                      : "Runtime N/A"}
                  </Text>
                  <Text type="supporting" color="secondary">
                    {latestAttempt.memory_kb != null
                      ? `${Math.round(latestAttempt.memory_kb / 1024)}MB`
                      : "Memory N/A"}
                  </Text>
                </HStack>
                {latestAttemptFirstFailed ? (
                  <Banner
                    status="error"
                    title={
                      latestAttemptFirstFailed.hidden || latestAttemptFirstFailed.is_hidden
                        ? `Hidden test ${latestAttemptFirstFailed.test_number ?? ""} failed`
                        : `Test ${latestAttemptFirstFailed.test_number ?? "?"} failed`
                    }
                    description={
                      <Text type="supporting">
                        {latestAttemptFirstFailed.verdict ?? "Failed"}
                        {latestAttemptFirstFailed.runtime_ms != null &&
                          ` · ${latestAttemptFirstFailed.runtime_ms}ms`}
                        {latestAttemptFirstFailed.memory_kb != null &&
                          ` · ${Math.round(latestAttemptFirstFailed.memory_kb / 1024)}MB`}
                        {(latestAttemptFirstFailed.message ||
                          latestAttemptFirstFailed.status_message ||
                          latestAttemptFirstFailed.error) &&
                          ` · ${latestAttemptFirstFailed.message ?? latestAttemptFirstFailed.status_message ?? latestAttemptFirstFailed.error}`}
                      </Text>
                    }
                  />
                ) : latestAttemptTests && latestAttemptTests.length > 0 ? (
                  <Text type="supporting" style={{ color: "var(--color-text-green)" }}>
                    All visible tests passed.
                  </Text>
                ) : (
                  <Text type="supporting" color="secondary">
                    Test-case details will appear here when the judge returns them.
                  </Text>
                )}
              </VStack>
            )}
            {loadingSubmissions && submissionsList.length === 0 ? (
              <HStack gap={2} align="center" role="status">
                <Spinner size="sm" />
                <Text color="secondary">Loading submissions…</Text>
              </HStack>
            ) : submissionsList.length === 0 ? (
              <VStack gap={2} paddingBlock={3}>
                <Text weight="medium">
                  {problemLabel ? `No attempts on ${problemLabel} yet` : "No attempts yet"}
                </Text>
                <Text type="supporting" color="secondary">
                  Press Submit Solution to send your code to the judge. This list shows only{" "}
                  {problemLabel ? `problem ${problemLabel}` : "this problem"}. Each attempt is
                  scored independently.
                </Text>
              </VStack>
            ) : (
              <VStack gap={0}>
                {submissionsList.filter(attemptMatchesFilter).length === 0 && (
                  <Text color="secondary">No {testResultFilter} attempts yet.</Text>
                )}
                {submissionsList.filter(attemptMatchesFilter).map((sub) => {
                  const isExpanded = expandedAttemptId === sub.id;
                  const status = sub.status;
                  const isPending = status === "QUEUED" || status === "RUNNING";
                  return (
                    <VStack
                      key={sub.id}
                      gap={2}
                      paddingBlock={3}
                      style={{ borderBottom: "var(--border-width) solid var(--color-border)" }}
                    >
                      <Button
                        label={`Attempt #${sub.attempt_no}`}
                        variant="ghost"
                        aria-expanded={isExpanded}
                        onClick={() => toggleExpandAttempt(sub.id)}
                        style={{
                          height: "auto",
                          minHeight: "var(--spacing-8)",
                          width: "100%",
                          paddingInline: 0,
                          justifyContent: "space-between",
                          textAlign: "start",
                        }}
                        endContent={
                          isExpanded ? (
                            <ChevronUp size={14} aria-hidden="true" />
                          ) : (
                            <ChevronDown size={14} aria-hidden="true" />
                          )
                        }
                      >
                        <HStack as="span" gap={3} align="center" wrap="wrap">
                          <VerdictBadge
                            variant="chip"
                            code={
                              (isPending
                                ? sub.status
                                : (sub.final_verdict ?? sub.status)) as VerdictCode
                            }
                          />
                          <Text type="supporting">Attempt #{sub.attempt_no}</Text>
                          <Text type="supporting" color="secondary">
                            {LANGUAGE_META[sub.language as keyof typeof LANGUAGE_META]?.name ||
                              sub.language}
                          </Text>
                          <Text type="supporting" color="secondary" hasTabularNumbers>
                            {new Date(sub.created_at).toLocaleTimeString()}
                          </Text>
                        </HStack>
                      </Button>
                      {isExpanded && (
                        <VStack
                          gap={3}
                          padding={3}
                          style={{
                            borderInlineStart: "var(--border-width) solid var(--color-border)",
                          }}
                        >
                          {isPending ? (
                            <Text type="supporting" color="secondary">
                              Grading in progress... Live results will update automatically.
                            </Text>
                          ) : (
                            <>
                              <HStack gap={3} wrap="wrap">
                                <Text type="supporting" color="secondary">
                                  Runtime:{" "}
                                  {sub.runtime_ms !== null ? `${sub.runtime_ms} ms` : "N/A"}
                                </Text>
                                <Text type="supporting" color="secondary">
                                  Memory: {sub.memory_kb !== null ? `${sub.memory_kb} KB` : "N/A"}
                                </Text>
                                <Text type="supporting" color="secondary">
                                  Score: {sub.score}
                                </Text>
                              </HStack>
                              {testResults[sub.id] ? (
                                (() => {
                                  const trs = testResults[sub.id];
                                  const passedCount = trs.filter(
                                    (tr: any) => tr.verdict === "AC"
                                  ).length;
                                  return (
                                    <VStack gap={2}>
                                      <Text type="supporting" color="secondary">
                                        {passedCount} / {trs.length} test cases passed
                                      </Text>
                                      {trs
                                        .map((tr: any, originalIndex: number) => ({
                                          tr,
                                          originalIndex,
                                        }))
                                        .filter(({ tr }: any) =>
                                          testResultFilter === "all"
                                            ? true
                                            : testResultFilter === "passed"
                                              ? tr.verdict === "AC"
                                              : tr.verdict !== "AC"
                                        )
                                        .map(({ tr, originalIndex }: any, idx: number) => {
                                          const testNumber = tr.test_number ?? originalIndex + 1;
                                          return (
                                            <HStack
                                              key={`${sub.id}-${testNumber}-${idx}`}
                                              gap={3}
                                              align="center"
                                              wrap="wrap"
                                              paddingBlock={1}
                                            >
                                              <Text type="supporting">Test {testNumber}</Text>
                                              <VerdictBadge
                                                variant="chip"
                                                code={(tr.verdict ?? tr.status) as VerdictCode}
                                              />
                                              {tr.runtime_ms != null && (
                                                <Text
                                                  type="supporting"
                                                  color="secondary"
                                                  hasTabularNumbers
                                                >
                                                  {tr.runtime_ms}ms
                                                </Text>
                                              )}
                                              {tr.memory_kb != null && (
                                                <Text
                                                  type="supporting"
                                                  color="secondary"
                                                  hasTabularNumbers
                                                >
                                                  {Math.round(tr.memory_kb / 1024)}MB
                                                </Text>
                                              )}
                                            </HStack>
                                          );
                                        })}
                                      {trs.filter((tr: any) =>
                                        testResultFilter === "all"
                                          ? true
                                          : testResultFilter === "passed"
                                            ? tr.verdict === "AC"
                                            : tr.verdict !== "AC"
                                      ).length === 0 && (
                                        <Text type="supporting" color="secondary">
                                          No {testResultFilter} tests in this attempt.
                                        </Text>
                                      )}
                                    </VStack>
                                  );
                                })()
                              ) : (
                                <Text type="supporting" color="secondary">
                                  Loading test results...
                                </Text>
                              )}
                            </>
                          )}
                        </VStack>
                      )}
                    </VStack>
                  );
                })}
              </VStack>
            )}
          </VStack>
        )}
      </VStack>
    </VStack>
  );
}

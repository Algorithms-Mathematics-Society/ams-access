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
import { ResultsPanel } from "./ResultsPanel";
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
  /** Re-polls the timed-out run by uid. Never starts a new run. */
  onCheckRunAgain: () => void;
  runResultAttemptId: string | null;
  runSampleTests: any[] | null;
  /** The active problem's worked examples, for pairing with judged samples. */
  sampleExamples?: { label?: string; input: string; output: string }[];
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
  onCheckRunAgain,
  runResultAttemptId,
  runSampleTests,
  sampleExamples,
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
  const [activeTab, setActiveTab] = useState<"all" | "custom" | "attempts">("all");
  useEffect(() => {
    // A run pulls the pane back to what it is about to produce. Without this
    // a candidate who was reading their history watches the spinner run in a
    // tab they cannot see.
    if (isRunning) setActiveTab(runMode);
  }, [isRunning, runMode]);
  const runIsCustom = runMode === "custom";
  const showRunOutput = activeTab === runMode;
  const showRunPane = showRunOutput && Boolean(runResult || isRunning || runError || runTimedOut);

  // Which of the two the result pane is showing. `runMode` is not this: it is
  // "all cases or custom cases" and stays "all" whether the last thing the
  // candidate pressed was Run or Submit, so reading it meant a finished
  // submission rendered the *run* branch — empty — and the panel said "Run
  // your code" directly underneath a badge counting six results.
  //
  // Whichever started most recently wins, which is what a candidate means by
  // "the result".
  const [resultSource, setResultSource] = useState<"run" | "submission">("run");
  useEffect(() => {
    if (isRunning || runResult || runError || runTimedOut) setResultSource("run");
  }, [isRunning, runResult, runError, runTimedOut]);
  useEffect(() => {
    if (!latestAttempt?.id && !latestAttemptPending) return;
    setResultSource("submission");
    // Submitting is the moment a candidate most wants the verdict, so the
    // pane comes to the front rather than waiting to be found.
    setActiveTab("all");
  }, [latestAttempt?.id, latestAttemptPending]);

  const viewingRun = resultSource === "run";
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
          {/* The count is attempts, not tests. Beside the words "Test
              Results" a bare number reads as a number of tests, so a
              candidate on their thirteenth attempt was told they had 13
              tests on a problem with two. */}
          {submissionsList.length > 0 && (
            <Badge
              label={`${submissionsList.length} ${submissionsList.length === 1 ? "attempt" : "attempts"}`}
              variant="neutral"
            />
          )}
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
          onChange={(value) => setActiveTab(value as "all" | "custom" | "attempts")}
          size="sm"
          hasDivider
          role="tablist"
          aria-label="Test result sections"
        >
          {(
            [
              { value: "all", label: "Test Result" },
              { value: "custom", label: "Testcase" },
              // History, out of the results scroll. It used to sit below the
              // verdict, so scrolling a failed run led straight into the
              // results of an attempt from twenty minutes earlier with
              // nothing to tell them apart.
              { value: "attempts", label: "Attempts" },
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
        {activeTab === "all" && (
          <ResultsPanel
            tests={viewingRun ? runSampleTests : latestAttemptTests}
            verdict={
              viewingRun
                ? (runResult?.status ?? null)
                : ((latestAttempt?.final_verdict ?? latestAttempt?.status) as string | null)
            }
            runtimeMs={viewingRun ? runResult?.runtime_ms : latestAttempt?.runtime_ms}
            memoryKb={viewingRun ? runResult?.memory_kb : latestAttempt?.memory_kb}
            isRunning={viewingRun ? isRunning : latestAttemptPending}
            submitted={!viewingRun}
            progressLabel={runProgressSteps[runProgressPhase] ?? runMetrics}
            error={runTimedOut ? "The judge did not answer in time." : runError}
            compilerText={compilerText}
            compilerIsError={compilerIsError}
            onJumpToCompilerError={onJumpToCompilerError}
            examples={sampleExamples}
            stale={viewingRun && runSourceChanged}
            emptyHint={
              viewingRun
                ? "Run your code to check it against the sample cases."
                : "Nothing submitted for this problem yet."
            }
          />
        )}
        {activeTab === "attempts" && (
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

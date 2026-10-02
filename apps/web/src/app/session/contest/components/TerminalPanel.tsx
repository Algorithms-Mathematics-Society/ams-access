import type { CompilerDiagnostic } from "../compiler-diagnostics";
import { type Dispatch, type SetStateAction } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Button } from "@astryxdesign/core/Button";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Badge } from "@astryxdesign/core/Badge";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Banner } from "@astryxdesign/core/Banner";
import {
  isPendingSubmissionStatus,
  type RunAttempt,
  type SubmissionAttemptRecord,
} from "../submission-state";
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
  return <VStack gap={2} style={{ minWidth: 0 }}>
    <Text type="supporting" weight="medium">{label}</Text>
    <pre style={{ margin: 0, padding: "var(--spacing-3)", borderRadius: "var(--radius-element)", border: "var(--border-width) solid var(--color-border)", background: "var(--color-background-body)", color: "var(--color-text-primary)", fontFamily: "var(--font-family-mono)", fontSize: "var(--font-size-sm)", whiteSpace: "pre", overflowX: "auto", tabSize: 4 }}>{outputText(value)}</pre>
  </VStack>;
}

type RunStatusView = {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: "error" | "pending" | "loading" | "dot";
} | null;

export interface TerminalPanelProps {
  compilerDiagnostic?: CompilerDiagnostic | null;
  onJumpToCompilerError?: () => void;
  outputHeightPercent?: number;
  runSourceChanged?: boolean;
  runSourceLabel?: string;
  terminalCollapsed: boolean;
  setTerminalCollapsed: Dispatch<SetStateAction<boolean>>;
  shouldShowRunProgress: boolean;
  terminalTab: "stdout" | "logs" | "submissions";
  setTerminalTab: Dispatch<SetStateAction<"stdout" | "logs" | "submissions">>;
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
  compilerDiagnostic,
  onJumpToCompilerError,
  outputHeightPercent = 34,
  runSourceChanged = false,
  runSourceLabel,
  terminalCollapsed,
  setTerminalCollapsed,
  shouldShowRunProgress,
  terminalTab,
  setTerminalTab,
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
  // Attempts-list filter (ALL / FAILED / PASSED). Judged attempts split on the
  // final verdict; still-judging attempts only appear under ALL.
  const attemptMatchesFilter = (sub: SubmissionAttemptRecord) => {
    if (testResultFilter === "all") return true;
    if (sub.status === "QUEUED" || sub.status === "RUNNING") return false;
    const verdict = sub.final_verdict ?? sub.status;
    return testResultFilter === "passed" ? verdict === "AC" : verdict !== "AC";
  };

  return (
    <VStack className="contest-terminal-panel" gap={0} role="region" aria-label="Output and attempts" style={{ height: terminalCollapsed ? "var(--spacing-10)" : `${outputHeightPercent}%`, minHeight: terminalCollapsed ? "var(--spacing-10)" : "calc(var(--spacing-10) * 3)", flexShrink: 0, minWidth: 0, background: "var(--color-background-surface)", overflow: "hidden" }}>
      <HStack gap={2} align="center" paddingInline={3} style={{ flexShrink: 0, minHeight: "var(--spacing-10)", borderBottom: "var(--border-width) solid var(--color-border)" }}>
        <VStack gap={0} style={{ flex: 1, minWidth: 0, overflowX: "auto", overflowY: "hidden" }}>
          <TabList value={terminalTab} onChange={(value) => setTerminalTab(value as "stdout" | "logs" | "submissions")} size="sm" aria-label="Output views" style={{ minWidth: "max-content" }}>
            <Tab value="stdout" label="Output" />
            <Tab value="logs" label="Compiler output" endContent={runResult?.status === "CE" ? <Badge label="CE" variant="error" /> : undefined} />
            <Tab value="submissions" label="Attempts" endContent={submissionsList.length > 0 ? <Badge label={submissionsList.length} variant="neutral" /> : undefined} />
          </TabList>
        </VStack>
        <IconButton
          label={terminalCollapsed ? terminalUnread ? "Expand output panel — output updated" : "Expand output panel" : "Collapse output panel"}
          {...{ title: terminalCollapsed ? "Expand output panel" : "Collapse output panel" }}
          variant="ghost"
          size="sm"
          aria-expanded={!terminalCollapsed}
          aria-controls="contest-output-body"
          onClick={() => setTerminalCollapsed((c) => !c)}
          icon={terminalCollapsed ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          style={{ color: terminalUnread ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}
        />
        {terminalCollapsed && terminalUnread && <Text type="supporting" weight="medium">New</Text>}
      </HStack>
      <VStack gap={0} id="contest-output-body" style={{ display: terminalCollapsed ? "none" : "flex", flex: 1, minHeight: 0, overflowY: "auto", overflowWrap: "anywhere" }}>
        {terminalTab !== "submissions" && runResult && runSourceChanged && <Banner status="warning" container="section" title="Code changed since this run" description="These results belong to the earlier code. Run the active file again to check your changes." />}
        {(latestAttempt || runStatus) && (
          <HStack gap={3} align="center" justify="between" wrap="wrap" paddingInline={4} paddingBlock={2} style={{ borderBottom: "var(--border-width) solid var(--color-border)" }}>
            {latestAttempt && <HStack gap={2} align="center" {...{ title: "Last submitted attempt — not the current draft or sample run" }}>
              <Text type="supporting" color="secondary">Last submission</Text>
              {(() => {
                const latestCode = (latestAttempt.final_verdict ?? latestAttempt.status) as VerdictCode;
                return <VerdictBadge key={`${latestAttempt?.id ?? ""}-${String(latestCode)}`} variant="chip" code={latestCode} reveal />;
              })()}
            </HStack>}
            {runStatus && <HStack gap={2} align="center" wrap="wrap" role="status" aria-live="polite">
              {runStatus.icon === "loading" && <Spinner size="sm" />}
              <Text type="supporting" weight="medium">Sample run: {runStatus.label}</Text>
              {runMetrics && <Text type="supporting" color="secondary" hasTabularNumbers>{runMetrics}</Text>}
            </HStack>}
          </HStack>
        )}
        {shouldShowRunProgress && (
          <HStack gap={2} align="center" wrap="wrap" paddingInline={4} paddingBlock={2} role="status" aria-live="polite" style={{ background: "var(--color-background-muted)", borderBottom: "var(--border-width) solid var(--color-border)" }}>
            {isRunning && <Spinner size="sm" />}
            {runProgressSteps.map((step, index) => (
              <HStack key={step} gap={2} align="center">
                <Text type="supporting" color={index === runProgressPhase ? "primary" : "secondary"} weight={index === runProgressPhase ? "semibold" : "normal"} aria-current={index === runProgressPhase ? "step" : undefined}>{step}</Text>
                {index < runProgressSteps.length - 1 && <Text type="supporting" color="secondary" aria-hidden="true">→</Text>}
              </HStack>
            ))}
          </HStack>
        )}
        {terminalTab === "stdout" && (
          <VStack gap={3} padding={4}>
            <Text type="supporting" weight="medium" color="secondary">Sample run · does not affect your score</Text>
            {runSourceLabel && <Text type="supporting" color="secondary">{runSourceLabel}</Text>}
            {/* Keep the original sample/hidden test masking and branch order. */}
            {!isRunning && runResult?.status !== "CE" && runSampleTests && (
              <VStack gap={0}>
                {runSampleTests.length === 0 ? (
                  <Text color="secondary">No sample tests to run for this problem.</Text>
                ) : runSampleTests.map((tr: any, idx: number) => {
                  const isAC = tr.verdict === "AC";
                  const isSample = isSampleTestRow(tr);
                  const testNumber = tr.test_number ?? tr.testcase_no ?? idx + 1;
                  const expected = tr.expected ?? tr.expected_output ?? tr.answer ?? null;
                  const got = tr.got_output ?? tr.got ?? tr.actual ?? tr.output ?? tr.stdout ?? null;
                  return (
                    <VStack key={`run-sample-${testNumber}-${idx}`} gap={2} paddingBlock={3} style={{ borderBottom: "var(--border-width) solid var(--color-border)" }}>
                      <HStack gap={3} align="center" wrap="wrap">
                        <Text type="label" weight="medium">{isSample ? "Sample" : "Test"} {testNumber}</Text>
                        <VerdictBadge variant="chip" code={(tr.verdict ?? (isAC ? "AC" : "Failed")) as VerdictCode} />
                        {tr.runtime_ms != null && <Text type="supporting" color="secondary" hasTabularNumbers>{tr.runtime_ms}ms</Text>}
                        {!isSample && <Text type="supporting" color="secondary">Output details hidden</Text>}
                      </HStack>
                      {isSample && tr.checker_message && <Text type="supporting" color="secondary">{tr.checker_message}</Text>}
                      {!isAC && isSample && (expected != null || got != null) && (
                        <VStack gap={3}><SampleOutput label="Expected output" value={expected} /><SampleOutput label="Actual output" value={got} /></VStack>
                      )}
                      {isAC && isSample && got != null && String(got).length > 0 && (
                        <SampleOutput label="Actual output" value={got} />
                      )}
                    </VStack>
                  );
                })}
              </VStack>
            )}
            {isRunning ? (
              <Text color="secondary">Running…</Text>
            ) : runResult?.status === "CE" ? (
              <Text color="secondary">Compilation failed — see Compiler output.</Text>
            ) : runTimedOut ? (
              <Banner status="warning" title="Run is taking longer than expected" description="It may still be queued. Try Run again." />
            ) : runResultAttemptId && runSampleTests === null && runResult && !isPendingSubmissionStatus(runResult.status) ? (
              <Text color="secondary">Loading sample results…</Text>
            ) : runSampleTests && runSampleTests.length > 0 ? (
              runResult?.stdout ? <Text type="code" color="secondary" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{runResult.stdout}</Text> : null
            ) : runResult?.stdout ? (
              <Text type="code" color="secondary" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{runResult.stdout}</Text>
            ) : runResult?.stderr ? (
              <Text type="code" style={{ color: "var(--color-text-orange)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{runResult.stderr}</Text>
            ) : runResult ? (
              <Text color="secondary">No output.</Text>
            ) : runError ? (
              <Banner status="error" title={runError} />
            ) : (
              <Text color="secondary">{isEditorEmpty ? "Write code to prepare a run." : "Run your code to see stdout and stderr."}</Text>
            )}
          </VStack>
        )}
        {terminalTab === "logs" && (
          <VStack gap={3} padding={4}>
            <HStack gap={3} align="center" wrap="wrap">
              <Text type="supporting" color="secondary" weight="medium">Compiler output</Text>
              {runResult && !isRunning && <HStack gap={2} align="center" wrap="wrap">
                <VerdictBadge variant="chip" code={runResult.status as VerdictCode} />
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  {runResult.runtime_ms != null && `${runResult.runtime_ms}ms`}
                  {runResult.memory_kb != null && ` · ${Math.round(runResult.memory_kb / 1024)}MB`}
                </Text>
              </HStack>}
              {isRunning && <Text type="supporting" color="secondary">Running…</Text>}
            </HStack>
            {(() => {
              const fromRun = runResult?.compile_output ?? null;
              const fromSubmission = latestAttempt?.compile_output ?? null;
              const text = runResult ? fromRun : fromSubmission;
              if (!text) {
                if (isRunning) return null;
                return <Text color="secondary">{runResult || latestAttempt ? "No compiler output." : "Compiler messages appear here after a run or submission."}</Text>;
              }
              const isError = runResult ? runResult.status === "CE" : (latestAttempt?.final_verdict ?? latestAttempt?.status) === "CE";
              return (
                <VStack gap={2}>
                  <Text type="supporting" color="secondary">{runResult ? "From this sample run" : "From your last submission"}</Text>
                  {compilerDiagnostic && <VStack gap={2} padding={3} style={{ background: "var(--color-background-body)", borderRadius: "var(--radius-element)" }}>
                    <Text weight="medium" style={{ overflowWrap: "anywhere" }}>{compilerDiagnostic.message}</Text>
                    <HStack gap={2} align="center" wrap="wrap">
                      <Text type="supporting" color="secondary" style={{ overflowWrap: "anywhere" }}>{compilerDiagnostic.filename} · line {compilerDiagnostic.line}{compilerDiagnostic.column ? `, column ${compilerDiagnostic.column}` : ""}</Text>
                      {onJumpToCompilerError && <Button label={`Go to line ${compilerDiagnostic.line}`} variant="secondary" size="sm" onClick={onJumpToCompilerError} />}
                    </HStack>
                    {!onJumpToCompilerError && <Text type="supporting" color="secondary">This location cannot be matched to the current file and code version.</Text>}
                  </VStack>}
                  <Text type="code" style={{ color: isError ? "var(--color-text-red)" : "var(--color-text-secondary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text}</Text>
                </VStack>
              );
            })()}
          </VStack>
        )}
        {terminalTab === "submissions" && (
          <VStack gap={4} padding={4}>
            <HStack gap={3} align="center" justify="between" wrap="wrap">
              <Text type="supporting" color="secondary" weight="medium">{problemLabel ? `Attempts · ${problemLabel}` : "Attempts"}</Text>
              <SegmentedControl label="Filter attempts and tests" value={testResultFilter} onChange={(value) => setTestResultFilter(value as "all" | "failed" | "passed")} size="sm">
                <SegmentedControlItem value="all" label="All" />
                <SegmentedControlItem value="failed" label="Failed" />
                <SegmentedControlItem value="passed" label="Passed" />
              </SegmentedControl>
            </HStack>
            {latestAttempt && (
              <VStack gap={3} paddingBlock={3} style={{ borderBottom: "var(--border-width) solid var(--color-border)" }}>
                <HStack gap={3} align="center" wrap="wrap">
                  <VerdictBadge variant="full" code={(latestAttempt.final_verdict ?? latestAttempt.status) as VerdictCode} />
                  <Text type="supporting" color="secondary">Attempt #{latestAttempt.attempt_no}</Text>
                </HStack>
                <HStack gap={3} wrap="wrap">
                  <Text type="supporting" color="secondary">{latestAttemptTests ? `${latestAttemptPassed} / ${latestAttemptTests.length} passed` : latestAttemptPending ? "Judging in progress" : "Loading test results"}</Text>
                  <Text type="supporting" color="secondary">Score: {latestAttempt.score ?? "N/A"}</Text>
                  <Text type="supporting" color="secondary">{latestAttempt.runtime_ms != null ? `${latestAttempt.runtime_ms}ms` : "Runtime N/A"}</Text>
                  <Text type="supporting" color="secondary">{latestAttempt.memory_kb != null ? `${Math.round(latestAttempt.memory_kb / 1024)}MB` : "Memory N/A"}</Text>
                </HStack>
                {latestAttemptFirstFailed ? (
                  <Banner status="error" title={latestAttemptFirstFailed.hidden || latestAttemptFirstFailed.is_hidden ? `Hidden test ${latestAttemptFirstFailed.test_number ?? ""} failed` : `Test ${latestAttemptFirstFailed.test_number ?? "?"} failed`} description={
                    <Text type="supporting">
                      {latestAttemptFirstFailed.verdict ?? "Failed"}
                      {latestAttemptFirstFailed.runtime_ms != null && ` · ${latestAttemptFirstFailed.runtime_ms}ms`}
                      {latestAttemptFirstFailed.memory_kb != null && ` · ${Math.round(latestAttemptFirstFailed.memory_kb / 1024)}MB`}
                      {(latestAttemptFirstFailed.message || latestAttemptFirstFailed.status_message || latestAttemptFirstFailed.error) && ` · ${latestAttemptFirstFailed.message ?? latestAttemptFirstFailed.status_message ?? latestAttemptFirstFailed.error}`}
                    </Text>
                  } />
                ) : latestAttemptTests && latestAttemptTests.length > 0 ? (
                  <Text type="supporting" style={{ color: "var(--color-text-green)" }}>All visible tests passed.</Text>
                ) : (
                  <Text type="supporting" color="secondary">Test-case details will appear here when the judge returns them.</Text>
                )}
              </VStack>
            )}
            {loadingSubmissions && submissionsList.length === 0 ? (
              <HStack gap={2} align="center" role="status"><Spinner size="sm" /><Text color="secondary">Loading submissions…</Text></HStack>
            ) : submissionsList.length === 0 ? (
              <VStack gap={2} paddingBlock={3}>
                <Text weight="medium">{problemLabel ? `No attempts on ${problemLabel} yet` : "No attempts yet"}</Text>
                <Text type="supporting" color="secondary">Press Submit Solution to send your code to the judge. This list shows only {problemLabel ? `problem ${problemLabel}` : "this problem"}. Each attempt is scored independently.</Text>
              </VStack>
            ) : (
              <VStack gap={0}>
                {submissionsList.filter(attemptMatchesFilter).length === 0 && <Text color="secondary">No {testResultFilter} attempts yet.</Text>}
                {submissionsList.filter(attemptMatchesFilter).map((sub) => {
                  const isExpanded = expandedAttemptId === sub.id;
                  const status = sub.status;
                  const isPending = status === "QUEUED" || status === "RUNNING";
                  return (
                    <VStack key={sub.id} gap={2} paddingBlock={3} style={{ borderBottom: "var(--border-width) solid var(--color-border)" }}>
                      <Button
                        label={`Attempt #${sub.attempt_no}`}
                        variant="ghost"
                        aria-expanded={isExpanded}
                        onClick={() => toggleExpandAttempt(sub.id)}
                        style={{ height: "auto", minHeight: "var(--spacing-8)", width: "100%", paddingInline: 0, justifyContent: "space-between", textAlign: "start" }}
                        endContent={isExpanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                      >
                        <HStack as="span" gap={3} align="center" wrap="wrap">
                          <VerdictBadge variant="chip" code={(isPending ? sub.status : (sub.final_verdict ?? sub.status)) as VerdictCode} />
                          <Text type="supporting">Attempt #{sub.attempt_no}</Text>
                          <Text type="supporting" color="secondary">{LANGUAGE_META[sub.language as keyof typeof LANGUAGE_META]?.name || sub.language}</Text>
                          <Text type="supporting" color="secondary" hasTabularNumbers>{new Date(sub.created_at).toLocaleTimeString()}</Text>
                        </HStack>
                      </Button>
                      {isExpanded && (
                        <VStack gap={3} padding={3} style={{ borderInlineStart: "var(--border-width) solid var(--color-border)" }}>
                          {isPending ? (
                            <Text type="supporting" color="secondary">Grading in progress... Live results will update automatically.</Text>
                          ) : (
                            <>
                              <HStack gap={3} wrap="wrap">
                                <Text type="supporting" color="secondary">Runtime: {sub.runtime_ms !== null ? `${sub.runtime_ms} ms` : "N/A"}</Text>
                                <Text type="supporting" color="secondary">Memory: {sub.memory_kb !== null ? `${sub.memory_kb} KB` : "N/A"}</Text>
                                <Text type="supporting" color="secondary">Score: {sub.score}</Text>
                              </HStack>
                              {testResults[sub.id] ? (() => {
                                const trs = testResults[sub.id];
                                const passedCount = trs.filter((tr: any) => tr.verdict === "AC").length;
                                return (
                                  <VStack gap={2}>
                                    <Text type="supporting" color="secondary">{passedCount} / {trs.length} test cases passed</Text>
                                    {trs.map((tr: any, originalIndex: number) => ({ tr, originalIndex })).filter(({ tr }: any) => testResultFilter === "all" ? true : testResultFilter === "passed" ? tr.verdict === "AC" : tr.verdict !== "AC").map(({ tr, originalIndex }: any, idx: number) => {
                                      const testNumber = tr.test_number ?? originalIndex + 1;
                                      return (
                                        <HStack key={`${sub.id}-${testNumber}-${idx}`} gap={3} align="center" wrap="wrap" paddingBlock={1}>
                                          <Text type="supporting">Test {testNumber}</Text>
                                          <VerdictBadge variant="chip" code={(tr.verdict ?? tr.status) as VerdictCode} />
                                          {tr.runtime_ms != null && <Text type="supporting" color="secondary" hasTabularNumbers>{tr.runtime_ms}ms</Text>}
                                          {tr.memory_kb != null && <Text type="supporting" color="secondary" hasTabularNumbers>{Math.round(tr.memory_kb / 1024)}MB</Text>}
                                        </HStack>
                                      );
                                    })}
                                    {trs.filter((tr: any) => testResultFilter === "all" ? true : testResultFilter === "passed" ? tr.verdict === "AC" : tr.verdict !== "AC").length === 0 && <Text type="supporting" color="secondary">No {testResultFilter} tests in this attempt.</Text>}
                                  </VStack>
                                );
                              })() : <Text type="supporting" color="secondary">Loading test results...</Text>}
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

import { type Dispatch, type SetStateAction } from "react";
import { Loader2, ChevronUp, ChevronDown } from "lucide-react";
import {
  isPendingSubmissionStatus,
  type RunAttempt,
  type SubmissionAttemptRecord,
} from "../submission-state";
import { VERDICT_COLORS } from "./verdict-styles";
import { VerdictBadge } from "@/lib/VerdictBadge";
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
  java17: {
    ext: "java",
    name: "Java 17",
    starter: `import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        // Write your Java 17 solution here
    }
}`,
  },
};

// A test row is a "sample" test (expected/got may be shown) only when it is not
// flagged hidden by any of the indicators the Attempts UI already recognizes.
// Hidden/fallback tests show verdict only — never expected/got.
function isSampleTestRow(tr: {
  is_sample?: boolean | null;
  sample?: boolean | null;
  hidden?: boolean | null;
  is_hidden?: boolean | null;
}): boolean {
  if (tr.hidden || tr.is_hidden) return false;
  // The API returns an explicit is_sample boolean; a false means hidden/fallback.
  if (tr.is_sample === false || tr.sample === false) return false;
  if (tr.is_sample === true || tr.sample === true) return true;
  // No flag at all (legacy rows) → treat as visible, mirroring the Attempts expansion.
  return true;
}

type RunStatusView = {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: "error" | "pending" | "loading" | "dot";
} | null;

export interface TerminalPanelProps {
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
    <div
      style={{
        height: terminalCollapsed ? "38px" : "30%",
        minHeight: terminalCollapsed ? "38px" : "200px",
        display: "flex",
        flexDirection: "column",
        background: "#0F0F0F",
        overflow: "hidden",
        transition: "height 160ms ease, min-height 160ms ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderBottom: shouldShowRunProgress ? "none" : "1px solid #1F1F1F",
          background: "#0F0F0F",
          padding: "0 16px",
          flexShrink: 0,
          height: "38px",
          gap: "16px",
        }}
      >
        <button
          type="button"
          onClick={() => setTerminalTab("stdout")}
          style={{
            fontSize: "12px",
            color: terminalTab === "stdout" ? "var(--color-accent-light)" : "#64748b",
            background: "transparent",
            border: "none",
            borderBottom:
              terminalTab === "stdout"
                ? "2px solid var(--color-accent-base)"
                : "2px solid transparent",
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: terminalTab === "stdout" ? 600 : 500,
            cursor: "pointer",
            height: "100%",
            padding: "0 4px",
          }}
        >
          Output
        </button>
        <button
          type="button"
          onClick={() => setTerminalTab("logs")}
          style={{
            fontSize: "12px",
            color: terminalTab === "logs" ? "var(--color-accent-light)" : "#64748b",
            background: "transparent",
            border: "none",
            borderBottom:
              terminalTab === "logs"
                ? "2px solid var(--color-accent-base)"
                : "2px solid transparent",
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: terminalTab === "logs" ? 600 : 500,
            cursor: "pointer",
            height: "100%",
            padding: "0 4px",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            Compiler output
            {runResult?.status === "CE" && (
              <span
                style={{
                  padding: "1px 5px",
                  borderRadius: "var(--radius-pill)",
                  background: "rgba(167,139,250,0.16)",
                  color: "var(--verdict-ce)",
                  fontSize: "9px",
                  fontWeight: 700,
                }}
              >
                CE
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTerminalTab("submissions")}
          style={{
            fontSize: "12px",
            color: terminalTab === "submissions" ? "var(--color-accent-light)" : "#64748b",
            background: "transparent",
            border: "none",
            borderBottom:
              terminalTab === "submissions"
                ? "2px solid var(--color-accent-base)"
                : "2px solid transparent",
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: terminalTab === "submissions" ? 600 : 500,
            cursor: "pointer",
            height: "100%",
            padding: "0 4px",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            Attempts
            {submissionsList.length > 0 && (
              <span
                style={{
                  padding: "1px 6px",
                  borderRadius: "999px",
                  background:
                    terminalTab === "submissions"
                      ? "rgb(var(--accent-rgb) / 0.16)"
                      : "rgba(148,163,184,0.1)",
                  color: terminalTab === "submissions" ? "#d8b4fe" : "#94a3b8",
                  fontSize: "9px",
                  fontWeight: 700,
                }}
              >
                {submissionsList.length}
              </span>
            )}
          </span>
        </button>
        <div style={{ flex: 1 }} />
        {latestAttempt && (
          <div
            title="Latest judge verdict"
            style={{
              height: "24px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "0 9px",
              borderRadius: "999px",
              border: "1px solid rgba(148,163,184,0.14)",
              background: "rgba(148,163,184,0.06)",
              color: "#94a3b8",
              fontSize: "11px",
              fontWeight: 600,
              fontFamily: "Inter, system-ui, sans-serif",
              whiteSpace: "nowrap",
            }}
          >
            Latest
            {(() => {
              const latestCode = (latestAttempt.final_verdict ??
                latestAttempt.status) as VerdictCode;
              // key by attempt+code so the reveal re-fires even when two consecutive
              // attempts resolve to the same verdict (e.g. AC → AC).
              return (
                <VerdictBadge
                  key={`${latestAttempt?.id ?? ""}-${String(latestCode)}`}
                  variant="chip"
                  code={latestCode}
                  reveal
                />
              );
            })()}
          </div>
        )}
        {runStatus && (
          <div
            role="status"
            aria-live="polite"
            style={{
              height: "24px",
              display: "flex",
              alignItems: "center",
              gap: "7px",
              padding: "0 10px",
              borderRadius: "999px",
              border: `1px solid ${runStatus.border}`,
              background: runStatus.bg,
              color: runStatus.color,
              fontSize: "11px",
              fontWeight: 700,
              fontFamily: "Inter, system-ui, sans-serif",
              whiteSpace: "nowrap",
            }}
          >
            {runStatus.icon === "loading" ? (
              <Loader2
                size={12}
                strokeWidth={2}
                style={{ animation: "spin 0.8s linear infinite" }}
              />
            ) : (
              // Neutral status dot in the verdict colour — no tick/cross glyphs.
              <span
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: "var(--radius-pill)",
                  background: runStatus.color,
                  flexShrink: 0,
                }}
              />
            )}
            {runStatus.label}
            {runMetrics && (
              <span style={{ color: "#94a3b8", fontWeight: 600 }}>· {runMetrics}</span>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setTerminalCollapsed((c) => !c)}
          title={terminalCollapsed ? "Expand output panel" : "Collapse output panel"}
          aria-label={
            terminalCollapsed
              ? terminalUnread
                ? "Expand output panel — output updated"
                : "Expand output panel"
              : "Collapse output panel"
          }
          style={{
            position: "relative",
            background: "transparent",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            padding: "4px",
            flexShrink: 0,
          }}
        >
          {terminalCollapsed ? (
            <ChevronUp size={16} strokeWidth={2} />
          ) : (
            <ChevronDown size={16} strokeWidth={2} />
          )}
          {terminalUnread && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                top: "3px",
                right: "3px",
                width: "6px",
                height: "6px",
                borderRadius: "var(--radius-pill)",
                background: "var(--color-accent-base)",
              }}
            />
          )}
        </button>
      </div>
      {shouldShowRunProgress && (
        <div
          style={{
            height: "34px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "0 16px",
            borderTop: "1px solid #1F1F1F",
            borderBottom: "1px solid #1F1F1F",
            background: "#0a0a0a",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "11px",
              letterSpacing: "0.06em",
              display: "flex",
              alignItems: "center",
              gap: "0",
              userSelect: "none",
            }}
          >
            {runProgressSteps.map((step, index) => {
              const current = index === runProgressPhase;
              const label = step.toUpperCase();
              return (
                <span key={step} style={{ display: "flex", alignItems: "center" }}>
                  <span
                    style={{
                      color: current ? "#ffffff" : "#71717a",
                      fontWeight: current ? 600 : 400,
                    }}
                  >
                    {current && index === 2 ? (
                      <span
                        style={{
                          ["--_running" as string]: "1",
                        }}
                      >
                        <style>{`
                          @media (prefers-reduced-motion: no-preference) {
                            @keyframes _ams_ellipsis {
                              0%,100% { opacity: 1; }
                              50% { opacity: 0.3; }
                            }
                            ._ams_running_ellipsis::after {
                              content: '…';
                              animation: _ams_ellipsis 1.2s ease-in-out infinite;
                              display: inline-block;
                            }
                          }
                        `}</style>
                        <span className="_ams_running_ellipsis">{label}</span>
                      </span>
                    ) : (
                      label
                    )}
                  </span>
                  {index < runProgressSteps.length - 1 && (
                    <span style={{ color: "#71717a", margin: "0 6px" }}>{"→"}</span>
                  )}
                </span>
              );
            })}
          </span>
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          color: "#a8b2d1",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "12px",
          lineHeight: 1.6,
          background: "#0F0F0F",
          overflowY: "auto",
        }}
      >
        {terminalTab === "stdout" && (
          <div style={{ padding: "12px 16px" }}>
            <div
              style={{
                color: "#64748b",
                fontSize: "10px",
                letterSpacing: "0.1em",
                marginBottom: "8px",
              }}
            >
              OUTPUT
            </div>
            {/* LeetCode-style sample results for a "Run on Judge". Runs
                are judged against sample tests only and never appear in
                Attempts, so this is the only place they render. Sample
                tests may show expected-vs-got; hidden/fallback tests show
                the verdict only (mirroring the Attempts masking). */}
            {!isRunning && runResult?.status !== "CE" && runSampleTests && (
              <div style={{ marginBottom: runResult?.stdout ? "12px" : "0" }}>
                {runSampleTests.length === 0 ? (
                  <div style={{ color: "#475569" }}>No sample tests to run for this problem.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {runSampleTests.map((tr: any, idx: number) => {
                      const isAC = tr.verdict === "AC";
                      const isSample = isSampleTestRow(tr);
                      const testNumber = tr.test_number ?? idx + 1;
                      const expected = tr.expected ?? tr.expected_output ?? tr.answer ?? null;
                      const got =
                        tr.got_output ?? tr.got ?? tr.actual ?? tr.output ?? tr.stdout ?? null;
                      return (
                        <div
                          key={`run-sample-${testNumber}-${idx}`}
                          style={{
                            whiteSpace: "pre-wrap",
                            color: isAC ? "#86efac" : "#fca5a5",
                          }}
                        >
                          <span style={{ fontWeight: 700 }}>
                            {isSample ? "Sample" : "Test"} {testNumber}:
                          </span>{" "}
                          <span style={{ color: isAC ? "#86efac" : "#fca5a5" }}>
                            {tr.verdict ?? (isAC ? "AC" : "Failed")}
                          </span>
                          {tr.runtime_ms != null && (
                            <span style={{ color: "#64748b" }}>{` ${tr.runtime_ms}ms`}</span>
                          )}
                          {!isSample && <span style={{ color: "#64748b" }}> · hidden test</span>}
                          {/* Expected/got only for sample tests, and
                              only when the test failed (matches the
                              LeetCode-style "got X expected Y"). Hidden
                              tests never reveal expected/got. */}
                          {!isAC && isSample && (expected != null || got != null) && (
                            <span style={{ color: "#94a3b8" }}>
                              {` — expected ${JSON.stringify(String(expected ?? ""))} got ${JSON.stringify(String(got ?? ""))}`}
                            </span>
                          )}
                          {/* Passing runs show the program's stdout too — candidates
                              expect to see their prints, not just a verdict. Sample
                              tests only; hidden tests stay masked. */}
                          {isAC && isSample && got != null && String(got).length > 0 && (
                            <div
                              style={{
                                color: "#94a3b8",
                                whiteSpace: "pre-wrap",
                                padding: "4px 0 2px 14px",
                                borderLeft: "2px solid rgba(148,163,184,0.15)",
                                marginTop: "4px",
                                marginLeft: "2px",
                              }}
                            >
                              {String(got).replace(/\n$/, "")}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {isRunning ? (
              <div style={{ color: "#475569" }}>Running…</div>
            ) : runResult?.status === "CE" ? (
              <div style={{ color: "#475569" }}>Compilation failed — see Build.</div>
            ) : runTimedOut ? (
              <div style={{ color: "#f59e0b" }}>
                Run is taking longer than expected — it may still be queued. Try Run again.
              </div>
            ) : runResultAttemptId &&
              runSampleTests === null &&
              runResult &&
              !isPendingSubmissionStatus(runResult.status) ? (
              <div style={{ color: "#475569" }}>Loading sample results…</div>
            ) : runSampleTests && runSampleTests.length > 0 ? (
              // Sample rows above already convey the result; only add
              // raw stdout if the judge returned any.
              runResult?.stdout ? (
                <div style={{ color: "#94a3b8", whiteSpace: "pre-wrap" }}>{runResult.stdout}</div>
              ) : null
            ) : runResult?.stdout ? (
              <div style={{ color: "#94a3b8", whiteSpace: "pre-wrap" }}>{runResult.stdout}</div>
            ) : runResult?.stderr ? (
              <div style={{ color: "#f97316", whiteSpace: "pre-wrap" }}>{runResult.stderr}</div>
            ) : runResult ? (
              <div style={{ color: "#475569" }}>No output.</div>
            ) : runError ? (
              <div style={{ color: "#ef4444" }}>{runError}</div>
            ) : (
              <div style={{ color: isEditorEmpty ? "#334155" : "#475569" }}>
                {isEditorEmpty
                  ? "Write code to prepare a run."
                  : "Run your code to see stdout and stderr."}
              </div>
            )}
          </div>
        )}

        {terminalTab === "logs" && (
          <div style={{ padding: "12px 16px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "8px",
              }}
            >
              <span style={{ color: "#64748b", fontSize: "10px", letterSpacing: "0.08em" }}>
                Build
              </span>
              {runResult && !isRunning && (
                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    color: VERDICT_COLORS[runResult.status] ?? "#64748b",
                  }}
                >
                  {runResult.status}
                  {runResult.runtime_ms != null && ` · ${runResult.runtime_ms}ms`}
                  {runResult.memory_kb != null && ` · ${Math.round(runResult.memory_kb / 1024)}MB`}
                </span>
              )}
              {isRunning && (
                <span
                  style={{
                    fontSize: "9px",
                    color: "var(--color-accent-base)",
                    letterSpacing: "0.1em",
                  }}
                >
                  Running…
                </span>
              )}
            </div>
            {/* A submission's compiler output counts too. This tab read only
                `runResult`, so a candidate who *submitted* code that failed to
                compile saw a bare CE verdict and the words "Compiler messages
                appear here after a run" — the diagnostic they needed most,
                withheld at the moment they needed it. The adapter has carried
                `compile_output` on every attempt all along; nothing read it.

                A run wins when both exist, because it is the more recent thing
                the candidate did, and the source is named either way so the
                two are never mistaken for each other. */}
            {(() => {
              const fromRun = runResult?.compile_output ?? null;
              const fromSubmission = latestAttempt?.compile_output ?? null;
              const text = fromRun || fromSubmission;
              if (!text) {
                if (isRunning) return null;
                return runResult || latestAttempt ? (
                  <div style={{ color: "#475569" }}>No compiler output.</div>
                ) : (
                  <div style={{ color: "#334155" }}>
                    Compiler messages appear here after a run or submission.
                  </div>
                );
              }
              const isError = fromRun
                ? runResult?.status === "CE"
                : (latestAttempt?.final_verdict ?? latestAttempt?.status) === "CE";
              return (
                <>
                  <div
                    style={{
                      fontSize: "9px",
                      letterSpacing: "0.1em",
                      color: "#475569",
                      marginBottom: "6px",
                    }}
                  >
                    {fromRun ? "FROM YOUR LAST RUN" : "FROM YOUR LAST SUBMISSION"}
                  </div>
                  <div style={{ color: isError ? "#fca5a5" : "#94a3b8", whiteSpace: "pre-wrap" }}>
                    {text}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {terminalTab === "submissions" && (
          <div style={{ padding: "12px 16px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                marginBottom: "10px",
              }}
            >
              <span
                style={{
                  color: "#64748b",
                  fontSize: "10px",
                  letterSpacing: "0.08em",
                  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                  textTransform: "uppercase",
                }}
              >
                Attempts
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                {(["all", "failed", "passed"] as const).map((filter) => {
                  const active = testResultFilter === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setTestResultFilter(filter)}
                      onMouseEnter={(e) => {
                        if (testResultFilter !== filter) e.currentTarget.style.color = "#cbd5e1";
                      }}
                      onMouseLeave={(e) => {
                        if (testResultFilter !== filter) e.currentTarget.style.color = "#64748b";
                      }}
                      style={{
                        padding: "4px 2px 3px",
                        border: "none",
                        borderBottom: `2px solid ${active ? "var(--color-accent-base)" : "transparent"}`,
                        background: "transparent",
                        color: active ? "#ffffff" : "#64748b",
                        fontSize: "10px",
                        fontWeight: 600,
                        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        cursor: "pointer",
                        transition: "color 120ms ease, border-color 120ms ease",
                      }}
                    >
                      {filter}
                    </button>
                  );
                })}
              </div>
            </div>
            {latestAttempt && (
              <div
                style={{
                  paddingBottom: "12px",
                  marginBottom: "12px",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    marginBottom: "10px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                    {/* Verdict first: it's the most important fact about the
                        row and anchors the eye. The "Evaluated" badge is gone —
                        a terminal verdict already implies it. */}
                    <VerdictBadge
                      variant="full"
                      code={(latestAttempt.final_verdict ?? latestAttempt.status) as VerdictCode}
                    />
                    <span style={{ color: "#64748b", fontSize: "11px" }}>
                      Attempt #{latestAttempt.attempt_no}
                    </span>
                    <span
                      style={{
                        padding: "2px 7px",
                        borderRadius: "999px",
                        border: "1px solid rgba(148,163,184,0.16)",
                        background: "rgba(148,163,184,0.08)",
                        color: "#94a3b8",
                        fontSize: "10px",
                        fontWeight: 600,
                        fontFamily: "Inter, system-ui, sans-serif",
                      }}
                    >
                      Evaluated attempt
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      color: "#94a3b8",
                      fontSize: "11px",
                    }}
                  >
                    <span>
                      {latestAttemptTests
                        ? `${latestAttemptPassed} / ${latestAttemptTests.length} passed`
                        : latestAttemptPending
                          ? "Judging in progress"
                          : "Loading test results"}
                    </span>
                    <span>Score: {latestAttempt.score ?? "N/A"}</span>
                    <span>
                      {latestAttempt.runtime_ms != null
                        ? `${latestAttempt.runtime_ms}ms`
                        : "Runtime N/A"}
                    </span>
                    <span>
                      {latestAttempt.memory_kb != null
                        ? `${Math.round(latestAttempt.memory_kb / 1024)}MB`
                        : "Memory N/A"}
                    </span>
                  </div>
                </div>
                {latestAttemptFirstFailed ? (
                  <div
                    style={{
                      border: "1px solid rgba(239,68,68,0.22)",
                      background: "rgba(239,68,68,0.06)",
                      borderRadius: "6px",
                      padding: "8px 10px",
                      color: "#fca5a5",
                      fontSize: "11px",
                      lineHeight: 1.45,
                    }}
                  >
                    <strong style={{ color: "#fecaca" }}>
                      {latestAttemptFirstFailed.hidden || latestAttemptFirstFailed.is_hidden
                        ? `Hidden test ${latestAttemptFirstFailed.test_number ?? ""} failed`
                        : `Test ${latestAttemptFirstFailed.test_number ?? "?"} failed`}
                    </strong>
                    {` · ${latestAttemptFirstFailed.verdict ?? "Failed"}`}
                    {latestAttemptFirstFailed.runtime_ms != null &&
                      ` · ${latestAttemptFirstFailed.runtime_ms}ms`}
                    {latestAttemptFirstFailed.memory_kb != null &&
                      ` · ${Math.round(latestAttemptFirstFailed.memory_kb / 1024)}MB`}
                    {(latestAttemptFirstFailed.message ||
                      latestAttemptFirstFailed.status_message ||
                      latestAttemptFirstFailed.error) && (
                      <span style={{ color: "#fca5a5" }}>
                        {` · ${latestAttemptFirstFailed.message ?? latestAttemptFirstFailed.status_message ?? latestAttemptFirstFailed.error}`}
                      </span>
                    )}
                  </div>
                ) : latestAttemptTests && latestAttemptTests.length > 0 ? (
                  <div style={{ color: "#86efac", fontSize: "11px" }}>
                    All visible tests passed.
                  </div>
                ) : (
                  <div style={{ color: "#64748b", fontSize: "11px" }}>
                    Test-case details will appear here when the judge returns them.
                  </div>
                )}
              </div>
            )}
            {loadingSubmissions && submissionsList.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: "11px" }}>Loading submissions...</div>
            ) : submissionsList.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "24px 16px",
                  color: "#475569",
                }}
              >
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#475569",
                    fontFamily: "Inter, system-ui, sans-serif",
                  }}
                >
                  No submissions yet
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    color: "#334155",
                    fontFamily: "Inter, system-ui, sans-serif",
                    textAlign: "center",
                    lineHeight: 1.5,
                  }}
                >
                  Press Submit Solution to send your code to the judge.
                  <br />
                  Each attempt is scored independently.
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {submissionsList.filter(attemptMatchesFilter).length === 0 && (
                  <div style={{ color: "#64748b", fontSize: "11px", padding: "4px 0" }}>
                    No {testResultFilter} attempts yet.
                  </div>
                )}
                {submissionsList.filter(attemptMatchesFilter).map((sub) => {
                  const isExpanded = expandedAttemptId === sub.id;
                  const status = sub.status;
                  const isPending = status === "QUEUED" || status === "RUNNING";

                  return (
                    <div
                      key={sub.id}
                      style={{ borderBottom: "1px solid #1F1F1F", paddingBottom: "8px" }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          cursor: "pointer",
                        }}
                        onClick={() => toggleExpandAttempt(sub.id)}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          {/* Verdict first: it's the most important fact about the
                              row and anchors the eye. The "Evaluated" badge is gone —
                              a terminal verdict already implies it. */}
                          <VerdictBadge
                            variant="chip"
                            code={
                              (isPending
                                ? sub.status
                                : (sub.final_verdict ?? sub.status)) as VerdictCode
                            }
                          />
                          <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                            Attempt #{sub.attempt_no}
                          </span>
                          <span
                            style={{
                              fontSize: "10px",
                              padding: "1px 5px",
                              background: "#1F1F1F",
                              borderRadius: "var(--radius-sm)",
                              color: "var(--text-soft)",
                              fontFamily: "'JetBrains Mono', monospace",
                            }}
                          >
                            {LANGUAGE_META[sub.language as keyof typeof LANGUAGE_META]?.name ||
                              sub.language}
                          </span>
                          <span
                            style={{
                              fontSize: "11px",
                              color: "var(--text-dim)",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {new Date(sub.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                        <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </span>
                      </div>

                      {isExpanded && (
                        <div
                          style={{
                            marginTop: "6px",
                            padding: "6px 8px",
                            borderLeft: "2px solid rgb(var(--accent-rgb) / 0.3)",
                          }}
                        >
                          {isPending ? (
                            <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                              Grading in progress... Live results will update automatically.
                            </div>
                          ) : (
                            <>
                              <div
                                style={{
                                  display: "flex",
                                  gap: "16px",
                                  marginBottom: "8px",
                                  fontSize: "10px",
                                  color: "var(--text-dim)",
                                  fontVariantNumeric: "tabular-nums",
                                }}
                              >
                                <span>
                                  Runtime:{" "}
                                  {sub.runtime_ms !== null ? `${sub.runtime_ms} ms` : "N/A"}
                                </span>
                                <span>
                                  Memory: {sub.memory_kb !== null ? `${sub.memory_kb} KB` : "N/A"}
                                </span>
                                <span>Score: {sub.score}</span>
                              </div>

                              <div>
                                {testResults[sub.id] ? (
                                  (() => {
                                    const trs = testResults[sub.id];
                                    const passedCount = trs.filter(
                                      (tr: any) => tr.verdict === "AC"
                                    ).length;
                                    return (
                                      <>
                                        <div
                                          style={{
                                            fontSize: "10px",
                                            color: "#64748b",
                                            marginBottom: "6px",
                                          }}
                                        >
                                          <span
                                            style={{
                                              color:
                                                passedCount === trs.length ? "#22c55e" : "#94a3b8",
                                              fontWeight: 600,
                                            }}
                                          >
                                            {passedCount} / {trs.length}
                                          </span>{" "}
                                          test cases passed
                                        </div>
                                        <div
                                          style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: "4px",
                                          }}
                                        >
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
                                              const testNumber =
                                                tr.test_number ?? originalIndex + 1;
                                              const isPass = (tr.verdict ?? tr.status) === "AC";
                                              return (
                                                <div
                                                  key={`${sub.id}-${testNumber}-${idx}`}
                                                  style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "5px",
                                                    fontSize: "10px",
                                                    color: "var(--text-soft)",
                                                    paddingLeft: "6px",
                                                    borderLeft: `2px solid ${
                                                      isPass
                                                        ? "var(--verdict-ac)"
                                                        : "var(--verdict-wa)"
                                                    }`,
                                                    fontVariantNumeric: "tabular-nums",
                                                  }}
                                                >
                                                  <span>Test {testNumber}</span>
                                                  <VerdictBadge
                                                    variant="chip"
                                                    code={(tr.verdict ?? tr.status) as VerdictCode}
                                                  />
                                                  {tr.runtime_ms != null && (
                                                    <span style={{ color: "var(--text-faint)" }}>
                                                      {tr.runtime_ms}ms
                                                    </span>
                                                  )}
                                                  {tr.memory_kb != null && (
                                                    <span style={{ color: "var(--text-faint)" }}>
                                                      {Math.round(tr.memory_kb / 1024)}
                                                      MB
                                                    </span>
                                                  )}
                                                </div>
                                              );
                                            })}
                                        </div>
                                        {trs.filter((tr: any) =>
                                          testResultFilter === "all"
                                            ? true
                                            : testResultFilter === "passed"
                                              ? tr.verdict === "AC"
                                              : tr.verdict !== "AC"
                                        ).length === 0 && (
                                          <div style={{ color: "#64748b", fontSize: "10px" }}>
                                            No {testResultFilter} tests in this attempt.
                                          </div>
                                        )}
                                      </>
                                    );
                                  })()
                                ) : (
                                  <div style={{ fontSize: "10px", color: "#64748b" }}>
                                    Loading test results...
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

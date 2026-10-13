import { useEffect, useMemo, useState } from "react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Spinner } from "@astryxdesign/core/Spinner";
import { outputText } from "../execution-output";
import { GATE_KIND } from "../family-summary";

/**
 * What the judge said, for one run or one submission.
 *
 * Modelled on the shape every competitive programmer already reads without
 * thinking: a verdict in words, the cases as chips, and the detail of
 * whichever chip is selected. One case on screen at a time.
 *
 * The panel this replaces stacked everything vertically — the run, then the
 * last submission, then every earlier attempt with its own expandable test
 * list. Scrolling a verdict is the wrong gesture: by the third screen a
 * candidate is reading results from an attempt they made twenty minutes ago
 * and cannot tell them apart. History belongs in its own tab, which is where
 * it now lives.
 *
 * The one thing deliberately *not* borrowed is the assumption that every
 * check is an input and an expected output. Three families run here and they
 * fail for different reasons, so each gets its own detail view:
 *
 * - **io** — ordinary samples. Input, your output, expected.
 * - **behaviour** — a GTest case. There is no input to show; what matters is
 *   which assertion failed, so the checker's message is the content.
 * - **symbolic** — a source rule: a construct the solution must or must not
 *   use. It is a **gate**: one violation zeroes the problem's partial credit
 *   however well the code runs, which makes it the most important thing on
 *   the screen and the least like a test case.
 */

type TestRow = {
  kind?: string;
  testcase_no?: number;
  label?: string;
  verdict?: string;
  runtime_ms?: number | null;
  memory_kb?: number | null;
  checker_message?: string;
  stdout_text?: string | null;
  stderr_text?: string | null;
  input?: unknown;
  expected?: unknown;
  output?: unknown;
  actual?: unknown;
};

const PASSING = new Set(["AC", "OK", "PASS"]);

function passed(row: TestRow): boolean {
  return PASSING.has(String(row.verdict ?? "").toUpperCase());
}

/** The headline, in the words a candidate expects to read. */
const VERDICT_WORDS: Record<string, string> = {
  AC: "Accepted",
  WA: "Wrong Answer",
  TLE: "Time Limit Exceeded",
  MLE: "Memory Limit Exceeded",
  RE: "Runtime Error",
  CE: "Compile Error",
  OLE: "Output Limit Exceeded",
  PE: "Presentation Error",
  SE: "Judge Error",
};

function verdictWord(code: string | null | undefined): string {
  if (!code) return "";
  return VERDICT_WORDS[String(code).toUpperCase()] ?? String(code);
}

/* Families, in the order the breakdown already uses. Named for candidates
   rather than for the judge: nobody outside this codebase calls a GTest case
   "behavior". */
const FAMILY = {
  io: { label: "Sample", hint: "Your output against the expected output." },
  behavior: { label: "Behaviour", hint: "An automated check on what your code does." },
  [GATE_KIND]: {
    label: "Rule",
    hint: "A constraint on the source itself. Breaking one zeroes this problem.",
  },
} as const;

function familyOf(row: TestRow): keyof typeof FAMILY {
  const kind = (row.kind || "io") as keyof typeof FAMILY;
  return kind in FAMILY ? kind : "io";
}

export function ResultsPanel({
  tests,
  verdict,
  runtimeMs,
  memoryKb,
  isRunning,
  progressLabel,
  error,
  compilerText,
  compilerIsError,
  onJumpToCompilerError,
  stale,
  emptyHint,
}: {
  tests: TestRow[] | null | undefined;
  /** The overall verdict. Null while judging. */
  verdict: string | null | undefined;
  runtimeMs?: number | null;
  memoryKb?: number | null;
  isRunning: boolean;
  progressLabel?: string;
  error?: string | null;
  compilerText?: string | null;
  compilerIsError?: boolean;
  onJumpToCompilerError?: () => void;
  /** The code has been edited since this result was produced. */
  stale?: boolean;
  emptyHint: string;
}) {
  const rows = useMemo(() => tests ?? [], [tests]);
  const [selected, setSelected] = useState(0);

  // Land on the first failure, which is the one being looked for. Re-run with
  // everything passing and it falls back to the first case rather than
  // keeping a stale index into a shorter list.
  useEffect(() => {
    const firstFailure = rows.findIndex((row) => !passed(row));
    setSelected(firstFailure === -1 ? 0 : firstFailure);
  }, [rows]);

  if (isRunning) {
    return (
      <VStack gap={3} padding={4} align="center" justify="center" style={{ minHeight: "8rem" }}>
        <Spinner size="sm" />
        <Text type="supporting" color="secondary">
          {progressLabel || "Judging…"}
        </Text>
      </VStack>
    );
  }

  if (error) {
    return (
      <VStack gap={2} padding={4}>
        <Text weight="semibold" style={{ color: "var(--color-text-error)" }}>
          {error}
        </Text>
      </VStack>
    );
  }

  const compileFailed = compilerIsError && compilerText;
  if (!rows.length && !compileFailed) {
    return (
      <VStack gap={2} padding={4}>
        <Text type="supporting" color="secondary">
          {emptyHint}
        </Text>
      </VStack>
    );
  }

  const allPassed = rows.length > 0 && rows.every(passed);
  const headline = verdictWord(verdict) || (allPassed ? "Accepted" : "Wrong Answer");
  const good = headline === "Accepted";

  // A broken rule is reported first and loudest, because partial credit is
  // already gone by the time a candidate reads anything else.
  const brokenRules = rows.filter((row) => familyOf(row) === GATE_KIND && !passed(row));

  const current = rows[Math.min(selected, Math.max(rows.length - 1, 0))];

  return (
    <VStack gap={4} padding={4} style={{ minWidth: 0 }}>
      {stale && (
        <Text type="supporting" style={{ color: "var(--color-text-warning)" }}>
          Code changed since this ran. These results belong to the earlier file.
        </Text>
      )}

      <HStack gap={3} align="center" wrap="wrap">
        <Text
          size="xl"
          weight="semibold"
          style={{ color: good ? "var(--color-text-success)" : "var(--color-text-error)" }}
        >
          {headline}
        </Text>
        {typeof runtimeMs === "number" && (
          <Text type="supporting" color="secondary">
            Runtime: {runtimeMs} ms
          </Text>
        )}
        {typeof memoryKb === "number" && memoryKb > 0 && (
          <Text type="supporting" color="secondary">
            Memory: {Math.round(memoryKb / 1024)} MB
          </Text>
        )}
        {rows.length > 0 && (
          <Text type="supporting" color="secondary">
            {rows.filter(passed).length}/{rows.length} passed
          </Text>
        )}
      </HStack>

      {brokenRules.length > 0 && (
        <VStack
          gap={2}
          padding={3}
          style={{
            borderRadius: "var(--radius-element)",
            border: "var(--border-width) solid var(--color-border-error)",
            background: "var(--color-background-error-subtle)",
          }}
        >
          <Text weight="semibold" style={{ color: "var(--color-text-error)" }}>
            {brokenRules.length === 1 ? "A source rule was broken" : "Source rules were broken"}
          </Text>
          <Text type="supporting" color="secondary">
            This zeroes the problem&apos;s partial credit, however the tests went.
          </Text>
          {brokenRules.map((rule, index) => (
            <Text key={index} type="supporting">
              {rule.checker_message || rule.label || "Rule violated"}
            </Text>
          ))}
        </VStack>
      )}

      {compileFailed ? (
        <VStack gap={2}>
          <Text type="supporting" weight="medium">
            Compiler output
          </Text>
          <pre style={codeBlock("var(--color-text-error)")}>{compilerText}</pre>
          {onJumpToCompilerError && (
            <Text
              type="supporting"
              onClick={onJumpToCompilerError}
              style={{ cursor: "pointer", textDecoration: "underline" }}
            >
              Go to the line
            </Text>
          )}
        </VStack>
      ) : (
        rows.length > 0 && (
          <>
            <HStack gap={2} wrap="wrap" role="tablist" aria-label="Cases">
              {rows.map((row, index) => (
                <CaseChip
                  key={index}
                  row={row}
                  index={index}
                  active={index === selected}
                  onSelect={() => setSelected(index)}
                />
              ))}
            </HStack>
            {current && <CaseDetail row={current} />}
          </>
        )
      )}
    </VStack>
  );
}

function codeBlock(color: string): React.CSSProperties {
  return {
    margin: 0,
    padding: "var(--spacing-3)",
    borderRadius: "var(--radius-element)",
    border: "var(--border-width) solid var(--color-border)",
    background: "var(--color-background-body)",
    color,
    fontFamily: "var(--font-family-mono)",
    fontSize: "var(--font-size-sm)",
    whiteSpace: "pre",
    overflowX: "auto",
    tabSize: 4,
  };
}

/**
 * One chip per check.
 *
 * Labelled by family rather than numbered straight through, because "Case 4"
 * meaning a source rule and "Case 5" meaning a GTest assertion is three
 * different things wearing one name. A candidate who broke a rule should see
 * the word Rule.
 */
function CaseChip({
  row,
  index,
  active,
  onSelect,
}: {
  row: TestRow;
  index: number;
  active: boolean;
  onSelect: () => void;
}) {
  const ok = passed(row);
  const family = familyOf(row);
  const name =
    family === "io" ? `Case ${index + 1}` : `${FAMILY[family].label} ${row.label || index + 1}`;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      title={FAMILY[family].hint}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--spacing-2)",
        padding: "var(--spacing-2) var(--spacing-3)",
        borderRadius: "var(--radius-element)",
        border: `var(--border-width) solid ${
          active ? "var(--color-border-strong)" : "transparent"
        }`,
        background: active ? "var(--color-background-raised)" : "transparent",
        color: "var(--color-text-primary)",
        font: "inherit",
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden
        style={{
          width: "0.5rem",
          height: "0.5rem",
          borderRadius: "50%",
          background: ok ? "var(--color-text-success)" : "var(--color-text-error)",
        }}
      />
      {name}
    </button>
  );
}

/** The selected check, shown the way that family actually fails. */
function CaseDetail({ row }: { row: TestRow }) {
  const family = familyOf(row);
  const ok = passed(row);

  if (family === GATE_KIND) {
    return (
      <VStack gap={3} style={{ minWidth: 0 }}>
        <Text type="supporting" color="secondary">
          {FAMILY[GATE_KIND].hint}
        </Text>
        <VStack gap={2}>
          <Text type="supporting" weight="medium">
            {ok ? "Satisfied" : "Broken"}
          </Text>
          <pre style={codeBlock("var(--color-text-primary)")}>
            {row.checker_message || row.label || "No detail from the judge"}
          </pre>
        </VStack>
      </VStack>
    );
  }

  if (family === "behavior") {
    return (
      <VStack gap={3} style={{ minWidth: 0 }}>
        <Text type="supporting" color="secondary">
          {FAMILY.behavior.hint}
        </Text>
        <VStack gap={2}>
          <Text type="supporting" weight="medium">
            {row.label || "Check"}
          </Text>
          <pre style={codeBlock("var(--color-text-primary)")}>
            {row.checker_message || (ok ? "Passed" : "Failed, with no detail from the judge")}
          </pre>
        </VStack>
        {row.stderr_text ? <Block label="Stderr" value={row.stderr_text} /> : null}
      </VStack>
    );
  }

  return (
    <VStack gap={3} style={{ minWidth: 0 }}>
      {row.input != null && <Block label="Input" value={row.input} />}
      {/* `stdout_text` is populated only for a case the candidate supplied.
          On an ordinary sample the judge never sends output back, so showing
          an empty "Output" box would read as "your program printed nothing"
          when it means "we do not tell you". */}
      {(row.stdout_text != null || row.output != null || row.actual != null) && (
        <Block label="Output" value={row.stdout_text ?? row.output ?? row.actual} />
      )}
      {row.expected != null && <Block label="Expected" value={row.expected} />}
      {row.checker_message ? (
        <VStack gap={2}>
          <Text type="supporting" weight="medium">
            Judge
          </Text>
          <Text type="supporting" color="secondary">
            {row.checker_message}
          </Text>
        </VStack>
      ) : null}
      {row.input == null && row.expected == null && !row.checker_message && (
        <Text type="supporting" color="secondary">
          This case is hidden. Only the verdict is shown.
        </Text>
      )}
    </VStack>
  );
}

function Block({ label, value }: { label: string; value: unknown }) {
  return (
    <VStack gap={2} style={{ minWidth: 0 }}>
      <Text type="supporting" weight="medium">
        {label}
      </Text>
      <pre style={codeBlock("var(--color-text-primary)")}>{outputText(value)}</pre>
    </VStack>
  );
}

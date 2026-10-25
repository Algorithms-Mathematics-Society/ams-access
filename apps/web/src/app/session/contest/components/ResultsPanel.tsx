import { useEffect, useMemo, useState } from "react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Button } from "@astryxdesign/core/Button";
import { resultSummary, candidateCheckFailed } from "../result-summary";
import { outputText } from "../execution-output";
import { GATE_KIND } from "../family-summary";
import { behaviourLanguage, ruleLanguage, shortChip } from "../rule-language";
import { exampleFor, sampleOrdinals, type WorkedExample } from "../sample-join";

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

/**
 * A case nobody asked a question about.
 *
 * A custom case run without expected output carries no verdict -- the judge
 * executed it and was never told what right would look like. There is no
 * third state in `passed`, so these rendered as failures: a red cross against
 * a case the candidate had not got wrong, and a tooltip saying "failed".
 */
function unjudged(row: TestRow): boolean {
  return !passed(row) && !candidateCheckFailed(row.verdict);
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
  SE: "Judging unavailable",
  IE: "Judging unavailable",
};

function verdictWord(code: string | null | undefined): string {
  if (!code) return "";
  return VERDICT_WORDS[String(code).toUpperCase()] ?? String(code);
}

/* Families, in the order the breakdown already uses. Named for candidates
   rather than for the judge: nobody outside this codebase calls a GTest case
   "behavior". */
// What each kind of check is, in the candidate's terms. Deliberately no
// weights, counts or scoring consequence: a candidate cannot see the
// behaviour tests, so telling them those count treble is noise they cannot
// act on. What they can act on is what the check looked at.
const FAMILY = {
  io: { label: "Sample", hint: "Your output against the expected output." },
  behavior: { label: "Behaviour", hint: "A check on what your code does." },
  [GATE_KIND]: {
    label: "Rule",
    hint: "A requirement about the code itself.",
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
  submitted = false,
  examples,
  emptyHint,
  onRunAsCustom,
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
  /** Re-run one sample through the custom-case path, which returns stdout. */
  onRunAsCustom?: (input: string, expected: string | null) => void;
  /** A submission rather than a sample run. Only a submission is worth
   *  celebrating — a passing Run means two sample cases agreed. */
  submitted?: boolean;
  /** The problem's worked examples, as printed in the statement. The judge
   *  sends no input or expected output for a sample, and does not need to:
   *  the candidate already has both. */
  examples?: WorkedExample[];
  emptyHint: string;
}) {
  const rows = useMemo(() => tests ?? [], [tests]);
  const ordinals = useMemo(() => sampleOrdinals(rows), [rows]);
  const [selected, setSelected] = useState(0);

  // Left/right along the strip, the way a tab list is expected to behave.
  const move = (delta: number) =>
    setSelected((current) => Math.min(Math.max(current + delta, 0), rows.length - 1));

  // Land on the first failure, which is the one being looked for. Re-run with
  // everything passing and it falls back to the first case rather than
  // keeping a stale index into a shorter list.
  //
  // An unjudged case is not a failure. Without that, a custom run with no
  // expected output opened on "Case 1" as though it were the problem.
  useEffect(() => {
    const firstFailure = rows.findIndex((row) => !passed(row) && !unjudged(row));
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
        <Text type="supporting" color="secondary">
          This message is not a final verdict on your code. Check the attempt’s recorded result
          before changing or resubmitting it.
        </Text>
      </VStack>
    );
  }

  const compileFailed = compilerIsError && compilerText;
  if (!rows.length && !compileFailed && !verdict) {
    return (
      <VStack gap={2} padding={4}>
        <Text type="supporting" color="secondary">
          {emptyHint}
        </Text>
      </VStack>
    );
  }

  const summary = resultSummary(verdict, Boolean(compileFailed));
  const headline = summary.title;
  const good = summary.tone === "success";

  // A broken rule is reported first and loudest, because partial credit is
  // already gone by the time a candidate reads anything else.
  const brokenRules = rows.filter(
    (row) => familyOf(row) === GATE_KIND && candidateCheckFailed(row.verdict)
  );

  const current = rows[Math.min(selected, Math.max(rows.length - 1, 0))];

  return (
    <VStack gap={4} padding={4} style={{ minWidth: 0 }}>
      {stale && (
        <Text type="supporting" style={{ color: "var(--color-text-warning)" }}>
          Code changed since this ran. These results belong to the earlier file.
        </Text>
      )}

      <HStack gap={3} align="center" wrap="wrap" style={{ position: "relative" }}>
        {good && submitted && <Celebration />}
        <Text
          size="xl"
          weight="semibold"
          style={{
            color: good
              ? "var(--color-text-success)"
              : summary.tone === "failure"
                ? "var(--color-text-error)"
                : "var(--color-text-secondary)",
          }}
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

      {summary.explanation && (
        <Text type="supporting" color="secondary">
          {summary.explanation}
        </Text>
      )}

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
            Fix this before you submit again. Passing the tests is not enough on its own.
          </Text>
          {brokenRules.map((rule, index) => (
            <Text key={index} type="supporting">
              {ruleLanguage(rule.label ?? "", rule.checker_message).sentence}
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
            {/* One row, scrolled rather than wrapped. Wrapping meant a
                problem with a dozen checks reflowed the strip into three
                lines and pushed the case detail off the bottom of the pane --
                the thing the strip exists to reveal. */}
            <div
              role="tablist"
              aria-label="Cases"
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  move(1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  move(-1);
                }
              }}
              style={{
                display: "flex",
                gap: "var(--spacing-2)",
                overflowX: "auto",
                overflowY: "hidden",
                paddingBottom: "var(--spacing-1)",
                scrollbarWidth: "thin",
              }}
            >
              {rows.map((row, index) => (
                <CaseChip
                  key={index}
                  row={row}
                  index={index}
                  ordinal={ordinals[index]}
                  active={index === selected}
                  onSelect={() => setSelected(index)}
                />
              ))}
            </div>
            {current && (
              <CaseDetail
                row={current}
                example={exampleFor(current, ordinals[selected] ?? -1, examples)}
                onRunAsCustom={onRunAsCustom}
              />
            )}
          </>
        )
      )}
    </VStack>
  );
}

/**
 * A small burst behind an accepted submission.
 *
 * Hand-rolled rather than pulled in: the contest screen has about 160 KB of
 * budget left and a confetti library spends a chunk of it to draw sixteen
 * squares. Sixteen is also the point — this is a contest, not a game, and a
 * candidate with four problems left should feel a flicker of good news and
 * then be able to read the verdict underneath it.
 *
 * Fires once per mount, which is once per accepted submission, and skips
 * entirely for anyone who has asked for reduced motion.
 */
function Celebration() {
  const [done, setDone] = useState(false);
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduced) return;
    const timer = setTimeout(() => setDone(true), 1400);
    return () => clearTimeout(timer);
  }, [reduced]);

  if (reduced || done) return null;

  const colors = [
    "var(--color-text-success)",
    "var(--color-text-accent)",
    "var(--color-text-primary)",
  ];

  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        left: "1.5rem",
        top: "50%",
        width: 0,
        height: 0,
        pointerEvents: "none",
      }}
    >
      {Array.from({ length: 16 }, (_, index) => {
        const angle = (index / 16) * Math.PI * 2;
        const distance = 34 + (index % 4) * 11;
        return (
          <span
            key={index}
            style={
              {
                position: "absolute",
                width: "0.3rem",
                height: "0.3rem",
                borderRadius: index % 3 === 0 ? "50%" : "1px",
                background: colors[index % colors.length],
                opacity: 0,
                animation: `ams-pop 1.1s cubic-bezier(0.16, 1, 0.3, 1) ${index * 12}ms forwards`,
                "--dx": `${Math.cos(angle) * distance}px`,
                "--dy": `${Math.sin(angle) * distance}px`,
              } as React.CSSProperties
            }
          />
        );
      })}
      <style>{`
        @keyframes ams-pop {
          0%   { opacity: 1; transform: translate(0, 0) scale(0.6); }
          70%  { opacity: 1; }
          100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1); }
        }
      `}</style>
    </span>
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
  ordinal,
  active,
  onSelect,
}: {
  row: TestRow;
  index: number;
  /** Position among the samples, or -1 for a rule or behaviour check. */
  ordinal: number;
  active: boolean;
  onSelect: () => void;
}) {
  const ok = passed(row);
  const notChecked = unjudged(row);
  const family = familyOf(row);
  // A behaviour check is numbered like an I/O case rather than wearing its
  // GTest name: `PokemonRAII.ConstructionAcquiresAndDestructionReleases` is
  // wider than the whole strip and truncates to `PokemonRAII.Constructi…`,
  // which cannot be told apart from the next one along. The readable name
  // goes in the tooltip and in the detail pane, where there is room for it.
  const full =
    family === GATE_KIND
      ? ruleLanguage(row.label ?? "", row.checker_message).chip
      : `Case ${(ordinal >= 0 ? ordinal : index) + 1}`;
  const described =
    family === "behavior" ? behaviourLanguage(row.label ?? "", row.checker_message).chip : "";

  // Colour carries the outcome, so a candidate can read the strip at a
  // glance without opening anything. The previous version put a 0.5rem dot
  // beside grey text, which at a glance is just grey text.
  const tint = notChecked ? "secondary" : ok ? "success" : "error";

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      // Only the selected tab is in the tab order; the arrow keys move
      // between them. Fourteen stops for fourteen cases is not navigation.
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      title={`${described || full} — ${
        notChecked ? "ran, not checked" : ok ? "passed" : "failed"
      }. ${FAMILY[family].hint}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--spacing-2)",
        maxWidth: "100%",
        padding: "var(--spacing-2) var(--spacing-3)",
        borderRadius: "var(--radius-element)",
        // Selection is carried by the grey fill, not by a coloured border:
        // tinting the border too meant a failed-and-selected chip and a
        // failed-and-not chip differed only in how saturated their outline
        // was, which is not a difference you can see at a glance.
        border: "var(--border-width) solid transparent",
        background: active ? "var(--color-background-gray)" : "transparent",
        color: `var(--color-text-${tint})`,
        fontWeight: active ? 600 : 400,
        fontFamily: "inherit",
        fontSize: "inherit",
        fontStyle: "inherit",
        fontVariant: "inherit",
        fontStretch: "inherit",
        lineHeight: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
        transition: "background 120ms ease",
      }}
    >
      <span aria-hidden style={{ fontSize: "0.85em" }}>
        {notChecked ? "·" : ok ? "✓" : "✕"}
      </span>
      {shortChip(full)}
    </button>
  );
}

/** The selected check, shown the way that family actually fails. */
function CaseDetail({
  row,
  example,
  onRunAsCustom,
}: {
  row: TestRow;
  example?: WorkedExample | null;
  /** Hand this sample to the custom-case path, which does return stdout. */
  onRunAsCustom?: (input: string, expected: string | null) => void;
}) {
  const family = familyOf(row);
  const ok = passed(row);

  if (!ok && unjudged(row) && (family !== "io" || String(row.verdict ?? "").trim())) {
    return (
      <VStack gap={3}>
        <Text>No candidate verdict is available for this check.</Text>
        <Text type="supporting" color="secondary">
          {resultSummary(row.verdict).explanation}
        </Text>
        {(row.checker_message || row.stderr_text) && (
          <Text>{row.checker_message || row.stderr_text}</Text>
        )}
      </VStack>
    );
  }

  if (family === GATE_KIND) {
    const rule = ruleLanguage(row.label ?? "", row.checker_message);
    return (
      <VStack gap={3} style={{ minWidth: 0 }}>
        <Text type="supporting" color="secondary">
          {FAMILY[GATE_KIND].hint}
        </Text>
        <VStack gap={2}>
          <Text
            weight="semibold"
            style={{ color: ok ? "var(--color-text-success)" : "var(--color-text-error)" }}
          >
            {ok ? "Satisfied" : "Broken"}
          </Text>
          <Text>{rule.sentence}</Text>
        </VStack>
      </VStack>
    );
  }

  if (family === "behavior") {
    const behaviour = behaviourLanguage(row.label ?? "", row.checker_message);
    // The judge's own identifier is kept, quietly, below the English: it is
    // what a candidate quotes when they ask an invigilator about a check,
    // and what the setter greps for. It is just no longer the headline.
    const identifier = (row.label ?? "").trim();
    return (
      <VStack gap={3} style={{ minWidth: 0 }}>
        <Text type="supporting" color="secondary">
          {FAMILY.behavior.hint}
        </Text>
        <VStack gap={2}>
          <Text
            weight="semibold"
            style={{ color: ok ? "var(--color-text-success)" : "var(--color-text-error)" }}
          >
            {ok ? "Passed" : "Failed"}
          </Text>
          <Text>{behaviour.sentence}</Text>
          {identifier && identifier !== behaviour.sentence ? (
            <Text type="supporting" color="secondary" style={{ fontFamily: "var(--font-mono)" }}>
              {identifier}
            </Text>
          ) : null}
          {!ok && row.checker_message ? (
            <pre style={codeBlock("var(--color-text-primary)")}>{row.checker_message}</pre>
          ) : null}
        </VStack>
        {row.stderr_text ? <Block label="Stderr" value={row.stderr_text} /> : null}
      </VStack>
    );
  }

  // Input and expected come from the statement's own worked example when the
  // judge did not send them, which for a sample is always. Nothing is
  // revealed: the candidate is reading these two values a few inches up.
  const input = row.input ?? example?.input ?? null;
  const expected = row.expected ?? example?.output ?? null;
  // What the program actually printed. Present for a case the candidate
  // supplied; withheld on the problem's own tests, because a hidden test
  // whose output came back would be an answer key.
  const got = row.stdout_text ?? row.output ?? row.actual ?? null;
  const hidden = input == null && expected == null && got == null;

  return (
    <VStack gap={3} style={{ minWidth: 0 }}>
      {hidden ? (
        <Text type="supporting" color="secondary">
          This case is hidden. Only the verdict is shown.
        </Text>
      ) : (
        <>
          {input != null && <Block label="Input" value={input} />}
          {got != null ? (
            // No tone when nothing was checked: colouring this green or red
            // asserts a correctness the judge was never asked to decide.
            <Block
              label="Your output"
              value={got}
              tone={unjudged(row) ? undefined : ok ? "success" : "error"}
            />
          ) : (
            <VStack gap={2}>
              <Text type="supporting" weight="medium">
                Your output
              </Text>
              <Text type="supporting" color="secondary">
                Not returned for the problem&apos;s own tests. Run this case as your own to see what
                your code prints.
              </Text>
              {/* The instruction used to end at "put this input under
                  Testcase and run it", which is three manual steps — copy
                  the input, switch tab, paste, run — at the moment a
                  candidate is already stuck. The sample's input and expected
                  output are both on screen, so handing them to the custom
                  path reveals nothing and returns stdout, which the
                  problem's own tests structurally cannot. */}
              {onRunAsCustom && input != null ? (
                <Button
                  variant="secondary"
                  size="sm"
                  label="Run this case as my own"
                  onClick={() =>
                    onRunAsCustom(String(input), expected == null ? null : String(expected))
                  }
                  style={{ alignSelf: "flex-start" }}
                />
              ) : null}
            </VStack>
          )}
          {expected != null && <Block label="Expected" value={expected} />}
        </>
      )}
      {row.stderr_text ? <Block label="Stderr" value={row.stderr_text} /> : null}
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
    </VStack>
  );
}

function Block({
  label,
  value,
  tone,
}: {
  label: string;
  value: unknown;
  tone?: "success" | "error";
}) {
  return (
    <VStack gap={2} style={{ minWidth: 0 }}>
      <Text type="supporting" weight="medium">
        {label}
      </Text>
      <pre style={codeBlock(tone ? `var(--color-text-${tone})` : "var(--color-text-primary)")}>
        {outputText(value)}
      </pre>
    </VStack>
  );
}

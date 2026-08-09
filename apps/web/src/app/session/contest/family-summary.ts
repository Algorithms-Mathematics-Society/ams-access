/**
 * How a submission was actually marked.
 *
 * The judge runs three independent families and the scoreboard treats them
 * very differently — behaviour is weighted 3x, I/O 2x, and **symbolic is a
 * gate**: a single violation zeroes that problem's entire partial credit,
 * however well the code runs. None of this reached the candidate. The
 * projection has carried `families` (weights, counts, and the symbolic rule
 * text) since contract v2 and no component read it, so someone could lose a
 * problem outright to a rule they were never shown.
 *
 * Pure, and shared by the contest room and the results page, so a verdict
 * reads identically wherever it appears.
 */

import type { SymbolicRule, TestcaseResult } from "@/lib/proctor-api";

/** Mirrors `GATE_KIND` in ams-api's `services/scoreboard.py`. */
export const GATE_KIND = "symbolic";

/** Mirrors `TESTCASE_WEIGHTS` there. Only a fallback — a problem's own
 * projection carries its weights, and those win. Showing a candidate a weight
 * the board does not use is worse than showing none. */
export const FALLBACK_WEIGHTS: Record<string, number> = { behavior: 3, io: 2 };

export type FamilyResult = {
  kind: string;
  passed: number;
  total: number;
  /** Whether this family contributes to partial credit at all. */
  graded: boolean;
};

const PASSING = new Set(["AC", "OK", "PASS"]);

function isPass(verdict: string): boolean {
  return PASSING.has(verdict.toUpperCase());
}

/**
 * Per-family pass counts, in a stable order.
 *
 * Ordered io → behavior → symbolic rather than by whatever the judge emitted:
 * a breakdown that reshuffles between attempts is hard to read at a glance,
 * and glancing is all a candidate has time for.
 */
export function familyBreakdown(testcases: TestcaseResult[]): FamilyResult[] {
  const buckets = new Map<string, { passed: number; total: number }>();
  for (const testcase of testcases) {
    const kind = testcase.kind || "io";
    const bucket = buckets.get(kind) ?? { passed: 0, total: 0 };
    bucket.total += 1;
    if (isPass(testcase.verdict)) bucket.passed += 1;
    buckets.set(kind, bucket);
  }

  const order = ["io", "behavior", GATE_KIND];
  const kinds = [...buckets.keys()].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
  });

  return kinds.map((kind) => ({
    kind,
    passed: buckets.get(kind)!.passed,
    total: buckets.get(kind)!.total,
    graded: kind !== GATE_KIND,
  }));
}

/** The symbolic cases that failed — the rules this submission broke. */
export function symbolicViolations(testcases: TestcaseResult[]): TestcaseResult[] {
  return testcases.filter(
    (testcase) => (testcase.kind || "io") === GATE_KIND && !isPass(testcase.verdict)
  );
}

/**
 * Whether the gate zeroed this problem.
 *
 * The single most important thing to tell a candidate looking at a
 * disappointing score, and the one thing the verdict panel could not say.
 */
export function partialCreditZeroed(testcases: TestcaseResult[]): boolean {
  return symbolicViolations(testcases).length > 0;
}

/** A rule's explanation, falling back to the pattern when the setter wrote
 * none — "you may not use `std::vector`" is still better than silence. */
export function ruleText(rule: SymbolicRule): string {
  if (rule.message.trim()) return rule.message;
  return rule.kind === "must_not_include"
    ? `Your solution must not use ${rule.pattern}.`
    : `Your solution must use ${rule.pattern}.`;
}

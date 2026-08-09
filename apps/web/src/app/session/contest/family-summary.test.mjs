// How a submission was marked.
//
// The judge runs three families and weights them differently, and symbolic is
// a *gate*: one violation zeroes the problem's whole partial credit however
// well the code runs. The projection has carried all of this since contract
// v2 and nothing rendered it, so a candidate could lose a problem outright to
// a rule they were never shown.

import test from "node:test";
import assert from "node:assert/strict";

import {
  GATE_KIND,
  familyBreakdown,
  partialCreditZeroed,
  ruleText,
  symbolicViolations,
} from "./family-summary.ts";

const tc = (kind, verdict, n = 1) => ({
  kind,
  verdict,
  testcase_no: n,
  label: String(n),
  runtime_ms: 1,
  memory_kb: 1,
  checker_message: "",
});

test("cases are grouped by family with pass counts", () => {
  const breakdown = familyBreakdown([
    tc("io", "AC", 1),
    tc("io", "WA", 2),
    tc("behavior", "AC", 3),
    tc("behavior", "AC", 4),
  ]);
  assert.deepEqual(breakdown, [
    { kind: "io", passed: 1, total: 2, graded: true },
    { kind: "behavior", passed: 2, total: 2, graded: true },
  ]);
});

test("the order is stable, not whatever the judge emitted", () => {
  // A breakdown that reshuffles between attempts is hard to read at a glance,
  // and glancing is all a candidate has time for.
  const breakdown = familyBreakdown([
    tc(GATE_KIND, "AC", 1),
    tc("behavior", "AC", 2),
    tc("io", "AC", 3),
  ]);
  assert.deepEqual(
    breakdown.map((f) => f.kind),
    ["io", "behavior", GATE_KIND]
  );
});

test("symbolic is reported as ungraded", () => {
  // It contributes no credit of its own. A candidate who thinks it is worth
  // points will trade it off against the families that are.
  const [family] = familyBreakdown([tc(GATE_KIND, "AC")]);
  assert.equal(family.graded, false);
});

test("a violated rule is found", () => {
  const cases = [tc("io", "AC", 1), tc(GATE_KIND, "WA", 2), tc(GATE_KIND, "AC", 3)];
  const violations = symbolicViolations(cases);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].testcase_no, 2);
});

test("a violation means the problem was zeroed", () => {
  // The single most important thing to tell someone looking at a
  // disappointing score, and exactly what the verdict panel could not say.
  assert.equal(partialCreditZeroed([tc("io", "AC"), tc(GATE_KIND, "WA", 2)]), true);
});

test("all symbolic cases passing does not zero anything", () => {
  assert.equal(partialCreditZeroed([tc("io", "WA"), tc(GATE_KIND, "AC", 2)]), false);
});

test("a problem with no symbolic rules is never gated", () => {
  assert.equal(partialCreditZeroed([tc("io", "WA"), tc("behavior", "RE", 2)]), false);
});

test("cases with no kind count as io rather than vanishing", () => {
  const [family] = familyBreakdown([{ ...tc("", "AC"), kind: "" }]);
  assert.equal(family.kind, "io");
  assert.equal(family.total, 1);
});

test("pass detection is case-insensitive and accepts the judge's synonyms", () => {
  assert.equal(partialCreditZeroed([tc(GATE_KIND, "ac")]), false);
  assert.equal(partialCreditZeroed([tc(GATE_KIND, "OK")]), false);
  assert.equal(partialCreditZeroed([tc(GATE_KIND, "tle")]), true);
});

test("no testcases yields no breakdown and no gate", () => {
  assert.deepEqual(familyBreakdown([]), []);
  assert.equal(partialCreditZeroed([]), false);
});

test("a rule with no author message still reads as an instruction", () => {
  assert.equal(
    ruleText({ kind: "must_not_include", pattern: "std::vector", message: "" }),
    "Your solution must not use std::vector."
  );
  assert.equal(
    ruleText({ kind: "must_include", pattern: "constexpr", message: "" }),
    "Your solution must use constexpr."
  );
});

test("the author's own wording wins when there is one", () => {
  assert.equal(
    ruleText({ kind: "must_not_include", pattern: "memcpy", message: "Write the copy yourself." }),
    "Write the copy yourself."
  );
});

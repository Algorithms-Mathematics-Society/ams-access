/**
 * Run the statement's worked examples through the custom-case path.
 *
 * The problem this solves is that an ordinary Run told a candidate their code
 * was wrong without telling them what it printed. The verdict came back, the
 * expected output sat in the statement, and the one thing missing was the one
 * thing they needed.
 *
 * The obvious fix — have the judge return stdout for the problem's own tests —
 * is the wrong one, and the judge says so in a comment worth quoting:
 *
 *   > Deliberately a separate type from CaseDetail rather than a flag on it:
 *   > these results carry the program's stdout and stderr, and the problem's
 *   > own tests must never be able to reach a shape that can hold them.
 *
 * That is a type-level guarantee that a hidden test's output cannot exist, in
 * memory or on the wire, anywhere in the system. Replacing it with a runtime
 * filter — "return stdout, but only for cases the API believes are samples" —
 * trades a structural invariant for a conditional, on the one code path where
 * a mistake hands out the answer key.
 *
 * So nothing in the judge changes. The samples are already public: their input
 * and their expected output are printed in the statement the candidate is
 * reading. Sending them back as *custom* cases is therefore not a disclosure,
 * and the custom path already returns stdout, already judges through the
 * problem's real checker, and already renders as Input / Your output /
 * Expected. The candidate gets what they needed and no hidden case ever enters
 * a structure that could have carried it.
 */

import { MAX_CUSTOM_CASES, type CustomCase } from "./custom-cases.ts";

export type WorkedExample = {
  label?: string;
  input: string;
  output: string;
};

/**
 * The examples as runnable cases, or null when there is nothing to run.
 *
 * Null rather than an empty array on purpose: the API reads a present
 * `custom_cases` key as "run only these", so an empty one would be refused,
 * and a problem with no worked examples — a behaviour-checked problem ships
 * none at all — must fall through to an ordinary run against its own tests.
 */
export function samplesAsCustomCases(
  examples: WorkedExample[] | undefined | null
): CustomCase[] | null {
  if (!examples || examples.length === 0) return null;

  const cases: CustomCase[] = [];
  for (const [index, example] of examples.entries()) {
    // The cap the API enforces. Worked examples are capped at five by the
    // judge's own preview, so this is defensive rather than expected.
    if (cases.length >= MAX_CUSTOM_CASES) break;
    if (typeof example?.input !== "string") continue;
    cases.push({
      id: `sample-${example.label ?? index + 1}`,
      input: example.input,
      // An example without an expected output is still worth running — it
      // shows what the code prints — but it is unjudged, which is what null
      // means here. "" is a legitimate expectation and must survive.
      expected: typeof example.output === "string" ? example.output : null,
    });
  }
  return cases.length > 0 ? cases : null;
}

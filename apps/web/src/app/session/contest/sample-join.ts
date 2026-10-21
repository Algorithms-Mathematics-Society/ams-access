/**
 * Pair a judged sample case with the worked example it came from.
 *
 * The judge sends a verdict per testcase and nothing else: `TestcaseOut`
 * carries no input and no expected output, and `stdout_text` is null on
 * every ordinary case because a hidden test whose output was stored would be
 * an answer key one API response away.
 *
 * None of that applies to a *sample*. The candidate already has its input and
 * its expected output — they are printed in the statement. So the result pane
 * does not need the judge to send them; it needs to find the example it
 * already has and put it next to the verdict.
 *
 * Matching is by label first and position second. Labels are what a setter
 * writes and what the judge echoes back, so they agree when they exist; when
 * they do not, the judge emits samples in projection order and the index is
 * the only thing left. Returning null rather than guessing wrong matters: an
 * expected output from the wrong case is worse than no expected output,
 * because a candidate will believe it.
 */

export type WorkedExample = {
  label?: string;
  input: string;
  /** Absent when there is nothing to compare against -- a custom case the
   * candidate ran without supplying expected output. A statement's own
   * worked example always has one. */
  output?: string;
};

export type JudgedCase = {
  label?: string;
  testcase_no?: number;
  kind?: string;
};

function normalise(label: string | undefined): string {
  return (label ?? "").trim().toLowerCase();
}

/**
 * The example behind one judged case, or null when nothing matches it.
 *
 * `sampleIndex` is the case's position among the *sample* cases, not among
 * all of them — a problem whose first two cases are symbolic rules still has
 * its first sample as example one.
 */
export function exampleFor(
  judged: JudgedCase,
  sampleIndex: number,
  examples: WorkedExample[] | undefined
): WorkedExample | null {
  if (!examples || examples.length === 0) return null;

  const wanted = normalise(judged.label);
  if (wanted) {
    const byLabel = examples.find((example) => normalise(example.label) === wanted);
    if (byLabel) return byLabel;

    // Setters label samples "1", "2" about as often as they name them, and
    // the judge echoes whichever it was given.
    const asNumber = Number(wanted);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= examples.length) {
      return examples[asNumber - 1];
    }
  }

  // Position, and only within range. Running off the end means the judge ran
  // more samples than the statement shows, which is a projection that has
  // drifted -- better to show nothing than to pair case 4 with example 1.
  if (sampleIndex >= 0 && sampleIndex < examples.length) return examples[sampleIndex];
  return null;
}

/**
 * Which sample each judged case is, counting only the io family.
 *
 * Returned as a parallel array so the caller keeps its own ordering and does
 * not have to filter and re-index at the point of use.
 */
export function sampleOrdinals(cases: JudgedCase[]): number[] {
  let seen = 0;
  return cases.map((judged) => ((judged.kind || "io") === "io" ? seen++ : -1));
}

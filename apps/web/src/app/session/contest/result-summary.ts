/** A testcase subset is evidence, not an authoritative overall verdict. */
const WORDS: Record<string, string> = {
  AC: "Accepted",
  WA: "Wrong answer",
  CE: "Compile error",
  RE: "Runtime error",
  TLE: "Time limit exceeded",
  MLE: "Memory limit exceeded",
  OLE: "Output limit exceeded",
  PE: "Presentation error",
};
export function resultSummary(verdict: string | null | undefined, compileFailed = false) {
  const code = String(verdict ?? "")
    .trim()
    .toUpperCase();
  if (["SE", "IE", "FAILED"].includes(code))
    return {
      title: "Judging could not be completed",
      tone: "unknown" as const,
      explanation:
        "This is not a verdict that your code is wrong. Keep your work and check the result again. Ask an invigilator before resubmitting; another submission may count as another attempt.",
    };
  if (["QUEUED", "PENDING", "RUNNING"].includes(code))
    return {
      title: "Judging in progress",
      tone: "unknown" as const,
      explanation:
        "No final verdict is available yet. Passing individual checks does not confirm the overall result.",
    };
  const known = WORDS[code];
  if (known)
    return {
      title: known,
      tone: code === "AC" ? ("success" as const) : ("failure" as const),
      explanation:
        code === "RE"
          ? "The judge reported a runtime error for this attempt. Passed checks do not override the overall verdict; review the available diagnostics."
          : "",
    };
  if (compileFailed)
    return {
      title: "Compile error",
      tone: "failure" as const,
      explanation: "Review the compiler diagnostics for this attempt.",
    };
  return {
    title: "Overall verdict unavailable",
    tone: "unknown" as const,
    explanation:
      "The available checks do not establish the overall result. Check again or ask an invigilator; do not assume the code passed or failed.",
  };
}

export function candidateCheckFailed(verdict: string | null | undefined): boolean {
  return ["WA", "RE", "CE", "TLE", "MLE", "OLE", "PE", "FAIL"].includes(
    String(verdict ?? "")
      .trim()
      .toUpperCase()
  );
}

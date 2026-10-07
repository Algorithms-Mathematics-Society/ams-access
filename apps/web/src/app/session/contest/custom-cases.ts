/**
 * The candidate's own test cases, for one problem.
 *
 * Pure, so it can be tested without a DOM. The rules here exist because the
 * judge refuses some shapes and a candidate should learn that at the desk
 * rather than after a round trip:
 *
 * * An empty list cannot be sent. The API reads a present `custom_cases` key
 *   as "run only these", and an empty one as a client bug, so Run Custom
 *   stays disabled rather than producing a 422.
 * * A case with no input at all is dropped. It is almost always a half-typed
 *   row, and sending it costs a sandbox start to print nothing.
 * * Expected output is optional, and the distinction is load-bearing: absent
 *   means "just show me the output", present (even empty) means "judge it".
 */

export type CustomCase = {
  id: string;
  input: string;
  /** null means unjudged. "" is a legitimate expected output. */
  expected: string | null;
};

/** The cap the API enforces. Mirrored here so the UI can stop before the 422. */
export const MAX_CUSTOM_CASES = 20;

export function newCase(): CustomCase {
  return {
    id: `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    input: "",
    expected: null,
  };
}

/** Cases worth sending: anything with actual input. */
export function sendable(cases: CustomCase[]): CustomCase[] {
  return cases.filter((c) => c.input.length > 0);
}

export function canRun(cases: CustomCase[]): boolean {
  return sendable(cases).length > 0;
}

/** The wire shape. Labels are positional so a result can be matched back. */
export function toWire(cases: CustomCase[]): { label: string; input: string; expected?: string }[] {
  return sendable(cases).map((c, index) => ({
    label: `Case ${index + 1}`,
    input: c.input,
    // Only send `expected` when the candidate asked for a verdict. Sending
    // "" instead would silently judge every case against empty output.
    ...(c.expected === null ? {} : { expected: c.expected }),
  }));
}

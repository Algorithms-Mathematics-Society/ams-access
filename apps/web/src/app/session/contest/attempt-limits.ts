/**
 * The judge's limits on a run or a submission, checked before sending.
 *
 * Mirrors ams-api's `SessionSubmit` and `CustomCaseIn`. Past these the server
 * answers 422, which used to reach the candidate as "Could not reach the
 * judge" or "Request failed (422)"; a sentence at the desk is better.
 */

import { MAX_CUSTOM_CASES } from "./custom-cases.ts";

export const MAX_SOURCE_CHARS = 256_000;
export const MAX_CASE_CHARS = 64_000;

/** Why this attempt would be refused, or null if it is within the limits. */
export function attemptLimitError(
  source: string,
  cases: { input: string; expected?: string | null }[] | null = null
): string | null {
  if (source.trim() === "") return "Your code is empty. Write a solution first.";
  if (source.length > MAX_SOURCE_CHARS) {
    return `Your code is too large (limit ${MAX_SOURCE_CHARS.toLocaleString("en-US")} characters).`;
  }
  if (!cases) return null;
  if (cases.length > MAX_CUSTOM_CASES) {
    return `Custom runs are limited to ${MAX_CUSTOM_CASES} cases.`;
  }
  if (
    cases.some((c) => c.input.length > MAX_CASE_CHARS || (c.expected ?? "").length > MAX_CASE_CHARS)
  ) {
    return `Custom input and expected output are limited to ${MAX_CASE_CHARS.toLocaleString("en-US")} characters per case.`;
  }
  return null;
}

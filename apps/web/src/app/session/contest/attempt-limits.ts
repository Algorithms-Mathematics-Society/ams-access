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

/** ams-api's run rate limits: one run per problem every 10 s (COOLDOWN), and
 * 30 runs per 5 minutes across the contest (RUN_LIMIT). */
export const RUN_BURST_LIMIT = 30;
export const RUN_BURST_WINDOW_MINUTES = 5;

/** The Run cooldown line, for `secondsLeft` of the server's `retry_after`. */
export function runCooldownMessage(code: string, secondsLeft: number): string {
  const s = Math.max(0, Math.ceil(secondsLeft));
  const time = s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
  // RUN_LIMIT's retry_after is the whole window, so this is an upper bound.
  if (code === "RUN_LIMIT") {
    return `Run limit reached (${RUN_BURST_LIMIT} runs per ${RUN_BURST_WINDOW_MINUTES} minutes). You can run again within ${time}.`;
  }
  return `Please wait ${time} before running again.`;
}

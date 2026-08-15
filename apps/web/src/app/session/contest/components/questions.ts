import { looksLikeCpp } from "./language";
import type { CXXProbeQuestionProjection } from "../candidate-question-projection";

export type Question = {
  id: string;
  title: string;
  description: string | null;
  starter_code: string | null;
  order_index: number;
  question_type: string;
  starter_filename?: string | null;
  points?: number;
  judge_engine?: "legacy" | "cxxprobe";
  time_limit_ms?: number | null;
  memory_limit_mb?: number | null;
  cxxprobe?: CXXProbeQuestionProjection | null;

  // Contract v2. Worked examples, and the marking scheme — including the
  // symbolic rules, which are a gate that zeroes the problem's partial credit.
  // Both have been on the wire since v2 and rendered nowhere.
  samples?: { label?: string; input: string; output: string }[];
  families?: import("@/lib/proctor-api").ProblemFamilies;
  /** The projection was reconstructed from the pre-v2 columns, so the
   * marking scheme is unknown rather than empty. */
  backfilled?: boolean;
};

export type ClientFollowUpPart = {
  id?: string;
  statement: string;
  points: number;
};

export type FollowUpPartState = {
  inputText: string;
  loading: boolean;
  submitted: boolean;
  correct: boolean;
};

export function parseFollowUpParts(desc: string): ClientFollowUpPart[] {
  try {
    const parsed = JSON.parse(desc);
    if (Array.isArray(parsed)) return parsed as ClientFollowUpPart[];
  } catch {
    /* empty */
  }
  return [];
}

export type ContestMeta = {
  id: string;
  title: string;
  start_at?: string;
  /** Null for a practice contest, which has no end. */
  end_at: string | null;
  status: string;
  allowed_languages?: string[];
};

export type QuestionPayload = Partial<Question> & {
  problem_id?: string;
  name?: string;
  statement?: string | null;
  prompt?: string | null;
  body?: string | null;
  code?: string | null;
  cpp?: string | null;
  starter_code?: string | null;
  cpp_starter?: string | null;
  html?: string | null;
  css?: string | null;
  js?: string | null;
  html_starter?: string | null;
  css_starter?: string | null;
  js_starter?: string | null;
  starter_html?: string | null;
  starter_css?: string | null;
  starter_js?: string | null;
  starter?: {
    code?: string | null;
    cpp?: string | null;
    html?: string | null;
    css?: string | null;
    js?: string | null;
  } | null;
  order?: number;
  position?: number;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") return value;
  }
  return null;
}

export function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function unwrapQuestionList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];

  const candidates = [
    payload.questions,
    payload.problems,
    payload.items,
    payload.data,
    payload.results,
    isRecord(payload.contest) ? payload.contest.questions : null,
    isRecord(payload.contest) ? payload.contest.problems : null,
    isRecord(payload.bundle) ? payload.bundle.questions : null,
    isRecord(payload.bundle) ? payload.bundle.problems : null,
  ];

  for (const candidate of candidates) {
    const nested = unwrapQuestionList(candidate);
    if (nested.length > 0) return nested;
  }

  return [];
}

export function normalizeQuestion(value: unknown, index: number): Question | null {
  if (!isRecord(value)) return null;
  const payload = value as QuestionPayload;
  const starter = isRecord(payload.starter) ? payload.starter : null;
  const id = pickString(payload.id, payload.problem_id);
  const title = pickString(payload.title, payload.name);
  const orderIndex = pickNumber(payload.order_index, payload.order, payload.position) ?? index;

  return {
    id: id ?? `question-${orderIndex + 1}`,
    title: title ?? `Question ${orderIndex + 1}`,
    description: pickString(payload.description, payload.statement, payload.prompt, payload.body),
    starter_code:
      pickString(
        payload.starter_code,
        payload.cpp_starter,
        payload.code,
        payload.cpp,
        starter?.code,
        starter?.cpp
      ) ??
      (looksLikeCpp(payload.html_starter) ? payload.html_starter : null) ??
      (looksLikeCpp(payload.starter_html) ? payload.starter_html : null) ??
      (looksLikeCpp(starter?.html) ? starter.html : null) ??
      (looksLikeCpp(payload.html) ? payload.html : null),
    order_index: orderIndex,
    question_type:
      typeof (payload as any).question_type === "string" ? (payload as any).question_type : "code",
  };
}

export function normalizeQuestions(payload: unknown): Question[] {
  return unwrapQuestionList(payload)
    .map((item, index) => normalizeQuestion(item, index))
    .filter((item): item is Question => item !== null)
    .sort((a, b) => a.order_index - b.order_index);
}

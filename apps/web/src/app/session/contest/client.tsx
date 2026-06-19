"use client";

import {
  memo,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { invoke } from "@ams/api-client";
import MarkovEditor, { type MarkovChain, normalizeChain } from "@/components/MarkovEditor";
import dynamic from "next/dynamic";
import { marked } from "marked";
import katex from "katex";
import DOMPurify from "dompurify";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveApiBase } from "@/lib/api-base";
import { fetchJson, postJsonKeepalive, SessionBindingError } from "@/lib/api-client";
import { authHeaders } from "@/lib/candidate-auth";
import {
  loadPresenceDetector,
  samplePresence,
  type PresenceDetector,
} from "@/lib/presence-monitor";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import {
  CONTEST_EDITOR_THEMES,
  registerAllowedClipboard,
  type ContestEditorThemeId,
} from "./editor-pane";
import {
  isPendingSubmissionStatus,
  normalizeAttemptForRunResult,
  normalizeSubmissionVerdict,
  shouldAutoExpandAttempt,
  type RunAttempt,
  type RunVerdict,
  type SubmissionAttemptRecord,
} from "./submission-state";
import { countdownPhase, type CountdownPhase } from "./countdown";
import { VerdictBadge } from "@/lib/VerdictBadge";
import type { VerdictCode } from "@/lib/verdict";
import {
  Play,
  Loader2,
  Send,
  LifeBuoy,
  LogOut,
  Video,
  VideoOff,
  Mic,
  MicOff,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  AlertCircle,
  Check,
  Info,
  Plus,
  X,
  Settings2,
  Lock,
  ShieldCheck,
  Shield,
  Wifi,
  WifiOff,
  Save,
} from "lucide-react";

const API_URL = resolveApiBase();
const ACTIVE_SESSION_KEY = STORAGE_KEYS.ACTIVE_SESSION;
const EDITOR_THEME_KEY = "ams_contest_editor_theme";
const PROBLEM_SPLIT_WIDTH_KEY = "ams_contest_problem_split_width";
const DEFAULT_EDITOR_THEME: ContestEditorThemeId = "ams-terminal";
// Local answer buffer: last unsaved editor content per session+problem. This is
// the safety net so a failed network save is never data loss (see handleSave /
// writeLocalAnswerBuffer). Cleared on a confirmed successful save.
const LOCAL_ANSWER_BUFFER_PREFIX = "ams_contest_answer_buffer";
const localAnswerBufferKey = (sessionId: string, questionId: string) =>
  `${LOCAL_ANSWER_BUFFER_PREFIX}:${sessionId}:${questionId}`;

// A "Run on Judge" attempt (sample-only, never scored) is tagged by the backend
// with submission_kind === "RUN". These must never appear in the Attempts
// history — they surface only in the Output panel. Missing/legacy rows have no
// kind and are treated as real submissions (SUBMIT) for back-compat. The field
// isn't on SubmissionAttemptRecord (server-side addition), so we read it loosely.
function isRunSubmission(sub: object | null | undefined): boolean {
  const kind = (sub as { submission_kind?: string | null } | null | undefined)?.submission_kind;
  return String(kind ?? "SUBMIT").toUpperCase() === "RUN";
}

// A test row is a "sample" test (expected/got may be shown) only when it is not
// flagged hidden by any of the indicators the Attempts UI already recognizes.
// Hidden/fallback tests show verdict only — never expected/got.
function isSampleTestRow(tr: {
  is_sample?: boolean | null;
  sample?: boolean | null;
  hidden?: boolean | null;
  is_hidden?: boolean | null;
}): boolean {
  if (tr.hidden || tr.is_hidden) return false;
  // The API returns an explicit is_sample boolean; a false means hidden/fallback.
  if (tr.is_sample === false || tr.sample === false) return false;
  if (tr.is_sample === true || tr.sample === true) return true;
  // No flag at all (legacy rows) → treat as visible, mirroring the Attempts expansion.
  return true;
}
// Autosave backoff: after MAX_SAVE_RETRIES tight retries we stop the ~1.5s loop
// and fall back to an occasional retry, surfacing a "saved locally" state. Delay
// grows exponentially with jitter, capped at SAVE_RETRY_MAX_DELAY_MS.
const SAVE_RETRY_BASE_DELAY_MS = 1500;
const SAVE_RETRY_MAX_DELAY_MS = 30_000;
const MAX_SAVE_RETRIES = 5;
type ProblemSectionKey = "statement" | "examples" | "constraints";

/**
 * Maps the display label used in the UI and stored in `allowed_languages`
 * to the wire identifier expected by the judge worker.
 * The worker matches by substring so "cpp17" satisfies both the `c++` and `cpp` checks.
 */
const LANGUAGE_ID_MAP: Record<string, string> = {
  C: "c",
  "C++17": "cpp17",
  "C++20": "cpp20",
  cpp: "cpp17",
  cpp17: "cpp17",
  cpp20: "cpp20",
  "c++": "cpp17",
  "c++17": "cpp17",
  "c++20": "cpp20",
  Python3: "python3",
  python: "python3",
  py: "python3",
  python3: "python3",
  PyPy3: "pypy3",
  pypy: "pypy3",
  pypy3: "pypy3",
  Java17: "java17",
  java: "java17",
  java17: "java17",
  Go: "go",
  go: "go",
  Rust: "rust",
  rust: "rust",
};

// Languages the judge worker actually handles. Go and Rust are not yet
// implemented in runner.go — filter them from the UI until they are.
const WORKER_SUPPORTED_LANGUAGES = new Set(["C", "C++17", "C++20", "Python3", "PyPy3", "Java17"]);

function toLanguageId(displayLabel: string): string {
  return LANGUAGE_ID_MAP[displayLabel] ?? displayLabel.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeLanguageLabel(label: string): string {
  const trimmed = label.trim();
  switch (trimmed.toLowerCase()) {
    case "cpp":
    case "cpp17":
    case "c++":
    case "c++17":
      return "C++17";
    case "cpp20":
    case "c++20":
      return "C++20";
    case "python":
    case "py":
    case "python3":
      return "Python3";
    case "pypy":
    case "pypy3":
      return "PyPy3";
    case "java":
    case "java17":
      return "Java17";
    case "go":
      return "Go";
    case "rust":
      return "Rust";
    default:
      return trimmed;
  }
}

function normalizeAllowedLanguages(languages?: string[] | null): string[] {
  const source = languages?.length ? languages : ["C++17"];
  const normalized = source
    .map((language) => normalizeLanguageLabel(language))
    .filter((language, index, list) => list.indexOf(language) === index);
  return normalized.length > 0 ? normalized : ["C++17"];
}

function isContestEditorTheme(value: string | null): value is ContestEditorThemeId {
  return Boolean(value && CONTEST_EDITOR_THEMES.some((theme) => theme.id === value));
}

// Configure marked once at module level — pays cost on first import, never again.
marked.use({ breaks: true, gfm: true });

// Opaque sentinels used to lift code and math out of the markdown before marked
// runs, then re-inject them after sanitization. They contain no markdown-active
// (_ * ` [ ] $) or HTML-active characters, so marked and DOMPurify pass them
// through verbatim. (HTML comments would be stripped by DOMPurify — don't use them.)
const MATH_TOKEN = (n: number) => `@@AMSMATH${n}@@`;
const CODE_TOKEN = (n: number) => `@@AMSCODE${n}@@`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Render a single LaTeX fragment to HTML with KaTeX, then sanitize it in
// isolation. KaTeX HTML is injected AFTER the main DOMPurify pass, so it must be
// scrubbed here: with output:"html" KaTeX emits only <span> elements carrying
// class/style, so a tampered LaTeX payload can never produce a script, an event
// handler, or a javascript: URL that could reach window.__TAURI__.
function renderMath(tex: string, displayMode: boolean): string {
  let html: string;
  try {
    html = katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: "html",
      strict: "ignore",
    });
  } catch {
    // throwOnError:false already renders parse errors inline; this guards only
    // against unexpected exceptions so a bad statement never blanks the view.
    return `<code class="pb-math-error">${escapeHtml(tex)}</code>`;
  }
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["span"],
    ALLOWED_ATTR: ["class", "style", "aria-hidden"],
  });
}

function parseDescription(md: string): string {
  // SECURITY: problem statements are untrusted (backend / contest-authored, and
  // could be tampered with in transit) and are rendered into the privileged
  // Tauri webview via dangerouslySetInnerHTML. Sanitize the marked() output —
  // stripping <script>, inline event handlers, and javascript:/data: URLs —
  // before it can reach the DOM, so injected markup cannot reach window.__TAURI__.
  // DOMPurify needs a DOM; during static prerender (Node) there is none, but
  // contest content is only ever fetched and rendered in the browser, so the
  // prerender path only ever sees empty placeholder strings.
  if (typeof window === "undefined") return "";

  const codeFragments: string[] = [];
  const mathFragments: string[] = [];

  // 1. Lift code out first so a `$` inside code/`...` is never treated as math.
  //    Fenced blocks before inline spans. The original raw text is preserved and
  //    re-emitted (escaped) as standard <pre><code>/<code> after sanitization.
  let working = md.replace(
    /```[ \t]*([\w-]*)[ \t]*\r?\n([\s\S]*?)```/g,
    (_m, _lang: string, body: string) => {
      const i = codeFragments.length;
      codeFragments.push(`<pre><code>${escapeHtml(String(body).replace(/\n$/, ""))}</code></pre>`);
      return `\n\n${CODE_TOKEN(i)}\n\n`;
    }
  );
  working = working.replace(/`([^`\n]+?)`/g, (_m, body: string) => {
    const i = codeFragments.length;
    codeFragments.push(`<code>${escapeHtml(body)}</code>`);
    return CODE_TOKEN(i);
  });

  // 2. Extract math — display $$...$$ before inline $...$ so a $$ pair is not
  //    misread as two empty inline delimiters. Each fragment is pre-rendered to
  //    sanitized KaTeX HTML and replaced with an inert token.
  working = working.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => {
    const i = mathFragments.length;
    mathFragments.push(renderMath(tex.trim(), true));
    return MATH_TOKEN(i);
  });
  working = working.replace(/\$((?:[^$\\]|\\.)+?)\$/g, (_m, tex: string) => {
    const i = mathFragments.length;
    mathFragments.push(renderMath(tex.trim(), false));
    return MATH_TOKEN(i);
  });

  // 3. Markdown -> HTML on the now code-free, math-free text.
  const rawHtml = marked.parse(working) as string;

  // 4. Sanitize the markdown-derived body with the standard untrusted-content
  //    profile (unchanged). Tokens are inert plain text and survive intact.
  let safeHtml = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });

  // 5. Re-inject the (independently sanitized / escaped) code and math fragments.
  safeHtml = safeHtml
    .replace(/@@AMSCODE(\d+)@@/g, (_m, n: string) => codeFragments[Number(n)] ?? "")
    .replace(/@@AMSMATH(\d+)@@/g, (_m, n: string) => mathFragments[Number(n)] ?? "");

  return safeHtml;
}
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function enhanceSampleBlocks(html: string, copiedSampleKey: string | null): string {
  let index = 0;
  return html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (_match, attrs, code) => {
    const key = `sample-${index++}`;
    const plain = decodeHtmlEntities(code).replace(/\n$/, "");
    const label = copiedSampleKey === key ? "Copied" : "Copy";
    return `<div class="pb-sample-block"><button type="button" class="pb-copy-button" data-copy-key="${key}" data-copy-sample="${escapeHtmlAttribute(plain)}">${label}</button><pre><code${attrs}>${code}</code></pre></div>`;
  });
}

function splitProblemDescription(md: string): Record<ProblemSectionKey, string> {
  const sections: Record<ProblemSectionKey, string[]> = {
    statement: [],
    examples: [],
    constraints: [],
  };
  let current: ProblemSectionKey = "statement";

  for (const line of md.split("\n")) {
    const heading = /^#{1,4}\s+(.+)$/.exec(line.trim());
    if (heading) {
      const title = heading[1].toLowerCase();
      if (/examples?|samples?/.test(title)) current = "examples";
      else if (/constraints?|limits?/.test(title)) current = "constraints";
      else current = "statement";
    }
    sections[current].push(line);
  }

  return {
    statement: sections.statement.join("\n").trim() || md,
    examples: sections.examples.join("\n").trim(),
    constraints: sections.constraints.join("\n").trim(),
  };
}

function getAvailableProblemTabs(sections: Record<ProblemSectionKey, string>): ProblemSectionKey[] {
  return (["statement", "examples", "constraints"] as const).filter(
    (key) => key === "statement" || sections[key].trim().length > 0
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const EditorPane = dynamic(() => import("./editor-pane"), {
  ssr: false,
  loading: () => <div style={{ flex: 1, background: "#0F0F0F", borderTop: "1px solid #1F1F1F" }} />,
});

type Question = {
  id: string;
  title: string;
  description: string | null;
  starter_code: string | null;
  order_index: number;
  question_type: string;
};

type ClientFollowUpPart = {
  id?: string;
  statement: string;
  points: number;
};

type FollowUpPartState = {
  inputText: string;
  loading: boolean;
  submitted: boolean;
  correct: boolean;
};

function parseFollowUpParts(desc: string): ClientFollowUpPart[] {
  try {
    const parsed = JSON.parse(desc);
    if (Array.isArray(parsed)) return parsed as ClientFollowUpPart[];
  } catch {
    /* empty */
  }
  return [];
}

type EditorFile = {
  id: string;
  name: string;
  content: string;
};

// Verdict dot/text colour resolves to the canonical --verdict-* tokens so a
// verdict reads identically here, in the trust strip, and on the results page.
// (CE is a distinct violet, not WA-red; RUNNING is blue so purple stays the
// primary-action accent.) The BG/BORDER tints are DERIVED from those same tokens
// via color-mix — re-hueing a verdict in globals.css updates every surface at
// once, with no second hardcoded copy to drift out of sync.
const VERDICT_COLORS: Record<string, string> = {
  AC: "var(--verdict-ac)",
  WA: "var(--verdict-wa)",
  TLE: "var(--verdict-tle)",
  MLE: "var(--verdict-mle)",
  RE: "var(--verdict-re)",
  CE: "var(--verdict-ce)",
  OLE: "var(--verdict-mle)",
  IE: "var(--verdict-ie)",
  QUEUED: "var(--verdict-running)",
  RUNNING: "var(--verdict-running)",
};
// A verdict hue at `pct`% opacity over the dark surface (equivalent to the old
// rgba(...,pct/100) tints, but sourced from the one canonical token).
const tint = (token: string, pct: number) =>
  `color-mix(in srgb, var(${token}) ${pct}%, transparent)`;
const VERDICT_BG: Record<string, string> = {
  AC: tint("--verdict-ac", 10),
  QUEUED: tint("--verdict-running", 10),
  RUNNING: tint("--verdict-running", 10),
  WA: tint("--verdict-wa", 10),
  RE: tint("--verdict-re", 10),
  CE: tint("--verdict-ce", 12),
  IE: tint("--verdict-ie", 12),
  TLE: tint("--verdict-tle", 10),
  MLE: tint("--verdict-mle", 10),
  OLE: tint("--verdict-mle", 10),
};
const VERDICT_BORDER: Record<string, string> = {
  AC: tint("--verdict-ac", 28),
  QUEUED: tint("--verdict-running", 28),
  RUNNING: tint("--verdict-running", 28),
  WA: tint("--verdict-wa", 28),
  RE: tint("--verdict-re", 28),
  CE: tint("--verdict-ce", 30),
  IE: tint("--verdict-ie", 30),
  TLE: tint("--verdict-tle", 28),
  MLE: tint("--verdict-mle", 28),
  OLE: tint("--verdict-mle", 28),
};

type ContestMeta = {
  id: string;
  title: string;
  start_at?: string;
  end_at: string;
  status: string;
  allowed_languages?: string[];
};

type QuestionPayload = Partial<Question> & {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") return value;
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function looksLikeCpp(code: string | null | undefined): code is string {
  if (!code) return false;
  return /#include\s*<|using\s+namespace\s+std|int\s+main\s*\(/.test(code);
}

function defaultCppStarter(): string {
  return [
    "#include <bits/stdc++.h>",
    "using namespace std;",
    "",
    "int main() {",
    "  ios::sync_with_stdio(false);",
    "  cin.tie(nullptr);",
    "",
    "  return 0;",
    "}",
  ].join("\n");
}

function defaultPythonStarter(): string {
  return [
    "import sys",
    "input = sys.stdin.readline",
    "",
    "def solve():",
    "    pass",
    "",
    "solve()",
  ].join("\n");
}

function defaultJavaStarter(): string {
  return [
    "import java.util.*;",
    "import java.io.*;",
    "",
    "public class Main {",
    "    public static void main(String[] args) throws IOException {",
    "        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));",
    "        ",
    "    }",
    "}",
  ].join("\n");
}

function defaultStarterFor(language: string): string {
  if (language === "Python3") return defaultPythonStarter();
  if (language === "Java17") return defaultJavaStarter();
  return defaultCppStarter();
}

/**
 * Returns true if content has never been meaningfully edited — i.e. it still
 * matches any of the known default starters or is empty. Safe to replace when
 * the user switches languages.
 */
function isPristineStarter(content: string): boolean {
  return (
    content === "" ||
    content === defaultCppStarter() ||
    content === defaultPythonStarter() ||
    content === defaultJavaStarter()
  );
}

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  "C++17": "cpp",
  "C++20": "cpp",
  Python3: "py",
  Java17: "java",
  Go: "go",
  Rust: "rs",
};

/**
 * Derives the editor filename for a question's main file.
 * Java is a hard special-case: the worker compiles `javac Main.java` and runs
 * `java -cp . Main`, so the class name — and therefore the filename — must be
 * `Main.java` regardless of the question title.
 */
function questionFileName(question: Question, language: string): string {
  if (language === "Java17") return "Main.java";

  const ext = LANGUAGE_EXTENSIONS[language] ?? "cpp";
  const fallbackLetter = String.fromCharCode(65 + Math.max(0, question.order_index));

  const letterMatch = /^([A-Z])(?:[.)\]:-]|\s+-|\s)/i.exec(question.title.trim());
  if (letterMatch) return `${letterMatch[1].toUpperCase()}.${ext}`;

  const slug = question.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || fallbackLetter}.${ext}`;
}

function unwrapQuestionList(payload: unknown): unknown[] {
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

function normalizeQuestion(value: unknown, index: number): Question | null {
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

function normalizeQuestions(payload: unknown): Question[] {
  return unwrapQuestionList(payload)
    .map((item, index) => normalizeQuestion(item, index))
    .filter((item): item is Question => item !== null)
    .sort((a, b) => a.order_index - b.order_index);
}

async function fetchJsonOrNull(url: string): Promise<unknown | null> {
  try {
    return await fetchJson<unknown>(url, {}, { dedupeKey: url, retries: 2 });
  } catch {
    return null;
  }
}

async function fetchContestQuestions(contestId: string): Promise<Question[]> {
  const paths = [
    `/contests/${contestId}/questions`,
    `/contests/${contestId}/problems`,
    `/contests/${contestId}/bundle`,
  ];

  for (const path of paths) {
    const questions = normalizeQuestions(await fetchJsonOrNull(`${API_URL}${path}`));
    if (questions.length > 0) return questions;
  }

  return [];
}

async function createContestSession(contestId: string, contestTitle?: string) {
  const email = localStorage.getItem(STORAGE_KEYS.USER_EMAIL) ?? "candidate@ams.local";
  const response = await fetchJson<{ id?: string }>(
    `${API_URL}/sessions`,
    {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        contest_id: contestId,
        candidate_email: email,
        candidate_name: email.split("@")[0],
      }),
    },
    { dedupeKey: `session:create:${contestId}:${email}`, retries: 2 }
  );

  if (response.id) {
    localStorage.setItem(
      ACTIVE_SESSION_KEY,
      JSON.stringify({
        id: response.id,
        contest_id: contestId,
        contest_title: contestTitle,
        updated_at: new Date().toISOString(),
      })
    );
  }

  return response;
}
declare global {
  interface Window {
    __TAURI__?: {
      core: { invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
      window: {
        getCurrentWindow: () => {
          setFullscreen: (v: boolean) => Promise<void>;
          setAlwaysOnTop: (v: boolean) => Promise<void>;
          setDecorations: (v: boolean) => Promise<void>;
          setResizable: (v: boolean) => Promise<void>;
          availableMonitors: () => Promise<
            Array<{
              name: string | null;
              position: { x: number; y: number };
              size: { width: number; height: number };
              scaleFactor: number;
            }>
          >;
        };
      };
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const rootEl = ref.current;
    if (!rootEl) return;
    const trappedRoot: T = rootEl;

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(trappedRoot.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true"
    );
    (focusable[0] ?? trappedRoot).focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;

      const currentFocusable = Array.from(
        trappedRoot.querySelectorAll<HTMLElement>(selector)
      ).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");
      if (currentFocusable.length === 0) {
        event.preventDefault();
        trappedRoot.focus({ preventScroll: true });
        return;
      }

      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [active, onEscape]);

  return ref;
}

function isVideoRendering(video: HTMLVideoElement): boolean {
  return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0;
}

function waitForVideoFrame(video: HTMLVideoElement, timeoutMs = 3000): Promise<boolean> {
  if (isVideoRendering(video)) return Promise.resolve(true);

  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("playing", onReady);
      resolve(ok);
    };
    const onReady = () => done(isVideoRendering(video));
    const timer = setTimeout(() => done(isVideoRendering(video)), timeoutMs);

    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("canplay", onReady, { once: true });
    video.addEventListener("playing", onReady, { once: true });
  });
}

async function attachVideoStream(video: HTMLVideoElement, stream: MediaStream): Promise<boolean> {
  video.muted = true;
  video.playsInline = true;
  if (video.srcObject !== stream) video.srcObject = stream;

  try {
    await video.play();
  } catch {
    // WebKit can reject play before metadata is ready; wait for a real frame below.
  }

  const ready = await waitForVideoFrame(video);
  if (!ready) return false;

  try {
    await video.play();
  } catch {}
  return isVideoRendering(video);
}

function useCountdown(endAt: string, onExpiry?: () => void) {
  const totalMsRef = useRef<number | null>(null);
  const firedExpiryRef = useRef(false);
  const [state, setState] = useState<{
    remaining: string;
    phase: CountdownPhase;
    percentLeft: number;
  }>({
    remaining: "",
    phase: "nominal",
    percentLeft: 1,
  });

  useEffect(() => {
    totalMsRef.current = null;
    firedExpiryRef.current = false;
    let id: ReturnType<typeof setInterval> | null = null;
    function tick() {
      const diff = new Date(endAt).getTime() - Date.now();
      if (totalMsRef.current === null) totalMsRef.current = Math.max(diff, 0);
      const percentLeft =
        totalMsRef.current > 0 ? Math.max(0, Math.min(1, diff / totalMsRef.current)) : 0;
      if (diff <= 0) {
        setState((prev) =>
          prev.remaining === "00:00:00" && prev.phase === "expired"
            ? prev
            : { remaining: "00:00:00", phase: "expired", percentLeft: 0 }
        );
        if (!firedExpiryRef.current && onExpiry) {
          firedExpiryRef.current = true;
          onExpiry();
        }
        if (id) clearInterval(id);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const remaining = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      const phase = countdownPhase(diff);
      setState((prev) =>
        prev.remaining === remaining && prev.phase === phase
          ? prev
          : { remaining, phase, percentLeft }
      );
    }
    tick();
    id = setInterval(tick, 1000);
    return () => {
      if (id) clearInterval(id);
    };
  }, [endAt]);

  return state;
}

const CountdownBadge = memo(function CountdownBadge({
  endAt,
  onExpiry,
}: {
  endAt: string;
  onExpiry?: () => void;
}) {
  const { remaining, phase } = useCountdown(endAt, onExpiry);
  const PHASE_COLOR: Record<CountdownPhase, string> = {
    nominal: "#e4e4e7",
    warning: "#a1a1aa",
    critical: "var(--verdict-wa)",
    expired: "var(--text-dim)",
  };
  const color = PHASE_COLOR[phase];
  const isCritical = phase === "critical";
  const isExpired = phase === "expired";
  return (
    <div
      role="timer"
      aria-live="off"
      aria-label={isExpired ? "Contest time expired" : `Time remaining ${remaining}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        // A tinted pill contains the timer at the critical threshold so urgency
        // is signalled by shape, not colour alone.
        padding: isCritical ? "4px 12px" : "4px 0",
        borderRadius: "var(--radius-pill)",
        backgroundColor: isCritical ? "rgba(239, 68, 68, 0.12)" : "transparent",
        border: `1px solid ${isCritical ? "rgba(239, 68, 68, 0.30)" : "transparent"}`,
        transition:
          "background-color var(--transition-standard), border-color var(--transition-standard)",
        animation: isCritical ? "countdown-pulse 1s ease-in-out infinite" : "none",
      }}
    >
      {isExpired && (
        <Lock
          size={12}
          strokeWidth={2.5}
          color={color}
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        />
      )}
      <span
        style={{
          fontSize: "13px",
          fontWeight: 600,
          color,
          fontFamily: "'JetBrains Mono', monospace",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.02em",
          transition: "color 1s linear",
        }}
      >
        {remaining}
      </span>
    </div>
  );
});

const LANGUAGE_META = {
  c: {
    ext: "c",
    name: "C",
    starter: `#include <stdio.h>

int main() {
    // Write your C solution here
    return 0;
}`,
  },
  cpp17: {
    ext: "cpp",
    name: "C++17",
    starter: `#include <iostream>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    // Write your C++17 solution here
    return 0;
}`,
  },
  cpp20: {
    ext: "cpp",
    name: "C++20",
    starter: `#include <iostream>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    // Write your C++20 solution here
    return 0;
}`,
  },
  python3: {
    ext: "py",
    name: "Python 3",
    starter: `import sys

def solve():
    # Write your Python 3 solution here
    pass

if __name__ == '__main__':
    solve()`,
  },
  pypy3: {
    ext: "py",
    name: "PyPy 3",
    starter: `import sys

def solve():
    # Write your PyPy 3 solution here
    pass

if __name__ == '__main__':
    solve()`,
  },
  java17: {
    ext: "java",
    name: "Java 17",
    starter: `import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        // Write your Java 17 solution here
    }
}`,
  },
};

function FollowUpPane({
  question,
  sessionId,
  apiUrl,
  questionLetter,
  partStates,
  onPartUpdate,
}: {
  question: Question;
  sessionId: string;
  apiUrl: string;
  questionLetter: string;
  partStates: Record<number, FollowUpPartState>;
  onPartUpdate: (partIndex: number, patch: Partial<FollowUpPartState>) => void;
}) {
  const parts = parseFollowUpParts(question.description ?? "");

  async function handleSubmit(partIndex: number) {
    const state = partStates[partIndex];
    const answer = state?.inputText ?? "";
    if (!answer.trim()) return;
    onPartUpdate(partIndex, { loading: true });
    try {
      const res = await fetch(`${apiUrl}/sessions/${sessionId}/followup-answer`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ question_id: question.id, part_index: partIndex, answer }),
      });
      const data = await res.json();
      onPartUpdate(partIndex, { loading: false, submitted: true, correct: data.correct === true });
    } catch {
      onPartUpdate(partIndex, { loading: false });
    }
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        background: "#0F0F0F",
        padding: "24px 32px",
        gap: "0",
      }}
    >
      <div
        style={{
          marginBottom: "24px",
          paddingBottom: "16px",
          borderBottom: "1px solid #1F1F1F",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            color: "#64748b",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 700,
          }}
        >
          Follow-up question
        </span>
        <h2
          style={{
            margin: "8px 0 0",
            fontSize: "20px",
            fontWeight: 600,
            color: "#e2e8f0",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          {question.title}
        </h2>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {parts.map((part, idx) => {
          const label = `${questionLetter}${idx + 1}`;
          const state = partStates[idx] ?? {
            inputText: "",
            loading: false,
            submitted: false,
            correct: false,
          };
          const prevAccepted = idx === 0 || partStates[idx - 1]?.correct === true;
          const locked = !prevAccepted;
          const accepted = state.correct && state.submitted;

          return (
            <div
              key={idx}
              style={{
                borderRadius: "10px",
                border: accepted
                  ? "1px solid rgba(34,197,94,0.3)"
                  : locked
                    ? "1px solid #1F1F1F"
                    : "1px solid rgb(var(--accent-rgb) / 0.2)",
                background: accepted
                  ? "rgba(34,197,94,0.04)"
                  : locked
                    ? "#111111"
                    : "rgb(var(--accent-rgb) / 0.03)",
                overflow: "hidden",
                opacity: locked ? 0.55 : 1,
                transition: "all 250ms",
              }}
            >
              {/* Part header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 16px",
                  borderBottom: locked ? "none" : "1px solid rgba(255,255,255,0.05)",
                  background: accepted
                    ? "rgba(34,197,94,0.06)"
                    : locked
                      ? "transparent"
                      : "rgb(var(--accent-rgb) / 0.06)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 700,
                      fontSize: "13px",
                      color: accepted ? "#22c55e" : locked ? "#475569" : "var(--color-accent-base)",
                    }}
                  >
                    {label}
                  </span>
                  {locked && (
                    <span
                      style={{
                        fontSize: "11px",
                        color: "#475569",
                        fontFamily: "Inter, system-ui, sans-serif",
                      }}
                    >
                      Locked · complete {questionLetter}
                      {idx} first
                    </span>
                  )}
                  {accepted && (
                    <span
                      style={{
                        fontSize: "11px",
                        color: "#22c55e",
                        fontWeight: 600,
                        fontFamily: "Inter, system-ui, sans-serif",
                      }}
                    >
                      Accepted
                    </span>
                  )}
                  {state.submitted && !state.correct && !locked && (
                    <span
                      style={{
                        fontSize: "11px",
                        color: "#ef4444",
                        fontFamily: "Inter, system-ui, sans-serif",
                      }}
                    >
                      Incorrect · try again
                    </span>
                  )}
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    color: accepted ? "#22c55e" : "#64748b",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {part.points} pts
                </span>
              </div>

              {!locked && (
                <div style={{ padding: "16px" }}>
                  {/* Statement */}
                  <div
                    className="pb-body"
                    style={{
                      color: "#cbd5e1",
                      fontSize: "14px",
                      lineHeight: 1.65,
                      marginBottom: "14px",
                    }}
                    dangerouslySetInnerHTML={{ __html: parseDescription(part.statement || "") }}
                  />

                  {/* Answer input */}
                  {!accepted && (
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input
                        type="text"
                        value={state.inputText}
                        onChange={(e) => onPartUpdate(idx, { inputText: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !state.loading) handleSubmit(idx);
                        }}
                        placeholder="Your answer…"
                        disabled={state.loading}
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          background: "#1A1A1A",
                          border:
                            state.submitted && !state.correct
                              ? "1px solid rgba(239,68,68,0.4)"
                              : "1px solid rgba(255,255,255,0.08)",
                          borderRadius: "6px",
                          color: "#e2e8f0",
                          fontSize: "13px",
                          fontFamily: "system-ui, sans-serif",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSubmit(idx)}
                        disabled={state.loading || !state.inputText.trim()}
                        style={{
                          padding: "8px 16px",
                          background: state.loading
                            ? "rgb(var(--accent-rgb) / 0.2)"
                            : "rgb(var(--accent-rgb) / 0.15)",
                          border: "1px solid rgb(var(--accent-rgb) / 0.35)",
                          borderRadius: "6px",
                          color: "var(--color-accent-light)",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor:
                            state.loading || !state.inputText.trim() ? "not-allowed" : "pointer",
                          opacity: state.loading || !state.inputText.trim() ? 0.6 : 1,
                          transition: "all 150ms",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {state.loading ? "Checking…" : "Submit"}
                      </button>
                    </div>
                  )}
                  {accepted && (
                    <div
                      style={{
                        padding: "8px 12px",
                        background: "rgba(34,197,94,0.08)",
                        border: "1px solid rgba(34,197,94,0.2)",
                        borderRadius: "6px",
                        color: "#4ade80",
                        fontSize: "13px",
                      }}
                    >
                      {state.inputText}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Markov Pane ────────────────────────────────────────────────
function MarkovPane({
  question,
  sessionId,
  apiUrl,
  questionLetter,
}: {
  question: Question;
  sessionId: string;
  apiUrl: string;
  questionLetter: string;
}) {
  const [chain, setChain] = useState<MarkovChain>({ states: [], transitions: [] });
  const [verdict, setVerdict] = useState<{
    correct: boolean;
    feedback: string;
    points: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (chain.states.length === 0) {
      setError("Build a Markov chain before submitting.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/sessions/${sessionId}/markov-answer`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          question_id: question.id,
          submitted_json: JSON.stringify(normalizeChain(chain)),
        }),
      });
      if (!res.ok) throw new Error("Server error");
      const data = (await res.json()) as { correct: boolean; feedback: string; points: number };
      setVerdict(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  }

  const descHtml = useMemo(
    () => parseDescription(question.description ?? ""),
    [question.description]
  );

  return (
    <div style={{ flex: 1, display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left: problem statement */}
      <div
        style={{
          width: "38%",
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid rgba(255,255,255,0.05)",
          background: "#0F0F0F",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            padding: "0 16px",
            height: 38,
            display: "flex",
            alignItems: "center",
            borderBottom: "1px solid #1F1F1F",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "#64748b",
              letterSpacing: "0.06em",
              fontFamily: "Inter, system-ui, sans-serif",
              fontWeight: 700,
            }}
          >
            Problem {questionLetter} · Markov chain
          </span>
        </div>
        <div
          style={{ padding: "20px 24px", fontSize: 14, color: "#cbd5e1", lineHeight: 1.7 }}
          dangerouslySetInnerHTML={{ __html: descHtml }}
        />
      </div>

      {/* Right: editor + submit */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: "#080d1a",
          overflowY: "auto",
          padding: 20,
        }}
      >
        <div
          style={{
            marginBottom: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "#64748b",
              fontFamily: "Inter, system-ui, sans-serif",
              letterSpacing: "0.06em",
            }}
          >
            Build your Markov chain
          </span>
          {verdict && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: "3px 12px",
                borderRadius: 20,
                background: verdict.correct ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                border: `1px solid ${verdict.correct ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
                color: verdict.correct ? "#4ade80" : "#f87171",
              }}
            >
              {verdict.correct ? `✓ AC  +${verdict.points}pts` : `✗ ${verdict.feedback}`}
            </span>
          )}
        </div>

        <MarkovEditor value={chain} onChange={setChain} readOnly={verdict?.correct === true} />

        {error && <p style={{ fontSize: 12, color: "#f87171", marginTop: 8 }}>{error}</p>}

        {!verdict?.correct && (
          <button
            type="button"
            disabled={loading || chain.states.length === 0}
            onClick={handleSubmit}
            style={{
              marginTop: 14,
              alignSelf: "flex-start",
              padding: "8px 24px",
              borderRadius: 8,
              background: "rgb(var(--accent-rgb) / 0.15)",
              border: "1px solid rgb(var(--accent-rgb) / 0.45)",
              color: "var(--color-accent-light)",
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
              opacity: loading || chain.states.length === 0 ? 0.5 : 1,
            }}
          >
            {loading ? "Checking…" : "Submit Answer"}
          </button>
        )}

        {verdict?.correct && (
          <p style={{ marginTop: 12, fontSize: 12, color: "#4ade80" }}>
            ✓ Correct! Your Markov chain matches the expected answer.
          </p>
        )}
      </div>
    </div>
  );
}

export default function ContestPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contestId = searchParams?.get("contestId") ?? "";
  const isDryRun = (searchParams?.get("mode") ?? "") === "dry-run";

  // SECURITY (defense-in-depth chokepoint): a real (non-dry-run) proctored
  // session may only render the contest if the desktop lockdown is engaged.
  // The ONLY legitimate way in is onboarding → lock_desktop → navigate here, so
  // a lock-engaged check passing means the candidate came through onboarding.
  // States: "checking" (probe in flight — render a neutral securing screen),
  // "ok" (lockdown engaged, dry-run, or no Tauri bridge i.e. dev/browser), or
  // "redirecting" (reached the contest unlocked — bounce back to onboarding).
  const [lockGate, setLockGate] = useState<"checking" | "ok" | "redirecting">(
    isDryRun ? "ok" : "checking"
  );

  const [contest, setContest] = useState<ContestMeta | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeQ, setActiveQ] = useState(0);
  const [questionFiles, setQuestionFiles] = useState<Record<string, EditorFile[]>>({});
  const [questionActiveFile, setQuestionActiveFile] = useState<Record<string, string>>({});
  const [editorTheme, setEditorTheme] = useState<ContestEditorThemeId>(DEFAULT_EDITOR_THEME);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("C++17");
  const [problemPaneWidth, setProblemPaneWidth] = useState(35);
  const [problemTab, setProblemTab] = useState<ProblemSectionKey>("statement");
  const [copiedSampleKey, setCopiedSampleKey] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunAttempt | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  // Set when the judge hasn't returned a verdict within the polling window — the
  // submission is still queued (distinct from a hard connection error).
  const [runTimedOut, setRunTimedOut] = useState(false);
  // Attempt id of the most recent "Run on Judge" (sample-only) run. Used to pull
  // its per-test results out of `testResults` and render them LeetCode-style in
  // the Output panel. RUN attempts are hidden from the Attempts history, so this
  // is the only place their results surface.
  const [runResultAttemptId, setRunResultAttemptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  // Bumped on a failed save so the debounced autosave effect re-arms and retries
  // even when the candidate has stopped typing (e.g. a transient network blip).
  const [saveRetryNonce, setSaveRetryNonce] = useState(0);
  // Consecutive failed-save count, drives the exponential backoff in the autosave
  // effect. Reset to 0 on any successful save.
  const saveRetryCountRef = useRef(0);
  // True once we've blown past MAX_SAVE_RETRIES: the work is buffered locally and
  // we back off to occasional retries instead of a tight ~1.5s loop.
  const [savedLocallyOnly, setSavedLocallyOnly] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In-flight guards so double-clicks / rapid retries can't fire a second POST to
  // /submissions while one is already pending (prevents duplicate QUEUED rows).
  const runInFlightRef = useRef(false);
  const submitInFlightRef = useRef(false);
  // Guards the exit/teardown path so a manual "Submit & Exit" and the timer-driven
  // expiry can't both run (double unlock / double /submit). Never reset: once exit
  // begins the candidate is leaving.
  const exitInFlightRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Non-blocking warning surfaced after the candidate has been unlocked/exited but
  // we could NOT confirm the final save/submit landed (their work is buffered
  // locally). The exit teardown still runs — they are never trapped.
  const [submitWarning, setSubmitWarning] = useState<string | null>(null);
  const [submitConfirm, setSubmitConfirm] = useState(false);
  const [proctoringOk, setProctoringOk] = useState(true);
  const [faceStatus, setFaceStatus] = useState<"ok" | "away" | "unknown">("unknown");
  // Ambient connection signal for the trust strip. Defaults online; the effect
  // syncs the real value on mount (navigator is unavailable during SSR).
  const [online, setOnline] = useState(true);
  const [blockedApps, setBlockedApps] = useState<string[]>([]);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraVideoReady, setCameraVideoReady] = useState(false);
  const processScanInFlightRef = useRef(false);
  const activeViolationDetailRef = useRef("");
  const lastFocusLossRef = useRef(0);
  const lastStatementCopyRef = useRef(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supportCategory, setSupportCategory] = useState("camera_not_detected");
  const [customIssueDetail, setCustomIssueDetail] = useState("");
  const [isSendingReport, setIsSendingReport] = useState(false);
  const [reportSentSuccess, setReportSentSuccess] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pendingCloseFileId, setPendingCloseFileId] = useState<string | null>(null);
  const [lockGraceActive, setLockGraceActive] = useState(false);
  const [lockGraceCountdown, setLockGraceCountdown] = useState(3);
  const [cameraCollapsed, setCameraCollapsed] = useState(false);
  const [faceGraceCountdown, setFaceGraceCountdown] = useState(5);
  const [faceGraceActive, setFaceGraceActive] = useState(false);

  const [softBlockActive, setSoftBlockActive] = useState(false);
  const prevCameraStatusRef = useRef<{ cameraOk: boolean; blockedCount: number } | null>(null);
  // Camera defaults ON (permission was granted during onboarding); microphone
  // defaults OFF — contestants opt in once inside the contest area. Refs mirror
  // the state so stream (re)acquisition applies the current toggle, and every
  // change is audit-logged for organizers (see applyMediaToggle).
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(false);
  const cameraEnabledRef = useRef(true);
  const micEnabledRef = useRef(false);
  const mediaInitialStateLoggedRef = useRef(false);
  const [hasToggledMedia, setHasToggledMedia] = useState(false);
  const [showMediaToggleWarning, setShowMediaToggleWarning] = useState(false);
  const [pendingMediaToggle, setPendingMediaToggle] = useState<{
    type: "camera" | "mic";
    value: boolean;
  } | null>(null);
  const [terminalTab, setTerminalTab] = useState<"stdout" | "logs" | "submissions">("stdout");
  const [submissionsList, setSubmissionsList] = useState<SubmissionAttemptRecord[]>([]);
  const [allSubmissionsList, setAllSubmissionsList] = useState<SubmissionAttemptRecord[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [expandedAttemptId, setExpandedAttemptId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, any[]>>({});
  const [testResultFilter, setTestResultFilter] = useState<"all" | "failed" | "passed">("all");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  // Timer expiry auto-submit overlay state.
  const [timeUpState, setTimeUpState] = useState<"idle" | "submitting" | "submitted" | "error">(
    "idle"
  );
  const [savedAnswers, setSavedAnswers] = useState<
    Record<string, { language: string; content: string }>
  >({});

  // Follow-up question state: questionId → partIndex → FollowUpPartState
  const [followUpState, setFollowUpState] = useState<
    Record<string, Record<number, FollowUpPartState>>
  >({});

  function updateFollowUpPart(
    questionId: string,
    partIndex: number,
    patch: Partial<FollowUpPartState>
  ) {
    setFollowUpState((prev) => ({
      ...prev,
      [questionId]: {
        ...(prev[questionId] ?? {}),
        [partIndex]: {
          ...(prev[questionId]?.[partIndex] ?? {
            inputText: "",
            loading: false,
            submitted: false,
            correct: false,
          }),
          ...patch,
        },
      },
    }));
  }

  // SECURITY (defense-in-depth): verify the desktop lockdown is engaged before
  // the contest is usable. Practice (dry-run) is intentionally unlocked, so it
  // is exempt. Outside the Tauri shell (dev/browser preview) there is no real
  // lockdown to engage — the invoke throws "Tauri bridge unavailable" and we
  // ALLOW rather than trap the developer. Only a genuine direct-entry into a
  // live contest (Tauri present, lock NOT engaged) triggers the bounce back to
  // onboarding (replace, not push, to avoid a back-button loop). The normal
  // flow — onboarding locks first, then navigates here — passes the check.
  useEffect(() => {
    if (isDryRun) return; // practice mode is intentionally unlocked
    let cancelled = false;
    (async () => {
      try {
        const engaged = await invoke<boolean>("is_lockdown_engaged");
        if (cancelled) return;
        if (engaged) {
          setLockGate("ok");
        } else {
          // Reached the contest without lockdown — never render it.
          setLockGate("redirecting");
          router.replace(`/session/onboarding?contestId=${encodeURIComponent(contestId)}`);
        }
      } catch {
        // Tauri unavailable (dev/browser) — no real lockdown exists here.
        if (!cancelled) setLockGate("ok");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDryRun, contestId, router]);

  const fetchSubmissions = useCallback(async () => {
    if (!sessionId || !questions[activeQ]) return;
    setLoadingSubmissions(true);
    try {
      const response = await fetch(
        `${API_URL}/sessions/${sessionId}/submissions?_t=${Date.now()}`,
        {
          cache: "no-store",
          headers: authHeaders(),
        }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rawSubmissions = (await response.json()) as SubmissionAttemptRecord[];
      // Exclude RUN attempts everywhere the Attempts history is derived: the
      // visible list, the per-question status map, and the "evaluated attempt"
      // summary all read from these. Runs surface only in the Output panel.
      const allSubmissions = rawSubmissions.filter((sub) => !isRunSubmission(sub));
      setAllSubmissionsList(allSubmissions);
      const qId = questions[activeQ].id;
      const filtered = allSubmissions.filter((sub) => sub.problem_id === qId);
      filtered.sort((a, b) => b.attempt_no - a.attempt_no);
      setSubmissionsList(filtered);
      setRunResult((prev) => {
        if (!prev) return prev;
        const latestForRun =
          filtered.find((attempt) => attempt.id === prev.id) ?? filtered[0] ?? null;
        if (!latestForRun) return prev;
        return normalizeAttemptForRunResult(latestForRun);
      });
    } catch (err) {
      console.error("Failed to fetch submissions:", err);
    } finally {
      setLoadingSubmissions(false);
    }
  }, [sessionId, activeQ, questions]);

  useEffect(() => {
    fetchSubmissions();
  }, [activeQ, sessionId, fetchSubmissions]);

  useEffect(() => {
    const hasPending = submissionsList.some((sub) => isPendingSubmissionStatus(sub.status));
    if (!hasPending) return;

    const interval = setInterval(() => {
      fetchSubmissions();
    }, 2000);

    return () => clearInterval(interval);
  }, [submissionsList, fetchSubmissions]);

  const fetchTestResults = async (attemptId: string) => {
    if (!sessionId) return;
    try {
      const response = await fetch(
        `${API_URL}/sessions/${sessionId}/submissions/${attemptId}/test-results?_t=${Date.now()}`,
        { cache: "no-store", headers: authHeaders() }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as any[];
      setTestResults((prev) => ({
        ...prev,
        [attemptId]: data || [],
      }));
    } catch (err) {
      console.error("Failed to fetch test results:", err);
    }
  };

  const toggleExpandAttempt = (attemptId: string) => {
    if (expandedAttemptId === attemptId) {
      setExpandedAttemptId(null);
    } else {
      setExpandedAttemptId(attemptId);
      if (!testResults[attemptId]) {
        fetchTestResults(attemptId);
      }
    }
  };

  const prevSubmissionsRef = useRef<SubmissionAttemptRecord[]>([]);
  useEffect(() => {
    if (submissionsList.length > 0) {
      const latest = submissionsList[0];
      const prevLatest = prevSubmissionsRef.current[0];
      if (shouldAutoExpandAttempt(latest, prevLatest)) {
        setExpandedAttemptId(latest.id);
        fetchTestResults(latest.id);
      }
    }
    prevSubmissionsRef.current = submissionsList;
  }, [submissionsList]);

  function logMediaToggle(type: "camera" | "mic", enabled: boolean) {
    const timestamp = new Date().toISOString();
    const detail = `${type === "camera" ? "Camera" : "Microphone"} turned ${enabled ? "on" : "off"} by contestant`;
    // Server-side incident record — organizers/admins see when and what changed.
    // Use keepalive fetch (not beacon) so the Authorization + X-Device-Id headers
    // are sent; media toggles are user-initiated so we're not on the unload path.
    void postJsonKeepalive(
      `${API_URL}/sessions/${sessionId ?? "unregistered"}/incidents`,
      {
        category: enabled ? "media_toggle_on" : "media_toggle_off",
        detail,
        telemetry: {
          timestamp,
          contest_id: contestId,
          session_id: sessionId ?? "unregistered",
          media: type,
          enabled,
        },
      },
      { headers: authHeaders() }
    ).catch(() => {});
    // Local persistent audit trail (proctoring-events.jsonl) — survives offline.
    void window.__TAURI__?.core
      .invoke("log_proctoring_event", {
        kind: "media_toggle",
        detail,
        timestamp: Date.now(),
        payload: {
          media: type,
          enabled,
          contest_id: contestId,
          session_id: sessionId ?? "unregistered",
        },
      })
      .catch(() => {});
  }

  function applyMediaToggle(type: "camera" | "mic", value: boolean) {
    if (type === "camera") {
      setCameraEnabled(value);
      cameraEnabledRef.current = value;
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = value));
      }
    } else {
      setMicEnabled(value);
      micEnabledRef.current = value;
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = value));
      }
    }
    logMediaToggle(type, value);
  }

  function handleToggleMedia(type: "camera" | "mic", value: boolean) {
    // The one-time confirmation only applies when turning a device OFF —
    // enabling the (default-off) microphone needs no proctoring warning.
    if (!hasToggledMedia && !value) {
      setPendingMediaToggle({ type, value });
      setShowMediaToggleWarning(true);
      return;
    }
    applyMediaToggle(type, value);
  }

  function confirmMediaToggle() {
    setHasToggledMedia(true);
    setShowMediaToggleWarning(false);
    if (pendingMediaToggle) {
      applyMediaToggle(pendingMediaToggle.type, pendingMediaToggle.value);
      setPendingMediaToggle(null);
    }
  }

  function cancelMediaToggle() {
    setShowMediaToggleWarning(false);
    setPendingMediaToggle(null);
  }

  useEffect(() => {
    const storedTheme = localStorage.getItem(EDITOR_THEME_KEY);
    if (isContestEditorTheme(storedTheme)) setEditorTheme(storedTheme);
  }, []);

  useEffect(() => {
    const storedWidth = localStorage.getItem(
      `${PROBLEM_SPLIT_WIDTH_KEY}:${contestId || "default"}`
    );
    const parsedWidth = storedWidth ? Number(storedWidth) : NaN;
    if (Number.isFinite(parsedWidth)) setProblemPaneWidth(clamp(parsedWidth, 28, 52));
  }, [contestId]);

  function handleEditorThemeChange(value: string) {
    if (isContestEditorTheme(value) === false) return;
    setEditorTheme(value);
    localStorage.setItem(EDITOR_THEME_KEY, value);
    setThemeMenuOpen(false);
  }

  const handleProblemSplitMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const sidebarWidth = sidebarCollapsed ? 52 : 220;
      const availableWidth = Math.max(window.innerWidth - sidebarWidth, 600);
      const storageKey = `${PROBLEM_SPLIT_WIDTH_KEY}:${contestId || "default"}`;

      const onMove = (moveEvent: MouseEvent) => {
        const nextWidth = clamp(
          ((moveEvent.clientX - sidebarWidth) / availableWidth) * 100,
          28,
          52
        );
        setProblemPaneWidth(nextWidth);
        localStorage.setItem(storageKey, String(Math.round(nextWidth * 10) / 10));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [contestId, sidebarCollapsed]
  );

  function handleProblemBodyClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const button = target?.closest<HTMLButtonElement>("[data-copy-sample]");
    if (!button) return;

    const sample = button.getAttribute("data-copy-sample") ?? "";
    const key = button.getAttribute("data-copy-key") ?? "sample";
    void navigator.clipboard?.writeText(sample).catch(() => {});
    // Mark this sample as an allowed clipboard source so pasting it back into the
    // editor is classified internal (F6), not flagged as an external code dump.
    registerAllowedClipboard(sample);
    setCopiedSampleKey(key);
    window.setTimeout(
      () => setCopiedSampleKey((current) => (current === key ? null : current)),
      1400
    );
  }

  // Monitor faceStatus to trigger face grace period countdown
  useEffect(() => {
    if (faceStatus === "away") {
      if (!faceGraceActive) {
        setFaceGraceActive(true);
        setFaceGraceCountdown(5);
      }
    } else if (faceStatus === "ok") {
      setFaceGraceActive(false);
      setFaceGraceCountdown(5);
      setSoftBlockActive(false);
    }
  }, [faceStatus, faceGraceActive]);

  // Face grace countdown timer
  useEffect(() => {
    if (faceGraceActive && faceGraceCountdown > 0) {
      const timer = setTimeout(() => {
        setFaceGraceCountdown(faceGraceCountdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (faceGraceActive && faceGraceCountdown === 0) {
      setSoftBlockActive(true);
    }
  }, [faceGraceActive, faceGraceCountdown]);

  // Monitor blockedApps changes to trigger the grace period
  useEffect(() => {
    if (blockedApps.length > 0) {
      if (!lockGraceActive) {
        setLockGraceActive(true);
        setLockGraceCountdown(3);
      }
    } else {
      setLockGraceActive(false);
      setLockGraceCountdown(3);
    }
  }, [blockedApps, lockGraceActive]);

  // Countdown timer for locking
  useEffect(() => {
    if (lockGraceActive && lockGraceCountdown > 0) {
      const timer = setTimeout(() => {
        setLockGraceCountdown(lockGraceCountdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [lockGraceActive, lockGraceCountdown]);

  const supportTelemetry = useMemo(() => {
    return {
      timestamp: new Date().toISOString(),
      contest_id: contestId,
      session_id: sessionId ?? "unregistered",
      device: {
        user_agent: typeof window !== "undefined" ? window.navigator.userAgent : "node",
        screen_resolution:
          typeof window !== "undefined"
            ? `${window.screen.width}x${window.screen.height}`
            : "unknown",
        pixel_ratio: typeof window !== "undefined" ? window.devicePixelRatio : 1,
      },
      proctoring_snapshot: {
        camera_error: cameraError ?? "none",
        face_status: faceStatus,
        restricted_apps: blockedApps,
        proctoring_ok: proctoringOk,
      },
    };
  }, [contestId, sessionId, cameraError, faceStatus, blockedApps, proctoringOk, showSupportModal]);

  async function handleSendSupportReport() {
    setIsSendingReport(true);
    try {
      await postJsonKeepalive(
        `${API_URL}/sessions/${sessionId ?? "unregistered"}/incidents`,
        {
          category: supportCategory,
          detail: supportCategory === "other" ? customIssueDetail : "",
          telemetry: supportTelemetry,
        },
        { headers: authHeaders() }
      ).catch(() => {});
    } catch {}

    await new Promise((r) => setTimeout(r, 1200));
    setIsSendingReport(false);
    setReportSentSuccess(true);
    setTimeout(() => {
      setReportSentSuccess(false);
      setShowSupportModal(false);
      setSupportCategory("camera_not_detected");
      setCustomIssueDetail("");
    }, 2200);
  }

  // stable fallback so useCountdown's effect doesn't restart on every render
  const fallbackEndAt = useMemo(() => new Date(Date.now() + 3600000).toISOString(), []);

  useEffect(() => {
    if (!contestId) {
      setLoadError("Missing contest ID. Please relaunch from your contest list.");
      setLoading(false);
      return;
    }

    if (contestId === "mock-contest-dev" || contestId === "mock-contest-scheduled") {
      const mockEnd = new Date(Date.now() + 5400000).toISOString();
      const titles: Record<string, string> = {
        "mock-contest-dev": "AMS Internal — Dev Test",
        "mock-contest-scheduled": "AMS Internal — Scheduled Test",
      };
      const mockMeta: ContestMeta = {
        id: contestId,
        title: titles[contestId],
        end_at: mockEnd,
        status: "ACTIVE",
        allowed_languages: ["C++17", "Python3", "Java17"],
      };
      setContest(mockMeta);
      setSelectedLanguage(mockMeta.allowed_languages![0]);
      const mockQuestions: Question[] = [
        {
          id: "mock-q-1",
          title: "A. Binary Search",
          description:
            "You are given a non-decreasing array $A$ of $N$ integers and $Q$ query values. For each query $x$, print the 1-based index of the first element $A[i]$ such that $A[i] >= x$. If no such element exists, print $-1$.",
          starter_code: defaultCppStarter(),
          order_index: 0,
          question_type: "code",
        },
        {
          id: "mock-q-2",
          title: "B. Alice and Bob",
          description:
            "Given two integers $a$ and $b$, determine the winner under the rules in the statement. Read input from stdin and print the required answer for each test case.",
          starter_code: defaultCppStarter(),
          order_index: 1,
          question_type: "code",
        },
      ];
      setQuestions(mockQuestions);
      loadQuestion(mockQuestions[0], mockMeta.allowed_languages![0]);
      setLoadError(null);
      setLoading(false);
      return;
    }

    const contestRequest = fetchJsonOrNull(`${API_URL}/contests/${contestId}`);
    const questionsRequest = fetchContestQuestions(contestId);
    const sessionRequest = createContestSession(contestId).catch((err) => {
      if (err instanceof SessionBindingError) {
        router.push("/home");
      }
      return null;
    });

    Promise.all([contestRequest, questionsRequest, sessionRequest])
      .then(async ([c, questions, session]) => {
        const contestMeta = c ? (c as ContestMeta) : null;
        const normalizedLanguages = normalizeAllowedLanguages(contestMeta?.allowed_languages);
        const firstLang = normalizedLanguages[0] ?? "C++17";
        if (contestMeta) {
          setContest({
            ...contestMeta,
            allowed_languages: normalizedLanguages,
          });
          setSelectedLanguage(firstLang);
        }

        let answersMap: Record<string, { language: string; content: string }> = {};
        if (session?.id) {
          setSessionId(session.id);
          localStorage.setItem(
            ACTIVE_SESSION_KEY,
            JSON.stringify({
              id: session.id,
              contest_id: contestId,
              contest_title: contestMeta?.title,
              updated_at: new Date().toISOString(),
            })
          );

          try {
            const answersData = await fetchJson<any[]>(
              `${API_URL}/sessions/${session.id}/answers`,
              {
                headers: authHeaders(),
              }
            );
            if (answersData && Array.isArray(answersData)) {
              for (const ans of answersData) {
                try {
                  const parsed = JSON.parse(ans.answer_text);
                  // Follow-up answers: stored as array of {part_index, answer, correct}
                  if (Array.isArray(parsed)) {
                    const fuState: Record<number, FollowUpPartState> = {};
                    for (const sub of parsed) {
                      fuState[sub.part_index as number] = {
                        inputText: (sub.answer as string) ?? "",
                        loading: false,
                        submitted: true,
                        correct: (sub.correct as boolean) ?? false,
                      };
                    }
                    setFollowUpState((prev) => ({ ...prev, [ans.question_id]: fuState }));
                  } else {
                    const files = parsed.files || [];
                    const activeFile =
                      files.find((f: any) => f.id === parsed.active_file_id) || files[0];
                    answersMap[ans.question_id] = {
                      language: parsed.language || "cpp17",
                      content: activeFile ? activeFile.content : "",
                    };
                  }
                } catch {
                  answersMap[ans.question_id] = {
                    language: "cpp17",
                    content: ans.answer_text,
                  };
                }
              }
              setSavedAnswers(answersMap);
            }
          } catch (err) {
            console.error("Failed to load saved answers:", err);
          }
        }

        setActiveQ(0);
        setQuestions(questions);
        if (questions.length > 0) {
          loadQuestionWithAnswers(questions[0], answersMap, firstLang);
          setLoadError(null);
        } else {
          setLoadError("Questions are not available yet. Please retry in a few seconds.");
        }

        setLoading(false);
      })
      .catch(() => {
        setLoadError("Unable to load contest. Check connection and retry.");
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestId]);

  function loadQuestionWithAnswers(
    q: Question,
    answersMap: Record<string, { language: string; content: string }>,
    language: string
  ) {
    const saved = answersMap[q.id];
    let lang = language;
    let content: string;

    if (saved) {
      // Wire format → display format (e.g. "cpp17" → "C++17")
      const displayLang =
        Object.entries(LANGUAGE_ID_MAP).find(([, id]) => id === saved.language)?.[0] ??
        saved.language;
      lang = normalizeLanguageLabel(displayLang);
      content = saved.content;
      setSelectedLanguage(lang);
    } else {
      content = q.starter_code ?? defaultStarterFor(lang);
    }

    setQuestionFiles((prev) => {
      if (prev[q.id]) return prev;
      const file: EditorFile = {
        id: `${q.id}:main`,
        name: questionFileName(q, lang),
        content,
      };
      return { ...prev, [q.id]: [file] };
    });
    setQuestionActiveFile((prev) => {
      if (prev[q.id]) return prev;
      return { ...prev, [q.id]: `${q.id}:main` };
    });
  }

  function loadQuestion(q: Question, language: string) {
    loadQuestionWithAnswers(q, savedAnswers, language);
  }

  function switchQuestion(idx: number) {
    if (questions[activeQ] && sessionId) {
      handleSave();
    }
    setActiveQ(idx);
    loadQuestion(questions[idx], selectedLanguage);
    setRunResult(null);
    setRunResultAttemptId(null);
    setRunError(null);
  }

  function handleLanguageChange(newLanguage: string) {
    const normalizedLanguage = normalizeLanguageLabel(newLanguage);
    setSelectedLanguage(normalizedLanguage);
    setHasUnsavedChanges(true);
    setSaved(false);
    const q = questions[activeQ];
    if (!q) return;
    setQuestionFiles((prev) => {
      const files = prev[q.id];
      if (!files) return prev;
      return {
        ...prev,
        [q.id]: files.map((f) => {
          if (!f.id.endsWith(":main")) return f;
          return {
            ...f,
            name: questionFileName(q, normalizedLanguage),
            content: isPristineStarter(f.content)
              ? defaultStarterFor(normalizedLanguage)
              : f.content,
          };
        }),
      };
    });
  }

  function handleCodeChange(value: string) {
    setHasUnsavedChanges(true);
    setSaved(false);
    setSaveError(null);
    const qId = questions[activeQ]?.id ?? "";
    const currentActiveId = questionActiveFile[qId] ?? questionFiles[qId]?.[0]?.id ?? "";
    setQuestionFiles((prev) => ({
      ...prev,
      [qId]: (prev[qId] ?? []).map((f) =>
        f.id === currentActiveId ? { ...f, content: value } : f
      ),
    }));
  }

  function addEditorFile() {
    setHasUnsavedChanges(true);
    setSaved(false);
    const qId = questions[activeQ]?.id ?? "question";
    setQuestionFiles((prev) => {
      const files = prev[qId] ?? [];
      const nextIndex = files.length + 1;
      const file: EditorFile = {
        id: `${qId}:scratch-${Date.now()}`,
        name: `scratch${nextIndex}.cpp`,
        content: defaultCppStarter(),
      };
      setQuestionActiveFile((qaf) => ({ ...qaf, [qId]: file.id }));
      return { ...prev, [qId]: [...files, file] };
    });
  }

  function removeEditorFile(fileId: string) {
    setHasUnsavedChanges(true);
    setSaved(false);
    const qId = questions[activeQ]?.id ?? "";
    setQuestionFiles((prev) => {
      const files = (prev[qId] ?? []).filter((f) => f.id !== fileId);
      return { ...prev, [qId]: files };
    });
    setQuestionActiveFile((prev) => {
      if (prev[qId] !== fileId) return prev;
      const remaining = (questionFiles[qId] ?? []).filter((f) => f.id !== fileId);
      return { ...prev, [qId]: remaining[remaining.length - 1]?.id ?? "" };
    });
  }

  async function triggerRun() {
    if (!questions[activeQ] || !sessionId || isRunning) return;
    // In-flight guard: block a second POST while one is already pending so rapid
    // double-clicks / retries can't enqueue duplicate attempts.
    if (runInFlightRef.current) return;
    runInFlightRef.current = true;

    setIsRunning(true);
    setRunResult(null);
    setRunResultAttemptId(null);
    setRunError(null);
    setRunTimedOut(false);
    setSubmitError(null);
    setTerminalTab("stdout");

    // Persist the current code before dispatching to the judge.
    const savedOk = await handleSave();
    if (!savedOk) {
      runInFlightRef.current = false;
      setIsRunning(false);
      setRunError("Save failed — check your connection and retry.");
      return;
    }

    // Idempotency key for this logical run. Harmless if the backend ignores it
    // today; lets it dedupe retries of the same attempt once it consumes the key.
    const idempotencyKey =
      crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Create the submission attempt.
    let attemptId: string;
    try {
      const res = await fetch(`${API_URL}/sessions/${sessionId}/submissions`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          problem_id: questions[activeQ].id,
          language: toLanguageId(selectedLanguage),
          source_code: editorFiles.find((f) => f.id === activeFileId)?.content ?? "",
          idempotency_key: idempotencyKey,
          // Sample-only run: judged against sample tests, never scored, excluded
          // from the Attempts history. Submit omits this and defaults to submit.
          mode: "run",
        }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        if (errData.code === "SESSION_ALREADY_SUBMITTED") {
          setIsRunning(false);
          setRunError("Your session has already been submitted.");
          return;
        }
        if (errData.code === "ALREADY_PENDING") {
          setIsRunning(false);
          setRunError("Your previous attempt is still being judged — please wait.");
          return;
        }
        if (errData.code === "QUEUE_ERROR") {
          setIsRunning(false);
          setRunError("Failed to queue submission — please retry.");
          return;
        }
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const created = (await res.json()) as {
        id?: string;
        attempt_id?: string;
        attempt_no: number;
      };
      const resolvedId = created.id ?? created.attempt_id ?? "";
      attemptId = resolvedId;
      setRunResult({ id: resolvedId, attempt_no: created.attempt_no, status: "QUEUED" });
      setRunResultAttemptId(resolvedId);
      // Keep results in the Output panel — runs never appear under Attempts.
      setTerminalTab("stdout");
      void fetchSubmissions();
    } catch {
      setIsRunning(false);
      setRunError("Could not reach the judge. Check your connection and retry.");
      return;
    } finally {
      // The duplicate-POST window closes once the attempt request has resolved;
      // the subsequent polling phase is already gated by isRunning.
      runInFlightRef.current = false;
    }

    // Poll for the result with exponential back-off (max ~25 s total).
    const delays = [600, 1000, 1500, 2000, 2500, 3000, 3000, 3000, 3000, 3500];
    for (const ms of delays) {
      await new Promise<void>((r) => setTimeout(r, ms));
      try {
        const pollRes = await fetch(
          `${API_URL}/sessions/${sessionId}/submissions?_t=${Date.now()}`,
          {
            cache: "no-store",
            headers: authHeaders(),
          }
        );
        if (!pollRes.ok) continue; // transient — keep polling
        const attempts = (await pollRes.json()) as SubmissionAttemptRecord[];
        // The current RUN attempt is found from the raw list below; the Attempts
        // history lists exclude RUN rows (this run included).
        const visibleAttempts = attempts.filter((a) => !isRunSubmission(a));
        const qId = questions[activeQ]?.id;
        if (qId) {
          const filtered = visibleAttempts
            .filter((attempt) => attempt.problem_id === qId)
            .sort((a, b) => b.attempt_no - a.attempt_no);
          setAllSubmissionsList(visibleAttempts);
          setSubmissionsList(filtered);
        }
        const attempt = attempts.find((a) => a.id === attemptId);
        if (attempt) {
          const normalized = normalizeAttemptForRunResult(attempt);
          setRunResult(normalized);
          if (!isPendingSubmissionStatus(normalized.status)) {
            setIsRunning(false);
            // Compile errors go to the Build tab (as today); sample results render
            // in the Output panel. Runs never appear under Attempts.
            setTerminalTab(normalized.status === "CE" ? "logs" : "stdout");
            // Pull the per-sample results so the Output panel can show them,
            // reusing the same test-results fetch the Attempts expansion uses.
            if (normalized.status !== "CE") {
              void fetchTestResults(attemptId);
            }
            await fetchSubmissions();
            return;
          }
        }
      } catch {
        // transient network error — keep polling
      }
    }

    // Polling window elapsed without a terminal verdict: the submission is still
    // queued on the judge. Surface that clearly instead of leaving a silent spinner.
    setIsRunning(false);
    setRunError(null);
    setRunTimedOut(true);
    // Keep the timed-out state visible in the Output panel — the run is never an
    // Attempts row to navigate to.
    setTerminalTab("stdout");
    void fetchSubmissions();
  }

  // Persist the current editor content to localStorage so an unconfirmed network
  // save is never data loss. Best-effort: storage failures (quota / private mode)
  // must never throw into the save/submit/exit paths.
  function writeLocalAnswerBuffer() {
    if (!sessionId) return;
    const qId = questions[activeQ]?.id;
    if (!qId) return;
    try {
      localStorage.setItem(
        localAnswerBufferKey(sessionId, qId),
        JSON.stringify({
          language: toLanguageId(selectedLanguage),
          files: editorFiles,
          active_file_id: activeFileId,
          saved_at: Date.now(),
        })
      );
    } catch {
      // storage unavailable — nothing more we can do here
    }
  }

  function clearLocalAnswerBuffer(questionId: string) {
    if (!sessionId) return;
    try {
      localStorage.removeItem(localAnswerBufferKey(sessionId, questionId));
    } catch {
      // ignore
    }
  }

  async function handleSave(): Promise<boolean> {
    if (!questions[activeQ] || !sessionId) {
      setSaveError("No active session is available. Reopen the contest and try again.");
      return false;
    }

    // Mirror the current content locally before hitting the network, so even a
    // hard failure (or tab close mid-request) leaves the work recoverable.
    writeLocalAnswerBuffer();

    const qId = questions[activeQ].id;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await postJsonKeepalive(
        `${API_URL}/sessions/${sessionId}/answers`,
        {
          question_id: qId,
          answer_text: JSON.stringify({
            language: toLanguageId(selectedLanguage),
            files: editorFiles,
            active_file_id: activeFileId,
          }),
        },
        { headers: authHeaders() }
      );
      if (!response.ok) throw new Error(`Save failed with HTTP ${response.status}`);

      setSavedAnswers((prev) => ({
        ...prev,
        [qId]: {
          language: toLanguageId(selectedLanguage),
          content: editorFiles.find((f) => f.id === activeFileId)?.content || "",
        },
      }));

      // Confirmed save: clear unsaved state, drop the local buffer + backoff.
      setHasUnsavedChanges(false);
      saveRetryCountRef.current = 0;
      setSavedLocallyOnly(false);
      clearLocalAnswerBuffer(qId);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return true;
    } catch {
      setSaved(false);
      // The buffer write above means the work is safe locally regardless.
      saveRetryCountRef.current += 1;
      if (saveRetryCountRef.current >= MAX_SAVE_RETRIES) {
        setSavedLocallyOnly(true);
        setSaveError("Save failed — your work is saved locally and will retry automatically.");
      } else {
        setSaveError("Save failed. Check your connection and retry before submitting.");
      }
      // Re-arm the autosave so it keeps trying once connectivity returns, even if
      // the candidate has stopped typing. The effect applies exponential backoff.
      setSaveRetryNonce((n) => n + 1);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitSolution() {
    if (!questions[activeQ] || !sessionId) {
      setSubmissionError("No active session is available.");
      return;
    }
    // In-flight guard: block a second POST while one is pending so rapid
    // double-clicks / retries can't enqueue duplicate attempts.
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;

    setIsSubmitting(true);
    setSubmissionError(null);
    setTerminalTab("submissions");

    try {
      const savedOk = await handleSave();
      if (!savedOk) {
        throw new Error("Failed to save answer prior to submission.");
      }

      const qId = questions[activeQ].id;
      // Idempotency key for this logical submission. Harmless if ignored today;
      // lets the backend dedupe retries of the same submission once it consumes it.
      const idempotencyKey =
        crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const response = await postJsonKeepalive(
        `${API_URL}/sessions/${sessionId}/submissions`,
        {
          problem_id: qId,
          language: toLanguageId(selectedLanguage),
          source_code: editorFiles.find((f) => f.id === activeFileId)?.content ?? "",
          idempotency_key: idempotencyKey,
        },
        { headers: authHeaders() }
      );

      if (!response.ok) {
        const errData = (await response.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        if (errData.code === "SESSION_ALREADY_SUBMITTED") {
          setSubmissionError("Your session has already been submitted.");
          return;
        }
        if (errData.code === "ALREADY_PENDING") {
          setSubmissionError("Your previous attempt is still being judged — please wait.");
          return;
        }
        if (errData.code === "QUEUE_ERROR") {
          setSubmissionError("Failed to queue submission — please retry.");
          return;
        }
        throw new Error(errData.error || `Submission failed with HTTP ${response.status}`);
      }

      await fetchSubmissions();
    } catch (err: any) {
      setSubmissionError(err.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
      submitInFlightRef.current = false;
    }
  }

  // Exit teardown: release every OS-level lock and stop proctoring. This MUST run
  // on every exit path — confirmed or not — so a network failure can never trap a
  // candidate inside the locked-down shell. Every step is failure-tolerant.
  async function runExitTeardown() {
    try {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch {
      // ignore storage errors
    }
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);
    const win = window.__TAURI__?.window.getCurrentWindow();
    if (win) {
      await win.setFullscreen(false).catch(() => {});
      await win.setAlwaysOnTop(false).catch(() => {});
      await win.setDecorations(true).catch(() => {});
    }
    try {
      await window.__TAURI__?.core.invoke("unlock_desktop");
    } catch {
      // even if the native unlock fails, the window chrome above is already restored
    }
  }

  // Attempt the final save + /submit with a bounded retry. Returns whether the
  // submit was confirmed by the backend. SESSION_ALREADY_SUBMITTED and
  // CONTEST_ENDED are treated as SUCCESS (the backend already has the session).
  // Crucially this NEVER unlocks/exits — callers always run runExitTeardown after.
  async function attemptFinalSubmit(): Promise<boolean> {
    if (!sessionId) return false;
    const MAX_ATTEMPTS = 4;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Always mirror the latest content locally before each network try.
      writeLocalAnswerBuffer();
      try {
        await handleSave();
        const response = await postJsonKeepalive(
          `${API_URL}/sessions/${sessionId}/submit`,
          undefined,
          { headers: authHeaders() }
        );
        if (response.ok) return true;
        const errData = (await response.json().catch(() => ({}))) as { code?: string };
        // Backend already has/closed the session — treat as a confirmed submit.
        if (errData.code === "SESSION_ALREADY_SUBMITTED" || errData.code === "CONTEST_ENDED") {
          return true;
        }
      } catch {
        // network failure — fall through to the backoff and retry
      }
      if (attempt < MAX_ATTEMPTS - 1) {
        const delay = Math.min(1500 * 2 ** attempt, 8000) + Math.round(Math.random() * 400);
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }
    return false;
  }

  async function handleSubmitConfirmed() {
    if (exitInFlightRef.current) return;
    exitInFlightRef.current = true;
    setSubmitError(null);
    setSubmitWarning(null);
    setTimeUpState("submitting");
    const confirmed = await attemptFinalSubmit();
    if (!confirmed) {
      // We couldn't confirm — but we NEVER trap the candidate. Surface a clear
      // non-blocking warning, then unlock anyway. Work is buffered locally.
      setSubmitWarning(
        "We couldn't confirm your final save — your work is stored locally on this device."
      );
    }
    // Teardown ALWAYS runs, regardless of whether the submit was confirmed.
    await runExitTeardown();
    // Show the unified calm confirmation instead of a forced auto-redirect.
    // The candidate leaves on their own from the "submitted" overlay.
    setTimeUpState("submitted");
  }

  // Called by the countdown timer when end_at is reached.
  // Auto-submits the session so candidates never need to manually click "Submit & Exit".
  async function handleContestExpiry() {
    if (!sessionId) return;
    if (exitInFlightRef.current) return;
    exitInFlightRef.current = true;
    setSubmitWarning(null);
    setTimeUpState("submitting");
    const confirmed = await attemptFinalSubmit();
    if (!confirmed) {
      setSubmitWarning(
        "We couldn't confirm your final save — your work is stored locally on this device."
      );
    }
    // The time-up path ALWAYS unlocks too: a network failure must not imprison
    // the candidate. We never end in an "error" state with the shell still locked.
    await runExitTeardown();
    setTimeUpState("submitted");
  }

  useEffect(() => {
    if (loading) return; // Wait for contest load to ensure <video> ref is in DOM
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is unavailable in this environment.");
      setProctoringOk(false);
      setFaceStatus("away");
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const stopStream = (stream: MediaStream | null) => {
      stream?.getTracks().forEach((track) => track.stop());
    };

    const displayCameraError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      return msg.includes("NotAllowed") ||
        msg.includes("not allowed") ||
        msg.includes("denied") ||
        msg.includes("Permission")
        ? "Camera access was denied. Please check your system settings to grant camera permission."
        : msg.includes("NotFound") || msg.includes("not found")
          ? "No camera was found. Please ensure your camera is connected securely."
          : "Camera is currently unavailable. Please check your camera settings and try again.";
    };

    async function bindStream(stream: MediaStream, attempt: number) {
      const video = cameraVideoRef.current;
      if (!video) {
        if (attempt < 3) {
          retryTimer = setTimeout(() => {
            if (!cancelled) void bindStream(stream, attempt + 1);
          }, 150);
        }
        return;
      }

      const ready = await attachVideoStream(video, stream);
      if (cancelled || cameraStreamRef.current !== stream) return;

      setCameraVideoReady(ready);
      if (!ready) setProctoringOk(false);
      if (!ready && attempt < 2) {
        stopStream(stream);
        retryTimer = setTimeout(() => {
          if (!cancelled) void acquire(attempt + 1);
        }, 700);
      } else if (!ready) {
        setCameraError(
          "Camera opened, but no video frames were received. Close other camera apps and try again."
        );
      }
    }

    async function acquire(attempt = 0) {
      try {
        const stream = await withTimeout(
          navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
            audio: true,
          }),
          8000,
          "Camera request timed out"
        );
        if (cancelled) {
          stopStream(stream);
          return;
        }

        stopStream(cameraStreamRef.current);
        cameraStreamRef.current = stream;
        // Honor the current toggles on every (re)acquisition: camera defaults
        // on, microphone defaults off until the contestant enables it.
        stream.getVideoTracks().forEach((t) => (t.enabled = cameraEnabledRef.current));
        stream.getAudioTracks().forEach((t) => (t.enabled = micEnabledRef.current));
        setCameraStream(stream);
        setCameraVideoReady(false);
        setCameraError(null);
        if (!mediaInitialStateLoggedRef.current) {
          mediaInitialStateLoggedRef.current = true;
          void window.__TAURI__?.core
            .invoke("log_proctoring_event", {
              kind: "media_initial_state",
              detail: `camera ${cameraEnabledRef.current ? "on" : "off"}, microphone ${micEnabledRef.current ? "on" : "off"}`,
              timestamp: Date.now(),
              payload: {
                camera_enabled: cameraEnabledRef.current,
                mic_enabled: micEnabledRef.current,
                contest_id: contestId,
              },
            })
            .catch(() => {});
        }
        void bindStream(stream, attempt);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        const shouldRetry =
          attempt < 2 &&
          (msg.includes("NotReadable") ||
            msg.includes("Abort") ||
            msg.includes("busy") ||
            msg.includes("timed out"));

        if (shouldRetry) {
          retryTimer = setTimeout(() => {
            if (!cancelled) void acquire(attempt + 1);
          }, 900);
          return;
        }

        setCameraVideoReady(false);
        setProctoringOk(false);
        setFaceStatus("away");
        setCameraError(displayCameraError(err));
      }
    }

    void acquire();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      stopStream(cameraStreamRef.current);
      cameraStreamRef.current = null;
      setCameraVideoReady(false);
    };
  }, [loading]);

  useEffect(() => {
    if (!sessionId) return;
    const sendHeartbeat = () => {
      fetch(`${API_URL}/sessions/${sessionId}/heartbeat`, {
        method: "POST",
        keepalive: true,
        headers: authHeaders(),
      }).catch(() => {});
    };
    sendHeartbeat();
    const id = setInterval(sendHeartbeat, 60_000);
    return () => clearInterval(id);
  }, [sessionId]);

  // Track browser connectivity for the ambient trust strip.
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // Arm the native event-stream uploader: the Rust side tails the local
  // violation/proctoring spool and ships batches to
  // POST /sessions/:id/events with retry/backoff once it knows the session.
  useEffect(() => {
    if (!sessionId) return;
    void window.__TAURI__?.core
      .invoke("configure_event_stream", { apiUrl: API_URL, sessionId })
      .catch(() => {});
  }, [sessionId]);

  // ── Periodic presence verification (jittered 30–90 s) ──────────────────────
  // Samples the live camera with BlazeFace and logs presence_ok /
  // face_missing / multiple_faces proctoring events (thumbnails only on
  // anomalies — see lib/presence-monitor.ts for the retention notes). Uses a
  // detached <video> bound to the stream so sampling is independent of the
  // camera panel being collapsed. Deliberately does NOT drive faceStatus or
  // any UI — evidence collection only.
  useEffect(() => {
    if (!cameraStream) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let detectorFailed = false;
    let detector: PresenceDetector | null = null;
    const canvas = document.createElement("canvas");

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = cameraStream;
    void video.play().catch(() => {});

    const logPresence = (kind: string, detail: string, payload: Record<string, unknown>) => {
      void window.__TAURI__?.core
        .invoke("log_proctoring_event", {
          kind,
          detail,
          timestamp: Date.now(),
          payload: { ...payload, contest_id: contestId },
        })
        .catch(() => {});
    };

    async function tick() {
      if (cancelled) return;
      try {
        if (!cameraEnabledRef.current) {
          // Camera is policy-allowed off; attest that no sample was possible
          // so the organizer timeline has no silent gaps.
          logPresence(
            "presence_skipped_camera_off",
            "presence check skipped: camera disabled by contestant",
            {}
          );
        } else {
          if (!detector && !detectorFailed) {
            try {
              detector = await loadPresenceDetector();
            } catch {
              detectorFailed = true;
              logPresence(
                "presence_monitor_unavailable",
                "face detector failed to initialise; periodic presence checks disabled",
                {}
              );
            }
          }
          if (detector && !cancelled) {
            const sample = await samplePresence(video, detector, canvas);
            if (sample && !cancelled) {
              logPresence(sample.status, `presence check: ${sample.faces} face(s) detected`, {
                faces: sample.faces,
                thumbnail: sample.thumbnail,
              });
            }
          }
        }
      } catch {
        // Sampling must never disturb the exam surface.
      } finally {
        if (!cancelled && !detectorFailed) schedule();
      }
    }

    function schedule() {
      timer = setTimeout(() => void tick(), 30_000 + Math.random() * 60_000);
    }
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      video.srcObject = null;
      detector?.dispose?.();
      detector = null;
    };
  }, [cameraStream, contestId]);

  useEffect(() => {
    if (!cameraStream || !cameraVideoRef.current) return;
    let cancelled = false;
    void attachVideoStream(cameraVideoRef.current, cameraStream).then((ready) => {
      if (!cancelled) setCameraVideoReady(ready);
    });
    return () => {
      cancelled = true;
    };
  }, [cameraCollapsed, cameraStream]);

  useEffect(() => {
    if (!cameraStream) return;

    const updateCameraStatus = () => {
      const video = cameraVideoRef.current;
      const cameraOk = cameraStream.active && Boolean(video && isVideoRendering(video));
      const next = { cameraOk, blockedCount: blockedApps.length };
      const prev = prevCameraStatusRef.current;
      if (prev?.cameraOk === next.cameraOk && prev.blockedCount === next.blockedCount) return;
      prevCameraStatusRef.current = next;

      setFaceStatus(cameraOk ? "ok" : "away");
      setProctoringOk(cameraOk && blockedApps.length === 0);
      if (cameraOk) {
        setFaceGraceActive(false);
        setFaceGraceCountdown(5);
        setSoftBlockActive(false);
      }
    };

    updateCameraStatus();
    const interval = setInterval(updateCameraStatus, 1000);
    return () => clearInterval(interval);
  }, [blockedApps.length, cameraStream, cameraVideoReady]);

  // Periodic process scan — every 5s, log + alert on violation
  useEffect(() => {
    const tauriCore = window.__TAURI__?.core;
    if (!tauriCore) return;
    const invoke = tauriCore.invoke.bind(tauriCore);

    const prettyName: Record<string, string> = {
      obs: "OBS Studio",
      obs64: "OBS Studio",
      discord: "Discord",
      teamviewer: "TeamViewer",
      anydesk: "AnyDesk",
      wireshark: "Wireshark",
      "cheat engine": "Cheat Engine",
      cheatengine: "Cheat Engine",
      zoom: "Zoom",
      teams: "Microsoft Teams",
      mstsc: "Remote Desktop",
    };

    async function scan() {
      if (processScanInFlightRef.current) return;
      processScanInFlightRef.current = true;
      try {
        const result = await withTimeout(
          invoke<{ found: string[]; clean: boolean }>("scan_processes"),
          2500,
          "Process scan timed out"
        );
        if (!result.clean && result.found.length > 0) {
          const detail = result.found
            .map((f) => f.toLowerCase())
            .sort()
            .join(", ");
          setBlockedApps(result.found.map((f) => prettyName[f.toLowerCase()] ?? f));
          setProctoringOk(false);
          if (detail !== activeViolationDetailRef.current) {
            const previousDetail = activeViolationDetailRef.current;
            if (previousDetail) {
              // Use keepalive fetch (not beacon) so the auth header is sent.
              void postJsonKeepalive(
                `${API_URL}/sessions/${sessionId ?? "unregistered"}/incidents`,
                {
                  category: "blocked_app_resolved",
                  detail: previousDetail,
                  telemetry: {
                    timestamp: new Date().toISOString(),
                    contest_id: contestId,
                    session_id: sessionId ?? "unregistered",
                  },
                },
                { headers: authHeaders() }
              ).catch(() => {});
              await invoke("log_violation", {
                kind: "blocked_app_resolved",
                detail: previousDetail,
              });
            }

            activeViolationDetailRef.current = detail;
            // Use keepalive fetch (not beacon) so the auth header is sent.
            void postJsonKeepalive(
              `${API_URL}/sessions/${sessionId ?? "unregistered"}/incidents`,
              {
                category: "blocked_app_started",
                detail: result.found.join(", "),
                telemetry: {
                  timestamp: new Date().toISOString(),
                  contest_id: contestId,
                  session_id: sessionId ?? "unregistered",
                },
              },
              { headers: authHeaders() }
            ).catch(() => {});
            await invoke("log_violation", {
              kind: "blocked_app_started",
              detail: result.found.join(", "),
            });
          }
        } else {
          const previousDetail = activeViolationDetailRef.current;
          if (previousDetail) {
            activeViolationDetailRef.current = "";
            // Use keepalive fetch (not beacon) so the auth header is sent.
            void postJsonKeepalive(
              `${API_URL}/sessions/${sessionId ?? "unregistered"}/incidents`,
              {
                category: "blocked_app_resolved",
                detail: previousDetail,
                telemetry: {
                  timestamp: new Date().toISOString(),
                  contest_id: contestId,
                  session_id: sessionId ?? "unregistered",
                },
              },
              { headers: authHeaders() }
            ).catch(() => {});
            await invoke("log_violation", {
              kind: "blocked_app_resolved",
              detail: previousDetail,
            });
          }
          setBlockedApps([]);
          setProctoringOk(true);
        }
      } catch {
        // Tauri not available or scan timed out; keep the last known state.
      } finally {
        processScanInFlightRef.current = false;
      }
    }

    void scan();
    const id = setInterval(() => void scan(), 5000);
    return () => clearInterval(id);
  }, [contestId, sessionId]);

  useEffect(() => {
    function blockShortcuts(e: KeyboardEvent) {
      const blocked =
        e.key === "F11" ||
        e.key === "Escape" ||
        e.key === "PrintScreen" ||
        (e.altKey && (e.key === "Tab" || e.key === "F4" || e.key === "Escape")) ||
        e.metaKey ||
        (e.ctrlKey && e.key === "w") ||
        (e.ctrlKey && e.key === "W") ||
        (e.ctrlKey && e.shiftKey && e.key === "I") ||
        (e.ctrlKey && e.shiftKey && e.key === "J") ||
        (e.ctrlKey && e.key === "u") ||
        (e.ctrlKey && e.key === "U");
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener("keydown", blockShortcuts, { capture: true });
    return () => window.removeEventListener("keydown", blockShortcuts, { capture: true });
  }, []);

  // Focus-loss proctoring — when the locked window is hidden/blurred (alt-tab,
  // minimize, another window, virtual-desktop switch), log a violation. This is
  // the immediate signal; a native backstop exists elsewhere. Debounced so one
  // switch (which can fire both blur and visibilitychange) logs at most once.
  useEffect(() => {
    const reportFocusLoss = (detail: "document_hidden" | "window_blur") => {
      const now = Date.now();
      if (now - lastFocusLossRef.current < 1000) return;
      lastFocusLossRef.current = now;
      try {
        void window.__TAURI__?.core.invoke("log_violation", {
          kind: "focus_loss",
          detail,
        });
      } catch {
        // Tauri not available (browser/dev); ignore.
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) reportFocusLoss("document_hidden");
    };
    const onBlur = () => reportFocusLoss("window_blur");

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Statement copy proctoring (F6) — copying *out of the problem statement* is a
  // weak cheating signal (e.g. pasting it into an external tool), so log it as a
  // medium-severity event. We never block it (candidates legitimately copy sample
  // I/O), and never record the copied text — metadata only. Debounced like the
  // focus-loss effect so one gesture logs at most once.
  useEffect(() => {
    const reportStatementCopy = (verb: "copy" | "cut") => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const anchor = selection.anchorNode;
      const anchorEl = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
      if (!anchorEl?.closest(".pb-body")) return;

      const now = Date.now();
      if (now - lastStatementCopyRef.current < 1000) return;
      lastStatementCopyRef.current = now;

      try {
        void window.__TAURI__?.core.invoke("log_proctoring_event", {
          kind: "clipboard_copy",
          detail: `Statement ${verb}`,
          timestamp: Date.now(),
          payload: {
            source: "statement",
            len: String(selection).length,
            severity: "medium",
          },
        });
      } catch {
        // Tauri not available (browser/dev); ignore.
      }
    };

    const onCopy = () => reportStatementCopy("copy");
    const onCut = () => reportStatementCopy("cut");

    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
    };
  }, []);

  const currentQId = questions[activeQ]?.id ?? "";
  const editorFiles = questionFiles[currentQId] ?? [];
  const activeFileId = questionActiveFile[currentQId] ?? editorFiles[0]?.id ?? "";
  const activeFile = editorFiles.find((file) => file.id === activeFileId) ?? editorFiles[0] ?? null;
  const isEditorEmpty = !activeFile?.content;
  const currentCode = activeFile?.content ?? "";

  // Debounced autosave: persist the active answer ~1.5s after the candidate stops
  // editing, so saving is invisible and they never sit on an "unsaved" warning.
  // Re-arms on every content/language/file change (debounces typing) and on a
  // failed save (retry). Switching question bumps currentQId, whose cleanup clears
  // any pending timer; switchQuestion already saves the outgoing answer first.
  useEffect(() => {
    if (!hasUnsavedChanges || !sessionId || !currentQId) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    // Exponential backoff with jitter, capped, so a persistent failure can't spin
    // a tight ~1.5s retry loop. A fresh edit (saveRetryCountRef reset on success)
    // debounces at the base delay; consecutive failures stretch the interval.
    const failures = saveRetryCountRef.current;
    const backoff =
      failures === 0
        ? SAVE_RETRY_BASE_DELAY_MS
        : Math.min(SAVE_RETRY_BASE_DELAY_MS * 2 ** failures, SAVE_RETRY_MAX_DELAY_MS);
    const jitter = Math.round(Math.random() * 400);
    autosaveTimerRef.current = setTimeout(() => {
      void handleSave();
    }, backoff + jitter);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasUnsavedChanges,
    currentCode,
    selectedLanguage,
    activeFileId,
    currentQId,
    sessionId,
    saveRetryNonce,
  ]);
  const currentDescriptionMd = questions[activeQ]?.description ?? "*No description provided.*";
  const problemSections = useMemo(
    () => splitProblemDescription(currentDescriptionMd),
    [currentDescriptionMd]
  );
  const availableProblemTabs = useMemo(
    () => getAvailableProblemTabs(problemSections),
    [problemSections]
  );
  const activeProblemTab = availableProblemTabs.includes(problemTab) ? problemTab : "statement";
  const problemBodyHtml = useMemo(
    () =>
      enhanceSampleBlocks(
        parseDescription(problemSections[activeProblemTab] || currentDescriptionMd),
        copiedSampleKey
      ),
    [activeProblemTab, copiedSampleKey, currentDescriptionMd, problemSections]
  );
  // One trustworthy, invisible-saving model (Google-Docs style): the candidate
  // never sees an alarming "unsaved" warning. Any pending or in-flight write reads
  // "Saving…"; once persisted it reads "All changes saved"; only a real failure is
  // surfaced (and the debounced autosave keeps retrying in the background).
  const saveIndicator = saveError
    ? {
        label: "Couldn't save — retrying",
        color: "#fca5a5",
        bg: "rgba(239,68,68,0.1)",
        border: "rgba(239,68,68,0.28)",
        icon: "error" as const,
      }
    : saving
      ? {
          label: "Saving…",
          color: "var(--color-accent-light)",
          bg: "rgb(var(--accent-rgb) / 0.1)",
          border: "rgb(var(--accent-rgb) / 0.28)",
          icon: "loading" as const,
        }
      : hasUnsavedChanges
        ? {
            label: "Saving…",
            color: "var(--color-accent-light)",
            bg: "rgb(var(--accent-rgb) / 0.1)",
            border: "rgb(var(--accent-rgb) / 0.28)",
            icon: "pending" as const,
          }
        : {
            label: "All changes saved",
            color: "#86efac",
            bg: "rgba(34,197,94,0.08)",
            border: "rgba(34,197,94,0.24)",
            icon: "saved" as const,
          };
  const runStatusLabelMap: Record<RunVerdict, string> = {
    QUEUED: "Queued",
    RUNNING: "Running…",
    AC: "Accepted",
    WA: "Wrong answer",
    TLE: "Too slow (time limit)",
    MLE: "Out of memory",
    RE: "Runtime error",
    CE: "Didn’t compile",
    OLE: "Too much output",
    IE: "Judge error — please retry",
  };
  const runStatus = runError
    ? {
        // Client-side failure reaching the judge — distinct from a judge verdict.
        label: "Couldn’t reach the judge",
        color: "#fca5a5",
        bg: "rgba(239,68,68,0.1)",
        border: "rgba(239,68,68,0.28)",
        icon: "error" as const,
      }
    : runTimedOut
      ? {
          // Verdict not back yet — the submission is still queued on the judge.
          label: "Still running…",
          color: "#fcd34d",
          bg: "rgba(245,158,11,0.1)",
          border: "rgba(245,158,11,0.28)",
          icon: "pending" as const,
        }
      : runResult
        ? {
            label: runStatusLabelMap[runResult.status] ?? runResult.status,
            color: VERDICT_COLORS[runResult.status] ?? "#94a3b8",
            bg: VERDICT_BG[runResult.status] ?? "rgba(100,116,139,0.12)",
            border: VERDICT_BORDER[runResult.status] ?? "rgba(100,116,139,0.3)",
            icon:
              runResult.status === "QUEUED" || runResult.status === "RUNNING"
                ? ("loading" as const)
                : ("dot" as const),
          }
        : null;
  const runProgressPhase = runError
    ? 3
    : !runResult
      ? isRunning
        ? 0
        : -1
      : runResult.status === "QUEUED"
        ? 0
        : runResult.status === "RUNNING"
          ? 2
          : 3;
  const runProgressSteps = ["Queued", "Compiling", "Running", "Result"];
  const runMetrics =
    runResult && runResult.status !== "QUEUED" && runResult.status !== "RUNNING"
      ? [
          runResult.runtime_ms != null ? `${runResult.runtime_ms}ms` : null,
          runResult.memory_kb != null ? `${Math.round(runResult.memory_kb / 1024)}MB` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
  const shouldShowRunProgress = Boolean(isRunning || runResult || runError || runTimedOut);
  // Per-sample results for the most recent "Run on Judge". Pulled from the same
  // `testResults` cache the Attempts expansion uses, keyed by the run's attempt
  // id. Only populated once the run reaches a terminal (non-CE) verdict.
  const runSampleTests: any[] | null =
    runResultAttemptId && runResult && !isPendingSubmissionStatus(runResult.status)
      ? (testResults[runResultAttemptId] ?? null)
      : null;
  const latestAttempt = submissionsList[0] ?? null;
  const latestAttemptTests = latestAttempt ? testResults[latestAttempt.id] : null;
  const latestAttemptPending = latestAttempt
    ? latestAttempt.status === "QUEUED" || latestAttempt.status === "RUNNING"
    : false;
  const latestAttemptPassed = latestAttemptTests
    ? latestAttemptTests.filter((tr: any) => tr.verdict === "AC").length
    : 0;
  const latestAttemptFirstFailed =
    latestAttemptTests?.find((tr: any) => tr.verdict !== "AC") ?? null;
  const submissionsByQuestion = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    for (const sub of allSubmissionsList) {
      const qId = String(sub.problem_id ?? "");
      if (!qId) continue;
      grouped[qId] = [...(grouped[qId] ?? []), sub];
    }
    Object.values(grouped).forEach((items) =>
      items.sort((a, b) => Number(b.attempt_no ?? 0) - Number(a.attempt_no ?? 0))
    );
    return grouped;
  }, [allSubmissionsList]);
  const questionStatusMap = useMemo(() => {
    const map: Record<
      string,
      { label: string; shortLabel: string; color: string; bg: string; border: string }
    > = {};
    for (const q of questions) {
      const attempts = submissionsByQuestion[q.id] ?? [];
      const hasAccepted = attempts.some((sub) => (sub.final_verdict ?? sub.status) === "AC");
      const hasPending = attempts.some(
        (sub) => sub.status === "QUEUED" || sub.status === "RUNNING"
      );
      const hasAttempt = attempts.length > 0;
      const isActiveUnsaved = q.id === currentQId && hasUnsavedChanges;
      if (hasAccepted) {
        map[q.id] = {
          label: "Accepted",
          shortLabel: "AC",
          color: "var(--verdict-ac)",
          bg: "color-mix(in srgb, var(--verdict-ac) 10%, transparent)",
          border: "color-mix(in srgb, var(--verdict-ac) 28%, transparent)",
        };
      } else if (hasPending) {
        map[q.id] = {
          label: "Attempted",
          shortLabel: "Run",
          color: "var(--color-accent-base)",
          bg: "rgb(var(--accent-rgb) / 0.1)",
          border: "rgb(var(--accent-rgb) / 0.28)",
        };
      } else if (hasAttempt) {
        map[q.id] = {
          label: "Needs review",
          shortLabel: "Review",
          color: "var(--verdict-tle)",
          bg: "color-mix(in srgb, var(--verdict-tle) 10%, transparent)",
          border: "color-mix(in srgb, var(--verdict-tle) 28%, transparent)",
        };
      } else if (isActiveUnsaved) {
        map[q.id] = {
          label: "Unsaved",
          shortLabel: "Unsaved",
          color: "var(--verdict-tle)",
          bg: "color-mix(in srgb, var(--verdict-tle) 10%, transparent)",
          border: "color-mix(in srgb, var(--verdict-tle) 24%, transparent)",
        };
      } else if (savedAnswers[q.id]) {
        map[q.id] = {
          label: "Saved",
          shortLabel: "Saved",
          // A muted green — distinct from the bright AC token so "saved" never
          // reads as "accepted" in the nav.
          color: "color-mix(in srgb, var(--verdict-ac) 55%, var(--text-dim))",
          bg: "color-mix(in srgb, var(--verdict-ac) 8%, transparent)",
          border: "color-mix(in srgb, var(--verdict-ac) 22%, transparent)",
        };
      } else {
        map[q.id] = {
          label: "Not started",
          shortLabel: "Open",
          color: "var(--text-dim)",
          bg: "rgba(255,255,255,0.04)",
          border: "rgba(255,255,255,0.12)",
        };
      }
    }
    return map;
  }, [currentQId, hasUnsavedChanges, questions, savedAnswers, submissionsByQuestion]);
  const attemptedQuestionCount = questions.filter(
    (q) => (submissionsByQuestion[q.id] ?? []).length > 0
  ).length;
  const acceptedQuestionCount = questions.filter((q) =>
    (submissionsByQuestion[q.id] ?? []).some((sub) => (sub.final_verdict ?? sub.status) === "AC")
  ).length;
  const remainingQuestionCount = Math.max(questions.length - attemptedQuestionCount, 0);
  // Coverage shown on the calm post-submit confirmation: problems the candidate
  // engaged with (submitted to OR saved an answer for). Derived from LOCAL state
  // only — never correctness/verdicts/scores (those unlock after the 48h embargo).
  const engagedQuestionCount = questions.filter(
    (q) => (submissionsByQuestion[q.id] ?? []).length > 0 || Boolean(savedAnswers[q.id])
  ).length;
  const candidateEmail =
    typeof window !== "undefined" ? (localStorage.getItem(STORAGE_KEYS.USER_EMAIL) ?? "") : "";
  useEffect(() => {
    if (!availableProblemTabs.includes(problemTab)) setProblemTab("statement");
    setCopiedSampleKey(null);
  }, [activeQ, availableProblemTabs, problemTab]);

  const cameraHealthy = Boolean(cameraStream && cameraVideoReady && !cameraError);
  const shouldShowFaceBlock = softBlockActive && faceStatus !== "ok";
  const faceBlockTitle = cameraHealthy ? "Integrity Check Paused" : "Camera Check Required";
  const faceBlockMessage = cameraHealthy
    ? "Please face the camera to resume your exam."
    : cameraError
      ? cameraError
      : "Waiting for a live camera frame. Check the camera preview before continuing.";
  const lockViolationDialogRef = useFocusTrap<HTMLDivElement>(
    lockGraceActive && lockGraceCountdown === 0
  );
  const faceBlockDialogRef = useFocusTrap<HTMLDivElement>(shouldShowFaceBlock);
  const mediaWarningDialogRef = useFocusTrap<HTMLDivElement>(
    showMediaToggleWarning,
    cancelMediaToggle
  );
  const supportDialogRef = useFocusTrap<HTMLDivElement>(showSupportModal, () =>
    setShowSupportModal(false)
  );

  // SECURITY: while the lockdown probe is pending — or while bouncing an
  // unlocked direct-entry back to onboarding — render a neutral securing screen.
  // Never flash the contest UI before lockdown is confirmed engaged.
  if (lockGate !== "ok") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#0F0F0F",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderTop: "2px solid var(--color-accent-base)",
              borderRight: "2px solid rgb(var(--accent-rgb) / 0.3)",
              borderBottom: "2px solid rgb(var(--accent-rgb) / 0.3)",
              borderLeft: "2px solid rgb(var(--accent-rgb) / 0.3)",
              borderRadius: "50%",
              animation: "spin 0.9s linear infinite",
              margin: "0 auto 16px",
            }}
          />
          <p
            style={{
              fontSize: "13px",
              color: "#64748b",
              fontFamily: "Inter, system-ui, sans-serif",
            }}
          >
            Securing session…
          </p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#0F0F0F",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderTop: "2px solid var(--color-accent-base)",
              borderRight: "2px solid rgb(var(--accent-rgb) / 0.3)",
              borderBottom: "2px solid rgb(var(--accent-rgb) / 0.3)",
              borderLeft: "2px solid rgb(var(--accent-rgb) / 0.3)",
              borderRadius: "50%",
              animation: "spin 0.9s linear infinite",
              margin: "0 auto 16px",
            }}
          />
          <p
            style={{
              fontSize: "13px",
              color: "#64748b",
              fontFamily: "Inter, system-ui, sans-serif",
            }}
          >
            Loading contest...
          </p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#030816",
          padding: "24px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "560px",
            borderRadius: "16px",
            border: "1px solid rgba(239,68,68,0.35)",
            background: "rgba(239,68,68,0.06)",
            padding: "20px",
            color: "#fecaca",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          <p style={{ fontSize: "15px", fontWeight: 600, marginBottom: "8px" }}>
            Contest Load Error
          </p>
          <p style={{ fontSize: "13px", color: "#fca5a5", marginBottom: "14px" }}>{loadError}</p>
          <button
            onClick={() => router.push("/home")}
            style={{
              border: "1px solid rgba(239,68,68,0.35)",
              background: "rgba(239,68,68,0.14)",
              color: "#fecaca",
              padding: "8px 12px",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            Back to contests
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "#0F0F0F",
        fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* Floating warning toast during grace period */}
      {lockGraceActive && lockGraceCountdown > 0 && (
        <div
          style={{
            position: "fixed",
            top: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: "var(--modal-z-base)",
            width: "100%",
            maxWidth: "460px",
            padding: "16px 20px",
            borderRadius: "12px",
            background: "rgba(30, 9, 9, 0.95)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(239, 68, 68, 0.4)",
            boxShadow: "0 10px 40px rgba(239, 68, 68, 0.15)",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            animation: "fadeIn 250ms var(--ease-cinematic) forwards",
          }}
        >
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fca5a5"
              strokeWidth="1.8"
            >
              <path
                d="M12 9v4m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <h4
              style={{ fontSize: "13px", fontWeight: 600, color: "#fca5a5", marginBottom: "2px" }}
            >
              Restricted Application Detected
            </h4>
            <p style={{ fontSize: "11px", color: "#fca5a5", opacity: 0.8, lineHeight: 1.4 }}>
              Workspace locking in{" "}
              <span style={{ fontWeight: 700, fontFamily: "monospace", fontSize: "12px" }}>
                {lockGraceCountdown}s
              </span>
              . Please save your work immediately.
            </p>
          </div>
        </div>
      )}

      {/* ── Blocked app violation overlay ── */}
      {lockGraceActive && lockGraceCountdown === 0 && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-live="assertive"
          aria-labelledby="blocked-app-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: "var(--modal-z-critical)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(2,4,10,0.9)",
            backdropFilter: "blur(16px)",
          }}
        >
          <div
            ref={lockViolationDialogRef}
            tabIndex={-1}
            style={{
              maxWidth: "440px",
              width: "100%",
              borderRadius: "20px",
              padding: "36px 32px",
              background: "rgba(30,9,9,0.4)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              boxShadow: "0 0 60px rgba(239, 68, 68, 0.12)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px",
              }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#f87171"
                strokeWidth="1.8"
              >
                <path
                  d="M12 9v4m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p
              id="blocked-app-title"
              style={{
                fontSize: "17px",
                fontWeight: 600,
                color: "#fca5a5",
                marginBottom: "8px",
                letterSpacing: "-0.01em",
              }}
            >
              Restricted Application Detected
            </p>
            <p
              style={{ fontSize: "13px", color: "#94a3b8", marginBottom: "24px", lineHeight: 1.6 }}
            >
              To maintain exam security, please close the applications listed below.
            </p>
            <div style={{ marginBottom: "24px" }}>
              {blockedApps.map((app) => (
                <div
                  key={app}
                  style={{
                    padding: "10px 16px",
                    marginBottom: "8px",
                    borderRadius: "10px",
                    background: "rgba(239, 68, 68, 0.06)",
                    border: "1px solid rgba(239, 68, 68, 0.15)",
                    fontSize: "14px",
                    color: "#f87171",
                    fontWeight: 500,
                  }}
                >
                  {app}
                </div>
              ))}
            </div>
            <p style={{ fontSize: "12px", color: "#475569" }}>
              This dialog will dismiss automatically once the app is closed.
            </p>
          </div>
        </div>
      )}

      {/* ── Top bar ── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          height: "52px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
          background: "#0F0F0F",
          flexShrink: 0,
          boxShadow: "none",
          gap: "16px",
        }}
      >
        {/* Left: Logo + contest title */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
          <svg width="28" height="24" viewBox="0 0 172 164" fill="none">
            <path
              d="M2 162L87 2L172 162"
              stroke="url(#tg)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <defs>
              <linearGradient
                id="tg"
                x1="2"
                y1="82"
                x2="172"
                y2="82"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#7B00FF" />
                <stop offset="0.5" stopColor="#C649F0" />
                <stop offset="1" stopColor="#E365FF" />
              </linearGradient>
            </defs>
          </svg>
          <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.1)" }} />
          <span
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: "#ffffff",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "260px",
            }}
          >
            {contest?.title ?? "Contest"}
          </span>
        </div>

        {/* Center: Timer */}
        <CountdownBadge endAt={contest?.end_at ?? fallbackEndAt} onExpiry={handleContestExpiry} />

        {/* Right: Submit */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            type="button"
            onClick={() => setShowSupportModal(true)}
            className="ic-btn"
            title="Request support"
            aria-label="Request support"
            style={{ color: "#71717a" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#71717a";
            }}
          >
            <LifeBuoy size={18} strokeWidth={1.75} />
          </button>

          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setSubmitConfirm(true)}
              className="ic-btn"
              title="Submit & exit contest"
              aria-label="Submit and exit contest"
              style={{ color: "#71717a" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#71717a";
              }}
            >
              <LogOut size={18} strokeWidth={1.75} />
            </button>
            {submitConfirm && (
              <div
                role="dialog"
                aria-modal="false"
                aria-label="Confirm contest submission"
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  zIndex: "var(--modal-z-base)",
                  width: "260px",
                  padding: "12px",
                  border: "1px solid rgba(239,68,68,0.45)",
                  background: "#160b0b",
                  boxShadow: "0 18px 44px rgba(0,0,0,0.35)",
                }}
              >
                <p
                  style={{
                    margin: "0 0 10px",
                    color: "#fecaca",
                    fontSize: "12px",
                    lineHeight: 1.45,
                  }}
                >
                  Submit final answers and exit the contest? This cannot be undone.
                </p>
                {submitError && (
                  <p
                    style={{
                      margin: "0 0 10px",
                      color: "#fca5a5",
                      fontSize: "11px",
                      lineHeight: 1.35,
                    }}
                  >
                    {submitError}
                  </p>
                )}
                <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSubmitConfirm(false);
                      setSubmitError(null);
                    }}
                    style={{
                      padding: "6px 10px",
                      border: "1px solid #334155",
                      background: "transparent",
                      color: "#cbd5e1",
                      cursor: "pointer",
                      fontSize: "11px",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitConfirmed}
                    disabled={saving}
                    style={{
                      padding: "6px 10px",
                      border: "1px solid #ef4444",
                      background: "rgba(239,68,68,0.16)",
                      color: "#fecaca",
                      cursor: saving ? "not-allowed" : "pointer",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    {saving ? "Saving..." : "Confirm"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", background: "#0F0F0F" }}>
        {/* Question list sidebar */}
        <aside
          style={{
            width: sidebarCollapsed ? "52px" : "220px",
            flexShrink: 0,
            borderRight: "1px solid rgba(255, 255, 255, 0.05)",
            display: "flex",
            flexDirection: "column",
            background: "#0F0F0F",
            boxShadow: "none",
            overflow: "hidden",
            transition: "width 250ms",
          }}
        >
          <div
            style={{
              padding: sidebarCollapsed ? "14px 0" : "14px 14px 8px",
              borderBottom: "1px solid #1F1F1F",
              display: "flex",
              alignItems: "center",
              justifyContent: sidebarCollapsed ? "center" : "space-between",
            }}
          >
            {!sidebarCollapsed && (
              <div style={{ minWidth: 0 }}>
                <p
                  style={{
                    fontSize: "10px",
                    color: "#64748b",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    fontFamily: "Inter, system-ui, sans-serif",
                    margin: 0,
                  }}
                >
                  Questions ({questions.length})
                </p>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: "10px",
                    color: "#94a3b8",
                    fontFamily: "Inter, system-ui, sans-serif",
                    whiteSpace: "nowrap",
                  }}
                >
                  {attemptedQuestionCount} attempted · {acceptedQuestionCount} accepted ·{" "}
                  {remainingQuestionCount} remaining
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              style={{
                background: "transparent",
                border: "none",
                color: "#64748b",
                cursor: "pointer",
                padding: "2px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title={sidebarCollapsed ? "Expand questions list" : "Collapse questions list"}
            >
              {sidebarCollapsed ? (
                <ChevronRight size={14} strokeWidth={2} />
              ) : (
                <ChevronLeft size={14} strokeWidth={2} />
              )}
            </button>
          </div>
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            {questions.length === 0 && !sidebarCollapsed && (
              <p
                style={{
                  fontSize: "12px",
                  color: "#475569",
                  textAlign: "center",
                  marginTop: "24px",
                  fontFamily: "Inter, system-ui, sans-serif",
                }}
              >
                No questions
              </p>
            )}
            {questions.map((q, i) => {
              const qStatus = questionStatusMap[q.id];
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => switchQuestion(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: sidebarCollapsed ? "center" : "flex-start",
                    width: "100%",
                    padding: sidebarCollapsed ? "8px 0" : "10px 12px",
                    borderRadius: "var(--radius-md)",
                    border: `1px solid ${activeQ === i ? "rgb(var(--accent-rgb) / 0.5)" : "transparent"}`,
                    background: activeQ === i ? "rgb(var(--accent-rgb) / 0.08)" : "transparent",
                    cursor: "pointer",
                    fontFamily: "Inter, system-ui, sans-serif",
                    textAlign: "left",
                    color: activeQ === i ? "var(--color-accent-light)" : "var(--text-dim)",
                    transition:
                      "background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast)",
                    position: "relative",
                  }}
                  title={`${q.title} · ${qStatus.label}`}
                >
                  {sidebarCollapsed ? (
                    <span
                      style={{
                        width: "30px",
                        height: "30px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "var(--radius-sm)",
                        border: `1px solid ${activeQ === i ? "rgb(var(--accent-rgb) / 0.35)" : qStatus.border}`,
                        background: activeQ === i ? "rgb(var(--accent-rgb) / 0.1)" : qStatus.bg,
                        fontSize: "12px",
                        fontWeight: 700,
                        color: activeQ === i ? "var(--color-accent-light)" : qStatus.color,
                      }}
                    >
                      {i + 1}
                    </span>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        width: "100%",
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          color: activeQ === i ? "var(--color-accent-light)" : "var(--text-dim)",
                          flexShrink: 0,
                        }}
                      >
                        {i + 1}
                      </span>
                      <span
                        style={{
                          width: "9px",
                          height: "9px",
                          borderRadius: "var(--radius-pill)",
                          background: qStatus.color,
                          color: qStatus.color,
                          // Always-on glow so status reads at a glance, not only when active.
                          boxShadow: "0 0 6px currentColor",
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 500,
                          color: activeQ === i ? "#ffffff" : "var(--text-soft)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        {q.title}
                      </span>
                      <span
                        style={{
                          padding: "2px 6px",
                          borderRadius: "var(--radius-sm)",
                          border: `1px solid ${qStatus.border}`,
                          background: qStatus.bg,
                          color: qStatus.color,
                          fontSize: "9px",
                          fontWeight: 700,
                          fontFamily: "Inter, system-ui, sans-serif",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {qStatus.shortLabel}
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Docked Camera feed */}
          <div
            style={{
              borderTop: "1px solid #1F1F1F",
              background: "#0F0F0F",
              position: "relative",
              flexShrink: 0,
              display: (cameraStream ?? cameraError) ? "flex" : "none",
              flexDirection: "column",
            }}
          >
            {!sidebarCollapsed && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "6px",
                  gap: "6px",
                  borderBottom: "1px solid #1F1F1F",
                }}
              >
                <button
                  type="button"
                  onClick={() => handleToggleMedia("camera", !cameraEnabled)}
                  className={`ic-btn ${cameraEnabled ? "ic-btn-white" : "ic-btn-red"}`}
                  title={
                    cameraEnabled
                      ? "Camera on — click to turn off"
                      : "Camera off — click to turn on"
                  }
                  aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"}
                >
                  {cameraEnabled ? (
                    <Video size={15} strokeWidth={1.75} />
                  ) : (
                    <VideoOff size={15} strokeWidth={1.75} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleMedia("mic", !micEnabled)}
                  className={`ic-btn ${micEnabled ? "ic-btn-white" : "ic-btn-red"}`}
                  title={
                    micEnabled
                      ? "Microphone on — click to turn off"
                      : "Microphone off — click to turn on"
                  }
                  aria-label={micEnabled ? "Turn microphone off" : "Turn microphone on"}
                >
                  {micEnabled ? (
                    <Mic size={15} strokeWidth={1.75} />
                  ) : (
                    <MicOff size={15} strokeWidth={1.75} />
                  )}
                </button>
              </div>
            )}
            <div
              style={{
                width: "100%",
                height: sidebarCollapsed ? "52px" : "150px",
                border: "none",
                boxSizing: "border-box",
                position: "relative",
              }}
            >
              <video
                ref={cameraVideoRef}
                muted
                playsInline
                autoPlay
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transform: "scaleX(-1)",
                  display: sidebarCollapsed ? "none" : "block",
                  borderRadius: "0",
                }}
              />
              {sidebarCollapsed && (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: cameraHealthy ? "#22c55e" : cameraError ? "#ef4444" : "#f59e0b",
                    }}
                  />
                </div>
              )}
            </div>

            {!sidebarCollapsed && (
              <div
                style={{
                  position: "absolute",
                  bottom: "8px",
                  left: "8px",
                  padding: "2px 4px",
                  background: "#0F0F0F",
                  border: "1px solid #1F1F1F",
                  fontSize: "9px",
                  color: !cameraEnabled
                    ? "#94a3b8"
                    : cameraHealthy
                      ? "#94a3b8"
                      : cameraError
                        ? "#ef4444"
                        : "#f59e0b",
                  fontFamily: "Inter, system-ui, sans-serif",
                  fontWeight: 600,
                }}
              >
                {!cameraEnabled
                  ? "Cam off"
                  : cameraHealthy
                    ? "Camera active"
                    : cameraError
                      ? "Camera issue"
                      : "Camera starting"}
              </div>
            )}
          </div>
        </aside>

        {questions[activeQ]?.question_type === "follow_up" ? (
          <FollowUpPane
            question={questions[activeQ]!}
            sessionId={sessionId ?? ""}
            apiUrl={API_URL}
            questionLetter={String.fromCharCode(65 + (questions[activeQ]?.order_index ?? 0))}
            partStates={followUpState[questions[activeQ]?.id ?? ""] ?? {}}
            onPartUpdate={(partIndex, patch) =>
              updateFollowUpPart(questions[activeQ]?.id ?? "", partIndex, patch)
            }
          />
        ) : questions[activeQ]?.question_type === "markov" ? (
          <MarkovPane
            question={questions[activeQ]!}
            sessionId={sessionId ?? ""}
            apiUrl={API_URL}
            questionLetter={String.fromCharCode(65 + (questions[activeQ]?.order_index ?? 0))}
          />
        ) : (
          <>
            {/* Middle pane: Problem Description */}
            <div
              style={{
                width: `${problemPaneWidth}%`,
                minWidth: "320px",
                maxWidth: "680px",
                display: "flex",
                flexDirection: "column",
                borderRight: "1px solid rgba(255, 255, 255, 0.05)",
                background: "#0F0F0F",
                boxShadow: "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: "1px solid #1F1F1F",
                  background: "#0F0F0F",
                  padding: "0 18px",
                  flexShrink: 0,
                  height: "42px",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--text-dim)",
                    letterSpacing: "0.06em",
                    fontFamily: "Inter, system-ui, sans-serif",
                    fontWeight: 700,
                  }}
                >
                  Problem
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--text-dim)",
                    fontFamily: "Inter, system-ui, sans-serif",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {Math.round(problemPaneWidth)}%
                </span>
              </div>

              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  color: "#e2e8f0",
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                {availableProblemTabs.length > 1 && (
                  <div
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 5,
                      display: "flex",
                      alignItems: "center",
                      height: "38px",
                      padding: "0 24px",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                      background: "rgba(15,15,15,0.96)",
                      backdropFilter: "blur(12px)",
                    }}
                  >
                    {availableProblemTabs.map((tab) => {
                      const active = activeProblemTab === tab;
                      const label =
                        tab === "statement"
                          ? "Statement"
                          : tab === "examples"
                            ? "Examples"
                            : "Constraints";
                      return (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setProblemTab(tab)}
                          style={{
                            height: "100%",
                            padding: "0 12px",
                            borderRadius: 0,
                            border: "none",
                            borderBottom: `2px solid ${active ? "var(--color-accent-base)" : "transparent"}`,
                            background: "transparent",
                            color: active ? "var(--color-accent-light)" : "var(--text-dim)",
                            fontSize: "12px",
                            fontWeight: 600,
                            fontFamily: "Inter, system-ui, sans-serif",
                            cursor: "pointer",
                            transition:
                              "color var(--transition-fast), border-color var(--transition-fast)",
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <article style={{ padding: "28px 28px 34px", maxWidth: "760px" }}>
                  <p
                    style={{
                      margin: "0 0 8px",
                      fontSize: "12px",
                      color: "var(--color-accent-base)",
                      fontWeight: 700,
                      fontFamily: "Inter, system-ui, sans-serif",
                    }}
                  >
                    Problem {String.fromCharCode(65 + (questions[activeQ]?.order_index ?? activeQ))}
                  </p>
                  <h1
                    style={{
                      margin: "0 0 22px",
                      color: "#f8fafc",
                      fontSize: "var(--text-xl)",
                      lineHeight: 1.3,
                      fontWeight: 700,
                      fontFamily: "Inter, system-ui, sans-serif",
                      letterSpacing: 0,
                    }}
                  >
                    {questions[activeQ]?.title}
                  </h1>
                  <div
                    className="pb-body pb-body-editorial"
                    onClick={handleProblemBodyClick}
                    dangerouslySetInnerHTML={{ __html: problemBodyHtml }}
                  />
                </article>
              </div>
            </div>

            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize problem and editor panes"
              title="Drag to resize"
              onMouseDown={handleProblemSplitMouseDown}
              onMouseEnter={(e) => {
                const bar = e.currentTarget.querySelector<HTMLDivElement>("[data-split-bar]");
                if (bar) {
                  bar.style.width = "3px";
                  bar.style.background = "rgb(var(--accent-rgb) / 0.6)";
                }
              }}
              onMouseLeave={(e) => {
                const bar = e.currentTarget.querySelector<HTMLDivElement>("[data-split-bar]");
                if (bar) {
                  bar.style.width = "2px";
                  bar.style.background = "rgba(255,255,255,0.14)";
                }
              }}
              style={{
                width: "10px",
                flexShrink: 0,
                cursor: "col-resize",
                background: "#0F0F0F",
                borderRight: "1px solid rgba(255,255,255,0.05)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* A single 2px·16px grab bar that thickens + brightens on hover,
                  replacing the near-invisible 5-dot column. */}
              <div
                data-split-bar
                style={{
                  width: "2px",
                  height: "16px",
                  borderRadius: "var(--radius-pill)",
                  background: "rgba(255,255,255,0.14)",
                  pointerEvents: "none",
                  transition:
                    "width var(--transition-fast), background-color var(--transition-fast)",
                }}
              />
            </div>

            {/* Right panel: Editor (Top) + Terminal (Bottom) */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                background: "#0F0F0F",
                minWidth: 0,
              }}
            >
              {/* Top Right: Code Editor */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
                  boxShadow: "none",
                }}
              >
                {/* Editor Tabs & Header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    borderBottom: "1px solid #1F1F1F",
                    background: "#0F0F0F",
                    padding: "0 12px",
                    gap: "4px",
                    flexShrink: 0,
                    height: "38px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#64748b",
                      letterSpacing: "0.06em",
                      fontFamily: "Inter, system-ui, sans-serif",
                      fontWeight: 700,
                      marginRight: "12px",
                    }}
                  >
                    Editor
                  </span>
                  {editorFiles.map((file) => {
                    const isActive = activeFileId === file.id;
                    const isScratch = !file.id.endsWith(":main");
                    const pendingClose = pendingCloseFileId === file.id;
                    return (
                      <div
                        key={file.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          border: "1px solid",
                          borderColor: isActive ? "#1F1F1F" : "transparent",
                          borderBottom: "none",
                          background: isActive ? "#1F1F1F" : "transparent",
                          borderRadius: "8px 8px 0 0",
                          height: "100%",
                          flexShrink: 0,
                          position: "relative",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setPendingCloseFileId(null);
                            setQuestionActiveFile((prev) => ({ ...prev, [currentQId]: file.id }));
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            padding: isScratch ? "0 6px 0 12px" : "0 16px",
                            background: "transparent",
                            border: "none",
                            color: isActive ? "#ffffff" : "#475569",
                            fontSize: "11px",
                            fontWeight: 600,
                            fontFamily: "'JetBrains Mono', monospace",
                            cursor: "pointer",
                            height: "100%",
                            maxWidth: "160px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={file.name}
                        >
                          {file.name}
                        </button>
                        {isScratch && !pendingClose && (
                          <button
                            type="button"
                            aria-label={`Close ${file.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingCloseFileId(file.id);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: "16px",
                              height: "16px",
                              marginRight: "6px",
                              border: "none",
                              background: "transparent",
                              color: "#475569",
                              fontSize: "12px",
                              lineHeight: 1,
                              cursor: "pointer",
                              borderRadius: "8px",
                              flexShrink: 0,
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.color = "#475569";
                            }}
                          >
                            <X size={12} strokeWidth={2} />
                          </button>
                        )}
                        {isScratch && pendingClose && (
                          <div
                            role="dialog"
                            aria-label={`Close ${file.name}`}
                            style={{
                              position: "absolute",
                              top: "32px",
                              right: "4px",
                              zIndex: 20,
                              width: "190px",
                              padding: "10px",
                              border: "1px solid rgba(245,158,11,0.28)",
                              borderRadius: "8px",
                              background: "#111111",
                              boxShadow: "0 14px 34px rgba(0,0,0,0.38)",
                            }}
                          >
                            <p
                              style={{
                                margin: "0 0 8px",
                                fontSize: "11px",
                                color: "#cbd5e1",
                                fontFamily: "Inter, system-ui, sans-serif",
                                lineHeight: 1.35,
                              }}
                            >
                              Close this scratch file?
                            </p>
                            <div
                              style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}
                            >
                              <button
                                type="button"
                                aria-label="Cancel close"
                                title="Cancel"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPendingCloseFileId(null);
                                }}
                                style={{
                                  width: "32px",
                                  height: "32px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  border: "1px solid rgba(148,163,184,0.18)",
                                  borderRadius: "6px",
                                  background: "transparent",
                                  color: "#94a3b8",
                                  cursor: "pointer",
                                }}
                              >
                                <X size={14} strokeWidth={2} />
                              </button>
                              <button
                                type="button"
                                aria-label="Confirm close"
                                title="Close file"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPendingCloseFileId(null);
                                  removeEditorFile(file.id);
                                }}
                                style={{
                                  width: "32px",
                                  height: "32px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  border: "1px solid rgba(34,197,94,0.3)",
                                  borderRadius: "6px",
                                  background: "rgba(34,197,94,0.1)",
                                  color: "#86efac",
                                  cursor: "pointer",
                                }}
                              >
                                <Check size={14} strokeWidth={2} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={addEditorFile}
                    aria-label="Create new C++ file tab"
                    title="Create new C++ file tab"
                    style={{
                      width: "32px",
                      height: "32px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px solid #1F1F1F",
                      borderRadius: "6px",
                      background: "#0F0F0F",
                      color: "#94a3b8",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <Plus size={14} strokeWidth={2} />
                  </button>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginLeft: "10px",
                      color: "var(--text-dim)",
                      fontSize: "12px",
                      fontWeight: 600,
                      fontFamily: "Inter, system-ui, sans-serif",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Language
                    <select
                      aria-label="Programming language"
                      value={selectedLanguage}
                      onChange={(e) => handleLanguageChange(e.target.value)}
                      style={{
                        height: "32px",
                        border: "1px solid #1F1F1F",
                        borderRadius: "var(--radius-sm)",
                        background: "#0F0F0F",
                        color: "var(--text-soft)",
                        fontSize: "12px",
                        // The current language reads as instrument/system text.
                        fontFamily: "'JetBrains Mono', monospace",
                        padding: "0 9px",
                        cursor: "pointer",
                      }}
                    >
                      {(contest?.allowed_languages?.length
                        ? contest.allowed_languages
                        : ["C++17"]
                      ).map((lang) => (
                        <option key={lang} value={lang}>
                          {lang}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div style={{ flex: 1 }} />
                  <div
                    role="status"
                    aria-live="polite"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      color: saveIndicator.color,
                      fontSize: "11px",
                      fontWeight: 600,
                      fontFamily: "Inter, system-ui, sans-serif",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {saveIndicator.icon === "loading" ? (
                      <Loader2
                        size={12}
                        strokeWidth={2}
                        style={{ animation: "spin 0.8s linear infinite" }}
                      />
                    ) : saveIndicator.icon === "error" ? (
                      <AlertCircle size={12} strokeWidth={2} />
                    ) : saveIndicator.icon === "saved" ? (
                      <Check size={12} strokeWidth={2} />
                    ) : (
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: "currentColor",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    {saveIndicator.label}
                  </div>
                </div>

                {/* Execution control strip */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0 12px",
                    gap: "0",
                    height: "48px",
                    background: "#0a0a0a",
                    borderBottom: "1px solid #1F1F1F",
                    flexShrink: 0,
                  }}
                >
                  <div style={{ flex: 1 }} />
                  {/* Settings group */}
                  <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setThemeMenuOpen((open) => !open)}
                      aria-label="Editor settings"
                      title="Editor settings"
                      style={{
                        width: "34px",
                        height: "34px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "1px solid rgba(148,163,184,0.18)",
                        borderRadius: "var(--radius-sm)",
                        background: "rgba(148,163,184,0.06)",
                        color: "#94a3b8",
                        cursor: "pointer",
                      }}
                    >
                      <Settings2 size={15} strokeWidth={1.9} />
                    </button>
                    {themeMenuOpen && (
                      <div
                        role="menu"
                        aria-label="Editor theme"
                        style={{
                          position: "absolute",
                          right: 0,
                          top: "calc(100% + 8px)",
                          zIndex: 30,
                          width: "210px",
                          padding: "8px",
                          border: "1px solid rgba(148,163,184,0.16)",
                          borderRadius: "8px",
                          background: "#111111",
                          boxShadow: "0 16px 40px rgba(0,0,0,0.38)",
                        }}
                      >
                        <p
                          style={{
                            margin: "2px 4px 8px",
                            color: "#64748b",
                            fontSize: "11px",
                            fontFamily: "Inter, system-ui, sans-serif",
                            fontWeight: 600,
                          }}
                        >
                          Editor theme
                        </p>
                        {CONTEST_EDITOR_THEMES.map((theme) => {
                          const active = editorTheme === theme.id;
                          return (
                            <button
                              key={theme.id}
                              type="button"
                              role="menuitemradio"
                              aria-checked={active}
                              onClick={() => handleEditorThemeChange(theme.id)}
                              style={{
                                width: "100%",
                                minHeight: "32px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: "8px",
                                padding: "0 8px",
                                border: "none",
                                borderRadius: "6px",
                                background: active
                                  ? "rgb(var(--accent-rgb) / 0.12)"
                                  : "transparent",
                                color: active ? "#d8b4fe" : "#cbd5e1",
                                fontSize: "12px",
                                fontFamily: "Inter, system-ui, sans-serif",
                                cursor: "pointer",
                                textAlign: "left",
                              }}
                            >
                              <span>{theme.label}</span>
                              {active && <Check size={13} strokeWidth={2} />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {/* Separator: settings | primary actions */}
                  <div
                    style={{
                      width: "1px",
                      height: "22px",
                      background: "rgba(255,255,255,0.08)",
                      margin: "0 12px",
                      flexShrink: 0,
                    }}
                  />
                  {/* Primary actions group: Run + Submit */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <button
                      type="button"
                      onClick={() => void triggerRun()}
                      disabled={isRunning || !sessionId}
                      title="Runs your code against the sample tests only — does not count toward your score."
                      aria-label="Run on judge"
                      style={{
                        height: "40px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        padding: "0 16px",
                        border: `1px solid ${isRunning || !sessionId ? "rgba(148,163,184,0.14)" : "rgba(148,163,184,0.22)"}`,
                        borderRadius: "var(--radius-sm)",
                        background: "transparent",
                        color: isRunning || !sessionId ? "rgba(203,213,225,0.48)" : "#cbd5e1",
                        fontSize: "13px",
                        fontWeight: 500,
                        fontFamily: "Inter, system-ui, sans-serif",
                        cursor: isRunning || !sessionId ? "not-allowed" : "pointer",
                        opacity: isRunning || !sessionId ? 0.75 : 1,
                        transition:
                          "background 150ms ease, border-color 150ms ease, color 150ms ease, transform 120ms ease",
                      }}
                      onMouseEnter={(e) => {
                        if (isRunning || !sessionId) return;
                        e.currentTarget.style.background = "rgba(148,163,184,0.16)";
                        e.currentTarget.style.borderColor = "rgba(203,213,225,0.34)";
                      }}
                      onMouseLeave={(e) => {
                        if (isRunning || !sessionId) return;
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.borderColor = "rgba(148,163,184,0.22)";
                        e.currentTarget.style.transform = "scale(1)";
                      }}
                      onMouseDown={(e) => {
                        if (!isRunning && sessionId)
                          e.currentTarget.style.transform = "scale(0.98)";
                      }}
                      onMouseUp={(e) => {
                        e.currentTarget.style.transform = "scale(1)";
                      }}
                    >
                      {isRunning ? (
                        <Loader2
                          size={15}
                          strokeWidth={2}
                          style={{ animation: "spin 0.8s linear infinite" }}
                        />
                      ) : (
                        <Play size={15} strokeWidth={2} />
                      )}
                      {isRunning ? "Running" : "Run on Judge"}
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmitSolution}
                      disabled={saving || isSubmitting}
                      title={
                        isSubmitting
                          ? "Submitting…"
                          : saving
                            ? "Saving your code — submit will be ready in a moment"
                            : "Submit your solution for scoring"
                      }
                      style={{
                        height: "40px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        padding: "0 22px",
                        border: `1px solid ${saving || isSubmitting ? "rgb(var(--accent-rgb) / 0.24)" : "var(--color-accent-base)"}`,
                        borderRadius: "var(--radius-md)",
                        background:
                          saving || isSubmitting
                            ? "rgb(var(--accent-rgb) / 0.14)"
                            : "var(--color-accent-base)",
                        color: saving || isSubmitting ? "rgba(255,255,255,0.58)" : "#ffffff",
                        fontSize: "13px",
                        fontWeight: 600,
                        fontFamily: "Inter, system-ui, sans-serif",
                        cursor: saving || isSubmitting ? "not-allowed" : "pointer",
                        opacity: saving || isSubmitting ? 0.82 : 1,
                        boxShadow: "none",
                        transition:
                          "background-color var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast)",
                      }}
                      onMouseEnter={(e) => {
                        if (saving || isSubmitting) return;
                        // Dominant: lighten + lift + accent glow so Submit never reads
                        // as a peer of the quiet outline Run button.
                        e.currentTarget.style.background =
                          "color-mix(in srgb, var(--color-accent-base), #fff 12%)";
                        e.currentTarget.style.borderColor = "var(--color-accent-light)";
                        e.currentTarget.style.transform = "translateY(-1px) scale(1.02)";
                        e.currentTarget.style.boxShadow =
                          "0 4px 14px rgb(var(--accent-rgb) / 0.35)";
                      }}
                      onMouseLeave={(e) => {
                        if (saving || isSubmitting) return;
                        e.currentTarget.style.background = "var(--color-accent-base)";
                        e.currentTarget.style.borderColor = "var(--color-accent-base)";
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                      onMouseDown={(e) => {
                        if (!saving && !isSubmitting)
                          e.currentTarget.style.transform = "translateY(0) scale(0.98)";
                      }}
                      onMouseUp={(e) => {
                        if (!saving && !isSubmitting)
                          e.currentTarget.style.transform = "translateY(-1px) scale(1.02)";
                      }}
                    >
                      {isSubmitting || saving ? (
                        <Loader2
                          size={15}
                          strokeWidth={2}
                          style={{ animation: "spin 0.8s linear infinite" }}
                        />
                      ) : (
                        <Send size={15} strokeWidth={2} />
                      )}
                      {isSubmitting
                        ? "Submitting"
                        : saving
                          ? "Saving"
                          : submissionError
                            ? "Submit Failed"
                            : "Submit Solution"}
                    </button>
                  </div>
                  {/* end primary actions group */}
                </div>

                {submissionError && (
                  <div
                    role="status"
                    style={{
                      padding: "6px 12px",
                      borderBottom: "1px solid rgba(239,68,68,0.2)",
                      color: "#fca5a5",
                      background: "rgba(239,68,68,0.06)",
                      fontSize: "11px",
                      fontFamily: "Inter, system-ui, sans-serif",
                    }}
                  >
                    {submissionError}
                  </div>
                )}

                {saveError && (
                  <div
                    role="status"
                    style={{
                      padding: "6px 12px",
                      borderBottom: "1px solid rgba(239,68,68,0.2)",
                      color: "#fca5a5",
                      background: "rgba(239,68,68,0.06)",
                      fontSize: "11px",
                      fontFamily: "Inter, system-ui, sans-serif",
                    }}
                  >
                    {saveError}
                  </div>
                )}

                {/* Editor Textarea */}
                <EditorPane
                  activeQ={activeQ}
                  activeTab={activeFile?.name ?? "main.cpp"}
                  currentCode={currentCode}
                  onCodeChange={handleCodeChange}
                  editorTheme={editorTheme}
                  selectedLanguage={selectedLanguage}
                  problemId={currentQId}
                />
              </div>

              {/* Bottom Right: Terminal */}
              <div
                style={{
                  height: "30%",
                  minHeight: "200px",
                  display: "flex",
                  flexDirection: "column",
                  background: "#0F0F0F",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    borderBottom: shouldShowRunProgress ? "none" : "1px solid #1F1F1F",
                    background: "#0F0F0F",
                    padding: "0 16px",
                    flexShrink: 0,
                    height: "38px",
                    gap: "16px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setTerminalTab("stdout")}
                    style={{
                      fontSize: "12px",
                      color: terminalTab === "stdout" ? "var(--color-accent-light)" : "#64748b",
                      background: "transparent",
                      border: "none",
                      borderBottom:
                        terminalTab === "stdout"
                          ? "2px solid var(--color-accent-base)"
                          : "2px solid transparent",
                      fontFamily: "Inter, system-ui, sans-serif",
                      fontWeight: 600,
                      cursor: "pointer",
                      height: "100%",
                      padding: "0 4px",
                    }}
                  >
                    Output
                  </button>
                  <button
                    type="button"
                    onClick={() => setTerminalTab("logs")}
                    style={{
                      fontSize: "12px",
                      color: terminalTab === "logs" ? "var(--color-accent-light)" : "#64748b",
                      background: "transparent",
                      border: "none",
                      borderBottom:
                        terminalTab === "logs"
                          ? "2px solid var(--color-accent-base)"
                          : "2px solid transparent",
                      fontFamily: "Inter, system-ui, sans-serif",
                      fontWeight: 600,
                      cursor: "pointer",
                      height: "100%",
                      padding: "0 4px",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                      Compiler output
                      {runResult?.status === "CE" && (
                        <span
                          style={{
                            padding: "1px 5px",
                            borderRadius: "var(--radius-pill)",
                            background: "rgba(167,139,250,0.16)",
                            color: "var(--verdict-ce)",
                            fontSize: "9px",
                            fontWeight: 700,
                          }}
                        >
                          CE
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTerminalTab("submissions")}
                    style={{
                      fontSize: "12px",
                      color:
                        terminalTab === "submissions" ? "var(--color-accent-light)" : "#64748b",
                      background: "transparent",
                      border: "none",
                      borderBottom:
                        terminalTab === "submissions"
                          ? "2px solid var(--color-accent-base)"
                          : "2px solid transparent",
                      fontFamily: "Inter, system-ui, sans-serif",
                      fontWeight: 600,
                      cursor: "pointer",
                      height: "100%",
                      padding: "0 4px",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                      Attempts
                      {submissionsList.length > 0 && (
                        <span
                          style={{
                            padding: "1px 6px",
                            borderRadius: "999px",
                            background:
                              terminalTab === "submissions"
                                ? "rgb(var(--accent-rgb) / 0.16)"
                                : "rgba(148,163,184,0.1)",
                            color: terminalTab === "submissions" ? "#d8b4fe" : "#94a3b8",
                            fontSize: "9px",
                            fontWeight: 700,
                          }}
                        >
                          {submissionsList.length}
                        </span>
                      )}
                    </span>
                  </button>
                  <div style={{ flex: 1 }} />
                  {latestAttempt && (
                    <div
                      title="Latest judge verdict"
                      style={{
                        height: "24px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "0 9px",
                        borderRadius: "999px",
                        border: "1px solid rgba(148,163,184,0.14)",
                        background: "rgba(148,163,184,0.06)",
                        color: "#94a3b8",
                        fontSize: "11px",
                        fontWeight: 600,
                        fontFamily: "Inter, system-ui, sans-serif",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Latest
                      {(() => {
                        const latestCode = (latestAttempt.final_verdict ??
                          latestAttempt.status) as VerdictCode;
                        // key by attempt+code so the reveal re-fires even when two consecutive
                        // attempts resolve to the same verdict (e.g. AC → AC).
                        return (
                          <VerdictBadge
                            key={`${latestAttempt?.id ?? ""}-${String(latestCode)}`}
                            variant="chip"
                            code={latestCode}
                            reveal
                          />
                        );
                      })()}
                    </div>
                  )}
                  {runStatus && (
                    <div
                      role="status"
                      aria-live="polite"
                      style={{
                        height: "24px",
                        display: "flex",
                        alignItems: "center",
                        gap: "7px",
                        padding: "0 10px",
                        borderRadius: "999px",
                        border: `1px solid ${runStatus.border}`,
                        background: runStatus.bg,
                        color: runStatus.color,
                        fontSize: "11px",
                        fontWeight: 700,
                        fontFamily: "Inter, system-ui, sans-serif",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {runStatus.icon === "loading" ? (
                        <Loader2
                          size={12}
                          strokeWidth={2}
                          style={{ animation: "spin 0.8s linear infinite" }}
                        />
                      ) : (
                        // Neutral status dot in the verdict colour — no tick/cross glyphs.
                        <span
                          style={{
                            width: "7px",
                            height: "7px",
                            borderRadius: "var(--radius-pill)",
                            background: runStatus.color,
                            flexShrink: 0,
                          }}
                        />
                      )}
                      {runStatus.label}
                      {runMetrics && (
                        <span style={{ color: "#94a3b8", fontWeight: 600 }}>· {runMetrics}</span>
                      )}
                    </div>
                  )}
                </div>
                {shouldShowRunProgress && (
                  <div
                    style={{
                      height: "34px",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "0 16px",
                      borderTop: "1px solid #1F1F1F",
                      borderBottom: "1px solid #1F1F1F",
                      background: "#0a0a0a",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: "11px",
                        letterSpacing: "0.06em",
                        display: "flex",
                        alignItems: "center",
                        gap: "0",
                        userSelect: "none",
                      }}
                    >
                      {runProgressSteps.map((step, index) => {
                        const current = index === runProgressPhase;
                        const label = step.toUpperCase();
                        return (
                          <span key={step} style={{ display: "flex", alignItems: "center" }}>
                            <span
                              style={{
                                color: current ? "#ffffff" : "#71717a",
                                fontWeight: current ? 600 : 400,
                              }}
                            >
                              {current && index === 2 ? (
                                <span
                                  style={{
                                    ["--_running" as string]: "1",
                                  }}
                                >
                                  <style>{`
                                    @media (prefers-reduced-motion: no-preference) {
                                      @keyframes _ams_ellipsis {
                                        0%,100% { opacity: 1; }
                                        50% { opacity: 0.3; }
                                      }
                                      ._ams_running_ellipsis::after {
                                        content: '…';
                                        animation: _ams_ellipsis 1.2s ease-in-out infinite;
                                        display: inline-block;
                                      }
                                    }
                                  `}</style>
                                  <span className="_ams_running_ellipsis">{label}</span>
                                </span>
                              ) : (
                                label
                              )}
                            </span>
                            {index < runProgressSteps.length - 1 && (
                              <span style={{ color: "#71717a", margin: "0 6px" }}>{"→"}</span>
                            )}
                          </span>
                        );
                      })}
                    </span>
                  </div>
                )}
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    color: "#a8b2d1",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "12px",
                    lineHeight: 1.6,
                    background: "#0F0F0F",
                    overflowY: "auto",
                  }}
                >
                  {terminalTab === "stdout" && (
                    <div style={{ padding: "12px 16px" }}>
                      <div
                        style={{
                          color: "#64748b",
                          fontSize: "10px",
                          letterSpacing: "0.08em",
                          marginBottom: "8px",
                        }}
                      >
                        Output
                      </div>
                      {/* LeetCode-style sample results for a "Run on Judge". Runs
                          are judged against sample tests only and never appear in
                          Attempts, so this is the only place they render. Sample
                          tests may show expected-vs-got; hidden/fallback tests show
                          the verdict only (mirroring the Attempts masking). */}
                      {!isRunning && runResult?.status !== "CE" && runSampleTests && (
                        <div style={{ marginBottom: runResult?.stdout ? "12px" : "0" }}>
                          {runSampleTests.length === 0 ? (
                            <div style={{ color: "#475569" }}>
                              No sample tests to run for this problem.
                            </div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              {runSampleTests.map((tr: any, idx: number) => {
                                const isAC = tr.verdict === "AC";
                                const isSample = isSampleTestRow(tr);
                                const testNumber = tr.test_number ?? idx + 1;
                                const expected =
                                  tr.expected ?? tr.expected_output ?? tr.answer ?? null;
                                const got =
                                  tr.got_output ??
                                  tr.got ??
                                  tr.actual ??
                                  tr.output ??
                                  tr.stdout ??
                                  null;
                                return (
                                  <div
                                    key={`run-sample-${testNumber}-${idx}`}
                                    style={{
                                      whiteSpace: "pre-wrap",
                                      color: isAC ? "#86efac" : "#fca5a5",
                                    }}
                                  >
                                    <span style={{ fontWeight: 700 }}>
                                      {isSample ? "Sample" : "Test"} {testNumber}:
                                    </span>{" "}
                                    <span>{isAC ? "✓" : "✗"}</span>{" "}
                                    <span style={{ color: isAC ? "#86efac" : "#fca5a5" }}>
                                      {tr.verdict ?? (isAC ? "AC" : "Failed")}
                                    </span>
                                    {tr.runtime_ms != null && (
                                      <span style={{ color: "#64748b" }}>
                                        {` ${tr.runtime_ms}ms`}
                                      </span>
                                    )}
                                    {!isSample && (
                                      <span style={{ color: "#64748b" }}> · hidden test</span>
                                    )}
                                    {/* Expected/got only for sample tests, and
                                        only when the test failed (matches the
                                        LeetCode-style "got X expected Y"). Hidden
                                        tests never reveal expected/got. */}
                                    {!isAC && isSample && (expected != null || got != null) && (
                                      <span style={{ color: "#94a3b8" }}>
                                        {` — expected ${JSON.stringify(String(expected ?? ""))} got ${JSON.stringify(String(got ?? ""))}`}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                      {isRunning ? (
                        <div style={{ color: "#475569" }}>Running…</div>
                      ) : runResult?.status === "CE" ? (
                        <div style={{ color: "#475569" }}>Compilation failed — see Build.</div>
                      ) : runTimedOut ? (
                        <div style={{ color: "#f59e0b" }}>
                          Run is taking longer than expected — it may still be queued. Try Run
                          again.
                        </div>
                      ) : runResultAttemptId &&
                        runSampleTests === null &&
                        runResult &&
                        !isPendingSubmissionStatus(runResult.status) ? (
                        <div style={{ color: "#475569" }}>Loading sample results…</div>
                      ) : runSampleTests && runSampleTests.length > 0 ? (
                        // Sample rows above already convey the result; only add
                        // raw stdout if the judge returned any.
                        runResult?.stdout ? (
                          <div style={{ color: "#94a3b8", whiteSpace: "pre-wrap" }}>
                            {runResult.stdout}
                          </div>
                        ) : null
                      ) : runResult?.stdout ? (
                        <div style={{ color: "#94a3b8", whiteSpace: "pre-wrap" }}>
                          {runResult.stdout}
                        </div>
                      ) : runResult?.stderr ? (
                        <div style={{ color: "#f97316", whiteSpace: "pre-wrap" }}>
                          {runResult.stderr}
                        </div>
                      ) : runResult ? (
                        <div style={{ color: "#475569" }}>No output.</div>
                      ) : runError ? (
                        <div style={{ color: "#ef4444" }}>{runError}</div>
                      ) : (
                        <div style={{ color: isEditorEmpty ? "#334155" : "#475569" }}>
                          {isEditorEmpty
                            ? "Write code to prepare a run."
                            : "Run your code to see stdout and stderr."}
                        </div>
                      )}
                    </div>
                  )}

                  {terminalTab === "logs" && (
                    <div style={{ padding: "12px 16px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          marginBottom: "8px",
                        }}
                      >
                        <span
                          style={{ color: "#64748b", fontSize: "10px", letterSpacing: "0.08em" }}
                        >
                          Build
                        </span>
                        {runResult && !isRunning && (
                          <span
                            style={{
                              fontSize: "9px",
                              fontWeight: 700,
                              letterSpacing: "0.1em",
                              color: VERDICT_COLORS[runResult.status] ?? "#64748b",
                            }}
                          >
                            {runResult.status}
                            {runResult.runtime_ms != null && ` · ${runResult.runtime_ms}ms`}
                            {runResult.memory_kb != null &&
                              ` · ${Math.round(runResult.memory_kb / 1024)}MB`}
                          </span>
                        )}
                        {isRunning && (
                          <span
                            style={{
                              fontSize: "9px",
                              color: "var(--color-accent-base)",
                              letterSpacing: "0.1em",
                            }}
                          >
                            Running…
                          </span>
                        )}
                      </div>
                      {runResult?.compile_output ? (
                        <div
                          style={{
                            color: runResult.status === "CE" ? "#fca5a5" : "#94a3b8",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {runResult.compile_output}
                        </div>
                      ) : runResult && !isRunning ? (
                        <div style={{ color: "#475569" }}>No compiler output.</div>
                      ) : !isRunning ? (
                        <div style={{ color: "#334155" }}>
                          Compiler messages appear here after a run.
                        </div>
                      ) : null}
                    </div>
                  )}

                  {terminalTab === "submissions" && (
                    <div style={{ padding: "12px 16px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "12px",
                          marginBottom: "10px",
                        }}
                      >
                        <span
                          style={{
                            color: "#64748b",
                            fontSize: "10px",
                            letterSpacing: "0.08em",
                          }}
                        >
                          Attempts
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          {(["all", "failed", "passed"] as const).map((filter) => {
                            const active = testResultFilter === filter;
                            return (
                              <button
                                key={filter}
                                type="button"
                                onClick={() => setTestResultFilter(filter)}
                                style={{
                                  height: "28px",
                                  padding: "0 12px",
                                  borderRadius: "999px",
                                  border: `1px solid ${active ? "rgb(var(--accent-rgb) / 0.5)" : "rgba(148,163,184,0.14)"}`,
                                  background: active
                                    ? "rgb(var(--accent-rgb) / 0.14)"
                                    : "transparent",
                                  color: active ? "var(--color-accent-light)" : "#64748b",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  fontFamily: "Inter, system-ui, sans-serif",
                                  cursor: "pointer",
                                  textTransform: "capitalize",
                                }}
                              >
                                {filter}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {latestAttempt && (
                        <div
                          style={{
                            paddingBottom: "12px",
                            marginBottom: "12px",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "12px",
                              marginBottom: "10px",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                minWidth: 0,
                              }}
                            >
                              <VerdictBadge
                                variant="full"
                                code={
                                  (latestAttempt.final_verdict ??
                                    latestAttempt.status) as VerdictCode
                                }
                              />
                              <span style={{ color: "#64748b", fontSize: "11px" }}>
                                Attempt #{latestAttempt.attempt_no}
                              </span>
                              <span
                                style={{
                                  padding: "2px 7px",
                                  borderRadius: "999px",
                                  border: "1px solid rgba(148,163,184,0.16)",
                                  background: "rgba(148,163,184,0.08)",
                                  color: "#94a3b8",
                                  fontSize: "10px",
                                  fontWeight: 600,
                                  fontFamily: "Inter, system-ui, sans-serif",
                                }}
                              >
                                Evaluated attempt
                              </span>
                            </div>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "12px",
                                color: "#94a3b8",
                                fontSize: "11px",
                              }}
                            >
                              <span>
                                {latestAttemptTests
                                  ? `${latestAttemptPassed} / ${latestAttemptTests.length} passed`
                                  : latestAttemptPending
                                    ? "Judging in progress"
                                    : "Loading test results"}
                              </span>
                              <span>Score: {latestAttempt.score ?? "N/A"}</span>
                              <span>
                                {latestAttempt.runtime_ms != null
                                  ? `${latestAttempt.runtime_ms}ms`
                                  : "Runtime N/A"}
                              </span>
                              <span>
                                {latestAttempt.memory_kb != null
                                  ? `${Math.round(latestAttempt.memory_kb / 1024)}MB`
                                  : "Memory N/A"}
                              </span>
                            </div>
                          </div>
                          {latestAttemptFirstFailed ? (
                            <div
                              style={{
                                border: "1px solid rgba(239,68,68,0.22)",
                                background: "rgba(239,68,68,0.06)",
                                borderRadius: "6px",
                                padding: "8px 10px",
                                color: "#fca5a5",
                                fontSize: "11px",
                                lineHeight: 1.45,
                              }}
                            >
                              <strong style={{ color: "#fecaca" }}>
                                {latestAttemptFirstFailed.hidden ||
                                latestAttemptFirstFailed.is_hidden
                                  ? `Hidden test ${latestAttemptFirstFailed.test_number ?? ""} failed`
                                  : `Test ${latestAttemptFirstFailed.test_number ?? "?"} failed`}
                              </strong>
                              {` · ${latestAttemptFirstFailed.verdict ?? "Failed"}`}
                              {latestAttemptFirstFailed.runtime_ms != null &&
                                ` · ${latestAttemptFirstFailed.runtime_ms}ms`}
                              {latestAttemptFirstFailed.memory_kb != null &&
                                ` · ${Math.round(latestAttemptFirstFailed.memory_kb / 1024)}MB`}
                              {(latestAttemptFirstFailed.message ||
                                latestAttemptFirstFailed.status_message ||
                                latestAttemptFirstFailed.error) && (
                                <span style={{ color: "#fca5a5" }}>
                                  {` · ${latestAttemptFirstFailed.message ?? latestAttemptFirstFailed.status_message ?? latestAttemptFirstFailed.error}`}
                                </span>
                              )}
                            </div>
                          ) : latestAttemptTests && latestAttemptTests.length > 0 ? (
                            <div style={{ color: "#86efac", fontSize: "11px" }}>
                              All visible tests passed.
                            </div>
                          ) : (
                            <div style={{ color: "#64748b", fontSize: "11px" }}>
                              Test-case details will appear here when the judge returns them.
                            </div>
                          )}
                        </div>
                      )}
                      {loadingSubmissions && submissionsList.length === 0 ? (
                        <div style={{ color: "#64748b", fontSize: "11px" }}>
                          Loading submissions...
                        </div>
                      ) : submissionsList.length === 0 ? (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "8px",
                            padding: "24px 16px",
                            color: "#475569",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "12px",
                              fontWeight: 600,
                              color: "#475569",
                              fontFamily: "Inter, system-ui, sans-serif",
                            }}
                          >
                            No submissions yet
                          </span>
                          <span
                            style={{
                              fontSize: "11px",
                              color: "#334155",
                              fontFamily: "Inter, system-ui, sans-serif",
                              textAlign: "center",
                              lineHeight: 1.5,
                            }}
                          >
                            Press Submit Solution to send your code to the judge.
                            <br />
                            Each attempt is scored independently.
                          </span>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {submissionsList.map((sub) => {
                            const isExpanded = expandedAttemptId === sub.id;
                            const status = sub.status;
                            const isPending = status === "QUEUED" || status === "RUNNING";

                            return (
                              <div
                                key={sub.id}
                                style={{ borderBottom: "1px solid #1F1F1F", paddingBottom: "8px" }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    cursor: "pointer",
                                  }}
                                  onClick={() => toggleExpandAttempt(sub.id)}
                                >
                                  <div
                                    style={{ display: "flex", alignItems: "center", gap: "12px" }}
                                  >
                                    {/* Verdict first: it's the most important fact about the
                                        row and anchors the eye. The "Evaluated" badge is gone —
                                        a terminal verdict already implies it. */}
                                    <VerdictBadge
                                      variant="chip"
                                      code={
                                        (isPending
                                          ? sub.status
                                          : (sub.final_verdict ?? sub.status)) as VerdictCode
                                      }
                                    />
                                    <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                                      Attempt #{sub.attempt_no}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: "10px",
                                        padding: "1px 5px",
                                        background: "#1F1F1F",
                                        borderRadius: "var(--radius-sm)",
                                        color: "var(--text-soft)",
                                        fontFamily: "'JetBrains Mono', monospace",
                                      }}
                                    >
                                      {LANGUAGE_META[sub.language as keyof typeof LANGUAGE_META]
                                        ?.name || sub.language}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: "11px",
                                        color: "var(--text-dim)",
                                        fontVariantNumeric: "tabular-nums",
                                      }}
                                    >
                                      {new Date(sub.created_at).toLocaleTimeString()}
                                    </span>
                                  </div>
                                  <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
                                    {isExpanded ? (
                                      <ChevronUp size={14} />
                                    ) : (
                                      <ChevronDown size={14} />
                                    )}
                                  </span>
                                </div>

                                {isExpanded && (
                                  <div
                                    style={{
                                      marginTop: "6px",
                                      padding: "6px 8px",
                                      borderLeft: "2px solid rgb(var(--accent-rgb) / 0.3)",
                                    }}
                                  >
                                    {isPending ? (
                                      <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                                        Grading in progress... Live results will update
                                        automatically.
                                      </div>
                                    ) : (
                                      <>
                                        <div
                                          style={{
                                            display: "flex",
                                            gap: "16px",
                                            marginBottom: "8px",
                                            fontSize: "10px",
                                            color: "var(--text-dim)",
                                            fontVariantNumeric: "tabular-nums",
                                          }}
                                        >
                                          <span>
                                            Runtime:{" "}
                                            {sub.runtime_ms !== null
                                              ? `${sub.runtime_ms} ms`
                                              : "N/A"}
                                          </span>
                                          <span>
                                            Memory:{" "}
                                            {sub.memory_kb !== null ? `${sub.memory_kb} KB` : "N/A"}
                                          </span>
                                          <span>Score: {sub.score}</span>
                                        </div>

                                        <div>
                                          {testResults[sub.id] ? (
                                            (() => {
                                              const trs = testResults[sub.id];
                                              const passedCount = trs.filter(
                                                (tr: any) => tr.verdict === "AC"
                                              ).length;
                                              return (
                                                <>
                                                  <div
                                                    style={{
                                                      fontSize: "10px",
                                                      color: "#64748b",
                                                      marginBottom: "6px",
                                                    }}
                                                  >
                                                    <span
                                                      style={{
                                                        color:
                                                          passedCount === trs.length
                                                            ? "#22c55e"
                                                            : "#94a3b8",
                                                        fontWeight: 600,
                                                      }}
                                                    >
                                                      {passedCount} / {trs.length}
                                                    </span>{" "}
                                                    test cases passed
                                                  </div>
                                                  <div
                                                    style={{
                                                      display: "flex",
                                                      flexDirection: "column",
                                                      gap: "4px",
                                                    }}
                                                  >
                                                    {trs
                                                      .map((tr: any, originalIndex: number) => ({
                                                        tr,
                                                        originalIndex,
                                                      }))
                                                      .filter(({ tr }: any) =>
                                                        testResultFilter === "all"
                                                          ? true
                                                          : testResultFilter === "passed"
                                                            ? tr.verdict === "AC"
                                                            : tr.verdict !== "AC"
                                                      )
                                                      .map(
                                                        (
                                                          { tr, originalIndex }: any,
                                                          idx: number
                                                        ) => {
                                                          const testNumber =
                                                            tr.test_number ?? originalIndex + 1;
                                                          const isPass =
                                                            (tr.verdict ?? tr.status) === "AC";
                                                          return (
                                                            <div
                                                              key={`${sub.id}-${testNumber}-${idx}`}
                                                              style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: "5px",
                                                                fontSize: "10px",
                                                                color: "var(--text-soft)",
                                                                paddingLeft: "6px",
                                                                borderLeft: `2px solid ${
                                                                  isPass
                                                                    ? "var(--verdict-ac)"
                                                                    : "var(--verdict-wa)"
                                                                }`,
                                                                fontVariantNumeric: "tabular-nums",
                                                              }}
                                                            >
                                                              <span>Test {testNumber}</span>
                                                              <VerdictBadge
                                                                variant="chip"
                                                                code={
                                                                  (tr.verdict ??
                                                                    tr.status) as VerdictCode
                                                                }
                                                              />
                                                              {tr.runtime_ms != null && (
                                                                <span
                                                                  style={{
                                                                    color: "var(--text-faint)",
                                                                  }}
                                                                >
                                                                  {tr.runtime_ms}ms
                                                                </span>
                                                              )}
                                                              {tr.memory_kb != null && (
                                                                <span
                                                                  style={{
                                                                    color: "var(--text-faint)",
                                                                  }}
                                                                >
                                                                  {Math.round(tr.memory_kb / 1024)}
                                                                  MB
                                                                </span>
                                                              )}
                                                            </div>
                                                          );
                                                        }
                                                      )}
                                                  </div>
                                                  {trs.filter((tr: any) =>
                                                    testResultFilter === "all"
                                                      ? true
                                                      : testResultFilter === "passed"
                                                        ? tr.verdict === "AC"
                                                        : tr.verdict !== "AC"
                                                  ).length === 0 && (
                                                    <div
                                                      style={{ color: "#64748b", fontSize: "10px" }}
                                                    >
                                                      No {testResultFilter} tests in this attempt.
                                                    </div>
                                                  )}
                                                </>
                                              );
                                            })()
                                          ) : (
                                            <div style={{ fontSize: "10px", color: "#64748b" }}>
                                              Loading test results...
                                            </div>
                                          )}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Proctoring footer ── */}
      <footer
        style={{
          display: "flex",
          alignItems: "center",
          gap: "20px",
          padding: "0 20px",
          height: "36px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          background: "#0F0F0F",
          flexShrink: 0,
        }}
      >
        {/* Secure session indicator */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            color: proctoringOk ? "#71717a" : "#ef4444",
          }}
        >
          {proctoringOk ? (
            <ShieldCheck size={13} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Shield size={13} strokeWidth={2} aria-hidden="true" />
          )}
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "var(--radius-pill)",
              background: "currentColor",
              boxShadow: proctoringOk ? "none" : "0 0 6px currentColor",
              flexShrink: 0,
              transition: "background-color var(--transition-fast)",
            }}
          />
          <span
            role="status"
            aria-live="polite"
            style={{
              fontSize: "11px",
              color: "currentColor",
              fontWeight: 500,
              letterSpacing: "0.06em",
            }}
          >
            {proctoringOk ? "Secure" : "Action needed"}
          </span>
        </div>

        <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.07)" }} />

        {/* Face detection */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <circle
              cx="6"
              cy="4.5"
              r="2"
              stroke={
                faceStatus === "ok" ? "#71717a" : faceStatus === "away" ? "#f59e0b" : "#71717a"
              }
              strokeWidth="1.1"
            />
            <path
              d="M1.5 11c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5"
              stroke={
                faceStatus === "ok" ? "#71717a" : faceStatus === "away" ? "#f59e0b" : "#71717a"
              }
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          </svg>
          <span
            style={{
              fontSize: "11px",
              color:
                faceStatus === "ok" ? "#71717a" : faceStatus === "away" ? "#f59e0b" : "#71717a",
              letterSpacing: "0.06em",
            }}
          >
            {faceStatus === "ok"
              ? "Camera active"
              : faceStatus === "away"
                ? "Look forward"
                : "Camera starting"}
          </span>
        </div>

        <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.07)" }} />

        {/* Connection */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            color: online ? "#71717a" : "#f59e0b",
          }}
        >
          {online ? (
            <Wifi size={13} strokeWidth={2} aria-hidden="true" />
          ) : (
            <WifiOff size={13} strokeWidth={2} aria-hidden="true" />
          )}
          {online ? (
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "var(--radius-pill)",
                background: "currentColor",
                flexShrink: 0,
                transition: "background-color var(--transition-fast)",
              }}
            />
          ) : (
            <Loader2
              size={11}
              strokeWidth={2.5}
              aria-hidden="true"
              style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}
            />
          )}
          <span
            role="status"
            aria-live="polite"
            style={{ fontSize: "11px", color: "currentColor", letterSpacing: "0.06em" }}
          >
            {online ? "Connected" : "Reconnecting…"}
          </span>
        </div>

        <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.07)" }} />

        {/* Saved — mirrors the editor save indicator so candidates always know
            their work is safe without hunting for it. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            color: saveError ? "#ef4444" : saving || hasUnsavedChanges ? "#f59e0b" : "#71717a",
          }}
        >
          <Save size={13} strokeWidth={2} aria-hidden="true" />
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "var(--radius-pill)",
              background: "currentColor",
              boxShadow: saveError ? "0 0 6px currentColor" : "none",
              flexShrink: 0,
              transition: "background-color var(--transition-fast)",
            }}
          />
          <span
            role="status"
            aria-live="polite"
            style={{ fontSize: "11px", color: "currentColor", letterSpacing: "0.06em" }}
          >
            {saveError ? "Not saved" : saving || hasUnsavedChanges ? "Saving…" : "Saved"}
          </span>
        </div>

        <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.07)" }} />

        {/* Keyboard intercept */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <rect x="1" y="2.5" width="10" height="7" rx="1.5" stroke="#71717a" strokeWidth="1.1" />
            <path
              d="M3 5.5h1M5 5.5h1M7 5.5h1M3 7.5h6"
              stroke="#71717a"
              strokeWidth="0.9"
              strokeLinecap="round"
            />
          </svg>
          <span style={{ fontSize: "11px", color: "#71717a", letterSpacing: "0.06em" }}>
            Keyboard locked
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Contest + question info */}
        <span
          style={{
            fontSize: "11px",
            color: "var(--text-dim)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          Q{activeQ + 1}/{questions.length} · {attemptedQuestionCount} attempted ·{" "}
          {acceptedQuestionCount} accepted · {remainingQuestionCount} remaining ·{" "}
          {contest?.title ?? "—"}
        </span>

        <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.07)" }} />

        {/* AMS badge */}
        <span style={{ fontSize: "11px", color: "var(--text-dim)", letterSpacing: "0.08em" }}>
          AMS Access · Proctored
        </span>
      </footer>

      {/* ── Face proctoring soft-block overlay ── */}
      {shouldShowFaceBlock && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-live="assertive"
          aria-labelledby="face-block-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: "var(--modal-z-critical)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(2,4,10,0.92)",
            backdropFilter: "blur(16px) brightness(0.5)",
            animation: "fadeIn 280ms var(--ease-cinematic) forwards",
          }}
        >
          <div
            ref={faceBlockDialogRef}
            tabIndex={-1}
            style={{
              maxWidth: "400px",
              width: "100%",
              borderRadius: "8px",
              padding: "32px 28px",
              background: "#1F1F1F",
              border: "1px solid rgb(var(--accent-rgb) / 0.2)",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.3)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "rgb(var(--accent-rgb) / 0.1)",
                border: "1px solid rgb(var(--accent-rgb) / 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-accent-light)"
                strokeWidth="1.8"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M8 12a4 4 0 008 0" />
                <path d="M9 9h.01M15 9h.01" strokeLinecap="round" strokeWidth="2.5" />
              </svg>
            </div>
            <h4
              id="face-block-title"
              className="text-subsection-title"
              style={{ color: "#f8fafc", marginBottom: "8px" }}
            >
              {faceBlockTitle}
            </h4>
            <p className="text-body-copy" style={{ color: "#94a3b8", lineHeight: 1.5, margin: 0 }}>
              {faceBlockMessage}
            </p>
          </div>
        </div>
      )}

      {/* ── Media Toggle Warning Modal ── */}
      {showMediaToggleWarning && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="media-toggle-warning-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: "var(--modal-z-overlay)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(15,15,15,0.75)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div
            ref={mediaWarningDialogRef}
            tabIndex={-1}
            style={{
              maxWidth: "400px",
              width: "100%",
              borderRadius: "8px",
              padding: "24px",
              background: "#1F1F1F",
              border: "1px solid rgba(245,158,11,0.28)",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.3)",
              fontFamily: "Inter, system-ui, sans-serif",
            }}
          >
            <h4
              id="media-toggle-warning-title"
              style={{
                color: "#f8fafc",
                margin: "0 0 8px 0",
                fontSize: "15px",
                fontFamily: "Inter, system-ui, sans-serif",
              }}
            >
              This action will be logged.
            </h4>
            <p
              style={{
                color: "#94a3b8",
                fontSize: "13px",
                lineHeight: 1.6,
                margin: "0 0 24px 0",
                fontFamily: "Inter, system-ui, sans-serif",
              }}
            >
              Turning off your camera or microphone may affect proctoring validation.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                onClick={cancelMediaToggle}
                style={{
                  padding: "8px 16px",
                  border: "1px solid #475569",
                  background: "transparent",
                  color: "#e2e8f0",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmMediaToggle}
                style={{
                  padding: "8px 16px",
                  border: "1px solid rgba(245,158,11,0.38)",
                  background: "rgba(245,158,11,0.12)",
                  color: "#fbbf24",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Time's Up Auto-Submit Overlay ── */}
      {timeUpState !== "idle" && (
        <div
          role="alertdialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: "var(--modal-z-critical)",
            background: "rgba(10,10,10,0.92)",
            backdropFilter: "blur(16px) saturate(180%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: "#94a3b8",
              textTransform: "uppercase",
            }}
          >
            {timeUpState === "submitted" ? "Submitted" : "Contest Ended"}
          </div>
          {timeUpState === "submitting" && (
            <>
              <div style={{ fontSize: 22, fontWeight: 600, color: "#e2e8f0" }}>
                Submitting your session...
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', 'Fira Mono', 'Consolas', monospace",
                  fontSize: 12,
                  color: "#64748b",
                  letterSpacing: "0.04em",
                  marginTop: 2,
                }}
              >
                <style>{`
                  @keyframes ams-cursor-blink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0; }
                  }
                  @media (prefers-reduced-motion: no-preference) {
                    .ams-telemetry-cursor {
                      animation: ams-cursor-blink 1s step-end infinite;
                    }
                  }
                `}</style>
                Status: Transmitting data<span className="ams-telemetry-cursor">_</span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-dim)",
                  maxWidth: 340,
                  textAlign: "center",
                  lineHeight: 1.5,
                  marginTop: 8,
                }}
              >
                Your work is autosaved. It&rsquo;s safe to leave.
              </div>
              {/*
               * Escape hatches while auto-submit is in-flight. Navigating away is
               * intentionally allowed here: the candidate's work is already autosaved
               * and the submission/teardown promise will continue to resolve after
               * unmount. A stuck network request must never trap the candidate on
               * this screen.
               */}
              <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 4 }}>
                <button
                  onClick={() => router.push("/home")}
                  style={{
                    padding: "10px 24px",
                    background: "var(--color-accent-base)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "opacity var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "0.88";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "1";
                  }}
                >
                  Back to home
                </button>
                <button
                  onClick={() =>
                    router.push(
                      `/results?contestId=${encodeURIComponent(
                        contestId
                      )}&email=${encodeURIComponent(candidateEmail)}`
                    )
                  }
                  style={{
                    padding: "10px 0",
                    background: "none",
                    color: "#a1a1aa",
                    border: "none",
                    fontSize: 14,
                    cursor: "pointer",
                    transition: "color var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#a1a1aa";
                  }}
                >
                  Check results status
                </button>
              </div>
            </>
          )}
          {timeUpState === "submitted" && (
            <>
              <div style={{ fontSize: 26, fontWeight: 600, color: "#e2e8f0" }}>
                You&rsquo;re all done
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: "#94a3b8",
                  maxWidth: 380,
                  textAlign: "center",
                  lineHeight: 1.5,
                }}
              >
                {submitWarning ?? "Your work has been submitted safely."}
              </div>
              {submitWarning && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#fbbf24",
                    maxWidth: 380,
                    textAlign: "center",
                    lineHeight: 1.5,
                  }}
                >
                  You have been unlocked and can exit safely. We&rsquo;ll keep retrying the upload
                  in the background.
                </div>
              )}
              {questions.length > 0 && engagedQuestionCount > 0 && (
                <div style={{ fontSize: 13, color: "#64748b" }}>
                  You worked on {engagedQuestionCount} of {questions.length} problem
                  {questions.length !== 1 ? "s" : ""}.
                </div>
              )}
              <div
                style={{
                  fontSize: 13,
                  color: "#64748b",
                  maxWidth: 400,
                  textAlign: "center",
                  lineHeight: 1.5,
                  marginTop: 4,
                }}
              >
                Results unlock in 48 hours
                {candidateEmail ? (
                  <>
                    {" "}
                    — we&rsquo;ll email you at{" "}
                    <span style={{ color: "#94a3b8" }}>{candidateEmail}</span> when they&rsquo;re
                    ready.
                  </>
                ) : (
                  <> — we&rsquo;ll email you when they&rsquo;re ready.</>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 12 }}>
                <button
                  onClick={() => router.push("/home")}
                  style={{
                    padding: "10px 24px",
                    background: "var(--color-accent-base)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "opacity var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "0.88";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "1";
                  }}
                >
                  Back to home
                </button>
                <button
                  onClick={() =>
                    router.push(
                      `/results?contestId=${encodeURIComponent(
                        contestId
                      )}&email=${encodeURIComponent(candidateEmail)}`
                    )
                  }
                  style={{
                    padding: "10px 0",
                    background: "none",
                    color: "#a1a1aa",
                    border: "none",
                    fontSize: 14,
                    cursor: "pointer",
                    transition: "color var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#a1a1aa";
                  }}
                >
                  Check results status
                </button>
              </div>
            </>
          )}
          {timeUpState === "error" && (
            <>
              <div style={{ fontSize: 22, fontWeight: 600, color: "#e2e8f0" }}>
                Could not submit automatically.
              </div>
              <div style={{ fontSize: 13, color: "#94a3b8", maxWidth: 340, textAlign: "center" }}>
                Your answers are saved. Reconnect and click the button below to submit.
              </div>
              <button
                onClick={() => {
                  setTimeUpState("submitting");
                  void handleContestExpiry();
                }}
                style={{
                  marginTop: 8,
                  padding: "10px 24px",
                  background: "var(--color-accent-deep)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    "color-mix(in srgb, var(--color-accent-deep), #fff 12%)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--color-accent-deep)";
                }}
              >
                Retry Submit
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 4 }}>
                <button
                  onClick={() => router.push("/home")}
                  style={{
                    padding: "10px 24px",
                    background: "var(--color-accent-base)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "opacity var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "0.88";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "1";
                  }}
                >
                  Back to home
                </button>
                <button
                  onClick={() =>
                    router.push(
                      `/results?contestId=${encodeURIComponent(
                        contestId
                      )}&email=${encodeURIComponent(candidateEmail)}`
                    )
                  }
                  style={{
                    padding: "10px 0",
                    background: "none",
                    color: "#a1a1aa",
                    border: "none",
                    fontSize: 14,
                    cursor: "pointer",
                    transition: "color var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#a1a1aa";
                  }}
                >
                  Check results status
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Support Incident Modal Overlay ── */}
      {showSupportModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: "var(--modal-z-overlay)",
            background: "rgba(15,15,15,0.85)",
            backdropFilter: "blur(16px) saturate(180%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            ref={supportDialogRef}
            tabIndex={-1}
            style={{
              width: "100%",
              maxWidth: "800px",
              background: "#1F1F1F",
              border: "1px solid rgb(var(--accent-rgb) / 0.2)",
              borderRadius: "8px",
              padding: "32px",
              boxShadow: "0 24px 64px rgb(var(--accent-rgb) / 0.08)",
              position: "relative",
              overflow: "hidden",
              display: "grid",
              gridTemplateColumns: "1.1fr 1fr",
              gap: "32px",
            }}
          >
            {/* Left Column: Form & Categories */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div>
                <h3
                  id="support-modal-title"
                  className="text-subsection-title"
                  style={{ color: "#ffffff", marginBottom: "var(--density-compact)" }}
                >
                  Report an Incident
                </h3>
                <p className="text-body-copy" style={{ color: "#64748b", margin: 0 }}>
                  Select the issue encountered. Our operations team will receive this report
                  instantly along with diagnostic system telemetry.
                </p>
              </div>

              {/* Success Screen */}
              {reportSentSuccess ? (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "220px",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "50%",
                      background: "rgba(34,197,94,0.1)",
                      border: "1px solid rgba(34,197,94,0.3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: "16px",
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2.5 6l2 2 5-5"
                        stroke="#22c55e"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <h4
                    className="text-subsection-title"
                    style={{ color: "#22c55e", marginBottom: "var(--density-compact)" }}
                  >
                    Incident Ticket Transmitted
                  </h4>
                  <p
                    className="text-body-copy"
                    style={{ color: "#94a3b8", maxWidth: "280px", margin: 0 }}
                  >
                    Incident logged successfully. System telemetry bundle [ID: 8F9A2] has been
                    transmitted to proctoring staff. You may resume your exam.
                  </p>
                </div>
              ) : (
                <>
                  {/* Category choices */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {[
                      { value: "camera_not_detected", label: "Camera not detected" },
                      { value: "internet_unstable", label: "Internet unstable" },
                      { value: "app_crashed", label: "App crashed" },
                      { value: "fullscreen_issue", label: "Fullscreen issue" },
                      { value: "audio_issue", label: "Audio issue" },
                      { value: "submission_issue", label: "Submission issue" },
                      { value: "other", label: "Other issue..." },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "10px 14px",
                          borderRadius: "8px",
                          background:
                            supportCategory === opt.value
                              ? "rgb(var(--accent-rgb) / 0.08)"
                              : "rgba(255,255,255,0.01)",
                          border: `1px solid ${supportCategory === opt.value ? "rgb(var(--accent-rgb) / 0.3)" : "rgba(255,255,255,0.05)"}`,
                          cursor: "pointer",
                          fontSize: "13px",
                          color: supportCategory === opt.value ? "#ffffff" : "#94a3b8",
                          transition: "all 150ms ease",
                        }}
                      >
                        <input
                          type="radio"
                          name="supportCategory"
                          value={opt.value}
                          checked={supportCategory === opt.value}
                          onChange={(e) => setSupportCategory(e.target.value)}
                          style={{
                            accentColor: "var(--color-accent-base)",
                            cursor: "pointer",
                          }}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>

                  {supportCategory === "other" && (
                    <textarea
                      aria-label="Describe the issue in detail"
                      placeholder="Describe the issue in detail..."
                      value={customIssueDetail}
                      onChange={(e) => setCustomIssueDetail(e.target.value)}
                      spellCheck={false}
                      style={{
                        width: "100%",
                        height: "70px",
                        resize: "none",
                        background: "#0F0F0F",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "8px",
                        padding: "10px 12px",
                        fontSize: "12px",
                        color: "#e2e8f0",
                        fontFamily: "inherit",
                        outline: "2px solid transparent",
                      }}
                    />
                  )}

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                    <button
                      onClick={handleSendSupportReport}
                      disabled={
                        isSendingReport ||
                        (supportCategory === "other" && !customIssueDetail.trim())
                      }
                      style={{
                        flex: 1,
                        height: "38px",
                        borderRadius: "8px",
                        border: "none",
                        background: "#f59e0b",
                        color: "#0F0F0F",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: isSendingReport ? "not-allowed" : "pointer",
                        transition: "all 200ms ease",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 4px 12px rgba(245,158,11,0.2)",
                      }}
                    >
                      {isSendingReport ? "Sending..." : "Submit report"}
                    </button>
                    <button
                      onClick={() => setShowSupportModal(false)}
                      disabled={isSendingReport}
                      style={{
                        height: "38px",
                        borderRadius: "8px",
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "transparent",
                        color: "#94a3b8",
                        padding: "0 16px",
                        fontSize: "13px",
                        fontWeight: 500,
                        cursor: "pointer",
                        transition: "all 200ms ease",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Right Column: Auto Attached Telemetry Preview */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                borderLeft: "1px solid rgba(255,255,255,0.05)",
                paddingLeft: "32px",
                overflow: "hidden",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}
              >
                <div
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "#22c55e",
                  }}
                />
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "#22c55e",
                    fontFamily: "Inter, system-ui, sans-serif",
                    letterSpacing: "0",
                  }}
                >
                  Attached diagnostics
                </span>
              </div>
              <div
                style={{
                  flex: 1,
                  background: "#0F0F0F",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: "8px",
                  padding: "16px",
                  overflowY: "auto",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "10.5px",
                  color: "rgb(var(--accent-rgb) / 0.8)",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {JSON.stringify(supportTelemetry, null, 2)}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse-preview {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        button:focus-visible, textarea:focus-visible, input:focus-visible, select:focus-visible { outline: 1px solid rgb(var(--accent-rgb) / 0.3); outline-offset: 0; }
        textarea::-webkit-scrollbar { width: 6px; }
        textarea::-webkit-scrollbar-track { background: transparent; }
        textarea::-webkit-scrollbar-thumb { background: rgb(var(--accent-rgb) / 0.2); border-radius: 3px; }

        /* Problem description markdown */
        .pb-body { color: #cbd5e1; font-size: 14px; line-height: 1.7; }
        .pb-body-editorial { font-size: var(--text-base); line-height: 1.65; max-width: 720px; }
        .pb-body p { margin: 0 0 14px; }
        .pb-body h1,.pb-body h2,.pb-body h3,.pb-body h4 { color: #f1f5f9; font-family: Inter, system-ui, sans-serif; font-weight: 700; margin: 24px 0 10px; line-height: 1.28; letter-spacing: 0; }
        .pb-body h1 { font-size: 22px; } .pb-body h2 { font-size: 18px; } .pb-body h3 { font-size: 15px; }
        .pb-body strong { color: #f1f5f9; font-weight: 600; }
        .pb-body em { color: #a5b4fc; font-style: italic; }
        .pb-body code { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; font-weight: 400; background: #1E1E24; color: #e4e4e7; padding: 1px 5px; border-radius: var(--radius-sm, 4px); border: 1px solid rgba(255,255,255,0.08); }
        .pb-body pre { background: #071124; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 14px 16px; overflow-x: auto; margin: 12px 0; }
        .pb-body pre code { background: none; border: none; padding: 0; color: #94a3b8; font-size: 12.5px; }
        .pb-sample-block { position: relative; margin: 14px 0; }
        .pb-sample-block pre { margin: 0; padding-top: 38px; }
        .pb-copy-button {
          position: absolute;
          top: 8px;
          right: 8px;
          height: 24px;
          padding: 0 9px;
          border-radius: 999px;
          border: 1px solid rgba(148,163,184,0.16);
          background: rgba(15,23,42,0.82);
          color: #cbd5e1;
          font-family: Inter, system-ui, sans-serif;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }
        .pb-copy-button:hover { border-color: rgb(var(--accent-rgb) / 0.35); color: #d8b4fe; }
        .pb-body ul,.pb-body ol { padding-left: 20px; margin: 0 0 12px; }
        .pb-body li { margin-bottom: 4px; color: #cbd5e1; }
        .pb-body a { color: var(--color-accent-base); text-decoration: underline; text-decoration-color: rgb(var(--accent-rgb) / 0.4); }
        .pb-body a:hover { color: var(--color-accent-light); }
        .pb-body img { max-width: 100%; border-radius: 8px; margin: 8px 0; border: 1px solid rgba(255,255,255,0.06); }
        .pb-body blockquote { border-left: 3px solid rgb(var(--accent-rgb) / 0.4); margin: 12px 0; padding: 4px 0 4px 14px; color: #94a3b8; }
        .pb-body hr { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 16px 0; }
        .pb-body table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
        .pb-body th,.pb-body td { border: 1px solid rgba(255,255,255,0.06); padding: 6px 10px; text-align: left; }
        .pb-body th { background: rgb(var(--accent-rgb) / 0.08); color: #e2e8f0; font-weight: 600; }
        /* KaTeX math — sized to flow with the 14px statement body. */
        .pb-body .katex { font-size: 1.05em; color: #e2e8f0; }
        .pb-body .katex-display { margin: 12px 0; overflow-x: auto; overflow-y: hidden; padding: 2px 0; }
        .pb-body .pb-math-error { color: #fca5a5; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); }

        /* Interactive widgets embedded in <code> blocks — strip inline-code boxing */
        .pb-body code:has(div),
        .pb-body code:has(input),
        .pb-body code:has(button) {
          background: none; border: none; padding: 0; color: inherit; border-radius: 0; font-size: inherit;
        }
        /* Widget container: terminal-grade card */
        .pb-body code > div {
          background: #071124;
          border: 1px solid rgba(255,255,255,0.06);
          padding: 14px 16px;
          margin: 12px 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: #94a3b8;
        }
        .pb-body code > div * { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: inherit; }
        /* Machine the range input into a 2px linear meter with a hard square thumb */
        .pb-body input[type="range"] {
          -webkit-appearance: none; appearance: none;
          width: 100%; height: 2px;
          background: rgba(255,255,255,0.08);
          border: none; cursor: pointer; margin: 10px 0; display: block;
        }
        .pb-body input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 10px; height: 10px;
          background: var(--color-accent-base); border-radius: 0; cursor: pointer;
        }
        .pb-body input[type="range"]::-moz-range-thumb {
          width: 10px; height: 10px;
          background: var(--color-accent-base); border-radius: 0; border: none; cursor: pointer;
        }
        .pb-body input[type="range"]::-webkit-slider-runnable-track { background: rgba(255,255,255,0.08); height: 2px; }
        /* Nested output spans inside widgets */
        .pb-body code > div span { color: #64748b; }
        .pb-body code > div span[id] { color: #c4b5fd; }
      `}</style>
    </div>
  );
}

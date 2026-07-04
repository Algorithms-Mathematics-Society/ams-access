import { marked } from "marked";
import katex from "katex";
import DOMPurify from "dompurify";

export type ProblemSectionKey = "statement" | "examples" | "constraints";

// Configure marked once at module level — pays cost on first import, never again.
marked.use({ breaks: true, gfm: true });

// Opaque sentinels used to lift code and math out of the markdown before marked
// runs, then re-inject them after sanitization. They contain no markdown-active
// (_ * ` [ ] $) or HTML-active characters, so marked and DOMPurify pass them
// through verbatim. (HTML comments would be stripped by DOMPurify — don't use them.)
export const MATH_TOKEN = (n: number) => `@@AMSMATH${n}@@`;
export const CODE_TOKEN = (n: number) => `@@AMSCODE${n}@@`;

export function escapeHtml(value: string): string {
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
export function renderMath(tex: string, displayMode: boolean): string {
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

export function parseDescription(md: string): string {
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
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function enhanceSampleBlocks(html: string, copiedSampleKey: string | null): string {
  let index = 0;
  return html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (_match, attrs, code) => {
    const key = `sample-${index++}`;
    const plain = decodeHtmlEntities(code).replace(/\n$/, "");
    const label = copiedSampleKey === key ? "Copied" : "Copy";
    return `<div class="pb-sample-block"><button type="button" class="pb-copy-button" data-copy-key="${key}" data-copy-sample="${escapeHtmlAttribute(plain)}">${label}</button><pre><code${attrs}>${code}</code></pre></div>`;
  });
}

export function splitProblemDescription(md: string): Record<ProblemSectionKey, string> {
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

export function getAvailableProblemTabs(
  sections: Record<ProblemSectionKey, string>
): ProblemSectionKey[] {
  return (["statement", "examples", "constraints"] as const).filter(
    (key) => key === "statement" || sections[key].trim().length > 0
  );
}

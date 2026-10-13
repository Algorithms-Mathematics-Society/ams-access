/**
 * Source rules, in English.
 *
 * The judge names a symbolic check after the thing it greps for, so the
 * testcase label arrives as `must_not_include: \bmemcpy\s*\(` — a rule kind
 * nobody outside this repo says out loud, joined to a regular expression.
 * That reached candidates verbatim, on the one screen where a rule is either
 * obvious or it has cost them the problem.
 *
 * Two translations, in order of preference:
 *
 * 1. Whatever the setter wrote. `checker_message` is a sentence by a human
 *    who knew why the rule exists, and it always beats anything generated.
 * 2. Failing that, the kind plus a readable form of the pattern.
 *
 * Deliberately not a regex engine. The patterns setters write are nearly all
 * a token with word boundaries and an optional call, so stripping the
 * handful of constructs that actually show up turns `\bmemcpy\s*\(` into
 * `memcpy` and leaves anything stranger alone rather than mangling it.
 */

export type RuleKind = "must_include" | "must_not_include";

const PREFIX = /^(must_not_include|must_include)\s*:\s*/i;

/** The regex noise that shows up in hand-written source rules. */
function readablePattern(pattern: string): string {
  let text = pattern.trim();
  text = text.replace(/^\\b/, "").replace(/\\b$/, "");
  // A trailing call: `foo\s*\(` means "foo(" and reads better as just `foo`.
  text = text.replace(/\\s\*\\?\($/, "");
  text = text.replace(/\\s\*/g, " ");
  // Escapes for characters that are literal in every rule we have seen.
  text = text.replace(/\\([.()[\]{}+*?^$|\\/-])/g, "$1");
  return text.trim();
}

/** Whether a pattern survived `readablePattern` as something a person can read. */
function looksReadable(text: string): boolean {
  return text.length > 0 && !/[\\^$|]/.test(text);
}

export type RuleLanguage = {
  /** Short enough for a tab. */
  chip: string;
  /** A full sentence for the detail pane. */
  sentence: string;
};

/**
 * What to call a symbolic check, given the judge's label and the setter's
 * message.
 */
export function ruleLanguage(label: string, checkerMessage?: string): RuleLanguage {
  const raw = (label ?? "").trim();
  const match = raw.match(PREFIX);
  const kind = (match?.[1]?.toLowerCase() ?? null) as RuleKind | null;
  const pattern = kind ? raw.slice(match![0].length).trim() : raw;
  const readable = readablePattern(pattern);
  const named = looksReadable(readable) ? readable : "";

  const message = (checkerMessage ?? "").trim();

  if (!kind) {
    // Not a rule we can parse — a setter's own name for the check. Use it.
    return { chip: named || raw || "Rule", sentence: message || named || raw || "Rule" };
  }

  const verb = kind === "must_include" ? "Must use" : "Must not use";
  const chip = named ? `${verb} ${named}` : verb;
  const generated = named
    ? kind === "must_include"
      ? `Your solution must use ${named}.`
      : `Your solution must not use ${named}.`
    : `Your solution breaks a source rule.`;

  // The setter's sentence wins, but the chip stays short either way — a tab
  // strip is not the place for a paragraph.
  return { chip, sentence: message || generated };
}

/** Trim a chip to something that fits a tab without reflowing the strip. */
export function shortChip(text: string, max = 26): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

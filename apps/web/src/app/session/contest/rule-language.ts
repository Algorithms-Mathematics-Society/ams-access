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

  // The setter's own words win, for the tab as well as the detail pane.
  // Deriving a chip from the pattern leaks the regex at a candidate --
  // `\b(std::)?istringstream\b` became "Must use (std::)?istrings…", and an
  // alternation that `readablePattern` could not clean fell back to a bare
  // "Must not use", which names nothing at all. A rule is a sentence a
  // person wrote; show that.
  const chip = message || (named ? `${verb} ${named}` : verb);
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

/**
 * Split an identifier into words, keeping acronyms whole.
 *
 * `MoveAssignmentReleasesOld` → `Move Assignment Releases Old`, and
 * `HandlesZeroHP` → `Handles Zero HP` rather than `Handles Zero H P`.
 */
function splitIdentifier(name: string): string[] {
  return (
    name
      .replace(/[_\-.]+/g, " ")
      // A lower-to-upper boundary is always a new word.
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      // An acronym run followed by a capitalised word: `RAIIHolder` is two.
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/\s+/)
      .filter(Boolean)
  );
}

/**
 * What to call a behaviour check, given the judge's label and the setter's
 * message.
 *
 * A GTest name arrives as `PokemonRAII.ConstructionAcquiresAndDestructionReleases`
 * — the suite, a dot, and a sentence with the spaces taken out. Candidates
 * were shown exactly that, truncated mid-word by the tab strip, which tells
 * them nothing about what their code got wrong.
 *
 * Same order of preference as `ruleLanguage`: the setter's own sentence
 * first, then the identifier turned back into the sentence it started as. An
 * all-caps run is left alone, because `HP` and `RAII` are words here.
 */
export function behaviourLanguage(label: string, checkerMessage?: string): RuleLanguage {
  const raw = (label ?? "").trim();
  // Drop the suite: every check in a problem shares it, so it is the one part
  // that cannot tell two of them apart.
  const bare = raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw;
  const words = splitIdentifier(bare);

  const described = words
    .map((word, index) => {
      // An acronym stays as written. Everything else is lower case, except
      // the first word, which starts the sentence.
      if (word.length > 1 && word === word.toUpperCase()) return word;
      const lower = word.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");

  const message = (checkerMessage ?? "").trim();

  return {
    chip: described || raw || "Behaviour check",
    sentence: message || described || raw || "Behaviour check",
  };
}

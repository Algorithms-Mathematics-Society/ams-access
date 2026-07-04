import type { Question } from "./questions";

/**
 * Maps the display label used in the UI and stored in `allowed_languages`
 * to the wire identifier expected by the judge worker.
 * The worker matches by substring so "cpp17" satisfies both the `c++` and `cpp` checks.
 */
export const LANGUAGE_ID_MAP: Record<string, string> = {
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
export const WORKER_SUPPORTED_LANGUAGES = new Set([
  "C",
  "C++17",
  "C++20",
  "Python3",
  "PyPy3",
  "Java17",
]);

export function toLanguageId(displayLabel: string): string {
  return LANGUAGE_ID_MAP[displayLabel] ?? displayLabel.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeLanguageLabel(label: string): string {
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

export function normalizeAllowedLanguages(languages?: string[] | null): string[] {
  const source = languages?.length ? languages : ["C++17"];
  const normalized = source
    .map((language) => normalizeLanguageLabel(language))
    .filter((language, index, list) => list.indexOf(language) === index);
  return normalized.length > 0 ? normalized : ["C++17"];
}

export function looksLikeCpp(code: string | null | undefined): code is string {
  if (!code) return false;
  return /#include\s*<|using\s+namespace\s+std|int\s+main\s*\(/.test(code);
}

export function defaultCppStarter(): string {
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

export function defaultPythonStarter(): string {
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

export function defaultJavaStarter(): string {
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

export function defaultStarterFor(language: string): string {
  if (language === "Python3") return defaultPythonStarter();
  if (language === "Java17") return defaultJavaStarter();
  return defaultCppStarter();
}

/**
 * Returns true if content has never been meaningfully edited — i.e. it still
 * matches any of the known default starters or is empty. Safe to replace when
 * the user switches languages.
 */
export function isPristineStarter(content: string): boolean {
  return (
    content === "" ||
    content === defaultCppStarter() ||
    content === defaultPythonStarter() ||
    content === defaultJavaStarter()
  );
}

export const LANGUAGE_EXTENSIONS: Record<string, string> = {
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
export function questionFileName(question: Question, language: string): string {
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

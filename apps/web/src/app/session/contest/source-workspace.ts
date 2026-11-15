/** The same bounded, relative paths accepted by the participant API. */
export type SourceFile = { path: string; content: string };
export type ReferenceDoc = { path: string; content: string };
export type SourceWorkspace = {
  source_files: SourceFile[];
  entrypoint: string;
  compilation_units: string[];
};

export const MAX_SOURCE_FILES = 16;
export const MAX_SOURCE_FILE_BYTES = 256_000;
export const MAX_SOURCE_TOTAL_BYTES = 1024 * 1024;
const SOURCE_EXT = /\.(?:cpp|cc|cxx|h|hpp|hh|hxx)$/i;
const UNIT_EXT = /\.(?:cpp|cc|cxx)$/i;
const RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function isCompilationUnit(path: string): boolean {
  return UNIT_EXT.test(path);
}

export function sourcePathError(path: string): string | null {
  if (!path || path.length > 160 || path.startsWith("/"))
    return "Use a relative path up to 160 characters.";
  if (
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          !/^[A-Za-z0-9_.-]+$/.test(part) ||
          part.startsWith(".") ||
          part.endsWith(".") ||
          RESERVED_SEGMENT.test(part)
      )
  )
    return "Use letters, digits, _, - and . in path segments; avoid reserved device names and leading or trailing dots.";
  if (!SOURCE_EXT.test(path))
    return "Use a C++ source or header extension (.cpp, .cc, .cxx, .h, .hpp, .hh, .hxx).";
  return null;
}

export function sourceWorkspaceError(
  workspace: SourceWorkspace,
  allowEmpty = false
): string | null {
  const files = workspace.source_files;
  if (!files.length || files.length > MAX_SOURCE_FILES)
    return `A workspace needs 1–${MAX_SOURCE_FILES} source files.`;
  const seen = new Set<string>();
  const paths: string[] = [];
  let total = 0;
  for (const file of files) {
    const pathError = sourcePathError(file.path);
    if (pathError) return `${file.path || "File"}: ${pathError}`;
    const folded = file.path.toLocaleLowerCase("en-US");
    if (seen.has(folded)) return `Duplicate file path: ${file.path}.`;
    if (paths.some((other) => folded.startsWith(`${other}/`) || other.startsWith(`${folded}/`)))
      return `A file cannot also be a folder: ${file.path}.`;
    seen.add(folded);
    paths.push(folded);
    const bytes = new TextEncoder().encode(file.content).length;
    if (bytes > MAX_SOURCE_FILE_BYTES) return `${file.path} exceeds 256,000 bytes.`;
    total += bytes;
  }
  if (total > MAX_SOURCE_TOTAL_BYTES) return "Source files exceed 1 MiB together.";
  if (!files.some((file) => file.path === workspace.entrypoint && isCompilationUnit(file.path)))
    return "Choose a C++ source file as the entrypoint.";
  const expected = files.filter((file) => isCompilationUnit(file.path)).map((file) => file.path);
  if (
    new Set(workspace.compilation_units).size !== workspace.compilation_units.length ||
    expected.length !== workspace.compilation_units.length ||
    expected.some((path) => !workspace.compilation_units.includes(path))
  )
    return "Compilation units must list every C++ source file exactly once.";
  if (!allowEmpty && files.every((file) => !file.content.trim()))
    return "Your code is empty. Write a solution first.";
  return null;
}

export function workspaceFromFiles(
  files: readonly { name: string; content: string }[],
  entrypoint: string
): SourceWorkspace {
  const source_files = files.map((file) => ({ path: file.name, content: file.content }));
  return {
    source_files,
    entrypoint,
    compilation_units: source_files
      .filter((file) => isCompilationUnit(file.path))
      .map((file) => file.path),
  };
}

export function workspaceFingerprint(language: string, workspace: SourceWorkspace): string {
  return JSON.stringify([language, workspace]);
}

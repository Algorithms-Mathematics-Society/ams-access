/** Conservative presentation parsing; raw compiler output is always retained. */
export type CompilerDiagnostic = { filename: string; line: number; column?: number; message: string };
export type DiagnosticSource = { questionId: string; fileId: string; filename: string; source: string; language: string };
export type DiagnosticNavigation = DiagnosticSource & { sequence: number; line: number; column?: number };

export function firstCompilerError(output: string): CompilerDiagnostic | null {
  const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/);
  for (const line of lines) {
    // GCC/Clang and javac. Ignore warnings, notes, unknown formats and library headers.
    const match = line.match(/^(.+\.(?:c|cc|cpp|cxx|java)):(\d+)(?::(\d+))?:\s*(?:fatal )?error:\s*(.+)$/);
    if (match && Number(match[2]) > 0 && (!match[3] || Number(match[3]) > 0)) {
      return { filename: match[1], line: Number(match[2]), column: match[3] ? Number(match[3]) : undefined, message: match[4] };
    }
  }
  // Syntax diagnostics only, not runtime tracebacks with ambiguous call frames.
  const syntaxIndex = lines.findIndex((line) => /^(?:SyntaxError|IndentationError|TabError):/.test(line.trim()));
  if (syntaxIndex >= 0) {
    for (let index = syntaxIndex - 1; index >= 0; index--) {
      const match = lines[index].match(/^\s*File "([^"\n]+\.py)", line (\d+)\s*$/);
      if (match && Number(match[2]) > 0) return { filename: match[1], line: Number(match[2]), message: lines[syntaxIndex].trim() };
    }
  }
  return null;
}

export function canNavigateDiagnostic(diagnostic: CompilerDiagnostic, snapshot: DiagnosticSource | null, current: DiagnosticSource): boolean {
  if (!snapshot || snapshot.questionId !== current.questionId || snapshot.fileId !== current.fileId ||
      snapshot.filename !== current.filename || snapshot.source !== current.source || snapshot.language !== current.language) return false;
  // A judge may rename a source file. Without an authoritative mapping, do not guess.
  const filename = diagnostic.filename.split(/[\\/]/).at(-1);
  if (filename !== current.filename || !Number.isSafeInteger(diagnostic.line) || diagnostic.line < 1) return false;
  const lines = current.source.split("\n");
  if (diagnostic.line > lines.length) return false;
  return diagnostic.column === undefined || (Number.isSafeInteger(diagnostic.column) && diagnostic.column > 0 && diagnostic.column <= lines[diagnostic.line - 1].length + 1);
}

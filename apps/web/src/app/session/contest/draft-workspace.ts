import {
  activeContent,
  chooseRestore,
  type BufferedAnswer,
  type BufferedFile,
  type ServerDraft,
} from "./answer-buffer.ts";
import {
  isCompilationUnit,
  sourceWorkspaceError,
  workspaceFingerprint,
} from "./source-workspace.ts";

/** Deferred writes retain their question and source, even when the user navigates. */
export function createDraftSaveQueue() {
  type Job = { save: () => Promise<boolean>; resolve: Array<(value: boolean) => void> };
  let running = false;
  const pending = new Map<string, Job>();
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending.size) {
        const [key, job] = pending.entries().next().value!;
        pending.delete(key);
        let result = false;
        try {
          result = await job.save();
        } catch {
          /* A failed question must not strand the rest. */
        }
        for (const resolve of job.resolve) resolve(result);
      }
    } finally {
      running = false;
    }
  }
  return (questionKey: string, save: () => Promise<boolean>): Promise<boolean> =>
    new Promise((resolve) => {
      const waiting = pending.get(questionKey);
      // Coalesce only the same question. A pending A can never turn into B.
      if (waiting) {
        waiting.save = save;
        waiting.resolve.push(resolve);
      } else pending.set(questionKey, { save, resolve: [resolve] });
      void drain();
    });
}

/** Restore all local tabs, not just their active source; never enumerate only server drafts. */
export function restoreDraftWorkspace(
  questionId: string,
  mainName: string,
  buffered: BufferedAnswer | null,
  server: ServerDraft | null
) {
  const choice = chooseRestore(buffered, server);
  if (buffered && (choice === "buffer" || choice === "same")) {
    return {
      files: buffered.files,
      activeFileId: buffered.activeFileId,
      entrypoint: buffered.entrypoint,
      language: buffered.language,
      recovered: choice === "buffer",
    };
  }
  // A newer server draft, or the only copy (a spare machine, cleared site
  // data), wins the active answer; scratch work has no server copy.
  if (!server) return null;
  if (server.source_files?.length && server.entrypoint) {
    const files: BufferedFile[] = server.source_files.map((file) => ({
      id: `${questionId}:source:${file.path}`,
      name: file.path,
      content: file.content,
    }));
    return {
      files,
      activeFileId: files.find((file) => file.name === server.entrypoint)?.id ?? files[0].id,
      entrypoint: server.entrypoint,
      language: server.language,
      recovered: false,
    };
  }
  const scratch = buffered?.files.filter((file) => file.id !== `${questionId}:main`) ?? [];
  const main: BufferedFile = { id: `${questionId}:main`, name: mainName, content: server.source };
  return {
    files: [main, ...scratch],
    activeFileId: main.id,
    entrypoint: undefined,
    language: server.language,
    recovered: false,
  };
}

/** How often the device buffer is backed up to the server, when it changed. */
export const DRAFT_BACKUP_MS = 45_000;

/** What to back up for one problem, or null when the server already holds it.
 * `fingerprint` is what the caller records once the server accepts it. */
export function draftBackup(
  buffered: BufferedAnswer | null,
  serverHolds: string | undefined,
  multiFile = false
) {
  if (!buffered) return null;
  const source = activeContent(buffered);
  const sourceFiles =
    multiFile && buffered.entrypoint
      ? buffered.files.map((file) => ({ path: file.name, content: file.content }))
      : undefined;
  const compilationUnits = sourceFiles
    ?.filter((file) => isCompilationUnit(file.path))
    .map((file) => file.path);
  if (
    sourceFiles &&
    sourceWorkspaceError(
      {
        source_files: sourceFiles,
        entrypoint: buffered.entrypoint!,
        compilation_units: compilationUnits ?? [],
      },
      true
    )
  )
    return null;
  const fingerprint = sourceFiles
    ? workspaceFingerprint(buffered.language, {
        source_files: sourceFiles,
        entrypoint: buffered.entrypoint!,
        compilation_units: compilationUnits ?? [],
      })
    : `${buffered.language}\n${source}`;
  return fingerprint === serverHolds
    ? null
    : {
        source,
        language: buffered.language,
        fingerprint,
        ...(sourceFiles ? { sourceFiles, entrypoint: buffered.entrypoint, compilationUnits } : {}),
      };
}

/** A failure that ends backups for the session: no connection to the server
 * at all (which is also how a server refusing PUT under CORS looks), or a
 * session or contest that no longer accepts drafts. Anything else is retried
 * on the next tick. Either way nothing is shown: the device copy is primary. */
export function stopsDraftBackup(status: number): boolean {
  return status === 0 || status === 409;
}

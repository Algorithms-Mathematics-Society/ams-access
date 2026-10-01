import { chooseRestore, type BufferedAnswer, type BufferedFile, type ServerDraft } from "./answer-buffer.ts";

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
        try { result = await job.save(); } catch { /* A failed question must not strand the rest. */ }
        for (const resolve of job.resolve) resolve(result);
      }
    } finally { running = false; }
  }
  return (questionKey: string, save: () => Promise<boolean>): Promise<boolean> => new Promise(resolve => {
    const waiting = pending.get(questionKey);
    // Coalesce only the same question. A pending A can never turn into B.
    if (waiting) { waiting.save = save; waiting.resolve.push(resolve); }
    else pending.set(questionKey, { save, resolve: [resolve] });
    void drain();
  });
}

/** Restore all local tabs, not just their active source; never enumerate only server drafts. */
export function restoreDraftWorkspace(questionId: string, mainName: string, buffered: BufferedAnswer | null, server: ServerDraft | null) {
  if (!buffered) return null;
  const choice = chooseRestore(buffered, server);
  if (choice === "buffer" || choice === "same") {
    return { files: buffered.files, activeFileId: buffered.activeFileId, language: buffered.language, recovered: choice === "buffer" };
  }
  // A newer server draft wins the active answer; scratch work has no server copy.
  const scratch = buffered.files.filter(file => file.id !== `${questionId}:main`);
  if (!server || scratch.length === 0) return null;
  const main: BufferedFile = { id: `${questionId}:main`, name: mainName, content: server.source };
  return { files: [main, ...scratch], activeFileId: main.id, language: server.language, recovered: false };
}

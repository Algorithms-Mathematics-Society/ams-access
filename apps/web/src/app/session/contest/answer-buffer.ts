/**
 * The local copy of a candidate's work.
 *
 * There was already a `writeLocalAnswerBuffer` that wrote to localStorage on
 * every keystroke, and **nothing ever read it back**. Meanwhile the UI said
 * "your work is saved locally and will retry automatically" and, when a final
 * submit could not be confirmed, "your work is stored locally on this
 * device". Both were false: on restart the room restored from the *server*
 * draft only, so anything the network had not accepted was gone.
 *
 * This module is the read side, and the decision of which copy wins.
 *
 * The store is injected rather than reaching for `localStorage` so the
 * decision logic is testable, following `violation-queue-core.ts`.
 */

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** An editor tab. Mirrors the room's own file shape. */
export type BufferedFile = { id: string; name: string; content: string };

export type BufferedAnswer = {
  language: string;
  files: BufferedFile[];
  activeFileId: string;
  savedAtMs: number;
  /** The draft revision this buffer was written *against*. Compared with the
   * server's to decide which is newer — see `chooseRestore`. */
  revision: number;
};

/** What the server holds for this problem, as far as we know. */
export type ServerDraft = {
  source: string;
  language: string;
  client_revision: number;
};

export type RestoreChoice = "buffer" | "server" | "same" | "none";

const PREFIX = "ams_contest_answer_buffer";

export function bufferKey(sessionId: string, questionId: string): string {
  return `${PREFIX}:${sessionId}:${questionId}`;
}

export function write(
  store: KeyValueStore,
  sessionId: string,
  questionId: string,
  answer: BufferedAnswer
): void {
  try {
    store.setItem(bufferKey(sessionId, questionId), JSON.stringify(answer));
  } catch {
    // A full or unavailable store must never interrupt typing. The server
    // draft is still the primary path; this is the belt.
  }
}

export function read(
  store: KeyValueStore,
  sessionId: string,
  questionId: string
): BufferedAnswer | null {
  let raw: string | null;
  try {
    raw = store.getItem(bufferKey(sessionId, questionId));
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<BufferedAnswer>;
    if (!Array.isArray(parsed.files) || typeof parsed.language !== "string") return null;
    return {
      language: parsed.language,
      files: parsed.files as BufferedFile[],
      activeFileId: typeof parsed.activeFileId === "string" ? parsed.activeFileId : "",
      savedAtMs: typeof parsed.savedAtMs === "number" ? parsed.savedAtMs : 0,
      revision: typeof parsed.revision === "number" ? parsed.revision : 0,
    };
  } catch {
    // Truncated or hand-edited. Treated as absent rather than thrown: a
    // corrupt buffer must not stop the room from loading.
    return null;
  }
}

export function clear(store: KeyValueStore, sessionId: string, questionId: string): void {
  try {
    store.removeItem(bufferKey(sessionId, questionId));
  } catch {
    // Nothing to do; a stale buffer loses to the server on revision anyway.
  }
}

/** The content of the tab the candidate was last editing. */
export function activeContent(answer: BufferedAnswer): string {
  const active = answer.files.find((file) => file.id === answer.activeFileId);
  return (active ?? answer.files[0])?.content ?? "";
}

/**
 * Which copy to open the editor with.
 *
 * Revision-ordered, not time-ordered. The buffer records the revision it was
 * written against, so a buffer ahead of the server is work the server never
 * accepted — exactly what is lost when the network drops — and a buffer
 * behind it is stale, which happens when the candidate worked on another
 * machine or the same draft was saved from elsewhere.
 *
 * Wall-clock times are not used to break the tie: the buffer's timestamp
 * comes from a clock the candidate controls, and preferring it would let a
 * backdated buffer overwrite accepted work.
 */
export function chooseRestore(
  buffered: BufferedAnswer | null,
  serverDraft: ServerDraft | null
): RestoreChoice {
  if (!buffered) return serverDraft ? "server" : "none";
  if (!serverDraft) return "buffer";

  if (buffered.revision > serverDraft.client_revision) return "buffer";
  if (buffered.revision < serverDraft.client_revision) return "server";

  // Same revision. Identical content is the common case — a clean save — and
  // must not announce a restore. Differing content at the same revision means
  // the write was in flight when the app died, so the buffer is the later of
  // the two.
  return activeContent(buffered) === serverDraft.source ? "same" : "buffer";
}

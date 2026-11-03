// This identifier deduplicates a setup attempt. Only the server can authorize it.
export const SETUP_ATTEMPT_KEY = "ams_setup_entry_attempt";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let mustStartFresh = false;

export function setupAttemptId(
  storage: Storage,
  contestId: string,
  uuid: () => string,
  fresh = false
): string {
  const raw = storage.getItem(SETUP_ATTEMPT_KEY);
  let saved;
  try {
    saved = JSON.parse(raw ?? "null");
  } catch {
    saved = null;
  }
  if (!fresh && !mustStartFresh && saved?.contestId === contestId && UUID.test(saved?.id ?? ""))
    return saved.id;
  const id = uuid();
  if (!UUID.test(id)) throw new Error("Could not identify this setup attempt.");
  // Persist before sending: a timed-out authorization may have reached the server.
  storage.setItem(SETUP_ATTEMPT_KEY, JSON.stringify({ contestId, id }));
  mustStartFresh = false;
  return id;
}

export function clearSetupAttempt(storage: Storage): void {
  // A failed removal must not let this document reuse the old authorized attempt.
  mustStartFresh = true;
  storage.removeItem(SETUP_ATTEMPT_KEY);
}

export type AuthorizedSession = {
  uid: string;
  contest_uid: string;
  status: string;
  entry_attempt_id?: string | null;
};

export function assertSetupAuthorization(
  session: AuthorizedSession,
  contestId: string,
  attemptId: string,
  sessionId?: string
): void {
  if (
    !session.uid ||
    !["pending", "active"].includes(session.status) ||
    session.contest_uid !== contestId ||
    session.entry_attempt_id !== attemptId ||
    (sessionId && session.uid !== sessionId)
  ) {
    throw new Error(
      "The server could not authorize this setup attempt. Ask your invigilator for help before continuing."
    );
  }
}

export type SetupAccess<S, R> =
  { kind: "ready"; session: S } | { kind: "approval"; sessionId: string; request: R | null };

/** The POST response is authority. Neither a local nonce nor a GET approval grants setup. */
export async function authorizeSetupEntry<S extends AuthorizedSession, R>(
  context: { contestId: string; attemptId: string },
  ports: { start: () => Promise<S>; latest: (sessionId: string) => Promise<R | null> }
): Promise<SetupAccess<S, R>> {
  let session: S;
  try {
    session = await ports.start();
  } catch (error) {
    const failure = error as { status?: number; code?: string; detail?: { session_uid?: unknown } };
    if (
      failure?.status !== 409 ||
      failure.code !== "REENTRY_APPROVAL_REQUIRED" ||
      typeof failure.detail?.session_uid !== "string" ||
      !failure.detail.session_uid
    )
      throw error;
    const sessionId = failure.detail.session_uid;
    return { kind: "approval", sessionId, request: await ports.latest(sessionId) };
  }
  assertSetupAuthorization(session, context.contestId, context.attemptId);
  return { kind: "ready", session };
}

/** Single owner across duplicate clicks/effect replay. No timers or automatic retries. */
export function createSetupAuthorization<T>() {
  let pending: Promise<T> | null = null;
  let generation = 0;
  let pendingKey = "";
  return {
    run(start: () => Promise<T>, key = ""): Promise<T> {
      if (pending && key === pendingKey) return pending;
      generation++;
      pendingKey = key;
      const current = generation;
      const request = Promise.resolve().then(start);
      pending = request.finally(() => {
        if (current === generation) pending = null;
      });
      return pending;
    },
    invalidate() {
      generation++;
      pending = null;
    },
  };
}

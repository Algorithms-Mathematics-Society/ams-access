import {
  SETUP_ATTEMPT_KEY,
  assertSetupAuthorization,
  type AuthorizedSession,
} from "./setup-authorization.ts";

export const SETUP_HANDOFF_KEY = "ams_completed_setup_handoff";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export type SetupHandoff = { contestId: string; sessionId: string; entryAttemptId: string };
const revoked = new WeakSet<Storage>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function matchesAttempt(storage: Storage, handoff: SetupHandoff): boolean {
  const attempt = JSON.parse(storage.getItem(SETUP_ATTEMPT_KEY) ?? "null");
  return Boolean(
    handoff.contestId &&
    handoff.sessionId &&
    UUID.test(handoff.entryAttemptId) &&
    attempt?.contestId === handoff.contestId &&
    attempt?.id === handoff.entryAttemptId
  );
}

/** Call only after all setup checks and the final server authorization succeed. */
export function markSetupHandoff(storage: Storage, handoff: SetupHandoff): void {
  if (!matchesAttempt(storage, handoff)) throw new Error("Setup attempt changed. Repeat setup.");
  storage.setItem(SETUP_HANDOFF_KEY, JSON.stringify(handoff));
  revoked.delete(storage);
}

/** A local completion record, never server authorization or proof of native lockdown. */
export function readSetupHandoff(
  storage: Storage,
  contestId: string,
  sessionId: string
): SetupHandoff | null {
  try {
    if (revoked.has(storage)) return null;
    const saved = JSON.parse(storage.getItem(SETUP_HANDOFF_KEY) ?? "null");
    if (
      saved?.contestId !== contestId ||
      saved?.sessionId !== sessionId ||
      !matchesAttempt(storage, saved)
    )
      return null;
    return { contestId, sessionId, entryAttemptId: saved.entryAttemptId };
  } catch {
    return null;
  }
}

export function clearSetupHandoff(storage: Storage): void {
  // Revoke even if storage removal fails. A same-window direct URL must fail closed.
  revoked.add(storage);
  try {
    storage.removeItem(SETUP_HANDOFF_KEY);
  } catch {
    /* Already revoked in memory. */
  }
}

/** One POST per mounted context, including effect replay and paper-load retries. No polling. */
export function createSetupHandoffValidator() {
  let key = "";
  let result: Promise<void> | null = null;
  return (
    handoff: SetupHandoff,
    authGeneration: number,
    start: () => Promise<AuthorizedSession>,
    isCurrent: () => boolean
  ): Promise<void> => {
    const nextKey = JSON.stringify([
      handoff.contestId,
      handoff.sessionId,
      handoff.entryAttemptId,
      authGeneration,
    ]);
    if (result && key === nextKey) return result;
    key = nextKey;
    result = Promise.resolve().then(async () => {
      if (!isCurrent()) throw new Error("Setup context changed.");
      const session = await start();
      if (!isCurrent()) throw new Error("Setup context changed.");
      assertSetupAuthorization(
        session,
        handoff.contestId,
        handoff.entryAttemptId,
        handoff.sessionId
      );
    });
    return result;
  };
}

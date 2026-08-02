/**
 * The app's proctoring-event queue: the durable core wired to real storage
 * and the real API.
 *
 * All the behaviour lives in `violation-queue-core.ts`, which takes its
 * storage and transport as parameters — the failure modes that matter
 * (offline, quota exhausted, corrupt storage, concurrent flush) are all
 * awkward to reach through the real ones.
 */

import { reportEvents } from "./proctor-api";
import { ViolationQueue, type QueuedEvent, type StoredEvent } from "./violation-queue-core";

// A queue is bound to one session, but the session id is only known after
// login — so the queue is created lazily and rebound if the session changes.
let queue: ViolationQueue | null = null;
let boundSession: string | null = null;

// Server-Side Rendering has no localStorage. An in-memory fallback keeps the
// module importable during a build rather than throwing at module scope.
const memory = new Map<string, string>();
const store =
  typeof localStorage !== "undefined"
    ? localStorage
    : {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => void memory.set(k, v),
      };

function forSession(sessionUid: string): ViolationQueue {
  if (queue === null || boundSession !== sessionUid) {
    boundSession = sessionUid;
    queue = new ViolationQueue(store, (events: StoredEvent[]) =>
      reportEvents(sessionUid, events),
    );
  }
  return queue;
}

/** Record an event locally. Never throws — callers are detectors. */
export function enqueue(sessionUid: string, event: QueuedEvent): void {
  forSession(sessionUid).enqueue(event);
}

export function pendingCount(sessionUid: string): number {
  return forSession(sessionUid).pendingCount();
}

export async function flush(sessionUid: string): Promise<number> {
  return forSession(sessionUid).flush();
}

/** For a clean exit: try once, but never block leaving the exam. */
export async function flushBeforeExit(sessionUid: string): Promise<void> {
  try {
    await flush(sessionUid);
  } catch {
    // The queue is durable; whatever is left goes out on the next launch.
  }
}

export function clear(sessionUid: string): void {
  forSession(sessionUid).clear();
}

/**
 * The durable part of proctoring-event delivery, with no dependencies.
 *
 * Exam-centre networks drop. If a violation is reported with a bare `fetch`
 * and that call fails, the record is gone — and the events most likely to
 * coincide with a network problem are exactly the ones worth keeping
 * (someone pulling a cable, disabling an adapter, tethering to a phone).
 *
 * Events are therefore persisted first and removed only once the server has
 * acknowledged them. Delivery is at-least-once: the server may see a
 * duplicate when a response is lost in flight, which is the right way round.
 * A duplicated violation is noise in a review; a dropped one is a hole in the
 * record that nobody knows about.
 *
 * Storage and transport are injected so this can be exercised without a
 * browser or a network — the failure modes that matter here (offline, quota
 * exhausted, corrupt storage, concurrent flush) are all awkward to reach
 * through the real ones.
 */

export const STORAGE_KEY = "ams.proctor.pending-events";

/** Above this the oldest are dropped: a stuck detector could otherwise fill
 * storage and take the exam UI down, losing the whole record rather than
 * part of it. */
export const MAX_PENDING = 1000;

/** Per flush. Matches the server's own cap on a batch. */
export const MAX_BATCH = 200;

export type QueuedEvent = {
  kind: string;
  severity?: "info" | "warning" | "critical";
  detail?: string;
  evidence?: Record<string, unknown>;
  occurred_at?: string;
};

export type StoredEvent = QueuedEvent & { occurred_at: string };

/** Just the two methods used, so a Map-backed fake is a complete stand-in. */
export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Rejects with `{ permanent: true }` when retrying can never succeed. */
export type SendBatch = (events: StoredEvent[]) => Promise<unknown>;

export function isPermanentFailure(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (typeof status !== "number") return false;
  // 429 is a request to slow down, not a refusal — retry it.
  return status >= 400 && status < 500 && status !== 429;
}

export class ViolationQueue {
  private flushing = false;
  private readonly store: KeyValueStore;
  private readonly send: SendBatch;
  private readonly now: () => Date;

  // Fields are declared and assigned rather than using parameter properties:
  // those emit code rather than only types, so Node's strip-only TypeScript
  // mode — which is what runs these tests — refuses them.
  constructor(store: KeyValueStore, send: SendBatch, now: () => Date = () => new Date()) {
    this.store = store;
    this.send = send;
    this.now = now;
  }

  read(): StoredEvent[] {
    try {
      const raw = this.store.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as StoredEvent[]) : [];
    } catch {
      // Corrupt storage must not wedge the queue permanently.
      return [];
    }
  }

  private write(events: StoredEvent[]): void {
    try {
      this.store.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch {
      // Quota exceeded, or private browsing. Losing durability is bad;
      // throwing inside a violation handler and taking down the detector
      // that fired it is worse.
    }
  }

  /** Record an event. Safe to call from a detector's hot path. */
  enqueue(event: QueuedEvent): void {
    const pending = this.read();
    pending.push({
      ...event,
      // Stamped at detection, not delivery. The server keeps this as the
      // client's *claim* and timestamps the row itself, so a wrong local
      // clock cannot rewrite when something happened.
      occurred_at: event.occurred_at ?? this.now().toISOString(),
    });

    // Drop oldest first: recent events describe the state the candidate is
    // in now, which is what an invigilator acts on.
    this.write(pending.length > MAX_PENDING ? pending.slice(-MAX_PENDING) : pending);
  }

  pendingCount(): number {
    return this.read().length;
  }

  clear(): void {
    this.write([]);
  }

  /**
   * Deliver what is queued. Returns how many the server accepted.
   *
   * Safe to call on a timer: overlapping calls collapse, because two flushes
   * in flight would send the same events twice for no benefit.
   */
  async flush(): Promise<number> {
    if (this.flushing) return 0;

    const pending = this.read();
    if (pending.length === 0) return 0;

    this.flushing = true;
    try {
      const batch = pending.slice(0, MAX_BATCH);
      await this.send(batch);

      // Re-read rather than reusing `pending`: a detector may have enqueued
      // more while the request was in flight, and those must survive.
      this.write(this.read().slice(batch.length));
      return batch.length;
    } catch (error) {
      if (isPermanentFailure(error)) {
        // The server refused this batch and always will — a malformed event,
        // or a session that no longer accepts them. Retrying forever would
        // block every later event behind it, so drop it and keep going.
        const current = this.read();
        this.write(current.slice(Math.min(MAX_BATCH, current.length)));
      }
      // Anything else (offline, 5xx, timeout) stays queued for next time.
      return 0;
    } finally {
      this.flushing = false;
    }
  }
}

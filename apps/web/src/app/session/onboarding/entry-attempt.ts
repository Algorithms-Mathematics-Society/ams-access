/** UI deadlines never cancel native operations. Keep pending keys until their
 * actual promise settles so retry cannot overlap a still-running native scan. */
export class EntryCancelledError extends Error {}
export class EntryTimeoutError extends Error {}

export type EntryAdvisoryResult<T> =
  | { status: "completed"; value: T }
  | { status: "failed"; error: unknown }
  | { status: "timed_out"; error: EntryTimeoutError };

type Clock = {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
};

export function createEntryAttemptController(
  clock: Clock = {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (timer) => clearTimeout(timer),
  }
) {
  let available = false;
  let generation = 0;
  let active: number | null = null;
  const pending = new Set<string>();
  const cancellations = new Set<() => void>();
  const advisoryCancellations = new Map<number, Set<() => void>>();
  const committedAttempts = new Set<number>();
  const current = (attempt: number) => available && active === attempt;
  return {
    activate() {
      available = true;
    },
    begin() {
      if (!available || active !== null) return null;
      active = ++generation;
      return active;
    },
    current,
    assertSettled(key: string) {
      if (pending.has(key))
        throw new EntryTimeoutError(
          `The previous ${key} is still finishing or restoring controls. Wait a moment, then retry.`
        );
    },
    /** Required acquisition with rollback ownership until the attempt commits.
     * Cleanup runs immediately on abandonment and again after late settlement.
     * Call assertSettled before any retry probes that share this resource. */
    async runResource<T>(
      attempt: number,
      key: string,
      start: () => Promise<T>,
      ms: number,
      cleanup: () => Promise<void>
    ): Promise<T> {
      this.assertSettled(key);
      const result = await this.runAdvisory(
        attempt,
        key,
        start,
        ms,
        `${key} timed out. Retry contest entry.`,
        cleanup,
        true
      );
      if (result.status !== "completed") throw result.error;
      return result.value;
    },
    commit(attempt: number) {
      if (active !== attempt) return;
      committedAttempts.add(attempt);
      for (const cancel of advisoryCancellations.get(attempt) ?? []) cancellations.delete(cancel);
      advisoryCancellations.delete(attempt);
    },
    finish(attempt: number) {
      if (active !== attempt) return;
      for (const cancel of advisoryCancellations.get(attempt) ?? []) cancel();
      advisoryCancellations.delete(attempt);
      active = null;
    },
    cancel() {
      available = false;
      active = null;
      for (const cancel of [...cancellations]) cancel();
    },
    async run<T>(
      attempt: number,
      key: string,
      start: () => Promise<T>,
      ms: number,
      message: string
    ): Promise<T> {
      if (!current(attempt)) throw new EntryCancelledError();
      if (pending.has(key))
        throw new EntryTimeoutError(
          `The previous ${key} is still finishing. Wait a moment, then retry.`
        );
      pending.add(key);
      const operation = Promise.resolve().then(() => {
        if (!current(attempt)) throw new EntryCancelledError();
        return start();
      });
      void operation.then(
        () => pending.delete(key),
        () => pending.delete(key)
      );
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (complete: () => void) => {
          if (settled) return;
          settled = true;
          clock.clearTimeout(timer);
          cancellations.delete(cancel);
          complete();
        };
        const cancel = () => finish(() => reject(new EntryCancelledError()));
        const timer = clock.setTimeout(
          () => finish(() => reject(new EntryTimeoutError(message))),
          ms
        );
        cancellations.add(cancel);
        operation.then(
          (value) =>
            finish(() => (current(attempt) ? resolve(value) : reject(new EntryCancelledError()))),
          (error) => finish(() => reject(current(attempt) ? error : new EntryCancelledError()))
        );
      });
    },
    async runAdvisory<T>(
      attempt: number,
      key: string,
      start: () => Promise<T>,
      ms: number,
      message: string,
      onCancelled?: () => Promise<void> | void,
      cleanupAfterSettlement = false
    ): Promise<EntryAdvisoryResult<T>> {
      if (!current(attempt)) throw new EntryCancelledError();
      if (pending.has(key))
        return {
          status: "timed_out",
          error: new EntryTimeoutError(
            `The previous ${key} is still finishing. Entry will continue with a warning.`
          ),
        };

      pending.add(key);
      let attemptCancelled = false;
      let cancelledBeforeSettlement = false;
      let operationSettled = false;
      let cleanupChain: Promise<void> | null = null;
      const queueCleanup = () => {
        if (!onCancelled || committedAttempts.has(attempt))
          return cleanupChain ?? Promise.resolve();
        pending.add(key);
        const invokeCleanup = () => {
          try {
            return Promise.resolve(onCancelled()).then(() => undefined);
          } catch {
            return Promise.resolve();
          }
        };
        cleanupChain = cleanupChain
          ? cleanupChain.then(invokeCleanup).catch(() => {})
          : invokeCleanup().catch(() => {});
        return cleanupChain;
      };
      const markCancelled = () => {
        if (attemptCancelled || committedAttempts.has(attempt)) return;
        attemptCancelled = true;
        cancelledBeforeSettlement = !operationSettled;
        const cleanupDone = queueCleanup();
        if (operationSettled) void cleanupDone.then(() => pending.delete(key));
      };
      cancellations.add(markCancelled);
      const attemptCancellations = advisoryCancellations.get(attempt) ?? new Set<() => void>();
      attemptCancellations.add(markCancelled);
      advisoryCancellations.set(attempt, attemptCancellations);

      const operation = Promise.resolve().then(() => {
        if (!current(attempt)) throw new EntryCancelledError();
        return start();
      });
      void operation.then(
        async () => {
          operationSettled = true;
          if (attemptCancelled && cancelledBeforeSettlement && cleanupAfterSettlement)
            await queueCleanup();
          await (cleanupChain ?? Promise.resolve());
          pending.delete(key);
        },
        async () => {
          operationSettled = true;
          if (!committedAttempts.has(attempt)) await queueCleanup();
          await (cleanupChain ?? Promise.resolve());
          pending.delete(key);
        }
      );

      return new Promise<EntryAdvisoryResult<T>>((resolve, reject) => {
        let settled = false;
        const finish = (complete: () => void) => {
          if (settled) return;
          settled = true;
          clock.clearTimeout(timer);
          cancellations.delete(rejectCancelled);
          complete();
        };
        const rejectCancelled = () => finish(() => reject(new EntryCancelledError()));
        const timer = clock.setTimeout(
          () =>
            finish(() => resolve({ status: "timed_out", error: new EntryTimeoutError(message) })),
          ms
        );
        cancellations.add(rejectCancelled);
        operation.then(
          (value) =>
            finish(() =>
              attemptCancelled || !current(attempt)
                ? reject(new EntryCancelledError())
                : resolve({ status: "completed", value })
            ),
          (error) =>
            finish(() =>
              attemptCancelled || !current(attempt)
                ? reject(new EntryCancelledError())
                : resolve({ status: "failed", error })
            )
        );
      });
    },
  };
}

export async function refreshEntryValue<T>(
  cached: T,
  refresh: () => Promise<EntryAdvisoryResult<T>>
): Promise<T> {
  const result = await refresh();
  return result.status === "completed" ? result.value : cached;
}

/** Device enumeration describes hardware, not permission or decoded frames. */
export function entryMediaFacts(options: {
  cameraDelivering: boolean;
  cameraAttempted: boolean;
  devices: ReadonlyArray<{ kind: string }> | null;
}) {
  return {
    cameraAvailable: options.cameraDelivering ? true : options.cameraAttempted ? false : null,
    microphoneAvailable:
      options.devices === null
        ? null
        : options.devices.some((device) => device.kind === "audioinput"),
  };
}

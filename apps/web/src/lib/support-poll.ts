/** Visible support reads only: one request, bounded jitter and server-directed cooldowns. */
export type SupportPollRuntime = {
  document: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
  now: () => number;
  random: () => number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};
export function startSupportPolling(
  task: (signal: AbortSignal) => Promise<unknown>,
  options: { minimumMs?: number; maximumMs?: number } = {},
  runtime: SupportPollRuntime = {
    document,
    window,
    now: Date.now,
    random: Math.random,
    setTimeout,
    clearTimeout,
  }
): () => void {
  const minimum = options.minimumMs ?? 8000;
  const maximum = options.maximumMs ?? 12000;
  let stopped = false,
    running = false,
    halted = false,
    failures = 0,
    notBefore = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const clear = () => {
    if (timer !== undefined) runtime.clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (delay: number) => {
    clear();
    if (!stopped && !halted && !runtime.document.hidden)
      timer = runtime.setTimeout(
        () => void run(),
        Math.min(2147483647, Math.max(0, delay, notBefore - runtime.now()))
      );
  };
  const run = async () => {
    if (stopped || halted || running || runtime.document.hidden) return;
    clear();
    if (runtime.now() < notBefore) {
      schedule(notBefore - runtime.now());
      return;
    }
    running = true;
    controller = new AbortController();
    let delay = minimum + runtime.random() * (maximum - minimum);
    try {
      await task(controller.signal);
      failures = 0;
    } catch (error) {
      const failure = error as { status?: number; retryAfterMs?: number } | null;
      halted = [401, 403, 404].includes(failure?.status ?? 0);
      failures += 1;
      const ceiling = Math.min(60000, 4000 * 2 ** Math.min(failures, 4));
      delay = Math.max(ceiling * (0.5 + runtime.random() * 0.5), failure?.retryAfterMs ?? 0);
      notBefore = runtime.now() + delay;
    } finally {
      running = false;
      controller = undefined;
      schedule(delay);
    }
  };
  const wake = () => {
    if (runtime.document.hidden) {
      clear();
      return;
    }
    if (!running) schedule(runtime.random() * 2000);
  };
  runtime.document.addEventListener("visibilitychange", wake);
  runtime.window.addEventListener("online", wake);
  runtime.window.addEventListener("focus", wake);
  void run();
  return () => {
    stopped = true;
    clear();
    controller?.abort();
    runtime.document.removeEventListener("visibilitychange", wake);
    runtime.window.removeEventListener("online", wake);
    runtime.window.removeEventListener("focus", wake);
  };
}

export function supportRetryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}
export class SupportRequestError extends Error {
  status: number;
  retryAfterMs: number;
  constructor(message: string, status: number, retryAfterMs = 0) {
    super(message);
    this.name = "SupportRequestError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

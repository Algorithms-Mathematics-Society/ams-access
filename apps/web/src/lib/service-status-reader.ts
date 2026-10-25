import {
  boundedJson,
  EMPTY_STATUS,
  parseReport,
  responseTime,
  reportTime,
  timestamp,
  type Snapshot,
} from "./service-status.ts";
export type StatusEnvironment = {
  fetch: typeof fetch;
  now: () => number;
  random: () => number;
  visible: () => boolean;
  online: () => boolean;
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (id: ReturnType<typeof setTimeout>) => void;
};
/** One owner per window; subscribers never own polling timers. */
export class ServiceStatusReader {
  private value: Snapshot = EMPTY_STATUS;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private flight: Promise<void> | undefined;
  private lastAttempt = -Infinity;
  private nextAttempt = 0;
  private failures = 0;
  private etag: string | null = null;
  private generation = 0;
  private clockFloor: { time: number; receivedAt: number } | null = null;
  private url: string;
  private env: StatusEnvironment;
  constructor(url: string, env: StatusEnvironment) {
    this.url = url;
    this.env = env;
  }
  snapshot = () => this.value;
  private emit(patch: Partial<Snapshot> = {}) {
    this.value = { ...this.value, ...patch, now: this.env.now() };
    this.listeners.forEach((fn) => fn());
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    if (this.listeners.size === 1) this.wake();
    return () => {
      this.listeners.delete(fn);
      if (!this.listeners.size) {
        this.generation++;
        this.controller?.abort();
        this.controller = undefined;
        this.flight = undefined;
        if (this.timer) this.env.clearTimer(this.timer);
        this.timer = undefined;
        this.value = { ...this.value, checking: false };
      }
    };
  };
  wake = () => {
    if (this.timer) this.env.clearTimer(this.timer);
    this.timer = undefined;
    this.emit({ offline: !this.env.online() });
    if (!this.listeners.size || !this.env.online() || !this.env.visible()) return;
    const earliest = Math.max(this.nextAttempt, this.lastAttempt + 30000);
    if (earliest <= this.env.now()) this.nextAttempt = this.env.now() + this.env.random() * 2000;
    else this.nextAttempt = earliest;
    this.schedule();
  };
  private schedule() {
    if (this.timer) this.env.clearTimer(this.timer);
    if (!this.listeners.size || !this.env.visible() || !this.env.online()) return;
    const eligibleAt = Math.max(this.nextAttempt, this.lastAttempt + 30000);
    // Expire authority at the exact monotonic boundary, independently of polling.
    const serverNow = reportTime({ ...this.value, now: this.env.now() });
    const boundaries =
      this.value.report && serverNow !== null
        ? [
            timestamp(this.value.report.valid_until),
            ...this.value.report.incidents.map((i) => timestamp(i.next_update_at)),
          ]
            .map((t) => t - serverNow)
            .filter((t) => t > 0)
        : [];
    const boundary = boundaries.length ? Math.min(...boundaries) : Infinity;
    // Only leaf subscribers rerender; no editor or countdown ancestor updates.
    this.timer = this.env.setTimer(
      () => {
        this.timer = undefined;
        this.emit();
        if (this.env.now() >= eligibleAt) void this.check();
        else this.schedule();
      },
      Math.max(1, Math.min(boundary, eligibleAt - this.env.now()))
    );
  }
  check = (): Promise<void> => {
    if (this.flight) return this.flight;
    if (
      !this.listeners.size ||
      !this.env.online() ||
      !this.env.visible() ||
      this.env.now() < Math.max(this.lastAttempt + 30000, this.nextAttempt)
    ) {
      this.schedule();
      return Promise.resolve();
    }
    this.lastAttempt = this.env.now();
    const generation = ++this.generation,
      controller = new AbortController();
    this.controller = controller;
    this.emit({ checking: true, offline: false });
    let retryAfter = 0;
    const operation = async () => {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          (async () => {
            const response = await this.env.fetch(this.url, {
              credentials: "omit",
              cache: "no-store",
              redirect: "error",
              signal: controller.signal,
              headers: this.etag ? { "If-None-Match": this.etag } : {},
            });
            const retry = response.headers.get("retry-after");
            if (retry) {
              const serverNow = responseTime(response.headers);
              const delay = /^\d+$/.test(retry)
                ? Number(retry) * 1000
                : serverNow === null
                  ? 0
                  : Date.parse(retry) - serverNow;
              if (Number.isFinite(delay)) retryAfter = Math.min(300000, Math.max(0, delay));
            }
            if (response.status !== 304 && !response.ok) throw Error("Status unavailable");
            const report =
              response.status === 304
                ? this.value.report
                : parseReport(await boundedJson(response));
            if (!report || (this.value.report && report.revision < this.value.report.revision))
              throw Error("Older status");
            if (
              this.value.report &&
              report.revision === this.value.report.revision &&
              JSON.stringify(report) !== JSON.stringify(this.value.report)
            )
              throw Error("Revision reused");
            return {
              report,
              serverTime: responseTime(response.headers),
              etag: response.headers.get("etag"),
            };
          })(),
          new Promise<never>((_, reject) => {
            deadline = this.env.setTimer(() => {
              controller.abort();
              reject(Error("Status deadline"));
            }, 4000);
          }),
        ]);
        if (generation !== this.generation) return;
        this.failures = 0;
        this.etag = result.etag;
        const now = this.env.now();
        const previousTime = this.clockFloor
          ? this.clockFloor.time + Math.max(0, now - this.clockFloor.receivedAt)
          : null;
        const serverTime =
          result.serverTime === null
            ? null
            : Math.max(result.serverTime, previousTime ?? result.serverTime);
        if (serverTime !== null) this.clockFloor = { time: serverTime, receivedAt: now };
        this.emit({
          report: result.report,
          // A cached response cannot move established server time backwards.
          serverTime,
          receivedAt: this.env.now(),
          checked: true,
          failed: false,
        });
      } catch {
        if (generation !== this.generation) return;
        this.failures++;
        this.emit({ checked: true, failed: true });
      } finally {
        if (deadline) this.env.clearTimer(deadline);
        if (generation === this.generation) {
          const active = this.value.report?.incidents.some((i) => i.state !== "resolved");
          const delay = this.failures
            ? Math.min(300000, 60000 * 2 ** Math.min(this.failures - 1, 3))
            : active
              ? 60000
              : 120000;
          this.nextAttempt =
            this.env.now() +
            Math.min(300000, Math.max(retryAfter, delay * (0.8 + this.env.random() * 0.4)));
          this.flight = undefined;
          this.controller = undefined;
          this.emit({ checking: false });
          this.schedule();
        }
      }
    };
    this.flight = operation();
    return this.flight;
  };
  /** Error transitions may accelerate idle polling, never bypass failure backoff. */
  localFailure = () => {
    if (!this.failures) this.nextAttempt = Math.min(this.nextAttempt, this.lastAttempt + 30000);
    this.wake();
  };
}

/** Bounded participant leaderboard projection, separate from the shared team lobby. */
export type LiveTeam = {
  uid: string;
  name: string;
  rank: number;
  score: number;
  solved: number;
  integrationPassed: boolean;
  performance: null | {
    score: number | null;
    medianNs: number | null;
    iqrNs: number | null;
    revision: number | null;
    pending: boolean;
  };
};
export type LiveBoard = { teams: LiveTeam[]; benchmarked: boolean };
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const nonnegative = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const integer = (v: unknown): v is number => nonnegative(v) && Number.isSafeInteger(v);
const nullableNumber = (v: unknown) => v === null || nonnegative(v);
export function parseLiveBoard(raw: unknown): LiveBoard | null {
  if (!object(raw) || !Array.isArray(raw.teams) || raw.teams.length > 3000) return null;
  const teams: LiveTeam[] = [],
    ids = new Set<string>();
  for (const row of raw.teams) {
    if (
      !object(row) ||
      typeof row.uid !== "string" ||
      !row.uid ||
      row.uid.length > 100 ||
      ids.has(row.uid) ||
      typeof row.name !== "string" ||
      row.name.length > 300 ||
      !integer(row.rank) ||
      row.rank < 1 ||
      !nonnegative(row.score) ||
      !integer(row.solved) ||
      typeof row.integration_passed !== "boolean"
    )
      return null;
    ids.add(row.uid);
    let performance: LiveTeam["performance"] = null;
    if (row.performance !== null && row.performance !== undefined) {
      const p = row.performance;
      if (
        !object(p) ||
        !nullableNumber(p.score) ||
        !nullableNumber(p.median_ns) ||
        !nullableNumber(p.iqr_ns) ||
        !(p.revision === null || integer(p.revision)) ||
        typeof p.pending !== "boolean"
      )
        return null;
      performance = {
        score: p.score as number | null,
        medianNs: p.median_ns as number | null,
        iqrNs: p.iqr_ns as number | null,
        revision: p.revision as number | null,
        pending: p.pending,
      };
    }
    teams.push({
      uid: row.uid,
      name: row.name,
      rank: row.rank,
      score: row.score,
      solved: row.solved,
      integrationPassed: row.integration_passed,
      performance,
    });
  }
  return { teams, benchmarked: object(raw.benchmark) };
}
export type LiveBoardState = {
  board: LiveBoard | null;
  status: "loading" | "ready" | "retrying" | "denied";
};
export function startLiveBoardPolling(options: {
  url: string;
  headers: () => Record<string, string>;
  onState: (state: LiveBoardState) => void;
  request?: typeof fetch;
  isCurrent: () => boolean;
  random?: () => number;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
}) {
  const schedule = options.schedule ?? setTimeout,
    cancel = options.cancel ?? clearTimeout;
  const jitter = () =>
    Math.floor(Math.max(0, Math.min(1, (options.random ?? Math.random)())) * 500);
  let stopped = false,
    terminal = false,
    failures = 0,
    etag: string | null = null;
  let board: LiveBoard | null = null,
    timer: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | null = null;
  const emit = (status: LiveBoardState["status"]) => {
    if (!stopped && options.isCurrent()) options.onState({ board, status });
  };
  async function poll() {
    if (stopped || terminal || active || !options.isCurrent()) return;
    const controller = new AbortController();
    active = controller;
    const timeout = schedule(() => controller.abort(), 8000);
    let delay = 5000;
    try {
      const response = await (options.request ?? fetch)(options.url, {
        headers: { ...options.headers(), ...(etag ? { "If-None-Match": etag } : {}) },
        signal: controller.signal,
        cache: "no-store",
      });
      if (stopped || !options.isCurrent()) return;
      if (response.status === 401 || response.status === 403) {
        terminal = true;
        board = null;
        emit("denied");
        return;
      }
      if (response.status === 304 && board) {
        failures = 0;
        emit("ready");
      } else if (response.ok) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty board");
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 2_000_000) {
            await reader.cancel();
            throw new Error("Board too large");
          }
          chunks.push(next.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        const parsed = parseLiveBoard(JSON.parse(new TextDecoder().decode(bytes)));
        if (!parsed) throw new Error("Invalid board");
        if (stopped || !options.isCurrent()) return;
        board = parsed;
        etag = response.headers.get("ETag");
        failures = 0;
        emit("ready");
      } else {
        const retry = response.headers.get("Retry-After");
        const seconds =
          retry && /^\d+$/.test(retry)
            ? Number(retry)
            : retry
              ? Math.max(0, (Date.parse(retry) - Date.now()) / 1000)
              : 0;
        if (Number.isFinite(seconds))
          delay = Math.max(delay, Math.min(seconds * 1000, 2_147_000_000));
        throw new Error("Board unavailable");
      }
    } catch {
      if (!stopped && options.isCurrent()) {
        failures += 1;
        delay = Math.max(delay, Math.min(5000 * 2 ** Math.min(failures, 4), 60000));
        emit("retrying");
      }
    } finally {
      cancel(timeout);
      active = null;
      if (!stopped && !terminal && options.isCurrent())
        timer = schedule(() => void poll(), delay + jitter());
    }
  }
  emit("loading");
  timer = schedule(() => void poll(), jitter());
  return () => {
    stopped = true;
    if (timer !== undefined) cancel(timer);
    active?.abort();
  };
}

import { parseTeamVote, voteRemainingMs, type TeamVote } from "./team-vote.ts";
/** Published participant projection only. Never infer allocation from local actions. */
export type TeamLobbyBoard = {
  team: {
    uid: string;
    name: string;
    number: number;
  };
  members: {
    member_uid?: string;
    display_name: string;
    is_me: boolean;
    part_label: string | null;
    assigned_by: string | null;
  }[];
  parts: {
    label: string;
    problem_label: string;
    title?: string;
    summary?: string;
    holder: string | null;
    holder_is_me: boolean;
    revision: number | null;
    submission_status: string | null;
    verdict: string | null;
    integration_verdict?: string;
  }[];
  phase: {
    name: "waiting" | "discussion" | "choosing" | "locked";
    starts_at?: string;
    voice_open: boolean;
    selection_opens_at: string;
    claims_open_at: string;
    prompt: string;
    discussion_seconds: number;
  };
  allocation: {
    locked: boolean;
    locks_at: string | null;
  };
  submission?: TeamVote;
  server_time: string;
};
export type LobbyState = {
  board: TeamLobbyBoard | null;
  status: "loading" | "team" | "solo" | "unpublished" | "error" | "wrong-contest" | "denied";
  pending: boolean;
  error: string | null;
  sampledAt: number;
  /** Date.now() at the same sample, so time a Mac spent asleep is counted. */
  sampledWallAt?: number;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && [...v].length <= max;
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
export function parseTeamLobby(v: unknown): TeamLobbyBoard {
  if (
    !object(v) ||
    !object(v.team) ||
    !string(v.team.uid, 64) ||
    !string(v.team.name, 200) ||
    !Number.isInteger(v.team.number) ||
    !Array.isArray(v.members) ||
    v.members.length < 1 ||
    v.members.length > 5 ||
    !Array.isArray(v.parts) ||
    v.parts.length < 1 ||
    v.parts.length > 5 ||
    !object(v.phase) ||
    !["waiting", "discussion", "choosing", "locked"].includes(String(v.phase.name)) ||
    typeof v.phase.voice_open !== "boolean" ||
    !date(v.phase.selection_opens_at) ||
    !date(v.phase.claims_open_at) ||
    !(v.phase.starts_at === undefined || date(v.phase.starts_at)) ||
    !string(v.phase.prompt, 1000) ||
    !Number.isFinite(v.phase.discussion_seconds) ||
    !object(v.allocation) ||
    typeof v.allocation.locked !== "boolean" ||
    !(v.allocation.locks_at === null || date(v.allocation.locks_at)) ||
    !date(v.server_time)
  )
    throw new Error("Team status unavailable.");
  const nullable = (x: unknown, max: number) => x === null || string(x, max);
  if (
    !v.members.every(
      (m) =>
        object(m) &&
        string(m.display_name, 200) &&
        (m.member_uid === undefined || string(m.member_uid, 64)) &&
        typeof m.is_me === "boolean" &&
        nullable(m.part_label, 64) &&
        nullable(m.assigned_by, 64)
    ) ||
    v.members.filter((m) => m.is_me).length !== 1 ||
    !v.parts.every(
      (p) =>
        object(p) &&
        string(p.label, 64) &&
        typeof p.problem_label === "string" &&
        p.problem_label.length <= 64 &&
        nullable(p.holder, 200) &&
        typeof p.holder_is_me === "boolean" &&
        (p.revision === null || Number.isInteger(p.revision)) &&
        nullable(p.submission_status, 64) &&
        nullable(p.verdict, 64)
    ) ||
    new Set(v.members.filter((m) => m.member_uid !== undefined).map((m) => m.member_uid)).size !==
      v.members.filter((m) => m.member_uid !== undefined).length ||
    new Set(v.parts.map((p) => p.label)).size !== v.parts.length
  )
    throw new Error("Team status unavailable.");
  // Retain only the small lobby projection, never integration/history payloads.
  const source = v as TeamLobbyBoard;
  const submission = parseTeamVote(v);
  return {
    team: { uid: source.team.uid, name: source.team.name, number: source.team.number },
    members: source.members.map(({ member_uid, display_name, is_me, part_label, assigned_by }) => ({
      ...(member_uid ? { member_uid } : {}),
      display_name,
      is_me,
      part_label,
      assigned_by,
    })),
    parts: source.parts.map(
      ({
        label,
        problem_label,
        title,
        summary,
        holder,
        holder_is_me,
        revision,
        submission_status,
        verdict,
        integration_verdict,
      }) => ({
        label,
        problem_label,
        ...(string(title, 300) && title.trim() ? { title } : {}),
        ...(string(summary, 400) && summary.trim() ? { summary } : {}),
        holder,
        holder_is_me,
        revision,
        submission_status,
        verdict,
        ...(string(integration_verdict, 64) ? { integration_verdict } : {}),
      })
    ),
    phase: {
      name: source.phase.name,
      voice_open: source.phase.voice_open,
      selection_opens_at: source.phase.selection_opens_at,
      claims_open_at: source.phase.claims_open_at,
      ...(source.phase.starts_at ? { starts_at: source.phase.starts_at } : {}),
      prompt: source.phase.prompt,
      discussion_seconds: source.phase.discussion_seconds,
    },
    allocation: { locked: source.allocation.locked, locks_at: source.allocation.locks_at },
    ...(submission ? { submission } : {}),
    server_time: source.server_time,
  };
}
export function nextDeadline(board: TeamLobbyBoard): string | null {
  return board.phase.name === "waiting"
    ? board.phase.selection_opens_at
    : board.phase.name === "discussion"
      ? board.phase.claims_open_at
      : board.phase.name === "choosing"
        ? board.allocation.locks_at
        : null;
}
export function countdownMs(
  board: TeamLobbyBoard,
  sampledAt: number,
  now = performance.now()
): number | null {
  const deadline = nextDeadline(board);
  return deadline
    ? Math.max(
        0,
        Date.parse(deadline) - Date.parse(board.server_time) - Math.max(0, now - sampledAt)
      )
    : null;
}
/** One shared team/voice source per authorized identity. Owner must stop on auth changes.
 * Completion scheduled: 3–5s visible (~750 GET/s at 3,000 clients, 1,000/s
 * interval upper bound), 15s hidden (200/s), plus one wake per server deadline,
 * initial loads and explicit mutations/conflict refreshes. ETags save payload only.
 */
export function createTeamLobbyController(options: {
  apiBase: string;
  contestUid: string;
  headers: () => Record<string, string>;
  hidden: () => boolean;
  onState: (state: LobbyState) => void;
  request?: typeof fetch;
  now?: () => number;
  wallNow?: () => number;
  random?: () => number;
}) {
  const request = options.request ?? fetch,
    now = options.now ?? (() => performance.now()),
    wallNow = options.wallNow ?? (() => Date.now());
  const url = `${options.apiBase.replace(/\/$/, "")}/participant/contests/${encodeURIComponent(options.contestUid)}/team`;
  let state: LobbyState = {
    board: null,
    status: "loading",
    pending: false,
    error: null,
    sampledAt: now(),
    sampledWallAt: wallNow(),
  };
  let stopped = false,
    busy = false,
    terminal = false,
    etag: string | null = null,
    // Cleared once a conditional GET fails at the network layer: a CORS
    // preflight that refuses If-None-Match must not fail every other poll.
    conditional = true,
    timer: ReturnType<typeof setTimeout> | undefined,
    active: AbortController | undefined,
    queued = false,
    forceRefresh = false,
    deadlineWoken: string | null = null;
  const emit = (patch: Partial<LobbyState>) => {
    if (!stopped) {
      state = { ...state, ...patch };
      options.onState(state);
    }
  };
  const schedule = () => {
    if (stopped || terminal) return;
    clearTimeout(timer);
    let delay = options.hidden()
      ? 15000
      : 3000 + Math.floor(Math.max(0, Math.min(1, (options.random ?? Math.random)())) * 2000);
    const deadline = state.board && nextDeadline(state.board);
    if (deadline && deadline !== deadlineWoken) {
      const remaining = countdownMs(state.board!, state.sampledAt, now())!;
      if (remaining <= delay) {
        delay = Math.max(250, remaining + 100);
        deadlineWoken = deadline;
      }
    }
    timer = setTimeout(() => void run(), delay);
  };
  async function run(
    action?: "claim" | "release" | "approve" | "withdraw",
    label?: string,
    revision?: number
  ) {
    if (stopped || terminal) return;
    if (busy) {
      if (!action) queued = true;
      return;
    }
    busy = true;
    if (!action && forceRefresh) {
      etag = null;
      forceRefresh = false;
    }
    clearTimeout(timer);
    active = new AbortController();
    const controller = active;
    const timeout = setTimeout(() => controller.abort(), 8000);
    const sentEtag = !action && conditional && etag !== null;
    if (action) emit({ pending: true, error: null });
    try {
      const voteAction = action === "approve" || action === "withdraw";
      const suffix = voteAction
        ? `/vote${action === "withdraw" ? `?revision=${revision}` : ""}`
        : action
          ? `/${action}`
          : "";
      const response = await request(url + suffix, {
        method: action === "withdraw" ? "DELETE" : action ? "POST" : "GET",
        headers: {
          ...options.headers(),
          ...(action
            ? { "Content-Type": "application/json" }
            : sentEtag
              ? { "If-None-Match": etag! }
              : {}),
        },
        ...(action === "claim" ? { body: JSON.stringify({ part_label: label }) } : {}),
        ...(action === "approve" ? { body: JSON.stringify({ revision }) } : {}),
        signal: controller.signal,
        cache: "no-store",
      });
      if (stopped) return;
      if (response.status === 304) return;
      const body: unknown = await response.json().catch(() => null);
      if (stopped) return;
      if (!response.ok) {
        // The token names another contest: terminal, and only signing in
        // again can help, so no error text is shown here (#326).
        if (
          response.status === 403 &&
          object(body) &&
          body.detail === "this token is for another contest"
        ) {
          terminal = true;
          emit({ board: null, status: "wrong-contest", error: null });
          return;
        }
        if (response.status === 401 || response.status === 403) {
          terminal = true;
          emit({
            board: null,
            status: "denied",
            error:
              response.status === 401
                ? "Your sign-in has expired. Exit and sign in again."
                : "You do not have access to this team in this contest. Use Help to contact your organizer, or exit.",
          });
          return;
        }
        if (!action && response.status === 404 && object(body)) {
          if (body.detail === "this contest is not a team round") {
            terminal = true;
            emit({ board: null, status: "solo", error: null });
            return;
          }
          if (body.detail === "teams have not been published yet") {
            emit({ board: null, status: "unpublished", error: null });
            return;
          }
        }
        const detail =
          object(body) && string(body.detail, 500)
            ? body.detail
            : "Team status unavailable. Please try again.";
        if (action && response.status === 409) queued = true;
        throw new Error(
          voteAction
            ? response.status === 409 && /deadline has passed/.test(detail)
              ? "The team submission deadline has passed. Your team's current revision is submitted at the deadline."
              : response.status === 409
                ? "The team revision or approval changed. Review the updated count before approving again."
                : "Could not update your approval. Check the current revision and try again."
            : detail
        );
      }
      const board = parseTeamLobby(body);
      etag = action ? null : response.headers.get("ETag");
      emit({
        board,
        status: "team",
        error: null,
        sampledAt: now(),
        sampledWallAt: wallNow(),
      });
    } catch (error) {
      etag = null;
      if (sentEtag && error instanceof TypeError) {
        // Retry at once without the conditional header instead of failing.
        conditional = false;
        queued = true;
        return;
      }
      emit({
        error:
          error instanceof Error && error.name !== "AbortError"
            ? error.message
            : "Team request timed out. Please try again.",
        ...(action ? {} : { status: "error" as const }),
      });
    } finally {
      clearTimeout(timeout);
      active = undefined;
      busy = false;
      if (action) emit({ pending: false });
      if (queued && !stopped && !terminal) {
        queued = false;
        const message = state.error;
        await run();
        if (message) emit({ error: message });
      } else schedule();
    }
  }
  function vote(action: "approve" | "withdraw", revision: number) {
    const board = state.board,
      submission = board?.submission;
    if (busy && !state.pending && !stopped && !terminal) {
      emit({ error: "Team status is updating. Review it and try your approval again." });
      return;
    }
    if (
      stopped ||
      terminal ||
      busy ||
      state.pending ||
      state.status !== "team" ||
      !board ||
      !submission ||
      !board.allocation.locked ||
      revision !== submission.revision ||
      revision === 0 ||
      submission.submitted_revision === revision ||
      voteRemainingMs(
        submission,
        board.server_time,
        state.sampledAt,
        now(),
        state.sampledWallAt,
        wallNow()
      ) <= 0 ||
      (action === "approve" ? submission.mine : !submission.mine)
    )
      return;
    void run(action, undefined, revision);
  }
  emit({});
  void run();
  return {
    refresh: () => {
      forceRefresh = true;
      etag = null;
      void run();
    },
    claim: (label: string) => {
      if (
        state.pending ||
        busy ||
        state.status !== "team" ||
        state.board?.phase.name !== "choosing" ||
        state.board.allocation.locked ||
        !state.board.parts.some((p) => p.label === label && p.holder === null)
      )
        return;
      void run("claim", label);
    },
    release: () => {
      if (
        state.pending ||
        busy ||
        state.status !== "team" ||
        state.board?.phase.name !== "choosing" ||
        state.board.allocation.locked ||
        !state.board.members.some((m) => m.is_me && m.part_label)
      )
        return;
      void run("release");
    },
    approve: (revision: number) => vote("approve", revision),
    withdraw: (revision: number) => vote("withdraw", revision),
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      active?.abort();
    },
  };
}
/** What a client that cannot run team rooms must know before it loads a paper. */
export type TeamRoundProbe = "solo" | "team" | "defer" | "wrong-contest" | "error";
/** Shown when the probe proves the sign-in was issued for another contest. */
export const TEAM_WRONG_CONTEST_MESSAGE =
  "This sign-in is for a different contest. Sign in again with the details for this contest.";
/** Only the exact "not a team round" 404 proves a solo contest. A 200, an
 * unpublished-teams 404 and a not-on-a-team 403 all prove a team round. A 403
 * "this token is for another contest" is "wrong-contest": the token names a
 * different contest, so only signing in again can help. Any
 * other 4xx (a 401, another 403 or 404, a 400) is "defer": the probe proves
 * nothing, but the server gave a definite answer, so the caller lets its normal
 * load and its own error handling run; it never proves a solo contest. A
 * network failure, 408, 429, any 5xx or anything else is "error" and must be
 * retried, never treated as solo.
 */
export function classifyTeamRoundProbe(status: number, body: unknown): TeamRoundProbe {
  if (status === 200) return "team";
  const detail = object(body) ? body.detail : undefined;
  if (status === 404 && detail === "this contest is not a team round") return "solo";
  if (status === 404 && detail === "teams have not been published yet") return "team";
  if (status === 403 && detail === "you are not on a team in this round") return "team";
  if (status === 403 && detail === "this token is for another contest") return "wrong-contest";
  if (status === 408 || status === 429) return "error";
  if (status >= 400 && status < 500) return "defer";
  return "error";
}
/** One GET of the team endpoint, classified. Never throws: a network failure,
 * abort or timeout is "error". The caller owns the signal and any retry.
 */
export async function probeTeamRound(options: {
  apiBase: string;
  contestUid: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  request?: typeof fetch;
}): Promise<TeamRoundProbe> {
  const request = options.request ?? fetch;
  const url = `${options.apiBase.replace(/\/$/, "")}/participant/contests/${encodeURIComponent(options.contestUid)}/team`;
  try {
    const response = await request(url, {
      method: "GET",
      headers: options.headers,
      signal: options.signal,
      cache: "no-store",
    });
    if (response.status === 200) return "team";
    const body: unknown = await response.json().catch(() => null);
    return classifyTeamRoundProbe(response.status, body);
  } catch {
    return "error";
  }
}
/** Probes until the round is known, then reports it once. One request is in
 * flight at a time and each is aborted after 8 s. An "error" is retried after
 * 2 s, 4 s, 8 s, then every 15 s, each plus up to 1 s of jitter. A later round
 * (a re-probe after a non-solo pass) waits min(2000 * 2^(round-1), 15000) plus
 * jitter first, so a server that keeps refusing cannot drive a tight loop. A
 * result that arrives after stop() or once isCurrent() is false is dropped.
 * Returns stop(), which cancels any pending timer and aborts any request.
 */
export function startTeamRoundProbeLoop<Handle>(options: {
  probe: (signal: AbortSignal) => Promise<TeamRoundProbe>;
  round: number;
  isCurrent: () => boolean;
  onResult: (result: Exclude<TeamRoundProbe, "error">) => void;
  setTimeout: (fn: () => void, ms: number) => Handle;
  clearTimeout: (handle: Handle | undefined) => void;
  random: () => number;
}): () => void {
  const { probe, round, isCurrent, onResult, random } = options;
  const schedule = options.setTimeout;
  const cancel = options.clearTimeout;
  let stopped = false;
  let attempt = 0;
  let timer: Handle | undefined;
  let active: AbortController | undefined;
  const run = async () => {
    if (stopped || active) return;
    const controller = new AbortController();
    active = controller;
    const timeout = schedule(() => controller.abort(), 8000);
    const result = await probe(controller.signal);
    cancel(timeout);
    active = undefined;
    if (stopped || !isCurrent()) return;
    if (result === "error") {
      // Unknown is never solo: keep waiting and retry, bounded.
      const delay = attempt < 3 ? 2000 * 2 ** attempt : 15_000;
      attempt += 1;
      timer = schedule(() => void run(), delay + Math.floor(random() * 1000));
      return;
    }
    onResult(result);
  };
  if (round > 0)
    timer = schedule(
      () => void run(),
      Math.min(2000 * 2 ** (round - 1), 15_000) + Math.floor(random() * 1000)
    );
  else void run();
  return () => {
    stopped = true;
    cancel(timer);
    active?.abort();
  };
}

/** Start countdown uses the shared server sample and monotonic elapsed time. */
export function contestStartRemaining(
  startsAt: string | null,
  board: TeamLobbyBoard,
  sampledAt: number,
  now = performance.now()
): number | null {
  startsAt = board.phase.starts_at ?? startsAt;
  if (!startsAt || !Number.isFinite(Date.parse(startsAt))) return null;
  return Math.max(
    0,
    Date.parse(startsAt) - Date.parse(board.server_time) - Math.max(0, now - sampledAt)
  );
}

/** Single-flight schedule refresh while waiting. At most one request per 30–45s,
 * plus one jittered check at the start boundary; stops once the server confirms start.
 * 3,000 waiting clients add at most 100 requests/s averaged over 30 seconds.
 */
export function watchContestStart(options: {
  request: () => Promise<{ starts_at: string; server_time: string }>;
  onValue: (startsAt: string, started: boolean) => void;
  onError: () => void;
  random?: () => number;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  async function refresh() {
    try {
      const metadata = await options.request();
      if (stopped) return;
      const remaining = Date.parse(metadata.starts_at) - Date.parse(metadata.server_time);
      if (!Number.isFinite(remaining)) throw new Error("Invalid contest clock");
      options.onValue(metadata.starts_at, remaining <= 0);
      if (remaining > 0) {
        const jitter = Math.max(0, Math.min(1, (options.random ?? Math.random)()));
        timer = schedule(
          () => void refresh(),
          Math.min(30000 + jitter * 15000, remaining + 250 + jitter * 1000)
        );
      }
    } catch {
      if (!stopped) options.onError();
    }
  }
  void refresh();
  return () => {
    stopped = true;
    if (timer !== undefined) cancel(timer);
  };
}

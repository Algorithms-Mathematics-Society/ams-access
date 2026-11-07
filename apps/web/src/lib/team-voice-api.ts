/** Minimal published-team projection: GET /team owns the voice window. */
export type VoiceTeam = {
  team: { uid: string; name: string };
  members: { display_name: string; is_me: boolean }[];
  phase: { voice_open: boolean; name: string };
};
export type TeamVoiceRead =
  | { kind: "team"; team: VoiceTeam; etag: string | null }
  | { kind: "unchanged" }
  | { kind: "solo" }
  | { kind: "unpublished" };

export async function readVoiceTeam(
  apiBase: string,
  contestUid: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  etag?: string | null,
  request: typeof fetch = fetch
): Promise<TeamVoiceRead> {
  const response = await request(
    `${apiBase.replace(/\/$/, "")}/participant/contests/${encodeURIComponent(contestUid)}/team`,
    {
      headers: { ...headers, ...(etag ? { "If-None-Match": etag } : {}) },
      signal,
      cache: "no-store",
    }
  );
  if (response.status === 304) return { kind: "unchanged" };
  if (response.status === 404) {
    const body = await response.json().catch(() => null);
    // Both are currently 404. Never mistake an unpublished team for a solo contest.
    if (body?.detail === "this contest is not a team round") return { kind: "solo" };
    if (body?.detail === "teams have not been published yet") return { kind: "unpublished" };
  }
  if (!response.ok) throw new Error(`Team voice status unavailable (${response.status})`);
  const team = (await response.json()) as VoiceTeam;
  if (
    typeof team?.phase?.voice_open !== "boolean" ||
    !Array.isArray(team.members) ||
    !team.team?.uid
  )
    throw new Error("Team voice status unavailable");
  return { kind: "team", team, etag: response.headers.get("ETag") };
}

export function voicePollDelay(hidden: boolean, random = Math.random): number {
  return hidden ? 15_000 : 3_000 + Math.floor(Math.max(0, Math.min(1, random())) * 2_000);
}

/** Completion-scheduled polling: no overlapping requests, one deadline per request. */
export function pollVoiceTeam(options: {
  read: (signal: AbortSignal, etag: string | null) => Promise<TeamVoiceRead>;
  onRead: (result: TeamVoiceRead) => void;
  onError: () => void;
  hidden: () => boolean;
  random?: () => number;
}) {
  let stopped = false;
  let etag: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: AbortController | undefined;
  async function tick() {
    pending = new AbortController();
    const deadline = setTimeout(() => pending?.abort(), 8_000);
    let terminal = false;
    try {
      const result = await options.read(pending.signal, etag);
      if (stopped) return;
      if (result.kind === "team") etag = result.etag;
      terminal = result.kind === "solo";
      options.onRead(result);
    } catch {
      etag = null;
      if (!stopped) options.onError();
    } finally {
      clearTimeout(deadline);
      pending = undefined;
      if (!stopped && !terminal)
        timer = setTimeout(tick, voicePollDelay(options.hidden(), options.random));
    }
  }
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    pending?.abort();
  };
}

/** Clone shared proctoring audio; release of the returned stream cannot stop it. */
export async function acquireVoiceMicrophone(shared: MediaStream | null): Promise<MediaStream> {
  const track = shared?.getAudioTracks().find((item) => item.readyState === "live");
  if (track) return new MediaStream([track.clone()]);
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
}

export async function readVoiceCredentials(
  apiBase: string,
  contestUid: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  request: typeof fetch = fetch
): Promise<{ ice_servers: RTCIceServer[]; expires_at: number; ttl_seconds?: number }> {
  const response = await request(
    `${apiBase.replace(/\/$/, "")}/participant/contests/${encodeURIComponent(contestUid)}/team/voice/credentials`,
    { headers, signal, cache: "no-store" }
  );
  if (!response.ok) throw new Error("Voice relay credentials unavailable");
  return response.json();
}

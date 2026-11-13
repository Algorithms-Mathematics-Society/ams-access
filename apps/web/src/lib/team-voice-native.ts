/** Linux audio stays in the private helper. No browser media objects cross this boundary. */
export type NativeVoiceEvent = {
  v: 1;
  event: "ice" | "negotiation" | "state" | "ended";
  session: string;
  peer?: string;
  candidate?: { candidate: string; sdpMLineIndex: number; sdpMid?: string | null };
  state?: string;
};

type NativeRequest =
  | { op: "peer_create"; session: string; peer: string; ice_servers: RTCIceServer[]; expires_at: number }
  | { op: "peer_close"; session: string; peer: string }
  | { op: "local_description"; session: string; peer: string; type: "offer" | "answer"; ice_restart?: boolean }
  | { op: "remote_description"; session: string; peer: string; description: RTCSessionDescriptionInit }
  | { op: "ice"; session: string; peer: string; candidate: RTCIceCandidateInit }
  | { op: "configure"; session: string; peer: string; ice_servers: RTCIceServer[]; expires_at: number }
  | { op: "mute"; session: string; muted: boolean }
  | { op: "volume"; session: string; peer: string; volume: number }
  | { op: "stats"; session: string; peer: string }
  | { op: "keepalive"; session: string };

type Bridge = {
  core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen(name: string, listener: (event: { payload: NativeVoiceEvent }) => void): Promise<() => void> };
};

// A fresh backend may start only after the previous helper has acknowledged stop.
let nativeTransition: Promise<void> = Promise.resolve();

export type NativeVoiceBackend = {
  start(onEvent: (event: NativeVoiceEvent) => void): Promise<string>;
  stop(): void;
  call<T = Record<string, never>>(request: NativeRequest): Promise<T>;
  stats(peer: string): Promise<number | null>;
};

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const native = window.__TAURI__ as (typeof window.__TAURI__ & { event?: Bridge["event"] }) | undefined;
  if (!native?.core?.invoke || !native.event?.listen) return null;
  return native as Bridge;
}

export async function probeLinuxVoice(): Promise<boolean> {
  const native = bridge();
  if (!native) return false;
  try {
    const capability = await native.core.invoke<{ available?: boolean; backend?: string }>("linux_voice_probe");
    return capability.available === true && capability.backend === "gstreamer";
  } catch {
    return false;
  }
}

export function createLinuxVoiceBackend(): NativeVoiceBackend {
  const native = bridge();
  if (!native) throw new Error("Native team voice is unavailable.");
  const client = native;
  let session = "";
  let unlisten: (() => void) | null = null;
  let closed = false;
  let pending = 0;
  let queue = Promise.resolve();
  let earlyEnd: NativeVoiceEvent | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let heartbeatPending = false;
  const peerEpoch = new Map<string, number>();
  async function call<T>(request: NativeRequest): Promise<T> {
    if (closed || !session || request.session !== session) throw new Error("Native voice session ended.");
    if (pending >= 32) throw new Error("Native voice queue full.");
    const peer = "peer" in request ? request.peer : null;
    let epoch = peer ? (peerEpoch.get(peer) ?? 0) : 0;
    if (peer && (request.op === "peer_create" || request.op === "peer_close")) {
      epoch++;
      peerEpoch.set(peer, epoch);
    }
    pending++;
    const task = queue.then(() => {
      if (closed || request.session !== session) throw new Error("Native voice session ended.");
      if (peer && request.op !== "peer_close" && peerEpoch.get(peer) !== epoch)
        throw new Error("Native voice peer was replaced.");
      return client.core.invoke<T>("linux_voice_call", { request });
    });
    queue = task.then(() => undefined, () => undefined);
    try {
      return await task;
    } finally {
      pending--;
    }
  }
  return {
    async start(onEvent) {
      if (closed || session) throw new Error("Native voice already started.");
      const previous = nativeTransition;
      let release!: () => void;
      nativeTransition = new Promise<void>((resolve) => { release = resolve; });
      try {
        await previous;
        if (closed) throw new Error("Native voice session ended.");
        unlisten = await native.event.listen("linux-team-voice", ({ payload }) => {
          if (closed || payload?.v !== 1) return;
          if (payload.session === session) onEvent(payload);
          else if (!session && payload.event === "ended") earlyEnd = payload;
        });
        if (closed) throw new Error("Native voice session ended.");
        const result = await native.core.invoke<{ session: string }>("linux_voice_start");
        if (closed) {
          if (result?.session) await native.core.invoke("linux_voice_stop", { session: result.session }).catch(() => {});
          throw new Error("Native voice session ended.");
        }
        if (!result?.session || typeof result.session !== "string") throw new Error("Invalid native voice session.");
        session = result.session;
        if (earlyEnd?.session === session) {
          await client.core.invoke("linux_voice_stop", { session }).catch(() => {});
          session = "";
          throw new Error("Native audio stopped during startup.");
        }
        earlyEnd = null;
        heartbeat = globalThis.setInterval(() => {
          if (closed || !session || heartbeatPending) return;
          const current = session;
          heartbeatPending = true;
          void call({ op: "keepalive", session: current })
            .catch(() => {
              if (!closed && session === current)
                onEvent({ v: 1, event: "ended", session: current });
            })
            .finally(() => { heartbeatPending = false; });
        }, 5_000);
        return session;
      } catch (error) {
        unlisten?.();
        unlisten = null;
        throw error;
      } finally {
        release();
      }
    },
    stop() {
      if (closed) return;
      closed = true;
      if (heartbeat) globalThis.clearInterval(heartbeat);
      heartbeat = null;
      unlisten?.();
      unlisten = null;
      const ending = session;
      session = "";
      if (ending) {
        // Stop immediately so the microphone cannot keep sending while an RPC
        // is stalled. Wait for both the stop acknowledgement and queue drain
        // before a replacement helper starts.
        const stopped = client.core.invoke("linux_voice_stop", { session: ending }).then(() => {}, () => {});
        nativeTransition = Promise.all([nativeTransition, queue, stopped]).then(() => {});
      }
    },
    call,
    async stats(peer) {
      if (pending) return null;
      const result = await call<{ audioLevel: number | null }>({ op: "stats", session, peer });
      return typeof result.audioLevel === "number" ? result.audioLevel : null;
    },
  };
}

import { createVoiceInputMeter } from "./team-voice-input.ts";
/** Bounded, relay-only team audio. This module owns only microphone clones. */
export type TeamVoiceCredentials = {
  ice_servers: RTCIceServer[];
  expires_at: number;
  ttl_seconds?: number;
};
export type TeamVoicePeer = {
  memberUid: string;
  displayName: string;
  muted: boolean;
  speaking: boolean;
  stream: MediaStream | null;
  volume: number;
};
export type TeamVoiceSnapshot = {
  status:
    "idle" | "connecting" | "connected" | "reconnecting" | "unavailable" | "closed" | "replaced";
  muted: boolean;
  inputLevel?: number | null;
  volume: number;
  outputDevice: string;
  error: string | null;
  peers: TeamVoicePeer[];
};
export type TeamVoiceOptions = {
  contestUid: string;
  apiBase: string;
  token?: string;
  getToken?: () => string | Promise<string>;
  /** Must return an OWNED clone, never the proctor's original stream. */
  acquireMicrophone: () => Promise<MediaStream>;
  refreshCredentials?: () => Promise<TeamVoiceCredentials>;
  deps?: Partial<TeamVoiceDeps>;
};
export type TeamVoiceDeps = {
  inputMeter: typeof createVoiceInputMeter;
  socket: (url: string) => WebSocket;
  rtc: (configuration: RTCConfiguration) => RTCPeerConnection;
  audio: () => HTMLAudioElement;
  stream: (tracks: MediaStreamTrack[]) => MediaStream;
  now: () => number;
  random: () => number;
  timeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  fetch: typeof fetch;
};
export type TeamVoiceSession = {
  start(): Promise<void>;
  stop(): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number, memberUid?: string): void;
  setMemberVolume(memberUid: string, volume: number): void;
  retryPlayback(): Promise<void>;
  setOutputDevice(deviceId: string): Promise<void>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): TeamVoiceSnapshot;
};
type Peer = {
  view: TeamVoicePeer;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  making: boolean;
  ignore: boolean;
  answering: boolean;
  candidates: RTCIceCandidateInit[];
  sent: number;
  received: number;
  descriptions: number;
  statsPending: boolean;
  chain: Promise<void>;
};
const MAX_PEERS = 4,
  MAX_ICE = 24,
  MAX_SDP = 48_000,
  MAX_RETRIES = 6;
export function createTeamVoiceSession(options: TeamVoiceOptions): TeamVoiceSession {
  const d: TeamVoiceDeps = {
    inputMeter: createVoiceInputMeter,
    socket: (url) => new WebSocket(url),
    rtc: (config) => new RTCPeerConnection(config),
    audio: () => new Audio(),
    stream: (tracks) => new MediaStream(tracks),
    now: Date.now,
    random: Math.random,
    timeout: setTimeout,
    clearTimeout,
    fetch: (...args) => fetch(...args),
    ...options.deps,
  };
  let snapshot: TeamVoiceSnapshot = {
    status: "idle",
    muted: true,
    volume: 1,
    outputDevice: "",
    error: null,
    peers: [],
  };
  const listeners = new Set<() => void>(),
    peers = new Map<string, Peer>(),
    timers = new Set<ReturnType<typeof setTimeout>>();
  let generation = 0,
    socket: WebSocket | null = null,
    microphone: MediaStream | null = null;
  let inputMeter: ReturnType<typeof createVoiceInputMeter> | null = null;
  let me = "",
    credentials: TeamVoiceCredentials | null = null,
    retries = 0,
    active = false,
    welcomed = false;
  let lastPong = 0,
    muteSent = true,
    muteTimer = false;
  const outgoing: { raw: string; peer?: Peer }[] = [];
  let sending = false;
  function drain() {
    if (!outgoing.length) {
      sending = false;
      return;
    }
    sending = true;
    const entry = outgoing.shift()!;
    if (
      (!entry.peer || peers.get(entry.peer.view.memberUid) === entry.peer) &&
      socket?.readyState === 1 &&
      socket.bufferedAmount < 128_000
    )
      socket.send(entry.raw);
    later(drain, 100);
  }
  function emit(patch: Partial<TeamVoiceSnapshot> = {}) {
    snapshot = { ...snapshot, ...patch, peers: [...peers.values()].map((p) => ({ ...p.view })) };
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* isolate UI */
      }
    }
  }
  function later(callback: () => void, ms: number) {
    const g = generation;
    const timer = d.timeout(() => {
      timers.delete(timer);
      if (g === generation && active) callback();
    }, ms);
    timers.add(timer);
  }
  function valid(g: number, p?: Peer) {
    return active && g === generation && (!p || peers.get(p.view.memberUid) === p);
  }
  function send(message: unknown, peer?: Peer) {
    const raw = JSON.stringify(message);
    if (socket?.readyState === 1 && raw.length <= 60_000 && outgoing.length < 128) {
      outgoing.push({ raw, peer });
      if (!sending) drain();
    }
  }
  function remove(uid: string) {
    const p = peers.get(uid);
    if (!p) return;
    peers.delete(uid);
    p.pc.onicecandidate =
      p.pc.ontrack =
      p.pc.onnegotiationneeded =
      p.pc.onconnectionstatechange =
        null;
    p.pc.close();
    p.audio.pause();
    p.audio.srcObject = null;
    p.view.stream?.getTracks().forEach((t) => t.stop());
  }
  function cleanup() {
    for (const timer of timers) d.clearTimeout(timer);
    timers.clear();
    outgoing.length = 0;
    sending = false;
    muteTimer = false;
    for (const uid of peers.keys()) remove(uid);
    const old = socket;
    socket = null;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      old.close();
    }
    inputMeter?.stop();
    inputMeter = null;
    snapshot = { ...snapshot, inputLevel: null };
    microphone?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    microphone = null;
    welcomed = false;
  }
  function finish(status: TeamVoiceSnapshot["status"], error: string | null = null) {
    active = false;
    generation++;
    cleanup();
    emit({ status, error });
  }
  function disconnected() {
    if (!active) return;
    generation++;
    cleanup();
    if (retries >= MAX_RETRIES)
      return finish("unavailable", "Voice connection could not be restored.");
    emit({ status: "reconnecting" });
    const delay = Math.min(30_000, 1000 * 2 ** retries++) * (0.8 + d.random() * 0.2);
    later(() => {
      void connect();
    }, delay);
  }
  function signal(p: Peer, kind: string, data: unknown) {
    if (peers.get(p.view.memberUid) === p)
      send({ type: "signal", to: p.view.memberUid, kind, data }, p);
  }
  function work(p: Peer, task: () => Promise<void>) {
    const g = generation;
    p.chain = p.chain
      .then(async () => {
        if (valid(g, p)) await task();
      })
      .catch(() => {
        if (valid(g, p)) {
          remove(p.view.memberUid);
          emit({ error: "A teammate audio connection failed." });
        }
      });
  }
  function add(raw: Record<string, unknown>) {
    const uid = raw.member_uid;
    if (
      typeof uid !== "string" ||
      uid.length > 128 ||
      uid === me ||
      peers.has(uid) ||
      peers.size >= MAX_PEERS ||
      !credentials ||
      !microphone
    )
      return;
    const pc = d.rtc({ iceServers: credentials.ice_servers, iceTransportPolicy: "relay" });
    const audio = d.audio();
    audio.autoplay = true;
    audio.volume = snapshot.volume;
    const p: Peer = {
      pc,
      audio,
      view: {
        memberUid: uid,
        displayName: String(raw.display_name ?? "").slice(0, 160),
        muted: raw.muted === true,
        speaking: false,
        stream: null,
        volume: 1,
      },
      making: false,
      ignore: false,
      answering: false,
      candidates: [],
      sent: 0,
      received: 0,
      descriptions: 0,
      statsPending: false,
      chain: Promise.resolve(),
    };
    peers.set(uid, p);
    const g = generation;
    for (const track of microphone.getAudioTracks()) {
      const sender = pc.addTrack(track, microphone);
      work(p, async () => {
        const params = sender.getParameters();
        params.encodings = params.encodings?.length ? params.encodings : [{}];
        for (const encoding of params.encodings) encoding.maxBitrate = 32_000;
        await sender.setParameters(params);
      });
    }
    pc.onicecandidate = (event) => {
      if (valid(g, p) && event.candidate && p.sent++ < MAX_ICE)
        signal(p, "ice", event.candidate.toJSON());
    };
    pc.ontrack = (event) => {
      if (!valid(g, p) || event.track.kind !== "audio") return;
      const stream = event.streams[0] ?? d.stream([event.track]);
      p.view.stream = stream;
      audio.srcObject = stream;
      if (snapshot.outputDevice && audio.setSinkId)
        void audio.setSinkId(snapshot.outputDevice).catch(() => {});
      void audio.play().catch(() => {
        if (valid(g, p)) emit({ error: "Allow audio playback to hear your team." });
      });
      emit();
    };
    pc.onnegotiationneeded = () =>
      work(p, async () => {
        p.making = true;
        try {
          await pc.setLocalDescription();
          if (
            valid(g, p) &&
            pc.localDescription &&
            (pc.localDescription.sdp?.length ?? 0) <= MAX_SDP
          )
            signal(p, pc.localDescription.type, pc.localDescription.toJSON());
        } finally {
          p.making = false;
        }
      });
    pc.onconnectionstatechange = () => {
      if (valid(g, p) && pc.connectionState === "failed") {
        remove(uid);
        emit({ error: "A teammate audio connection failed." });
      }
    };
    emit();
  }
  function relay(raw: Record<string, unknown>) {
    const p = peers.get(String(raw.from));
    if (!p) return;
    const data = raw.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return;
    const g = generation;
    if (raw.kind === "ice") {
      if (
        typeof data.candidate !== "string" ||
        data.candidate.length > 4096 ||
        ++p.received > MAX_ICE
      )
        return;
      const candidate: RTCIceCandidateInit = {
        candidate: data.candidate,
        sdpMid: typeof data.sdpMid === "string" ? data.sdpMid.slice(0, 64) : null,
        sdpMLineIndex: Number.isInteger(data.sdpMLineIndex) ? Number(data.sdpMLineIndex) : null,
      };
      work(p, async () => {
        if (p.ignore) return;
        if (!p.pc.remoteDescription) p.candidates.push(candidate);
        else await p.pc.addIceCandidate(candidate);
      });
    } else if (
      (raw.kind === "offer" || raw.kind === "answer") &&
      data.type === raw.kind &&
      typeof data.sdp === "string" &&
      data.sdp.length <= MAX_SDP &&
      data.sdp.match(/^m=/gm)?.length === 1 &&
      /^m=audio\s/m.test(data.sdp)
    ) {
      // Bound queued descriptions too: an untrusted teammate cannot grow the promise chain.
      if (++p.descriptions > 16) return;
      work(p, async () => {
        const collision =
          data.type === "offer" && (p.making || (p.pc.signalingState !== "stable" && !p.answering));
        p.ignore = me > p.view.memberUid && collision;
        if (p.ignore) return;
        p.answering = data.type === "answer";
        try {
          await p.pc.setRemoteDescription({
            type: data.type as RTCSdpType,
            sdp: data.sdp as string,
          });
        } finally {
          p.answering = false;
        }
        if (!valid(g, p)) return;
        for (const candidate of p.candidates.splice(0)) {
          await p.pc.addIceCandidate(candidate);
          if (!valid(g, p)) return;
        }
        if (data.type === "offer") {
          await p.pc.setLocalDescription();
          if (valid(g, p) && p.pc.localDescription)
            signal(p, "answer", p.pc.localDescription.toJSON());
        }
      });
    }
  }
  function useCredentials(value: TeamVoiceCredentials) {
    if (
      !Array.isArray(value.ice_servers) ||
      value.ice_servers.length > 8 ||
      !value.ice_servers.some(
        (s) =>
          s.username &&
          s.credential &&
          (Array.isArray(s.urls) ? s.urls : [s.urls]).some(
            (u) => typeof u === "string" && /^turns?:/.test(u)
          )
      ) ||
      !Number.isFinite(value.expires_at) ||
      value.expires_at * 1000 <= d.now()
    )
      throw new Error("Team voice requires an available TURN relay.");
    credentials = value;
    for (const p of peers.values())
      p.pc.setConfiguration({ iceServers: value.ice_servers, iceTransportPolicy: "relay" });
    const g = generation;
    // One refresh per credential lifetime, no polling; failure closes rather than using expired credentials.
    later(
      () => {
        void (async () => {
          try {
            const next = options.refreshCredentials
              ? await options.refreshCredentials()
              : await fetchCredentials();
            if (!valid(g)) return;
            if (next.expires_at < value.expires_at) throw new Error("Voice credentials expired.");
            if (next.expires_at > value.expires_at) useCredentials(next);
          } catch {
            if (valid(g)) finish("unavailable", "Voice relay credentials could not be renewed.");
          }
        })();
      },
      Math.max(1000, value.expires_at * 1000 - d.now() - 60_000)
    );
    later(
      () => {
        if (credentials === value) finish("unavailable", "Voice relay credentials expired.");
      },
      value.expires_at * 1000 - d.now()
    );
  }
  async function fetchCredentials() {
    const token = (await options.getToken?.()) ?? options.token ?? "";
    const response = await d.fetch(
      `${options.apiBase.replace(/\/$/, "")}/participant/contests/${encodeURIComponent(options.contestUid)}/team/voice/credentials`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) throw new Error("Voice credentials unavailable.");
    return (await response.json()) as TeamVoiceCredentials;
  }
  function heartbeat() {
    later(() => {
      if (d.now() - lastPong > 55_000) return disconnected();
      send({ type: "ping" });
      heartbeat();
    }, 25_000);
  }
  function levels() {
    later(() => {
      const g = generation;
      for (const p of peers.values()) {
        if (p.statsPending) continue;
        p.statsPending = true;
        void p.pc
          .getStats()
          .then((stats) => {
            if (!valid(g, p)) return;
            let speaking = false;
            stats.forEach((report) => {
              if (
                report.type === "inbound-rtp" &&
                report.kind === "audio" &&
                report.audioLevel > 0.02
              )
                speaking = true;
            });
            if (p.view.speaking !== speaking) {
              p.view.speaking = speaking;
              emit();
            }
          })
          .catch(() => {})
          .finally(() => {
            p.statsPending = false;
          });
      }
      levels();
    }, 1000);
  }
  async function connect() {
    const g = generation;
    try {
      const token = (await options.getToken?.()) ?? options.token ?? "";
      if (!valid(g)) return;
      later(() => {
        if (!microphone) finish("unavailable", "Microphone request timed out.");
      }, 10_000);
      let owned: MediaStream;
      try {
        owned = await options.acquireMicrophone();
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (valid(g))
          finish(
            "unavailable",
            name === "NotAllowedError" || name === "PermissionDeniedError"
              ? "Microphone access was denied."
              : name === "NotFoundError" || name === "DevicesNotFoundError"
                ? "No microphone was found."
                : "Microphone could not be opened."
          );
        return;
      }
      if (!valid(g)) {
        owned.getTracks().forEach((t) => t.stop());
        return;
      }
      microphone = owned;
      if (!owned.getAudioTracks().length) {
        finish("unavailable", "No microphone was found.");
        return;
      }
      owned.getTracks().forEach((t) => {
        if (t.kind !== "audio") t.stop();
        else {
          t.enabled = !snapshot.muted;
          t.onended = () => {
            if (valid(g)) finish("unavailable", "Microphone disconnected.");
          };
        }
      });
      try {
        inputMeter = d.inputMeter(owned);
      } catch {
        inputMeter = null;
      }
      function sampleInput() {
        if (!valid(g)) return;
        const inputLevel = inputMeter?.read() ?? null;
        if (snapshot.inputLevel !== inputLevel) emit({ inputLevel });
        later(sampleInput, 250);
      }
      if (inputMeter) sampleInput();
      const url = new URL(
        `${options.apiBase.replace(/\/$/, "")}/participant/contests/${encodeURIComponent(options.contestUid)}/team/voice`
      );
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("token", token);
      const ws = d.socket(url.toString());
      socket = ws;
      later(() => {
        if (!welcomed) disconnected();
      }, 15_000);
      ws.onclose = (event) => {
        if (!valid(g)) return;
        if (event.code >= 4400 && event.code < 4500)
          finish(event.code === 4411 ? "replaced" : "closed");
        else disconnected();
      };
      ws.onerror = () => {
        if (valid(g)) disconnected();
      };
      ws.onmessage = (event) => {
        if (!valid(g) || typeof event.data !== "string" || event.data.length > 65_536) return;
        try {
          const raw = JSON.parse(event.data);
          if (!raw || typeof raw !== "object") return;
          if (raw.type === "replaced" || raw.type === "closed")
            return finish(raw.type === "replaced" ? "replaced" : "closed");
          if (raw.type === "welcome" && !welcomed) {
            if (typeof raw.me !== "string" || !Array.isArray(raw.peers))
              throw new Error("Invalid voice welcome.");
            useCredentials(raw);
            me = raw.me;
            welcomed = true;
            lastPong = d.now();
            muteSent = snapshot.muted;
            send({ type: snapshot.muted ? "mute" : "unmute" });
            for (const p of raw.peers.slice(0, MAX_PEERS)) add(p);
            emit({ status: "connected", error: null });
            heartbeat();
            levels();
          } else if (welcomed) {
            if (raw.type === "pong") lastPong = d.now();
            else if (raw.type === "peer-joined") {
              remove(raw.member_uid);
              add(raw);
            } else if (raw.type === "peer-left") {
              remove(raw.member_uid);
              emit();
            } else if (raw.type === "peer-muted" || raw.type === "peer-unmuted") {
              const p = peers.get(raw.member_uid);
              if (p) {
                p.view.muted = raw.type === "peer-muted";
                emit();
              }
            } else if (raw.type === "signal") relay(raw);
          }
        } catch {
          finish("unavailable", "Team voice relay is unavailable.");
        }
      };
    } catch {
      if (valid(g)) finish("unavailable", "Voice connection could not be started.");
    }
  }
  return {
    async start() {
      if (active || snapshot.status === "replaced" || snapshot.status === "closed") return;
      active = true;
      generation++;
      retries = 0;
      emit({ status: "connecting", error: null });
      await connect();
    },
    stop() {
      send({ type: "leave" });
      active = false;
      generation++;
      cleanup();
      emit({ status: "idle", error: null });
    },
    setMuted(muted) {
      inputMeter?.resume();
      microphone?.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
      emit({ muted });
      if (welcomed && !muteTimer) {
        muteTimer = true;
        later(() => {
          muteTimer = false;
          if (muteSent !== snapshot.muted) {
            muteSent = snapshot.muted;
            send({ type: muteSent ? "mute" : "unmute" });
          }
        }, 500);
      }
    },
    setVolume(volume, uid) {
      const safe = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
      if (uid) {
        const p = peers.get(uid);
        if (p) p.view.volume = safe;
      } else snapshot = { ...snapshot, volume: safe };
      for (const p of peers.values()) p.audio.volume = snapshot.volume * p.view.volume;
      emit();
    },
    setMemberVolume(uid, volume) {
      this.setVolume(volume, uid);
    },
    async retryPlayback() {
      inputMeter?.resume();
      const g = generation;
      await Promise.all([...peers.values()].map((p) => p.audio.play()));
      if (valid(g)) emit({ error: null });
    },
    async setOutputDevice(outputDevice) {
      const g = generation;
      await Promise.all(
        [...peers.values()].map((p) => {
          if (!p.audio.setSinkId) throw new Error("Output selection is unavailable.");
          return p.audio.setSinkId(outputDevice);
        })
      );
      if (g === generation) emit({ outputDevice });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
  };
}

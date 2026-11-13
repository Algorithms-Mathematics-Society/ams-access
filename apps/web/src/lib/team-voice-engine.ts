import { createVoiceInputMeter } from "./team-voice-input.ts";
import type { NativeVoiceBackend, NativeVoiceEvent } from "./team-voice-native.ts";
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
  acquireMicrophone?: () => Promise<MediaStream>;
  nativeVoice?: () => NativeVoiceBackend;
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
type PeerBase = {
  view: TeamVoicePeer;
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
type BrowserPeer = PeerBase & { kind: "browser"; pc: RTCPeerConnection; audio: HTMLAudioElement };
type NativePeer = PeerBase & {
  kind: "native";
  remoteSet: boolean;
  signalingState: "stable" | "have-local-offer" | "have-remote-offer";
  restarts: number;
  watching: boolean;
  recoveryToken: number;
  connectionState: string;
};
type Peer = BrowserPeer | NativePeer;
const MAX_PEERS = 4,
  // Fixed lifetime budget for initial negotiation plus three ICE retries.
  MAX_ICE = 24 * 4,
  MAX_SDP = 48_000,
  MAX_RETRIES = 6,
  MAX_ICE_RESTARTS = 3;
function nativeTurnServers(servers: RTCIceServer[]): RTCIceServer[] {
  return servers.flatMap((server) => {
    if (typeof server.username !== "string" || !server.username ||
      typeof server.credential !== "string" || !server.credential) return [];
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
      .filter((url): url is string => typeof url === "string" && /^turns?:/.test(url));
    return urls.length ? [{ ...server, urls }] : [];
  });
}
export function createTeamVoiceSession(options: TeamVoiceOptions): TeamVoiceSession {
  const d: TeamVoiceDeps = {
    inputMeter: createVoiceInputMeter,
    socket: (url) => new WebSocket(url),
    rtc: (config) => new RTCPeerConnection(config),
    audio: () => new Audio(),
    stream: (tracks) => new MediaStream(tracks),
    now: Date.now,
    random: Math.random,
    // Browser timer methods must not receive our dependency object as `this`.
    timeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
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
  let nativeBackend: NativeVoiceBackend | null = null;
  let nativeSession = "";
  let pendingNativeEnd: NativeVoiceEvent | null = null;
  let inputMeter: ReturnType<typeof createVoiceInputMeter> | null = null;
  let me = "",
    credentials: TeamVoiceCredentials | null = null,
    retries = 0,
    active = false,
    welcomed = false;
  let lastPong = 0,
    muteSent = true,
    muteTimer = false,
    muteIntent = 0;
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
  function announceMute() {
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
  }
  function remove(uid: string) {
    const p = peers.get(uid);
    if (!p) return;
    peers.delete(uid);
    if (p.kind === "browser") {
      p.pc.onicecandidate =
        p.pc.ontrack =
        p.pc.onnegotiationneeded =
        p.pc.onconnectionstatechange =
          null;
      p.pc.close();
      p.audio.pause();
      p.audio.srcObject = null;
      p.view.stream?.getTracks().forEach((t) => t.stop());
    } else if (nativeSession) {
      const session = nativeSession;
      const g = generation;
      void nativeBackend?.call({ op: "peer_close", session, peer: uid }).catch(() => {
        if (valid(g) && nativeSession === session)
          finish("unavailable", "Native peer could not be closed.");
      });
    }
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
    nativeSession = "";
    pendingNativeEnd = null;
    nativeBackend?.stop();
    nativeBackend = null;
    welcomed = false;
  }
  function finish(status: TeamVoiceSnapshot["status"], error: string | null = null) {
    active = false;
    generation++;
    cleanup();
    emit({ status, error, ...(options.nativeVoice ? { muted: true } : {}) });
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
  function addNative(raw: Record<string, unknown>, uid: string) {
    const p: NativePeer = {
      kind: "native",
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
      remoteSet: false,
      signalingState: "stable",
      restarts: 0,
      watching: false,
      recoveryToken: 0,
      connectionState: "new",
    };
    peers.set(uid, p);
    const session = nativeSession;
    const credential = credentials!;
    work(p, async () => {
      await nativeBackend!.call({ op: "peer_create", session, peer: uid, ice_servers: nativeTurnServers(credential.ice_servers), expires_at: credential.expires_at });
      if (!valid(generation, p)) return;
      await nativeBackend!.call({ op: "volume", session, peer: uid, volume: snapshot.volume });
    });
    emit();
  }
  function nativeOffer(p: NativePeer, iceRestart = false) {
    const g = generation;
    work(p, async () => {
      if (p.making || p.signalingState !== "stable") return;
      p.making = true;
      try {
        const description = await nativeBackend!.call<RTCSessionDescriptionInit>({
          op: "local_description", session: nativeSession, peer: p.view.memberUid,
          type: "offer", ice_restart: iceRestart,
        });
        if (valid(g, p) && description.type === "offer" && typeof description.sdp === "string" && description.sdp.length <= MAX_SDP) {
          p.signalingState = "have-local-offer";
          signal(p, "offer", description);
        }
      } finally {
        p.making = false;
      }
    });
  }
  function handleNativeEvent(g: number, event: NativeVoiceEvent) {
    if (!valid(g)) return;
    if (!nativeSession && nativeBackend && event.event === "ended") {
      pendingNativeEnd = event;
      return;
    }
    if (event.session !== nativeSession) return;
    if (event.event === "ended") return finish("unavailable", "Native audio stopped.");
    if (!event.peer) return;
    const p = peers.get(event.peer);
    if (!p || p.kind !== "native") return;
    if (event.event === "ice" && event.candidate) {
      if (event.candidate.candidate.length <= 4096 && p.sent++ < MAX_ICE)
        signal(p, "ice", event.candidate);
    } else if (event.event === "negotiation") {
      // The higher UID offers. Browser peers may offer independently; their
      // lower UID endpoint is polite, so the native endpoint never needs glare rollback.
      if (me > p.view.memberUid) nativeOffer(p);
    } else if (event.event === "state") {
      p.connectionState = event.state ?? "unknown";
      if (event.state === "connected") {
        p.restarts = 0;
        p.watching = false;
        p.recoveryToken++;
      } else if (event.state === "failed" && !p.watching) {
        const token = ++p.recoveryToken;
        const recover = () => {
          if (!valid(g, p) || p.recoveryToken !== token || p.connectionState === "connected") return;
          if (p.restarts >= MAX_ICE_RESTARTS ||
            (me > p.view.memberUid && p.signalingState !== "stable")) {
            p.watching = false;
            remove(p.view.memberUid);
            emit({ error: "A teammate audio connection failed." });
            return;
          }
          p.restarts++;
          p.watching = true;
          if (me > p.view.memberUid) nativeOffer(p, true);
          later(recover, 15_000);
        };
        recover();
      }
    }
  }
  function relayNative(p: NativePeer, raw: Record<string, unknown>) {
    const data = raw.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return;
    const g = generation;
    if (raw.kind === "ice") {
      if (typeof data.candidate !== "string" || data.candidate.length > 4096 ||
        !Number.isInteger(data.sdpMLineIndex) || Number(data.sdpMLineIndex) < 0 ||
        ++p.received > MAX_ICE) return;
      const candidate: RTCIceCandidateInit = {
        candidate: data.candidate,
        sdpMid: typeof data.sdpMid === "string" ? data.sdpMid.slice(0, 64) : null,
        sdpMLineIndex: Number(data.sdpMLineIndex),
      };
      work(p, async () => {
        if (p.ignore) return;
        if (!p.remoteSet) p.candidates.push(candidate);
        else await nativeBackend!.call({ op: "ice", session: nativeSession, peer: p.view.memberUid, candidate });
      });
    } else if ((raw.kind === "offer" || raw.kind === "answer") && data.type === raw.kind &&
      typeof data.sdp === "string" && data.sdp.length <= MAX_SDP &&
      data.sdp.match(/^m=/gm)?.length === 1 && /^m=audio\s/m.test(data.sdp)) {
      if (++p.descriptions > 16) return;
      work(p, async () => {
        const collision = data.type === "offer" && (p.making || p.signalingState !== "stable");
        p.ignore = me > p.view.memberUid && collision;
        if (p.ignore) return;
        if (collision) {
          await nativeBackend!.call({ op: "remote_description", session: nativeSession, peer: p.view.memberUid, description: { type: "rollback" } });
          p.signalingState = "stable";
        }
        await nativeBackend!.call({ op: "remote_description", session: nativeSession, peer: p.view.memberUid,
          description: { type: data.type as RTCSdpType, sdp: data.sdp as string } });
        if (!valid(g, p)) return;
        p.remoteSet = true;
        p.signalingState = data.type === "offer" ? "have-remote-offer" : "stable";
        for (const candidate of p.candidates.splice(0)) {
          await nativeBackend!.call({ op: "ice", session: nativeSession, peer: p.view.memberUid, candidate });
          if (!valid(g, p)) return;
        }
        if (data.type === "offer") {
          const answer = await nativeBackend!.call<RTCSessionDescriptionInit>({ op: "local_description", session: nativeSession,
            peer: p.view.memberUid, type: "answer" });
          if (valid(g, p) && answer.type === "answer" && typeof answer.sdp === "string" && answer.sdp.length <= MAX_SDP) {
            p.signalingState = "stable";
            signal(p, "answer", answer);
          }
        }
      });
    }
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
      (!options.nativeVoice && !microphone)
    )
      return;
    if (options.nativeVoice) return addNative(raw, uid);
    const mic = microphone;
    if (!mic) return;
    const pc = d.rtc({ iceServers: credentials.ice_servers, iceTransportPolicy: "relay" });
    const audio = d.audio();
    audio.autoplay = true;
    audio.volume = snapshot.volume;
    const p: BrowserPeer = {
      kind: "browser",
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
    for (const track of mic.getAudioTracks()) {
      const sender = pc.addTrack(track, mic);
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
    // A failed relay path is restarted on the same connection: restartIce() fires
    // negotiationneeded and perfect negotiation re-offers. Bounded per failure run.
    let restarts = 0,
      watching = false;
    const recover = () => {
      watching = false;
      if (!valid(g, p) || pc.connectionState === "connected") return;
      if (restarts >= MAX_ICE_RESTARTS || typeof pc.restartIce !== "function") {
        remove(uid);
        return emit({ error: "A teammate audio connection failed." });
      }
      restarts++;
      // Keep lifetime ICE/description limits: remote restarts use the same allowance.
      watching = true;
      later(recover, 15_000);
      try {
        pc.restartIce();
      } catch {
        remove(uid);
        emit({ error: "A teammate audio connection failed." });
      }
    };
    pc.onconnectionstatechange = () => {
      if (!valid(g, p)) return;
      if (pc.connectionState === "connected") restarts = 0;
      else if (pc.connectionState === "failed" && !watching) recover();
    };
    emit();
  }
  function relay(raw: Record<string, unknown>) {
    const p = peers.get(String(raw.from));
    if (!p) return;
    if (p.kind === "native") return relayNative(p, raw);
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
    for (const p of peers.values()) {
      if (p.kind === "browser")
        p.pc.setConfiguration({ iceServers: value.ice_servers, iceTransportPolicy: "relay" });
      else if (nativeSession)
        work(p, () => nativeBackend!.call({ op: "configure", session: nativeSession, peer: p.view.memberUid, ice_servers: nativeTurnServers(value.ice_servers), expires_at: value.expires_at }));
    }
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
        const reading = p.kind === "native"
          ? nativeBackend!.stats(p.view.memberUid).then((level) => level != null && level > 0.02)
          : p.pc.getStats().then((stats) => {
            let speaking = false;
            stats.forEach((report) => {
              if (report.type === "inbound-rtp" && report.kind === "audio" && report.audioLevel > 0.02)
                speaking = true;
            });
            return speaking;
          });
        void reading
          .then((speaking) => {
            if (!valid(g, p)) return;
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
      if (options.nativeVoice) {
        const backend = options.nativeVoice();
        nativeBackend = backend;
        const session = await backend.start((event) => handleNativeEvent(g, event));
        if (!valid(g) || nativeBackend !== backend) {
          backend.stop();
          return;
        }
        nativeSession = session;
        if (pendingNativeEnd?.session === session) {
          handleNativeEvent(g, pendingNativeEnd);
          return;
        }
        pendingNativeEnd = null;
        if (!snapshot.muted)
          await backend.call({ op: "mute", session, muted: false });
        if (!valid(g) || nativeBackend !== backend) return;
      } else {
      later(() => {
        if (!microphone) finish("unavailable", "Microphone request timed out.");
      }, 10_000);
      let owned: MediaStream;
      try {
        owned = await options.acquireMicrophone!();
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
      }
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
      const intent = ++muteIntent;
      if (nativeSession) {
        const session = nativeSession;
        const g = generation;
        if (muted) emit({ muted: true });
        void nativeBackend?.call({ op: "mute", session, muted })
          .then(() => {
            if (valid(g) && nativeSession === session && intent === muteIntent && !muted) {
              emit({ muted: false });
              announceMute();
            }
          })
          .catch(() => {
            if (valid(g) && nativeSession === session)
              finish("unavailable", "Native microphone could not be changed.");
          });
        if (!muted) return;
      }
      microphone?.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
      emit({ muted });
      announceMute();
    },
    setVolume(volume, uid) {
      const safe = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
      if (uid) {
        const p = peers.get(uid);
        if (p) p.view.volume = safe;
      } else snapshot = { ...snapshot, volume: safe };
      for (const p of peers.values()) {
        const output = snapshot.volume * p.view.volume;
        if (p.kind === "browser") p.audio.volume = output;
        else if (nativeSession) {
          const session = nativeSession;
          void nativeBackend?.call({ op: "volume", session, peer: p.view.memberUid, volume: output }).catch(() => {
            if (nativeSession === session) remove(p.view.memberUid);
          });
        }
      }
      emit();
    },
    setMemberVolume(uid, volume) {
      this.setVolume(volume, uid);
    },
    async retryPlayback() {
      inputMeter?.resume();
      const g = generation;
      await Promise.all([...peers.values()].filter((p): p is BrowserPeer => p.kind === "browser").map((p) => p.audio.play()));
      if (valid(g)) emit({ error: null });
    },
    async setOutputDevice(outputDevice) {
      if (options.nativeVoice) throw new Error("Use the system audio output setting.");
      const g = generation;
      await Promise.all(
        [...peers.values()].filter((p): p is BrowserPeer => p.kind === "browser").map((p) => {
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

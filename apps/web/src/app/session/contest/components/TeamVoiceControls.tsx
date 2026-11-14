"use client";

import { Mic, MicOff } from "lucide-react";
import { useVoiceEndedNotice } from "./VoiceEndedNotice";
import { LeaveTeamVoice } from "./LeaveTeamVoice";
import { TeamVoicePresentation } from "./TeamVoicePresentation";
import { acquireOrdinaryEscape } from "../escape-ownership";
import { voiceStatusText, voiceErrorAdvice } from "@/lib/team-voice-presentation";
import { supportsTeamDesktopWebView } from "@/lib/team-platform";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { List, ListItem } from "@astryxdesign/core/List";
import { voiceMemberRows } from "@/lib/team-voice-members";
import { Slider } from "@astryxdesign/core/Slider";
import { Selector } from "@astryxdesign/core/Selector";
import { authHeaders, participantToken } from "@/lib/candidate-auth";
import { authGeneration, subscribeAuthChanges } from "@/lib/proctor-api";
import { cameraSession } from "@/lib/camera-session";
import { resolveApiBase } from "@/lib/api-base";
import {
  acquireVoiceMicrophone,
  readVoiceCredentials,
  voiceProjectionDecision,
  type VoiceTeam,
} from "@/lib/team-voice-api";
import {
  createTeamVoiceSession,
  type TeamVoiceSession,
  type TeamVoiceSnapshot,
} from "@/lib/team-voice-engine";
import { createLinuxVoiceBackend, probeLinuxVoice } from "@/lib/team-voice-native";

/** One voice session consumes the room’s shared team projection across lobby and workspace. */
export function TeamVoiceControls({
  contestUid,
  enabled,
  suspended = false,
  projection,
  compact = false,
  toolbarTarget = null,
  lobbyTarget = null,
  membersTarget = null,
  renderMembers,
  onMembersReady,
}: {
  onMembersReady?: (ready: boolean) => void;
  membersTarget?: HTMLElement | null;
  renderMembers?: (
    snapshot: TeamVoiceSnapshot | null,
    onVolume: (uid: string, volume: number) => void
  ) => ReactNode;
  compact?: boolean;
  toolbarTarget?: HTMLElement | null;
  lobbyTarget?: HTMLElement | null;
  contestUid: string;
  enabled: boolean;
  suspended?: boolean;
  projection: { board: VoiceTeam | null; status: string; error: string | null };
}) {
  const hasMembersRenderer = Boolean(renderMembers);
  useEffect(() => {
    if (!membersTarget || !hasMembersRenderer) return;
    onMembersReady?.(true);
    return () => onMembersReady?.(false);
  }, [membersTarget, hasMembersRenderer, onMembersReady]);
  const team = projection.board;
  const endedNotice = useVoiceEndedNotice({
    contestUid,
    enabled,
    status: projection.status,
    voiceOpen: Boolean(team?.phase.voice_open),
    compact,
    toolbarTarget,
  });
  const linuxNative = typeof navigator !== "undefined" && navigator.platform === "Linux x86_64";
  const [nativeSupported, setNativeSupported] = useState(false);
  const nativeProbe = useRef<Promise<boolean> | null>(null);
  const connectPending = useRef(false);
  const supportsRtc = linuxNative ? nativeSupported : typeof RTCPeerConnection === "function";
  const [snapshot, setSnapshot] = useState<TeamVoiceSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [confirmJoin, setConfirmJoin] = useState(false);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  useEffect(() => {
    if (suspended) setConfirmJoin(false);
  }, [suspended]);
  useEffect(() => {
    if (!confirmJoin || compact || suspended) return;
    const releaseEscape = acquireOrdinaryEscape();
    const cancelJoin = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || suspendedRef.current) return;
      event.preventDefault();
      setConfirmJoin(false);
    };
    window.addEventListener("keydown", cancelJoin, true);
    return () => {
      window.removeEventListener("keydown", cancelJoin, true);
      releaseEscape();
    };
  }, [confirmJoin, compact, suspended]);
  const session = useRef<TeamVoiceSession | null>(null);
  const current = useRef<() => boolean>(() => false);
  const unsubscribeSession = useRef<(() => void) | null>(null);
  const open = useRef(false);
  const lifecycleAbort = useRef<AbortController | null>(null);
  const resumeAfterPoll = useRef(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [resumePending, setResumePending] = useState(false);
  const connectCurrent = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!linuxNative || !window.__TAURI__) return;
    let alive = true;
    const probe = probeLinuxVoice();
    nativeProbe.current = probe;
    void probe.then((available) => {
      if (alive) setNativeSupported(available);
    });
    return () => {
      alive = false;
      nativeProbe.current = null;
    };
  }, [linuxNative]);

  useEffect(() => {
    setConfirmJoin(false);
    setSnapshot(null);
    setMessage(null);
    setOutputs([]);
    if (
      !enabled ||
      !supportsTeamDesktopWebView(
        Boolean(window.__TAURI__),
        navigator.platform,
        navigator.userAgent
      )
    )
      return;
    const generation = authGeneration();
    const token = participantToken();
    if (!token) return;
    let alive = true;
    const lifecycle = new AbortController();
    lifecycleAbort.current = lifecycle;
    current.current = () =>
      alive && generation === authGeneration() && token === participantToken();
    const stopSession = () => {
      unsubscribeSession.current?.();
      unsubscribeSession.current = null;
      session.current?.stop();
      session.current = null;
      setSnapshot(null);
    };
    const terminate = () => {
      alive = false;
      resumeAfterPoll.current = false;
      setResumePending(false);
      lifecycle.abort();
      open.current = false;
      setVoiceOpen(false);
      stopSession();
      setMessage(null);
    };
    const unsubscribeAuth = subscribeAuthChanges(terminate);
    window.addEventListener("pagehide", terminate);
    window.addEventListener("beforeunload", terminate);
    return () => {
      terminate();
      unsubscribeAuth();
      window.removeEventListener("pagehide", terminate);
      window.removeEventListener("beforeunload", terminate);
    };
  }, [contestUid, enabled]);

  useEffect(() => {
    const decision = voiceProjectionDecision({
      enabled,
      status: projection.status,
      hasBoard: team !== null,
      voiceOpen: Boolean(team?.phase.voice_open),
    });
    if (decision === "keep") return;
    const available = decision === "open";
    open.current = available;
    setVoiceOpen(available);
    if (!available) {
      const status = session.current?.getSnapshot().status;
      if (projection.status === "error" && (status === "connected" || status === "reconnecting"))
        resumeAfterPoll.current = true;
      else if (projection.status !== "error") resumeAfterPoll.current = false;
      setResumePending(resumeAfterPoll.current);
      unsubscribeSession.current?.();
      unsubscribeSession.current = null;
      session.current?.stop();
      session.current = null;
      setSnapshot(null);
    } else if (resumeAfterPoll.current) {
      resumeAfterPoll.current = false;
      setResumePending(false);
      void connectCurrent.current();
    }
  }, [projection.status, team, enabled]);

  async function connect() {
    const authorized = current.current;
    const lifecycle = lifecycleAbort.current;
    if (!authorized() || !open.current || suspendedRef.current) return;
    if (connectPending.current) return;
    connectPending.current = true;
    const available = linuxNative ? await (nativeProbe.current ?? probeLinuxVoice()) : supportsRtc;
    if (!authorized() || !open.current || suspendedRef.current) {
      connectPending.current = false;
      return;
    }
    if (!available) {
      connectPending.current = false;
      setMessage(
        "Team voice is unavailable in this app. Ask your organizer for a supported app build or device."
      );
      return;
    }
    if (linuxNative) setNativeSupported(true);
    if (session.current?.getSnapshot().status === "connecting") {
      connectPending.current = false;
      return;
    }
    setMessage(null);
    unsubscribeSession.current?.();
    session.current?.stop();
    const active = createTeamVoiceSession({
      contestUid,
      apiBase: resolveApiBase(),
      getToken: () => {
        if (!authorized()) throw new Error("Voice session ended");
        return participantToken() ?? "";
      },
      acquireMicrophone: linuxNative
        ? undefined
        : () => acquireVoiceMicrophone(cameraSession.current()),
      nativeVoice: linuxNative ? createLinuxVoiceBackend : undefined,
      refreshCredentials: async () => {
        if (!authorized()) throw new Error("Voice session ended");
        const credentials = await readVoiceCredentials(
          resolveApiBase(),
          contestUid,
          authHeaders(),
          AbortSignal.any([lifecycle!.signal, AbortSignal.timeout(8_000)])
        );
        if (!authorized()) throw new Error("Voice session ended");
        return credentials;
      },
    });
    session.current = active;
    const update = () => {
      if (current.current() && session.current === active) setSnapshot(active.getSnapshot());
    };
    unsubscribeSession.current = active.subscribe(update);
    update();
    try {
      await active.start();
      if (!current.current() || session.current !== active) {
        active.stop();
        return;
      }
      if (!linuxNative && "setSinkId" in HTMLMediaElement.prototype) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (current.current() && session.current === active)
            setOutputs(devices.filter((device) => device.kind === "audiooutput"));
        } catch {
          // Output selection is optional; system default still plays connected audio.
          if (current.current() && session.current === active) setOutputs([]);
        }
      }
    } catch {
      if (current.current() && session.current === active)
        setMessage("Voice could not start. Check your connection, then choose Retry voice.");
    } finally {
      connectPending.current = false;
    }
  }

  connectCurrent.current = connect;

  function toggleMute() {
    const active = session.current;
    const live = active?.getSnapshot();
    if (!suspended && live && (live.status === "connected" || live.status === "reconnecting"))
      active?.setMuted(!live.muted);
  }

  useEffect(() => {
    function muteShortcut(event: KeyboardEvent) {
      const active = session.current;
      // The typed letter, so AZERTY and Dvorak use their M key; the physical
      // key only when the layout types no ASCII character there.
      const key = typeof event.key === "string" ? event.key : "";
      const letterM =
        key.toLowerCase() === "m" || (!/^[\x20-\x7e]$/.test(key) && event.code === "KeyM");
      if (
        !suspended &&
        Boolean(compact ? toolbarTarget : lobbyTarget) &&
        current.current() &&
        active &&
        event.ctrlKey &&
        event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        letterM
      ) {
        event.preventDefault();
        event.stopPropagation();
        const { status, muted } = active.getSnapshot();
        if (!event.repeat && (status === "connected" || status === "reconnecting"))
          active.setMuted(!muted);
      }
    }
    // Capture before the focused editor; one chord must never run both actions.
    window.addEventListener("keydown", muteShortcut, true);
    return () => window.removeEventListener("keydown", muteShortcut, true);
  }, [suspended, compact, toolbarTarget, lobbyTarget]);

  const projectionMessage =
    projection.status === "error"
      ? team
        ? "Team status is reconnecting. Your work is safe."
        : "Team status is unavailable."
      : null;
  const members =
    membersTarget && renderMembers
      ? createPortal(
          <VStack gap={0} inert={suspended || undefined}>
            {renderMembers(enabled ? snapshot : null, (uid, volume) =>
              session.current?.setMemberVolume(uid, volume)
            )}
          </VStack>,
          membersTarget
        )
      : null;
  if (!enabled || (!team && !message && !projectionMessage))
    return (
      <>
        {endedNotice}
        {members}
      </>
    );
  const connected = snapshot?.status === "connected" || snapshot?.status === "reconnecting";
  const busy = snapshot?.status === "connecting";
  return (
    <>
      {endedNotice}
      {members}
      <TeamVoicePresentation
        compact={compact}
        toolbarTarget={toolbarTarget}
        lobbyTarget={lobbyTarget}
        suspended={suspended}
        snapshot={snapshot}
        notice={!supportsRtc ? "Voice unavailable in this app" : projectionMessage || message}
        onRequestJoin={() => setConfirmJoin(true)}
        onDismiss={() => setConfirmJoin(false)}
        canJoin={Boolean(team?.phase.voice_open && voiceOpen && supportsRtc)}
        onToggleMute={toggleMute}
      >
        <VStack
          gap={2}
          padding={4}
          as="section"
          aria-label="Team voice"
          inert={suspended || undefined}
          style={{
            background: "var(--color-background-surface)",
            maxHeight: compact ? "60vh" : undefined,
            overflow: compact ? "auto" : undefined,
            minWidth: 0,
            overflowWrap: "anywhere",
            borderRadius: "var(--radius-container)",
            flexShrink: 0,
          }}
        >
          <HStack gap={3} wrap="wrap" align="center">
            <Text weight="semibold">Team voice</Text>
            {snapshot?.status !== "connected" && (
              <Text role="status" aria-live="polite">
                {!supportsRtc
                  ? "Voice unavailable in this app"
                  : snapshot
                    ? voiceStatusText(snapshot.status)
                    : team?.phase.voice_open
                      ? "Ready"
                      : "Voice has ended for this round"}
              </Text>
            )}
            {team?.phase.voice_open &&
              !connected &&
              !confirmJoin &&
              snapshot?.status !== "closed" && (
                <Button
                  label={
                    busy
                      ? "Connecting…"
                      : snapshot?.status === "replaced"
                        ? "Move voice back to this window"
                        : snapshot?.status === "unavailable"
                          ? "Retry voice"
                          : "Join voice"
                  }
                  isDisabled={!supportsRtc || busy || !voiceOpen || suspended}
                  onClick={() => setConfirmJoin(true)}
                />
              )}
            {connected && !compact && (
              <Button
                label={snapshot?.muted ? "Muted" : "Live"}
                aria-label={
                  snapshot?.muted ? "Muted: unmute team microphone" : "Live: mute team microphone"
                }
                aria-pressed={!snapshot?.muted}
                aria-keyshortcuts="Control+Shift+M"
                tooltip={`${snapshot?.muted ? "Unmute" : "Mute"} team microphone (Ctrl+Shift+M)`}
                icon={snapshot?.muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
                style={{
                  background: snapshot?.muted ? undefined : "var(--color-success-muted)",
                  borderColor: snapshot?.muted ? undefined : "var(--color-border-green)",
                  color: snapshot?.muted
                    ? "var(--color-text-secondary)"
                    : "var(--color-text-green)",
                }}
                onClick={toggleMute}
              />
            )}
            {(connected || busy || resumePending) && (
              <LeaveTeamVoice
                onLeave={() => {
                  resumeAfterPoll.current = false;
                  setResumePending(false);
                  unsubscribeSession.current?.();
                  unsubscribeSession.current = null;
                  session.current?.stop();
                  session.current = null;
                  setSnapshot(null);
                  setMessage("You left team voice. Choose Join voice to reconnect.");
                }}
              />
            )}
            {connected &&
              snapshot?.error === "Allow audio playback to hear your team." &&
              !linuxNative && (
                <Button
                  label="Retry audio playback"
                  onClick={() =>
                    void session.current
                      ?.retryPlayback()
                      .then(() => setMessage(null))
                      .catch(() =>
                        setMessage(
                          "Playback is still blocked. Check system audio output and retry."
                        )
                      )
                  }
                />
              )}
          </HStack>
          {confirmJoin && !connected && !busy && (
            <VStack gap={2}>
              <Text>Join team voice? Your microphone starts muted. You can unmute when ready.</Text>
              <HStack gap={2} wrap="wrap">
                <Button label="Cancel" onClick={() => setConfirmJoin(false)} />
                <Button
                  label="Confirm join voice"
                  variant="primary"
                  isDisabled={!supportsRtc || !voiceOpen || suspended}
                  onClick={() => {
                    if (suspendedRef.current) return;
                    setConfirmJoin(false);
                    void connect();
                  }}
                />
              </HStack>
            </VStack>
          )}
          {(!supportsRtc || message || projectionMessage || snapshot?.error) && (
            <Text role="status">
              {!supportsRtc
                ? "Ask your organizer for a supported app build or device. You can continue with team parts."
                : (message ??
                  (snapshot?.error ? voiceErrorAdvice(snapshot.error) : projectionMessage))}
            </Text>
          )}
          {connected && (
            <VStack gap={1}>
              {!linuxNative && (
                <Text aria-label="Microphone input level">
                  {snapshot?.inputLevel == null
                    ? "Input level unavailable. Enable the local meter to check your microphone."
                    : `Microphone input: ${Math.round(snapshot.inputLevel * 100)}%`}
                </Text>
              )}
              {!linuxNative && snapshot?.inputLevel == null && (
                <Button
                  label="Enable microphone meter"
                  variant="secondary"
                  onClick={() => void session.current?.retryPlayback().catch(() => {})}
                />
              )}
              {snapshot?.muted && (snapshot.inputLevel ?? 0) > 0.02 && (
                <Text role="status">You are muted</Text>
              )}
            </VStack>
          )}
          {team && compact && (
            <VStack as="section" gap={2}>
              <List header="Team members" density="compact" hasDividers>
                {voiceMemberRows(team, snapshot).map(({ key, member, peer, status }) => (
                  <ListItem
                    key={key}
                    label={`${member.display_name}${member.is_me ? " (you)" : ""}`}
                    description={
                      <VStack gap={1}>
                        <Text>{status}</Text>
                        {peer && (
                          <Slider
                            label={`${member.display_name} volume`}
                            value={peer.volume * 100}
                            min={0}
                            max={100}
                            formatValue={(value) => `${value}%`}
                            onChange={(value: number) =>
                              session.current?.setMemberVolume(peer.memberUid, value / 100)
                            }
                          />
                        )}
                      </VStack>
                    }
                  />
                ))}
              </List>
            </VStack>
          )}
          {connected && !linuxNative && (
            <HStack gap={4} wrap="wrap" align="start">
              {outputs.some((device) => !device.label) && (
                <Text>
                  Output names may appear after microphone access is granted. If names remain
                  hidden, use System default.
                </Text>
              )}
              {outputs.length > 0 && (
                <Selector
                  label="Team voice output"
                  value={snapshot?.outputDevice || "default"}
                  options={[
                    { value: "default", label: "System default" },
                    ...outputs
                      .filter((device) => device.deviceId !== "default")
                      .map((device, index) => ({
                        value: device.deviceId,
                        label: device.label || `Audio output ${index + 1}`,
                      })),
                  ]}
                  onChange={(value) =>
                    void session.current
                      ?.setOutputDevice(value === "default" ? "" : value)
                      .catch(() =>
                        setMessage(
                          "Audio output could not be changed. Choose another output or retry."
                        )
                      )
                  }
                />
              )}
            </HStack>
          )}
        </VStack>
      </TeamVoicePresentation>
    </>
  );
}

"use client";

import { Mic, MicOff } from "lucide-react";
import { createVoiceAutoJoinGate } from "@/lib/team-voice-input";
import { useVoiceEndedNotice } from "./VoiceEndedNotice";
import { LeaveTeamVoice } from "./LeaveTeamVoice";
import { TeamVoicePresentation } from "./TeamVoicePresentation";
import { voiceStatusText, voiceErrorAdvice } from "@/lib/team-voice-presentation";
import { supportsTeamDesktopWebView } from "@/lib/team-platform";

import { useEffect, useRef, useState } from "react";
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

/** One voice session consumes the room’s shared team projection across lobby and workspace. */
export function TeamVoiceControls({
  contestUid,
  enabled,
  suspended = false,
  projection,
  compact = false,
  toolbarTarget = null,
}: {
  compact?: boolean;
  toolbarTarget?: HTMLElement | null;
  contestUid: string;
  enabled: boolean;
  suspended?: boolean;
  projection: { board: VoiceTeam | null; status: string; error: string | null };
}) {
  const team = projection.board;
  const endedNotice = useVoiceEndedNotice({
    contestUid,
    enabled,
    status: projection.status,
    voiceOpen: Boolean(team?.phase.voice_open),
    compact,
    toolbarTarget,
  });
  const supportsRtc = typeof RTCPeerConnection === "function";
  const [snapshot, setSnapshot] = useState<TeamVoiceSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const autoJoin = useRef(createVoiceAutoJoinGate());
  const session = useRef<TeamVoiceSession | null>(null);
  const current = useRef<() => boolean>(() => false);
  const unsubscribeSession = useRef<(() => void) | null>(null);
  const open = useRef(false);
  const lifecycleAbort = useRef<AbortController | null>(null);
  const resumeAfterPoll = useRef(false);
  const connectCurrent = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    autoJoin.current.reset();
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
      lifecycle.abort();
      open.current = false;
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
    if (!available) {
      const status = session.current?.getSnapshot().status;
      if (projection.status === "error" && (status === "connected" || status === "reconnecting"))
        resumeAfterPoll.current = true;
      else if (projection.status !== "error") resumeAfterPoll.current = false;
      unsubscribeSession.current?.();
      unsubscribeSession.current = null;
      session.current?.stop();
      session.current = null;
      setSnapshot(null);
    } else if (resumeAfterPoll.current || autoJoin.current.take(current.current())) {
      resumeAfterPoll.current = false;
      void connectCurrent.current();
    }
  }, [projection.status, team, enabled]);

  async function connect() {
    const authorized = current.current;
    const lifecycle = lifecycleAbort.current;
    if (!authorized() || !open.current) return;
    if (!supportsRtc) {
      setMessage(
        "Team voice is unavailable in this installed app because WebRTC support is missing."
      );
      return;
    }
    autoJoin.current.take(true);
    if (session.current?.getSnapshot().status === "connecting") return;
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
      acquireMicrophone: () => acquireVoiceMicrophone(cameraSession.current()),
      refreshCredentials: async () => {
        if (!authorized()) throw new Error("Voice session ended");
        // No AbortSignal.any/timeout: macOS 12 WebKit can predate both.
        const request = new AbortController();
        const abort = () => request.abort();
        const deadline = setTimeout(abort, 8_000);
        lifecycle!.signal.addEventListener("abort", abort);
        if (lifecycle!.signal.aborted) abort();
        try {
          const credentials = await readVoiceCredentials(
            resolveApiBase(),
            contestUid,
            authHeaders(),
            request.signal
          );
          if (!authorized()) throw new Error("Voice session ended");
          return credentials;
        } finally {
          clearTimeout(deadline);
          lifecycle!.signal.removeEventListener("abort", abort);
        }
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
      if ("setSinkId" in HTMLMediaElement.prototype) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (current.current() && session.current === active)
          setOutputs(devices.filter((device) => device.kind === "audiooutput"));
      }
    } catch {
      if (current.current() && session.current === active)
        setMessage("Voice could not start. Check your connection, then choose Retry voice.");
    }
  }

  connectCurrent.current = connect;

  function toggleMute() {
    const active = session.current;
    const live = active?.getSnapshot();
    if (live && (live.status === "connected" || live.status === "reconnecting"))
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
        // Never unmute before the Live/Muted control is visible.
        const { status, muted } = active.getSnapshot();
        if (!event.repeat && (status === "connected" || status === "reconnecting"))
          active.setMuted(!muted);
      }
    }
    // Capture before the focused editor; one chord must never run both actions.
    window.addEventListener("keydown", muteShortcut, true);
    return () => window.removeEventListener("keydown", muteShortcut, true);
  }, [suspended]);

  const projectionMessage =
    projection.status === "error"
      ? team
        ? "Team status is reconnecting. Your work is safe."
        : "Team status is unavailable."
      : null;
  if (!enabled || (!team && !message && !projectionMessage)) return endedNotice;
  const connected = snapshot?.status === "connected" || snapshot?.status === "reconnecting";
  const busy = snapshot?.status === "connecting";
  return (
    <>
      {endedNotice}
      <TeamVoicePresentation
        compact={compact}
        toolbarTarget={toolbarTarget}
        suspended={suspended}
        snapshot={snapshot}
        onToggleMute={toggleMute}
      >
        <VStack
          gap={2}
          paddingInline={4}
          paddingBlock={2}
          as="section"
          aria-label="Team voice"
          inert={suspended || undefined}
          style={{
            background: "var(--color-background-surface)",
            maxHeight: compact ? "60vh" : "30vh",
            overflow: "auto",
            flexShrink: 0,
          }}
        >
          <HStack gap={3} wrap="wrap" align="center">
            <Text weight="semibold">Team voice{team ? ` · ${team.team.name}` : ""}</Text>
            <Text role="status" aria-live="polite">
              {!supportsRtc
                ? "Voice unavailable · WebRTC support is missing in this installed app"
                : snapshot
                  ? voiceStatusText(snapshot.status)
                  : team?.phase.voice_open
                    ? "Ready · microphone starts muted"
                    : "Voice has ended for this round"}
            </Text>
            {team?.phase.voice_open && !connected && snapshot?.status !== "closed" && (
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
                isDisabled={!supportsRtc || busy || !open.current}
                onClick={() => void connect()}
              />
            )}
            {connected && (
              <Button
                label={snapshot?.muted ? "Muted" : "Live"}
                aria-label={snapshot?.muted ? "Unmute team microphone" : "Mute team microphone"}
                aria-pressed={!snapshot?.muted}
                aria-keyshortcuts="Control+Shift+M"
                icon={snapshot?.muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
                style={{
                  color: snapshot?.muted
                    ? "var(--color-text-secondary)"
                    : "var(--color-text-green)",
                }}
                onClick={toggleMute}
              />
            )}
            {(connected || busy || resumeAfterPoll.current) && (
              <LeaveTeamVoice
                onLeave={() => {
                  resumeAfterPoll.current = false;
                  unsubscribeSession.current?.();
                  unsubscribeSession.current = null;
                  session.current?.stop();
                  session.current = null;
                  setSnapshot(null);
                  setMessage("You left team voice. Choose Join voice to reconnect.");
                }}
              />
            )}
            {connected && (
              <Text>
                Mute shortcut:{" "}
                {typeof navigator !== "undefined" && navigator.platform === "MacIntel"
                  ? "⌃⇧M (Control-Shift-M)"
                  : "Ctrl+Shift+M"}
              </Text>
            )}
            {connected && snapshot?.error && (
              <Button
                label="Retry audio playback"
                onClick={() =>
                  void session.current
                    ?.retryPlayback()
                    .catch(() =>
                      setMessage("Playback is still blocked. Check system audio output and retry.")
                    )
                }
              />
            )}
          </HStack>
          {(message || projectionMessage || snapshot?.error) && (
            <Text role="status">
              {message ?? projectionMessage ?? voiceErrorAdvice(snapshot?.error ?? null)}
            </Text>
          )}
          {connected && (
            <VStack gap={1}>
              <Text>Microphone starts muted. Only unmuting sends your voice to the team.</Text>
              <Text aria-label="Microphone input level">
                {snapshot?.inputLevel == null
                  ? "Input level unavailable. Enable the local meter to check your microphone."
                  : `Microphone input: ${Math.round(snapshot.inputLevel * 100)}%`}
              </Text>
              {snapshot?.inputLevel == null && (
                <Button
                  label="Enable microphone meter"
                  variant="ghost"
                  onClick={() => void session.current?.retryPlayback().catch(() => {})}
                />
              )}
              {snapshot?.muted && (snapshot.inputLevel ?? 0) > 0.02 && (
                <Text role="status">You are muted</Text>
              )}
            </VStack>
          )}
          {team && (
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
          )}
          {connected && (
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

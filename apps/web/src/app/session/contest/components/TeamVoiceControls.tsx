"use client";

import { supportsTeamDesktopWebView } from "@/lib/team-platform";

import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
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
}: {
  contestUid: string;
  enabled: boolean;
  suspended?: boolean;
  projection: { board: VoiceTeam | null; status: string; error: string | null };
}) {
  const team = projection.board;
  const supportsRtc = typeof RTCPeerConnection === "function";
  const [snapshot, setSnapshot] = useState<TeamVoiceSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const session = useRef<TeamVoiceSession | null>(null);
  const current = useRef<() => boolean>(() => false);
  const unsubscribeSession = useRef<(() => void) | null>(null);
  const open = useRef(false);
  const lifecycleAbort = useRef<AbortController | null>(null);
  const resumeAfterPoll = useRef(false);
  const connectCurrent = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
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
    } else if (resumeAfterPoll.current) {
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
      if ("setSinkId" in HTMLMediaElement.prototype) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (current.current() && session.current === active)
          setOutputs(devices.filter((device) => device.kind === "audiooutput"));
      }
    } catch {
      if (current.current() && session.current === active)
        setMessage(
          "Voice could not start. Allow microphone access in system settings, then retry. The relay service must also be available."
        );
    }
  }

  connectCurrent.current = connect;

  useEffect(() => {
    function muteShortcut(event: KeyboardEvent) {
      const active = session.current;
      if (
        !event.repeat &&
        !suspended &&
        current.current() &&
        active &&
        event.ctrlKey &&
        event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        event.code === "KeyM"
      ) {
        event.preventDefault();
        active.setMuted(!active.getSnapshot().muted);
      }
    }
    window.addEventListener("keydown", muteShortcut);
    return () => window.removeEventListener("keydown", muteShortcut);
  }, [suspended]);

  const projectionMessage =
    projection.status === "error"
      ? "Team status is reconnecting. Your work is safe."
      : projection.status === "unpublished"
        ? "Teams have not been published yet. Voice will be available when your team is published and its voice window opens."
        : null;
  if (!enabled || (!team && !message && !projectionMessage)) return null;
  const connected = snapshot?.status === "connected" || snapshot?.status === "reconnecting";
  const busy = snapshot?.status === "connecting";
  return (
    <VStack
      gap={2}
      paddingInline={4}
      paddingBlock={2}
      as="section"
      aria-label="Team voice"
      inert={suspended || undefined}
      style={{
        background: "var(--color-background-surface)",
        maxHeight: "30vh",
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
              ? snapshot.status
              : team?.phase.voice_open
                ? "Ready · microphone starts muted"
                : "Voice closed"}
        </Text>
        {team?.phase.voice_open && !connected && (
          <Button
            label={busy ? "Connecting…" : "Join voice / retry microphone"}
            isDisabled={!supportsRtc || busy || !open.current}
            onClick={() => void connect()}
          />
        )}
        {connected && (
          <Button
            label={snapshot?.muted ? "Unmute team microphone" : "Mute team microphone"}
            onClick={() => session.current?.setMuted(!snapshot?.muted)}
          />
        )}
        {(connected || busy || resumeAfterPoll.current) && (
          <Button
            label="Leave voice"
            onClick={() => {
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
        {connected && <Text>Mute shortcut: Ctrl+Shift+M</Text>}
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
      {snapshot?.status === "unavailable" && (
        <Text>
          Allow microphone access in system settings, check your audio devices, then choose Join
          voice to retry. The voice relay must also be available.
        </Text>
      )}
      {(message || projectionMessage || snapshot?.error) && (
        <Text role="status">{message ?? projectionMessage ?? snapshot?.error}</Text>
      )}
      {connected && (
        <HStack gap={4} wrap="wrap" align="start">
          {team?.members.map((member, index) => (
            <Text key={`${member.display_name}-${index}`}>
              {member.display_name}
              {member.is_me ? " (you)" : " · team member"}
            </Text>
          ))}
          {snapshot?.peers.map((peer) => (
            <VStack gap={1} key={peer.memberUid}>
              <Text>
                {peer.displayName} ·{" "}
                {peer.muted ? "muted" : peer.speaking ? "speaking" : "listening"}
              </Text>
              <Slider
                label={`${peer.displayName} volume`}
                value={peer.volume * 100}
                min={0}
                max={100}
                formatValue={(value) => `${value}%`}
                onChange={(value: number) =>
                  session.current?.setMemberVolume(peer.memberUid, value / 100)
                }
              />
            </VStack>
          ))}
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
                    setMessage("Audio output could not be changed. Choose another output or retry.")
                  )
              }
            />
          )}
        </HStack>
      )}
    </VStack>
  );
}

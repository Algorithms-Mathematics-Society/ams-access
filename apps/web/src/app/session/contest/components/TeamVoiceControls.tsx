"use client";

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
  pollVoiceTeam,
  readVoiceTeam,
  readVoiceCredentials,
  resumeVoiceAfterPollFailure,
  type VoiceTeam,
} from "@/lib/team-voice-api";
import {
  createTeamVoiceSession,
  type TeamVoiceSession,
  type TeamVoiceSnapshot,
} from "@/lib/team-voice-engine";

/** Windows-only contest adapter. The missing team lobby (#293) can reuse the same API seam. */
export function TeamVoiceControls({
  contestUid,
  enabled,
  suspended = false,
}: {
  contestUid: string;
  enabled: boolean;
  suspended?: boolean;
}) {
  const [team, setTeam] = useState<VoiceTeam | null>(null);
  const [snapshot, setSnapshot] = useState<TeamVoiceSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [retry, setRetry] = useState(0);
  const session = useRef<TeamVoiceSession | null>(null);
  const current = useRef<() => boolean>(() => false);
  const unsubscribeSession = useRef<(() => void) | null>(null);
  const open = useRef(false);
  const lifecycleAbort = useRef<AbortController | null>(null);
  const resumeAfterPoll = useRef(false);
  const connectCurrent = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    setTeam(null);
    setSnapshot(null);
    setMessage(null);
    setOutputs([]);
    if (!enabled || !window.__TAURI__ || !/^Win/i.test(navigator.platform)) return;
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
    const stopPolling = pollVoiceTeam({
      read: (signal, etag) =>
        readVoiceTeam(resolveApiBase(), contestUid, authHeaders(), signal, etag),
      hidden: () => document.hidden,
      onRead: (result) => {
        if (!current.current()) return;
        if (result.kind === "team") {
          setTeam(result.team);
          setMessage(null);
          open.current = result.team.phase.voice_open;
          if (!open.current) {
            resumeAfterPoll.current = false;
            stopSession();
          } else if (resumeAfterPoll.current) {
            resumeAfterPoll.current = false;
            void connectCurrent.current();
          }
        } else if (result.kind === "solo") {
          resumeAfterPoll.current = false;
          open.current = false;
          stopSession();
          setTeam(null);
          setMessage(null);
        } else if (result.kind === "unpublished") {
          resumeAfterPoll.current = false;
          open.current = false;
          stopSession();
          setMessage(
            "Teams have not been published yet. Voice will be available when your team is published and its voice window opens."
          );
        }
      },
      onError: (error) => {
        if (!current.current()) return;
        const status = session.current?.getSnapshot().status;
        resumeAfterPoll.current = resumeVoiceAfterPollFailure(
          resumeAfterPoll.current,
          status,
          error
        );
        open.current = false;
        stopSession();
        setMessage("Team voice status is unavailable. Checking again shortly.");
      },
    });
    const terminate = () => {
      alive = false;
      resumeAfterPoll.current = false;
      lifecycle.abort();
      open.current = false;
      stopPolling();
      stopSession();
      setTeam(null);
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
  }, [contestUid, enabled, retry]);

  async function connect() {
    const authorized = current.current;
    const lifecycle = lifecycleAbort.current;
    if (!authorized() || !open.current) return;
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
          "Voice could not start. Allow microphone access in Windows settings, then retry. The relay service must also be available."
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

  if (!enabled || (!team && !message)) return null;
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
          {snapshot
            ? snapshot.status
            : team?.phase.voice_open
              ? "Ready · microphone starts muted"
              : "Voice closed"}
        </Text>
        {team?.phase.voice_open && !connected && (
          <Button
            label={busy ? "Connecting…" : "Join voice / retry microphone"}
            isDisabled={busy || !open.current}
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
                  setMessage("Playback is still blocked. Check Windows audio output and retry.")
                )
            }
          />
        )}
        {message && (
          <Button label="Check voice status" onClick={() => setRetry((value) => value + 1)} />
        )}
      </HStack>
      {snapshot?.status === "unavailable" && (
        <Text>
          Allow microphone access in Windows settings, check your audio devices, then choose Join
          voice to retry. The voice relay must also be available.
        </Text>
      )}
      {(message || snapshot?.error) && <Text role="status">{message ?? snapshot?.error}</Text>}
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

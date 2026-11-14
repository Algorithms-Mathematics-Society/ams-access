"use client";
import { useEffect, useState, type ReactNode } from "react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Token } from "@astryxdesign/core/Token";
import { Text } from "@astryxdesign/core/Text";
import { Mic, MicOff, CircleHelp, AudioLines, UserRoundX } from "lucide-react";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { Slider } from "@astryxdesign/core/Slider";
import { voiceMemberRows } from "@/lib/team-voice-members";
import type { TeamVoiceSnapshot } from "@/lib/team-voice-engine";
import { List, ListItem } from "@astryxdesign/core/List";
import { Button } from "@astryxdesign/core/Button";
import { countdownMs, type LobbyState } from "@/lib/team-lobby";
import { getContest } from "@/lib/proctor-api";
import { contestStartRemaining, watchContestStart } from "@/lib/team-lobby";
const duration = (ms: number) =>
  `${Math.floor(Math.ceil(ms / 1000) / 60)
    .toString()
    .padStart(2, "0")}:${(Math.ceil(ms / 1000) % 60).toString().padStart(2, "0")}`;
/** The contest shell owns security and media. The flexible main column prioritizes
 * phase guidance, voice and part selection; camera and members share the right rail. */
export function TeamLobby({
  state,
  contestUid,
  onClaim,
  onRelease,
  onReady,
  onEnter,
  canEnter = true,
  actions,
  voiceTargetRef,
}: {
  state: LobbyState;
  contestUid: string;
  onClaim: (label: string) => void;
  onRelease: () => void;
  onReady: () => void;
  onEnter: () => void;
  canEnter?: boolean;
  actions?: ReactNode;
  voiceTargetRef?: (node: HTMLElement | null) => void;
}) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [startConfirmed, setStartConfirmed] = useState(false);
  const [scheduleError, setScheduleError] = useState(false);
  const [scheduleAttempt, setScheduleAttempt] = useState(0);
  const hasBoard = Boolean(state.board);
  const hasProjectedStart = Boolean(state.board?.phase.starts_at);
  // Current APIs carry the schedule on existing board polls. Older APIs use
  // bounded metadata refresh while waiting, independent of the faster board polls.
  useEffect(() => {
    if (!hasBoard || hasProjectedStart) return;
    setStartsAt(null);
    setStartConfirmed(false);
    setScheduleError(false);
    return watchContestStart({
      request: () => getContest(contestUid, { includeReference: false }),
      onValue: (start, started) => {
        setStartsAt(start);
        setStartConfirmed(started);
      },
      onError: () => {
        setStartsAt(null);
        setStartConfirmed(false);
        setScheduleError(true);
      },
    });
  }, [contestUid, scheduleAttempt, hasBoard, hasProjectedStart]);
  const board = state.board;
  const own = board?.parts.find((p) => p.holder_is_me);
  const startRemaining = board
    ? contestStartRemaining(startsAt, board, state.sampledAt, now)
    : null;
  const scheduleReady = hasProjectedStart || startConfirmed;
  const enterReady = Boolean(
    canEnter &&
    state.status === "team" &&
    !state.pending &&
    own &&
    board?.phase.name === "locked" &&
    board.allocation.locked &&
    scheduleReady &&
    startRemaining === 0
  );
  if (!board)
    return (
      <VStack gap={4} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        <HStack gap={3} wrap="wrap" align="center" justify="between">
          <Heading level={1}>Team lobby</Heading>
          {actions}
        </HStack>
        <Text role="status">
          {state.status === "denied"
            ? "Team access unavailable"
            : state.status === "unpublished"
              ? "Your team will appear here soon."
              : state.status === "error"
                ? "Team status unavailable. Reconnecting…"
                : "Loading your team…"}
        </Text>
        {state.error && <Text role="alert">{state.error}</Text>}
      </VStack>
    );
  const remaining = countdownMs(board, state.sampledAt, now);
  const clock = remaining === null ? null : duration(remaining);
  const phase = board.phase.name;
  const choosing =
    canEnter &&
    state.status === "team" &&
    phase === "choosing" &&
    !board.allocation.locked &&
    remaining !== 0;
  const supportsReadiness = board.readiness_supported === true;
  return (
    <VStack
      gap={2}
      className="team-lobby-content"
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <HStack gap={3} wrap="wrap" align="center" justify="between">
        <Heading level={1}>{board.team.name}</Heading>
        {actions}
      </HStack>
      <VStack gap={2} aria-label="Team selection phase">
        <Heading level={2}>
          {phase === "waiting"
            ? remaining === 0
              ? "Team lobby"
              : `Your team lobby opens in ${clock ?? "—"}`
            : phase === "discussion"
              ? board.phase.prompt
              : phase === "choosing"
                ? "Choose your part"
                : "Parts are locked"}
        </Heading>
        {phase === "discussion" && remaining !== 0 && <Text>Claims open in {clock}</Text>}
        {phase === "choosing" && clock !== null && remaining !== 0 && (
          <Text>Parts lock in {clock}</Text>
        )}
        {remaining === 0 && phase !== "locked" && (
          <Text role="status">Checking the next phase…</Text>
        )}
      </VStack>
      <VStack ref={voiceTargetRef} gap={0} className="team-lobby-voice" />
      {phase === "choosing" && supportsReadiness && (
        <VStack gap={1} className="team-lobby-readiness">
          <HStack gap={3} align="center" justify="between">
            <Text role="status">
              {board.readiness?.ready} of {board.readiness?.needed} members ready
            </Text>
            <Button
              variant="primary"
              label="Ready"
              isDisabled={
                !choosing ||
                !own ||
                state.pending ||
                !board.readiness?.can_ready ||
                board.readiness.mine
              }
              onClick={() => {
                setPendingAction("Marking you ready…");
                onReady();
              }}
            />
          </HStack>
          <Text type="supporting">
            Choose a part, then mark Ready. Changing parts clears readiness.
            {board.allocation.locks_at
              ? " Parts lock when everyone is ready or the timer ends; unclaimed parts are assigned."
              : " Parts lock when everyone is ready."}
            {" Click Ready after parts lock to enter your workspace."}
          </Text>
        </VStack>
      )}
      {phase === "locked" && (
        <VStack gap={2}>
          <Text>
            {own
              ? `Your assigned part is ${own.label} (${own.problem_label}).`
              : "Waiting for your server-confirmed assignment."}
          </Text>
          <Text>Click Ready to enter your workspace when the contest starts.</Text>
          <Button
            variant="primary"
            isDisabled={!enterReady}
            onClick={() => {
              if (enterReady) onEnter();
            }}
            label="Ready"
          />
          {startRemaining !== null && startRemaining > 0 && (
            <Text>Contest starts in {duration(startRemaining)}</Text>
          )}
          {(startRemaining === null || (startRemaining === 0 && !scheduleReady)) && (
            <Text role="status">
              {scheduleError
                ? "Contest start time unavailable. Retry or use Help."
                : "Checking the contest start time…"}
            </Text>
          )}
          {scheduleError && !hasProjectedStart && (
            <Button
              label="Retry start time"
              variant="secondary"
              onClick={() => setScheduleAttempt((attempt) => attempt + 1)}
            />
          )}
        </VStack>
      )}
      <VStack gap={0} className="team-lobby-feedback">
        {state.error && <Text role="alert">{state.error}</Text>}
        {state.pending && <Text role="status">{pendingAction ?? "Updating your part…"}</Text>}
      </VStack>
      <List density="compact" hasDividers header={<Heading level={2}>Parts</Heading>}>
        {board.parts.map((part) => (
          <ListItem
            key={part.label}
            className="team-lobby-part"
            label={`Part ${part.label} · ${part.title || part.problem_label}`}
            description={
              <HStack
                gap={2}
                wrap="wrap"
                align="start"
                style={{ minWidth: 0, overflowWrap: "anywhere" }}
              >
                <Text type="supporting">
                  {part.holder ? `${part.holder}${part.holder_is_me ? " (you)" : ""}` : "Available"}
                </Text>
                {(part.summary || (part.title && part.title !== part.problem_label)) && (
                  <details className="team-lobby-part-summary">
                    <summary>Details</summary>
                    {part.title && <Text type="supporting">{part.problem_label}</Text>}
                    {part.summary && <Text type="supporting">{part.summary}</Text>}
                  </details>
                )}
              </HStack>
            }
            endContent={
              part.holder_is_me ? (
                <Button
                  variant="secondary"
                  isDisabled={!choosing || state.pending}
                  onClick={() => {
                    setPendingAction(`Releasing part ${part.label}…`);
                    onRelease();
                  }}
                  aria-label={`Release part ${part.label}`}
                  label="Release"
                />
              ) : (
                <Button
                  variant="secondary"
                  isDisabled={!choosing || state.pending || part.holder !== null}
                  onClick={() => {
                    setPendingAction(`Claiming part ${part.label}…`);
                    onClaim(part.label);
                  }}
                  aria-label={`Claim part ${part.label}`}
                  label="Claim"
                />
              )
            }
          />
        ))}
      </List>
    </VStack>
  );
}

/** One assignment roster in the shell's right column, below its stable camera. */
export function TeamLobbyMembers({
  state,
  snapshot = null,
  onVolume,
}: {
  state: LobbyState;
  snapshot?: TeamVoiceSnapshot | null;
  onVolume?: (uid: string, volume: number) => void;
}) {
  if (!state.board) return null;
  return (
    <VStack
      as="aside"
      aria-label="Team members and assignments"
      className="team-lobby-members"
      gap={0}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <List density="compact" hasDividers header={<Heading level={2}>Members</Heading>}>
        {voiceMemberRows(state.board, snapshot).map(({ member, key, peer, status }) => (
          <ListItem
            key={key}
            label={`${member.display_name}${member.is_me ? " (you)" : ""}`}
            description={
              <Text>{member.part_label ? `Part ${member.part_label}` : "No part selected"}</Text>
            }
            endContent={
              <HStack gap={2} align="center">
                <Tooltip content={status} focusTrigger="always">
                  <Text as="span" aria-label={`${member.display_name}: ${status}`}>
                    {status === "muted" ? (
                      <MicOff size={14} aria-hidden="true" />
                    ) : status === "speaking" ? (
                      <AudioLines size={14} aria-hidden="true" />
                    ) : status === "not in voice" ? (
                      <UserRoundX size={14} aria-hidden="true" />
                    ) : status === "voice status unavailable" ? (
                      <CircleHelp size={14} aria-hidden="true" />
                    ) : (
                      <Mic size={14} aria-hidden="true" />
                    )}
                  </Text>
                </Tooltip>
                {peer && onVolume && (
                  <Slider
                    label={`${member.display_name} volume`}
                    isLabelHidden
                    valueDisplay="none"
                    value={peer.volume * 100}
                    min={0}
                    max={100}
                    style={{ width: "var(--spacing-16)" }}
                    onChange={(value: number) => onVolume(peer.memberUid, value / 100)}
                  />
                )}
                {state.board?.readiness_supported === true &&
                state.board.phase.name === "choosing" ? (
                  <Token label={member.ready ? "Ready" : "Not ready"} />
                ) : member.assigned_by === "auto" ? (
                  <Token label="Auto-assigned" />
                ) : null}
              </HStack>
            }
          />
        ))}
      </List>
    </VStack>
  );
}

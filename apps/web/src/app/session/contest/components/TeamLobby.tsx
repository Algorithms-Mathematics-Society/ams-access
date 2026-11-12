"use client";
import { useEffect, useState, type ReactNode } from "react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Token } from "@astryxdesign/core/Token";
import { Text } from "@astryxdesign/core/Text";
import { List, ListItem } from "@astryxdesign/core/List";
import { Button } from "@astryxdesign/core/Button";
import { countdownMs, type LobbyState } from "@/lib/team-lobby";
import { getContest } from "@/lib/proctor-api";
import { contestStartRemaining, watchContestStart } from "@/lib/team-lobby";
const duration = (ms: number) =>
  `${Math.floor(Math.ceil(ms / 1000) / 60)
    .toString()
    .padStart(2, "0")}:${(Math.ceil(ms / 1000) % 60).toString().padStart(2, "0")}`;
/** The contest shell owns security and media. This bounded main column prioritizes
 * phase guidance, voice and part selection; the camera uses the adjacent region. */
export function TeamLobby({
  state,
  contestUid,
  onClaim,
  onRelease,
  onEnter,
  canEnter = true,
  actions,
  voiceTargetRef,
}: {
  state: LobbyState;
  contestUid: string;
  onClaim: (label: string) => void;
  onRelease: () => void;
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
  const startRemaining = contestStartRemaining(startsAt, board, state.sampledAt, now);
  const scheduleReady = hasProjectedStart || startConfirmed;
  const choosing =
    canEnter &&
    state.status === "team" &&
    phase === "choosing" &&
    !board.allocation.locked &&
    remaining !== 0;
  const own = board.parts.find((p) => p.holder_is_me);
  return (
    <VStack
      gap={4}
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
      {phase === "locked" && (
        <VStack gap={2}>
          <Text>
            {own
              ? `Your assigned part is ${own.label} (${own.problem_label}).`
              : "Waiting for your server-confirmed assignment."}
          </Text>
          <Button
            variant="primary"
            isDisabled={
              !scheduleReady ||
              startRemaining !== 0 ||
              !canEnter ||
              !own ||
              !board.allocation.locked ||
              state.status !== "team"
            }
            onClick={onEnter}
            label="Go to your part"
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
      {state.error && <Text role="alert">{state.error}</Text>}
      {state.pending && <Text role="status">{pendingAction ?? "Updating your part…"}</Text>}
      <List density="compact" hasDividers header={<Heading level={2}>Parts</Heading>}>
        {board.parts.map((part) => (
          <ListItem
            key={part.label}
            className="team-lobby-part"
            label={`Part ${part.label} · ${part.problem_label}`}
            description={
              part.title || part.summary ? (
                <VStack gap={1} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  {part.title && <Heading level={3}>{part.title}</Heading>}
                  {part.summary && <Text>{part.summary}</Text>}
                  <Text>
                    {part.holder
                      ? `${part.holder}${part.holder_is_me ? " (you)" : ""}`
                      : "Available"}
                  </Text>
                </VStack>
              ) : (
                <Text>
                  {part.holder ? `${part.holder}${part.holder_is_me ? " (you)" : ""}` : "Available"}
                </Text>
              )
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
                  label={phase === "discussion" && remaining !== 0 ? `Opens in ${clock}` : "Claim"}
                />
              )
            }
          />
        ))}
      </List>
      <List density="compact" hasDividers header={<Heading level={2}>Members</Heading>}>
        {board.members.map((member, index) => (
          <ListItem
            key={index}
            label={`${member.display_name}${member.is_me ? " (you)" : ""}`}
            description={
              <Text>{member.part_label ? `Part ${member.part_label}` : "No part selected"}</Text>
            }
            endContent={member.assigned_by === "auto" ? <Token label="Auto-assigned" /> : undefined}
          />
        ))}
      </List>
    </VStack>
  );
}

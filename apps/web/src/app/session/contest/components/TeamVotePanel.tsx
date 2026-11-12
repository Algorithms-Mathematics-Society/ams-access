"use client";
import { useEffect, useState } from "react";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";

import type { LobbyState } from "@/lib/team-lobby";
import { voteRemainingMs, integrationStatus, shownIntegration } from "@/lib/team-vote";
const duration = (ms: number) =>
  `${Math.floor(Math.ceil(ms / 1000) / 60)}:${(Math.ceil(ms / 1000) % 60)
    .toString()
    .padStart(2, "0")}`;
/** Parent dialog owns focus/geometry; shared lobby controller owns every request. */
export function TeamVotePanel({
  state,
  onApprove,
  onWithdraw,
  suspended = false,
  onResults,
}: {
  state: LobbyState;
  onApprove: (revision: number) => void;
  onWithdraw: (revision: number) => void;
  suspended?: boolean;
  onResults?: () => void;
}) {
  const board = state.board,
    vote = board?.submission;
  const [now, setNow] = useState(() => performance.now());
  const [seen, setSeen] = useState<{
    team: string;
    revision: number;
    message: string | null;
  } | null>(null);
  useEffect(() => {
    if (!board || !vote) return;
    setSeen((previous) => ({
      team: board.team.uid,
      revision: vote.revision,
      message:
        previous?.team === board.team.uid && previous.revision !== vote.revision
          ? `Revision changed (${previous.revision} → ${vote.revision}); approvals on the previous revision no longer count.`
          : previous?.team === board.team.uid
            ? previous.message
            : null,
    }));
  }, [board?.team.uid, vote?.revision]);
  useEffect(() => {
    if (!vote) return;
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [vote?.deadline]);
  if (!board || !vote) return <Text>Team approval status is unavailable.</Text>;
  const remaining = voteRemainingMs(vote, board.server_time, state.sampledAt, now);
  const submitted = vote.submitted_revision === vote.revision;
  const disabled =
    suspended ||
    state.pending ||
    state.status !== "team" ||
    !board.allocation.locked ||
    vote.revision === 0 ||
    submitted ||
    remaining <= 0;
  const result = shownIntegration(vote),
    inFlight =
      vote.integration && vote.integration.revision !== result?.revision ? vote.integration : null;
  return (
    <VStack gap={3}>
      <Heading level={3}>Team submission · revision {vote.revision}</Heading>
      <Heading level={2} aria-label={`${vote.votes} of ${vote.needed} approvals`}>
        {vote.votes} / {vote.needed}
      </Heading>
      {seen?.message && <Text role="status">{seen.message}</Text>}
      <Text>
        {vote.mine ? "You voted on this revision." : "You have not voted on this revision."}{" "}
        Individual teammate approvals are not published.
      </Text>
      <HStack gap={2} wrap="wrap">
        <Button
          label={
            state.pending
              ? "Updating approval…"
              : vote.mine
                ? "Withdraw"
                : `Approve revision ${vote.revision}`
          }
          isDisabled={disabled}
          onClick={() => (vote.mine ? onWithdraw(vote.revision) : onApprove(vote.revision))}
        />
        <Text>
          {vote.revision === 0
            ? "Nothing to submit yet."
            : remaining > 0
              ? `Deadline in ${duration(remaining)}`
              : "Deadline reached. Waiting for server confirmation."}
        </Text>
      </HStack>
      <Text>At the deadline your team’s current revision is submitted whatever the count.</Text>
      {vote.submitted_revision !== null && (
        <Text role="status">
          Revision {vote.submitted_revision} submitted{" "}
          {vote.submitted_by === "deadline" ? "at the deadline" : "by vote"}.
        </Text>
      )}
      {state.status === "error" && (
        <Text role="status">Team status is reconnecting. Approval actions are paused.</Text>
      )}
      {state.error && <Text role="alert">{state.error}</Text>}
      {inFlight && (
        <Text role="status">
          Revision {inFlight.revision} integration · {integrationStatus(inFlight)}
        </Text>
      )}
      {result && (
        <Button
          variant="secondary"
          label={`Results for revision ${result.revision} · ${integrationStatus(result)}`}
          onClick={onResults}
          isDisabled={!onResults}
        />
      )}
    </VStack>
  );
}

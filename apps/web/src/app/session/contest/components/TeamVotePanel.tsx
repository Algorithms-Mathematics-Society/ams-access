"use client";
import { useEffect, useState } from "react";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";

import type { LobbyState } from "@/lib/team-lobby";
import { voteRemainingMs, integrationStatus } from "@/lib/team-vote";
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
  const result = vote.integration ?? vote.last_result;
  return (
    <VStack gap={3}>
      <Heading level={3}>
        Revision {vote.revision} · {vote.votes} / {vote.needed} approvals
      </Heading>
      {seen?.message && <Text role="status">{seen.message}</Text>}
      <HStack gap={2} wrap="wrap">
        <Button
          label={
            state.pending
              ? "Updating approval…"
              : vote.mine
                ? "Withdraw approval"
                : `Approve revision ${vote.revision}`
          }
          isDisabled={disabled}
          tooltip={
            vote.revision === 0 ? "Submit your part before approving a team revision." : undefined
          }
          onClick={() => (vote.mine ? onWithdraw(vote.revision) : onApprove(vote.revision))}
        />
        {vote.revision > 0 && (
          <Text>
            {remaining > 0
              ? `Deadline in ${duration(remaining)}`
              : "Deadline reached. Waiting for server confirmation."}
          </Text>
        )}
      </HStack>
      {!submitted && remaining > 0 && vote.revision > 0 && (
        <Text type="supporting">
          The server submits the current revision at the deadline, regardless of approvals.
        </Text>
      )}
      {vote.submitted_revision !== null && (
        <Text role="status">
          Revision {vote.submitted_revision} submitted{" "}
          {vote.submitted_by === "deadline" ? "at the deadline" : "by vote"}.
        </Text>
      )}
      {state.error && <Text role="alert">{state.error}</Text>}
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

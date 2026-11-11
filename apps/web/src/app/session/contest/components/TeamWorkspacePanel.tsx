import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { List, ListItem } from "@astryxdesign/core/List";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { AccessDialog } from "@/components/AccessDialog";
import { integrationPartStatus } from "@/lib/team-vote";
import type { LobbyState } from "@/lib/team-lobby";
import { TeamVotePanel } from "./TeamVotePanel";

const TeamResultsView = dynamic(() => import("./TeamResultsView"), { ssr: false });
/** Reuses the owner's polled board; opening the panel performs no requests. */
export default function TeamWorkspacePanel({
  state,
  contestUid,
  onApprove,
  onWithdraw,
  suspended,
}: {
  state: LobbyState;
  contestUid: string;
  onApprove: (revision: number) => void;
  onWithdraw: (revision: number) => void;
  suspended: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState(false);
  useEffect(() => {
    if (suspended || !state.board) setOpen(false);
  }, [suspended, state.board]);
  const board = state.board;
  if (!board) return null;
  const submission = board.submission;
  const label = submission
    ? `Team r${submission.revision} · ${submission.votes}/${submission.needed}`
    : "Team status";
  return (
    <>
      <Button
        label={label}
        size="sm"
        variant="secondary"
        isDisabled={suspended}
        onClick={() => setOpen(true)}
      />
      {open && !suspended && (
        <AccessDialog
          open
          onClose={() => setOpen(false)}
          title="Team progress and submission"
          width="min(calc(100vw - var(--spacing-8)), calc(var(--spacing-10) * 16))"
          labelId="team-workspace-dialog"
          shouldRestoreFocus={() => !suspended}
        >
          <VStack gap={4}>
            {state.status === "error" && (
              <Text role="status">Reconnecting. Showing the last confirmed team progress.</Text>
            )}
            <HStack gap={2} wrap="wrap">
              <Button
                label="Progress and approval"
                variant={results ? "secondary" : "primary"}
                onClick={() => setResults(false)}
              />
              <Button
                label="Results and live board"
                variant={results ? "primary" : "secondary"}
                onClick={() => setResults(true)}
              />
            </HStack>
            {results ? (
              <TeamResultsView contestUid={contestUid} board={board} />
            ) : (
              <>
                <List aria-label="Team part progress">
                  {board.parts.map((part) => (
                    <ListItem
                      key={part.label}
                      label={`${part.problem_label} · ${part.holder_is_me ? "Your part" : part.holder ? `Held by ${part.holder}` : "Unassigned"}`}
                      description={
                        <VStack gap={1}>
                          <Text type="supporting">
                            {part.revision === null
                              ? "No submitted version"
                              : `Version ${part.revision}`}
                            {part.submission_status
                              ? ` · ${part.submission_status.replaceAll("_", " ")}`
                              : ""}
                            {part.verdict ? ` · ${part.verdict}` : ""}
                          </Text>
                          <Text type="supporting">
                            Last integration:{" "}
                            {integrationPartStatus(board.submission?.last_result, part.label)}
                          </Text>
                        </VStack>
                      }
                    />
                  ))}
                </List>
                <TeamVotePanel
                  state={state}
                  onApprove={onApprove}
                  onWithdraw={onWithdraw}
                  suspended={suspended}
                  onResults={() => setResults(true)}
                />
              </>
            )}
          </VStack>
        </AccessDialog>
      )}
    </>
  );
}

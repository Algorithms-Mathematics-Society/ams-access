import { useEffect, useState } from "react";
import { List, ListItem } from "@astryxdesign/core/List";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { authHeaders } from "@/lib/candidate-auth";
import { authGeneration, subscribeAuthChanges } from "@/lib/proctor-api";
import { resolveApiBase } from "@/lib/api-base";
import { startLiveBoardPolling, type LiveBoardState } from "@/lib/team-live-board";

export default function TeamLiveBoard({
  contestUid,
  ownTeamUid,
  visible,
}: {
  contestUid: string;
  ownTeamUid: string;
  visible: boolean;
}) {
  const [state, setState] = useState<LiveBoardState>({ board: null, status: "loading" });
  useEffect(() => {
    setState({ board: null, status: "loading" });
    if (!visible) return;
    const generation = authGeneration();
    let stop: (() => void) | undefined;
    let invalid = false;
    const syncVisibility = () => {
      stop?.();
      stop = undefined;
      if (invalid || document.visibilityState === "hidden") return;
      stop = startLiveBoardPolling({
        url: `${resolveApiBase().replace(/\/$/, "")}/participant/contests/${encodeURIComponent(contestUid)}/team/board`,
        headers: authHeaders,
        onState: setState,
        isCurrent: () => !invalid && generation === authGeneration(),
      });
    };
    const unsubscribe = subscribeAuthChanges(() => {
      invalid = true;
      stop?.();
      setState({ board: null, status: "denied" });
    });
    document.addEventListener("visibilitychange", syncVisibility);
    syncVisibility();
    return () => {
      invalid = true;
      stop?.();
      unsubscribe();
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, [contestUid, ownTeamUid, visible]);
  if (!visible) return null;
  return (
    <VStack gap={3}>
      {state.status === "loading" && <Text role="status">Loading live board…</Text>}
      {state.status === "retrying" && (
        <Text role="status">
          Live board is reconnecting.{" "}
          {state.board ? "Showing the last confirmed standings." : "Waiting for standings."}
        </Text>
      )}
      {state.status === "denied" && (
        <Text role="status">
          Live board access ended. Return to your contest list or contact your organizer.
        </Text>
      )}
      {state.board?.benchmarked && (
        <Tooltip content="Best median divided by yours. Another team improving can lower your score; the leader scores 1.000.">
          <Text tabIndex={0} type="supporting">
            How performance scores change
          </Text>
        </Tooltip>
      )}
      {state.board && state.board.teams.length === 0 && <Text>No team results yet.</Text>}
      <List aria-label="Live team standings">
        {state.board?.teams.map((team) => (
          <ListItem
            key={team.uid}
            label={`${team.rank}. ${team.name}${team.uid === ownTeamUid ? " · Your team" : ""}`}
            style={
              team.uid === ownTeamUid ? { backgroundColor: "var(--color-bg-secondary)" } : undefined
            }
            description={
              <VStack gap={1}>
                <Text>
                  {team.score} points · {team.solved} solved · Integration{" "}
                  {team.integrationPassed ? "passed" : "not passed"}
                </Text>
                {team.performance && (
                  <Text type="supporting">
                    {team.performance.pending
                      ? "Re-measuring · previous confirmed measurement"
                      : "Performance"}
                    :{" "}
                    {team.performance.score === null
                      ? "Not ranked"
                      : team.performance.score.toFixed(3)}
                    {team.performance.medianNs !== null
                      ? ` · median ${team.performance.medianNs.toLocaleString()} ns`
                      : ""}
                    {team.performance.iqrNs !== null
                      ? ` · IQR ${team.performance.iqrNs.toLocaleString()} ns`
                      : ""}
                    {team.performance.revision !== null
                      ? ` · revision ${team.performance.revision}`
                      : ""}
                  </Text>
                )}
              </VStack>
            }
          />
        ))}
      </List>
    </VStack>
  );
}

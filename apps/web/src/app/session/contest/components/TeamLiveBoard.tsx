import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Pagination } from "@astryxdesign/core/Pagination";
import { List, ListItem } from "@astryxdesign/core/List";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { authHeaders } from "@/lib/candidate-auth";
import { authGeneration, subscribeAuthChanges } from "@/lib/proctor-api";
import { resolveApiBase } from "@/lib/api-base";
import { startLiveBoardPolling, type LiveBoardState } from "@/lib/team-live-board";

const PAGE_SIZE = 50;

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
  const [page, setPage] = useState(1);
  const last = useRef<LiveBoardState["board"]>(null);
  useEffect(() => {
    last.current = null;
    setPage(1);
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
        initial: last.current,
        onState: (next) => {
          last.current = next.board;
          setState((previous) =>
            previous.board === next.board && previous.status === next.status ? previous : next
          );
        },
        isCurrent: () => !invalid && generation === authGeneration(),
      });
    };
    const unsubscribe = subscribeAuthChanges(() => {
      invalid = true;
      stop?.();
      last.current = null;
      setPage(1);
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
  const teams = state.board?.teams ?? [];
  const pageCount = Math.max(1, Math.ceil(teams.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const ownTeamIndex = teams.findIndex((team) => team.uid === ownTeamUid);
  useEffect(() => {
    setPage((previous) => Math.min(previous, pageCount));
  }, [pageCount]);
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
        {teams.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map((team) => (
          <ListItem
            key={team.uid}
            label={
              <Text style={{ overflowWrap: "anywhere" }}>
                {`${team.rank}. ${team.name}${team.uid === ownTeamUid ? " · Your team" : ""}`}
              </Text>
            }
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
      {teams.length > PAGE_SIZE && (
        <VStack gap={2}>
          <Pagination
            page={currentPage}
            onChange={setPage}
            totalItems={teams.length}
            pageSize={PAGE_SIZE}
            variant="compact"
            size="sm"
            label="Live team standings pages"
          />
          {ownTeamIndex >= 0 && (
            <Button
              label="Show your team"
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.floor(ownTeamIndex / PAGE_SIZE) + 1)}
            />
          )}
        </VStack>
      )}
    </VStack>
  );
}

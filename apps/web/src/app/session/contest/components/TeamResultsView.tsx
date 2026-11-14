import dynamic from "next/dynamic";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { TeamLobbyBoard } from "@/lib/team-lobby";
import { TeamIntegrationResult } from "./TeamIntegrationResult";
const TeamLiveBoard = dynamic(() => import("./TeamLiveBoard"), { ssr: false });
const TeamBenchmarks = dynamic(() => import("./TeamBenchmarks").then((m) => m.TeamBenchmarks), {
  ssr: false,
});
export default function TeamResultsView({
  contestUid,
  board,
  section = "integration",
}: {
  contestUid: string;
  board: TeamLobbyBoard;
  section?: "integration" | "live" | "benchmarks";
}) {
  const current = board.submission?.integration ?? null;
  const previous = board.submission?.last_result ?? null;
  return (
    <VStack gap={4}>
      {section === "integration" && (
        <>
          <Text>
            Current integration and the last finished result are shown here. Earlier integration
            revisions are not available in this view.
          </Text>
          <TeamIntegrationResult result={current ?? previous} />
          {current && previous && current.revision !== previous.revision && (
            <TeamIntegrationResult result={previous} />
          )}
        </>
      )}
      {section === "live" && (
        <TeamLiveBoard contestUid={contestUid} ownTeamUid={board.team.uid} visible />
      )}
      {section === "benchmarks" && <TeamBenchmarks contestUid={contestUid} visible />}
    </VStack>
  );
}

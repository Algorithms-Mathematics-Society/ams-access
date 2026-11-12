import { useState } from "react";
import dynamic from "next/dynamic";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Button } from "@astryxdesign/core/Button";
import type { TeamLobbyBoard } from "@/lib/team-lobby";
import { shownIntegration } from "@/lib/team-vote";
import { TeamIntegrationResult } from "./TeamIntegrationResult";
const TeamLiveBoard = dynamic(() => import("./TeamLiveBoard"), { ssr: false });
const TeamBenchmarks = dynamic(() => import("./TeamBenchmarks").then((m) => m.TeamBenchmarks), {
  ssr: false,
});
export default function TeamResultsView({
  contestUid,
  board,
}: {
  contestUid: string;
  board: TeamLobbyBoard;
}) {
  const [section, setSection] = useState<"integration" | "board" | "benchmarks">("integration");
  return (
    <VStack gap={4}>
      <HStack gap={2} wrap="wrap" aria-label="Results sections">
        {(["integration", "board", "benchmarks"] as const).map((value) => (
          <Button
            key={value}
            variant={section === value ? "primary" : "secondary"}
            aria-pressed={section === value}
            label={
              { integration: "Integration", board: "Live board", benchmarks: "Benchmarks" }[value]
            }
            onClick={() => setSection(value)}
          />
        ))}
      </HStack>
      {section === "integration" && (
        <TeamIntegrationResult result={shownIntegration(board.submission)} />
      )}
      {section === "board" && (
        <TeamLiveBoard contestUid={contestUid} ownTeamUid={board.team.uid} visible />
      )}
      {section === "benchmarks" && <TeamBenchmarks contestUid={contestUid} visible />}
    </VStack>
  );
}

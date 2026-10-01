import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { ContestIndex } from "@/lib/proctor-api";

export function SetupContestContext({ contest, dryRun, hasContest }: {
  contest: ContestIndex | null;
  dryRun: boolean;
  hasContest: boolean;
}) {
  if (!hasContest) return null;
  const start = contest ? new Date(contest.starts_at) : null;
  const startLabel = start && Number.isFinite(start.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(start) + " UTC"
    : "Start time unavailable";
  return <HStack as="section" aria-label="Contest setup context" gap={4} justify="between" align="start" wrap="wrap"
    style={{ paddingBlock: "var(--spacing-3)", borderBottom: "var(--border-width) solid var(--color-border)", minWidth: 0 }}>
    <VStack gap={1} style={{ minWidth: 0, flex: "1 1 50%" }}>
      <Text type="supporting" color="secondary">{dryRun ? "Practicing setup for" : "Setting up for"}</Text>
      <Text weight="semibold" style={{ overflowWrap: "anywhere" }}>{contest?.title || "Contest details unavailable"}</Text>
    </VStack>
    <VStack gap={1} style={{ minWidth: 0 }}>
      <Text type="supporting" color="secondary">{contest?.ends_at === null ? "Practice · untimed" : `Scheduled start · ${startLabel}`}</Text>
      <Text type="supporting" color="secondary">{contest && !dryRun ? "Last checked: " : ""}{dryRun ? "Rehearsal only · no contest entry" : !contest ? "Entry status is checked before your workspace opens" : contest.phase === "running" ? "Contest in progress" : contest.phase === "verification" ? "Verification window open" : contest.phase === "ended" ? "Contest ended" : "Waiting for the verification window"}</Text>
    </VStack>
  </HStack>;
}

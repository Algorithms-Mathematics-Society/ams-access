"use client";

import { Collapsible } from "@astryxdesign/core/Collapsible";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { ContestEntryState, InvitedContest } from "./types";

/** A disclosure of known contest metadata, not inferred organizer policy. */
export function ContestBriefing({ contest, entryState }: { contest: InvitedContest; entryState: ContestEntryState }) {
  const start = Date.parse(contest.start_at);
  const end = Date.parse(contest.end_at);
  const hasSchedule = !contest.is_practice && Number.isFinite(start) && Number.isFinite(end) && end > start;
  const minutes = hasSchedule ? Math.round((end - start) / 60000) : 0;
  const formatDate = (value: number) => new Date(value).toLocaleString(undefined, {
    dateStyle: "medium", timeStyle: "long",
  });
  return <Collapsible trigger="Contest details" defaultIsOpen={false}>
    <VStack gap={4} paddingBlock={3}>
      {contest.description && <Text color="secondary" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{contest.description}</Text>}
      <MetadataList label={{ position: "top" }}>
        {contest.org_name && <MetadataListItem label="Organizer">{contest.org_name}</MetadataListItem>}
        <MetadataListItem label="Format">{contest.is_practice ? "Practice · untimed and unscored" : "Scheduled contest"}</MetadataListItem>
        {hasSchedule && <>
          <MetadataListItem label="Starts">{formatDate(start)}</MetadataListItem>
          <MetadataListItem label="Ends">{formatDate(end)}</MetadataListItem>
          <MetadataListItem label="Scheduled window">{minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`}</MetadataListItem>
          {Number.isFinite(contest.verification_window_minutes) && (contest.verification_window_minutes ?? 0) > 0 && <MetadataListItem label="Setup opens">{formatDate(start - contest.verification_window_minutes! * 60000)}</MetadataListItem>}
        </>}
        <MetadataListItem label="Questions">{contest.question_count}</MetadataListItem>
      </MetadataList>
      <Text type="supporting">{contest.is_practice ? "Practice is separate from your scored contest." : hasSchedule ? "Times are shown in your local timezone. The scheduled window is the contest's start-to-end period." : entryState.actionHelper}</Text>
      <Text type="supporting">For allowed resources, scoring rules, or help during an interruption, follow your organizer’s instructions.</Text>
    </VStack>
  </Collapsible>;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { List } from "@astryxdesign/core/List";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { ActiveContestCard } from "./ContestCards";
import { getContestEntryState, getScheduledContestTickDelay } from "./utils";
import { sortHomeContests } from "./home-contest-presentation";
import type { InvitedContest, ContestantReadinessContext } from "./types";

export function ContestsPanel({
  contests,
  loading,
  theme,
  onPreflight,
  readinessContext,
  searchQuery = "",
  onSearchChange,
  error,
  onRefresh,
  refreshing = false,
  highlightedContestId,
}: {
  contests: InvitedContest[];
  loading: boolean;
  theme: "dark" | "light";
  onPreflight: (contestId: string, type: "new" | "resume") => void;
  readinessContext?: ContestantReadinessContext;
  searchQuery?: string;
  onSearchChange: (value: string) => void;
  error?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  highlightedContestId?: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  // Presentation order follows the existing contest boundaries; entry policy stays in each row.
  useEffect(() => {
    if (contests.length === 0) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(...contests.map((contest) => getScheduledContestTickDelay(contest, Date.now())))
    );
    return () => clearTimeout(timer);
  }, [contests, now]);

  const ordered = useMemo(
    () => sortHomeContests(contests, (contest) => getContestEntryState(contest, now).phase),
    [contests, now]
  );
  const query = searchQuery.trim().toLocaleLowerCase();
  const visible = ordered.filter((contest) =>
    `${contest.title} ${contest.org_name ?? ""}`.toLocaleLowerCase().includes(query)
  );
  return (
    <VStack as="section" aria-label="Contests" gap={5} aria-busy={loading}>
      <HStack justify="between" align="center" gap={3} wrap="wrap">
        <Heading level={4} accessibilityLevel={2}>
          Assigned contests
        </Heading>
        <HStack gap={3} align="center" wrap="wrap">
          <Text type="supporting" role="status" aria-live="polite">
            {loading
              ? "Loading..."
              : query
                ? `${visible.length} of ${contests.length}`
                : `${contests.length} assigned`}
          </Text>
          {onRefresh && (
            <Button
              label="Refresh"
              aria-label="Refresh contests"
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              isLoading={refreshing}
              isDisabled={loading}
            />
          )}
        </HStack>
      </HStack>
      <TextInput
        label="Search contests"
        className="dashboard-contest-search"
        isLabelHidden
        placeholder="Find a contest"
        value={searchQuery}
        onChange={onSearchChange}
        startIcon="search"
        hasClear
        size="lg"
        style={{
          minHeight: "var(--spacing-10)",
          backgroundColor: "var(--color-background-body)",
        }}
      />
      {error && visible.length > 0 && (
        <Banner
          status="error"
          title={error}
          description="Use Refresh above to try again."
        />
      )}
      {loading ? (
        <VStack paddingBlock={6} gap={6}>
          <VStack gap={2} role="status">
            <Text>Loading your contests</Text>
            <Text type="supporting">Checking the latest schedule.</Text>
          </VStack>
          <VStack gap={3} aria-hidden="true">
            <Skeleton width="30%" height="var(--spacing-5)" radius={1} />
            <Skeleton width="72%" height="var(--spacing-8)" radius={1} index={1} />
            <Skeleton width="90%" height="var(--spacing-4)" radius={1} index={2} />
            <Skeleton width="50%" height="var(--spacing-4)" radius={1} index={3} />
          </VStack>
        </VStack>
      ) : visible.length ? (
        <List density="spacious" className="dashboard-contest-list" style={{
          border: "var(--border-width) solid var(--color-border)",
          borderRadius: "var(--radius-container)",
          background: "var(--color-background-surface)",
        }}>
          {visible.map((c) => (
            <ActiveContestCard
              key={c.id}
              c={c}
              theme={theme}
              col={{
                dot: "var(--color-success)",
                bg: "var(--color-success-muted)",
                border: "var(--color-success)",
              }}
              onPreflight={onPreflight}
              readinessContext={readinessContext}
              isHighlighted={highlightedContestId === c.id}
            />
          ))}
        </List>
      ) : error ? (
        <Banner
          status="error"
          title="Contests unavailable"
          description="Use Refresh above to try again."
        />
      ) : (
        <EmptyState
          isCompact
          title={query ? "No matching contests" : "No contests yet"}
          description={
            query
              ? "Try a different contest or organization, or clear your search."
              : "Contests assigned to your sign-in will appear here. Ask your invigilator if one is missing."
          }
          actions={
            query ? (
              <Button label="Clear search" variant="secondary" onClick={() => onSearchChange("")} />
            ) : undefined
          }
          style={{
            paddingBlock: "var(--spacing-8)",
            paddingInline: 0,
            alignItems: "flex-start",
            textAlign: "start",
          }}
        />
      )}
    </VStack>
  );
}

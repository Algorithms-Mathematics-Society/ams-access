"use client";

import { useMemo, useState } from "react";
import { Calendar, type ISODateString } from "@astryxdesign/core/Calendar";
import { Card } from "@astryxdesign/core/Card";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { List, ListItem } from "@astryxdesign/core/List";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { Icon } from "@astryxdesign/core/Icon";
import type { InvitedContest } from "./types";

/** Calendar dates and agenda times use the device's local time zone together. */
function localDateKey(date: Date): ISODateString {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` as ISODateString;
}

export type ContestCalendarProps = {
  contests: InvitedContest[];
  loading: boolean;
  error?: string | null;
  onSelectContest: (contestId: string) => void;
};

/** Presentation-only schedule browser. Selecting a date never changes entry eligibility. */
export function ContestCalendar({ contests, loading, error, onSelectContest }: ContestCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<ISODateString>(() => localDateKey(new Date()));
  const [focusDate, setFocusDate] = useState<ISODateString>(selectedDate);
  const schedule = useMemo(() => contests.flatMap((contest) => {
    // Practice is untimed, even if an old assignment still contains date fields.
    if (contest.is_practice || !contest.start_at) return [];
    const startsAt = new Date(contest.start_at);
    if (!Number.isFinite(startsAt.getTime())) return [];
    return [{ contest, startsAt, day: localDateKey(startsAt) }];
  }).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()), [contests]);
  const selectedEvents = schedule.filter((event) => event.day === selectedDate);
  const practiceCount = contests.filter((contest) => contest.is_practice).length;
  const missingDates = contests.length - practiceCount - schedule.length;
  const nextEvent = schedule.find((event) => event.startsAt.getTime() >= Date.now());
  const selectedLabel = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
  function selectDate(date: ISODateString) {
    setSelectedDate(date);
    setFocusDate(date);
  }

  return (
    <Card
      padding={4}
      aria-labelledby="contest-calendar-heading"
      style={{ border: 0, borderRadius: "var(--radius-container)", minWidth: 0 }}
    >
      <VStack gap={4}>
        <HStack gap={2} align="center" justify="between" wrap="wrap">
          <Heading level={4} accessibilityLevel={2} id="contest-calendar-heading">
            Contest calendar
          </Heading>
          <Button label="Today" variant="ghost" size="sm" onClick={() => selectDate(localDateKey(new Date()))} />
        </HStack>
        <Calendar
          mode="single"
          value={selectedDate}
          onChange={setSelectedDate}
          focusDate={focusDate}
          onFocusDateChange={setFocusDate}
          aria-label="Contest dates"
          style={{ width: "100%", minWidth: 0, padding: 0 }}
        />
        <VStack as="section" gap={2} aria-label="Selected date schedule" aria-live="polite" aria-busy={loading}>
          <Text weight="medium">Starting {selectedLabel}</Text>
          {loading ? (
            <Text type="supporting" role="status">Loading your schedule…</Text>
          ) : error && schedule.length === 0 ? (
            <Text type="supporting" role="status">Schedule unavailable. Use Refresh beside Assigned contests to try again.</Text>
          ) : (
            <>
              {error && <Text type="supporting">Showing the last available schedule.</Text>}
              {selectedEvents.length > 0 ? (
                <List density="compact" hasDividers>
                  {selectedEvents.map(({ contest, startsAt }) => (
                    <ListItem
                      key={contest.id}
                      style={{ paddingInline: 0, minWidth: 0, minHeight: "var(--spacing-10)" }}
                      onClick={() => onSelectContest(contest.id)}
                      endContent={<Icon icon="chevronRight" size="sm" color="secondary" />}
                      label={<Text maxLines={2} style={{ overflowWrap: "anywhere" }}><VisuallyHidden>Show contest: </VisuallyHidden>{contest.title}</Text>}
                      description={startsAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    />
                  ))}
                </List>
              ) : (
                <Text type="supporting" role="status">No contests start on this day.</Text>
              )}
              {nextEvent && nextEvent.day !== selectedDate && (
                <Button
                  label="Show next contest"
                  variant="ghost"
                  size="sm"
                  onClick={() => selectDate(nextEvent.day)}
                  style={{ alignSelf: "flex-start" }}
                />
              )}
            </>
          )}
        </VStack>
        <VStack gap={1}>
          <Text type="supporting">Dates and times are shown in your local time.</Text>
          {!loading && practiceCount > 0 && <Text type="supporting">Practice contests are untimed.</Text>}
          {!loading && missingDates > 0 && (
            <Text type="supporting">
              {missingDates} {missingDates === 1 ? "contest has" : "contests have"} no confirmed start date.
            </Text>
          )}
        </VStack>
      </VStack>
    </Card>
  );
}

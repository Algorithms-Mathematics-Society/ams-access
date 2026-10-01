"use client";

import { memo, useState } from "react";
import type { ReactNode } from "react";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { List, ListItem } from "@astryxdesign/core/List";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import type { SecurityLogEntry } from "./types";

export function parseLogLine(text: string, statusColor: string): ReactNode {
  let splitIndex = text.indexOf("... ");
  let sep = "... ";
  if (splitIndex === -1) {
    splitIndex = text.indexOf(": ");
    sep = ": ";
  }
  if (splitIndex === -1) return <Text style={{ color: statusColor, font: "inherit" }}>{text}</Text>;
  const prefix = text.substring(0, splitIndex + sep.length);
  const status = text.substring(splitIndex + sep.length);
  return (
    <>
      <Text color="secondary" style={{ font: "inherit" }}>
        {prefix}
      </Text>
      <Text
        style={{
          color: statusColor,
          fontFamily: "inherit",
          fontSize: "inherit",
          lineHeight: "inherit",
          fontWeight: "var(--font-weight-bold)",
        }}
      >
        {status}
      </Text>
    </>
  );
}

export const SecurityOperationsLog = memo(function SecurityOperationsLog({
  logs,
}: {
  logs: SecurityLogEntry[];
}) {
  const [filter, setFilter] = useState("all");
  const visible = filter === "attention" ? logs.filter((log) => log.level !== "info") : logs;
  return (
    <VStack
      as="section"
      gap={4}
      aria-labelledby="device-activity-heading"
      data-device-activity
      style={{ minWidth: 0 }}
    >
      <HStack gap={4} justify="between" align="center" wrap="wrap">
        <VStack gap={2} style={{ flex: "1 1 calc(var(--spacing-10) * 8)", minWidth: 0 }}>
          <Heading level={4} accessibilityLevel={2} id="device-activity-heading">
            Recent activity
          </Heading>
          <Text type="supporting">
            Latest local events from this app visit. Earlier issues may already be resolved.
          </Text>
        </VStack>
        <SegmentedControl value={filter} onChange={setFilter} label="Activity filter" size="sm">
          <SegmentedControlItem value="all" label="All" />
          <SegmentedControlItem value="attention" label="Needs attention" />
        </SegmentedControl>
      </HStack>
      <Text type="supporting">
        {visible.length} of {logs.length} {logs.length === 1 ? "event" : "events"}
      </Text>
      {visible.length ? (
        <VStack
          role="region"
          aria-label="Recent activity entries"
          tabIndex={0}
          style={{
            minWidth: 0,
            maxHeight: "calc(var(--spacing-10) * 8)",
            overflowY: "auto",
            paddingInlineEnd: "var(--spacing-1)",
          }}
        >
          <List hasDividers density="balanced">
            {visible.map((log) => (
              <ListItem
                key={log.id}
                data-log-id={log.id}
                data-log-level={log.level}
                style={{ paddingInline: 0 }}
                startContent={
                  <Token
                    size="sm"
                    label={
                      log.level === "error" ? "Error" : log.level === "warn" ? "Warning" : "Info"
                    }
                    color={log.level === "error" ? "red" : log.level === "warn" ? "yellow" : "gray"}
                  />
                }
                label={
                  <Text style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
                    {parseLogLine(log.text, "var(--color-text-primary)")}
                  </Text>
                }
              />
            ))}
          </List>
        </VStack>
      ) : (
        <EmptyState
          isCompact
          title={logs.length ? "No events need attention" : "No activity yet"}
          description={
            logs.length
              ? "No warnings or errors in the available activity. Device readiness is shown above."
              : "Local device and setup events will appear here."
          }
          style={{ alignItems: "flex-start", textAlign: "start", paddingInline: 0 }}
        />
      )}
    </VStack>
  );
});

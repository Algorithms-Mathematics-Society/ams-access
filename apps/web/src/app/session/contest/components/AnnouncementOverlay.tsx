"use client";

import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { AlertTriangle } from "lucide-react";

import { ContestOverlay } from "./ContestOverlay";
import type { Announcement } from "../announcements";

/**
 * Something the organizers need this candidate to read before carrying on.
 *
 * It blocks deliberately. On 24 October the round was postponed and people
 * kept competing for hours, some finishing the whole paper first, because
 * the message went out on channels a locked-down proctor cannot show. A
 * banner at the top of a screen is not enough for that; somebody deep in a
 * problem does not look up.
 *
 * There is exactly one button and no close affordance. Acknowledging is what
 * dismisses it, and that acknowledgement is what tells the organizers their
 * message actually landed -- the thing nobody could answer afterwards.
 */
export function AnnouncementOverlay({
  announcement,
  onAcknowledge,
  busy,
  dialogRef,
}: {
  announcement: Announcement;
  onAcknowledge: () => void;
  busy: boolean;
  dialogRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const issued = new Date(announcement.created_at);
  return (
    <ContestOverlay critical alert labelId="announcement-title" dialogRef={dialogRef}>
      <VStack gap={4} style={{ minWidth: 0 }}>
        <HStack gap={3} align="center">
          <AlertTriangle
            aria-hidden
            style={{ width: 20, height: 20, color: "var(--color-text-warning)", flexShrink: 0 }}
          />
          <Text type="supporting" color="secondary">
            Announcement from the organizers
          </Text>
        </HStack>

        <Heading id="announcement-title" level={2}>
          {announcement.title}
        </Heading>

        {/* Plain text, never markup. Organizer copy is typed under pressure
            and must render as exactly what was typed. `pre-wrap` keeps their
            line breaks without interpreting anything. */}
        <Text id="announcement-body" style={{ whiteSpace: "pre-wrap" }}>
          {announcement.body}
        </Text>

        <HStack justify="between" align="center" gap={3}>
          <Text type="supporting" color="secondary">
            {Number.isFinite(issued.getTime())
              ? `Issued ${issued.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </Text>
          <Button
            label={busy ? "Saving..." : "I understand"}
            variant="primary"
            isDisabled={busy}
            onClick={onAcknowledge}
          />
        </HStack>
      </VStack>
    </ContestOverlay>
  );
}

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { AccessDialog } from "@/components/AccessDialog";
import { clockIsSynchronised, serverNow } from "@/lib/proctor-api";
import { clockDifferenceMessage, contestTimestamp } from "../contest-information";
import type { ContestMeta } from "./questions";

/** On-demand information: no polling or recurring timer, editor stays mounted. */
export const ContestInformation = memo(function ContestInformation({
  contest,
  suspended,
}: {
  contest: ContestMeta | null;
  suspended: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [clockMessage, setClockMessage] = useState<string | null>(null);
  const latest = useRef(suspended);
  latest.current = suspended;
  useEffect(() => {
    if (suspended) setOpen(false);
  }, [suspended]);
  const shouldRestoreFocus = useCallback(() => !latest.current, []);
  useEffect(() => {
    if (!open || suspended) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    // Existing kiosk handling consumes Escape before document listeners.
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [open, suspended]);
  return (
    <>
      <Button
        label="Contest info"
        variant="ghost"
        isDisabled={suspended}
        onClick={() => {
          setClockMessage(clockDifferenceMessage(clockIsSynchronised(), serverNow(), Date.now()));
          setOpen(true);
        }}
      />
      {open && !suspended && (
        <AccessDialog
          open
          onClose={() => setOpen(false)}
          title="Contest information"
          labelId="contest-information"
          width="min(calc(100vw - var(--spacing-8)), calc(var(--spacing-10) * 16))"
          shouldRestoreFocus={shouldRestoreFocus}
        >
          <VStack gap={4}>
            <Heading level={3}>{contest?.title ?? "Contest"}</Heading>
            <Text>Starts: {contestTimestamp(contest?.start_at)}</Text>
            <Text>
              Ends:{" "}
              {contest?.end_at === null
                ? "No scheduled deadline"
                : contestTimestamp(contest?.end_at)}
            </Text>
            <Text type="supporting" color="secondary">
              Times above are supplied by the contest server and shown in UTC. Leaving or
              reconnecting does not pause the timer. An extension is effective only when the server
              updates the deadline.
            </Text>
            {clockMessage && <Text role="status">{clockMessage}</Text>}
            <Heading level={3}>What each action means</Heading>
            <Text>
              Run checks your active file against the selected sample or custom tests; it does not
              submit that file for scoring. Submit sends that file for scoring; wait for server
              acceptance and then its verdict. Saving a draft on this device is not a submission.
            </Text>
            <Text>
              Finish ends the attempt after the server confirms it. Leave restores device controls
              without confirming a finish. Returning depends on the contest’s current entry rules.
            </Text>
            <Heading level={3}>Rules and reference</Heading>
            <Text>
              {contest?.reference_sheet
                ? "Use Reference in the contest header to read the organizer’s published sheet. It opens inside this workspace and keeps your editor in place."
                : "No published reference sheet was included with this contest. This does not grant permission to use external material."}
            </Text>
            <Text type="supporting" color="secondary">
              Follow the organizer’s instructions about allowed material, camera and microphone use,
              and submission limits. If a rule or scoring consequence is unclear, ask an invigilator
              before acting. This screen does not announce a postponement or scoring-policy change.
            </Text>
          </VStack>
        </AccessDialog>
      )}
    </>
  );
});

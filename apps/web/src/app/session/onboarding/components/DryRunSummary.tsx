import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { statusPresentation } from "./ui";
import { HelpRequestModal } from "@/components/HelpRequestModal";
import { STAGES, REVIEW_STAGE, type StageStatus } from "../support";

export function DryRunSummary({
  results,
  networkOutcome,
  warningDetails = {},
  onDone,
}: {
  results: Record<number, StageStatus>;
  warningDetails?: Record<number, string>;
  networkOutcome: "skipped" | "ok" | "failed";
  onDone: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);

  // Preserve the existing support-request rows and payload. The visible summary
  // below separates measured checks from review/transition and marks missing
  // results as unknown rather than inventing a successful check.
  const checkStages = STAGES.filter((s) => s.id >= 1 && s.id <= 12);
  const rows = checkStages.map((s) => ({
    label: s.label,
    status: results[s.id] ?? "pass",
  }));
  rows.push({
    label: "Network Lockdown",
    status: networkOutcome === "ok" ? "pass" : networkOutcome === "failed" ? "fail" : "warn",
  });

  const anyFail = rows.some((r) => r.status === "fail");
  const anyWarn = rows.some((r) => r.status === "warn");

  const displayRows = STAGES.filter(s => s.id < REVIEW_STAGE).map(s => ({
    label: s.label, status: results[s.id] ?? "pending" as StageStatus, detail: results[s.id] === "warn" ? warningDetails[s.id] : undefined,
  }));
  displayRows.push({ ...rows[rows.length - 1], detail: undefined });
  const needsReview = displayRows.some(row => row.status !== "pass");

  return (
    <VStack gap={6} style={{ width: "100%", minWidth: 0 }}>
      <VStack gap={3}>
        <Text type="supporting" color="secondary">PRACTICE RUN COMPLETE</Text>
        <Heading level={1} style={{ fontSize: "var(--font-size-3xl)" }}>{anyFail ? "Review these before your contest." : needsReview ? "A few things to review." : "Your setup checks are complete."}</Heading>
        <Text color="secondary">{needsReview ? "Review the checks below before exam day. Your contest will run its required checks again." : "Your device passed the recorded rehearsal checks. Your contest will verify your setup again before entry."}</Text>
        <Text type="supporting" color="secondary">Nothing was submitted. This practice run does not enter a contest.</Text>
      </VStack>
      <VStack as="ul" gap={0} aria-label="Practice check results" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {displayRows.map(row => {
          const status = statusPresentation(row.status);
          return <HStack as="li" key={row.label} gap={3} justify="between" align="start" wrap="wrap" style={{ paddingBlock: "var(--spacing-3)", borderBottom: "var(--border-width) solid var(--color-border)" }}>
            <VStack gap={2} style={{ flex: "1 1 55%", minWidth: 0 }}><Text>{row.label}</Text>{row.detail && <Text type="supporting" color="secondary">{row.detail}</Text>}</VStack>
            <HStack gap={2} align="center"><StatusDot variant={status.variant} label={status.label} /><Text type="supporting" color="secondary">{status.label}</Text></HStack>
          </HStack>;
        })}
      </VStack>
      <HStack gap={3} wrap="wrap" justify="end">
        {(anyFail || anyWarn) && <Button type="button" variant="secondary" label="Get help" onClick={() => setHelpOpen(true)} />}
        <Button type="button" variant="primary" label="Back to home" onClick={onDone} />
      </HStack>
      <HelpRequestModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        kind="READINESS"
        summary="Practice setup run reported failing checks."
        details={{
          source: "dry_run",
          checks: rows.reduce<Record<string, string>>((acc, r) => {
            acc[r.label] = r.status;
            return acc;
          }, {}),
        }}
      />

    </VStack>
  );
}

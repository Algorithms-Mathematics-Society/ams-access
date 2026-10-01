import { useEffect, useState } from "react";
import { HStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Spinner as AstryxSpinner } from "@astryxdesign/core/Spinner";
import { type StageStatus } from "../support";

export function statusPresentation(status: StageStatus | "unknown") {
  switch (status) {
    case "pass": return { label: "Ready", variant: "success" as const };
    case "warn": return { label: "Check needed", variant: "warning" as const };
    case "fail": return { label: "Needs action", variant: "error" as const };
    case "checking": return { label: "Checking", variant: "accent" as const };
    default: return { label: "Not checked", variant: "neutral" as const };
  }
}

export function CheckLine({ label, status, delay = 0 }: {
  label: string;
  status: "checking" | "pass" | "warn" | "fail" | "unknown";
  delay?: number;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  if (!visible) return null;
  const presentation = statusPresentation(status);
  return (
    <HStack gap={3} align="start" justify="between" wrap="wrap" style={{ width: "100%", paddingBlock: "var(--spacing-2)", minWidth: 0 }}>
      <Text style={{ flex: "1 1 55%", minWidth: 0, overflowWrap: "anywhere" }}>{label}</Text>
      <HStack gap={2} align="center">
        <StatusDot variant={presentation.variant} label={presentation.label} />
        <Text type="supporting" color="secondary">{presentation.label}</Text>
      </HStack>
    </HStack>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return <AstryxSpinner size={size <= 14 ? "sm" : size <= 20 ? "md" : "lg"} aria-label="Checking your setup" />;
}

export function StageHeader({ label }: { label: string }) {
  return <Heading level={2} style={{ fontSize: "var(--font-size-2xl)", lineHeight: "var(--text-heading-2-leading)" }}>{label}</Heading>;
}

export function StatusBadge({ status, label }: { status: StageStatus; label: string }) {
  const presentation = statusPresentation(status);
  return (
    <HStack gap={2} align="center" wrap="wrap" role="status" style={{ paddingBlock: "var(--spacing-2)", minWidth: 0 }}>
      <StatusDot variant={presentation.variant} label={presentation.label} />
      <Text weight="medium">{presentation.label}</Text>
      <Text color="secondary">{label}</Text>
    </HStack>
  );
}

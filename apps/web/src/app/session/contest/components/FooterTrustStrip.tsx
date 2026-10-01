import { type ReactElement } from "react";
import { ShieldCheck, Shield, Wifi, WifiOff, Save, UserRound, Keyboard } from "lucide-react";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { footerSaveView, type SaveIndicator } from "../save-indicator";
import { type Question } from "./questions";

export interface FooterTrustStripProps {
  proctoringOk: boolean;
  footerStatusDot: (color: string) => ReactElement;
  faceStatus: "ok" | "away" | "unknown";
  online: boolean;
  saveIndicator: SaveIndicator;
  draftStatusLabel?: string;
  draftConfirmed?: boolean;
  activeQ: number;
  questions: Question[];
  attemptedQuestionCount: number;
  acceptedQuestionCount: number;
  remainingQuestionCount: number;
}

export function FooterTrustStrip({
  proctoringOk,
  footerStatusDot,
  faceStatus,
  online,
  saveIndicator,
  draftStatusLabel,
  draftConfirmed,
  activeQ,
  questions,
  attemptedQuestionCount,
  acceptedQuestionCount,
  remainingQuestionCount,
}: FooterTrustStripProps) {
  const faceLabel = faceStatus === "ok" ? "Face detected" : faceStatus === "away"
    ? "Face not centered — center your face in the camera" : "Camera starting";
  const saveLabel = draftStatusLabel ? `Draft: ${draftStatusLabel}` : footerSaveView(saveIndicator.icon).label;
  const saveColor = draftConfirmed === false ? "var(--color-text-yellow)" : saveIndicator.icon === "error" ? "var(--color-text-red)"
    : saveIndicator.icon === "saved" ? "var(--color-text-green)" : "var(--color-text-yellow)";
  return <HStack as="footer" className="contest-footer" gap={5} paddingInline={5} align="center" justify="between"
    minHeight="var(--spacing-10)"
    style={{ flexShrink: 0, borderTop: "var(--border-width) solid var(--color-border)", background: "var(--color-background-body)" }}>
    <HStack gap={4} align="center" className="contest-footer-statuses">
      <HStack role="status" aria-live="polite" gap={2} align="center">
        <HStack style={{ position: "relative", color: proctoringOk ? "var(--color-text-secondary)" : "var(--color-text-red)" }}>
          {proctoringOk ? <ShieldCheck size={15} aria-hidden="true" /> : <Shield size={15} aria-hidden="true" />}
          {footerStatusDot(proctoringOk ? "var(--color-text-green)" : "var(--color-text-red)")}
        </HStack>
        <Text type="supporting">{proctoringOk ? "Secure" : "Action needed"}</Text>
      </HStack>
      <HStack role="status" aria-live="polite" gap={2} align="center">
        <HStack style={{ position: "relative", color: faceStatus === "away" ? "var(--color-text-yellow)" : "var(--color-text-secondary)" }}>
          <UserRound size={15} aria-hidden="true" />
          {footerStatusDot(faceStatus === "ok" ? "var(--color-text-green)" : faceStatus === "away" ? "var(--color-text-red)" : "var(--color-text-secondary)")}
        </HStack>
        <Text type="supporting" aria-label={faceLabel}>{faceStatus === "ok" ? "Face detected" : faceStatus === "away" ? "Center your face" : "Camera starting"}</Text>
      </HStack>
      <HStack role="status" aria-live="polite" gap={2} align="center">
        <HStack style={{ position: "relative", color: online ? "var(--color-text-secondary)" : "var(--color-text-yellow)" }}>
          {online ? <Wifi size={15} aria-hidden="true" /> : <WifiOff size={15} aria-hidden="true" />}
          {footerStatusDot(online ? "var(--color-text-green)" : "var(--color-text-red)")}
        </HStack>
        <Text type="supporting">{online ? "Connected" : "Reconnecting…"}</Text>
      </HStack>
      <HStack role="status" aria-live="polite" gap={2} align="center">
        <HStack style={{ position: "relative", color: saveColor }}>
          <Save size={15} aria-hidden="true" />
          {footerStatusDot(draftConfirmed === false ? "var(--color-text-yellow)" : saveIndicator.icon === "saved" ? "var(--color-text-green)" : saveIndicator.icon === "error" ? "var(--color-text-red)" : "var(--color-text-secondary)")}
        </HStack>
        <Text type="supporting">{saveLabel}</Text>
      </HStack>
      <HStack role="img" aria-label="Keyboard locked" style={{ position: "relative", color: "var(--color-text-secondary)" }}>
        <Keyboard size={15} aria-hidden="true" />
        {footerStatusDot("var(--color-text-green)")}
      </HStack>
    </HStack>
    <Text type="supporting" hasTabularNumbers className="contest-footer-summary">
      Q{activeQ + 1}/{questions.length} · {attemptedQuestionCount} attempted · {acceptedQuestionCount} accepted · {remainingQuestionCount} remaining · Evaluation
    </Text>
  </HStack>;
}

"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { Icon } from "@astryxdesign/core/Icon";
import { Button } from "@astryxdesign/core/Button";
import { InlineAlert } from "./ui-primitives";
import { HelpRequestModal } from "@/components/HelpRequestModal";
import { approvalLabel, acceptedRequestTime } from "./approval-feedback";
import type { ActiveSession, ResumeVerificationState } from "./types";

export function SessionActionsPanel({
  activeSession,
  onResume,
  resumeBusy,
  resumeStatus,
  approvalUnavailable = false,
  resumeVerification,
  sessionsError,
  theme,
}: {
  activeSession: ActiveSession | null;
  onResume: () => void;
  resumeBusy: boolean;
  resumeStatus: string | null;
  approvalUnavailable?: boolean;
  resumeVerification: ResumeVerificationState;
  sessionsError: string | null;
  theme: "dark" | "light";
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const requestTime = acceptedRequestTime(activeSession?.resume_request_requested_at);
  const requestStatus = activeSession?.resume_request_status?.toUpperCase();
  const resumeFailed =
    requestStatus === "REJECTED" ||
    requestStatus === "EXPIRED" ||
    (!!resumeStatus && /rejected|expired|failed|not found|mismatch|could not/i.test(resumeStatus));
  const resumeRetryable = resumeVerification === "retryable";
  const resumeVerified = resumeVerification === "verified";
  const resumeChecking = resumeVerification === "checking" || resumeVerification === "unverified";
  const resumeRequestPending = requestStatus === "PENDING";
  const resumeAvailable = Boolean(activeSession && (resumeVerified || resumeRetryable));
  const resumeButtonDisabled =
    resumeBusy || resumeChecking || (resumeRequestPending && !resumeRetryable) || !resumeAvailable;
  const resumeButtonLabel = resumeRetryable
    ? "Retry verification"
    : resumeRequestPending
      ? "Awaiting Approval"
      : resumeBusy || resumeChecking
        ? "Validating..."
        : "Resume Active Session";

  const hasQuietEmptyState =
    !activeSession && !resumeBusy && !resumeChecking && !sessionsError && !resumeStatus;

  if (hasQuietEmptyState) {
    return (
      <VStack as="section" aria-label="Session recovery" gap={0}>
        <Text type="supporting">No active session to resume.</Text>
      </VStack>
    );
  }

  return (
    <VStack
      as="section"
      aria-label="Session recovery"
      gap={4}
      padding={5}
      style={{
        background: "var(--color-background-card)",
        borderRadius: "var(--radius-container)",
      }}
    >
      <Heading level={4} accessibilityLevel={2}>
        Session recovery
      </Heading>
      {sessionsError && (
        <Text role="alert" type="supporting" style={{ color: "var(--color-error)" }}>
          {sessionsError}
        </Text>
      )}
      <HStack gap={4} align="center" justify="end" wrap="wrap">
        <VStack gap={2} style={{ flex: "1 1 calc(var(--spacing-10) * 5)", minWidth: 0 }}>
          {activeSession ? (
            <VStack gap={2}>
              <Text weight="semibold" maxLines={2}>
                {activeSession.contest_title ?? `Session ${activeSession.contest_id.slice(0, 8)}`}
              </Text>
              <HStack gap={3} wrap="wrap" align="center">
                <Token
                  size="sm"
                  color={
                    approvalUnavailable ||
                    resumeRequestPending ||
                    requestStatus === "REJECTED" ||
                    requestStatus === "EXPIRED"
                      ? "yellow"
                      : resumeVerified
                        ? "green"
                        : resumeChecking
                          ? "gray"
                          : "red"
                  }
                  label={
                    approvalUnavailable || (resumeVerified && requestStatus)
                      ? approvalLabel(requestStatus, approvalUnavailable)
                      : resumeVerified
                        ? "Verified"
                        : resumeChecking
                          ? "Checking..."
                          : "Unverified"
                  }
                />
                {activeSession.updated_at && resumeVerification === "verified" && (
                  <Text type="supporting">
                    Last updated{" "}
                    {new Date(activeSession.updated_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                )}
              </HStack>
            </VStack>
          ) : (
            <Text color="secondary">No active session stored on this device.</Text>
          )}
        </VStack>
        <HStack gap={3} wrap="wrap" justify="end">
          <Button
            label={resumeButtonLabel}
            onClick={onResume}
            isDisabled={resumeButtonDisabled}
            isLoading={resumeBusy || resumeChecking}
            variant="secondary"
            icon={<Icon icon={Play} size="sm" />}
            tooltip={
              !activeSession
                ? "No active session to resume"
                : resumeVerification === "invalid"
                  ? "Session could not be verified"
                  : undefined
            }
          />
          {(resumeFailed || resumeRequestPending || approvalUnavailable) && (
            <Button label="Get help rejoining" onClick={() => setHelpOpen(true)} />
          )}
        </HStack>
      </HStack>
      {requestTime && activeSession?.resume_request_id && (
        <Text type="supporting">Request received {requestTime} (your device timezone).</Text>
      )}
      {resumeRequestPending && (
        <Text type="supporting">
          Waiting for approval does not pause the contest clock. If you need help, contact your
          invigilator. Approval timing is not guaranteed.
        </Text>
      )}
      {resumeStatus &&
        (resumeFailed || approvalUnavailable ? (
          <InlineAlert theme={theme} tone="danger">
            {resumeStatus}
          </InlineAlert>
        ) : (
          <Text type="supporting" role="status">
            {resumeStatus}
          </Text>
        ))}

      <HelpRequestModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        kind="DISCONNECT"
        sessionId={activeSession?.id ?? null}
        contestId={activeSession?.contest_id ?? null}
        summary="I was disconnected and can't rejoin my contest session."
        details={{ source: "resume_flow", resume_status: resumeStatus }}
      />
    </VStack>
  );
}

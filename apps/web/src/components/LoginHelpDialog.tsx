"use client";

import { ServiceStatus } from "@/components/ServiceStatus";

import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { AccessDialog } from "@/components/AccessDialog";
import { useAppVersion } from "@/lib/use-app-version";
import { openExternal } from "@/lib/open-external";
import {
  buildLoginHelpSummary,
  loginHelpError,
  LOGIN_HELP_TOPICS,
  LOGIN_SUPPORT_EMAIL,
  LOGIN_SUPPORT_URL,
  type LoginHelpTopic,
} from "@/lib/login-help";

type Props = { open: boolean; onClose: () => void; hasError: boolean; diagnostic: string | null };

/** Mount optional native metadata only when help is opened. No participant authentication. */
export function LoginHelpDialog(props: Props) {
  return props.open ? <LoginHelpContent {...props} /> : null;
}

function LoginHelpContent({ onClose, hasError, diagnostic }: Props) {
  const { version } = useAppVersion();
  const [topic, setTopic] = useState<LoginHelpTopic>("other");
  const [review, setReview] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [openedAt] = useState(() => new Date());
  const copyGeneration = useRef(0);
  useEffect(
    () => () => {
      copyGeneration.current += 1;
    },
    []
  );
  const summary = buildLoginHelpSummary({
    version,
    topic,
    diagnostic,
    hasError,
    openedAt,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
  });

  async function copy(text: string, label: string) {
    const generation = ++copyGeneration.current;
    setFeedback("");
    try {
      await navigator.clipboard.writeText(text);
      if (generation === copyGeneration.current)
        setFeedback(`${label} copied. Nothing has been sent.`);
    } catch {
      if (generation === copyGeneration.current)
        setFeedback("Copy was unavailable. Select the visible text and copy it manually.");
    }
  }

  return (
    <AccessDialog
      open
      onClose={onClose}
      title="Sign-in help"
      labelId="login-help-title"
      width="calc(var(--spacing-10) * 14)"
    >
      <VStack gap={5} style={{ minWidth: 0 }}>
        <Text>You don&apos;t need to sign in to get help.</Text>
        {hasError && <Text color="secondary">{loginHelpError(diagnostic, hasError)}</Text>}
        <VStack gap={2}>
          <Text type="label" id="login-help-topics">
            What do you need help with? (optional)
          </Text>
          <HStack gap={2} wrap="wrap" role="group" aria-labelledby="login-help-topics">
            {(Object.keys(LOGIN_HELP_TOPICS) as LoginHelpTopic[]).map((key) => (
              <Button
                key={key}
                size="sm"
                label={LOGIN_HELP_TOPICS[key].label}
                variant={topic === key ? "secondary" : "ghost"}
                aria-pressed={topic === key}
                onClick={() => {
                  setTopic(key);
                  copyGeneration.current += 1;
                  setFeedback("");
                }}
              />
            ))}
          </HStack>
          <Text color="secondary">{LOGIN_HELP_TOPICS[topic].guidance}</Text>
        </VStack>
        <VStack gap={2}>
          <Button
            label="Contact AMS support"
            variant="primary"
            onClick={() => {
              try {
                openExternal(LOGIN_SUPPORT_URL);
              } catch {
                /* Keep the manual route visible. */
              }
              copyGeneration.current += 1;
              setFeedback(
                "If the page did not open, copy the link below into your browser. Nothing has been sent from this app."
              );
            }}
          />
          <Text type="supporting">
            Opens your browser. Choose Support, describe the problem and submit the form there.
          </Text>
          <Text type="supporting">
            AMS support receives your message. Your contest organizer or invigilator handles
            credential reissue after verifying your identity.
          </Text>
          <Text type="code" style={{ overflowWrap: "anywhere", userSelect: "text" }}>
            {LOGIN_SUPPORT_URL}
          </Text>
          <HStack wrap="wrap" gap={2}>
            <Button
              label="Copy support link"
              size="sm"
              onClick={() => void copy(LOGIN_SUPPORT_URL, "Support link")}
            />
          </HStack>
          <Text style={{ overflowWrap: "anywhere", userSelect: "text" }}>
            {LOGIN_SUPPORT_EMAIL}
          </Text>
          <HStack wrap="wrap" gap={2}>
            <Button
              label="Copy email address"
              size="sm"
              onClick={() => void copy(LOGIN_SUPPORT_EMAIL, "Email address")}
            />
          </HStack>
          <Text type="supporting">
            Offline? These instructions stay available. Sending a message needs a connection; you
            can use the link or email address on another connected device.
          </Text>
        </VStack>
        <VStack gap={2}>
          <Button
            label={review ? "Hide troubleshooting details" : "Review troubleshooting details"}
            variant="ghost"
            aria-expanded={review}
            aria-controls="login-help-details"
            onClick={() => setReview(!review)}
          />
          {review && (
            <VStack gap={2} id="login-help-details">
              <Text type="supporting">
                Only the details below are copied. Your login ID and password are not included.
                Never share your password.
              </Text>
              <Text
                type="code"
                style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "text" }}
              >
                {summary}
              </Text>
              <Button
                label="Copy details"
                onClick={() => void copy(summary, "Troubleshooting details")}
              />
            </VStack>
          )}
        </VStack>
        <Text role="status" aria-live="polite" type="supporting">
          {feedback}
        </Text>
        <HStack justify="end">
          <Button label="Back to sign in" onClick={onClose} />
        </HStack>
      </VStack>
      <ServiceStatus components={["sign_in", "support"]} localFailure={hasError} expanded />
    </AccessDialog>
  );
}

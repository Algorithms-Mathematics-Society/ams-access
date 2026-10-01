"use client";

import { memo } from "react";
import { Card } from "@astryxdesign/core/Card";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { List, ListItem } from "@astryxdesign/core/List";
import { Button } from "@astryxdesign/core/Button";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Icon } from "@astryxdesign/core/Icon";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import type { ReadinessState, ContestantReadinessContext } from "./types";

const checks = [
  ["network", "Network connection"],
  ["camera", "Camera"],
  ["mic", "Microphone"],
  ["vm", "Virtual machine check"],
  ["keyboard", "Keyboard lockdown"],
  ["platform", "Platform support"],
  ["restrictedApps", "Restricted apps"],
] as const;

export const ReadinessWidget = memo(function ReadinessWidget({
  readiness,
  onSettingsRedirect,
  theme,
  onResolve,
  context,
  onPracticeRun,
}: {
  readiness: ReadinessState;
  onSettingsRedirect: () => void;
  theme: "dark" | "light";
  onResolve?: (key: string) => void;
  context?: ContestantReadinessContext;
  onPracticeRun?: () => void;
}) {
  const failedChecks = checks.filter(([key]) => readiness[key] === "fail");
  const pendingChecks = checks.filter(([key]) => readiness[key] === "checking");
  const passedChecks = checks.filter(([key]) => readiness[key] === "ok");
  const policyNeedsReview =
    context?.status === "blocked_by_policy" ||
    context?.status === "needs_action" ||
    context?.status === "advisory_warning";
  const summary = failedChecks.length > 0
    ? `${failedChecks.length} ${failedChecks.length === 1 ? "check needs" : "checks need"} attention`
    : pendingChecks.length > 0 || context?.status === "checking"
      ? "Checking your setup"
      : policyNeedsReview
        ? "Review your setup"
        : "Checks complete";

  return (
    <Card
      padding={6}
      aria-labelledby="device-readiness-heading"
      style={{ border: 0, borderRadius: "var(--radius-container)" }}
    >
      <VStack gap={5}>
        <VStack gap={3}>
          <Heading level={4} accessibilityLevel={2} id="device-readiness-heading">
            Device readiness
          </Heading>
          <VStack gap={2} role="status">
            <Text type="large" weight="medium">
              {summary}
            </Text>
            <Text type="supporting">
              {context?.message ?? "Review these checks before entering a contest."}
            </Text>
          </VStack>
        </VStack>

        {failedChecks.length > 0 && (
          <VStack as="section" gap={2} aria-label="Checks needing attention">
            <List density="compact" aria-label="Checks needing attention">
              {failedChecks.map(([key, label]) => (
                <ReadinessItem
                  key={key}
                  label={label}
                  status={readiness[key]}
                  theme={theme}
                  onResolve={onResolve ? () => onResolve(key) : undefined}
                />
              ))}
            </List>
          </VStack>
        )}

        {pendingChecks.length > 0 && (
          <VStack as="section" gap={2} aria-label="Checks in progress">
            <HStack gap={2} align="center">
              <StatusDot variant="neutral" label="Checking" />
              <Text type="supporting">Checking</Text>
            </HStack>
            <List density="compact" aria-label="Checks in progress">
              {pendingChecks.map(([key, label]) => (
                <ReadinessItem key={key} label={label} status={readiness[key]} theme={theme} />
              ))}
            </List>
          </VStack>
        )}

        {passedChecks.length > 0 && (
          <Collapsible
            defaultIsOpen={false}
            trigger={
              <HStack as="span" gap={2} align="center">
                <StatusDot variant="success" label="Passed" />
                <Text type="supporting">
                  {passedChecks.length} {passedChecks.length === 1 ? "check" : "checks"} passed
                </Text>
              </HStack>
            }
          >
            <List density="compact" aria-label="Passed checks">
              {passedChecks.map(([key, label]) => (
                <ReadinessItem key={key} label={label} status={readiness[key]} theme={theme} />
              ))}
            </List>
          </Collapsible>
        )}

        <VStack gap={2}>
          {onPracticeRun && (
            <Button
              label="Test setup"
              variant="secondary"
              onClick={onPracticeRun}
              width="100%"
              icon={<Icon icon="wrench" size="sm" />}
            />
          )}
          <Button
            label="Open settings"
            variant="ghost"
            onClick={onSettingsRedirect}
            width="100%"
          />
        </VStack>
      </VStack>
    </Card>
  );
});

export const ReadinessItem = memo(function ReadinessItem({
  label,
  status,
  onResolve,
}: {
  label: string;
  status: "ok" | "fail" | "checking";
  theme: "dark" | "light";
  onResolve?: () => void;
}) {
  const statusLabel =
    status === "ok" ? "Passed" : status === "fail" ? "Needs action" : "Checking...";
  const canResolve = status === "fail" && !!onResolve;
  return (
    <ListItem
      style={{ paddingInline: 0, minHeight: canResolve ? "var(--spacing-10)" : undefined }}
      label={
        <>
          {canResolve && <VisuallyHidden>Resolve </VisuallyHidden>}
          <Text>{label}</Text>
        </>
      }
      aria-label={canResolve ? `Resolve ${label.toLowerCase()}` : `${label}: ${statusLabel}`}
      onClick={canResolve ? onResolve : undefined}
      endContent={canResolve ? <Icon icon="chevronRight" size="sm" /> : undefined}
    />
  );
});

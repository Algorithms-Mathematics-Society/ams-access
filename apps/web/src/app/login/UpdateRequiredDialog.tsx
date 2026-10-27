"use client";

import { useState } from "react";
import { CloseAppButton } from "@/components/CloseAppButton";

/**
 * "This AMS Access is too old for the exam server."
 *
 * Blocking, and deliberately so: it is only raised for a build below the
 * server's minimum, which the server refuses with 426 anyway. There is no
 * close button and no overlay click-through: the way past it is to install,
 * or to quit the app.
 *
 * A newer *advisory* release never raises this -- see lib/client-update.ts.
 * Locking a candidate out over a version the server still accepts is how a
 * release published the night before ruins contest morning.
 *
 * Deliberately short. It said which account the download page wanted (it
 * wants none, the page is public) and why installing mattered, to someone
 * who has one button and no decision to make. The version pair stays,
 * because "I already updated" is the one thing a candidate may need to
 * check against an invigilator.
 */

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";

export function UpdateRequiredDialog({
  currentVersion,
  latestVersion,
  downloadUrl,
  onInstall,
}: {
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  onInstall: (url: string) => void;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <VStack
      align="center"
      justify="center"
      gap={0}
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-required-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        padding: "var(--spacing-5)",
        background: "color-mix(in srgb, var(--color-background-body) 88%, transparent)",
      }}
    >
      <Card
        padding={5}
        style={{
          maxWidth: "28rem",
          width: "100%",
          maxHeight: "100%",
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        <VStack gap={4}>
          <Heading level={2} id="update-required-title">
            Update AMS Access
          </Heading>
          <Text>This version is no longer supported. Install the update to continue.</Text>
          <Text type="supporting" color="secondary">
            {currentVersion} &rarr; {latestVersion}
          </Text>
          <Text type="supporting" color="secondary">
            Installed: {currentVersion} · Available: {latestVersion}
          </Text>
          <Text type="supporting">
            Opening the page does not install the update. Use the official download page, not an
            installer shared in a group chat.
          </Text>
          <Text type="code" style={{ overflowWrap: "anywhere", userSelect: "text" }}>
            {downloadUrl}
          </Text>
          {opened && (
            <Text role="status">
              If the page did not open, copy the address into your browser. No download or
              installation has been confirmed by this app.
            </Text>
          )}
          <CloseAppButton />
          <Button
            label="Open official download"
            variant="primary"
            onClick={() => {
              setOpened(true);
              onInstall(downloadUrl);
            }}
            style={{ alignSelf: "flex-start" }}
          />
        </VStack>
      </Card>
    </VStack>
  );
}

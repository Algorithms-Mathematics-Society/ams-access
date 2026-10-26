"use client";

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
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-required-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--spacing-5)",
        background: "color-mix(in srgb, var(--color-background-body) 88%, transparent)",
      }}
    >
      <Card padding={5} style={{ maxWidth: "28rem", width: "100%" }}>
        <VStack gap={4}>
          <Heading level={2} id="update-required-title">
            Update AMS Access
          </Heading>
          <Text>This version is no longer supported. Install the update to continue.</Text>
          <Text type="supporting" color="secondary">
            {currentVersion} &rarr; {latestVersion}
          </Text>
          <Button
            label="Install"
            variant="primary"
            onClick={() => onInstall(downloadUrl)}
            style={{ alignSelf: "flex-start" }}
          />
        </VStack>
      </Card>
    </div>
  );
}

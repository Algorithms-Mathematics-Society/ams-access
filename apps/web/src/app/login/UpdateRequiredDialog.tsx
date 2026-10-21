"use client";

/**
 * "A newer AMS Access is available."
 *
 * Blocking, and deliberately so. The app cannot update itself and the exam
 * machine's network lockdown reaches one host, so a candidate who dismisses
 * this sits their contest on the old build and finds out what was fixed the
 * hard way. There is no close button and no overlay click-through: the way
 * past it is to install, or to quit the app.
 *
 * Only ever raised for a newer *minor* release -- see lib/client-update.ts
 * for why patches say nothing.
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
          <Text>A newer version is available. Install it to continue.</Text>
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

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
 */

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { HStack, VStack } from "@astryxdesign/core/Stack";
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
          <Text>
            A newer version of AMS Access is available. Install it before signing in, so your
            exam runs on the current build.
          </Text>
          <HStack gap={3} align="center" wrap="wrap">
            <Text type="supporting" color="secondary">
              You have {currentVersion}
            </Text>
            <Text type="supporting" color="secondary">
              Latest is {latestVersion}
            </Text>
          </HStack>
          <Button
            label="Install"
            variant="primary"
            onClick={() => onInstall(downloadUrl)}
            style={{ alignSelf: "flex-start" }}
          />
          <Text type="supporting" color="secondary">
            Signing in to the download page uses your organisation account, not your exam
            passphrase.
          </Text>
        </VStack>
      </Card>
    </div>
  );
}

"use client";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { ThemeToggle } from "@/components/ThemeToggle";

interface WelcomeScreenProps {
  onEnter: () => void;
}

const steps = [
  { number: "01", title: "Sign in", detail: "Use your organizer’s credentials." },
  { number: "02", title: "Check your setup", detail: "Prepare your camera and device." },
  { number: "03", title: "Enter your contest", detail: "Review the schedule and entry checks." },
];

export default function WelcomeScreen({ onEnter }: WelcomeScreenProps) {
  // Astryx centered-hero composition: 640px hero, 800px preparation guide,
  // and 16–40px outer gutters. All regions stay in normal document flow.
  return (
    <AppShell height="fill" variant="section" contentPadding={0}>
      <VStack
        data-welcome-page
        gap={6}
        style={{
          width: "100%",
          maxWidth: "calc(var(--spacing-10) * 28)",
          minHeight: "100%",
          marginInline: "auto",
          padding: "clamp(var(--spacing-4), 4vw, var(--spacing-10))",
        }}
      >
        <HStack as="header" gap={4} justify="between" align="center">
          <HStack gap={3} align="center">
            <svg
              viewBox="0 0 176 166"
              fill="none"
              aria-hidden="true"
              style={{ width: "var(--spacing-6)", height: "var(--spacing-6)", flexShrink: 0 }}
            >
              <path d="M4 162L88 4L172 162" stroke="var(--color-accent-base)" strokeWidth="6" />
            </svg>
            <Text type="large" weight="semibold">
              Access
            </Text>
          </HStack>
          <ThemeToggle />
        </HStack>

        <VStack
          gap={10}
          align="center"
          justify="center"
          style={{
            flex: "1 0 auto",
            paddingBlock: "clamp(var(--spacing-6), 6vh, calc(var(--spacing-10) * 2))",
          }}
        >
          <VStack
            gap={8}
            align="center"
            style={{ width: "100%", maxWidth: "calc(var(--spacing-10) * 16)", minWidth: 0 }}
          >
            <VStack gap={4} align="center">
              <Text type="supporting">YOUR CONTEST WORKSPACE</Text>
              <Heading
                level={1}
                type="display-1"
                justify="center"
                textWrap="balance"
                style={{
                  maxWidth: "16ch",
                  fontSize: "clamp(var(--font-size-3xl), 4.5vw, var(--font-size-5xl))",
                  fontWeight: "var(--font-weight-semibold)",
                  lineHeight: "var(--text-display-1-leading)",
                }}
              >
                Your contest starts here.
              </Heading>
              <Text
                type="large"
                color="secondary"
                justify="center"
                textWrap="balance"
                style={{ maxWidth: "44ch", fontWeight: "var(--font-weight-normal)" }}
              >
                Sign in to see your assigned contests and prepare your device.
              </Text>
            </VStack>
            <VStack gap={3} align="center" style={{ width: "100%" }}>
              <Button
                type="button"
                label="Enter workspace"
                variant="primary"
                size="lg"
                onClick={onEnter}
                width="calc(var(--spacing-10) * 6)"
                style={{
                  maxWidth: "100%",
                  minHeight: "calc(var(--spacing-10) + var(--spacing-1))",
                }}
              />
              <Text type="supporting" justify="center">
                You’ll sign in on the next screen.
              </Text>
            </VStack>
          </VStack>

          <VStack
            as="section"
            aria-label="Getting started"
            gap={6}
            style={{ width: "100%", maxWidth: "calc(var(--spacing-10) * 20)" }}
          >
            <Divider />
            <HStack
              as="ol"
              gap={6}
              wrap="wrap"
              align="start"
              style={{ listStyle: "none", padding: 0, margin: 0 }}
            >
              {steps.map((step) => (
                <HStack
                  as="li"
                  key={step.number}
                  gap={3}
                  align="start"
                  style={{ flex: "1 1 calc(var(--spacing-10) * 5)", minWidth: 0 }}
                >
                  <Text type="supporting" aria-hidden="true">
                    {step.number}
                  </Text>
                  <VStack gap={1}>
                    <Text weight="medium">{step.title}</Text>
                    <Text type="supporting">{step.detail}</Text>
                  </VStack>
                </HStack>
              ))}
            </HStack>
          </VStack>
        </VStack>
      </VStack>
    </AppShell>
  );
}

import { List, ListItem } from "@astryxdesign/core/List";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";

const preparationSteps = [
  {
    title: "Sign in with your details",
    description: "Your organizer provides the handle and password for your contest.",
  },
  {
    title: "Check your setup",
    description: "Review camera, microphone and device readiness from your workspace.",
  },
  {
    title: "Open your assigned contest",
    description: "Review its schedule and complete the required checks before entering.",
  },
];

export function BrandPane() {
  return (
    <VStack
      as="aside"
      aria-labelledby="login-preparation-heading"
      data-login-preparation
      gap={6}
      style={{
        flex: "1 1 calc(var(--spacing-10) * 10)",
        minWidth: 0,
      }}
    >
      <VStack
        gap={6}
        style={{ width: "100%", maxWidth: "calc(var(--spacing-10) * 10)", marginInline: "auto" }}
      >
        <VStack gap={2}>
          <Heading level={2} id="login-preparation-heading">
            Before your contest
          </Heading>
          <Text color="secondary">A few steps to get your workspace ready.</Text>
        </VStack>
        <List
          hasDividers
          density="spacious"
          listStyle="decimal"
          aria-label="Getting ready for your contest"
        >
          {preparationSteps.map((step) => (
            <ListItem
              key={step.title}
              label={step.title}
              description={<Text type="supporting">{step.description}</Text>}
              style={{ paddingInline: 0 }}
            />
          ))}
        </List>
        <Text type="supporting">
          This is a proctored exam workspace. Your contest will guide you through its required
          setup.
        </Text>
      </VStack>
    </VStack>
  );
}

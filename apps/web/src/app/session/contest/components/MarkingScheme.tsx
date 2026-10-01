/**
 * What this problem is marked on, stated before the candidate writes.
 *
 * The judge runs three independent families, and the scoreboard treats them
 * very differently: behaviour is weighted more heavily than I/O, and
 * **symbolic is a gate** — one violation zeroes the problem's whole partial
 * credit, however well the code runs.
 *
 * All of it has been on the wire since contract v2 and none of it reached the
 * screen. A candidate could lose a problem outright to a rule nobody showed
 * them, which is not a marking scheme, it is a trap.
 *
 * Rendered in the statement, always visible — not behind a tab. A rule you
 * have to go looking for is a rule you can miss.
 */

import { ruleText } from "../family-summary";
import type { Question } from "./questions";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";

export function MarkingScheme({ question }: { question: Question }) {
  const families = question.families;
  if (!families) return null;

  const symbolic = families.symbolic;
  const rules = symbolic?.rules ?? [];

  if (question.backfilled) {
    return <VStack as="section" gap={3} aria-label="How this is marked"
      style={{ borderTop: "var(--border-width) solid var(--color-border)", paddingTop: "var(--spacing-5)" }}>
      <Heading level={4} accessibilityLevel={2}>How this is marked</Heading>
      <Text type="supporting">The full marking breakdown isn&rsquo;t available for this problem. Read the statement
        carefully for any restrictions on what you may use.</Text>
    </VStack>;
  }

  const graded = [
    { label: "Input/output tests", family: families.io },
    { label: "Behaviour tests", family: families.behavior },
  ].filter((entry) => entry.family && entry.family.count > 0);

  return <VStack as="section" gap={4} aria-label="How this is marked"
    style={{ borderTop: "var(--border-width) solid var(--color-border)", paddingTop: "var(--spacing-5)" }}>
    <Heading level={4} accessibilityLevel={2}>How this is marked</Heading>
    {graded.length > 0 && <MetadataList label={{ position: "start", width: "50%" }}>
      {graded.map(({ label, family }) => <MetadataListItem key={label} label={label}>
        <Text type="supporting" hasTabularNumbers>{family.count} {family.count === 1 ? "test" : "tests"}{family.weight > 1 && ` · ×${family.weight} weight`}</Text>
      </MetadataListItem>)}
    </MetadataList>}
    {rules.length > 0 && <VStack gap={3}>
      <Heading level={5} accessibilityLevel={3}>Restrictions</Heading>
      <VStack as="ul" gap={2} style={{ paddingInlineStart: "var(--spacing-5)", margin: 0 }}>
        {rules.map((rule) => <li key={`${rule.kind}:${rule.pattern}`}>
          <Text type="code">{rule.pattern}</Text><Text> — {ruleText(rule)}</Text>
        </li>)}
      </VStack>
      <Text type="supporting" style={{ color: "var(--color-text-yellow)" }}>
        These aren&rsquo;t scored on their own. Breaking one scores <strong>zero for this problem</strong>, however well your code runs.
      </Text>
    </VStack>}
  </VStack>;
}

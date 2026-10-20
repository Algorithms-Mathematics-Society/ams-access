/**
 * The restrictions a problem places on the source, stated before the
 * candidate writes.
 *
 * A symbolic rule is a gate: breaking one costs the problem however well the
 * code runs. A rule nobody shows you is a trap, so these stay in the
 * statement, always visible, not behind a tab.
 *
 * Two things this deliberately does not show.
 *
 * The rule's **pattern**: the judge greps for `\b(std::)?variant\b`, and that
 * regex was printed verbatim next to the sentence explaining it. It told a
 * candidate nothing they could act on and made a plain requirement look like
 * something they had to decode. `ruleText` already prefers the setter's own
 * sentence; now that is all there is.
 *
 * The **marking breakdown** -- test counts and family weights. A candidate
 * cannot see the behaviour tests, so knowing there are nine of them at treble
 * weight is not something they can do anything about. It framed the statement
 * as a scoring table when what matters is the task.
 */

import { ruleText } from "../family-summary";
import type { Question } from "./questions";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";

export function Restrictions({ question }: { question: Question }) {
  const families = question.families;
  if (!families) return null;

  // A backfilled problem has no rule data at all. Say so rather than printing
  // an empty heading: "there are none" and "we do not know" differ, and a
  // candidate who assumes the first loses the problem.
  if (question.backfilled) {
    return (
      <VStack
        as="section"
        gap={3}
        aria-label="Restrictions"
        style={{
          borderTop: "var(--border-width) solid var(--color-border)",
          paddingTop: "var(--spacing-5)",
        }}
      >
        <Heading level={4} accessibilityLevel={2}>
          Restrictions
        </Heading>
        <Text type="supporting">
          The restrictions aren&rsquo;t listed for this problem. Read the statement carefully for
          any limits on what you may use.
        </Text>
      </VStack>
    );
  }

  const rules = families.symbolic?.rules ?? [];
  if (rules.length === 0) return null;

  return (
    <VStack
      as="section"
      gap={3}
      aria-label="Restrictions"
      style={{
        borderTop: "var(--border-width) solid var(--color-border)",
        paddingTop: "var(--spacing-5)",
      }}
    >
      <Heading level={4} accessibilityLevel={2}>
        Restrictions
      </Heading>
      <VStack as="ul" gap={2} style={{ paddingInlineStart: "var(--spacing-5)", margin: 0 }}>
        {rules.map((rule) => (
          <li key={`${rule.kind}:${rule.pattern}`}>
            <Text>{ruleText(rule)}</Text>
          </li>
        ))}
      </VStack>
    </VStack>
  );
}

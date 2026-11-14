import { VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { List, ListItem } from "@astryxdesign/core/List";
import type { TeamIntegrationSummary } from "@/lib/team-vote";
import { integrationStatus } from "@/lib/team-vote";
const counts = (passed: number | null, total: number | null) =>
  passed !== null && total !== null ? ` · ${passed}/${total} checks` : "";

export function TeamIntegrationResult({ result }: { result: TeamIntegrationSummary | null }) {
  if (!result) return <Text>No finished integration result yet.</Text>;
  const detail = result.details;
  const pending = ["queued", "pending", "running", "judging"].includes(result.status);
  return (
    <VStack gap={3}>
      <Heading level={3}>Integration result · revision {result.revision}</Heading>
      <Text>{integrationStatus(result)}</Text>
      {pending ? (
        <Text>Part and suite results will appear after judging finishes.</Text>
      ) : !detail ? (
        <Text>Detailed part results are unavailable. A pass cannot be confirmed.</Text>
      ) : (
        <>
          {detail.substitutions.map((sub, index) => (
            <Text key={`${sub.label}-${index}`} role="status">
              Part {sub.label} was not supplied by your team —{" "}
              {sub.reference ? "the setter’s reference" : "a substitute"} was linked so the rest
              could be tested. It scores nothing, and integration does not count until every part is
              your team’s own. Reason: {sub.reason}.
            </Text>
          ))}
          <List aria-label="Individual part results">
            {detail.parts.map((part) => (
              <ListItem
                key={part.label}
                label={`Part ${part.label}`}
                description={
                  part.substituted
                    ? "Substituted · no score (not a team pass)"
                    : `${part.verdict ?? "Verdict pending"}${counts(part.passed_count, part.total_count)}`
                }
              />
            ))}
          </List>
          <Heading level={4}>Integration suite</Heading>
          <Text>
            {detail.substitutions.length
              ? "Not eligible for integration credit while parts are substituted."
              : `Suite verdict: ${detail.integration_verdict ?? "Pending"}`}
          </Text>
          <Text>
            Total checks across the result{counts(detail.passed_count, detail.total_count)}.
          </Text>
          {detail.project_failure ? (
            <Text role="status">
              The project fails as a whole; no single part is identified as the cause.
            </Text>
          ) : (
            detail.failing_parts.length > 0 && (
              <Text role="status">Check parts: {detail.failing_parts.join(", ")}.</Text>
            )
          )}
        </>
      )}
    </VStack>
  );
}

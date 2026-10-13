import { type useRouter } from "next/navigation";
import { AppShell } from "@astryxdesign/core/AppShell";
import { VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Spinner } from "@astryxdesign/core/Spinner";
export function BootScreen({ label }: { label: string }) {
  return (
    <AppShell height="fill" style={{ height: "100dvh" }}>
      <VStack
        align="center"
        justify="center"
        gap={4}
        role="status"
        style={{ minHeight: "100%", padding: "var(--spacing-6)" }}
      >
        <Spinner />
        <Text color="secondary">{label}</Text>
      </VStack>
    </AppShell>
  );
}
export interface ContestLoadErrorScreenProps {
  loadError: string;
  router: ReturnType<typeof useRouter>;
  /** Present only for retryable failures. */
  onRetry?: () => void;
  hideBack?: boolean;
}
export function ContestLoadErrorScreen({
  loadError,
  router,
  onRetry,
  hideBack = false,
}: ContestLoadErrorScreenProps) {
  return (
    <AppShell height="fill" style={{ height: "100dvh" }}>
      <VStack
        align="center"
        justify="center"
        style={{ minHeight: "100%", padding: "var(--spacing-6)" }}
      >
        <VStack gap={5} style={{ width: "100%", maxWidth: "calc(var(--spacing-10) * 14)" }}>
          <Heading level={1}>Unable to open your contest</Heading>
          <Banner status="error" title="Contest load error" description={loadError} />
          {onRetry && <Button label="Retry" variant="primary" onClick={onRetry} />}
          {!hideBack && (
            <Button
              label="Back to contests"
              variant={onRetry ? "secondary" : "primary"}
              onClick={() => router.push("/home")}
            />
          )}
        </VStack>
      </VStack>
    </AppShell>
  );
}

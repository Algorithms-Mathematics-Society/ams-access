import { type useRouter } from "next/navigation";
import { AppShell } from "@astryxdesign/core/AppShell";
import { VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Spinner } from "@astryxdesign/core/Spinner";
import { BackToHomeButton } from "@/components/BackToHomeButton";
export { ENTRY_WAIT_PHASES, entryWaitPhase } from "../entry-wait";
export function BootScreen({
  label,
  detail,
  onExit,
}: {
  label: string;
  detail?: string;
  onExit?: () => void;
}) {
  return (
    <AppShell height="fill" style={{ height: "100dvh" }}>
      <VStack
        align="center"
        justify="center"
        gap={4}
        role="status"
        aria-live="polite"
        style={{ minHeight: "100%", padding: "var(--spacing-6)" }}
      >
        <Spinner />
        <Text color="secondary">{label}</Text>
        {/* Second line, not a replacement: the heading stays still while the
            explanation underneath changes, so a candidate reading mid-wait
            is not told a different thing every few seconds. */}
        {detail ? (
          <Text
            type="supporting"
            color="secondary"
            style={{ textAlign: "center", maxWidth: "34rem" }}
          >
            {detail}
          </Text>
        ) : null}
        {onExit && <Button label="Leave workspace" variant="secondary" onClick={onExit} />}
      </VStack>
    </AppShell>
  );
}

export interface ContestLoadErrorScreenProps {
  loadError: string;
  router: ReturnType<typeof useRouter>;
  /** Present only for retryable failures. */
  onRetry?: () => void;
  /** Where the exit goes; a redirect that failed cleanup keeps its target. */
  exitTo?: string;
}
export function ContestLoadErrorScreen({
  loadError,
  onRetry,
  exitTo = "/home",
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
          {/* Always offered, even when cleanup failed: the release is local
              and works with the backend down, so a stuck candidate can leave. */}
          <BackToHomeButton
            label={exitTo === "/login" ? "Exit to sign in" : "Exit to contests"}
            variant={onRetry ? "secondary" : "primary"}
            destination={exitTo}
          />
        </VStack>
      </VStack>
    </AppShell>
  );
}

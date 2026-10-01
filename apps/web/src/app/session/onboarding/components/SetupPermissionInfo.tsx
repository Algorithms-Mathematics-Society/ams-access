import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

/** Purpose only: no promises about organizer-specific collection or retention. */
export function SetupPermissionInfo({ kind }: { kind: "camera" | "microphone" }) {
  return <VStack as="details" gap={2} style={{ borderBottom: "var(--border-width) solid var(--color-border)", paddingBottom: "var(--spacing-3)" }}>
    <summary style={{ cursor: "pointer" }}><Text as="span" weight="medium">Why this {kind} check?</Text></summary>
    <Text type="supporting" color="secondary" style={{ paddingTop: "var(--spacing-2)" }}>
      {kind === "camera"
        ? "Camera access lets setup show a live preview, position your face, and check your presence. The next steps guide you through those checks."
        : "Microphone access lets setup check that audio input is available and show its activity. The meter does not grade your voice or measure sound quality."}
    </Text>
    <Text type="supporting" color="secondary">Your organizer’s proctoring and privacy terms also apply. Ask your invigilator if you need clarification before continuing.</Text>
  </VStack>;
}

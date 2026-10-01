import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { useCallback, useEffect, useState } from "react";
import { CheckLine, StageHeader } from "../ui";
import { invoke, withNullableTimeout } from "../../support";

/**
 * Restricted-application scan.
 *
 * Three outcomes, not two. `withNullableTimeout` returns null for a timeout,
 * for a thrown command, and for any build without the Tauri shell — and the
 * old `result?.found ?? []` collapsed all three onto the empty array, which
 * rendered as a green "No conflicting applications found". A scan that never
 * ran is not a clean machine, and saying otherwise is the single most
 * misleading thing this flow could tell a proctor.
 *
 * `unknown` warns and lets the candidate through rather than blocking: the
 * scan failing is not their doing, and a locked-out candidate at an exam
 * centre is a worse outcome than an unscanned one flagged for review.
 */
type ScanOutcome = "scanning" | "clean" | "found" | "unknown";

export function Stage5_RestrictedApps({ onPass, onWarn }: { onPass(): void; onWarn(): void }) {
  const [outcome, setOutcome] = useState<ScanOutcome>("scanning");
  const [found, setFound] = useState<string[]>([]);
  const [cleared, setCleared] = useState(false);

  const doScan = useCallback(async () => {
    setOutcome("scanning");
    setCleared(false);
    await new Promise((r) => setTimeout(r, 600));
    const result = await withNullableTimeout(
      invoke<{ found: string[]; clean: boolean }>("scan_processes"),
      3000
    );
    if (result === null || !Array.isArray(result.found)) {
      setFound([]);
      setOutcome("unknown");
      setTimeout(onWarn, 1400);
      return;
    }
    setFound(result.found);
    setOutcome(result.found.length === 0 ? "clean" : "found");
    if (result.found.length === 0) setTimeout(onPass, 800);
  }, [onPass, onWarn]);

  useEffect(() => {
    void doScan();
  }, [doScan]);

  const prettyName: Record<string, string> = {
    obs: "OBS Studio",
    discord: "Discord (streaming)",
    teamviewer: "TeamViewer",
    anydesk: "AnyDesk",
    wireshark: "Wireshark",
    "cheat engine": "Cheat Engine",
  };

  return (
    <VStack gap={6} width="100%">
      <StageHeader label="Application check" />
      <Text color="secondary">
        Close screen recorders, remote access tools and other restricted applications before your
        contest.
      </Text>
      {outcome === "scanning" ? (
        <CheckLine label="Checking for restricted applications..." status="checking" />
      ) : outcome === "unknown" ? (
        <VStack gap={4}>
          <Banner
            status="warning"
            title="The application check could not run"
            description="We couldn’t read the running applications on this device. This is recorded for your proctor and does not stop entry. Close anything you aren’t using."
          />
          <Button variant="secondary" label="Try the check again" onClick={() => void doScan()} />
          <CheckLine label="Restricted applications: not checked" status="unknown" />
        </VStack>
      ) : outcome === "found" && !cleared ? (
        <VStack gap={4}>
          <Banner
            status="warning"
            title="Close these apps to continue"
            description="After closing each application below, run the check again."
          />
          <VStack gap={2}>
            {found.map((f) => (
              <CheckLine key={f} label={prettyName[f] ?? f} status="fail" />
            ))}
          </VStack>
          <Button variant="secondary" label="Check apps again" onClick={() => void doScan()} />
        </VStack>
      ) : (
        <CheckLine label="No conflicting applications found" status="pass" />
      )}
    </VStack>
  );
}

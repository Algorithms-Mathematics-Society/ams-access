import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { useEffect, useState } from "react";
import { CheckLine, StageHeader } from "../ui";
import { tauriWindow } from "../../support";

/**
 * Full-screen lockdown.
 *
 * This asked the window to go full-screen, swallowed every error, and then
 * passed on an 800 ms timer — so on a machine where the compositor refused,
 * or outside the Tauri shell entirely, it reported the exam window as locked
 * down while the candidate still had a desktop. It is the last stage that was
 * reporting a result it had not measured.
 *
 * Now it asks, then *checks*, and warns rather than passing when the window
 * is not actually full-screen. It still advances — decision 7, onboarding
 * records and warns rather than ejecting — and the later Setup Verification
 * stage re-reads the same fact, so a machine that drifts back out of
 * full-screen is caught twice.
 */
export function Stage1_Fullscreen({ onPass, onWarn }: { onPass(): void; onWarn(): void }) {
  const [done, setDone] = useState(false);
  const [engaged, setEngaged] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function go() {
      const win = await tauriWindow();
      if (win) {
        await win.setFullscreen(true).catch(() => {});
        await win.setAlwaysOnTop(true).catch(() => {});
        await win.setDecorations(false).catch(() => {});
      }

      // Give the compositor a moment to actually apply it before asking.
      await new Promise((r) => setTimeout(r, 800));
      if (cancelled) return;

      // Ask the window first; fall back to comparing the viewport against the
      // screen, which is what Setup Verification uses. The tolerance is for
      // the few pixels some window managers keep for themselves.
      let ok = false;
      if (win) {
        ok = await win.isFullscreen().catch(() => false);
      }
      if (!ok) {
        ok =
          Boolean(document.fullscreenElement) || window.innerHeight >= window.screen.height * 0.94;
      }

      if (cancelled) return;
      setEngaged(ok);
      setDone(true);
      setTimeout(() => {
        if (!cancelled) (ok ? onPass : onWarn)();
      }, 600);
    }

    void go();
    return () => {
      cancelled = true;
    };
  }, [onPass, onWarn]);

  return (
    <VStack gap={6} width="100%">
      <StageHeader label="Secure full-screen" />
      <Text color="secondary">
        We’re preparing your contest window so you can focus on your work.
      </Text>
      <MetadataList>
        <MetadataListItem label="Window mode">
          {!done ? "Switching to full-screen" : engaged ? "Full-screen" : "Not confirmed"}
        </MetadataListItem>
      </MetadataList>
      <CheckLine
        label={
          !done
            ? "Switching to full-screen..."
            : engaged
              ? "Full-screen mode active"
              : "Could not confirm full-screen — recorded for your proctor"
        }
        status={!done ? "checking" : engaged ? "pass" : "warn"}
      />
    </VStack>
  );
}

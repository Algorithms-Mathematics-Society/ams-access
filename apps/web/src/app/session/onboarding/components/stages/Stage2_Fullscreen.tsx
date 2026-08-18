import { useEffect, useState } from "react";
import { useTheme } from "../hooks";
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
export function Stage2_Fullscreen({ onPass, onWarn }: { onPass(): void; onWarn(): void }) {
  const [done, setDone] = useState(false);
  const [engaged, setEngaged] = useState(true);
  const theme = useTheme();
  const isLight = theme === "light";

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
          Boolean(document.fullscreenElement) ||
          window.innerHeight >= window.screen.height * 0.94;
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
    <div className="flex flex-col items-start w-full">
      <StageHeader label="Secure Full-Screen" />

      <div
        style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "12.5px",
          lineHeight: 1.8,
          color: isLight ? "#334155" : "rgba(255,255,255,0.58)",
          width: "100%",
          padding: "18px 24px",
          background: isLight ? "#f8fafc" : "#0F0F0F",
          border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)"}`,
          borderRadius: "var(--radius-sm)",
          marginBottom: "20px",
        }}
      >
        <div>
          <span style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}>
            Window mode:{" "}
          </span>
          <span style={{ color: !done ? "#f59e0b" : engaged ? "#22c55e" : "#f59e0b", fontWeight: 700 }}>
            {!done ? "Starting" : engaged ? "Full-screen" : "Not full-screen"}
          </span>
        </div>
        <div>
          <span style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}>
            Focus mode:{" "}
          </span>
          <span style={{ color: !done ? "#f59e0b" : engaged ? "#22c55e" : "#f59e0b", fontWeight: 700 }}>
            {!done ? "Starting" : engaged ? "On" : "Unconfirmed"}
          </span>
        </div>
        <div>
          <span style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}>
            Window controls:{" "}
          </span>
          <span style={{ color: !done ? "#f59e0b" : engaged ? "#22c55e" : "#f59e0b", fontWeight: 700 }}>
            {!done ? "Starting" : engaged ? "Hidden" : "Unconfirmed"}
          </span>
        </div>
      </div>

      <div style={{ width: "100%" }}>
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
      </div>
    </div>
  );
}

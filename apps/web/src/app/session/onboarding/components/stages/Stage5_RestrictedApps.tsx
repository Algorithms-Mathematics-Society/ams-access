import { useCallback, useEffect, useState } from "react";
import { Button } from "@/app/home/components/ui-primitives";
import { useTheme } from "../hooks";
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
  const theme = useTheme();
  const isLight = theme === "light";

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
    <div className="flex flex-col items-center w-full">
      <StageHeader label="Application Check" />

      {outcome === "scanning" ? (
        <div className="flex flex-col items-center gap-4 w-full">
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
            }}
          >
            <div>
              <span
                style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}
              >
                Checking apps:{" "}
              </span>
              <span style={{ color: "#f59e0b", fontWeight: 700 }}>Active</span>
            </div>
            <div>
              <span
                style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}
              >
                Checking conflicts:{" "}
              </span>
              <span style={{ color: "#f59e0b", fontWeight: 700 }}>Running</span>
            </div>
          </div>
          <CheckLine label="Checking for restricted applications..." status="checking" />
        </div>
      ) : outcome === "unknown" ? (
        <div className="flex flex-col items-center gap-5 w-full">
          <div
            style={{
              width: "100%",
              padding: "18px 24px",
              borderRadius: "var(--radius-sm)",
              background: isLight ? "#fff7ed" : "#1c1007",
              border: `1px solid ${isLight ? "#fed7aa" : "#78350f"}`,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: "12.5px",
              lineHeight: 1.7,
            }}
          >
            <p
              style={{
                margin: "0 0 6px",
                fontWeight: 700,
                color: isLight ? "#9a3412" : "#fb923c",
              }}
            >
              The application check could not run
            </p>
            <p style={{ margin: 0, color: isLight ? "#7c2d12" : "#fdba74" }}>
              We could not read the list of running applications on this device, so we cannot say
              whether any restricted ones are open. This does not stop you entering — it is recorded
              for your proctor, and you should close anything you are not using.
            </p>
          </div>
          <Button
            theme={theme}
            variant="secondary"
            size="small"
            onClick={() => void doScan()}
            style={{ width: "100%" }}
          >
            Try the check again
          </Button>
          <CheckLine label="Restricted applications: not checked" status="unknown" />
        </div>
      ) : outcome === "found" && !cleared ? (
        <div style={{ width: "100%" }}>
          <div
            style={{
              marginBottom: "20px",
              borderRadius: "var(--radius-sm)",
              padding: "18px 24px",
              background: "rgba(239,68,68,0.05)",
              border: "1px solid rgba(239,68,68,0.25)",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: "12.5px",
            }}
          >
            <p style={{ marginBottom: "12px", fontWeight: 700, color: "#ef4444" }}>
              Close these restricted apps:
            </p>
            {found.map((f) => (
              <p key={f} style={{ color: "#fca5a5", marginBottom: "4px" }}>
                • {prettyName[f] ?? f} - close this app
              </p>
            ))}
          </div>
          <Button
            theme={theme}
            variant="danger"
            size="small"
            onClick={() => void doScan()}
            style={{ width: "100%" }}
          >
            Check apps again
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5 w-full">
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
            }}
          >
            <div>
              <span
                style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}
              >
                App check:{" "}
              </span>
              <span style={{ color: "#22c55e", fontWeight: 700 }}>Complete</span>
            </div>
            <div>
              <span
                style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}
              >
                Conflicts:{" "}
              </span>
              <span style={{ color: "#22c55e", fontWeight: 700 }}>None found</span>
            </div>
          </div>
          <CheckLine label="No conflicting applications found" status="pass" />
        </div>
      )}
    </div>
  );
}

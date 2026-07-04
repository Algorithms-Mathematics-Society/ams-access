import { useCallback, useEffect, useState } from "react";
import { Button } from "@/app/home/components/ui-primitives";
import { useTheme } from "../hooks";
import { CheckLine, StageHeader } from "../ui";
import { invoke, withNullableTimeout } from "../../support";

export function Stage6_RestrictedApps({ onPass }: { onPass(): void }) {
  const [scanning, setScanning] = useState(true);
  const [found, setFound] = useState<string[]>([]);
  const [cleared, setCleared] = useState(false);
  const theme = useTheme();
  const isLight = theme === "light";

  const doScan = useCallback(async () => {
    setScanning(true);
    setCleared(false);
    await new Promise((r) => setTimeout(r, 600));
    const result = await withNullableTimeout(
      invoke<{ found: string[]; clean: boolean }>("scan_processes"),
      3000
    );
    const foundApps = result?.found ?? [];
    setFound(foundApps);
    setScanning(false);
    if (foundApps.length === 0) setTimeout(onPass, 800);
  }, [onPass]);

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
      <StageHeader id={6} label="Application Check" />

      {scanning ? (
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
      ) : found.length > 0 && !cleared ? (
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

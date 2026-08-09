import { useCallback, useEffect, useState } from "react";
import { fetchOrganizerOverrides } from "@ams/api-client";
import { Button } from "@/app/home/components/ui-primitives";
import { useTheme } from "../hooks";
import { CheckLine, StageHeader } from "../ui";
import { API_URL, getOrCreateDeviceId, tauriWindow, type MonitorInfo } from "../../support";
import { participantToken } from "@/lib/candidate-auth";

export function Stage3_MonitorDetection({
  onPass,
  platform,
  externalDisplayOverride,
}: {
  onPass(): void;
  /** Authoritative device platform ("windows" | "macos" | "linux" | null). */
  platform: string | null;
  /** True when an organizer has waived the `external_display` check for this device. */
  externalDisplayOverride: boolean;
}) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [done, setDone] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanIndeterminate, setScanIndeterminate] = useState(false);
  const theme = useTheme();
  const isLight = theme === "light";

  // Windows-only hard-block: a second / wireless display is a contest-integrity
  // violation we enforce at the gate (mirrors the `external_display` block in
  // core-rs). On macOS/Linux — or when an organizer override is present — this
  // stays an advisory warning so behavior off-Windows is unchanged.
  const isWindows = platform?.toLowerCase().startsWith("windows") ?? false;
  const multiDisplay = monitors.length > 1;
  const hardBlock = isWindows && multiDisplay && !externalDisplayOverride;

  const runDetection = useCallback(async () => {
    setScanning(true);
    setDone(false);

    let mons: MonitorInfo[] = [];
    try {
      const win = await tauriWindow();
      if (win) {
        let monitorsPromise: Promise<MonitorInfo[]>;
        try {
          monitorsPromise = win.availableMonitors();
        } catch {
          monitorsPromise = Promise.resolve([]);
        }
        mons = await Promise.race([
          monitorsPromise,
          new Promise<MonitorInfo[]>((resolve) => setTimeout(() => resolve([]), 2000)),
        ]).catch(() => [] as MonitorInfo[]);
      }
    } catch {
      mons = [];
    }

    // Windows fail-closed: an empty enumeration is "could not verify", NOT a
    // single screen. Off-Windows (or with an organizer override) keep the prior
    // advisory synthetic-single fallback so macOS/Linux behavior is unchanged.
    const enumFailed = mons.length === 0;
    const indeterminate = isWindows && !externalDisplayOverride && enumFailed;
    setScanIndeterminate(indeterminate);

    const list = mons.length
      ? mons
      : [
          {
            name: "Primary Display",
            position: { x: 0, y: 0 },
            size: { width: window.screen.width, height: window.screen.height },
            scaleFactor: window.devicePixelRatio,
          },
        ];
    setMonitors(list);
    setScanning(false);
    setDone(true);

    // Auto-advance only on a verified single screen. Indeterminate (Windows)
    // and multi-display both hold the candidate at this stage.
    if (!indeterminate && list.length === 1) {
      setTimeout(() => {
        onPass();
      }, 1200);
    }
  }, [onPass, isWindows, externalDisplayOverride]);

  useEffect(() => {
    void runDetection();
  }, [runDetection]);

  // Load-bearing escape: while a Windows block (indeterminate or multi-display)
  // is showing, poll organizer overrides every 10s. An `external_display` waiver
  // means this device is allowed through, so advance via onPass() (the final-
  // stage gate independently re-fetches and honors the same override at
  // page.tsx:3937, so advancing here is consistent). No-op off-Windows / once
  // unblocked. contestId is read from the URL — the same source the parent uses
  // (page.tsx ~3400); this component has no contestId prop.
  const blocked =
    isWindows && !externalDisplayOverride && (scanIndeterminate || monitors.length > 1);
  useEffect(() => {
    if (!blocked) return;
    const contestId =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("contestId")
        : null;
    if (!contestId) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const grants = await fetchOrganizerOverrides(
          API_URL,
          contestId,
          getOrCreateDeviceId(),
          participantToken() ?? ""
        );
        if (!cancelled && grants.some((g) => g.check_kind === "external_display")) {
          clearInterval(id);
          onPass(); // override is a waiver -> advance past Stage 3
        }
      } catch {
        /* transient fetch error — keep polling */
      }
    }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [blocked, onPass]);

  return (
    <div className="flex flex-col items-start w-full">
      <StageHeader id={3} label="Display Check" />

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
            Primary screen:{" "}
          </span>
          <span style={{ color: "#22c55e", fontWeight: 700 }}>Primary display</span>
        </div>
        <div>
          <span style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}>
            Resolution:{" "}
          </span>
          <span style={{ color: isLight ? "#0f172a" : "#f8fafc" }}>
            {monitors[0]?.size.width ?? window.screen.width}x
            {monitors[0]?.size.height ?? window.screen.height}
          </span>
        </div>
        <div>
          <span style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}>
            Color depth:{" "}
          </span>
          <span style={{ color: isLight ? "#0f172a" : "#f8fafc" }}>
            {window.screen.colorDepth}-bit
          </span>
        </div>
        <div>
          <span style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}>
            Screen check:{" "}
          </span>
          <span style={{ color: "#22c55e", fontWeight: 700 }}>Active</span>
        </div>
      </div>

      {done && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            textAlign: "left",
            width: "100%",
          }}
        >
          <CheckLine
            label={`${monitors.length || 1} screen${(monitors.length || 1) > 1 ? "s" : ""} detected`}
            status={
              multiDisplay ? (hardBlock ? "fail" : "warn") : scanIndeterminate ? "fail" : "pass"
            }
          />
          {multiDisplay ? (
            <>
              <CheckLine
                label={
                  hardBlock
                    ? "Disconnect the second / wireless display to continue"
                    : "Multiple displays active — please disconnect external screens"
                }
                status={hardBlock ? "fail" : "warn"}
              />
              {hardBlock && (
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    fontSize: "12px",
                    lineHeight: 1.7,
                    color: "#ef4444",
                    marginTop: "4px",
                  }}
                >
                  A second or wireless display is connected. A secured contest requires a single
                  screen — disconnect the extra display, then re-scan.
                </div>
              )}
              {externalDisplayOverride && (
                <CheckLine
                  label="Organizer override active — extra display permitted"
                  status="warn"
                />
              )}
              <Button
                theme={theme}
                variant="danger"
                size="small"
                onClick={runDetection}
                disabled={scanning}
                style={{ marginTop: "16px" }}
              >
                {scanning ? "Checking displays..." : "Check displays again"}
              </Button>
            </>
          ) : (
            !scanIndeterminate && (
              <CheckLine label="Single screen environment confirmed" status="pass" />
            )
          )}
          {scanIndeterminate && !multiDisplay && (
            <>
              <CheckLine label="Could not verify your display setup" status="fail" />
              <div
                style={{
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontSize: "12px",
                  lineHeight: 1.7,
                  color: "#ef4444",
                  marginTop: "4px",
                }}
              >
                We couldn&apos;t confirm how many screens are connected. Re-run the scan; if it
                keeps failing, contact your proctor to be waived in.
              </div>
              <Button
                theme={theme}
                variant="danger"
                size="small"
                onClick={() => void runDetection()}
                disabled={scanning}
                style={{ marginTop: "12px" }}
              >
                {scanning ? "Scanning..." : "Re-scan displays"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

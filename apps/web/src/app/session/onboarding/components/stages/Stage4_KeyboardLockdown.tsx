import { useEffect, useState } from "react";
import { useTheme } from "../hooks";
import { StageHeader, StatusBadge } from "../ui";
import { invoke, withNullableTimeout } from "../../support";

/**
 * Keyboard lockdown.
 *
 * A failure here does not block entry (decision 7 — lockdown violations are
 * recorded and warned about, never auto-ejected), but it must be *recorded* as
 * a warning rather than a pass: on a desktop environment where the intercept
 * cannot engage, the candidate keeps Alt+Tab for the whole exam, and the
 * proctor reviewing the session afterwards needs to know that.
 */
export function Stage4_KeyboardLockdown({ onPass, onWarn }: { onPass(): void; onWarn(): void }) {
  const [phase, setPhase] = useState(0);
  const [lockFailed, setLockFailed] = useState(false);
  const [accessibilityDenied, setAccessibilityDenied] = useState(false);
  const [pollElapsed, setPollElapsed] = useState(0);
  const theme = useTheme();
  const isLight = theme === "light";

  const POLL_TIMEOUT_S = 60;

  // Auto-poll every 2 s while waiting for the user to grant Accessibility
  useEffect(() => {
    if (!accessibilityDenied) return;
    let elapsed = 0;
    const id = setInterval(async () => {
      elapsed += 2;
      setPollElapsed(elapsed);
      if (elapsed >= POLL_TIMEOUT_S) {
        clearInterval(id);
        return; // show manual Re-check button instead
      }
      const result = await invoke<{ active: boolean; method: string }>("enable_keyboard_intercept");
      if (result?.active) {
        clearInterval(id);
        setAccessibilityDenied(false);
        setPhase(4);
        setTimeout(onPass, 600);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [accessibilityDenied, onPass]);

  const recheck = async () => {
    setPollElapsed(0);
    const result = await invoke<{ active: boolean; method: string }>("enable_keyboard_intercept");
    if (result?.active) {
      setAccessibilityDenied(false);
      setPhase(4);
      setTimeout(onPass, 600);
    } else {
      setAccessibilityDenied(true);
    }
  };

  useEffect(() => {
    async function go() {
      setPhase(1);
      const result = await withNullableTimeout(
        invoke<{ active: boolean; method: string }>("enable_keyboard_intercept"),
        2500
      );
      // macOS hard-block: Accessibility permission required
      if (result?.method === "accessibility_denied") {
        setAccessibilityDenied(true);
        return;
      }
      const failed = result?.active !== true;
      setLockFailed(failed);
      setPhase(4);
      // Warn, not pass. The badge already said "unavailable" here while the
      // stage was recorded as a clean pass, so the final summary and the
      // proctor's record both showed keyboard lockdown green on a machine
      // where it never engaged.
      setTimeout(failed ? onWarn : onPass, 600);
    }

    function handleKey(e: KeyboardEvent) {
      const intercept = [
        e.key === "PrintScreen",
        e.altKey && e.key === "Tab",
        e.altKey && e.key === "F4",
        e.metaKey && e.key === "Tab",
        e.metaKey && e.key === "q",
        e.ctrlKey && e.altKey && e.key === "Delete",
      ];
      if (intercept.some(Boolean)) e.preventDefault();
    }
    window.addEventListener("keydown", handleKey, true);
    void go();
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onPass, onWarn]);

  // One intercept covers all four, so they share one outcome. They used to be
  // staggered on `phase >= 1..4` — but `phase` only ever goes 0 → 1 → 4, so
  // the stagger was animation, and worse, all four rendered a green "Ready"
  // even when the intercept had failed and the badge below said so.
  const settled = phase >= 4;
  const keys = ["Alt+Tab", "Super / Win", "Alt+F4 / Cmd+Q", "PrintScreen"].map((label) => ({
    label,
    locked: settled && !lockFailed,
  }));

  // ── Accessibility denied — hard-block UI ──────────────────────────────────
  if (accessibilityDenied) {
    const timedOut = pollElapsed >= POLL_TIMEOUT_S;
    return (
      <div
        style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}
      >
        <StageHeader label="Keyboard Setup" />
        <div
          style={{
            width: "100%",
            padding: "20px",
            borderRadius: "var(--radius-sm)",
            background: isLight ? "#fff7ed" : "#1c1007",
            border: `1px solid ${isLight ? "#fed7aa" : "#78350f"}`,
            marginBottom: "20px",
          }}
        >
          <p
            style={{
              margin: "0 0 6px",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "13px",
              fontWeight: 700,
              color: isLight ? "#9a3412" : "#fb923c",
            }}
          >
            Accessibility permission is required
          </p>
          <p
            style={{
              margin: "0 0 18px",
              fontSize: "12.5px",
              lineHeight: 1.6,
              color: isLight ? "#7c2d12" : "#fdba74",
            }}
          >
            AMS Access needs Accessibility permission to block exam keyboard shortcuts. This
            prevents switching apps or using system shortcuts during the contest.
          </p>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              className="onb-btn onb-btn--primary"
              onClick={() => void invoke("open_accessibility_settings")}
            >
              Open System Settings
            </button>
            {timedOut && (
              <button className="onb-btn onb-btn--secondary" onClick={() => void recheck()}>
                Re-check
              </button>
            )}
          </div>
        </div>
        <StatusBadge
          status="warn"
          label={
            timedOut
              ? "Grant Accessibility access, then click Re-check"
              : `Waiting for permission… checking again in ${2 - (pollElapsed % 2)}s`
          }
        />
      </div>
    );
  }

  // ── Normal flow ───────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
      <StageHeader label="Keyboard Setup" />

      {/* Robust CSS grid container that isolates items from the footer status badge */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "10px",
          width: "100%",
          marginBottom: "28px",
        }}
      >
        {keys.map(({ label, locked }) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 14px",
              borderRadius: "var(--radius-sm)",
              background: isLight
                ? locked
                  ? "#f8fafc"
                  : "#ffffff"
                : locked
                  ? "#1F1F1F"
                  : "#0F0F0F",
              border: `1px solid ${
                locked
                  ? isLight
                    ? "rgba(0,0,0,0.12)"
                    : "rgba(255,255,255,0.08)"
                  : isLight
                    ? "rgba(0,0,0,0.08)"
                    : "rgba(255,255,255,0.06)"
              }`,
              transition:
                "background var(--transition-standard), border-color var(--transition-standard)",
            }}
          >
            <span
              style={{
                color: locked ? "#22c55e" : settled ? "#f59e0b" : "rgba(255,255,255,0.58)",
                fontWeight: 700,
                fontSize: "11px",
                flexShrink: 0,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {locked ? "Ready" : settled ? "Not locked" : "Checking"}
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: "12.5px",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: locked
                  ? isLight
                    ? "#1e293b"
                    : "#f8fafc"
                  : isLight
                    ? "rgba(255,255,255,0.58)"
                    : "#4b5563",
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      <div style={{ width: "100%", display: "flex", justifyContent: "center", marginTop: "8px" }}>
        <StatusBadge
          status={phase >= 4 ? (lockFailed ? "warn" : "pass") : "checking"}
          label={
            phase >= 4
              ? lockFailed
                ? "Keyboard lock unavailable on this desktop environment"
                : "Keyboard controls active"
              : "Setting up keyboard controls..."
          }
        />
      </div>
    </div>
  );
}

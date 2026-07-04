import { useState } from "react";
import { HelpRequestModal } from "@/components/HelpRequestModal";
import { STAGES, type StageStatus } from "../support";

export function DryRunSummary({
  results,
  networkOutcome,
  onDone,
}: {
  results: Record<number, StageStatus>;
  networkOutcome: "skipped" | "ok" | "failed";
  onDone: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);

  // Stages 1–12 are the real device/identity/connection checks. 13–15 are
  // review/transition steps with no standalone pass/fail.
  const checkStages = STAGES.filter((s) => s.id >= 1 && s.id <= 12);
  const rows = checkStages.map((s) => ({
    label: s.label,
    status: results[s.id] ?? "pass",
  }));
  rows.push({
    label: "Network Lockdown",
    status: networkOutcome === "ok" ? "pass" : networkOutcome === "failed" ? "fail" : "warn",
  });

  const anyFail = rows.some((r) => r.status === "fail");
  const anyWarn = rows.some((r) => r.status === "warn");

  const dot = (status: StageStatus) => {
    const color =
      status === "pass"
        ? "#22c55e"
        : status === "warn"
          ? "#f59e0b"
          : status === "fail"
            ? "#ef4444"
            : "rgba(255,255,255,0.58)";
    const label =
      status === "pass"
        ? "Ready"
        : status === "warn"
          ? "Check"
          : status === "fail"
            ? "Failed"
            : "—";
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
        {label}
      </span>
    );
  };

  return (
    <div
      style={{
        maxWidth: 480,
        width: "100%",
        background: "#0F0F0F",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.48)",
        padding: "36px 40px",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          letterSpacing: "0.14em",
          color: "rgba(255,255,255,0.45)",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Practice run complete
      </div>
      <h2 style={{ fontSize: 24, fontWeight: 700, color: "#f8fafc", margin: "0 0 6px" }}>
        {anyFail
          ? "Fix these before your exam"
          : anyWarn
            ? "You're almost ready"
            : "You're ready for exam day"}
      </h2>
      <p
        style={{
          fontSize: 13,
          color: "rgba(255,255,255,0.58)",
          margin: "0 0 24px",
          lineHeight: 1.6,
        }}
      >
        {anyFail
          ? "Some checks failed. Resolve them now — on exam day a failed check can keep you out of the contest."
          : "Your device passed the full setup rehearsal. Nothing was submitted and your machine is fully unlocked."}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 26 }}>
        {rows.map((r) => (
          <div
            key={r.label}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 13,
              color: "#ffffff",
              paddingBottom: 8,
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <span>{r.label}</span>
            {dot(r.status)}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        {(anyFail || anyWarn) && (
          <button
            type="button"
            className="onb-btn onb-btn--secondary"
            style={{ flex: 1 }}
            onClick={() => setHelpOpen(true)}
          >
            Get help
          </button>
        )}
        <button
          type="button"
          className="onb-btn onb-btn--primary"
          style={{ flex: 1 }}
          onClick={onDone}
        >
          Back to home
        </button>
      </div>

      <HelpRequestModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        kind="READINESS"
        summary="Practice setup run reported failing checks."
        details={{
          source: "dry_run",
          checks: rows.reduce<Record<string, string>>((acc, r) => {
            acc[r.label] = r.status;
            return acc;
          }, {}),
        }}
      />
    </div>
  );
}

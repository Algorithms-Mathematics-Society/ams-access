import { type useRouter } from "next/navigation";

// ONE component for both the securing and loading gates (label is the only
// difference): keeping a single element type preserves React reconciliation
// identity across the securing→loading transition, so the spinner animation
// is patched in place instead of unmounted/remounted (no restart flicker) —
// matching the pre-extraction behavior where both branches shared a root div.
export function BootScreen({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "#0F0F0F",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            width: "40px",
            height: "40px",
            borderTop: "2px solid var(--color-accent-base)",
            borderRight: "2px solid rgb(var(--accent-rgb) / 0.3)",
            borderBottom: "2px solid rgb(var(--accent-rgb) / 0.3)",
            borderLeft: "2px solid rgb(var(--accent-rgb) / 0.3)",
            borderRadius: "50%",
            animation: "spin 0.9s linear infinite",
            margin: "0 auto 16px",
          }}
        />
        <p
          style={{
            fontSize: "13px",
            color: "#64748b",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          {label}
        </p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export interface ContestLoadErrorScreenProps {
  loadError: string;
  router: ReturnType<typeof useRouter>;
}

export function ContestLoadErrorScreen({ loadError, router }: ContestLoadErrorScreenProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "#030816",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "560px",
          borderRadius: "16px",
          border: "1px solid rgba(239,68,68,0.35)",
          background: "rgba(239,68,68,0.06)",
          padding: "20px",
          color: "#fecaca",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <p style={{ fontSize: "15px", fontWeight: 600, marginBottom: "8px" }}>Contest Load Error</p>
        <p style={{ fontSize: "13px", color: "#fca5a5", marginBottom: "14px" }}>{loadError}</p>
        <button
          onClick={() => router.push("/home")}
          style={{
            border: "1px solid rgba(239,68,68,0.35)",
            background: "rgba(239,68,68,0.14)",
            color: "#fecaca",
            padding: "8px 12px",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          Back to contests
        </button>
      </div>
    </div>
  );
}

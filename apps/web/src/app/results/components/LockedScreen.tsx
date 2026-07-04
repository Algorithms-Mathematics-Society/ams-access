import { type useRouter } from "next/navigation";

export interface LockedScreenProps {
  lockedUntil: string | null;
  countdown: string;
  email: string;
  router: ReturnType<typeof useRouter>;
}

export function LockedScreen({ lockedUntil, countdown, email, router }: LockedScreenProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--surface-0)",
        color: "var(--theme-text)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        fontFamily: "system-ui, sans-serif",
        padding: "40px 20px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.14em",
          color: "var(--theme-text-muted)",
          textTransform: "uppercase",
        }}
      >
        You&rsquo;re done
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "var(--theme-text)" }}>
        {lockedUntil ? `Results unlock in ${countdown}` : "Results unlock soon"}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-dim)", maxWidth: 360, textAlign: "center" }}>
        {email
          ? `Your work is safely submitted. We'll email you at ${email} when results are ready.`
          : "Your work is safely submitted. We'll email you when results are ready."}
      </div>
      <button
        onClick={() => router.push("/home")}
        className="results-btn results-btn-ghost"
        style={{ marginTop: 12 }}
      >
        Back to Home
      </button>
    </div>
  );
}
